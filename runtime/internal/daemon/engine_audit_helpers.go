package daemon

import (
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"github.com/oklog/ulid/v2"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const localImageEngineAuditKey = "local-image"

func engineEnvKey(engineName string) (engine.EngineKind, string, bool) {
	switch strings.TrimSpace(strings.ToLower(engineName)) {
	case string(engine.EngineMedia):
		return engine.EngineMedia, "NIMI_RUNTIME_LOCAL_MEDIA_BASE_URL", true
	case string(engine.EngineSpeech):
		return engine.EngineSpeech, "NIMI_RUNTIME_LOCAL_SPEECH_BASE_URL", true
	default:
		return "", "", false
	}
}

func engineAuditTargetName(kind engine.EngineKind) (string, bool) {
	switch kind {
	case engineManagedImageBackend:
		return localImageEngineAuditKey, true
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

func engineKindForName(engineName string) (engine.EngineKind, bool) {
	switch strings.TrimSpace(strings.ToLower(engineName)) {
	case string(engine.EngineMedia):
		return engine.EngineMedia, true
	case string(engine.EngineSpeech):
		return engine.EngineSpeech, true
	case "media-diffusers-backend":
		return engineManagedImageBackend, true
	case string(engineManagedImageBackend):
		return engineManagedImageBackend, true
	case string(engineSidecar):
		return engineSidecar, true
	default:
		return "", false
	}
}

// isImageRelatedEngine returns true for engine kinds that participate in the
// image supervised matrix (K-PROV-002).
func isImageRelatedEngine(kind engine.EngineKind) bool {
	return kind == engine.EngineMedia || kind == engineManagedImageBackend
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
