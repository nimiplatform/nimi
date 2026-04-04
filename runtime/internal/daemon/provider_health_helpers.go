package daemon

import (
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"github.com/nimiplatform/nimi/runtime/internal/providerhealth"
	"github.com/oklog/ulid/v2"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func engineEnvKey(engineName string) (engine.EngineKind, string, bool) {
	switch strings.TrimSpace(strings.ToLower(engineName)) {
	case string(engine.EngineLlama):
		return engine.EngineLlama, "NIMI_RUNTIME_LOCAL_LLAMA_BASE_URL", true
	case string(engine.EngineMedia):
		return engine.EngineMedia, "NIMI_RUNTIME_LOCAL_MEDIA_BASE_URL", true
	case string(engine.EngineSpeech):
		return engine.EngineSpeech, "NIMI_RUNTIME_LOCAL_SPEECH_BASE_URL", true
	default:
		return "", "", false
	}
}

func providerTargetNameForEngine(kind engine.EngineKind) (string, bool) {
	switch kind {
	case engine.EngineLlama:
		return "local", true
	case engineManagedImageBackend:
		return "local-image", true
	case engine.EngineMedia:
		return "local-media", true
	case engine.EngineSpeech:
		return "local-speech", true
	case engineSidecar:
		return "local-sidecar", true
	default:
		return "", false
	}
}

func localProviderEnvBinding(kind engine.EngineKind) (string, string, bool) {
	switch kind {
	case engine.EngineLlama:
		return "llama", "NIMI_RUNTIME_LOCAL_LLAMA_API_KEY", true
	case engine.EngineMedia:
		return "media", "NIMI_RUNTIME_LOCAL_MEDIA_API_KEY", true
	case engine.EngineSpeech:
		return "speech", "NIMI_RUNTIME_LOCAL_SPEECH_API_KEY", true
	case engineSidecar:
		return "sidecar", "NIMI_RUNTIME_LOCAL_SIDECAR_API_KEY", true
	default:
		return "", "", false
	}
}

func engineKindForName(engineName string) (engine.EngineKind, bool) {
	switch strings.TrimSpace(strings.ToLower(engineName)) {
	case string(engine.EngineLlama):
		return engine.EngineLlama, true
	case string(engine.EngineMedia):
		return engine.EngineMedia, true
	case string(engine.EngineSpeech):
		return engine.EngineSpeech, true
	case string(engineManagedImageBackend):
		return engineManagedImageBackend, true
	case string(engineSidecar):
		return engineSidecar, true
	default:
		return "", false
	}
}

func (d *Daemon) setProviderFailureHint(providerName string, hint string) {
	key := strings.TrimSpace(strings.ToLower(providerName))
	value := strings.TrimSpace(hint)
	if key == "" || value == "" {
		return
	}
	d.providerFailureHintMu.Lock()
	if d.providerFailureHints == nil {
		d.providerFailureHints = map[string]string{}
	}
	d.providerFailureHints[key] = value
	d.providerFailureHintMu.Unlock()
}

func (d *Daemon) clearProviderFailureHint(providerName string) {
	key := strings.TrimSpace(strings.ToLower(providerName))
	if key == "" {
		return
	}
	d.providerFailureHintMu.Lock()
	delete(d.providerFailureHints, key)
	d.providerFailureHintMu.Unlock()
}

func (d *Daemon) providerFailureHint(providerName string) string {
	key := strings.TrimSpace(strings.ToLower(providerName))
	if key == "" {
		return ""
	}
	d.providerFailureHintMu.RLock()
	value := strings.TrimSpace(d.providerFailureHints[key])
	d.providerFailureHintMu.RUnlock()
	return value
}

func (d *Daemon) decorateProviderProbeError(providerName string, probeErr error) error {
	if probeErr == nil {
		return nil
	}
	hint := d.providerFailureHint(providerName)
	if hint == "" {
		return probeErr
	}
	return fmt.Errorf("%s; probe error: %w", hint, probeErr)
}

// isImageRelatedEngine returns true for engine kinds that participate in the
// image supervised matrix (K-PROV-002).
func isImageRelatedEngine(kind engine.EngineKind) bool {
	return kind == engine.EngineMedia || kind == engineManagedImageBackend
}

// imageAttributionDetail formats v2 resolver fields into a structured string
// for provider failure hints and audit detail (K-PROV-002 line 68).
func imageAttributionDetail(sel *engine.ImageSupervisedMatrixSelection) string {
	if sel == nil || sel.Entry == nil {
		return ""
	}
	e := sel.Entry
	return fmt.Sprintf(
		"entry_id=%s backend_family=%s backend_class=%s product_state=%s control_plane=%s execution_plane=%s",
		e.EntryID,
		e.BackendFamily,
		e.BackendClass,
		e.ProductState,
		e.ControlPlane,
		e.ExecutionPlane,
	)
}

// resolveInternalReasonKey maps an engine state detail to an internal_reason_key
// per K-LENG-017.
func resolveInternalReasonKey(detail string) string {
	d := strings.ToLower(strings.TrimSpace(detail))
	switch {
	case strings.Contains(d, "python version"):
		return "python_version_incompatible"
	case strings.Contains(d, "venv") || strings.Contains(d, "interpreter"):
		return "python_runtime_broken"
	case strings.Contains(d, "dependency") || strings.Contains(d, "pip install") || strings.Contains(d, "wheel"):
		return "python_dependency_install_failed"
	case strings.Contains(d, "pipeline load timeout") || strings.Contains(d, "pipeline_load_timeout"):
		return "pipeline_load_timeout"
	case strings.Contains(d, "bootstrap") || strings.Contains(d, "startup"):
		return "bootstrap_failure"
	case strings.Contains(d, "plane") && strings.Contains(d, "not ready"):
		return "plane_not_ready"
	case strings.Contains(d, "manifest") || strings.Contains(d, "completeness"):
		return "manifest_completeness_failure"
	case strings.Contains(d, "catalog") && strings.Contains(d, "identity"):
		return "catalog_identity_mismatch"
	default:
		return "execution_failure"
	}
}

// appendRepairResolvedAudit emits an audit event when an image-related engine
// recovers from unhealthy, per K-LENG-017 line 305.
func appendRepairResolvedAudit(store *auditlog.Store, engineName string, detail string, sel *engine.ImageSupervisedMatrixSelection) {
	if store == nil {
		return
	}
	now := time.Now().UTC()
	payloadMap := map[string]any{
		"engine":         engineName,
		"detail":         detail,
		"resolve_reason": "engine_recovered_from_unhealthy",
		"trigger":        "onEngineStateChange",
		"resolved_at":    now.Format(time.RFC3339Nano),
	}
	if sel != nil && sel.Entry != nil {
		payloadMap["old_entry_id"] = sel.Entry.EntryID
		payloadMap["entry_id"] = sel.Entry.EntryID
		payloadMap["backend_family"] = string(sel.Entry.BackendFamily)
		payloadMap["backend_class"] = string(sel.Entry.BackendClass)
		payloadMap["product_state"] = string(sel.Entry.ProductState)
	}
	store.AppendEvent(&runtimev1.AuditEventRecord{
		AuditId:    ulid.Make().String(),
		Domain:     "runtime.engine",
		Operation:  "engine.repair_resolved",
		ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		TraceId:    ulid.Make().String(),
		Timestamp:  timestamppb.New(now),
		Payload:    auditPayloadStruct(payloadMap),
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
	payload := auditPayloadStruct(map[string]any{
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
