package localservice

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestResolveManagedLlamaDurableTargetByCapabilitiesReturnsScenarioIdentity(t *testing.T) {
	svc := newTestService(t)
	asset := addManagedLlamaAssetForTest(
		t,
		svc,
		"asset_alpha",
		"local/alpha-model",
		"nimi/alpha-model",
		"alpha.gguf",
		runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
		runtimev1.LocalWarmState_LOCAL_WARM_STATE_COLD,
	)

	providerModelID, ok := svc.ResolveManagedLlamaModelByCapabilities(asset.GetLocalAssetId(), "text.generate")
	if !ok || providerModelID == "" {
		t.Fatal("expected provider-facing managed llama registration")
	}
	logicalModelID, target, ok := svc.ResolveManagedLlamaDurableTargetByCapabilities(providerModelID, "text.generate")
	if !ok || target == nil {
		t.Fatal("expected Runtime-owned durable target")
	}
	if logicalModelID != asset.GetLogicalModelId() {
		t.Fatalf("logical model id = %q, want %q", logicalModelID, asset.GetLogicalModelId())
	}
	if target.GetVersion() != "v2" || target.GetReadinessRef() == "" || target.GetProfileBindingId() != "" {
		t.Fatalf("unexpected durable target: %#v", target)
	}
	binding, resolvedAsset, err := svc.ResolveDurableLocalTarget(context.Background(), target, "text.generate")
	if err != nil {
		t.Fatalf("ResolveDurableLocalTarget: %v", err)
	}
	if binding.GetResolvedModelId() != logicalModelID || resolvedAsset.GetLocalAssetId() != asset.GetLocalAssetId() {
		t.Fatalf("durable target resolved to unexpected asset: binding=%#v asset=%#v", binding, resolvedAsset)
	}
}

func TestResolveManagedLlamaDurableTargetByCapabilitiesRejectsUnknownPreferredModel(t *testing.T) {
	svc := newTestService(t)
	addManagedLlamaAssetForTest(
		t,
		svc,
		"asset_alpha",
		"local/alpha-model",
		"nimi/alpha-model",
		"alpha.gguf",
		runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
		runtimev1.LocalWarmState_LOCAL_WARM_STATE_COLD,
	)

	if modelID, target, ok := svc.ResolveManagedLlamaDurableTargetByCapabilities("unknown-model", "text.generate"); ok || modelID != "" || target != nil {
		t.Fatalf("unknown preferred model must fail closed: model=%q target=%#v ok=%v", modelID, target, ok)
	}
}

func TestResolveManagedLlamaDurableTargetByCapabilitiesUsesStableRunnableOrdering(t *testing.T) {
	t.Run("active before installed", func(t *testing.T) {
		svc := newTestService(t)
		addManagedLlamaAssetForTest(
			t,
			svc,
			"asset_alpha",
			"local/alpha-model",
			"nimi/alpha-model",
			"alpha.gguf",
			runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
			runtimev1.LocalWarmState_LOCAL_WARM_STATE_COLD,
		)
		active := addManagedLlamaAssetForTest(
			t,
			svc,
			"asset_zeta",
			"local/zeta-model",
			"nimi/zeta-model",
			"zeta.gguf",
			runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
			runtimev1.LocalWarmState_LOCAL_WARM_STATE_READY,
		)

		logicalModelID, _, ok := svc.ResolveManagedLlamaDurableTargetByCapabilities("", "text.generate")
		if !ok || logicalModelID != active.GetLogicalModelId() {
			t.Fatalf("resolved model = %q ok=%v, want active %q", logicalModelID, ok, active.GetLogicalModelId())
		}
	})

	t.Run("stable asset identity within status", func(t *testing.T) {
		svc := newTestService(t)
		addManagedLlamaAssetForTest(
			t,
			svc,
			"asset_gemma",
			"local-import/gemma-4-26B-A4B-it-Q8_0",
			"nimi/gemma-large",
			"gemma.gguf",
			runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY,
			runtimev1.LocalWarmState_LOCAL_WARM_STATE_FAILED,
		)
		qwen := addManagedLlamaAssetForTest(
			t,
			svc,
			"asset_qwen",
			"local-import/Qwen3-4B-Q4_K_M",
			"nimi/qwen-small",
			"qwen.gguf",
			runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY,
			runtimev1.LocalWarmState_LOCAL_WARM_STATE_FAILED,
		)

		logicalModelID, _, ok := svc.ResolveManagedLlamaDurableTargetByCapabilities("", "text.generate")
		if !ok || logicalModelID != qwen.GetLogicalModelId() {
			t.Fatalf("resolved model = %q ok=%v, want stable first asset %q", logicalModelID, ok, qwen.GetLogicalModelId())
		}
	})
}
