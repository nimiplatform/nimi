package daemon

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
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

	newEngineManager func(logger *slog.Logger, baseDir string, onState engine.StateChangeFunc) (*engine.Manager, error)
	startEngineFn    func(ctx context.Context, kind engine.EngineKind, version string, port int, envKey string) error

	providerFailureHintMu sync.RWMutex
	providerFailureHints  map[string]string
}

var (
	engineCrashAttemptPattern    = regexp.MustCompile(`attempt=(\d+)/(\d+)`)
	engineCrashExitStatusPattern = regexp.MustCompile(`exit status (\d+)`)
)

func New(cfg config.Config, logger *slog.Logger, version string) *Daemon {
	if value := strings.TrimSpace(cfg.LocalStatePath); value != "" {
		_ = os.Setenv("NIMI_RUNTIME_LOCAL_STATE_PATH", value)
	}
	state := health.NewState()
	return &Daemon{
		cfg:                  cfg,
		logger:               logger,
		state:                state,
		grpc:                 grpcserver.New(cfg, state, logger, version),
		http:                 httpserver.New(cfg.HTTPAddr, state, logger),
		aiHealth:             nil,
		auditStore:           nil,
		newEngineManager:     engine.NewManager,
		providerFailureHints: map[string]string{},
	}
}

func (d *Daemon) Run(ctx context.Context) error {
	d.aiHealth = d.grpc.AIHealthTracker()
	d.auditStore = d.grpc.AuditStore()
	d.http.SetAIHealthTracker(d.aiHealth)
	d.state.SetStatus(health.StatusStarting, "booting")
	d.grpc.SyncServingState()

	samplerStop := make(chan struct{})
	go d.sampleRuntimeResource(samplerStop)

	errCh := make(chan error, 2)
	go func() {
		errCh <- d.grpc.Serve()
	}()
	go func() {
		errCh <- d.http.Serve()
	}()

	// Start supervised engines if configured.
	d.startSupervisedEngines(ctx)

	if d.state.Snapshot().Status == health.StatusDegraded {
		d.logger.Warn("runtime started in degraded state", "reason", d.state.Snapshot().Reason)
	} else {
		d.state.SetStatus(health.StatusReady, "ready")
		d.grpc.SyncServingState()
		d.logger.Info("runtime ready", "grpc_addr", d.cfg.GRPCAddr, "http_addr", d.cfg.HTTPAddr)
	}

	aiProbeStop := make(chan struct{})
	go d.sampleAIProviderHealth(aiProbeStop)

	var serveErr error
	select {
	case <-ctx.Done():
		d.logger.Info("runtime shutdown requested")
	case err := <-errCh:
		if err != nil {
			serveErr = err
			d.logger.Error("runtime server exited with error", "error", err)
		}
	}

	close(samplerStop)
	close(aiProbeStop)
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
	d.grpc.SyncServingState()

	if httpErr != nil {
		return fmt.Errorf("shutdown http: %w", httpErr)
	}
	if grpcErr != nil {
		return fmt.Errorf("shutdown grpc: %w", grpcErr)
	}
	return nil
}

func (d *Daemon) sampleRuntimeResource(stop <-chan struct{}) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
			var ms runtime.MemStats
			runtime.ReadMemStats(&ms)
			d.state.SetResource(0, int64(ms.Alloc), 0)
		}
	}
}

