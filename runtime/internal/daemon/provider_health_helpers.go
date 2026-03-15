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
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func engineEnvKey(engineName string) (engine.EngineKind, string, bool) {
	switch strings.TrimSpace(strings.ToLower(engineName)) {
	case string(engine.EngineLocalAI):
		return engine.EngineLocalAI, "NIMI_RUNTIME_LOCAL_AI_BASE_URL", true
	case string(engine.EngineNexa):
		return engine.EngineNexa, "NIMI_RUNTIME_LOCAL_NEXA_BASE_URL", true
	case string(engine.EngineNimiMedia):
		return engine.EngineNimiMedia, "NIMI_RUNTIME_LOCAL_NIMI_MEDIA_BASE_URL", true
	default:
		return "", "", false
	}
}

func providerTargetNameForEngine(kind engine.EngineKind) (string, bool) {
	switch kind {
	case engine.EngineLocalAI:
		return "local", true
	case engine.EngineKind("localai-image-backend"):
		return "local", true
	case engine.EngineNexa:
		return "local-nexa", true
	case engine.EngineNimiMedia:
		return "local-nimi-media", true
	default:
		return "", false
	}
}

func localProviderEnvBinding(kind engine.EngineKind) (string, string, bool) {
	switch kind {
	case engine.EngineLocalAI:
		return "localai", "NIMI_RUNTIME_LOCAL_AI_API_KEY", true
	case engine.EngineNexa:
		return "nexa", "NIMI_RUNTIME_LOCAL_NEXA_API_KEY", true
	case engine.EngineNimiMedia:
		return "nimi_media", "NIMI_RUNTIME_LOCAL_NIMI_MEDIA_API_KEY", true
	default:
		return "", "", false
	}
}

func engineKindForName(engineName string) (engine.EngineKind, bool) {
	switch strings.TrimSpace(strings.ToLower(engineName)) {
	case string(engine.EngineLocalAI):
		return engine.EngineLocalAI, true
	case string(engine.EngineNexa):
		return engine.EngineNexa, true
	case string(engine.EngineNimiMedia):
		return engine.EngineNimiMedia, true
	case "localai-image-backend":
		return engine.EngineKind("localai-image-backend"), true
	default:
		return "", false
	}
}

func cloneStringMap(input map[string]string) map[string]string {
	if len(input) == 0 {
		return nil
	}
	cloned := make(map[string]string, len(input))
	for key, value := range input {
		cloned[key] = value
	}
	return cloned
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
