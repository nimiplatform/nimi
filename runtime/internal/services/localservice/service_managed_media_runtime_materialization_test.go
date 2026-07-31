package localservice

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestResolveManagedMediaImageProfileAssociatesPortableSDKDescriptorAcrossRestart(t *testing.T) {
	testResolveManagedMediaImageProfileDescriptorAcrossRestart(t)
}

func TestPrepareProfileRuntimeDescriptorRejectsPortablePreparedAssetIDs(t *testing.T) {
	svc := newTestService(t)
	for _, mutate := range []func(*profileRuntimeDescriptor){
		func(descriptor *profileRuntimeDescriptor) {
			descriptor.AssetBindings[0].PreparedAssetID = "artifact_forbidden"
		},
		func(descriptor *profileRuntimeDescriptor) {
			for index := range descriptor.AssetBindings {
				descriptor.AssetBindings[index].PreparedAssetID = ""
			}
			descriptor.CapabilitySlices[0].OrderedCompanionOccurrences[0].PreparedAssetID = "artifact_forbidden"
		},
	} {
		descriptor := testProfileRuntimeImageCompanionDescriptor()
		for index := range descriptor.AssetBindings {
			descriptor.AssetBindings[index].PreparedAssetID = ""
		}
		mutate(&descriptor)
		raw := marshalProfileRuntimeDescriptorWithPreparedAssetsForTest(t, descriptor)
		if !strings.Contains(string(raw), "prepared_asset_id") {
			t.Fatal("prepared-id rejection fixture must send prepared_asset_id")
		}
		_, err := svc.PrepareProfileRuntimeDescriptor(context.Background(), &runtimev1.PrepareProfileRuntimeDescriptorRequest{
			DescriptorJson: raw,
		})
		if err == nil || !strings.Contains(err.Error(), "descriptor.forbidden_host_local_field") {
			t.Fatalf("portable prepared_asset_id must fail closed, got %v", err)
		}
	}

	descriptor := testProfileRuntimeImageCompanionDescriptor()
	raw := marshalProfileRuntimeDescriptor(t, descriptor)
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatalf("decode prepared-id case-variant fixture: %v", err)
	}
	payload["asset_bindings"].([]any)[0].(map[string]any)["PreparedAssetID"] = "artifact_forbidden"
	caseVariantRaw, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("encode prepared-id case-variant fixture: %v", err)
	}
	_, err = svc.PrepareProfileRuntimeDescriptor(context.Background(), &runtimev1.PrepareProfileRuntimeDescriptorRequest{
		DescriptorJson: caseVariantRaw,
	})
	if err == nil || !strings.Contains(err.Error(), "descriptor.forbidden_host_local_field") {
		t.Fatalf("case-variant PreparedAssetID must fail closed, got %v", err)
	}
}

