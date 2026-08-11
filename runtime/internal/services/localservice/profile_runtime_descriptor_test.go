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
	descriptor := testProfileRuntimeImageCompanionDescriptor()
	descriptor.DescriptorID = "descriptor:test"
	descriptor.ProfileRef = profileRuntimeDescriptorProfileRef{ProfileID: "profile:test", Version: "1"}
	descriptor.SourceProfileDigest = "sha256:test"
	descriptor.RequirementRefs = []string{"requirement:test"}
	descriptor.CapabilitySlices[0].SliceID = "slice:image"
	return descriptor
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
	portable := descriptor
	portable.AssetBindings = append([]profileRuntimeDescriptorAssetBinding(nil), descriptor.AssetBindings...)
	for index := range portable.AssetBindings {
		portable.AssetBindings[index].PreparedAssetID = ""
	}
	portable.CapabilitySlices = append([]profileRuntimeDescriptorCapability(nil), descriptor.CapabilitySlices...)
	for index := range portable.CapabilitySlices {
		portable.CapabilitySlices[index].OrderedCompanionOccurrences = append(
			[]profileRuntimeDescriptorCompanionOccurrence(nil),
			descriptor.CapabilitySlices[index].OrderedCompanionOccurrences...,
		)
		for occurrenceIndex := range portable.CapabilitySlices[index].OrderedCompanionOccurrences {
			portable.CapabilitySlices[index].OrderedCompanionOccurrences[occurrenceIndex].PreparedAssetID = ""
		}
	}
	raw, err := json.Marshal(portable)
	if err != nil {
		t.Fatalf("marshal descriptor: %v", err)
	}
	return raw
}

func marshalProfileRuntimeDescriptorWithPreparedAssetsForTest(t *testing.T, descriptor profileRuntimeDescriptor) []byte {
	t.Helper()
	raw, err := json.Marshal(descriptor)
	if err != nil {
		t.Fatalf("marshal descriptor with prepared assets: %v", err)
	}
	return raw
}

func applyProfileRuntimePreparedAssetsForInternalTest(
	validated *profileRuntimeDescriptor,
	source profileRuntimeDescriptor,
) {
	if validated == nil {
		return
	}
	preparedByBindingID := map[string]string{}
	for _, binding := range source.AssetBindings {
		preparedByBindingID[strings.TrimSpace(binding.BindingID)] = strings.TrimSpace(binding.PreparedAssetID)
	}
	for index := range validated.AssetBindings {
		validated.AssetBindings[index].PreparedAssetID = preparedByBindingID[strings.TrimSpace(validated.AssetBindings[index].BindingID)]
	}
	preparedByOccurrenceID := map[string]string{}
	for _, slice := range source.CapabilitySlices {
		for _, occurrence := range slice.OrderedCompanionOccurrences {
			preparedByOccurrenceID[strings.TrimSpace(occurrence.OccurrenceID)] = strings.TrimSpace(occurrence.PreparedAssetID)
		}
	}
	for sliceIndex := range validated.CapabilitySlices {
		for occurrenceIndex := range validated.CapabilitySlices[sliceIndex].OrderedCompanionOccurrences {
			occurrence := &validated.CapabilitySlices[sliceIndex].OrderedCompanionOccurrences[occurrenceIndex]
			occurrence.PreparedAssetID = preparedByOccurrenceID[strings.TrimSpace(occurrence.OccurrenceID)]
		}
	}
}

