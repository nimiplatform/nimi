package localservice

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func testProfileRuntimeDescriptor() profileRuntimeDescriptor {
	return profileRuntimeDescriptor{
		SchemaVersion:       1,
		DescriptorID:        "descriptor:test",
		ProfileRef:          profileRuntimeDescriptorProfileRef{ProfileID: "profile:test", Version: "1"},
		SourceProfileDigest: "sha256:test",
		ProjectionOrigin:    map[string]any{"component": "sdk.aiProfile.formRuntimeDescriptor"},
		RequirementRefs:     []string{"requirement:test"},
		CapabilitySlices: []profileRuntimeDescriptorCapability{
			{
				SliceID:         "slice:image",
				Capability:      "image.generate",
				ExecutionMode:   "local",
				ContractState:   "declared",
				ReadinessPolicy: "required",
				ParamsRef:       "params:image",
				Execution: profileRuntimeDescriptorExecution{
					Backend:       "stablediffusion-ggml",
					BackendClass:  "native_binary",
					BackendFamily: "stablediffusion-ggml",
				},
				Model:        profileRuntimeDescriptorModel{Family: "flux"},
				AssetRefs:    []string{"main"},
				ParamsDigest: "params-digest",
				OrderedCompanionOccurrences: []profileRuntimeDescriptorCompanionOccurrence{
					{
						OccurrenceID:    "lora-1",
						Order:           0,
						Role:            "lora",
						EngineSlot:      "lora_path",
						AssetBindingRef: "lora-a",
						Required:        true,
						Weight:          "0.7",
					},
					{
						OccurrenceID:    "lora-2",
						Order:           1,
						Role:            "lora",
						EngineSlot:      "lora_path",
						AssetBindingRef: "lora-a",
						Required:        true,
						Weight:          "0.4",
					},
				},
			},
		},
		AssetBindings: []profileRuntimeDescriptorAssetBinding{
			{
				BindingID:        "main",
				AssetRole:        "main",
				ComponentKind:    "image",
				Source:           "huggingface",
				ExpectedIdentity: "hf:nimi/z-image",
				ReadinessPolicy:  "required",
				PreparedAssetID:  "asset:main",
				HuggingFace: &profileRuntimeDescriptorHFSource{
					RepoID:       "nimiplatform/z-image",
					Revision:     "main",
					Entries:      []string{"model.gguf"},
					AccessPolicy: "public",
				},
			},
			{
				BindingID:        "lora-a",
				AssetRole:        "companion",
				ComponentKind:    "lora",
				Source:           "huggingface",
				ExpectedIdentity: "hf:nimi/lora-a",
				ReadinessPolicy:  "required",
				PreparedAssetID:  "asset:lora-a",
				HuggingFace: &profileRuntimeDescriptorHFSource{
					RepoID:       "nimiplatform/lora-a",
					Revision:     "main",
					Entries:      []string{"lora.safetensors"},
					AccessPolicy: "public",
				},
			},
		},
	}
}

func testProfileRuntimeImageCompanionDescriptor() profileRuntimeDescriptor {
	return profileRuntimeDescriptor{
		SchemaVersion:       1,
		DescriptorID:        "descriptor:z-image-companions",
		ProfileRef:          profileRuntimeDescriptorProfileRef{ProfileID: "profile:z-image", Version: "1"},
		SourceProfileDigest: "sha256:z-image",
		ProjectionOrigin:    map[string]any{"component": "sdk.aiProfile.formRuntimeDescriptor"},
		RequirementRefs:     []string{"requirement:z-image"},
		CapabilitySlices: []profileRuntimeDescriptorCapability{
			{
				SliceID:           "slice:image-native",
				Capability:        "image.generate",
				ExecutionMode:     "local",
				ContractState:     "declared",
				ReadinessPolicy:   "required",
				ParamsRef:         "params:image",
				RuntimeConsumerID: "stable-diffusion.cpp.metal",
				Execution: profileRuntimeDescriptorExecution{
					Backend:       "stablediffusion-ggml",
					BackendClass:  "native_binary",
					BackendFamily: "stablediffusion-ggml",
				},
				Model:        profileRuntimeDescriptorModel{Family: "z-image"},
				AssetRefs:    []string{"main"},
				ParamsDigest: "params-digest",
				OrderedCompanionOccurrences: []profileRuntimeDescriptorCompanionOccurrence{
					{
						OccurrenceID:    "qwen-text-encoder",
						Order:           0,
						Role:            "text_encoder",
						EngineSlot:      "llm_path",
						AssetBindingRef: "qwen",
						Required:        true,
					},
					{
						OccurrenceID:    "z-image-ae",
						Order:           1,
						Role:            "vae",
						EngineSlot:      "vae_path",
						AssetBindingRef: "ae",
						Required:        true,
					},
				},
			},
		},
		AssetBindings: []profileRuntimeDescriptorAssetBinding{
			{
				BindingID:        "main",
				AssetRole:        "main",
				ComponentKind:    "image",
				Source:           "huggingface",
				ExpectedIdentity: "z_image_turbo",
				ReadinessPolicy:  "required",
				PreparedAssetID:  "local-z-image",
				HuggingFace: &profileRuntimeDescriptorHFSource{
					RepoID:       "nimiplatform/z-image",
					Revision:     "main",
					Entries:      []string{"z-image.gguf"},
					AccessPolicy: "public",
				},
			},
			{
				BindingID:        "ae",
				AssetRole:        "companion",
				ComponentKind:    "vae",
				Source:           "huggingface",
				ExpectedIdentity: "z_image_ae",
				ReadinessPolicy:  "required",
				PreparedAssetID:  "local-z-image-ae",
				HuggingFace: &profileRuntimeDescriptorHFSource{
					RepoID:       "nimiplatform/z-image-ae",
					Revision:     "main",
					Entries:      []string{"ae.safetensors"},
					AccessPolicy: "public",
				},
			},
			{
				BindingID:        "qwen",
				AssetRole:        "companion",
				ComponentKind:    "chat",
				Source:           "huggingface",
				ExpectedIdentity: "qwen3_4b_companion",
				ReadinessPolicy:  "required",
				PreparedAssetID:  "local-qwen3-4b",
				HuggingFace: &profileRuntimeDescriptorHFSource{
					RepoID:       "nimiplatform/qwen3-4b",
					Revision:     "main",
					Entries:      []string{"Qwen3-4B-Q4_K_M.gguf"},
					AccessPolicy: "public",
				},
			},
		},
	}
}

func marshalProfileRuntimeDescriptor(t *testing.T, descriptor profileRuntimeDescriptor) []byte {
	t.Helper()
	raw, err := json.Marshal(descriptor)
	if err != nil {
		t.Fatalf("marshal descriptor: %v", err)
	}
	return raw
}

func testProfileRuntimeReadyFacts(descriptor profileRuntimeDescriptor) profileRuntimePrepareFacts {
	facts := profileRuntimePrepareFacts{
		NativeBackendPackages: []profileRuntimeNativeBackendPackageFact{
			{
				BackendName:            "stablediffusion-ggml",
				DependencyFamily:       localEnvironmentFamilyNativeSDCPP,
				DependencyID:           "stable-diffusion.cpp.package",
				SelectedConsumers:      []string{"stable-diffusion.cpp.metal"},
				State:                  localEnvironmentStateReadyManaged,
				SourceKind:             localEnvironmentSourceManaged,
				PackageSource:          "canonical_localai_derived",
				PackageFormat:          "oci_payload",
				LaunchMode:             "package_entrypoint",
				SelectedSourceRecordID: "src_e5dee81bca395e3c",
				CanonicalRoot:          "runtime-managed/stablediffusion-ggml",
				VerifiedArtifacts:      []string{"run.sh"},
				SupportedModelFamilies: testProfileRuntimeNativeBackendSupportedModelFamilies(),
			},
		},
	}
	for _, binding := range descriptor.AssetBindings {
		preparedID := strings.TrimSpace(binding.PreparedAssetID)
		if preparedID == "" {
			continue
		}
		facts.PreparedAssets = append(facts.PreparedAssets, profileRuntimePreparedAssetFact{
			PreparedAssetID: preparedID,
			AssetID:         strings.TrimSpace(binding.ExpectedIdentity),
			LocalAssetID:    preparedID,
			Kind:            strings.TrimSpace(binding.ComponentKind),
			Role:            strings.TrimSpace(binding.AssetRole),
			Status:          runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED.String(),
			Admitted:        true,
			SourceReady:     true,
		})
	}
	return facts
}