func testResolveManagedMediaImageProfileDescriptorAcrossRestart(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	modelsRoot := filepath.Join(t.TempDir(), "models")
	svc.SetManagedLlamaRegistrationConfig(modelsRoot, "", false)

	engineConfig, err := structpb.NewStruct(map[string]any{"backend": "stablediffusion-ggml"})
	if err != nil {
		t.Fatalf("build engine config: %v", err)
	}
	main := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "z_image_turbo",
		repo:         "nimiplatform/z-image",
		revision:     "main",
		capabilities: []string{"image"},
		engine:       "media",
		entry:        "z_image_turbo-Q4_K.gguf",
		engineConfig: engineConfig,
	})
	svc.mu.Lock()
	svc.assets[main.GetLocalAssetId()].Family = "z-image-turbo"
	svc.mu.Unlock()
	mainPath := writeManagedAssetEntryFixture(t, modelsRoot, main, "main-model")

	vae := &runtimev1.LocalAssetRecord{
		LocalAssetId:   "artifact_" + ulid.Make().String(),
		AssetId:        "z_image_ae",
		Kind:           runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE,
		Engine:         "media",
		Entry:          "ae.safetensors",
		Family:         "flux2-vae",
		ArtifactRoles:  []string{"vae"},
		Status:         runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
		Source:         &runtimev1.LocalAssetSource{},
		SourceFileName: "ae.safetensors",
	}
	qwen := &runtimev1.LocalAssetRecord{
		LocalAssetId:   "artifact_" + ulid.Make().String(),
		AssetId:        "qwen3_4b_companion",
		Kind:           runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT,
		Engine:         "llama",
		Entry:          "Qwen3-4B-Q4_K_M.gguf",
		LogicalModelId: "nimi/qwen3_4b_companion",
		Status:         runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
		Source: &runtimev1.LocalAssetSource{
			Repo:     "nimiplatform/qwen3-4b",
			Revision: "main",
		},
	}
	svc.mu.Lock()
	svc.assets[vae.GetLocalAssetId()] = vae
	svc.assets[qwen.GetLocalAssetId()] = qwen
	svc.mu.Unlock()
	vaePath := writeManagedAssetEntryFixture(t, modelsRoot, vae, "vae")
	qwenPath := writeManagedAssetEntryFixture(t, modelsRoot, qwen, "llm")
	runtimePath := func(absolutePath string) string {
		t.Helper()
		relativePath, relativeErr := filepath.Rel(modelsRoot, absolutePath)
		if relativeErr != nil {
			t.Fatalf("resolve Runtime-relative fixture path: %v", relativeErr)
		}
		return filepath.ToSlash(relativePath)
	}
	mainRuntimePath := runtimePath(mainPath)
	vaeRuntimePath := runtimePath(vaePath)
	qwenRuntimePath := runtimePath(qwenPath)

	descriptor := testProfileRuntimeImageCompanionDescriptor()
	for index := range descriptor.AssetBindings {
		descriptor.AssetBindings[index].PreparedAssetID = ""
		if descriptor.AssetBindings[index].BindingID == "main" {
			descriptor.AssetBindings[index].HuggingFace.Entries = []string{main.GetEntry()}
		}
		if descriptor.AssetBindings[index].BindingID == "ae" {
			descriptor.AssetBindings[index].Source = "manual"
			descriptor.AssetBindings[index].HuggingFace = nil
			descriptor.AssetBindings[index].Manual = &profileRuntimeDescriptorManualSource{
				ExpectedName:            "ae.safetensors",
				AssociationInstructions: "Associate the verified VAE companion with the Z Image profile.",
				AllowedFilePatterns:     []string{"*.safetensors"},
			}
		}
	}
	beforeSelectedSources, validateErr := validateProfileRuntimeDescriptor(marshalProfileRuntimeDescriptor(t, descriptor))
	if validateErr != nil {
		t.Fatalf("validate portable descriptor before selected sources: %v", validateErr)
	}
	if associateErr := svc.associateProfileRuntimeDescriptorPreparedAssets(beforeSelectedSources); associateErr != nil {
		t.Fatalf("associate portable descriptor before selected sources: %v", associateErr)
	}
	for _, binding := range beforeSelectedSources.AssetBindings {
		if strings.TrimSpace(binding.PreparedAssetID) != "" {
			t.Fatalf("inventory-only binding %q must not be guessed from semantic asset identity", binding.BindingID)
		}
	}
	mainSource := seedProfileRuntimePreparedAssetSelectedSourceForService(
		t, svc, localEnvironmentFamilyModelAsset,
		main, "", "", mainPath,
	)
	seedProfileRuntimePreparedAssetSelectedSourceForService(
		t, svc, localEnvironmentFamilyModelCompanion,
		vae, main.GetAssetId(), mainSource.RecordID, vaePath,
	)
	seedProfileRuntimePreparedAssetSelectedSourceForService(
		t, svc, localEnvironmentFamilyModelCompanion,
		qwen, main.GetAssetId(), mainSource.RecordID, qwenPath,
	)
	if strings.Contains(string(marshalProfileRuntimeDescriptor(t, descriptor)), "prepared_asset_id") {
		t.Fatal("portable SDK-shaped descriptor must not carry prepared_asset_id")
	}
	internalDescriptor, validateErr := validateProfileRuntimeDescriptor(marshalProfileRuntimeDescriptor(t, descriptor))
	if validateErr != nil {
		t.Fatalf("validate portable SDK-shaped descriptor: %v", validateErr)
	}
	if associateErr := svc.associateProfileRuntimeDescriptorPreparedAssets(internalDescriptor); associateErr != nil {
		t.Fatalf("associate portable SDK-shaped descriptor: %v", associateErr)
	}
	for _, binding := range internalDescriptor.AssetBindings {
		if strings.TrimSpace(binding.PreparedAssetID) == "" {
			t.Fatalf("portable binding %q was not associated from selected-source truth", binding.BindingID)
		}
	}
	seedProfileRuntimeNativeImageBackendForService(t, svc)
	prepared, err := svc.PrepareProfileRuntimeDescriptor(context.Background(), &runtimev1.PrepareProfileRuntimeDescriptorRequest{
		DescriptorJson: marshalProfileRuntimeDescriptor(t, descriptor),
	})
	if err != nil {
		t.Fatalf("PrepareProfileRuntimeDescriptor: %v", err)
	}
	if len(prepared.GetSliceResults()) != 1 ||
		prepared.GetSliceResults()[0].GetOutcome() != string(profileRuntimePrepareReady) ||
		!strings.HasPrefix(prepared.GetSliceResults()[0].GetMaterializationKey(), profileRuntimeMaterializationKeyPrefix) {
		t.Fatalf("expected descriptor-prepared image materialization: %+v", prepared.GetSliceResults())
	}

	cached, ok := svc.cachedManagedMediaImageProfile(main.GetLocalAssetId())
	if !ok || !cached.MaterializationResolved ||
		!strings.HasPrefix(cached.Alias, profileRuntimeMaterializationKeyPrefix) ||
		len(cached.MaterializationBindings) != 3 {
		t.Fatalf("expected exact descriptor materialization cache, ok=%v cached=%+v", ok, cached)
	}
	exactCompanions := map[string]string{}
	for _, binding := range cached.MaterializationBindings {
		if binding.CompanionAssetID != "" {
			exactCompanions[binding.EngineSlot] = binding.CompanionLocalAssetID
		}
	}
	if exactCompanions["vae_path"] != vae.GetLocalAssetId() ||
		exactCompanions["llm_path"] != qwen.GetLocalAssetId() {
		t.Fatalf("descriptor materialization lost exact companion local ids: %+v", cached.MaterializationBindings)
	}
	materializationKey := cached.Alias

	explicitAlias, _, _, err := svc.ResolveManagedMediaImageProfile(
		context.Background(),
		main.GetLocalAssetId(),
		map[string]any{
			managedMediaWorkflowProfileEntriesKey: []*runtimev1.LocalProfileEntryDescriptor{
				{
					EntryId:    "explicit-main",
					Kind:       runtimev1.LocalProfileEntryKind_LOCAL_PROFILE_ENTRY_KIND_ASSET,
					Capability: "image.generate",
					AssetId:    main.GetAssetId(),
					AssetKind:  runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE,
					Engine:     main.GetEngine(),
				},
				{
					EntryId:    "explicit-vae",
					Kind:       runtimev1.LocalProfileEntryKind_LOCAL_PROFILE_ENTRY_KIND_ASSET,
					Capability: "image.generate",
					AssetId:    vae.GetAssetId(),
					AssetKind:  vae.GetKind(),
					Engine:     vae.GetEngine(),
					EngineSlot: "vae_path",
				},
				{
					EntryId:    "explicit-qwen",
					Kind:       runtimev1.LocalProfileEntryKind_LOCAL_PROFILE_ENTRY_KIND_ASSET,
					Capability: "image.generate",
					AssetId:    qwen.GetAssetId(),
					AssetKind:  qwen.GetKind(),
					Engine:     qwen.GetEngine(),
					EngineSlot: "llm_path",
				},
			},
			managedMediaWorkflowEntryOverridesKey: []any{
				map[string]any{"entry_id": "explicit-main", "local_asset_id": main.GetLocalAssetId()},
				map[string]any{"entry_id": "explicit-vae", "local_asset_id": vae.GetLocalAssetId()},
				map[string]any{"entry_id": "explicit-qwen", "local_asset_id": qwen.GetLocalAssetId()},
			},
		},
	)
	if err != nil {
		t.Fatalf("resolve explicit profile entries: %v", err)
	}
	if !strings.HasPrefix(explicitAlias, "nimi-img-") {
		t.Fatalf("explicit executable alias = %q", explicitAlias)
	}
	afterExplicit, ok := svc.cachedManagedMediaImageProfile(main.GetLocalAssetId())
	if !ok || afterExplicit.Alias != materializationKey {
		t.Fatalf("explicit profile entries must not overwrite descriptor materialization: %+v", afterExplicit)
	}

	resolveAndAssert := func(label string, service *Service) {
		t.Helper()
		alias, profile, forwarded, resolveErr := service.ResolveManagedMediaImageProfile(
			context.Background(),
			main.GetLocalAssetId(),
			nil,
		)
		if resolveErr != nil {
			t.Fatalf("%s resolve descriptor materialization: %v", label, resolveErr)
		}
		if !strings.HasPrefix(alias, "nimi-img-") {
			t.Fatalf("%s executable alias = %q", label, alias)
		}
		if len(forwarded) != 0 {
			t.Fatalf("%s materialization leaked private entries: %+v", label, forwarded)
		}
		if modelPath := strings.TrimSpace(valueAsString(valueAsObject(profile["parameters"])["model"])); modelPath != mainRuntimePath {
			t.Fatalf("%s main model path = %q, want %q", label, modelPath, mainRuntimePath)
		}
		options := valueAsStringSlice(profile["options"])
		if !stringSliceContains(options, "vae_path:"+vaeRuntimePath) ||
			!stringSliceContains(options, "llm_path:"+qwenRuntimePath) {
			t.Fatalf("%s profile missing exact Z-Image companions: %+v", label, options)
		}
		afterResolve, found := service.cachedManagedMediaImageProfile(main.GetLocalAssetId())
		if !found || !strings.HasPrefix(afterResolve.Alias, profileRuntimeMaterializationKeyPrefix) {
			t.Fatalf("%s execution must retain descriptor materialization provenance: %+v", label, afterResolve)
		}
	}

	resolveAndAssert("before restart", svc)

	restored, err := New(svc.logger, nil, svc.stateStorePath, 0, svc.localModelsPath)
	if err != nil {
		t.Fatalf("restore service: %v", err)
	}
	defer restored.Close()
	resolveAndAssert("after restart", restored)
}