func (d *Daemon) sampleAIProviderHealth(stop <-chan struct{}) {
	targets := configuredAIProviderTargets()
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
		snapshot := d.state.Snapshot()
		if snapshot.Status == health.StatusStopping || snapshot.Status == health.StatusStopped {
			return
		}

		var firstErr string
		healthyCount := 0
		for _, target := range targets {
			previous := providerhealth.Snapshot{}
			if d.aiHealth != nil {
				previous = d.aiHealth.Snapshot(target.Name)
			}
			if err := probeAIProvider(client, target); err != nil {
				err = d.decorateProviderProbeError(target.Name, err)
				if d.aiHealth != nil {
					d.aiHealth.Mark(target.Name, false, err.Error())
					appendProviderHealthAudit(d.auditStore, target.Name, previous, d.aiHealth.Snapshot(target.Name))
				}
				if firstErr == "" {
					firstErr = fmt.Sprintf("ai-provider:%s unavailable (%v)", target.Name, err)
				}
				continue
			}
			healthyCount++
			if d.aiHealth != nil {
				d.aiHealth.Mark(target.Name, true, "")
				appendProviderHealthAudit(d.auditStore, target.Name, previous, d.aiHealth.Snapshot(target.Name))
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
		d.state.SetStatus(health.StatusDegraded, firstErr)
		d.grpc.SyncServingState()
	}

	probe()
	for {
		select {
		case <-stop:
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

func configuredAIProviderTargets() []aiProviderTarget {
	targets := make([]aiProviderTarget, 0, 10)
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

	add("local", os.Getenv("NIMI_RUNTIME_LOCAL_AI_BASE_URL"), os.Getenv("NIMI_RUNTIME_LOCAL_AI_API_KEY"))
	add("local-nexa", os.Getenv("NIMI_RUNTIME_LOCAL_NEXA_BASE_URL"), os.Getenv("NIMI_RUNTIME_LOCAL_NEXA_API_KEY"))
	add("local-sidecar", os.Getenv("NIMI_RUNTIME_LOCAL_SIDECAR_BASE_URL"), os.Getenv("NIMI_RUNTIME_LOCAL_SIDECAR_API_KEY"))
	add("cloud-nimillm", os.Getenv("NIMI_RUNTIME_CLOUD_NIMILLM_BASE_URL"), os.Getenv("NIMI_RUNTIME_CLOUD_NIMILLM_API_KEY"))
	add("cloud-dashscope", os.Getenv("NIMI_RUNTIME_CLOUD_DASHSCOPE_BASE_URL"), os.Getenv("NIMI_RUNTIME_CLOUD_DASHSCOPE_API_KEY"))
	add("cloud-volcengine", os.Getenv("NIMI_RUNTIME_CLOUD_VOLCENGINE_BASE_URL"), os.Getenv("NIMI_RUNTIME_CLOUD_VOLCENGINE_API_KEY"))
	add("cloud-volcengine-openspeech", os.Getenv("NIMI_RUNTIME_CLOUD_VOLCENGINE_OPENSPEECH_BASE_URL"), os.Getenv("NIMI_RUNTIME_CLOUD_VOLCENGINE_OPENSPEECH_API_KEY"))
	add("cloud-gemini", os.Getenv("NIMI_RUNTIME_CLOUD_GEMINI_BASE_URL"), os.Getenv("NIMI_RUNTIME_CLOUD_GEMINI_API_KEY"))
	add("cloud-minimax", os.Getenv("NIMI_RUNTIME_CLOUD_MINIMAX_BASE_URL"), os.Getenv("NIMI_RUNTIME_CLOUD_MINIMAX_API_KEY"))
	add("cloud-kimi", os.Getenv("NIMI_RUNTIME_CLOUD_KIMI_BASE_URL"), os.Getenv("NIMI_RUNTIME_CLOUD_KIMI_API_KEY"))
	add("cloud-glm", os.Getenv("NIMI_RUNTIME_CLOUD_GLM_BASE_URL"), os.Getenv("NIMI_RUNTIME_CLOUD_GLM_API_KEY"))
	add("cloud-deepseek", os.Getenv("NIMI_RUNTIME_CLOUD_DEEPSEEK_BASE_URL"), os.Getenv("NIMI_RUNTIME_CLOUD_DEEPSEEK_API_KEY"))
	add("cloud-openrouter", os.Getenv("NIMI_RUNTIME_CLOUD_OPENROUTER_BASE_URL"), os.Getenv("NIMI_RUNTIME_CLOUD_OPENROUTER_API_KEY"))
	return targets
}

// probeAIProvider checks provider health per K-PROV-003:
//   - 2xx/401/403/429 = healthy
//   - 404 = try next path
//   - other 4xx/5xx = unhealthy
func probeAIProvider(client *http.Client, target aiProviderTarget) error {
	paths := []string{"/healthz", "/v1/models"}
	var lastErr error
	for _, path := range paths {
		endpoint := resolveProbeEndpoint(target.Base, path)
		req, err := http.NewRequest(http.MethodGet, endpoint, nil)
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

func appendStartupFailureAudit(store *auditlog.Store, reason string) {
	if store == nil {
		return
	}
	now := time.Now().UTC()
	payload, _ := structpb.NewStruct(map[string]any{
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
	payload, _ := structpb.NewStruct(map[string]any{
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
		ReasonCode: runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
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
	payload, _ := structpb.NewStruct(map[string]any{
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

func resolveManagedLocalAIModelsConfigPath() string {
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return ""
	}
	return filepath.Join(home, ".nimi", "runtime", "localai-models.yaml")
}

func (d *Daemon) recordLocalAIBootstrapFailure(detail string) bool {
	trimmedDetail := strings.TrimSpace(detail)
	if trimmedDetail == "" {
		trimmedDetail = "managed localai bootstrap failed"
	}
	reason := fmt.Sprintf("engine bootstrap failed (%s: %s)", engine.EngineLocalAI, trimmedDetail)

	d.logger.Error("managed localai bootstrap failed", "detail", trimmedDetail)
	d.setProviderFailureHint("local", reason)
	if d.aiHealth != nil {
		previous := d.aiHealth.Snapshot("local")
		d.aiHealth.Mark("local", false, reason)
		appendProviderHealthAudit(d.auditStore, "local", previous, d.aiHealth.Snapshot("local"))
	}
	appendEngineBootstrapFailureAudit(d.auditStore, string(engine.EngineLocalAI), "local", trimmedDetail)
	d.state.SetStatus(health.StatusDegraded, reason)
	d.grpc.SyncServingState()
	return true
}

func parseEngineCrashDetail(detail string) (attempt int, maxAttempt int, exitCode int) {
	exitCode = -1
	matches := engineCrashAttemptPattern.FindStringSubmatch(strings.TrimSpace(detail))
	if len(matches) == 3 {
		if value, err := strconv.Atoi(matches[1]); err == nil {
			attempt = value
		}
		if value, err := strconv.Atoi(matches[2]); err == nil {
			maxAttempt = value
		}
	}
	exitMatches := engineCrashExitStatusPattern.FindStringSubmatch(strings.TrimSpace(detail))
	if len(exitMatches) == 2 {
		if value, err := strconv.Atoi(exitMatches[1]); err == nil {
			exitCode = value
		}
	}
	return attempt, maxAttempt, exitCode
}

func (d *Daemon) startSupervisedEngines(ctx context.Context) {
	if !d.cfg.EngineLocalAIEnabled && !d.cfg.EngineNexaEnabled {
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
		d.state.SetStatus(health.StatusDegraded, reason)
		d.grpc.SyncServingState()
		appendStartupFailureAudit(d.auditStore, reason)
		return
	}
	d.engineMgr = mgr
	localAIConfigPath := resolveManagedLocalAIModelsConfigPath()
	mgr.SetLocalAIPaths(d.cfg.LocalModelsPath, localAIConfigPath)
	mgr.SetLocalAIImageBackend(&engine.LocalAIImageBackendConfig{
		Mode:        engine.LocalAIImageBackendMode(strings.ToLower(strings.TrimSpace(d.cfg.EngineLocalAIImageBackendMode))),
		BackendName: strings.TrimSpace(d.cfg.EngineLocalAIImageBackendName),
		Address:     strings.TrimSpace(d.cfg.EngineLocalAIImageBackendAddress),
		Command:     strings.TrimSpace(d.cfg.EngineLocalAIImageBackendCommand),
		Args:        append([]string(nil), d.cfg.EngineLocalAIImageBackendArgs...),
		Env:         cloneStringMap(d.cfg.EngineLocalAIImageBackendEnv),
		WorkingDir:  strings.TrimSpace(d.cfg.EngineLocalAIImageBackendWorkingDir),
	})

	// Inject engine manager into local service for gRPC access.
	skipLocalAIBootstrap := false
	if svc := d.grpc.LocalService(); svc != nil {
		svc.SetLocalAIRegistrationConfig(d.cfg.LocalModelsPath, localAIConfigPath, d.cfg.EngineLocalAIEnabled)
		if d.cfg.EngineLocalAIEnabled {
			svc.SetLocalAIManagedEndpoint(fmt.Sprintf("http://127.0.0.1:%d/v1", d.cfg.EngineLocalAIPort))
		} else {
			svc.SetLocalAIManagedEndpoint("")
		}
		svc.SetLocalAIImageBackendConfig(strings.TrimSpace(strings.ToLower(d.cfg.EngineLocalAIImageBackendMode)) != "disabled", d.cfg.EngineLocalAIImageBackendAddress)
		svc.SetEngineManager(engine.NewServiceAdapter(mgr))
		if err := svc.SyncManagedLocalAIAssets(ctx); err != nil {
			skipLocalAIBootstrap = d.recordLocalAIBootstrapFailure(fmt.Sprintf("sync managed localai assets: %v", err))
		}
	}

	var wg sync.WaitGroup
	type bootstrapFailure struct {
		kind   engine.EngineKind
		detail string
	}
	failures := make(chan bootstrapFailure, 2)
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

	if d.cfg.EngineLocalAIEnabled && !skipLocalAIBootstrap {
		bootstrap(engine.EngineLocalAI, d.cfg.EngineLocalAIVersion, d.cfg.EngineLocalAIPort,
			"NIMI_RUNTIME_LOCAL_AI_BASE_URL")
	}

	if d.cfg.EngineNexaEnabled {
		bootstrap(engine.EngineNexa, d.cfg.EngineNexaVersion, d.cfg.EngineNexaPort,
			"NIMI_RUNTIME_LOCAL_NEXA_BASE_URL")
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
				previous := d.aiHealth.Snapshot(providerName)
				d.aiHealth.Mark(providerName, false, reason)
				appendProviderHealthAudit(d.auditStore, providerName, previous, d.aiHealth.Snapshot(providerName))
			}
			appendEngineBootstrapFailureAudit(d.auditStore, string(failure.kind), providerName, failure.detail)
		}
	}
	if firstFailure != "" {
		d.state.SetStatus(health.StatusDegraded, fmt.Sprintf("engine bootstrap failed (%s)", firstFailure))
		d.grpc.SyncServingState()
	}
}

func (d *Daemon) startEngine(ctx context.Context, kind engine.EngineKind, version string, port int, envKey string) error {
	var cfg engine.EngineConfig
	switch kind {
	case engine.EngineLocalAI:
		cfg = engine.DefaultLocalAIConfig()
	case engine.EngineNexa:
		cfg = engine.DefaultNexaConfig()
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
	_ = os.Setenv(envKey, trimmed+"/v1")
	if aiSvc := d.grpc.AIService(); aiSvc != nil {
		if providerID, apiKeyEnv, ok := localProviderEnvBinding(kind); ok {
			aiSvc.SetLocalProviderEndpoint(providerID, trimmed+"/v1", os.Getenv(apiKeyEnv))
		}
	}
	d.logger.Info("engine endpoint env injected",
		"engine", kind,
		"source", source,
		"endpoint", trimmed,
		"env", envKey,
	)
}

func engineUnhealthyReasonMatches(reason string, engineName string) bool {
	normalizedEngine := strings.TrimSpace(strings.ToLower(engineName))
	if normalizedEngine == "" {
		return false
	}
	expectedPrefix := fmt.Sprintf("engine:%s unhealthy (", normalizedEngine)
	return strings.HasPrefix(strings.ToLower(strings.TrimSpace(reason)), expectedPrefix)
}

func (d *Daemon) onEngineStateChange(engineName string, status string, detail string) {
	snapshot := d.state.Snapshot()
	if snapshot.Status == health.StatusStopping || snapshot.Status == health.StatusStopped {
		return
	}
	if strings.EqualFold(strings.TrimSpace(engineName), "localai-image-backend") {
		if svc := d.grpc.LocalService(); svc != nil {
			switch strings.ToLower(strings.TrimSpace(status)) {
			case "healthy":
				svc.SetLocalAIImageBackendHealth(true, detail)
			case "unhealthy":
				svc.SetLocalAIImageBackendHealth(false, detail)
			}
		}
	}

	switch status {
	case "unhealthy":
		d.state.SetStatus(health.StatusDegraded, fmt.Sprintf("engine:%s unhealthy (%s)", engineName, detail))
		d.grpc.SyncServingState()
		appendEngineCrashAudit(d.auditStore, engineName, detail)
		if kind, ok := engineKindForName(engineName); ok {
			if providerName, ok := providerTargetNameForEngine(kind); ok {
				d.setProviderFailureHint(providerName, fmt.Sprintf("engine unhealthy (%s: %s)", engineName, detail))
			}
		}
	case "healthy":
		recoveringSameEngine := snapshot.Status == health.StatusDegraded &&
			engineUnhealthyReasonMatches(snapshot.Reason, engineName)
		if recoveringSameEngine {
			if kind, envKey, ok := engineEnvKey(engineName); ok {
				d.injectEngineEndpointEnv(kind, envKey, "recovered")
			}
		}
		if recoveringSameEngine {
			if kind, ok := engineKindForName(engineName); ok {
				if providerName, ok := providerTargetNameForEngine(kind); ok {
					d.clearProviderFailureHint(providerName)
				}
			}
		}
		if recoveringSameEngine {
			d.state.SetStatus(health.StatusReady, "ready")
			d.grpc.SyncServingState()
		}
	}
}