func testProfileRuntimeNativeBackendSupportedModelFamilies() []string {
	return []string{"flux", "ideogram4", "sdxl", "z-image", "z-image-turbo"}
}

func seedProfileRuntimeReadyFactsForService(t *testing.T, svc *Service, descriptor profileRuntimeDescriptor) {
	t.Helper()
	seedProfileRuntimeNativeImageBackendForService(t, svc)
	svc.mu.Lock()
	defer svc.mu.Unlock()
	for _, binding := range descriptor.AssetBindings {
		preparedID := strings.TrimSpace(binding.PreparedAssetID)
		if preparedID == "" {
			continue
		}
		kind := runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE
		if binding.AssetRole == "companion" {
			kind = runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_LORA
		}
		svc.assets[preparedID] = &runtimev1.LocalAssetRecord{
			LocalAssetId: preparedID,
			AssetId:      strings.TrimSpace(binding.ExpectedIdentity),
			Kind:         kind,
			Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
			Source:       &runtimev1.LocalAssetSource{},
		}
	}
}

func seedProfileRuntimeNativeImageBackendForService(t *testing.T, svc *Service) {
	t.Helper()
	record := verifiedSelectedSourceRecordForTest(localEnvironmentSelectedSourceRecordState{
		DependencyFamily: localEnvironmentFamilyNativeSDCPP,
		DependencyID:     "stable-diffusion.cpp.package",
		EnvironmentKey:   profileRuntimeNativeImageBackendEnvironmentKeyForTest(svc),
		SourceKind:       localEnvironmentSourceManaged,
		CanonicalRoot:    "runtime-managed/stablediffusion-ggml",
		Version:          "canonical_localai_derived",
		CompatibilityEvidence: []string{
			"managed image backend package verified from canonical_localai_derived",
			"package_source=canonical_localai_derived",
			"package_format=oci_payload",
			"launch_mode=package_entrypoint",
			"supported_model_families=" + strings.Join(testProfileRuntimeNativeBackendSupportedModelFamilies(), ","),
		},
		VerifiedArtifacts: []string{"run.sh"},
		SelectedConsumers: []string{"stable-diffusion.cpp.metal"},
		AuditReasonCode:   "LOCAL_ENVIRONMENT_DEPENDENCY_READY_MANAGED",
	})
	svc.upsertLocalEnvironmentSelectedSourceRecord(record)
}

func seedProfileRuntimeImageSelectedSourceForService(t *testing.T, svc *Service, family string, dependencyID string) {
	t.Helper()
	hostState := localEnvironmentHostProfileFromDeviceProfile(hostProfileOrCollected(nil))
	record := verifiedSelectedSourceRecordForTest(localEnvironmentSelectedSourceRecordState{
		DependencyFamily: family,
		DependencyID:     dependencyID,
		EnvironmentKey: localEnvironmentKey(
			family,
			dependencyID,
			hostState.HostProfileID,
			localEnvironmentPlatformTuple(hostState),
			svc.localEnvironmentRuntimeDataRoot(),
		),
		SourceKind:        localEnvironmentSourceImported,
		CanonicalRoot:     "runtime-managed/" + shortHash(family+"|"+dependencyID),
		Version:           "local-import",
		SelectedConsumers: []string{"stable-diffusion.cpp.metal"},
		AuditReasonCode:   "LOCAL_ENVIRONMENT_DEPENDENCY_READY_MANAGED",
		CompatibilityEvidence: []string{
			"selected-source-test",
		},
		VerifiedArtifacts: []string{
			"artifact",
		},
	})
	svc.upsertLocalEnvironmentSelectedSourceRecord(record)
}

func profileRuntimeNativeImageBackendEnvironmentKeyForTest(svc *Service) string {
	hostState := localEnvironmentHostProfileFromDeviceProfile(hostProfileOrCollected(nil))
	return localEnvironmentKey(
		localEnvironmentFamilyNativeSDCPP,
		"stable-diffusion.cpp.package",
		hostState.HostProfileID,
		localEnvironmentPlatformTuple(hostState),
		svc.localEnvironmentRuntimeDataRoot(),
	)
}

func seedProfileRuntimeLocalAssetForService(t *testing.T, svc *Service, localAssetID string, assetID string, kind runtimev1.LocalAssetKind, status runtimev1.LocalAssetStatus) {
	t.Helper()
	family := ""
	artifactRoles := []string(nil)
	switch kind {
	case runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE:
		family = normalizeManagedImageProjectionFamily(assetID)
	case runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE:
		family = "flux1-vae"
		artifactRoles = []string{"vae"}
	}
	svc.mu.Lock()
	defer svc.mu.Unlock()
	svc.assets[localAssetID] = &runtimev1.LocalAssetRecord{
		LocalAssetId:  strings.TrimSpace(localAssetID),
		AssetId:       strings.TrimSpace(assetID),
		Kind:          kind,
		Family:        family,
		ArtifactRoles: artifactRoles,
		Status:        status,
		Source:        &runtimev1.LocalAssetSource{},
	}
}

func seedProfileRuntimePreparedAssetsForService(t *testing.T, svc *Service, descriptor profileRuntimeDescriptor) {
	t.Helper()
	svc.mu.Lock()
	defer svc.mu.Unlock()
	for _, binding := range descriptor.AssetBindings {
		preparedID := strings.TrimSpace(binding.PreparedAssetID)
		if preparedID == "" {
			continue
		}
		kind := runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE
		if binding.AssetRole == "companion" {
			kind = runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_LORA
		}
		svc.assets[preparedID] = &runtimev1.LocalAssetRecord{
			LocalAssetId: preparedID,
			AssetId:      strings.TrimSpace(binding.ExpectedIdentity),
			Kind:         kind,
			Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
			Source:       &runtimev1.LocalAssetSource{},
		}
	}
}

func assertProfileRuntimePlanCompanionsReady(t *testing.T, svc *Service) {
	t.Helper()
	plan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:        "local-image-native",
		ConsumerScope: "stable-diffusion.cpp.metal",
		AssetID:       "z_image_turbo",
		LocalAssetID:  "local-z-image",
	})
	companionDeps := []localEnvironmentPlanDependency{}
	for _, dep := range plan.Dependencies {
		if dep.ReasonCode == "LOCAL_ENVIRONMENT_IMAGE_PROFILE_BINDINGS_REQUIRED" ||
			strings.HasPrefix(dep.DependencyID, "image-profile-bindings:") {
			t.Fatalf("descriptor-backed materialization must remove profile-bindings blocker: %+v", plan.Dependencies)
		}
		if dep.DependencyFamily == localEnvironmentFamilyModelCompanion {
			companionDeps = append(companionDeps, dep)
		}
	}
	if len(companionDeps) != 2 {
		t.Fatalf("expected two concrete companion dependencies, got %+v", companionDeps)
	}
	depIDs := map[string]bool{}
	for _, dep := range companionDeps {
		depIDs[dep.DependencyID] = true
	}
	if !depIDs["asset_id=z_image_ae|parent_asset_id=z_image_turbo"] ||
		!depIDs["asset_id=qwen3_4b_companion|parent_asset_id=z_image_turbo"] {
		t.Fatalf("missing concrete companion dependencies: %+v", companionDeps)
	}
}

