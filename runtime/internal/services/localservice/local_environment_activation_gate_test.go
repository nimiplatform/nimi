package localservice

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
)

func TestLocalEnvironmentActivationGateBlocksMissingSourceRecords(t *testing.T) {
	svc := newTestService(t)
	model := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "speech/gate-missing",
		capabilities: []string{"audio.synthesize"},
		engine:       "speech",
		entry:        "model.onnx",
	})

	gate := svc.resolveLocalEnvironmentConsumerActivationGate(localEnvironmentConsumerActivationGateRequest{
		ConsumerID:   "speech.qwen3-tts.python",
		PackID:       "local-speech",
		LocalAssetID: model.GetLocalAssetId(),
	})

	if gate.State != localEnvironmentActivationStateSetupRequired {
		t.Fatalf("gate state = %q, want setup_required", gate.State)
	}
	if len(gate.BlockingDependencies) == 0 {
		t.Fatal("expected missing selected source records to block activation")
	}
	if !strings.Contains(gate.Detail, "selected") && !strings.Contains(gate.Detail, "state=needs_confirmation") {
		t.Fatalf("expected setup detail, got %q", gate.Detail)
	}
}

func TestLocalEnvironmentActivationGateAdmitsReadyRecords(t *testing.T) {
	svc := newTestService(t)
	model := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "speech/gate-ready",
		capabilities: []string{"audio.synthesize"},
		engine:       "speech",
		entry:        "model.onnx",
	})
	req := localEnvironmentConsumerActivationGateRequest{
		ConsumerID:   "speech.qwen3-tts.python",
		PackID:       "local-speech",
		LocalAssetID: model.GetLocalAssetId(),
	}
	markLocalEnvironmentPlanReadyForTest(t, svc, req)

	gate := svc.resolveLocalEnvironmentConsumerActivationGate(req)

	if gate.State != localEnvironmentActivationStateReady {
		t.Fatalf("gate state = %q, want ready; detail=%q", gate.State, gate.Detail)
	}
	if len(gate.BlockingDependencies) != 0 {
		t.Fatalf("unexpected blocking dependencies: %#v", gate.BlockingDependencies)
	}
}

func TestLocalEnvironmentActivationGateUsesConsumerPackOverCallerPackProjection(t *testing.T) {
	svc := newTestService(t)
	model := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "speech/gate-consumer-pack",
		capabilities: []string{"audio.synthesize"},
		engine:       "speech",
		entry:        "model.onnx",
	})

	gate := svc.resolveLocalEnvironmentConsumerActivationGate(localEnvironmentConsumerActivationGateRequest{
		ConsumerID:   "speech.qwen3-tts.python",
		PackID:       "local-gpu-support",
		LocalAssetID: model.GetLocalAssetId(),
	})

	if gate.PackID != "local-speech" {
		t.Fatalf("gate pack id = %q, want consumer-required local-speech", gate.PackID)
	}
	if len(gate.Dependencies) == 0 {
		t.Fatal("expected consumer-required local-speech dependencies")
	}
	if len(gate.Dependencies) == 1 && gate.Dependencies[0].DependencyFamily == localEnvironmentFamilyCUDA {
		t.Fatalf("caller pack projection weakened consumer dependencies: %#v", gate.Dependencies)
	}
}

func TestLocalEnvironmentActivationGateBlocksRepairRequiredSourceRecord(t *testing.T) {
	svc := newTestService(t)
	model := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "speech/gate-repair",
		capabilities: []string{"audio.synthesize"},
		engine:       "speech",
		entry:        "model.onnx",
	})
	req := localEnvironmentConsumerActivationGateRequest{
		ConsumerID:   "speech.qwen3-tts.python",
		PackID:       "local-speech",
		LocalAssetID: model.GetLocalAssetId(),
	}
	deps := markLocalEnvironmentPlanReadyForTest(t, svc, req)
	if len(deps) == 0 {
		t.Fatal("expected dependencies")
	}
	svc.markLocalEnvironmentDependencyRepairRequired(deps[0].EnvironmentKey, "repair required for test")

	gate := svc.resolveLocalEnvironmentConsumerActivationGate(req)

	if gate.State != localEnvironmentActivationStateRepairRequired {
		t.Fatalf("gate state = %q, want repair_required; detail=%q", gate.State, gate.Detail)
	}
}

