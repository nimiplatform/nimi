package daemon

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"runtime"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/grpcserver"
	"github.com/nimiplatform/nimi/runtime/internal/health"
	"github.com/nimiplatform/nimi/runtime/internal/httpserver"
	"github.com/nimiplatform/nimi/runtime/internal/providerhealth"
	"github.com/nimiplatform/nimi/runtime/internal/workers"
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
	workers    *workers.Supervisor
}

var runtimeWorkerNames = []string{"ai", "model", "workflow", "script", "localruntime"}

func New(cfg config.Config, logger *slog.Logger, version string) *Daemon {
	if value := strings.TrimSpace(cfg.LocalRuntimeStatePath); value != "" {
		_ = os.Setenv("NIMI_RUNTIME_LOCAL_RUNTIME_STATE_PATH", value)
	}
	state := health.NewState()
	return &Daemon{
		cfg:        cfg,
		logger:     logger,
		state:      state,
		grpc:       grpcserver.New(cfg, state, logger, version),
		http:       httpserver.New(cfg.HTTPAddr, state, logger),
		aiHealth:   nil,
		auditStore: nil,
	}
}

func (d *Daemon) Run(ctx context.Context) error {
	d.aiHealth = d.grpc.AIHealthTracker()
	d.auditStore = d.grpc.AuditStore()
	d.http.SetAIHealthTracker(d.aiHealth)
	d.state.SetStatus(health.StatusStarting, "booting")
	d.grpc.SyncServingState()

	workerCtx, stopWorkers := context.WithCancel(context.Background())
	defer stopWorkers()
	if d.cfg.WorkerMode {
		d.workers = workers.New(d.logger, "", d.onWorkerStateChange)
		if err := d.workers.Start(workerCtx, runtimeWorkerNames); err != nil {
			d.logger.Error("start worker supervisor failed", "error", err)
			reason := fmt.Sprintf("worker:supervisor start failed (%v)", err)
			d.state.SetStatus(health.StatusStopped, reason)
			d.grpc.SyncServingState()
			appendStartupFailureAudit(d.auditStore, reason)
			return fmt.Errorf("startup failed: %w", err)
		}
	}

	samplerStop := make(chan struct{})
	go d.sampleRuntimeResource(samplerStop)

	errCh := make(chan error, 2)
	go func() {
		errCh <- d.grpc.Serve()
	}()
	go func() {
		errCh <- d.http.Serve()
	}()

	d.state.SetStatus(health.StatusReady, "ready")
	d.grpc.SyncServingState()
	d.logger.Info("runtime ready", "grpc_addr", d.cfg.GRPCAddr, "http_addr", d.cfg.HTTPAddr)

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

	stopWorkers()
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

func (d *Daemon) onWorkerStateChange(name string, running bool, err error) {
	snapshot := d.state.Snapshot()
	if snapshot.Status == health.StatusStopping || snapshot.Status == health.StatusStopped {
		return
	}
	if !running {
		d.state.SetStatus(health.StatusDegraded, fmt.Sprintf("worker:%s unavailable (%v)", name, err))
		d.grpc.SyncServingState()
		return
	}
	if d.workers != nil && d.workers.AllRunning(runtimeWorkerNames) {
		current := d.state.Snapshot()
		if current.Status == health.StatusDegraded && strings.HasPrefix(current.Reason, "worker:") {
			d.state.SetStatus(health.StatusReady, "ready")
			d.grpc.SyncServingState()
		}
	}
}

func (d *Daemon) shutdown() error {
	d.state.SetStatus(health.StatusStopping, "shutting down")
	d.grpc.SyncServingState()

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
	add("cloud-nimillm", os.Getenv("NIMI_RUNTIME_CLOUD_NIMILLM_BASE_URL"), os.Getenv("NIMI_RUNTIME_CLOUD_NIMILLM_API_KEY"))
	add("cloud-alibaba", os.Getenv("NIMI_RUNTIME_CLOUD_ADAPTER_ALIBABA_BASE_URL"), os.Getenv("NIMI_RUNTIME_CLOUD_ADAPTER_ALIBABA_API_KEY"))
	add("cloud-bytedance", os.Getenv("NIMI_RUNTIME_CLOUD_ADAPTER_BYTEDANCE_BASE_URL"), os.Getenv("NIMI_RUNTIME_CLOUD_ADAPTER_BYTEDANCE_API_KEY"))
	add("cloud-bytedance-openspeech", os.Getenv("NIMI_RUNTIME_CLOUD_ADAPTER_BYTEDANCE_OPENSPEECH_BASE_URL"), os.Getenv("NIMI_RUNTIME_CLOUD_ADAPTER_BYTEDANCE_OPENSPEECH_API_KEY"))
	add("cloud-gemini", os.Getenv("NIMI_RUNTIME_CLOUD_ADAPTER_GEMINI_BASE_URL"), os.Getenv("NIMI_RUNTIME_CLOUD_ADAPTER_GEMINI_API_KEY"))
	add("cloud-minimax", os.Getenv("NIMI_RUNTIME_CLOUD_ADAPTER_MINIMAX_BASE_URL"), os.Getenv("NIMI_RUNTIME_CLOUD_ADAPTER_MINIMAX_API_KEY"))
	add("cloud-kimi", os.Getenv("NIMI_RUNTIME_CLOUD_ADAPTER_KIMI_BASE_URL"), os.Getenv("NIMI_RUNTIME_CLOUD_ADAPTER_KIMI_API_KEY"))
	add("cloud-glm", os.Getenv("NIMI_RUNTIME_CLOUD_ADAPTER_GLM_BASE_URL"), os.Getenv("NIMI_RUNTIME_CLOUD_ADAPTER_GLM_API_KEY"))
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
		endpoint := target.Base + path
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

func appendProviderHealthAudit(store *auditlog.Store, providerName string, before providerhealth.Snapshot, after providerhealth.Snapshot) {
	if store == nil || before.State == after.State {
		return
	}
	now := time.Now().UTC()
	reasonCode := runtimev1.ReasonCode_ACTION_EXECUTED
	if after.State == providerhealth.StateUnhealthy {
		reasonCode = runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE
	}
	payload, _ := structpb.NewStruct(map[string]any{
		"providerName": strings.TrimSpace(providerName),
		"previous": map[string]any{
			"state":               string(before.State),
			"reason":              before.LastReason,
			"consecutiveFailures": before.ConsecutiveFailures,
			"lastCheckedAt":       before.LastCheckedAt.Format(time.RFC3339Nano),
		},
		"current": map[string]any{
			"state":               string(after.State),
			"reason":              after.LastReason,
			"consecutiveFailures": after.ConsecutiveFailures,
			"lastCheckedAt":       after.LastCheckedAt.Format(time.RFC3339Nano),
		},
	})
	store.AppendEvent(&runtimev1.AuditEventRecord{
		AuditId:    ulid.Make().String(),
		Domain:     "runtime.ai",
		Operation:  "provider.health",
		ReasonCode: reasonCode,
		TraceId:    ulid.Make().String(),
		Timestamp:  timestamppb.New(now),
		Payload:    payload,
		CallerKind: runtimev1.CallerKind_CALLER_KIND_DESKTOP_CORE,
		CallerId:   "runtime-daemon",
		SurfaceId:  "daemon",
	})
}