func assertProfileRuntimePlanBindingsRequired(t *testing.T, svc *Service) {
	t.Helper()
	plan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:        "local-image-native",
		ConsumerScope: "stable-diffusion.cpp.metal",
		AssetID:       "z_image_turbo",
		LocalAssetID:  "local-z-image",
	})
	for _, dep := range plan.Dependencies {
		if dep.ReasonCode == "LOCAL_ENVIRONMENT_IMAGE_PROFILE_BINDINGS_REQUIRED" &&
			dep.DependencyID == "image-profile-bindings:local-z-image" {
			return
		}
	}
	t.Fatalf("corrupt restored materialization must keep profile-bindings blocker, got %+v", plan.Dependencies)
}

func TestServicePrepareProfileRuntimeDescriptorAcceptsSDKFormedShape(t *testing.T) {
	svc := newTestService(t)
	raw := []byte(`{
		"schema_version": 1,
		"descriptor_id": "descriptor:sdk-shape",
		"profile_ref": {
			"profile_id": "factory:runtime-shape",
			"title": "Runtime Shape"
		},
		"source_profile_digest": "sha256:runtime-shape",
		"projection_origin": {
			"component": "sdk.aiProfile.formRuntimeDescriptor",
			"projected_at": "2026-06-04T00:00:00.000Z"
		},
		"requirement_refs": ["requirement:runtime-shape"],
		"capability_slices": [
			{
				"slice_id": "slice:image",
				"capability": "image.generate",
				"execution_mode": "local",
				"contract_state": "declared",
				"readiness_policy": "required",
				"params_ref": "params:none",
				"execution": {
					"backend": "stablediffusion-ggml",
					"backend_class": "native_binary",
					"backend_family": "stablediffusion-ggml"
				},
				"model": { "family": "flux" },
				"asset_refs": ["main"],
				"ordered_companion_occurrences": [
					{
						"occurrence_id": "lora-1",
						"order": 0,
						"role": "lora",
						"engineSlot": "lora_path",
						"asset_binding_ref": "lora-a",
						"required": true
					}
				]
			},
			{
				"slice_id": "slice:text-cloud",
				"capability": "text.generate",
				"execution_mode": "cloud_connector",
				"contract_state": "declared",
				"readiness_policy": "required",
				"params_ref": "params:none",
				"provider": "openai",
				"provider_capability": "text.generate",
				"model_id": "gpt-4.1-mini",
				"credential_policy": "runtime_custody_required",
				"connector_selector": "connector:openai"
			}
		],
		"asset_bindings": [
			{
				"binding_id": "main",
				"asset_role": "main",
				"component_kind": "image",
				"source": "huggingface",
				"expected_identity": "hf:nimiplatform/z-image",
				"readiness_policy": "required",
				"prepared_asset_id": "asset:main",
				"huggingface": {
					"repo_id": "nimiplatform/z-image",
					"revision": "main",
					"entries": ["model.gguf"],
					"access_policy": "public"
				}
			},
			{
				"binding_id": "lora-a",
				"asset_role": "companion",
				"component_kind": "lora",
				"source": "huggingface",
				"expected_identity": "hf:nimiplatform/lora-a",
				"readiness_policy": "optional",
				"prepared_asset_id": "asset:lora-a",
				"huggingface": {
					"repo_id": "nimiplatform/lora-a",
					"revision": "main",
					"entries": ["lora.safetensors"],
					"access_policy": "public"
				}
			}
		]
	}`)

	result, err := svc.prepareProfileRuntimeDescriptor(context.Background(), ProfileRuntimeDescriptorPrepareRequest{
		DescriptorJSON: raw,
	})
	if err != nil {
		t.Fatalf("prepare SDK-shaped descriptor through service: %v", err)
	}
	if result.DescriptorID != "descriptor:sdk-shape" || result.ProfileID != "factory:runtime-shape" {
		t.Fatalf("unexpected descriptor identity: %+v", result)
	}
	if len(result.SliceResults) != 2 {
		t.Fatalf("expected two typed slice outcomes, got %+v", result.SliceResults)
	}
	if result.SliceResults[0].Outcome != string(profileRuntimePrepareSetupRequiredNoLiveConfig) ||
		!profileRuntimeStringSliceContains(result.SliceResults[0].ReasonCodes, "native_backend_package_source_missing") ||
		!profileRuntimeStringSliceContains(result.SliceResults[0].ReasonCodes, "prepared_asset_not_admitted") ||
		!profileRuntimeStringSliceContains(result.SliceResults[0].ReasonCodes, "required_companion_unadmitted") {
		t.Fatalf("local slice must fail closed until Runtime facts are materialized: %+v", result.SliceResults[0])
	}
	if result.SliceResults[1].Outcome != string(profileRuntimePrepareSetupRequiredNoLiveConfig) ||
		!profileRuntimeStringSliceContains(result.SliceResults[1].ReasonCodes, "credentials_required") ||
		result.SliceResults[1].MaterializationKey != "" {
		t.Fatalf("cloud connector must require runtime custody without local materialization: %+v", result.SliceResults[1])
	}
}

func TestServicePrepareProfileRuntimeDescriptorReadyAfterCanonicalMaterializationFacts(t *testing.T) {
	svc := newTestService(t)
	descriptor := testProfileRuntimeDescriptor()
	seedProfileRuntimeReadyFactsForService(t, svc, descriptor)

	result, err := svc.prepareProfileRuntimeDescriptor(context.Background(), ProfileRuntimeDescriptorPrepareRequest{
		DescriptorJSON: marshalProfileRuntimeDescriptor(t, descriptor),
	})
	if err != nil {
		t.Fatalf("prepare descriptor through service: %v", err)
	}
	if len(result.SliceResults) != 1 {
		t.Fatalf("expected one slice result, got %+v", result.SliceResults)
	}
	if result.SliceResults[0].Outcome != string(profileRuntimePrepareReady) ||
		result.SliceResults[0].MaterializationKey == "" ||
		result.SliceResults[0].WorkflowBindingID == "" ||
		!result.SliceResults[0].ReusableAssetHealthy {
		t.Fatalf("canonical materialized facts must project ready local workflow: %+v", result.SliceResults[0])
	}
}

