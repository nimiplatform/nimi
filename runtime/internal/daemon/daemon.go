package daemon

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"runtime"
	"strings"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"github.com/nimiplatform/nimi/runtime/internal/grpcserver"
	"github.com/nimiplatform/nimi/runtime/internal/health"
	"github.com/nimiplatform/nimi/runtime/internal/httpserver"
	"github.com/nimiplatform/nimi/runtime/internal/providerhealth"
	"github.com/oklog/ulid/v2"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Daemon wires runtime servers and health state lifecycle.
type Daemon struct {
	cfg        config.Config
	logger     *slog.Logger
	state      *health.State
	grpc       *grpcserver.Server
	http       *httpserver.Server
	aiHealth   *providerhealth.Tracker
	auditStore *auditlog.Store
	engineMgr  *engine.Manager

	newEngineManager               func(logger *slog.Logger, baseDir string, onState engine.StateChangeFunc) (*engine.Manager, error)
	startEngineFn                  func(ctx context.Context, kind engine.EngineKind, version string, port int, envKey string) error
	probeAIProviderFn              func(ctx context.Context, client *http.Client, target aiProviderTarget) error
	detectMediaHostSupportFn       func() (engine.MediaHostSupport, string)
	detectManagedImageSupervisedFn func() bool

	providerFailureHintMu sync.RWMutex
	providerFailureHints  map[string]string
	startupStatusMu       sync.Mutex
	startupDegradedReason string
}

const (
	engineMediaDiffusersBackend = engine.EngineKind("media-diffusers-backend")
	engineSidecar               = engine.EngineKind("sidecar")
)

func New(cfg config.Config, logger *slog.Logger, version string) (*Daemon, error) {
	if value := strings.TrimSpace(cfg.LocalStatePath); value != "" {
		if err := runtimeSetenv("NIMI_RUNTIME_LOCAL_STATE_PATH", value); err != nil {
			return nil, fmt.Errorf("set NIMI_RUNTIME_LOCAL_STATE_PATH: %w", err)
		}
	}
	state := health.NewState()
	grpcServer, err := grpcserver.New(cfg, state, logger, version)
	if err != nil {
		return nil, err
	}
	return &Daemon{
		cfg:                            cfg,
		logger:                         logger,
		state:                          state,
		grpc:                           grpcServer,
		http:                           httpserver.New(cfg.HTTPAddr, state, logger, grpcServer.AIHealthTracker()),
		aiHealth:                       nil,
		auditStore:                     nil,
		newEngineManager:               engine.NewManager,
		probeAIProviderFn:              probeAIProvider,
		detectMediaHostSupportFn:       engine.DetectMediaHostSupport,
		detectManagedImageSupervisedFn: engine.LlamaImageSupervisedPlatformSupported,
		providerFailureHints:           map[string]string{},
	}, nil
}

func (d *Daemon) Run(ctx context.Context) error {
	d.aiHealth = d.grpc.AIHealthTracker()
	d.auditStore = d.grpc.AuditStore()
	d.state.SetStatus(health.StatusStarting, "booting")
	d.grpc.SyncServingState()

	backgroundCtx, cancelBackground := context.WithCancel(context.Background())
	defer cancelBackground()
	var backgroundWG sync.WaitGroup
	backgroundWG.Add(2)
	go func() {
		defer backgroundWG.Done()
		d.sampleRuntimeResource(backgroundCtx)
	}()

	errCh := make(chan error, 2)
	go func() {
		errCh <- d.grpc.Serve()
	}()
	go func() {
		errCh <- d.http.Serve()
	}()

	// Start supervised engines if configured.
	d.startSupervisedEngines(ctx)

	startupDegradedReason := d.consumeStartupDegradedReason()
	d.state.SetStatus(health.StatusReady, "ready")
	d.grpc.SyncServingState()
	d.logger.Info("runtime ready", "grpc_addr", d.cfg.GRPCAddr, "http_addr", d.cfg.HTTPAddr)
	if startupDegradedReason != "" {
		d.transitionToDegraded(startupDegradedReason)
		d.logger.Warn("runtime started in degraded state", "reason", startupDegradedReason)
	}

	go func() {
		defer backgroundWG.Done()
		d.sampleAIProviderHealth(backgroundCtx)
	}()

	var serveErr error
	remainingServers := cap(errCh)
waitForShutdown:
	for remainingServers > 0 {
		select {
		case <-ctx.Done():
			d.logger.Info("runtime shutdown requested")
			break waitForShutdown
		case err := <-errCh:
			remainingServers--
			if err == nil {
				d.logger.Warn("runtime server exited without error before shutdown")
				continue
			}
			serveErr = err
			d.logger.Error("runtime server exited with error", "error", err)
			break waitForShutdown
		}
	}

	cancelBackground()
	backgroundWG.Wait()
	shutdownErr := d.shutdown()

	if serveErr != nil {
		if shutdownErr != nil {
			return fmt.Errorf("serve error: %w (shutdown: %v)", serveErr, shutdownErr)
		}
		return serveErr
	}
	return shutdownErr
}

