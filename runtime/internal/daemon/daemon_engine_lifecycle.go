package daemon

import (
	"context"
	"fmt"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"github.com/nimiplatform/nimi/runtime/internal/health"
)

func (d *Daemon) startEngine(ctx context.Context, kind engine.EngineKind, version string, port int, envKey string) error {
	var cfg engine.EngineConfig
	switch kind {
	case engine.EngineLlama:
		cfg = engine.DefaultLlamaConfig()
	case engine.EngineMedia:
		cfg = engine.DefaultMediaConfig()
	case engine.EngineSpeech:
		cfg = engine.DefaultSpeechConfig()
		cfg.ModelsPath = d.cfg.LocalModelsPath
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
	if kind == engine.EngineMedia {
		cfg.MediaMode = engine.MediaModePipelineSupervised
		if d.resolvedImageMatrix != nil {
			selection := *d.resolvedImageMatrix
			if resolvedMode, err := engine.MediaModeFromSelection(selection); err == nil {
				cfg.MediaMode = resolvedMode
				cfg.ImageSupervisedSelection = &selection
			}
		}
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
	resolved := trimmed + "/v1"
	if err := runtimeSetenv(envKey, resolved); err != nil {
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
			aiSvc.SetLocalProviderEndpoint(providerID, resolved, runtimeGetenv(apiKeyEnv))
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
	if strings.EqualFold(strings.TrimSpace(engineName), string(engineManagedImageBackend)) {
		normalizedStatus := strings.ToLower(strings.TrimSpace(status))
		if svc := d.grpc.LocalService(); svc != nil {
			switch normalizedStatus {
			case "healthy":
				svc.SetManagedImageBackendHealth(true, detail)
			case "unhealthy":
				svc.SetManagedImageBackendHealth(false, detail)
			}
		}
		if d.aiHealth != nil && (normalizedStatus == "healthy" || normalizedStatus == "unhealthy") {
			previous := d.aiHealth.SnapshotOf(localImageProviderHealthKey)
			if err := d.aiHealth.Mark(localImageProviderHealthKey, normalizedStatus == "healthy", detail); err == nil {
				appendProviderHealthAudit(d.auditStore, localImageProviderHealthKey, previous, d.aiHealth.SnapshotOf(localImageProviderHealthKey))
			}
		}
	}
	switch status {
	case "unhealthy":
		d.setDegradedStatus(fmt.Sprintf("engine:%s unhealthy (%s)", engineName, detail))
		reasonKey := resolveInternalReasonKey(detail)
		appendEngineCrashAudit(d.auditStore, engineName, detail, d.resolvedImageMatrix, reasonKey)
		if kind, ok := engineKindForName(engineName); ok {
			if providerName, ok := providerTargetNameForEngine(kind); ok {
				hint := fmt.Sprintf("engine unhealthy (%s: %s)", engineName, detail)
				if attr := imageAttributionDetail(d.resolvedImageMatrix); attr != "" && isImageRelatedEngine(kind) {
					hint = fmt.Sprintf("%s [%s internal_reason_key=%s]", hint, attr, reasonKey)
				}
				d.setProviderFailureHint(providerName, hint)
			}
		}
	case "healthy":
		recoveringSameEngine := snapshot.Status == health.StatusDegraded &&
			engineUnhealthyReasonMatches(snapshot.Reason, engineName)
		if !recoveringSameEngine {
			return
		}
		if kind, ok := engineKindForName(engineName); ok {
			if isImageRelatedEngine(kind) {
				appendRepairResolvedAudit(d.auditStore, engineName, detail, d.resolvedImageMatrix)
			}
		}
		if kind, envKey, ok := engineEnvKey(engineName); ok {
			d.injectEngineEndpointEnv(kind, envKey, "recovered")
		}
		if svc := d.grpc.LocalService(); svc != nil {
			svc.MarkManagedEngineUsed(engineName, "engine_recovered")
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