func TestServicePrepareProfileRuntimeDescriptorCachesDescriptorBackedImageMaterializationBindings(t *testing.T) {
	svc := newTestService(t)
	descriptor := testProfileRuntimeImageCompanionDescriptor()
	seedProfileRuntimeNativeImageBackendForService(t, svc)
	seedProfileRuntimeLocalAssetForService(t, svc, "local-z-image", "z_image_turbo", runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE)
	seedProfileRuntimeLocalAssetForService(t, svc, "local-z-image-ae", "z_image_ae", runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED)
	seedProfileRuntimeLocalAssetForService(t, svc, "local-qwen3-4b", "qwen3_4b_companion", runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED)

	result, err := svc.prepareProfileRuntimeDescriptor(context.Background(), ProfileRuntimeDescriptorPrepareRequest{
		DescriptorJSON: marshalProfileRuntimeDescriptor(t, descriptor),
	})
	if err != nil {
		t.Fatalf("prepare descriptor through service: %v", err)
	}
	if len(result.SliceResults) != 1 || result.SliceResults[0].Outcome != string(profileRuntimePrepareReady) {
		t.Fatalf("expected ready descriptor materialization, got %+v", result.SliceResults)
	}
	cached, ok := svc.cachedManagedMediaImageProfile("local-z-image")
	if !ok || !cached.MaterializationResolved {
		t.Fatalf("expected descriptor-backed materialization cache, got ok=%v state=%+v", ok, cached)
	}
	if cached.Alias != result.SliceResults[0].MaterializationKey {
		t.Fatalf("cache identity must use descriptor materialization key: got=%q want=%q", cached.Alias, result.SliceResults[0].MaterializationKey)
	}
	if len(cached.Profile) != 0 {
		t.Fatalf("descriptor materialization must not synthesize executable profile body: %+v", cached.Profile)
	}
	if len(cached.MaterializationBindings) != 3 {
		t.Fatalf("expected main + AE + Qwen bindings, got %+v", cached.MaterializationBindings)
	}
	companionBySlot := map[string]managedMediaProfileMaterializationBinding{}
	for _, binding := range cached.MaterializationBindings {
		if binding.CompanionAssetID == "" {
			if binding.AssetID != "z_image_turbo" || binding.LocalAssetID != "local-z-image" {
				t.Fatalf("unexpected main binding: %+v", binding)
			}
			continue
		}
		companionBySlot[binding.EngineSlot] = binding
	}
	if got := companionBySlot["vae_path"]; got.CompanionKind != "vae" || got.CompanionAssetID != "z_image_ae" || got.ParentAssetID != "z_image_turbo" {
		t.Fatalf("unexpected AE companion binding: %+v", got)
	}
	if got := companionBySlot["llm_path"]; got.CompanionKind != "chat" || got.CompanionKind == "auxiliary" || got.CompanionAssetID != "qwen3_4b_companion" || got.ParentAssetID != "z_image_turbo" {
		t.Fatalf("Qwen text encoder must project as chat llm_path companion, got %+v", got)
	}

	plan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:        "local-image-native",
		ConsumerScope: "stable-diffusion.cpp.metal",
		AssetID:       "z_image_turbo",
		LocalAssetID:  "local-z-image",
	})
	companionDeps := []localEnvironmentPlanDependency{}
	for _, dep := range plan.Dependencies {
		if dep.ReasonCode == "LOCAL_ENVIRONMENT_IMAGE_PROFILE_BINDINGS_REQUIRED" ||
			strings.HasPrefix(dep.DependencyID, "image-profile-bindings:") {
			t.Fatalf("descriptor-backed cache must remove image-profile-bindings blocker: %+v", plan.Dependencies)
		}
		if dep.DependencyFamily == localEnvironmentFamilyModelCompanion {
			companionDeps = append(companionDeps, dep)
		}
	}
	if len(companionDeps) != 2 {
		t.Fatalf("expected two concrete companion dependencies, got %+v", companionDeps)
	}
	depIDs := map[string]bool{}
	for _, dep := range companionDeps {
		depIDs[dep.DependencyID] = true
	}
	if !depIDs["asset_id=z_image_ae|parent_asset_id=z_image_turbo"] ||
		!depIDs["asset_id=qwen3_4b_companion|parent_asset_id=z_image_turbo"] {
		t.Fatalf("missing concrete companion dependencies: %+v", companionDeps)
	}
}

func TestServicePrepareProfileRuntimeDescriptorRPCBytesClearsPlanBindings(t *testing.T) {
	svc := newTestService(t)
	descriptor := testProfileRuntimeImageCompanionDescriptor()
	seedProfileRuntimeNativeImageBackendForService(t, svc)
	seedProfileRuntimeLocalAssetForService(t, svc, "local-z-image", "z_image_turbo", runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE)
	seedProfileRuntimeLocalAssetForService(t, svc, "local-z-image-ae", "z_image_ae", runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED)
	seedProfileRuntimeLocalAssetForService(t, svc, "local-qwen3-4b", "qwen3_4b_companion", runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED)

	resp, err := svc.PrepareProfileRuntimeDescriptor(context.Background(), &runtimev1.PrepareProfileRuntimeDescriptorRequest{
		DescriptorJson: marshalProfileRuntimeDescriptor(t, descriptor),
	})
	if err != nil {
		t.Fatalf("PrepareProfileRuntimeDescriptor RPC: %v", err)
	}
	if resp.GetDescriptorId() != descriptor.DescriptorID || resp.GetProfileId() != descriptor.ProfileRef.ProfileID {
		t.Fatalf("unexpected RPC identity: %+v", resp)
	}
	if len(resp.GetSliceResults()) != 1 || resp.GetSliceResults()[0].GetOutcome() != string(profileRuntimePrepareReady) {
		t.Fatalf("expected ready RPC result, got %+v", resp.GetSliceResults())
	}
	assertProfileRuntimePlanCompanionsReady(t, svc)
}

func TestServicePrepareProfileRuntimeDescriptorRPCUsesDataRootSelectedSourceWhenServiceModelsRoot(t *testing.T) {
	svc := newTestService(t)
	descriptor := testProfileRuntimeImageCompanionDescriptor()
	modelsRoot := svc.resolvedLocalModelsPath()
	dataRoot := filepath.Dir(modelsRoot)
	hostState := localEnvironmentHostProfileFromDeviceProfile(hostProfileOrCollected(nil))
	dataRootEnvironmentKey := localEnvironmentKey(
		localEnvironmentFamilyNativeSDCPP,
		"stable-diffusion.cpp.package",
		hostState.HostProfileID,
		localEnvironmentPlatformTuple(hostState),
		dataRoot,
	)
	modelsRootEnvironmentKey := localEnvironmentKey(
		localEnvironmentFamilyNativeSDCPP,
		"stable-diffusion.cpp.package",
		hostState.HostProfileID,
		localEnvironmentPlatformTuple(hostState),
		modelsRoot,
	)
	record := verifiedSelectedSourceRecordForTest(localEnvironmentSelectedSourceRecordState{
		DependencyFamily: localEnvironmentFamilyNativeSDCPP,
		DependencyID:     "stable-diffusion.cpp.package",
		EnvironmentKey:   dataRootEnvironmentKey,
		SourceKind:       localEnvironmentSourceManaged,
		CanonicalRoot:    "runtime-managed/stablediffusion-ggml",
		Version:          "canonical_localai_derived",
		CompatibilityEvidence: []string{
			"managed image backend package verified from canonical_localai_derived",
			"package_source=canonical_localai_derived",
			"package_format=oci_payload",
			"launch_mode=package_entrypoint",
			"supported_model_families=" + strings.Join(testProfileRuntimeNativeBackendSupportedModelFamilies(), ","),
		},
		VerifiedArtifacts: []string{"run.sh"},
		SelectedConsumers: []string{"stable-diffusion.cpp.metal"},
		AuditReasonCode:   "LOCAL_ENVIRONMENT_DEPENDENCY_READY_MANAGED",
	})
	svc.upsertLocalEnvironmentSelectedSourceRecord(record)
	if _, ok := svc.localEnvironmentSelectedSourceRecord(modelsRootEnvironmentKey); ok {
		t.Fatalf("test must not seed a models-root selected source: %s", modelsRootEnvironmentKey)
	}
	seedProfileRuntimeLocalAssetForService(t, svc, "local-z-image", "z_image_turbo", runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE)
	seedProfileRuntimeLocalAssetForService(t, svc, "local-z-image-ae", "z_image_ae", runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED)
	seedProfileRuntimeLocalAssetForService(t, svc, "local-qwen3-4b", "qwen3_4b_companion", runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED)

	resp, err := svc.PrepareProfileRuntimeDescriptor(context.Background(), &runtimev1.PrepareProfileRuntimeDescriptorRequest{
		DescriptorJson: marshalProfileRuntimeDescriptor(t, descriptor),
	})
	if err != nil {
		t.Fatalf("PrepareProfileRuntimeDescriptor RPC: %v", err)
	}
	if len(resp.GetSliceResults()) != 1 || resp.GetSliceResults()[0].GetOutcome() != string(profileRuntimePrepareReady) {
		t.Fatalf("data-root selected source must satisfy native backend readiness, got %+v", resp.GetSliceResults())
	}
	if cached, ok := svc.cachedManagedMediaImageProfile("local-z-image"); !ok || !cached.MaterializationResolved {
		t.Fatalf("ready prepare must cache descriptor-backed materialization, ok=%v cached=%+v", ok, cached)
	}
}