func validateProfileRuntimeDescriptorForInternalTest(
	t *testing.T,
	descriptor profileRuntimeDescriptor,
) *profileRuntimeDescriptor {
	t.Helper()
	validated, err := validateProfileRuntimeDescriptor(marshalProfileRuntimeDescriptor(t, descriptor))
	if err != nil {
		t.Fatalf("validate portable descriptor: %v", err)
	}
	applyProfileRuntimePreparedAssetsForInternalTest(validated, descriptor)
	return validated
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

func seedProfileRuntimePortableSelectedSourcesForService(
	t *testing.T,
	svc *Service,
	descriptor profileRuntimeDescriptor,
	includedBindingIDs ...string,
) {
	t.Helper()
	included := make(map[string]bool, len(includedBindingIDs))
	for _, bindingID := range includedBindingIDs {
		included[strings.TrimSpace(bindingID)] = true
	}
	shouldInclude := func(binding profileRuntimeDescriptorAssetBinding) bool {
		return len(included) == 0 || included[strings.TrimSpace(binding.BindingID)]
	}
	var mainBinding *profileRuntimeDescriptorAssetBinding
	for index := range descriptor.AssetBindings {
		binding := &descriptor.AssetBindings[index]
		if shouldInclude(*binding) && strings.TrimSpace(binding.AssetRole) == "main" {
			mainBinding = binding
			break
		}
	}
	if mainBinding == nil {
		t.Fatal("portable selected-source fixture requires a main binding")
	}
	modelsRoot := svc.resolvedLocalModelsPath()
	seedBinding := func(
		binding profileRuntimeDescriptorAssetBinding,
		family string,
		parentAssetID string,
		parentRecordID string,
	) localEnvironmentSelectedSourceRecordState {
		t.Helper()
		localAssetID := strings.TrimSpace(binding.PreparedAssetID)
		if localAssetID == "" {
			t.Fatalf("binding %q fixture requires an internal local asset id", binding.BindingID)
		}
		asset := &runtimev1.LocalAssetRecord{
			LocalAssetId:   localAssetID,
			AssetId:        strings.TrimSpace(binding.ExpectedIdentity),
			LogicalModelId: "logical-model-" + strings.TrimSpace(binding.BindingID),
			Kind:           profileRuntimeAssetKindForComponentKindForTest(binding.ComponentKind),
			Status:         runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
			Source:         &runtimev1.LocalAssetSource{},
		}
		switch strings.TrimSpace(binding.Source) {
		case "huggingface":
			if binding.HuggingFace == nil || len(binding.HuggingFace.Entries) != 1 {
				t.Fatalf("binding %q fixture requires one Hugging Face entry", binding.BindingID)
			}
			asset.Entry = strings.TrimSpace(binding.HuggingFace.Entries[0])
			asset.Source.Repo = strings.TrimSpace(binding.HuggingFace.RepoID)
			asset.Source.Revision = strings.TrimSpace(binding.HuggingFace.Revision)
		case "manual":
			if binding.Manual == nil {
				t.Fatalf("binding %q fixture requires a manual source", binding.BindingID)
			}
			asset.Entry = strings.TrimSpace(binding.Manual.ExpectedName)
			asset.SourceFileName = strings.TrimSpace(binding.Manual.ExpectedName)
		default:
			t.Fatalf("binding %q fixture has unsupported source %q", binding.BindingID, binding.Source)
		}
		if strings.TrimSpace(binding.AssetRole) == "main" {
			asset.Status = runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE
			asset.Family = normalizeManagedImageProjectionFamily(binding.ExpectedIdentity)
			asset.EngineConfig = mustStructForTest(t, map[string]any{"backend": "stablediffusion-ggml"})
		}
		if asset.Kind == runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE {
			asset.Family = "flux1-vae"
			asset.ArtifactRoles = []string{"vae"}
		}
		svc.mu.Lock()
		svc.assets[localAssetID] = asset
		svc.mu.Unlock()
		entryPath := writeProfileRuntimeSelectedSourceEntryFixture(t, modelsRoot, asset, "selected-source-entry:"+binding.BindingID)
		resolvedEntryPath, err := resolveManagedModelEntryAbsolutePath(modelsRoot, asset)
		if err != nil {
			t.Fatalf("resolve binding %q fixture entry: %v", binding.BindingID, err)
		}
		if filepath.Clean(entryPath) != filepath.Clean(resolvedEntryPath) {
			t.Fatalf("binding %q fixture path mismatch: wrote=%q resolved=%q", binding.BindingID, entryPath, resolvedEntryPath)
		}
		return seedProfileRuntimePreparedAssetSelectedSourceForService(
			t,
			svc,
			family,
			asset,
			parentAssetID,
			parentRecordID,
			entryPath,
		)
	}
	mainRecord := seedBinding(*mainBinding, localEnvironmentFamilyModelAsset, "", "")
	for _, binding := range descriptor.AssetBindings {
		if !shouldInclude(binding) || strings.TrimSpace(binding.AssetRole) != "companion" {
			continue
		}
		seedBinding(
			binding,
			localEnvironmentFamilyModelCompanion,
			strings.TrimSpace(mainBinding.ExpectedIdentity),
			strings.TrimSpace(mainRecord.RecordID),
		)
	}
}

func writeProfileRuntimeSelectedSourceEntryFixture(
	t *testing.T,
	modelsRoot string,
	asset *runtimev1.LocalAssetRecord,
	content string,
) string {
	t.Helper()
	if asset == nil {
		t.Fatal("selected-source entry fixture requires an asset")
	}
	root, err := filepath.Abs(strings.TrimSpace(modelsRoot))
	if err != nil {
		t.Fatalf("resolve selected-source models root: %v", err)
	}
	entry, err := sanitizeManagedEntryPath(asset.GetEntry())
	if err != nil {
		t.Fatalf("sanitize selected-source entry: %v", err)
	}
	var target string
	if logicalModelID := strings.Trim(strings.TrimSpace(asset.GetLogicalModelId()), "/"); logicalModelID != "" &&
		shouldUseLogicalManagedBundlePath(asset) {
		target = filepath.Join(root, "resolved", filepath.FromSlash(logicalModelID), entry)
	} else {
		baseDir, resolveErr := resolveManagedBaseDir(root, asset.GetAssetId(), asset.GetSource().GetRepo())
		if resolveErr != nil {
			t.Fatalf("resolve selected-source base directory: %v", resolveErr)
		}
		target = filepath.Join(baseDir, entry)
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		t.Fatalf("create selected-source fixture directory: %v", err)
	}
	if err := os.WriteFile(target, []byte(content), 0o600); err != nil {
		t.Fatalf("write selected-source fixture: %v", err)
	}
	return target
}

func profileRuntimeAssetKindForComponentKindForTest(componentKind string) runtimev1.LocalAssetKind {
	switch strings.TrimSpace(componentKind) {
	case "image":
		return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE
	case "vae":
		return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE
	case "chat", "text_encoder":
		return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT
	case "embedding":
		return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_EMBEDDING
	case "lora":
		return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_LORA
	default:
		return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_AUXILIARY
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
			if dep.Detail != "image profile materialization bindings are required before resolving companion assets; call Runtime descriptor prepare to materialize this image profile" {
				t.Fatalf("profile-bindings blocker must direct callers to Runtime descriptor prepare: %+v", dep)
			}
			return
		}
	}
	t.Fatalf("corrupt restored materialization must keep profile-bindings blocker, got %+v", plan.Dependencies)
}