func TestLocalEnvironmentActivationGateBlocksUnsupportedCUDA(t *testing.T) {
	svc := newTestService(t)

	gate := svc.resolveLocalEnvironmentConsumerActivationGate(localEnvironmentConsumerActivationGateRequest{
		ConsumerID: stableDiffusionCUDAConsumerID,
		PackID:     "local-gpu-support",
	})

	if gate.State != localEnvironmentActivationStateUnsupported {
		t.Fatalf("gate state = %q, want unsupported; detail=%q", gate.State, gate.Detail)
	}
}

func TestLocalEnvironmentActivationDependencyRequiresMaterializerForReadyCUDAProjection(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{
		sharedAcceleratorDependencyStatus: &engine.SharedAcceleratorDependencyStatus{
			DependencyID:      cudaUserSpaceRuntimeDependencyID,
			State:             engine.SharedAcceleratorDependencyReadyManaged,
			Source:            "runtime_managed",
			CanonicalRoot:     `C:\Users\admin\.nimi\runtime\accelerator-dependencies\nvidia-cuda-user-space-runtime`,
			Detail:            "nvidia_cuda_user_space_runtime state=ready_managed source=runtime_managed",
			RequiredArtifacts: []string{"cudart64_12.dll", "cublas64_12.dll", "cublasLt64_12.dll"},
		},
	})

	dep := svc.resolveLocalEnvironmentActivationDependency(localEnvironmentPlanDependency{
		DependencyFamily:     localEnvironmentFamilyCUDA,
		DependencyID:         cudaUserSpaceRuntimeDependencyID,
		Required:             true,
		State:                localEnvironmentStateNeedsConfirmation,
		SourceKind:           localEnvironmentSourceManaged,
		ConfirmationRequired: true,
		EnvironmentKey:       "accelerator.cuda.runtime|nvidia-cuda-user-space-runtime|host|windows/amd64|root|stable-diffusion.cpp.cuda",
	}, stableDiffusionCUDAConsumerID)

	if dep.State != localEnvironmentStateNeedsConfirmation || !dep.ConfirmationRequired {
		t.Fatalf("ready CUDA projection must require confirmed materializer job: %+v", dep)
	}
	if dep.SelectedSourceRecordID != "" {
		t.Fatalf("activation projection must not promote selected source record: %+v", dep)
	}
	if _, ok := svc.localEnvironmentSelectedSourceRecord(dep.EnvironmentKey); ok {
		t.Fatalf("expected no selected source record from activation projection for %q", dep.EnvironmentKey)
	}
}

func TestLocalEnvironmentActivationGatePreservesCancelledAndFailedJobs(t *testing.T) {
	for _, tc := range []struct {
		name      string
		jobState  string
		wantState string
	}{
		{name: "cancelled", jobState: localEnvironmentStateCancelled, wantState: localEnvironmentActivationStateCancelled},
		{name: "failed", jobState: localEnvironmentStateFailed, wantState: localEnvironmentActivationStateFailed},
	} {
		t.Run(tc.name, func(t *testing.T) {
			svc := newTestService(t)
			model := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
				assetID:      "speech/gate-job-" + tc.name,
				capabilities: []string{"audio.synthesize"},
				engine:       "speech",
				entry:        "model.onnx",
			})
			req := localEnvironmentConsumerActivationGateRequest{
				ConsumerID:   "speech.qwen3-tts.python",
				PackID:       "local-speech",
				LocalAssetID: model.GetLocalAssetId(),
			}
			plan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
				PackID:        req.PackID,
				ConsumerScope: req.ConsumerID,
				LocalAssetID:  req.LocalAssetID,
			})
			if len(plan.Dependencies) == 0 {
				t.Fatal("expected plan dependencies")
			}
			dep := plan.Dependencies[0]
			svc.mu.Lock()
			svc.localEnvironmentDependencyJobs["job-"+tc.name] = localEnvironmentDependencyJobState{
				JobID:            "job-" + tc.name,
				EnvironmentKey:   dep.EnvironmentKey,
				DependencyFamily: dep.DependencyFamily,
				DependencyID:     dep.DependencyID,
				State:            tc.jobState,
				SourceKind:       localEnvironmentSourceManaged,
				UpdatedAt:        nowISO(),
			}
			svc.mu.Unlock()

			gate := svc.resolveLocalEnvironmentConsumerActivationGate(req)

			if gate.State != tc.wantState {
				t.Fatalf("gate state = %q, want %q; detail=%q", gate.State, tc.wantState, gate.Detail)
			}
		})
	}
}