func TestProfileRuntimeDescriptorMaterializationPersistsAcrossRestart(t *testing.T) {
	svc := newTestService(t)
	descriptor := testProfileRuntimeImageCompanionDescriptor()
	seedProfileRuntimeNativeImageBackendForService(t, svc)
	seedProfileRuntimeLocalAssetForService(t, svc, "local-z-image", "z_image_turbo", runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE)
	seedProfileRuntimeLocalAssetForService(t, svc, "local-z-image-ae", "z_image_ae", runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED)
	seedProfileRuntimeLocalAssetForService(t, svc, "local-qwen3-4b", "qwen3_4b_companion", runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED)

	result, err := svc.prepareProfileRuntimeDescriptor(context.Background(), ProfileRuntimeDescriptorPrepareRequest{
		DescriptorJSON: marshalProfileRuntimeDescriptor(t, descriptor),
	})
	if err != nil {
		t.Fatalf("prepare descriptor through service: %v", err)
	}
	if len(result.SliceResults) != 1 || result.SliceResults[0].Outcome != string(profileRuntimePrepareReady) {
		t.Fatalf("expected ready descriptor materialization, got %+v", result.SliceResults)
	}
	snapshot, err := loadLocalStateSnapshot(svc.stateStorePath)
	if err != nil {
		t.Fatalf("load persisted state: %v", err)
	}
	if len(snapshot.ManagedImageProfileMaterializations) != 1 {
		t.Fatalf("expected one persisted materialization projection, got %+v", snapshot.ManagedImageProfileMaterializations)
	}
	if len(snapshot.ManagedImageProfileMaterializations[0].MaterializationBindings) != 3 {
		t.Fatalf("expected main + companion persisted bindings, got %+v", snapshot.ManagedImageProfileMaterializations[0])
	}

	restored, err := New(svc.logger, nil, svc.stateStorePath, 0, svc.localModelsPath)
	if err != nil {
		t.Fatalf("restore service: %v", err)
	}
	defer restored.Close()
	assertProfileRuntimePlanCompanionsReady(t, restored)
}

func TestProfileRuntimeDescriptorMaterializationHealsFromReadySelectedSourcesOnPlan(t *testing.T) {
	svc := newTestService(t)
	seedProfileRuntimeLocalAssetForService(t, svc, "local-z-image", "z_image_turbo", runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE)
	seedProfileRuntimeLocalAssetForService(t, svc, "local-z-image-ae", "z_image_ae", runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED)
	seedProfileRuntimeLocalAssetForService(t, svc, "local-qwen3-4b", "qwen3_4b_companion", runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED)
	seedProfileRuntimeImageSelectedSourceForService(t, svc, localEnvironmentFamilyModelAsset, "z_image_turbo")
	seedProfileRuntimeImageSelectedSourceForService(t, svc, localEnvironmentFamilyModelCompanion, "asset_id=z_image_ae|parent_asset_id=z_image_turbo")
	seedProfileRuntimeImageSelectedSourceForService(t, svc, localEnvironmentFamilyModelCompanion, "asset_id=qwen3_4b_companion|parent_asset_id=z_image_turbo")

	if cached, ok := svc.cachedManagedMediaImageProfile("local-z-image"); ok && cached.MaterializationResolved {
		t.Fatalf("test must start without a materialization cache, got %+v", cached)
	}

	assertProfileRuntimePlanCompanionsReady(t, svc)
	cached, ok := svc.cachedManagedMediaImageProfile("local-z-image")
	if !ok || !cached.MaterializationResolved || len(cached.MaterializationBindings) != 3 {
		t.Fatalf("plan resolution must heal materialization bindings from selected sources, ok=%v cached=%+v", ok, cached)
	}
}

func TestProfileRuntimeDescriptorMaterializationHealsFromReadySelectedSourcesAcrossRestart(t *testing.T) {
	svc := newTestService(t)
	seedProfileRuntimeLocalAssetForService(t, svc, "local-z-image", "z_image_turbo", runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE)
	seedProfileRuntimeLocalAssetForService(t, svc, "local-z-image-ae", "z_image_ae", runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED)
	seedProfileRuntimeLocalAssetForService(t, svc, "local-qwen3-4b", "qwen3_4b_companion", runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED)
	seedProfileRuntimeImageSelectedSourceForService(t, svc, localEnvironmentFamilyModelAsset, "z_image_turbo")
	seedProfileRuntimeImageSelectedSourceForService(t, svc, localEnvironmentFamilyModelCompanion, "asset_id=z_image_ae|parent_asset_id=z_image_turbo")
	seedProfileRuntimeImageSelectedSourceForService(t, svc, localEnvironmentFamilyModelCompanion, "asset_id=qwen3_4b_companion|parent_asset_id=z_image_turbo")

	snapshot, err := loadLocalStateSnapshot(svc.stateStorePath)
	if err != nil {
		t.Fatalf("load pre-restore state: %v", err)
	}
	if len(snapshot.ManagedImageProfileMaterializations) != 0 {
		t.Fatalf("test must persist selected sources without materialization cache, got %+v", snapshot.ManagedImageProfileMaterializations)
	}

	restored, err := New(svc.logger, nil, svc.stateStorePath, 0, svc.localModelsPath)
	if err != nil {
		t.Fatalf("restore service: %v", err)
	}
	defer restored.Close()
	assertProfileRuntimePlanCompanionsReady(t, restored)
	cached, ok := restored.cachedManagedMediaImageProfile("local-z-image")
	if !ok || !cached.MaterializationResolved || len(cached.MaterializationBindings) != 3 {
		t.Fatalf("restore must heal materialization bindings from selected sources, ok=%v cached=%+v", ok, cached)
	}
}

