package daemon

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"google.golang.org/protobuf/types/known/structpb"
)

func mustListAuditEvents(t *testing.T, store *auditlog.Store, req *runtimev1.ListAuditEventsRequest) *runtimev1.ListAuditEventsResponse {
	t.Helper()
	resp, err := store.ListEvents(req)
	if err != nil {
		t.Fatalf("ListEvents: %v", err)
	}
	return resp
}

func TestProviderTargetNameForEngineExcludesPrivateLlamaHost(t *testing.T) {
	if target, ok := engineAuditTargetName(engine.EngineLlama); ok || target != "" {
		t.Fatalf("private llama Host leaked provider target: %q, %v", target, ok)
	}
	diffusersTarget, ok := engineAuditTargetName(engineManagedImageBackend)
	if !ok || diffusersTarget != "local-image" {
		t.Fatalf("unexpected media diffusers provider target: %q, %v", diffusersTarget, ok)
	}
}

func TestProviderTargetNameForEngineIncludesSidecar(t *testing.T) {
	sidecarTarget, ok := engineAuditTargetName(engineSidecar)
	if !ok || sidecarTarget != "local-sidecar" {
		t.Fatalf("unexpected sidecar provider target: %q, %v", sidecarTarget, ok)
	}
}

func TestAppendEngineBootstrapFailureAuditIncludesImageMatrixAttribution(t *testing.T) {
	store := auditlog.New(32, 32)
	selection := &engine.ImageSupervisedMatrixSelection{Entry: &engine.ImageSupervisedMatrixEntry{
		EntryID: "linux-x64-nvidia-safetensors-native", BackendFamily: engine.ImageBackendFamilyStableDiffusionGGML,
		BackendClass: engine.ImageBackendClassNativeBinary, ProductState: engine.ImageProductStateUnsupported,
	}}
	appendEngineBootstrapFailureAudit(store, "media", "local-media", "bootstrap failed", selection)
	payload := mustSingleRuntimeEngineAuditPayload(t, store)
	assertImageMatrixAuditPayload(t, payload)
}

func TestAppendRepairResolvedAuditIncludesImageMatrixAttribution(t *testing.T) {
	store := auditlog.New(32, 32)
	selection := &engine.ImageSupervisedMatrixSelection{Entry: &engine.ImageSupervisedMatrixEntry{
		EntryID: "linux-x64-nvidia-safetensors-native", BackendFamily: engine.ImageBackendFamilyStableDiffusionGGML,
		BackendClass: engine.ImageBackendClassNativeBinary, ProductState: engine.ImageProductStateUnsupported,
	}}
	appendRepairResolvedAudit(store, "media", "recovered", selection)
	payload := mustSingleRuntimeEngineAuditPayload(t, store)
	assertImageMatrixAuditPayload(t, payload)
}

func mustSingleRuntimeEngineAuditPayload(t *testing.T, store *auditlog.Store) map[string]*structpb.Value {
	t.Helper()
	resp := mustListAuditEvents(t, store, &runtimev1.ListAuditEventsRequest{Domain: "runtime.engine"})
	if len(resp.GetEvents()) != 1 {
		t.Fatalf("expected 1 runtime.engine event, got=%d", len(resp.GetEvents()))
	}
	return resp.GetEvents()[0].GetPayload().GetFields()
}

func assertImageMatrixAuditPayload(t *testing.T, payload map[string]*structpb.Value) {
	t.Helper()
	if payload["entry_id"].GetStringValue() != "linux-x64-nvidia-safetensors-native" {
		t.Fatalf("unexpected entry_id: %q", payload["entry_id"].GetStringValue())
	}
	if payload["backend_family"].GetStringValue() != string(engine.ImageBackendFamilyStableDiffusionGGML) {
		t.Fatalf("unexpected backend_family: %q", payload["backend_family"].GetStringValue())
	}
	if payload["backend_class"].GetStringValue() != string(engine.ImageBackendClassNativeBinary) {
		t.Fatalf("unexpected backend_class: %q", payload["backend_class"].GetStringValue())
	}
	if payload["product_state"].GetStringValue() != string(engine.ImageProductStateUnsupported) {
		t.Fatalf("unexpected product_state: %q", payload["product_state"].GetStringValue())
	}
}