func (d *Daemon) shutdown() error {
	d.state.SetStatus(health.StatusStopping, "shutting down")
	d.grpc.SyncServingState()

	// Stop supervised engines before servers.
	if d.engineMgr != nil {
		d.logger.Info("stopping supervised engines")
		d.engineMgr.StopAll()
	}

	ctx, cancel := context.WithTimeout(context.Background(), d.cfg.ShutdownTimeout)
	defer cancel()

	httpErr := d.http.Shutdown(ctx)
	grpcErr := d.grpc.Stop(ctx)

	d.state.SetStatus(health.StatusStopped, "stopped")

	if httpErr != nil {
		return fmt.Errorf("shutdown http: %w", httpErr)
	}
	if grpcErr != nil {
		return fmt.Errorf("shutdown grpc: %w", grpcErr)
	}
	return nil
}

func (d *Daemon) sampleRuntimeResource(ctx context.Context) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			var ms runtime.MemStats
			runtime.ReadMemStats(&ms)
			d.state.SetResource(0, int64(ms.Alloc), 0)
		}
	}
}

func (d *Daemon) setDegradedStatus(reason string) {
	trimmedReason := strings.TrimSpace(reason)
	if trimmedReason == "" {
		trimmedReason = "degraded"
	}
	snapshot := d.state.Snapshot()
	if snapshot.Status == health.StatusStarting {
		d.startupStatusMu.Lock()
		if d.startupDegradedReason == "" {
			d.startupDegradedReason = trimmedReason
		}
		d.startupStatusMu.Unlock()
		return
	}
	d.transitionToDegraded(trimmedReason)
}

func (d *Daemon) transitionToDegraded(reason string) {
	d.state.SetStatus(health.StatusDegraded, reason)
	d.grpc.SyncServingState()
}

func (d *Daemon) consumeStartupDegradedReason() string {
	d.startupStatusMu.Lock()
	defer d.startupStatusMu.Unlock()
	reason := strings.TrimSpace(d.startupDegradedReason)
	d.startupDegradedReason = ""
	return reason
}