func TestProfileRuntimeDescriptorMaterializationRestoreFailsClosedForCorruptState(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(*localStateSnapshot)
	}{
		{
			name: "missing local asset id",
			mutate: func(snapshot *localStateSnapshot) {
				snapshot.ManagedImageProfileMaterializations[0].LocalAssetID = ""
			},
		},
		{
			name: "main binding mismatch",
			mutate: func(snapshot *localStateSnapshot) {
				snapshot.ManagedImageProfileMaterializations[0].MaterializationBindings[0].LocalAssetID = "local-other-image"
			},
		},
		{
			name: "companion binding incomplete",
			mutate: func(snapshot *localStateSnapshot) {
				snapshot.ManagedImageProfileMaterializations[0].MaterializationBindings[1].EngineSlot = ""
			},
		},
		{
			name: "referenced companion asset absent",
			mutate: func(snapshot *localStateSnapshot) {
				filtered := snapshot.Assets[:0]
				for _, asset := range snapshot.Assets {
					if asset.AssetID == "qwen3_4b_companion" {
						continue
					}
					filtered = append(filtered, asset)
				}
				snapshot.Assets = filtered
			},
		},
		{
			name: "referenced companion asset unadmitted",
			mutate: func(snapshot *localStateSnapshot) {
				for index := range snapshot.Assets {
					if snapshot.Assets[index].AssetID == "qwen3_4b_companion" {
						snapshot.Assets[index].Status = int32(runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_REMOVED)
					}
				}
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			svc := newTestService(t)
			descriptor := testProfileRuntimeImageCompanionDescriptor()
			seedProfileRuntimeNativeImageBackendForService(t, svc)
			seedProfileRuntimeLocalAssetForService(t, svc, "local-z-image", "z_image_turbo", runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE)
			seedProfileRuntimeLocalAssetForService(t, svc, "local-z-image-ae", "z_image_ae", runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED)
			seedProfileRuntimeLocalAssetForService(t, svc, "local-qwen3-4b", "qwen3_4b_companion", runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED)
			if _, err := svc.prepareProfileRuntimeDescriptor(context.Background(), ProfileRuntimeDescriptorPrepareRequest{
				DescriptorJSON: marshalProfileRuntimeDescriptor(t, descriptor),
			}); err != nil {
				t.Fatalf("prepare descriptor through service: %v", err)
			}
			snapshot, err := loadLocalStateSnapshot(svc.stateStorePath)
			if err != nil {
				t.Fatalf("load persisted state: %v", err)
			}
			if len(snapshot.ManagedImageProfileMaterializations) != 1 {
				t.Fatalf("expected one persisted materialization before corruption, got %+v", snapshot.ManagedImageProfileMaterializations)
			}
			tc.mutate(&snapshot)
			if err := saveLocalStateSnapshot(svc.stateStorePath, snapshot); err != nil {
				t.Fatalf("write corrupted state: %v", err)
			}

			restored, err := New(svc.logger, nil, svc.stateStorePath, 0, svc.localModelsPath)
			if err != nil {
				t.Fatalf("restore corrupted service: %v", err)
			}
			defer restored.Close()
			assertProfileRuntimePlanBindingsRequired(t, restored)
		})
	}
}

func TestServicePrepareProfileRuntimeDescriptorMissingCompanionDoesNotCacheMaterialization(t *testing.T) {
	svc := newTestService(t)
	descriptor := testProfileRuntimeImageCompanionDescriptor()
	seedProfileRuntimeNativeImageBackendForService(t, svc)
	seedProfileRuntimeLocalAssetForService(t, svc, "local-z-image", "z_image_turbo", runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE)
	seedProfileRuntimeLocalAssetForService(t, svc, "local-z-image-ae", "z_image_ae", runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED)

	result, err := svc.prepareProfileRuntimeDescriptor(context.Background(), ProfileRuntimeDescriptorPrepareRequest{
		DescriptorJSON: marshalProfileRuntimeDescriptor(t, descriptor),
	})
	if err != nil {
		t.Fatalf("prepare descriptor through service: %v", err)
	}
	if result.SliceResults[0].Outcome != string(profileRuntimePrepareSetupRequiredNoLiveConfig) ||
		!profileRuntimeStringSliceContains(result.SliceResults[0].ReasonCodes, "required_companion_unadmitted") {
		t.Fatalf("missing Qwen companion must fail closed: %+v", result.SliceResults[0])
	}
	if cached, ok := svc.cachedManagedMediaImageProfile("local-z-image"); ok && cached.MaterializationResolved {
		t.Fatalf("missing companion must not cache ready bindings: %+v", cached)
	}
	plan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:        "local-image-native",
		ConsumerScope: "stable-diffusion.cpp.metal",
		AssetID:       "z_image_turbo",
		LocalAssetID:  "local-z-image",
	})
	foundBlocker := false
	for _, dep := range plan.Dependencies {
		if dep.ReasonCode == "LOCAL_ENVIRONMENT_IMAGE_PROFILE_BINDINGS_REQUIRED" &&
			dep.DependencyID == "image-profile-bindings:local-z-image" {
			foundBlocker = true
		}
	}
	if !foundBlocker {
		t.Fatalf("missing descriptor materialization must keep profile-bindings blocker, got %+v", plan.Dependencies)
	}
}

func TestServicePrepareProfileRuntimeDescriptorIgnoresOldHostSelectedSource(t *testing.T) {
	svc := newTestService(t)
	descriptor := testProfileRuntimeImageCompanionDescriptor()
	oldHostRecord := verifiedSelectedSourceRecordForTest(localEnvironmentSelectedSourceRecordState{
		DependencyFamily: localEnvironmentFamilyNativeSDCPP,
		DependencyID:     "stable-diffusion.cpp.package",
		EnvironmentKey:   "native-engine-package.stablediffusion-ggml|stable-diffusion.cpp.package|old-host|darwin/arm64|old-runtime-data",
		SourceKind:       localEnvironmentSourceManaged,
		CanonicalRoot:    "runtime-managed/stablediffusion-ggml",
		Version:          "canonical_localai_derived",
		CompatibilityEvidence: []string{
			"managed image backend package verified from canonical_localai_derived",
			"package_source=canonical_localai_derived",
			"package_format=oci_payload",
			"launch_mode=package_entrypoint",
		},
		VerifiedArtifacts: []string{"run.sh"},
		SelectedConsumers: []string{"stable-diffusion.cpp.metal"},
		AuditReasonCode:   "LOCAL_ENVIRONMENT_DEPENDENCY_READY_MANAGED",
	})
	svc.upsertLocalEnvironmentSelectedSourceRecord(oldHostRecord)
	seedProfileRuntimeLocalAssetForService(t, svc, "local-z-image", "z_image_turbo", runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE)
	seedProfileRuntimeLocalAssetForService(t, svc, "local-z-image-ae", "z_image_ae", runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED)
	seedProfileRuntimeLocalAssetForService(t, svc, "local-qwen3-4b", "qwen3_4b_companion", runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED)

	result, err := svc.prepareProfileRuntimeDescriptor(context.Background(), ProfileRuntimeDescriptorPrepareRequest{
		DescriptorJSON: marshalProfileRuntimeDescriptor(t, descriptor),
	})
	if err != nil {
		t.Fatalf("prepare descriptor through service: %v", err)
	}
	if result.SliceResults[0].Outcome != string(profileRuntimePrepareSetupRequiredNoLiveConfig) ||
		!profileRuntimeStringSliceContains(result.SliceResults[0].ReasonCodes, "native_backend_package_source_missing") {
		t.Fatalf("old host selected source must not prove backend readiness: %+v", result.SliceResults[0])
	}
	if cached, ok := svc.cachedManagedMediaImageProfile("local-z-image"); ok && cached.MaterializationResolved {
		t.Fatalf("old host selected source must not cache ready materialization: %+v", cached)
	}
}

func TestServicePrepareProfileRuntimeDescriptorRejectsCompanionIdentityAndKindMismatchWithoutCache(t *testing.T) {
	cases := []struct {
		name       string
		assetID    string
		kind       runtimev1.LocalAssetKind
		reasonCode string
	}{
		{
			name:       "identity mismatch",
			assetID:    "qwen3_wrong_asset",
			kind:       runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT,
			reasonCode: "prepared_asset_identity_mismatch",
		},
		{
			name:       "kind mismatch",
			assetID:    "qwen3_4b_companion",
			kind:       runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_AUXILIARY,
			reasonCode: "prepared_asset_kind_mismatch",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			svc := newTestService(t)
			descriptor := testProfileRuntimeImageCompanionDescriptor()
			seedProfileRuntimeNativeImageBackendForService(t, svc)
			seedProfileRuntimeLocalAssetForService(t, svc, "local-z-image", "z_image_turbo", runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE)
			seedProfileRuntimeLocalAssetForService(t, svc, "local-z-image-ae", "z_image_ae", runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED)
			seedProfileRuntimeLocalAssetForService(t, svc, "local-qwen3-4b", tc.assetID, tc.kind, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED)

			result, err := svc.prepareProfileRuntimeDescriptor(context.Background(), ProfileRuntimeDescriptorPrepareRequest{
				DescriptorJSON: marshalProfileRuntimeDescriptor(t, descriptor),
			})
			if err != nil {
				t.Fatalf("prepare descriptor through service: %v", err)
			}
			if result.SliceResults[0].Outcome != string(profileRuntimePrepareSetupRequiredNoLiveConfig) ||
				!profileRuntimeStringSliceContains(result.SliceResults[0].ReasonCodes, tc.reasonCode) {
				t.Fatalf("expected %s fail-closed reason, got %+v", tc.reasonCode, result.SliceResults[0])
			}
			if cached, ok := svc.cachedManagedMediaImageProfile("local-z-image"); ok && cached.MaterializationResolved {
				t.Fatalf("mismatch must not cache ready materialization: %+v", cached)
			}
		})
	}
}

