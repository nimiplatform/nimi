package localservice

import (
	"context"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestLegacyLlamaLeaseActivationFailsClosed(t *testing.T) {
	const localAssetID = "asset-main"
	svc := &Service{assetRuntimeModes: map[string]runtimev1.LocalEngineRuntimeMode{
		localAssetID: runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED,
	}}
	model := &runtimev1.LocalAssetRecord{
		LocalAssetId: localAssetID,
		Engine:       "llama",
		Entry:        "main.gguf",
	}
	got, err := svc.rejectLlamaLocalAssetResidency(context.Background(), model, "legacy-lease")
	if got != nil || err == nil {
		t.Fatalf("legacy llama residency = %+v, %v; want fail closed", got, err)
	}
	if !strings.Contains(err.Error(), "Capability Configuration") {
		t.Fatalf("error = %v", err)
	}
}

func TestRetiredLlamaResidencyLeavesUnrelatedAssetsAlone(t *testing.T) {
	svc := &Service{assetRuntimeModes: map[string]runtimev1.LocalEngineRuntimeMode{}}
	model := &runtimev1.LocalAssetRecord{LocalAssetId: "image", Engine: "media", Entry: "image.gguf"}
	got, err := svc.rejectLlamaLocalAssetResidency(context.Background(), model, "image-lease")
	if err != nil || got != model {
		t.Fatalf("unrelated residency = %+v, %v", got, err)
	}
}