func (d *Daemon) sampleAIProviderHealth(ctx context.Context) {
	targets := configuredAIProviderTargets(d.cfg)
	if len(targets) == 0 {
		return
	}

	timeout := time.Duration(d.cfg.AIHTTPTimeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	interval := time.Duration(d.cfg.AIHealthIntervalSeconds) * time.Second
	if interval <= 0 {
		interval = 8 * time.Second
	}
	client := &http.Client{Timeout: timeout}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	probe := func() {
		if ctx.Err() != nil {
			return
		}
		snapshot := d.state.Snapshot()
		if snapshot.Status == health.StatusStopping || snapshot.Status == health.StatusStopped {
			return
		}

		var firstErr string
		healthyCount := 0
		for _, target := range targets {
			if ctx.Err() != nil {
				return
			}
			previous := providerhealth.Snapshot{}
			if d.aiHealth != nil {
				previous = d.aiHealth.SnapshotOf(target.Name)
			}
			if err := d.probeAIProviderFn(ctx, client, target); err != nil {
				if ctx.Err() != nil {
					return
				}
				err = d.decorateProviderProbeError(target.Name, err)
				if d.aiHealth != nil {
					if markErr := d.aiHealth.Mark(target.Name, false, err.Error()); markErr == nil {
						appendProviderHealthAudit(d.auditStore, target.Name, previous, d.aiHealth.SnapshotOf(target.Name))
					}
				}
				if firstErr == "" {
					firstErr = fmt.Sprintf("ai-provider:%s unavailable (%v)", target.Name, err)
				}
				continue
			}
			healthyCount++
			if d.aiHealth != nil {
				if markErr := d.aiHealth.Mark(target.Name, true, ""); markErr == nil {
					appendProviderHealthAudit(d.auditStore, target.Name, previous, d.aiHealth.SnapshotOf(target.Name))
				}
			}
		}

		if healthyCount > 0 {
			current := d.state.Snapshot()
			if current.Status == health.StatusDegraded && strings.HasPrefix(current.Reason, "ai-provider:") {
				d.state.SetStatus(health.StatusReady, "ready")
				d.grpc.SyncServingState()
			}
			return
		}

		if firstErr == "" {
			firstErr = "ai-provider:all unavailable"
		}
		d.setDegradedStatus(firstErr)
	}

	probe()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			probe()
		}
	}
}

type aiProviderTarget struct {
	Name   string
	Base   string
	APIKey string
}

func configuredAIProviderTargets(cfg config.Config) []aiProviderTarget {
	cloudTargets := config.ResolveCloudProviderTargets(cfg.Providers)
	targets := make([]aiProviderTarget, 0, 3+len(cloudTargets))
	seen := map[string]bool{}

	add := func(name string, base string, apiKey string) {
		normalized := strings.TrimSuffix(strings.TrimSpace(base), "/")
		if normalized == "" {
			return
		}
		key := name + "::" + normalized
		if seen[key] {
			return
		}
		seen[key] = true
		targets = append(targets, aiProviderTarget{
			Name:   name,
			Base:   normalized,
			APIKey: strings.TrimSpace(apiKey),
		})
	}

	add("local", runtimeGetenv("NIMI_RUNTIME_LOCAL_LLAMA_BASE_URL"), runtimeGetenv("NIMI_RUNTIME_LOCAL_LLAMA_API_KEY"))
	add("local-media", runtimeGetenv("NIMI_RUNTIME_LOCAL_MEDIA_BASE_URL"), runtimeGetenv("NIMI_RUNTIME_LOCAL_MEDIA_API_KEY"))
	add("local-sidecar", runtimeGetenv("NIMI_RUNTIME_LOCAL_SIDECAR_BASE_URL"), runtimeGetenv("NIMI_RUNTIME_LOCAL_SIDECAR_API_KEY"))
	for _, target := range cloudTargets {
		add(cloudProviderTargetName(target.CanonicalID), target.BaseURL, target.APIKey)
	}
	return targets
}

func cloudProviderTargetName(canonicalID string) string {
	trimmed := strings.TrimSpace(canonicalID)
	if trimmed == "" {
		return "cloud"
	}
	return "cloud-" + strings.ReplaceAll(trimmed, "_", "-")
}

// probeAIProvider checks provider health per K-PROV-003:
//   - 2xx/401/403/429 = healthy
//   - 404 = try next path
//   - other 4xx/5xx = unhealthy
func probeAIProvider(ctx context.Context, client *http.Client, target aiProviderTarget) error {
	paths := providerProbePaths(target.Name)
	var lastErr error
	for _, path := range paths {
		endpoint := resolveProbeEndpoint(target.Base, path)
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
		if err != nil {
			lastErr = err
			continue
		}
		if target.APIKey != "" {
			req.Header.Set("Authorization", "Bearer "+target.APIKey)
		}

		resp, err := client.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		resp.Body.Close()

		switch {
		case resp.StatusCode >= 200 && resp.StatusCode < 300:
			return nil // 2xx = healthy
		case resp.StatusCode == 401, resp.StatusCode == 403, resp.StatusCode == 429:
			return nil // auth/rate-limit = healthy (provider is reachable)
		case resp.StatusCode == 404:
			continue // try next path
		default:
			lastErr = fmt.Errorf("status=%d", resp.StatusCode)
		}
	}
	if lastErr != nil {
		return lastErr
	}
	return fmt.Errorf("unreachable")
}