func TestProfileRuntimePrepareRejectsNonCanonicalNativePackageFacts(t *testing.T) {
	descriptor := testProfileRuntimeDescriptor()
	facts := testProfileRuntimeReadyFacts(descriptor)
	facts.NativeBackendPackages[0].PackageSource = "experimental_official_sdcpp"
	facts.NativeBackendPackages[0].PackageFormat = "direct_archive"
	facts.NativeBackendPackages[0].LaunchMode = "runtime_wrapper"

	validated, err := validateProfileRuntimeDescriptor(marshalProfileRuntimeDescriptor(t, descriptor))
	if err != nil {
		t.Fatalf("validate descriptor: %v", err)
	}
	results, err := prepareProfileRuntimeDescriptorWithFacts(validated, facts)
	if err != nil {
		t.Fatalf("prepare descriptor: %v", err)
	}
	if results[0].Outcome != profileRuntimePrepareSetupRequiredNoLiveConfig ||
		!profileRuntimeStringSliceContains(results[0].ReasonCodes, "native_backend_package_source_not_supported") {
		t.Fatalf("official direct archive facts must fail closed: %+v", results[0])
	}

	facts = testProfileRuntimeReadyFacts(descriptor)
	facts.NativeBackendPackages[0].SourceKind = localEnvironmentSourceSystem
	facts.NativeBackendPackages[0].CanonicalRoot = "PATH"
	results, err = prepareProfileRuntimeDescriptorWithFacts(validated, facts)
	if err != nil {
		t.Fatalf("prepare descriptor with PATH-only facts: %v", err)
	}
	if results[0].Outcome != profileRuntimePrepareSetupRequiredNoLiveConfig ||
		!profileRuntimeStringSliceContains(results[0].ReasonCodes, "native_backend_package_source_not_canonical_oci") {
		t.Fatalf("PATH-only/system native package facts must fail closed: %+v", results[0])
	}
}

func TestProfileRuntimePrepareAcceptsWindowsRuntimeWrapperNativePackageFacts(t *testing.T) {
	descriptor := testProfileRuntimeDescriptor()
	descriptor.CapabilitySlices[0].RuntimeConsumerID = "stable-diffusion.cpp.cuda"
	facts := testProfileRuntimeReadyFacts(descriptor)
	facts.NativeBackendPackages[0].SelectedConsumers = []string{"stable-diffusion.cpp.cuda"}
	facts.NativeBackendPackages[0].PackageSource = "canonical_runtime_wrapper"
	facts.NativeBackendPackages[0].PackageFormat = "direct_archive"
	facts.NativeBackendPackages[0].LaunchMode = "runtime_wrapper"
	facts.NativeBackendPackages[0].SelectedSourceRecordID = "src_windows_runtime_wrapper"

	validated, err := validateProfileRuntimeDescriptor(marshalProfileRuntimeDescriptor(t, descriptor))
	if err != nil {
		t.Fatalf("validate descriptor: %v", err)
	}
	results, err := prepareProfileRuntimeDescriptorWithFacts(validated, facts)
	if err != nil {
		t.Fatalf("prepare descriptor: %v", err)
	}
	if results[0].Outcome != profileRuntimePrepareReady || results[0].MaterializationKey == "" {
		t.Fatalf("Windows runtime wrapper facts must satisfy cuda slice: %+v", results[0])
	}
}

func TestProfileRuntimePrepareRejectsWrongNativeConsumerAndSource(t *testing.T) {
	descriptor := testProfileRuntimeDescriptor()
	descriptor.CapabilitySlices[0].RuntimeConsumerID = "stable-diffusion.cpp.cuda"
	facts := testProfileRuntimeReadyFacts(descriptor)

	validated, err := validateProfileRuntimeDescriptor(marshalProfileRuntimeDescriptor(t, descriptor))
	if err != nil {
		t.Fatalf("validate descriptor: %v", err)
	}
	results, err := prepareProfileRuntimeDescriptorWithFacts(validated, facts)
	if err != nil {
		t.Fatalf("prepare descriptor: %v", err)
	}
	if results[0].Outcome != profileRuntimePrepareSetupRequiredNoLiveConfig ||
		!profileRuntimeStringSliceContains(results[0].ReasonCodes, "native_backend_package_consumer_mismatch") {
		t.Fatalf("metal source must not satisfy cuda slice: %+v", results[0])
	}

	facts.NativeBackendPackages[0].SelectedConsumers = []string{"stable-diffusion.cpp.cuda"}
	results, err = prepareProfileRuntimeDescriptorWithFacts(validated, facts)
	if err != nil {
		t.Fatalf("prepare descriptor with wrong source: %v", err)
	}
	if results[0].Outcome != profileRuntimePrepareSetupRequiredNoLiveConfig ||
		!profileRuntimeStringSliceContains(results[0].ReasonCodes, "native_backend_package_source_not_supported") {
		t.Fatalf("LocalAI OCI source must not satisfy cuda slice: %+v", results[0])
	}
}

func TestProfileRuntimePrepareFailsClosedForPreparedAssetExactMismatch(t *testing.T) {
	descriptor := testProfileRuntimeDescriptor()
	facts := testProfileRuntimeReadyFacts(descriptor)
	for index := range facts.PreparedAssets {
		if facts.PreparedAssets[index].PreparedAssetID == "asset:main" {
			facts.PreparedAssets[index].PreparedAssetID = "asset:other-main"
			facts.PreparedAssets[index].LocalAssetID = "asset:other-main"
		}
	}

	validated, err := validateProfileRuntimeDescriptor(marshalProfileRuntimeDescriptor(t, descriptor))
	if err != nil {
		t.Fatalf("validate descriptor: %v", err)
	}
	results, err := prepareProfileRuntimeDescriptorWithFacts(validated, facts)
	if err != nil {
		t.Fatalf("prepare descriptor: %v", err)
	}
	if results[0].Outcome != profileRuntimePrepareSetupRequiredNoLiveConfig ||
		!profileRuntimeStringSliceContains(results[0].ReasonCodes, "prepared_asset_not_admitted") {
		t.Fatalf("expected identity alone must not satisfy prepared binding: %+v", results[0])
	}
}

func TestProfileRuntimePrepareFailsClosedForPreparedAssetRoleMismatch(t *testing.T) {
	descriptor := testProfileRuntimeDescriptor()
	facts := testProfileRuntimeReadyFacts(descriptor)
	for index := range facts.PreparedAssets {
		if facts.PreparedAssets[index].PreparedAssetID == "asset:lora-a" {
			facts.PreparedAssets[index].Role = "main"
		}
	}

	validated, err := validateProfileRuntimeDescriptor(marshalProfileRuntimeDescriptor(t, descriptor))
	if err != nil {
		t.Fatalf("validate descriptor: %v", err)
	}
	results, err := prepareProfileRuntimeDescriptorWithFacts(validated, facts)
	if err != nil {
		t.Fatalf("prepare descriptor: %v", err)
	}
	if results[0].Outcome != profileRuntimePrepareSetupRequiredNoLiveConfig ||
		!profileRuntimeStringSliceContains(results[0].ReasonCodes, "prepared_asset_role_mismatch") {
		t.Fatalf("prepared asset role mismatch must fail closed: %+v", results[0])
	}
}

