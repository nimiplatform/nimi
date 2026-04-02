package daemon

import (
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"github.com/oklog/ulid/v2"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

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

func appendEngineCrashAudit(store *auditlog.Store, engineName string, detail string, sel *engine.ImageSupervisedMatrixSelection, reasonKey string) {
	if store == nil {
		return
	}
	attempt, maxAttempt, exitCode := parseEngineCrashDetail(detail)
	now := time.Now().UTC()
	payloadMap := map[string]any{
		"engine":              engineName,
		"detail":              detail,
		"attempt":             attempt,
		"max_attempt":         maxAttempt,
		"exit_code":           exitCode,
		"internal_reason_key": reasonKey,
	}
	if sel != nil && sel.Entry != nil {
		payloadMap["entry_id"] = sel.Entry.EntryID
		payloadMap["backend_family"] = string(sel.Entry.BackendFamily)
		payloadMap["backend_class"] = string(sel.Entry.BackendClass)
		payloadMap["product_state"] = string(sel.Entry.ProductState)
	}
	payload := auditPayloadStruct(payloadMap)
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