func providerProbePaths(name string) []string {
	if strings.EqualFold(strings.TrimSpace(name), "local-media") {
		return []string{"/healthz", "/v1/catalog"}
	}
	if strings.EqualFold(strings.TrimSpace(name), "local") {
		return []string{"/health", "/v1/models"}
	}
	return []string{"/healthz", "/v1/models"}
}

func resolveProbeEndpoint(base string, path string) string {
	trimmedBase := strings.TrimSuffix(strings.TrimSpace(base), "/")
	normalizedPath := strings.TrimSpace(path)
	if trimmedBase == "" || normalizedPath == "" {
		return trimmedBase + normalizedPath
	}
	if !strings.HasPrefix(normalizedPath, "/") {
		normalizedPath = "/" + normalizedPath
	}

	parsed, err := url.Parse(trimmedBase)
	if err != nil {
		return trimmedBase + normalizedPath
	}

	basePath := strings.TrimSuffix(parsed.Path, "/")
	if strings.HasSuffix(basePath, "/v1") && strings.HasPrefix(normalizedPath, "/v1/") {
		normalizedPath = strings.TrimPrefix(normalizedPath, "/v1")
		if !strings.HasPrefix(normalizedPath, "/") {
			normalizedPath = "/" + normalizedPath
		}
	}
	parsed.Path = basePath + normalizedPath
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String()
}

func auditPayloadStruct(fields map[string]any) *structpb.Struct {
	payload, err := structpb.NewStruct(fields)
	if err == nil {
		return payload
	}
	fallback, _ := structpb.NewStruct(map[string]any{
		"payload_encode_error": err.Error(),
	})
	return fallback
}

func appendStartupFailureAudit(store *auditlog.Store, reason string) {
	if store == nil {
		return
	}
	now := time.Now().UTC()
	payload := auditPayloadStruct(map[string]any{
		"phase":  "starting",
		"reason": reason,
	})
	store.AppendEvent(&runtimev1.AuditEventRecord{
		AuditId:    ulid.Make().String(),
		Domain:     "runtime.lifecycle",
		Operation:  "startup.failed",
		ReasonCode: runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
		TraceId:    ulid.Make().String(),
		Timestamp:  timestamppb.New(now),
		Payload:    payload,
		CallerKind: runtimev1.CallerKind_CALLER_KIND_DESKTOP_CORE,
		CallerId:   "runtime-daemon",
		SurfaceId:  "daemon",
	})
}

func appendEngineCrashAudit(store *auditlog.Store, engineName string, detail string) {
	if store == nil {
		return
	}
	attempt, maxAttempt, exitCode := parseEngineCrashDetail(detail)
	now := time.Now().UTC()
	payload := auditPayloadStruct(map[string]any{
		"engine":      engineName,
		"detail":      detail,
		"attempt":     attempt,
		"max_attempt": maxAttempt,
		"exit_code":   exitCode,
	})
	store.AppendEvent(&runtimev1.AuditEventRecord{
		AuditId:    ulid.Make().String(),
		Domain:     "runtime.engine",
		Operation:  "engine.unhealthy",
		ReasonCode: runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE,
		TraceId:    ulid.Make().String(),
		Timestamp:  timestamppb.New(now),
		Payload:    payload,
		CallerKind: runtimev1.CallerKind_CALLER_KIND_DESKTOP_CORE,
		CallerId:   "runtime-daemon",
		SurfaceId:  "daemon",
	})
}

func appendEngineBootstrapFailureAudit(store *auditlog.Store, engineName string, providerName string, detail string) {
	if store == nil {
		return
	}
	now := time.Now().UTC()
	payload := auditPayloadStruct(map[string]any{
		"engine":   strings.TrimSpace(engineName),
		"provider": strings.TrimSpace(providerName),
		"detail":   detail,
	})
	store.AppendEvent(&runtimev1.AuditEventRecord{
		AuditId:    ulid.Make().String(),
		Domain:     "runtime.engine",
		Operation:  "engine.bootstrap_failed",
		ReasonCode: runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
		TraceId:    ulid.Make().String(),
		Timestamp:  timestamppb.New(now),
		Payload:    payload,
		CallerKind: runtimev1.CallerKind_CALLER_KIND_DESKTOP_CORE,
		CallerId:   "runtime-daemon",
		SurfaceId:  "daemon",
	})
}