func TestManagedImageCUDAHealthUsesLocalEnvironmentActivationGate(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "windows", "amd64")
	setNvidiaGPUProbeForTest(t, false)
	svc.SetEngineManager(&mockEngineManager{})
	svc.SetManagedLlamaRegistrationConfig(t.TempDir(), "", true)
	svc.SetManagedMediaEndpoint("http://127.0.0.1:8321/v1")
	svc.SetManagedImageBackendConfig(true, "127.0.0.1:50052")
	svc.SetManagedImageBackendHealth(true, "image backend active")
	model := importWindowsNativeImageForActivationGateTest(t, svc)
	cacheManagedImageProfileForTest(t, svc, model.GetLocalAssetId())

	resp, err := svc.StartLocalAsset(context.Background(), &runtimev1.StartLocalAssetRequest{
		LocalAssetId: model.GetLocalAssetId(),
	})
	if err != nil {
		t.Fatalf("StartLocalAsset should return unhealthy asset, got transport error: %v", err)
	}
	if resp.GetAsset().GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY {
		t.Fatalf("asset status = %s, want unhealthy", resp.GetAsset().GetStatus())
	}
	if !strings.Contains(resp.GetAsset().GetHealthDetail(), "local environment activation blocked") {
		t.Fatalf("expected local environment gate detail, got %q", resp.GetAsset().GetHealthDetail())
	}
}

func markLocalEnvironmentPlanReadyForTest(t *testing.T, svc *Service, req localEnvironmentConsumerActivationGateRequest) []localEnvironmentPlanDependency {
	t.Helper()
	requirement, ok := localEnvironmentConsumerRequirementByID(req.ConsumerID)
	if !ok {
		t.Fatalf("unknown test consumer %q", req.ConsumerID)
	}
	packID := req.PackID
	if packID == "" {
		packID = requirement.PackID
	}
	plan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:           packID,
		ConsumerScope:    req.ConsumerID,
		HostProfile:      req.HostProfile,
		RuntimeDataRoot:  req.RuntimeDataRoot,
		AssetID:          req.AssetID,
		LocalAssetID:     req.LocalAssetID,
		CompanionAssetID: req.CompanionAssetID,
		ParentAssetID:    req.ParentAssetID,
	})
	for _, dep := range plan.Dependencies {
		sourceKind := localEnvironmentSourceManaged
		if dep.DependencyFamily == localEnvironmentFamilyPythonRuntime || dep.DependencyFamily == localEnvironmentFamilyPythonUV {
			sourceKind = localEnvironmentSourceSystem
		}
		svc.upsertLocalEnvironmentSelectedSourceRecord(verifiedSelectedSourceRecordForTest(localEnvironmentSelectedSourceRecordState{
			DependencyFamily:  dep.DependencyFamily,
			DependencyID:      dep.DependencyID,
			EnvironmentKey:    dep.EnvironmentKey,
			SourceKind:        sourceKind,
			CanonicalRoot:     filepath.Join(t.TempDir(), strings.ReplaceAll(dep.DependencyID, ".", "-")),
			SelectedConsumers: []string{req.ConsumerID},
			AuditReasonCode:   "test_ready",
		}))
	}
	return plan.Dependencies
}

func importWindowsNativeImageForActivationGateTest(t *testing.T, svc *Service) *runtimev1.LocalAssetRecord {
	t.Helper()
	manifestPath := filepath.Join(svc.localModelsPath, "resolved", "nimi", "image-model-cuda-gate", "asset.manifest.json")
	rawManifest, err := json.Marshal(map[string]any{
		"asset_id":         "local-import/z_image_turbo-Q4_K",
		"kind":             "image",
		"logical_model_id": "nimi/image-model-cuda-gate",
		"engine":           "media",
		"capabilities":     []string{"image"},
		"entry":            "z_image_turbo-Q4_K.gguf",
		"source": map[string]any{
			"repo": "file://" + filepath.ToSlash(manifestPath),
		},
		"engine_config": map[string]any{
			"backend": "stablediffusion-ggml",
		},
	})
	if err != nil {
		t.Fatalf("marshal manifest: %v", err)
	}
	if err := os.MkdirAll(filepath.Dir(manifestPath), 0o755); err != nil {
		t.Fatalf("create manifest dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(filepath.Dir(manifestPath), "z_image_turbo-Q4_K.gguf"), validImageTestGGUF(), 0o600); err != nil {
		t.Fatalf("write image entry: %v", err)
	}
	if err := os.WriteFile(manifestPath, rawManifest, 0o600); err != nil {
		t.Fatalf("write manifest: %v", err)
	}
	imported, err := svc.ImportLocalAsset(context.Background(), &runtimev1.ImportLocalAssetRequest{
		ManifestPath: manifestPath,
	})
	if err != nil {
		t.Fatalf("import image asset: %v", err)
	}
	return imported.GetAsset()
}
