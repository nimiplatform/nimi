package localservice

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
)

func TestProfileRuntimeDescriptorRejectsForbiddenRuntimeEvidence(t *testing.T) {
	raw := marshalProfileRuntimeDescriptor(t, testProfileRuntimeDescriptor())
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	payload["selectedBindings"] = map[string]any{"text.generate": "route"}
	payload["capability_slices"].([]any)[0].(map[string]any)["endpoint"] = "http://127.0.0.1:8080"
	forbidden, _ := json.Marshal(payload)

	_, err := validateProfileRuntimeDescriptor(forbidden)
	if err == nil {
		t.Fatal("expected forbidden runtime evidence to fail closed")
	}
	if !strings.Contains(err.Error(), "descriptor.forbidden_host_local_field") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestProfileRuntimeDescriptorRejectsDuplicateSliceIDsBeforeMaterialization(t *testing.T) {
	descriptor := testProfileRuntimeImageCompanionDescriptor()
	setupRequiredSlice := descriptor.CapabilitySlices[0]
	setupRequiredSlice.AssetRefs = []string{"missing-main"}
	descriptor.CapabilitySlices = []profileRuntimeDescriptorCapability{
		setupRequiredSlice,
		descriptor.CapabilitySlices[0],
	}

	_, err := validateProfileRuntimeDescriptor(marshalProfileRuntimeDescriptor(t, descriptor))
	if err == nil {
		t.Fatal("expected duplicate slice id to fail validation")
	}
	if !strings.Contains(err.Error(), "descriptor.slice.duplicate_slice_id") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestProfileRuntimeDescriptorRejectsDuplicateAssetBindingIDsBeforeMaterialization(t *testing.T) {
	descriptor := testProfileRuntimeImageCompanionDescriptor()
	setupRequiredBinding := descriptor.AssetBindings[0]
	setupRequiredBinding.Source = "manual"
	setupRequiredBinding.PreparedAssetID = ""
	setupRequiredBinding.HuggingFace = nil
	setupRequiredBinding.Manual = &profileRuntimeDescriptorManualSource{
		ExpectedName:            "z-image-unadmitted.gguf",
		AssociationInstructions: "Import the unadmitted setup-required image asset.",
	}
	descriptor.AssetBindings = []profileRuntimeDescriptorAssetBinding{
		setupRequiredBinding,
		descriptor.AssetBindings[0],
		descriptor.AssetBindings[1],
		descriptor.AssetBindings[2],
	}

	_, err := validateProfileRuntimeDescriptor(marshalProfileRuntimeDescriptor(t, descriptor))
	if err == nil {
		t.Fatal("expected duplicate asset binding id to fail validation")
	}
	if !strings.Contains(err.Error(), "descriptor.asset_binding.duplicate_binding_id") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestProfileRuntimeDescriptorFailsClosedOnBackendAndFamilyMismatch(t *testing.T) {
	descriptor := testProfileRuntimeDescriptor()
	descriptor.CapabilitySlices[0].Execution.Backend = "diffusers"
	descriptor.CapabilitySlices[0].Model.Family = "llama"

	_, err := validateProfileRuntimeDescriptor(marshalProfileRuntimeDescriptor(t, descriptor))
	if err == nil {
		t.Fatal("expected backend/model family mismatch to fail")
	}
	if !strings.Contains(err.Error(), "profile_model_family_mismatch") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestProfileRuntimePrepareProjectsDiffusersAndVideoNoLiveConfig(t *testing.T) {
	descriptor := testProfileRuntimeDescriptor()
	descriptor.CapabilitySlices = []profileRuntimeDescriptorCapability{
		{
			SliceID:         "slice:diffusers",
			Capability:      "image.generate",
			ExecutionMode:   "local",
			ContractState:   "proposed",
			ReadinessPolicy: "required",
			ParamsRef:       "params:diffusers",
			Execution:       profileRuntimeDescriptorExecution{Backend: "diffusers", BackendClass: "python_pipeline", BackendFamily: "diffusers"},
			Model:           profileRuntimeDescriptorModel{Family: "sdxl"},
			AssetRefs:       []string{"main"},
		},
		{
			SliceID:         "slice:video",
			Capability:      "video.generate",
			ExecutionMode:   "local",
			ContractState:   "unsupported",
			ReadinessPolicy: "required",
			ParamsRef:       "params:video",
			Execution:       profileRuntimeDescriptorExecution{Backend: "video.pipeline", BackendClass: "python_pipeline", BackendFamily: "video-python"},
			Model:           profileRuntimeDescriptorModel{Family: "wan"},
			AssetRefs:       []string{"main"},
		},
	}

	validated, err := validateProfileRuntimeDescriptor(marshalProfileRuntimeDescriptor(t, descriptor))
	if err != nil {
		t.Fatalf("validate descriptor: %v", err)
	}
	results, err := prepareProfileRuntimeDescriptor(validated)
	if err != nil {
		t.Fatalf("prepare descriptor: %v", err)
	}
	if results[0].Outcome != profileRuntimePrepareSetupRequiredNoLiveConfig {
		t.Fatalf("diffusers must be setup-required no-live-config, got %+v", results[0])
	}
	if !profileRuntimeStringSliceContains(results[0].ReasonCodes, "product_state_proposed") ||
		!profileRuntimeStringSliceContains(results[0].ReasonCodes, "environment_materializer_unready") {
		t.Fatalf("missing diffusers reason codes: %+v", results[0])
	}
	if results[1].Outcome != profileRuntimePrepareUnsupportedNoLiveConfig {
		t.Fatalf("video must be unsupported no-live-config, got %+v", results[1])
	}
	if !profileRuntimeStringSliceContains(results[1].ReasonCodes, "workflow_video_backend_unavailable") {
		t.Fatalf("missing video reason code: %+v", results[1])
	}
}

func TestProfileRuntimePrepareSeparatesSourceReadinessFromAssetHealth(t *testing.T) {
	descriptor := testProfileRuntimeDescriptor()
	descriptor.AssetBindings[1].PreparedAssetID = ""
	descriptor.AssetBindings[1].HuggingFace.AccessPolicy = "gated"

	validated, err := validateProfileRuntimeDescriptor(marshalProfileRuntimeDescriptor(t, descriptor))
	if err != nil {
		t.Fatalf("validate descriptor: %v", err)
	}
	results, err := prepareProfileRuntimeDescriptor(validated)
	if err != nil {
		t.Fatalf("prepare descriptor: %v", err)
	}
	if results[0].Outcome != profileRuntimePrepareSetupRequiredNoLiveConfig {
		t.Fatalf("expected gated companion to require setup, got %+v", results[0])
	}
	if !results[0].ReusableAssetHealthy {
		t.Fatalf("workflow readiness must not poison reusable asset health: %+v", results[0])
	}
	if !profileRuntimeStringSliceContains(results[0].ReasonCodes, "hf_terms_required") {
		t.Fatalf("missing HF gated readiness reason: %+v", results[0])
	}
}

func TestProfileRuntimeMaterializationIdentityKeepsOrderedCompanionOccurrences(t *testing.T) {
	first := testProfileRuntimeDescriptor()
	validatedFirst, err := validateProfileRuntimeDescriptor(marshalProfileRuntimeDescriptor(t, first))
	if err != nil {
		t.Fatalf("validate first descriptor: %v", err)
	}
	firstResult, err := prepareProfileRuntimeDescriptorWithFacts(validatedFirst, testProfileRuntimeReadyFacts(first))
	if err != nil {
		t.Fatalf("prepare first descriptor: %v", err)
	}

	second := testProfileRuntimeDescriptor()
	second.CapabilitySlices[0].OrderedCompanionOccurrences[0].Order = 1
	second.CapabilitySlices[0].OrderedCompanionOccurrences[1].Order = 0
	validatedSecond, err := validateProfileRuntimeDescriptor(marshalProfileRuntimeDescriptor(t, second))
	if err != nil {
		t.Fatalf("validate second descriptor: %v", err)
	}
	secondResult, err := prepareProfileRuntimeDescriptorWithFacts(validatedSecond, testProfileRuntimeReadyFacts(second))
	if err != nil {
		t.Fatalf("prepare second descriptor: %v", err)
	}

	if firstResult[0].MaterializationKey == secondResult[0].MaterializationKey {
		t.Fatalf("ordered companion occurrence identity collapsed: %s", firstResult[0].MaterializationKey)
	}
}

func TestProfileRuntimeCloudConnectorDescriptorRejectsSecrets(t *testing.T) {
	descriptor := testProfileRuntimeDescriptor()
	descriptor.CapabilitySlices = []profileRuntimeDescriptorCapability{
		{
			SliceID:            "slice:cloud",
			Capability:         "text.generate",
			ExecutionMode:      "cloud_connector",
			ContractState:      "declared",
			ReadinessPolicy:    "required",
			ParamsRef:          "params:cloud",
			Provider:           "openai",
			ProviderCapability: "text.generate",
			ModelID:            "gpt-4.1-mini",
			CredentialPolicy:   "runtime_custody_required",
		},
	}
	raw := marshalProfileRuntimeDescriptor(t, descriptor)
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	payload["capability_slices"].([]any)[0].(map[string]any)["credential_payload"] = map[string]any{
		"api_key": "secret",
	}
	forbidden, _ := json.Marshal(payload)

	_, err := validateProfileRuntimeDescriptor(forbidden)
	if err == nil {
		t.Fatal("expected cloud connector secret projection to fail")
	}
	if !strings.Contains(err.Error(), "descriptor.forbidden_host_local_field") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestImportLocalAssetStoresReusableFactsOnly(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	tmpDir := t.TempDir()
	svc.SetManagedLlamaRegistrationConfig(tmpDir, "", true)
	manifestPath := filepath.Join(tmpDir, "resolved", "nimi", "image-import", "asset.manifest.json")
	rawManifest, err := json.Marshal(map[string]any{
		"asset_id":         "local-import/z_image_turbo-Q4_K",
		"kind":             "image",
		"logical_model_id": "nimi/image-import",
		"engine":           "media",
		"capabilities":     []string{"image"},
		"entry":            "z_image_turbo-Q4_K.gguf",
		"engineConfig": map[string]any{
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
		t.Fatalf("write entry file: %v", err)
	}
	if err := os.WriteFile(manifestPath, rawManifest, 0o600); err != nil {
		t.Fatalf("write manifest: %v", err)
	}

	resp, err := svc.ImportLocalAsset(context.Background(), &runtimev1.ImportLocalAssetRequest{ManifestPath: manifestPath})
	if err != nil {
		t.Fatalf("import asset: %v", err)
	}
	if resp.GetAsset().GetLocalAssetId() == "" || resp.GetAsset().GetAssetId() == "" {
		t.Fatalf("expected reusable asset facts, got %+v", resp.GetAsset())
	}
	if _, ok := svc.cachedManagedMediaImageProfile(resp.GetAsset().GetLocalAssetId()); ok {
		t.Fatalf("import/store must not infer workflow materialization cache")
	}
	plan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:        "local-image-native",
		ConsumerScope: "stable-diffusion.cpp.metal",
		AssetID:       resp.GetAsset().GetAssetId(),
		LocalAssetID:  resp.GetAsset().GetLocalAssetId(),
	})
	if len(plan.Dependencies) == 0 {
		t.Fatalf("expected reusable dependency facts to remain inspectable")
	}
	for _, dep := range plan.Dependencies {
		if strings.Contains(dep.DependencyID, "workflow_binding") {
			t.Fatalf("import/store projected workflow binding identity: %+v", dep)
		}
	}
}

func TestProfileRuntimeDescriptorRejectsDuplicateCompanionOccurrenceIDs(t *testing.T) {
	descriptor := testProfileRuntimeDescriptor()
	descriptor.CapabilitySlices[0].OrderedCompanionOccurrences[1].OccurrenceID =
		descriptor.CapabilitySlices[0].OrderedCompanionOccurrences[0].OccurrenceID

	_, err := validateProfileRuntimeDescriptor(marshalProfileRuntimeDescriptor(t, descriptor))
	if err == nil {
		t.Fatal("expected duplicate occurrence id to fail")
	}
	if !strings.Contains(err.Error(), "duplicate_occurrence") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestProfileRuntimeManualSourceReadinessFailsClosed(t *testing.T) {
	descriptor := testProfileRuntimeDescriptor()
	descriptor.AssetBindings[0] = profileRuntimeDescriptorAssetBinding{
		BindingID:        "main",
		AssetRole:        "main",
		ComponentKind:    "image",
		Source:           "manual",
		ExpectedIdentity: "manual:z-image",
		ReadinessPolicy:  "required",
		Manual: &profileRuntimeDescriptorManualSource{
			ExpectedName:            "z-image.gguf",
			AssociationInstructions: "select the expected image model",
		},
	}

	validated, err := validateProfileRuntimeDescriptor(marshalProfileRuntimeDescriptor(t, descriptor))
	if err != nil {
		t.Fatalf("validate descriptor: %v", err)
	}
	results, err := prepareProfileRuntimeDescriptor(validated)
	if err != nil {
		t.Fatalf("prepare descriptor: %v", err)
	}
	if !profileRuntimeStringSliceContains(results[0].ReasonCodes, "manual_association_required") {
		t.Fatalf("manual source readiness did not fail closed: %+v", results[0])
	}
}

func TestProfileRuntimeMaterializationIdentityRejectsMainAssetOnlyShortcut(t *testing.T) {
	first := testProfileRuntimeDescriptor()
	first.CapabilitySlices[0].OrderedCompanionOccurrences = nil
	first.AssetBindings = first.AssetBindings[:1]
	validatedFirst, err := validateProfileRuntimeDescriptor(marshalProfileRuntimeDescriptor(t, first))
	if err != nil {
		t.Fatalf("validate first descriptor: %v", err)
	}
	firstResult, err := prepareProfileRuntimeDescriptorWithFacts(validatedFirst, testProfileRuntimeReadyFacts(first))
	if err != nil {
		t.Fatalf("prepare first descriptor: %v", err)
	}

	second := first
	second.CapabilitySlices[0].SliceID = "slice:image:other-workflow"
	validatedSecond, err := validateProfileRuntimeDescriptor(marshalProfileRuntimeDescriptor(t, second))
	if err != nil {
		t.Fatalf("validate second descriptor: %v", err)
	}
	secondResult, err := prepareProfileRuntimeDescriptorWithFacts(validatedSecond, testProfileRuntimeReadyFacts(second))
	if err != nil {
		t.Fatalf("prepare second descriptor: %v", err)
	}
	if firstResult[0].MaterializationKey == secondResult[0].MaterializationKey {
		t.Fatalf("materialization key used main asset only: %s", firstResult[0].MaterializationKey)
	}
}

func TestProfileRuntimeDescriptorRejectsLocalPaths(t *testing.T) {
	descriptor := testProfileRuntimeDescriptor()
	descriptor.AssetBindings[0].ExpectedIdentity = "/Users/snwozy/model.gguf"

	_, err := validateProfileRuntimeDescriptor(marshalProfileRuntimeDescriptor(t, descriptor))
	if err == nil {
		t.Fatal("expected local path projection to fail")
	}
	if !strings.Contains(err.Error(), "descriptor.forbidden_host_local_field") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestProfileRuntimeDescriptorAllowsRepeatedAssetUseWithDistinctOccurrences(t *testing.T) {
	descriptor := testProfileRuntimeDescriptor()
	descriptor.AssetBindings[1].PreparedAssetID = "asset:shared-lora"
	descriptor.CapabilitySlices[0].OrderedCompanionOccurrences[0].PreparedAssetID = "asset:shared-lora"
	descriptor.CapabilitySlices[0].OrderedCompanionOccurrences[1].PreparedAssetID = "asset:shared-lora"

	validated, err := validateProfileRuntimeDescriptor(marshalProfileRuntimeDescriptor(t, descriptor))
	if err != nil {
		t.Fatalf("validate descriptor: %v", err)
	}
	results, err := prepareProfileRuntimeDescriptorWithFacts(validated, testProfileRuntimeReadyFacts(descriptor))
	if err != nil {
		t.Fatalf("prepare descriptor: %v", err)
	}
	if results[0].Outcome != profileRuntimePrepareReady {
		t.Fatalf("expected repeated asset use to remain representable, got %+v", results[0])
	}
}

func TestProfileRuntimeDescriptorRejectsCapabilityVideoAsImageDuration(t *testing.T) {
	descriptor := testProfileRuntimeDescriptor()
	descriptor.CapabilitySlices[0].Execution.Backend = "video.pipeline"
	descriptor.CapabilitySlices[0].Model.Family = "wan"
	descriptor.CapabilitySlices[0].Capability = "image.generate"
	descriptor.DefaultParams = map[string]any{"duration": 4}

	_, err := validateProfileRuntimeDescriptor(marshalProfileRuntimeDescriptor(t, descriptor))
	if err == nil {
		t.Fatal("expected video backend modeled as image to fail")
	}
	if !strings.Contains(err.Error(), "workflow.video_backend_unavailable") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestProfileRuntimeDescriptorCloudConnectorNonSecretPrepare(t *testing.T) {
	descriptor := testProfileRuntimeDescriptor()
	descriptor.CapabilitySlices = []profileRuntimeDescriptorCapability{
		{
			SliceID:            "slice:cloud",
			Capability:         "text.generate",
			ExecutionMode:      "cloud_connector",
			ContractState:      "declared",
			ReadinessPolicy:    "required",
			ParamsRef:          "params:cloud",
			Provider:           "openai",
			ProviderCapability: "text.generate",
			ModelID:            "gpt-4.1-mini",
			CredentialPolicy:   "runtime_custody_required",
		},
	}

	validated, err := validateProfileRuntimeDescriptor(marshalProfileRuntimeDescriptor(t, descriptor))
	if err != nil {
		t.Fatalf("validate cloud descriptor: %v", err)
	}
	results, err := prepareProfileRuntimeDescriptor(validated)
	if err != nil {
		t.Fatalf("prepare cloud descriptor: %v", err)
	}
	if results[0].Outcome != profileRuntimePrepareSetupRequiredNoLiveConfig {
		t.Fatalf("expected connector without runtime custody evidence to require setup, got %+v", results[0])
	}
	if !profileRuntimeStringSliceContains(results[0].ReasonCodes, "credentials_required") {
		t.Fatalf("expected credentials_required without secret projection, got %+v", results[0])
	}
	validated.CapabilitySlices[0].CredentialPolicy = "runtime_custody_ready"
	ready, err := prepareProfileRuntimeDescriptor(validated)
	if err != nil {
		t.Fatalf("prepare ready cloud descriptor: %v", err)
	}
	if ready[0].Outcome != profileRuntimePrepareReady || ready[0].MaterializationKey != "" {
		t.Fatalf("ready cloud connector must not use local workflow materialization, got %+v", ready[0])
	}
}

func TestProfileRuntimeDescriptorRejectsUnknownExecutionBackend(t *testing.T) {
	descriptor := testProfileRuntimeDescriptor()
	descriptor.CapabilitySlices[0].Execution.Backend = "native-image-default"

	_, err := validateProfileRuntimeDescriptor(marshalProfileRuntimeDescriptor(t, descriptor))
	if err == nil {
		t.Fatal("expected unknown backend to fail closed")
	}
	if !strings.Contains(err.Error(), "profile_backend_mismatch") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestProfileRuntimeDescriptorOccurrenceIdentityDoesNotCollapseToSlotMap(t *testing.T) {
	descriptor := testProfileRuntimeDescriptor()
	descriptor.CapabilitySlices[0].OrderedCompanionOccurrences[1].OccurrenceID = "lora-3"
	descriptor.CapabilitySlices[0].OrderedCompanionOccurrences[1].Order = 0
	descriptor.CapabilitySlices[0].OrderedCompanionOccurrences[0].Order = 0

	_, err := validateProfileRuntimeDescriptor(marshalProfileRuntimeDescriptor(t, descriptor))
	if err == nil {
		t.Fatal("expected unordered companion occurrences to fail closed")
	}
	if !strings.Contains(err.Error(), "order_duplicate") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestProfileRuntimeDescriptorPreparedAssetIDsDoNotNeedLocalPaths(t *testing.T) {
	descriptor := testProfileRuntimeDescriptor()
	descriptor.AssetBindings[0].PreparedAssetID = "artifact_" + ulid.Make().String()

	validated, err := validateProfileRuntimeDescriptor(marshalProfileRuntimeDescriptor(t, descriptor))
	if err != nil {
		t.Fatalf("validate descriptor: %v", err)
	}
	results, err := prepareProfileRuntimeDescriptorWithFacts(validated, testProfileRuntimeReadyFacts(descriptor))
	if err != nil {
		t.Fatalf("prepare descriptor: %v", err)
	}
	if results[0].Outcome != profileRuntimePrepareReady {
		t.Fatalf("prepared logical asset ids should not require local paths, got %+v", results[0])
	}
}

func TestProfileRuntimeMaterializationIdentityInvalidatesOnAllWorkflowInputs(t *testing.T) {
	keyFor := func(t *testing.T, descriptor profileRuntimeDescriptor) string {
		t.Helper()
		validated, err := validateProfileRuntimeDescriptor(marshalProfileRuntimeDescriptor(t, descriptor))
		if err != nil {
			t.Fatalf("validate descriptor: %v", err)
		}
		results, err := prepareProfileRuntimeDescriptorWithFacts(validated, testProfileRuntimeReadyFacts(descriptor))
		if err != nil {
			t.Fatalf("prepare descriptor: %v", err)
		}
		if len(results) != 1 || results[0].Outcome != profileRuntimePrepareReady || results[0].MaterializationKey == "" {
			t.Fatalf("expected one ready local materialization result, got %+v", results)
		}
		return results[0].MaterializationKey
	}

	base := testProfileRuntimeDescriptor()
	baseKey := keyFor(t, base)
	cases := map[string]func(profileRuntimeDescriptor) profileRuntimeDescriptor{
		"source digest": func(next profileRuntimeDescriptor) profileRuntimeDescriptor {
			next.SourceProfileDigest = "sha256:changed-source"
			return next
		},
		"requirement refs": func(next profileRuntimeDescriptor) profileRuntimeDescriptor {
			next.RequirementRefs = []string{"requirement:other"}
			return next
		},
		"slice id": func(next profileRuntimeDescriptor) profileRuntimeDescriptor {
			next.CapabilitySlices[0].SliceID = "slice:image:other"
			return next
		},
		"model family": func(next profileRuntimeDescriptor) profileRuntimeDescriptor {
			next.CapabilitySlices[0].Model.Family = "sdxl"
			return next
		},
		"params digest": func(next profileRuntimeDescriptor) profileRuntimeDescriptor {
			next.CapabilitySlices[0].ParamsDigest = "params-digest:changed"
			return next
		},
		"environment digest": func(next profileRuntimeDescriptor) profileRuntimeDescriptor {
			next.CapabilitySlices[0].EnvironmentDigest = "env-digest:changed"
			return next
		},
		"prepared main asset": func(next profileRuntimeDescriptor) profileRuntimeDescriptor {
			next.AssetBindings[0].PreparedAssetID = "asset:main:changed"
			return next
		},
		"prepared companion asset": func(next profileRuntimeDescriptor) profileRuntimeDescriptor {
			next.AssetBindings[1].PreparedAssetID = "asset:lora-a:changed"
			next.CapabilitySlices[0].OrderedCompanionOccurrences[0].PreparedAssetID = "asset:lora-a:changed"
			return next
		},
		"companion occurrence": func(next profileRuntimeDescriptor) profileRuntimeDescriptor {
			next.CapabilitySlices[0].OrderedCompanionOccurrences[0].Weight = "0.9"
			next.CapabilitySlices[0].OrderedCompanionOccurrences[0].Options = map[string]any{"clip": "high"}
			return next
		},
	}

	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			if got := keyFor(t, mutate(testProfileRuntimeDescriptor())); got == baseKey {
				t.Fatalf("materialization key did not change for %s: %s", name, got)
			}
		})
	}
}