func (d *Daemon) recordManagedLlamaBootstrapFailure(detail string) {
	trimmedDetail := strings.TrimSpace(detail)
	if trimmedDetail == "" {
		trimmedDetail = "managed llama bootstrap failed"
	}
	reason := fmt.Sprintf("engine bootstrap failed (%s: %s)", engine.EngineLlama, trimmedDetail)

	d.logger.Error("managed llama bootstrap failed", "detail", trimmedDetail)
	d.setProviderFailureHint("local", reason)
	if d.aiHealth != nil {
		previous := d.aiHealth.SnapshotOf("local")
		if err := d.aiHealth.Mark("local", false, reason); err == nil {
			appendProviderHealthAudit(d.auditStore, "local", previous, d.aiHealth.SnapshotOf("local"))
		}
	}
	appendEngineBootstrapFailureAudit(d.auditStore, string(engine.EngineLlama), "local", trimmedDetail)
	d.setDegradedStatus(reason)
}

func (d *Daemon) startSupervisedEngines(ctx context.Context) {
	svc := d.grpc.LocalService()
	effectiveManagedLlama := d.cfg.EngineLlamaEnabled
	if !effectiveManagedLlama && svc != nil && svc.HasManagedSupervisedLlamaModels() {
		effectiveManagedLlama = true
	}
	managedImageAssetsPresent := svc != nil && svc.HasManagedSupervisedImageModels()
	if !effectiveManagedLlama && managedImageAssetsPresent {
		effectiveManagedLlama = true
	}
	if !effectiveManagedLlama && !d.cfg.EngineMediaEnabled && !d.cfg.EngineSpeechEnabled && !d.cfg.EngineSidecarEnabled {
		return
	}

	onState := func(kind engine.EngineKind, status engine.EngineStatus, detail string) {
		d.onEngineStateChange(string(kind), string(status), detail)
	}

	managerFactory := d.newEngineManager
	if managerFactory == nil {
		managerFactory = engine.NewManager
	}
	mgr, err := managerFactory(d.logger, "", onState)
	if err != nil {
		d.logger.Error("create engine manager failed", "error", err)
		reason := fmt.Sprintf("engine manager init failed (%v)", err)
		d.setDegradedStatus(reason)
		appendStartupFailureAudit(d.auditStore, reason)
		return
	}
	d.engineMgr = mgr
	managedLlamaConfigPath := resolveManagedLlamaModelsConfigPath()
	mgr.SetLlamaPaths(d.cfg.LocalModelsPath, managedLlamaConfigPath)

	// Inject engine manager into local service for gRPC access.
	skipLlamaBootstrap := false
	mediaHostSupport, _ := d.detectMediaHostSupport()
	managedImageLoopback := effectiveManagedLlama && managedImageAssetsPresent && d.detectManagedImageSupervised()
	if managedImageLoopback {
		mgr.SetLlamaImageBackend(&engine.LlamaImageBackendConfig{
			Mode:        engine.LlamaImageBackendOfficial,
			BackendName: "stablediffusion-ggml",
			Address:     "127.0.0.1:50052",
		})
	} else {
		mgr.SetLlamaImageBackend(nil)
	}
	managedMediaLoopback := managedImageLoopback || (d.cfg.EngineMediaEnabled && mediaHostSupport == engine.MediaHostSupportSupportedSupervised)
	if svc != nil {
		svc.SetManagedLlamaRegistrationConfig(d.cfg.LocalModelsPath, managedLlamaConfigPath, effectiveManagedLlama)
		if effectiveManagedLlama {
			svc.SetManagedLlamaEndpoint(fmt.Sprintf("http://127.0.0.1:%d/v1", d.cfg.EngineLlamaPort))
		} else {
			svc.SetManagedLlamaEndpoint("")
		}
		if managedMediaLoopback {
			svc.SetManagedMediaEndpoint(fmt.Sprintf("http://127.0.0.1:%d/v1", d.cfg.EngineMediaPort))
		} else {
			svc.SetManagedMediaEndpoint("")
		}
		if d.cfg.EngineSpeechEnabled {
			svc.SetManagedSpeechEndpoint(fmt.Sprintf("http://127.0.0.1:%d/v1", d.cfg.EngineSpeechPort))
		} else {
			svc.SetManagedSpeechEndpoint("")
		}
		if managedImageLoopback {
			svc.SetManagedMediaDiffusersBackendConfig(true, "127.0.0.1:50052")
		} else {
			svc.SetManagedMediaDiffusersBackendConfig(false, "")
		}
		svc.SetEngineManager(engine.NewServiceAdapter(mgr))
		if err := svc.SyncManagedLlamaAssets(ctx); err != nil {
			d.recordManagedLlamaBootstrapFailure(fmt.Sprintf("sync managed llama assets: %v", err))
			skipLlamaBootstrap = true
		}
	}

	var wg sync.WaitGroup
	type bootstrapFailure struct {
		kind   engine.EngineKind
		detail string
	}
	failures := make(chan bootstrapFailure, 4)
	startEngine := d.startEngineFn
	if startEngine == nil {
		startEngine = d.startEngine
	}
	bootstrap := func(kind engine.EngineKind, version string, port int, envKey string) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := startEngine(ctx, kind, version, port, envKey); err != nil {
				failures <- bootstrapFailure{
					kind:   kind,
					detail: err.Error(),
				}
			}
		}()
	}

	if effectiveManagedLlama && !skipLlamaBootstrap {
		bootstrap(engine.EngineLlama, d.cfg.EngineLlamaVersion, d.cfg.EngineLlamaPort,
			"NIMI_RUNTIME_LOCAL_LLAMA_BASE_URL")
	}

	if managedMediaLoopback {
		bootstrap(engine.EngineMedia, d.cfg.EngineMediaVersion, d.cfg.EngineMediaPort,
			"NIMI_RUNTIME_LOCAL_MEDIA_BASE_URL")
	}

	if d.cfg.EngineSpeechEnabled {
		bootstrap(engine.EngineSpeech, d.cfg.EngineSpeechVersion, d.cfg.EngineSpeechPort,
			"NIMI_RUNTIME_LOCAL_SPEECH_BASE_URL")
	}

	if d.cfg.EngineSidecarEnabled {
		bootstrap(engineSidecar, d.cfg.EngineSidecarVersion, d.cfg.EngineSidecarPort,
			"NIMI_RUNTIME_LOCAL_SIDECAR_BASE_URL")
	}

	wg.Wait()
	close(failures)

	firstFailure := ""
	for failure := range failures {
		if firstFailure == "" {
			firstFailure = fmt.Sprintf("%s: %s", failure.kind, failure.detail)
		}
		d.logger.Error("engine bootstrap failed", "engine", failure.kind, "detail", failure.detail)
		if providerName, ok := providerTargetNameForEngine(failure.kind); ok {
			reason := fmt.Sprintf("engine bootstrap failed (%s: %s)", failure.kind, failure.detail)
			d.setProviderFailureHint(providerName, reason)
			if d.aiHealth != nil {
				previous := d.aiHealth.SnapshotOf(providerName)
				if err := d.aiHealth.Mark(providerName, false, reason); err == nil {
					appendProviderHealthAudit(d.auditStore, providerName, previous, d.aiHealth.SnapshotOf(providerName))
				}
			}
			appendEngineBootstrapFailureAudit(d.auditStore, string(failure.kind), providerName, failure.detail)
		}
	}
	if firstFailure != "" {
		d.setDegradedStatus(fmt.Sprintf("engine bootstrap failed (%s)", firstFailure))
	}
}