func seedProfileRuntimePreparedAssetSelectedSourceForService(
	t *testing.T,
	svc *Service,
	family string,
	asset *runtimev1.LocalAssetRecord,
	parentAssetID string,
	parentSelectedSourceRecordID string,
	canonicalRoot string,
) localEnvironmentSelectedSourceRecordState {
	t.Helper()
	if asset == nil {
		t.Fatal("selected-source fixture requires an asset")
	}
	assetID := strings.TrimSpace(asset.GetAssetId())
	localAssetID := strings.TrimSpace(asset.GetLocalAssetId())
	entrySHA256, err := computeFileSHA256(strings.TrimSpace(canonicalRoot))
	if err != nil {
		t.Fatalf("hash selected-source fixture entry: %v", err)
	}
	dependencyID := strings.TrimSpace(assetID)
	semanticHashKey := "asset_id"
	localIDHashKey := "local_asset_id"
	localIDCompatibilityKey := localIDHashKey
	if family == localEnvironmentFamilyModelCompanion {
		dependencyID = localEnvironmentCompanionAssetDependencyID(assetID, parentAssetID)
		semanticHashKey = "companion_asset_id"
		localIDHashKey = "companion_local_asset_id"
		localIDCompatibilityKey = localIDHashKey
	}
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
		CanonicalRoot: strings.TrimSpace(canonicalRoot),
		CompatibilityEvidence: []string{
			semanticHashKey + "=" + assetID,
			localIDCompatibilityKey + "=" + strings.TrimSpace(localAssetID),
			"source_repo=" + strings.TrimSpace(asset.GetSource().GetRepo()),
			"source_revision=" + strings.TrimSpace(asset.GetSource().GetRevision()),
		},
		VerifiedArtifacts: []string{strings.TrimSpace(canonicalRoot)},
		Hashes: map[string]string{
			semanticHashKey: assetID,
			localIDHashKey:  strings.TrimSpace(localAssetID),
			"entry_sha256":  entrySHA256,
		},
		SelectedConsumers: []string{"stable-diffusion.cpp.metal"},
	})
	if family == localEnvironmentFamilyModelCompanion {
		record.SourceKind = localEnvironmentSourceManaged
		if strings.TrimSpace(asset.GetSourceFileName()) != "" {
			record.SourceKind = localEnvironmentSourceImported
		}
		record.CompatibilityEvidence = append(
			record.CompatibilityEvidence,
			"parent_model_asset_record="+strings.TrimSpace(parentSelectedSourceRecordID),
		)
		record.Hashes["parent_model_asset_record"] = strings.TrimSpace(parentSelectedSourceRecordID)
	}
	return svc.upsertLocalEnvironmentSelectedSourceRecord(record)
}