func TestProfileRuntimePrepareFailsClosedForQwenBackupOnlyCompanion(t *testing.T) {
	descriptor := testProfileRuntimeDescriptor()
	descriptor.AssetBindings[1].ComponentKind = "chat"
	descriptor.AssetBindings[1].ExpectedIdentity = "backup:Qwen3-4B-Q4_K_M.gguf"
	descriptor.AssetBindings[1].PreparedAssetID = "asset:qwen3-4b-backup"
	descriptor.CapabilitySlices[0].OrderedCompanionOccurrences[0].Role = "text_encoder"
	descriptor.CapabilitySlices[0].OrderedCompanionOccurrences[0].EngineSlot = "llm_path"
	descriptor.CapabilitySlices[0].OrderedCompanionOccurrences[1].Role = "text_encoder"
	descriptor.CapabilitySlices[0].OrderedCompanionOccurrences[1].EngineSlot = "llm_path_secondary"
	facts := testProfileRuntimeReadyFacts(descriptor)
	filtered := facts.PreparedAssets[:0]
	for _, fact := range facts.PreparedAssets {
		if fact.PreparedAssetID == "asset:qwen3-4b-backup" {
			continue
		}
		filtered = append(filtered, fact)
	}
	facts.PreparedAssets = filtered

	validated, err := validateProfileRuntimeDescriptor(marshalProfileRuntimeDescriptor(t, descriptor))
	if err != nil {
		t.Fatalf("validate descriptor: %v", err)
	}
	results, err := prepareProfileRuntimeDescriptorWithFacts(validated, facts)
	if err != nil {
		t.Fatalf("prepare descriptor: %v", err)
	}
	if results[0].Outcome != profileRuntimePrepareSetupRequiredNoLiveConfig ||
		!profileRuntimeStringSliceContains(results[0].ReasonCodes, "required_companion_unadmitted") {
		t.Fatalf("Qwen backup-only file must not satisfy admitted companion readiness: %+v", results[0])
	}
	if !results[0].ReusableAssetHealthy {
		t.Fatalf("backup-only companion failure must not poison reusable main asset health: %+v", results[0])
	}
}

func TestProfileRuntimePrepareFailsClosedForSourceUnreadyRequiredCompanion(t *testing.T) {
	descriptor := testProfileRuntimeDescriptor()
	facts := testProfileRuntimeReadyFacts(descriptor)
	for index := range facts.PreparedAssets {
		if facts.PreparedAssets[index].PreparedAssetID == "asset:lora-a" {
			facts.PreparedAssets[index].SourceReady = false
		}
	}

	validated, err := validateProfileRuntimeDescriptor(marshalProfileRuntimeDescriptor(t, descriptor))
	if err != nil {
		t.Fatalf("validate descriptor: %v", err)
	}
	results, err := prepareProfileRuntimeDescriptorWithFacts(validated, facts)
	if err != nil {
		t.Fatalf("prepare descriptor: %v", err)
	}
	if results[0].Outcome != profileRuntimePrepareSetupRequiredNoLiveConfig ||
		!profileRuntimeStringSliceContains(results[0].ReasonCodes, "prepared_asset_source_unready") {
		t.Fatalf("source-unready required companion must fail closed: %+v", results[0])
	}
}

func TestServicePrepareAfterFailedNativeSetupRetryDoesNotPoisonReusableAssetHealth(t *testing.T) {
	svc := newTestService(t)
	descriptor := testProfileRuntimeDescriptor()
	seedProfileRuntimePreparedAssetsForService(t, svc, descriptor)
	svc.SetEngineManager(&mockEngineManager{
		ensureManagedImageBackendErr: os.ErrNotExist,
	})
	dep := nativeSDCPPPlanDependencyForTest(t, svc, "stable-diffusion.cpp.metal", localEnvironmentAppleSilicon128GBProfile())

	startResp, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   dep.EnvironmentKey,
		DependencyFamily: dep.DependencyFamily,
		DependencyId:     dep.DependencyID,
		Confirmed:        true,
	})
	if err != nil {
		t.Fatalf("StartLocalEnvironmentDependencyJob: %v", err)
	}
	job := awaitLocalEnvironmentDependencyJobTerminal(t, svc, startResp.GetJob().GetJobId())
	if job.GetState() != localEnvironmentStateFailed || job.GetSelectedSourceRecordId() != "" {
		t.Fatalf("failed setup must not promote selected source: %+v", job)
	}
	if _, ok := svc.localEnvironmentSelectedSourceRecord(job.GetEnvironmentKey()); ok {
		t.Fatal("failed setup retry must not leave reusable ready selected source")
	}

	result, err := svc.prepareProfileRuntimeDescriptor(context.Background(), ProfileRuntimeDescriptorPrepareRequest{
		DescriptorJSON: marshalProfileRuntimeDescriptor(t, descriptor),
	})
	if err != nil {
		t.Fatalf("prepare after failed setup: %v", err)
	}
	if result.SliceResults[0].Outcome != string(profileRuntimePrepareSetupRequiredNoLiveConfig) ||
		!profileRuntimeStringSliceContains(result.SliceResults[0].ReasonCodes, "native_backend_package_source_missing") ||
		!result.SliceResults[0].ReusableAssetHealthy {
		t.Fatalf("failed native setup must remain setup-required without poisoning asset health: %+v", result.SliceResults[0])
	}
}

func TestServicePrepareProfileRuntimeDescriptorKeepsRequiredUnsupportedSlices(t *testing.T) {
	svc := newTestService(t)
	descriptor := testProfileRuntimeDescriptor()
	descriptor.CapabilitySlices = []profileRuntimeDescriptorCapability{
		{
			SliceID:         "slice:diffusers",
			Capability:      "image.generate",
			ExecutionMode:   "local",
			ContractState:   "proposed",
			ReadinessPolicy: "required",
			ParamsRef:       "params:none",
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
			ParamsRef:       "params:none",
			Execution:       profileRuntimeDescriptorExecution{Backend: "video.pipeline", BackendClass: "python_pipeline", BackendFamily: "video-python"},
			Model:           profileRuntimeDescriptorModel{Family: "wan"},
			AssetRefs:       []string{"main"},
		},
	}

	result, err := svc.prepareProfileRuntimeDescriptor(context.Background(), ProfileRuntimeDescriptorPrepareRequest{
		DescriptorJSON: marshalProfileRuntimeDescriptor(t, descriptor),
	})
	if err != nil {
		t.Fatalf("prepare required no-live-config slices through service: %v", err)
	}
	if len(result.SliceResults) != 2 {
		t.Fatalf("required slices were dropped before service readiness: %+v", result.SliceResults)
	}
	if result.SliceResults[0].Outcome != string(profileRuntimePrepareSetupRequiredNoLiveConfig) ||
		!profileRuntimeStringSliceContains(result.SliceResults[0].ReasonCodes, "environment_materializer_unready") {
		t.Fatalf("diffusers proposed slice did not fail closed: %+v", result.SliceResults[0])
	}
	if result.SliceResults[1].Outcome != string(profileRuntimePrepareUnsupportedNoLiveConfig) ||
		!profileRuntimeStringSliceContains(result.SliceResults[1].ReasonCodes, "workflow_video_backend_unavailable") {
		t.Fatalf("unsupported video slice did not fail closed: %+v", result.SliceResults[1])
	}
}