func (d *Daemon) startEngine(ctx context.Context, kind engine.EngineKind, version string, port int, envKey string) error {
	var cfg engine.EngineConfig
	switch kind {
	case engine.EngineLlama:
		cfg = engine.DefaultLlamaConfig()
	case engine.EngineMedia:
		cfg = engine.DefaultMediaConfig()
	case engine.EngineSpeech:
		cfg = engine.DefaultSpeechConfig()
	case engineSidecar:
		return fmt.Errorf("engine %s is not yet supported for supervised lifecycle", kind)
	default:
		return fmt.Errorf("unsupported engine kind: %s", kind)
	}
	if version != "" {
		cfg.Version = version
	}
	if port > 0 {
		cfg.Port = port
	}

	cfg, err := d.engineMgr.EnsureEngine(ctx, cfg)
	if err != nil {
		d.logger.Error("ensure engine failed",
			"engine", kind,
			"error", err,
		)
		return fmt.Errorf("ensure %s: %w", kind, err)
	}

	if err := d.engineMgr.StartEngine(ctx, cfg); err != nil {
		d.logger.Error("start engine failed",
			"engine", kind,
			"error", err,
		)
		return fmt.Errorf("start %s: %w", kind, err)
	}

	d.injectEngineEndpointEnv(kind, envKey, "bootstrap")
	return nil
}

