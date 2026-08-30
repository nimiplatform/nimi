package daemon

import (
	"fmt"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"github.com/nimiplatform/nimi/runtime/internal/health"
)

func llamaExecutionHostConfig(cfg config.Config) (engine.EngineConfig, bool) {
	if !cfg.EngineLlamaEnabled {
		return engine.EngineConfig{}, false
	}
	resolved := engine.DefaultLlamaConfig()
	resolved.Version = strings.TrimSpace(cfg.EngineLlamaVersion)
	resolved.Port = cfg.EngineLlamaPort
	return resolved, true
}

func (d *Daemon) onEngineStateChange(engineName string, status string, detail string) {
	if strings.EqualFold(strings.TrimSpace(engineName), string(engine.EngineLlama)) {
		// llama execution health belongs to the exact job and must never become
		// ambient Runtime readiness or provider routing truth.
		return
	}
	snapshot := d.state.Snapshot()
	if snapshot.Status == health.StatusStopping || snapshot.Status == health.StatusStopped {
		return
	}
	switch status {
	case "unhealthy":
		d.setDegradedStatus(fmt.Sprintf("engine:%s unhealthy (%s)", engineName, detail))
		reasonKey := resolveInternalReasonKey(detail)
		appendEngineCrashAudit(d.auditStore, engineName, detail, nil, reasonKey)
	case "healthy":
		recoveringSameEngine := snapshot.Status == health.StatusDegraded &&
			engineUnhealthyReasonMatches(snapshot.Reason, engineName)
		if !recoveringSameEngine {
			return
		}
		if kind, ok := engineKindForName(engineName); ok {
			if isImageRelatedEngine(kind) {
				appendRepairResolvedAudit(d.auditStore, engineName, detail, nil)
			}
		}
		if remaining, ok := d.firstReadinessBlockingUnhealthyEngine(); ok {
			d.transitionToDegraded(fmt.Sprintf("engine:%s unhealthy (%s)", remaining.Kind, remaining.Detail))
			return
		}
		d.state.SetStatus(health.StatusReady, "ready")
		d.grpc.SyncServingState()
	}
}

func (d *Daemon) firstReadinessBlockingUnhealthyEngine() (engine.SupervisorInfo, bool) {
	if d.engineMgr == nil {
		return engine.SupervisorInfo{}, false
	}
	for _, info := range d.engineMgr.UnhealthyEngines() {
		// llama.cpp is a capability-scoped private execution Host. Its exact Job
		// health never contributes ambient Runtime readiness.
		if info.Kind == engine.EngineLlama {
			continue
		}
		return info, true
	}
	return engine.SupervisorInfo{}, false
}
