package localservice

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	catalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
)

const testGiB = int64(1) << 30

// recommendedImageCUDAProfile is a capable CUDA host: enough RAM for the
// required recommended slots and enough VRAM for the image tier.
func recommendedImageCUDAProfile() *runtimev1.LocalDeviceProfile {
	return &runtimev1.LocalDeviceProfile{
		Os:            "linux",
		Arch:          "amd64",
		TotalRamBytes: 64 * testGiB,
		Gpu: &runtimev1.LocalGpuProfile{
			Available:      true,
			Vendor:         "NVIDIA",
			TotalVramBytes: 24 * testGiB,
			MemoryModel:    runtimev1.GpuMemoryModel_GPU_MEMORY_MODEL_DISCRETE,
		},
		Python: &runtimev1.LocalPythonProfile{Available: true, Version: "3.12.0"},
	}
}

// recommendedImageCPUOnlyProfile is a capable-but-GPU-less host: the required
// recommended slots resolve, the host_conditional image slot is omitted.
func recommendedImageCPUOnlyProfile() *runtimev1.LocalDeviceProfile {
	return &runtimev1.LocalDeviceProfile{
		Os:            "linux",
		Arch:          "amd64",
		TotalRamBytes: 64 * testGiB,
		Gpu:           &runtimev1.LocalGpuProfile{Available: false},
		Python:        &runtimev1.LocalPythonProfile{Available: true, Version: "3.12.0"},
	}
}

// TestResolveRecommendedImageConsumerResolvesCompanionBindingsOnCudaHost
// verifies the K-LENV seam projects the resolved image slot + companions into
// activation requests: a main model.asset binding plus one
// model.companion-asset binding per companion, each carrying a non-empty
// parent_asset_id (design/04 seam).
func TestResolveRecommendedImageConsumerResolvesCompanionBindingsOnCudaHost(t *testing.T) {
	svc := newTestService(t)
	resolution := svc.resolveRecommendedImageConsumer(recommendedImageCUDAProfile())
	if resolution.State != recommendedImageStateResolved {
		t.Fatalf("expected resolved, got state=%q reason=%q detail=%q", resolution.State, resolution.ReasonCode, resolution.Detail)
	}
	if resolution.ConsumerID != stableDiffusionCUDAConsumerID {
		t.Fatalf("expected the cuda image consumer on a CUDA host, got %q", resolution.ConsumerID)
	}
	// main image asset binding + vae companion + text-encoder companion = 3.
	if len(resolution.Bindings) != 3 {
		t.Fatalf("expected 3 image consumer bindings (main + 2 companions), got %d", len(resolution.Bindings))
	}
	main := resolution.Bindings[0]
	if main.AssetID == "" {
		t.Fatal("main image binding must carry a non-empty AssetID")
	}
	if main.CompanionAssetID != "" || main.ParentAssetID != "" {
		t.Fatalf("main image binding must not carry companion fields, got companion=%q parent=%q", main.CompanionAssetID, main.ParentAssetID)
	}
	slots := map[string]recommendedImageConsumerBinding{}
	for _, binding := range resolution.Bindings[1:] {
		if binding.ConsumerID != resolution.ConsumerID {
			t.Fatalf("companion binding consumer %q != image consumer %q", binding.ConsumerID, resolution.ConsumerID)
		}
		if binding.CompanionAssetID == "" {
			t.Fatalf("companion binding %q must carry a non-empty CompanionAssetID", binding.EngineSlot)
		}
		if binding.ParentAssetID != main.AssetID {
			t.Fatalf("companion %q parent_asset_id %q must equal the main image asset id %q", binding.EngineSlot, binding.ParentAssetID, main.AssetID)
		}
		slots[binding.EngineSlot] = binding
	}
	if vae, ok := slots["vae_path"]; !ok || vae.CompanionKind != "vae" {
		t.Fatalf("expected a vae companion binding on engine_slot vae_path, got %+v", slots)
	}
	if textEnc, ok := slots["llm_path"]; !ok || textEnc.CompanionKind != "auxiliary" {
		t.Fatalf("expected an auxiliary text-encoder binding on engine_slot llm_path, got %+v", slots)
	}
}

// TestResolveRecommendedImageConsumerOmittedOnCpuOnlyHost verifies the K-LENV
// seam reports state=omitted (not fail-close) on a GPU-less host: the optional
// image slot is dropped, the required slots are unaffected (K-MCAT-036).
func TestResolveRecommendedImageConsumerOmittedOnCpuOnlyHost(t *testing.T) {
	svc := newTestService(t)
	resolution := svc.resolveRecommendedImageConsumer(recommendedImageCPUOnlyProfile())
	if resolution.State != recommendedImageStateOmitted {
		t.Fatalf("expected omitted on a GPU-less host, got state=%q detail=%q", resolution.State, resolution.Detail)
	}
	if resolution.ReasonCode != catalog.ReasonLocalModelResolveSlotOmitted {
		t.Fatalf("expected slot-omitted reason, got %q", resolution.ReasonCode)
	}
	if len(resolution.Bindings) != 0 {
		t.Fatalf("an omitted image slot must produce no bindings, got %d", len(resolution.Bindings))
	}
}

// TestResolveRecommendedImageConsumerFailCloseOnUnsupportedHost verifies the
// seam surfaces a resolver fail-close (a required recommended slot is
// unsatisfiable) as state=fail_close — the host_conditional image slot does
// not mask a required-slot fail-close.
func TestResolveRecommendedImageConsumerFailCloseOnUnsupportedHost(t *testing.T) {
	svc := newTestService(t)
	// A 4 GiB host cannot fit the required recommended chat/speech slots.
	tinyHost := &runtimev1.LocalDeviceProfile{
		Os:            "linux",
		Arch:          "amd64",
		TotalRamBytes: 4 * testGiB,
		Gpu:           &runtimev1.LocalGpuProfile{Available: false},
	}
	resolution := svc.resolveRecommendedImageConsumer(tinyHost)
	if resolution.State != recommendedImageStateFailClose {
		t.Fatalf("expected fail_close on an unsupported host, got state=%q", resolution.State)
	}
	if resolution.ReasonCode != catalog.ReasonLocalModelResolveHostUnsupported {
		t.Fatalf("expected host-unsupported reason, got %q", resolution.ReasonCode)
	}
}

// TestResolveRecommendedImageActivationGateRunsGatePerBinding verifies the
// K-LENV seam runs the activation gate once per resolved binding (main asset +
// each companion). Without selected source records the gate is setup_required;
// the seam still produces one gate per binding bound to the image consumer.
func TestResolveRecommendedImageActivationGateRunsGatePerBinding(t *testing.T) {
	svc := newTestService(t)
	resolution, gates := svc.resolveRecommendedImageActivationGate(recommendedImageCUDAProfile(), t.TempDir())
	if resolution.State != recommendedImageStateResolved {
		t.Fatalf("expected resolved, got state=%q detail=%q", resolution.State, resolution.Detail)
	}
	if len(gates) != len(resolution.Bindings) {
		t.Fatalf("expected one activation gate per binding (%d), got %d", len(resolution.Bindings), len(gates))
	}
	for _, gate := range gates {
		if gate.ConsumerID != resolution.ConsumerID {
			t.Fatalf("activation gate consumer %q != image consumer %q", gate.ConsumerID, resolution.ConsumerID)
		}
		if gate.PackID != "local-image-native" {
			t.Fatalf("image consumer activation gate must resolve the local-image-native pack, got %q", gate.PackID)
		}
	}
}