func (d *Daemon) injectEngineEndpointEnv(kind engine.EngineKind, envKey string, source string) {
	if d.engineMgr == nil || strings.TrimSpace(envKey) == "" {
		return
	}
	endpoint, err := d.engineMgr.EngineEndpoint(kind)
	if err != nil {
		d.logger.Warn("resolve engine endpoint failed",
			"engine", kind,
			"source", source,
			"error", err,
		)
		return
	}
	trimmed := strings.TrimSuffix(strings.TrimSpace(endpoint), "/")
	if trimmed == "" {
		return
	}
	if err := runtimeSetenv(envKey, trimmed+"/v1"); err != nil {
		d.logger.Warn("set engine endpoint env failed",
			"engine", kind,
			"source", source,
			"env", envKey,
			"error", err,
		)
		return
	}
	if aiSvc := d.grpc.AIService(); aiSvc != nil {
		if providerID, apiKeyEnv, ok := localProviderEnvBinding(kind); ok {
			aiSvc.SetLocalProviderEndpoint(providerID, trimmed+"/v1", runtimeGetenv(apiKeyEnv))
		}
	}
	d.logger.Info("engine endpoint env injected",
		"engine", kind,
		"source", source,
		"endpoint", trimmed,
		"env", envKey,
	)
}

func (d *Daemon) onEngineStateChange(engineName string, status string, detail string) {
	snapshot := d.state.Snapshot()
	if snapshot.Status == health.StatusStopping || snapshot.Status == health.StatusStopped {
		return
	}
	if strings.EqualFold(strings.TrimSpace(engineName), string(engineMediaDiffusersBackend)) {
		if svc := d.grpc.LocalService(); svc != nil {
			switch strings.ToLower(strings.TrimSpace(status)) {
			case "healthy":
				svc.SetManagedMediaDiffusersBackendHealth(true, detail)
			case "unhealthy":
				svc.SetManagedMediaDiffusersBackendHealth(false, detail)
			}
		}
	}

	switch status {
	case "unhealthy":
		d.setDegradedStatus(fmt.Sprintf("engine:%s unhealthy (%s)", engineName, detail))
		appendEngineCrashAudit(d.auditStore, engineName, detail)
		if kind, ok := engineKindForName(engineName); ok {
			if providerName, ok := providerTargetNameForEngine(kind); ok {
				d.setProviderFailureHint(providerName, fmt.Sprintf("engine unhealthy (%s: %s)", engineName, detail))
			}
		}
	case "healthy":
		recoveringSameEngine := snapshot.Status == health.StatusDegraded &&
			engineUnhealthyReasonMatches(snapshot.Reason, engineName)
		if !recoveringSameEngine {
			return
		}
		if kind, envKey, ok := engineEnvKey(engineName); ok {
			d.injectEngineEndpointEnv(kind, envKey, "recovered")
		}
		if kind, ok := engineKindForName(engineName); ok {
			if providerName, ok := providerTargetNameForEngine(kind); ok {
				d.clearProviderFailureHint(providerName)
			}
		}
		d.state.SetStatus(health.StatusReady, "ready")
		d.grpc.SyncServingState()
	}
}