func TestServicePrepareProfileRuntimeDescriptorRejectsSDKFormedLoRAOccurrence(t *testing.T) {
	t.Parallel()
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
				"runtime_consumer_id": "stable-diffusion.cpp.metal",
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
				"huggingface": {
					"repo_id": "nimiplatform/lora-a",
					"revision": "main",
					"entries": ["lora.safetensors"],
					"access_policy": "public"
				}
			}
		]
	}`)

	_, err := svc.prepareProfileRuntimeDescriptor(context.Background(), ProfileRuntimeDescriptorPrepareRequest{
		DescriptorJSON: raw,
	})
	if err == nil || !strings.Contains(err.Error(), "descriptor.companion_slot_unsupported: flux:lora_path") {
		t.Fatalf("SDK-shaped LoRA executable occurrence must fail closed, got %v", err)
	}
}

func TestServicePrepareProfileRuntimeDescriptorReadyAfterCanonicalMaterializationFacts(t *testing.T) {
	t.Parallel()
	svc := newTestService(t)
	descriptor := testProfileRuntimeDescriptor()
	// stable-diffusion.cpp currently admits no component weight/options; this
	// service-level readiness fixture exercises the admitted empty metadata
	// schema. Occurrence identity and duplicate-slot ordering remain covered by
	// the descriptor validation tests using the richer portable fixture.
	for index := range descriptor.CapabilitySlices[0].OrderedCompanionOccurrences {
		descriptor.CapabilitySlices[0].OrderedCompanionOccurrences[index].Weight = ""
		descriptor.CapabilitySlices[0].OrderedCompanionOccurrences[index].Options = nil
	}
	seedProfileRuntimeNativeImageBackendForService(t, svc)
	seedProfileRuntimePortableSelectedSourcesForService(t, svc, descriptor)

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
	t.Parallel()
	svc := newTestService(t)
	descriptor := testProfileRuntimeImageCompanionDescriptor()
	seedProfileRuntimeNativeImageBackendForService(t, svc)
	seedProfileRuntimePortableSelectedSourcesForService(t, svc, descriptor)

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
	if got := companionBySlot["vae_path"]; got.CompanionKind != "vae" ||
		got.CompanionAssetID != "z_image_ae" ||
		got.CompanionLocalAssetID != "local-z-image-ae" ||
		got.ParentAssetID != "z_image_turbo" {
		t.Fatalf("unexpected AE companion binding: %+v", got)
	}
	if got := companionBySlot["llm_path"]; got.CompanionKind != "chat" ||
		got.CompanionKind == "auxiliary" ||
		got.CompanionAssetID != "qwen3_4b_companion" ||
		got.CompanionLocalAssetID != "local-qwen3-4b" ||
		got.ParentAssetID != "z_image_turbo" {
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

func TestPrepareProfileRuntimeDescriptorForAIConfigAcceptsPortableInstalledCompositionWithPassiveVAE(t *testing.T) {
	svc := newTestService(t)
	seedProfileRuntimeNativeImageBackendForService(t, svc)
	descriptor := testProfileRuntimeImageCompanionDescriptor()
	entryNames := map[string]string{
		"main": "z_image_turbo-Q4_K.gguf",
		"qwen": "Qwen3-4B-Q4_K_M.gguf",
		"ae":   "ae.safetensors",
	}
	logicalModelIDs := map[string]string{
		"main": "nimi/z-image-turbo",
		"qwen": "nimi/qwen3-4b",
	}
	assets := make(map[string]*runtimev1.LocalAssetRecord, len(descriptor.AssetBindings))
	for index := range descriptor.AssetBindings {
		binding := &descriptor.AssetBindings[index]
		binding.Source = "manual"
		binding.ExpectedIdentity = "portable:z-image:" + binding.BindingID
		binding.HuggingFace = nil
		binding.Manual = &profileRuntimeDescriptorManualSource{
			ExpectedName:            entryNames[binding.BindingID],
			AssociationInstructions: "Associate the exact verified portable Z Image source.",
			AllowedFilePatterns:     []string{entryNames[binding.BindingID]},
		}
		asset := &runtimev1.LocalAssetRecord{
			LocalAssetId:   binding.PreparedAssetID,
			AssetId:        "local-import/" + binding.BindingID + "/machine-instance-01",
			LogicalModelId: logicalModelIDs[binding.BindingID],
			Kind:           profileRuntimeAssetKindForComponentKindForTest(binding.ComponentKind),
			Engine:         "media",
			Entry:          entryNames[binding.BindingID],
			SourceFileName: entryNames[binding.BindingID],
			Status:         runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
			Source:         &runtimev1.LocalAssetSource{},
		}
		switch binding.BindingID {
		case "main":
			asset.Family = "z-image"
			asset.Capabilities = []string{"image.generate"}
			asset.EngineConfig = mustStructForTest(t, map[string]any{"backend": "stablediffusion-ggml"})
		case "ae":
			asset.Family = "flux1-vae"
			asset.ArtifactRoles = []string{"vae"}
		}
		svc.assets[asset.GetLocalAssetId()] = asset
		entryPath := writeProfileRuntimeSelectedSourceEntryFixture(
			t,
			svc.resolvedLocalModelsPath(),
			asset,
			"portable-installed-composition:"+binding.BindingID,
		)
		entrySHA256, err := computeFileSHA256(entryPath)
		if err != nil {
			t.Fatalf("hash %s selected source: %v", binding.BindingID, err)
		}
		asset.Hashes = map[string]string{asset.GetEntry(): "sha256:" + entrySHA256}
		binding.Manual.ExpectedIntegrity = "sha256:" + entrySHA256
		assets[binding.BindingID] = asset
	}
	mainRecord := seedProfileRuntimePreparedAssetSelectedSourceForService(
		t,
		svc,
		localEnvironmentFamilyModelAsset,
		assets["main"],
		"",
		"",
		mustResolveManagedModelEntryPathForTest(t, svc, assets["main"]),
		"stable-diffusion.cpp.metal",
	)
	mainRecord.SourceKind = localEnvironmentSourceImported
	mainRecord = svc.upsertLocalEnvironmentSelectedSourceRecord(mainRecord)
	for _, bindingID := range []string{"qwen", "ae"} {
		seedProfileRuntimePreparedAssetSelectedSourceForService(
			t,
			svc,
			localEnvironmentFamilyModelCompanion,
			assets[bindingID],
			assets["main"].GetAssetId(),
			mainRecord.RecordID,
			mustResolveManagedModelEntryPathForTest(t, svc, assets[bindingID]),
			"stable-diffusion.cpp.metal",
		)
	}

	prepared, err := svc.PrepareProfileRuntimeDescriptorForAIConfig(
		context.Background(),
		marshalProfileRuntimeDescriptor(t, descriptor),
	)
	if err != nil {
		t.Fatalf("prepare portable installed composition: %v", err)
	}
	if len(prepared.SliceResults) != 1 || prepared.SliceResults[0].Outcome != string(profileRuntimePrepareReady) {
		t.Fatalf("portable installed composition outcome: %+v", prepared.SliceResults)
	}
	image := prepared.SliceResults[0]
	if image.LogicalModelID != assets["main"].GetLogicalModelId() || image.TargetRef.GetProfileBindingId() == "" {
		t.Fatalf("portable installed main target: %+v", image)
	}
	if len(image.SelectedComponents) != 2 ||
		image.SelectedComponents[0].OccurrenceID != "qwen-text-encoder" ||
		image.SelectedComponents[0].LogicalModelID != assets["qwen"].GetLogicalModelId() ||
		image.SelectedComponents[1].OccurrenceID != "z-image-ae" ||
		image.SelectedComponents[1].LogicalModelID != effectiveLocalComponentPublicIdentity(assets["ae"]) ||
		image.SelectedComponents[1].TargetRef.GetReadinessRef() == "" {
		t.Fatalf("portable installed ordered components: %+v", image.SelectedComponents)
	}
	if assets["ae"].GetLogicalModelId() != "" || len(svc.managedImageLoadCache) != 0 {
		t.Fatalf("prepare mutated passive identity or loaded backend: vae=%+v loads=%+v", assets["ae"], svc.managedImageLoadCache)
	}
	for bindingID, asset := range assets {
		if asset.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED {
			t.Fatalf("prepare activated %s: %s", bindingID, asset.GetStatus())
		}
	}
}

func mustResolveManagedModelEntryPathForTest(t *testing.T, svc *Service, asset *runtimev1.LocalAssetRecord) string {
	t.Helper()
	path, err := resolveManagedModelEntryAbsolutePath(svc.resolvedLocalModelsPath(), asset)
	if err != nil {
		t.Fatalf("resolve selected-source fixture path: %v", err)
	}
	return path
}

func TestPrepareProfileRuntimeDescriptorForAIConfigReturnsExactPrivateTarget(t *testing.T) {
	t.Parallel()
	svc := newTestService(t)
	descriptor := testProfileRuntimeImageCompanionDescriptor()
	seedProfileRuntimeNativeImageBackendForService(t, svc)
	seedProfileRuntimePortableSelectedSourcesForService(t, svc, descriptor)

	result, err := svc.PrepareProfileRuntimeDescriptorForAIConfig(
		context.Background(),
		marshalProfileRuntimeDescriptor(t, descriptor),
	)
	if err != nil {
		t.Fatalf("prepare descriptor for AIConfig: %v", err)
	}
	if len(result.SliceResults) != 1 {
		t.Fatalf("expected one slice result, got %+v", result.SliceResults)
	}
	slice := result.SliceResults[0]
	if slice.Outcome != string(profileRuntimePrepareReady) ||
		slice.LogicalModelID != "logical-model-main" ||
		slice.TargetRef == nil ||
		slice.TargetRef.GetProfileBindingId() == "" {
		t.Fatalf("AIConfig preparation must return one exact private target: %+v", slice)
	}
	binding, asset, resolveErr := svc.ResolveDurableLocalTarget(
		context.Background(),
		slice.TargetRef,
		"image.generate",
	)
	if resolveErr != nil {
		t.Fatalf("resolve prepared target: %v", resolveErr)
	}
	if binding.GetResolvedModelId() != slice.LogicalModelID ||
		asset.GetLocalAssetId() != "local-z-image" {
		t.Fatalf("prepared target resolved to the wrong exact asset: binding=%+v asset=%+v", binding, asset)
	}
}

func TestPrepareProfileRuntimeDescriptorForAIConfigMaterializesExactTextAndEmbeddingTargets(t *testing.T) {
	t.Parallel()
	svc := newTestService(t)
	setLocalModelsPathForTest(t, svc, filepath.Join(t.TempDir(), "models"))
	descriptor := profileRuntimeDescriptor{
		SchemaVersion:       profileRuntimeDescriptorSchemaVersion,
		DescriptorID:        "descriptor-exact-text",
		ProfileRef:          profileRuntimeDescriptorProfileRef{ProfileID: "profile-exact-text"},
		SourceProfileDigest: "sha256:exact-text",
		ProjectionOrigin:    map[string]any{"component": "test"},
		RequirementRefs:     []string{"requirement:exact-text"},
		CapabilitySlices: []profileRuntimeDescriptorCapability{
			{
				SliceID:           "slice:text-generate",
				Capability:        "text.generate",
				ExecutionMode:     "local",
				ContractState:     "declared",
				ReadinessPolicy:   "required",
				ParamsRef:         "params:text.generate",
				RuntimeConsumerID: "llama.cpp.cpu",
				Execution: profileRuntimeDescriptorExecution{
					Backend:       "llama.cpp",
					BackendFamily: "llama.cpp",
				},
				Model:     profileRuntimeDescriptorModel{Family: "gemma"},
				AssetRefs: []string{"text-main"},
			},
			{
				SliceID:           "slice:text-embed",
				Capability:        "text.embed",
				ExecutionMode:     "local",
				ContractState:     "declared",
				ReadinessPolicy:   "required",
				ParamsRef:         "params:text.embed",
				RuntimeConsumerID: "llama.cpp.cpu",
				Execution: profileRuntimeDescriptorExecution{
					Backend:       "llama.cpp",
					BackendFamily: "llama.cpp",
				},
				Model:     profileRuntimeDescriptorModel{Family: "embedding"},
				AssetRefs: []string{"embed-main"},
			},
		},
		AssetBindings: []profileRuntimeDescriptorAssetBinding{
			{
				BindingID:        "text-main",
				AssetRole:        "main",
				ComponentKind:    "chat",
				Source:           "huggingface",
				ExpectedIdentity: "gemma-4-26b",
				ReadinessPolicy:  "required",
				PreparedAssetID:  "local-gemma-4-26b",
				HuggingFace: &profileRuntimeDescriptorHFSource{
					RepoID:       "nimi/gemma-4-26b",
					Revision:     "revision-gemma",
					Entries:      []string{"gemma-4-26b.gguf"},
					AccessPolicy: "public",
				},
			},
			{
				BindingID:        "embed-main",
				AssetRole:        "main",
				ComponentKind:    "embedding",
				Source:           "huggingface",
				ExpectedIdentity: "nimi-embed",
				ReadinessPolicy:  "required",
				PreparedAssetID:  "local-nimi-embed",
				HuggingFace: &profileRuntimeDescriptorHFSource{
					RepoID:       "nimi/nimi-embed",
					Revision:     "revision-embed",
					Entries:      []string{"nimi-embed.gguf"},
					AccessPolicy: "public",
				},
			},
		},
	}
	for index, binding := range descriptor.AssetBindings {
		asset := &runtimev1.LocalAssetRecord{
			LocalAssetId:   binding.PreparedAssetID,
			AssetId:        binding.ExpectedIdentity,
			LogicalModelId: []string{"google/gemma-4-26b", "local/nimi-embed"}[index],
			Kind:           profileRuntimeAssetKindForComponentKindForTest(binding.ComponentKind),
			Capabilities:   []string{descriptor.CapabilitySlices[index].Capability},
			Status:         runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
			Entry:          binding.HuggingFace.Entries[0],
			Source: &runtimev1.LocalAssetSource{
				Repo:     binding.HuggingFace.RepoID,
				Revision: binding.HuggingFace.Revision,
			},
		}
		svc.mu.Lock()
		svc.assets[asset.GetLocalAssetId()] = asset
		svc.mu.Unlock()
		entryPath := writeProfileRuntimeSelectedSourceEntryFixture(
			t,
			svc.resolvedLocalModelsPath(),
			asset,
			"selected-source-entry:"+binding.BindingID,
		)
		seedProfileRuntimePreparedAssetSelectedSourceForService(
			t,
			svc,
			localEnvironmentFamilyModelAsset,
			asset,
			"",
			"",
			entryPath,
			"llama.cpp.cpu",
		)
	}

	result, err := svc.PrepareProfileRuntimeDescriptorForAIConfig(
		context.Background(),
		marshalProfileRuntimeDescriptor(t, descriptor),
	)
	if err != nil {
		t.Fatalf("prepare exact text descriptor for AIConfig: %v", err)
	}
	if len(result.SliceResults) != 2 {
		t.Fatalf("expected two slice results, got %+v", result.SliceResults)
	}
	expected := map[string]string{
		"text.generate": "local-gemma-4-26b",
		"text.embed":    "local-nimi-embed",
	}
	for _, slice := range result.SliceResults {
		if slice.Outcome != string(profileRuntimePrepareReady) ||
			slice.ExecutionMode != "local" ||
			slice.TargetRef == nil ||
			slice.TargetRef.GetReadinessRef() == "" ||
			slice.LogicalModelID == "" {
			t.Fatalf("AIConfig text preparation must return an exact target: %+v", slice)
		}
		binding, asset, resolveErr := svc.ResolveDurableLocalTarget(
			context.Background(),
			slice.TargetRef,
			slice.Capability,
		)
		if resolveErr != nil {
			t.Fatalf("resolve %s target: %v", slice.Capability, resolveErr)
		}
		if binding.GetResolvedModelId() != slice.LogicalModelID ||
			asset.GetLocalAssetId() != expected[slice.Capability] {
			t.Fatalf("%s resolved to wrong exact asset: binding=%+v asset=%+v", slice.Capability, binding, asset)
		}
	}
}

func TestServicePrepareProfileRuntimeDescriptorRPCBytesClearsPlanBindings(t *testing.T) {
	t.Parallel()
	svc := newTestService(t)
	descriptor := testProfileRuntimeImageCompanionDescriptor()
	seedProfileRuntimeNativeImageBackendForService(t, svc)
	seedProfileRuntimePortableSelectedSourcesForService(t, svc, descriptor)

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
	t.Parallel()
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
	seedProfileRuntimePortableSelectedSourcesForService(t, svc, descriptor)

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
	t.Parallel()
	svc := newTestService(t)
	descriptor := testProfileRuntimeImageCompanionDescriptor()
	seedProfileRuntimeNativeImageBackendForService(t, svc)
	seedProfileRuntimePortableSelectedSourcesForService(t, svc, descriptor)

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
	persistedCompanionLocalIDs := map[string]bool{}
	for _, binding := range snapshot.ManagedImageProfileMaterializations[0].MaterializationBindings {
		if binding.CompanionLocalAssetID != "" {
			persistedCompanionLocalIDs[binding.CompanionLocalAssetID] = true
		}
	}
	if !persistedCompanionLocalIDs["local-z-image-ae"] || !persistedCompanionLocalIDs["local-qwen3-4b"] {
		t.Fatalf("persisted materialization must retain exact companion local asset ids: %+v", snapshot.ManagedImageProfileMaterializations[0])
	}

	restored, err := New(svc.logger, nil, svc.stateStorePath, 0, svc.localModelsPath)
	if err != nil {
		t.Fatalf("restore service: %v", err)
	}
	defer restored.Close()
	assertProfileRuntimePlanCompanionsReady(t, restored)
}

func TestProfileRuntimeDescriptorMaterializationRestoreFailsClosedForCorruptState(t *testing.T) {
	t.Parallel()
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
			name: "companion prepared local asset id missing",
			mutate: func(snapshot *localStateSnapshot) {
				snapshot.ManagedImageProfileMaterializations[0].MaterializationBindings[1].CompanionLocalAssetID = ""
			},
		},
		{
			name: "materialization key is not descriptor prepared",
			mutate: func(snapshot *localStateSnapshot) {
				snapshot.ManagedImageProfileMaterializations[0].MaterializationKey = "selected-source-legacy"
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
			seedProfileRuntimePortableSelectedSourcesForService(t, svc, descriptor)
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
	t.Parallel()
	svc := newTestService(t)
	descriptor := testProfileRuntimeImageCompanionDescriptor()
	seedProfileRuntimeNativeImageBackendForService(t, svc)
	seedProfileRuntimePortableSelectedSourcesForService(t, svc, descriptor, "main", "ae")

	result, err := svc.prepareProfileRuntimeDescriptor(context.Background(), ProfileRuntimeDescriptorPrepareRequest{
		DescriptorJSON: marshalProfileRuntimeDescriptor(t, descriptor),
	})
	if err != nil {
		t.Fatalf("prepare descriptor through service: %v", err)
	}
	if result.SliceResults[0].Outcome != string(profileRuntimePrepareSetupRequiredNoLiveConfig) ||
		!profileRuntimeStringSliceContains(result.SliceResults[0].ReasonCodes, "required_asset_missing") {
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
	t.Parallel()
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
	t.Parallel()
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
			reasonCode: "required_asset_missing",
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
			seedProfileRuntimePortableSelectedSourcesForService(t, svc, descriptor)
			svc.mu.Lock()
			svc.assets["local-qwen3-4b"].AssetId = tc.assetID
			svc.assets["local-qwen3-4b"].Kind = tc.kind
			svc.mu.Unlock()

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
	t.Parallel()
	descriptor := testProfileRuntimeDescriptor()
	facts := testProfileRuntimeReadyFacts(descriptor)
	facts.NativeBackendPackages[0].PackageSource = "experimental_official_sdcpp"
	facts.NativeBackendPackages[0].PackageFormat = "direct_archive"
	facts.NativeBackendPackages[0].LaunchMode = "runtime_wrapper"

	validated := validateProfileRuntimeDescriptorForInternalTest(t, descriptor)
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
	t.Parallel()
	descriptor := testProfileRuntimeDescriptor()
	descriptor.CapabilitySlices[0].RuntimeConsumerID = "stable-diffusion.cpp.cuda"
	facts := testProfileRuntimeReadyFacts(descriptor)
	facts.NativeBackendPackages[0].SelectedConsumers = []string{"stable-diffusion.cpp.cuda"}
	facts.NativeBackendPackages[0].PackageSource = "canonical_runtime_wrapper"
	facts.NativeBackendPackages[0].PackageFormat = "direct_archive"
	facts.NativeBackendPackages[0].LaunchMode = "runtime_wrapper"
	facts.NativeBackendPackages[0].SelectedSourceRecordID = "src_windows_runtime_wrapper"

	validated := validateProfileRuntimeDescriptorForInternalTest(t, descriptor)
	results, err := prepareProfileRuntimeDescriptorWithFacts(validated, facts)
	if err != nil {
		t.Fatalf("prepare descriptor: %v", err)
	}
	if results[0].Outcome != profileRuntimePrepareReady || results[0].MaterializationKey == "" {
		t.Fatalf("Windows runtime wrapper facts must satisfy cuda slice: %+v", results[0])
	}
}

func TestProfileRuntimePrepareRejectsWrongNativeConsumerAndSource(t *testing.T) {
	t.Parallel()
	descriptor := testProfileRuntimeDescriptor()
	descriptor.CapabilitySlices[0].RuntimeConsumerID = "stable-diffusion.cpp.cuda"
	facts := testProfileRuntimeReadyFacts(descriptor)

	validated := validateProfileRuntimeDescriptorForInternalTest(t, descriptor)
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
	t.Parallel()
	descriptor := testProfileRuntimeDescriptor()
	facts := testProfileRuntimeReadyFacts(descriptor)
	for index := range facts.PreparedAssets {
		if facts.PreparedAssets[index].PreparedAssetID == "local-z-image" {
			facts.PreparedAssets[index].PreparedAssetID = "asset:other-main"
			facts.PreparedAssets[index].LocalAssetID = "asset:other-main"
		}
	}

	validated := validateProfileRuntimeDescriptorForInternalTest(t, descriptor)
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
	t.Parallel()
	descriptor := testProfileRuntimeDescriptor()
	facts := testProfileRuntimeReadyFacts(descriptor)
	for index := range facts.PreparedAssets {
		if facts.PreparedAssets[index].PreparedAssetID == "local-z-image-ae" {
			facts.PreparedAssets[index].Role = "main"
		}
	}

	validated := validateProfileRuntimeDescriptorForInternalTest(t, descriptor)
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
	t.Parallel()
	descriptor := testProfileRuntimeDescriptor()
	descriptor.AssetBindings[2].ExpectedIdentity = "backup:Qwen3-4B-Q4_K_M.gguf"
	descriptor.AssetBindings[2].PreparedAssetID = "asset:qwen3-4b-backup"
	facts := testProfileRuntimeReadyFacts(descriptor)
	filtered := facts.PreparedAssets[:0]
	for _, fact := range facts.PreparedAssets {
		if fact.PreparedAssetID == "asset:qwen3-4b-backup" {
			continue
		}
		filtered = append(filtered, fact)
	}
	facts.PreparedAssets = filtered

	validated := validateProfileRuntimeDescriptorForInternalTest(t, descriptor)
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
	t.Parallel()
	descriptor := testProfileRuntimeDescriptor()
	facts := testProfileRuntimeReadyFacts(descriptor)
	for index := range facts.PreparedAssets {
		if facts.PreparedAssets[index].PreparedAssetID == "local-z-image-ae" {
			facts.PreparedAssets[index].SourceReady = false
		}
	}

	validated := validateProfileRuntimeDescriptorForInternalTest(t, descriptor)
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
	t.Parallel()
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
	t.Parallel()
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
