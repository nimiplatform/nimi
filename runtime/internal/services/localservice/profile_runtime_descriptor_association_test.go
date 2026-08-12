package localservice

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestProfileRuntimeSelectedSourceSatisfiesPortableHFBindingExactly(t *testing.T) {
	svc := newTestService(t)
	setLocalModelsPathForTest(t, svc, filepath.Join(t.TempDir(), "models"))
	contentHash := strings.Repeat("a", 64)
	binding := profileRuntimeDescriptorAssetBinding{
		BindingID:        "main",
		AssetRole:        "main",
		ComponentKind:    "image",
		Source:           "huggingface",
		ExpectedIdentity: "z_image_turbo",
		ReadinessPolicy:  "required",
		HuggingFace: &profileRuntimeDescriptorHFSource{
			RepoID:            "nimiplatform/z-image",
			Revision:          "main",
			Entries:           []string{"z_image_turbo-Q4_K.gguf"},
			AccessPolicy:      "public",
			ExpectedIntegrity: "sha256:" + contentHash,
		},
	}
	record := localEnvironmentSelectedSourceRecordState{
		SourceKind: localEnvironmentSourceManaged,
		CompatibilityEvidence: []string{
			"source_repo=nimiplatform/z-image",
			"source_revision=main",
		},
		Hashes: map[string]string{
			"entry_sha256": contentHash,
		},
	}
	asset := &runtimev1.LocalAssetRecord{
		LocalAssetId:   "artifact_main",
		AssetId:        "z_image_turbo",
		Kind:           runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE,
		Capabilities:   []string{"image.generate"},
		Entry:          "z_image_turbo-Q4_K.gguf",
		LogicalModelId: "nimi/z_image_turbo",
		Source: &runtimev1.LocalAssetSource{
			Repo:     "nimiplatform/z-image",
			Revision: "main",
		},
		Hashes: map[string]string{
			"z_image_turbo-Q4_K.gguf": "sha256:" + contentHash,
		},
	}
	entryPath, err := resolveManagedModelEntryAbsolutePath(svc.resolvedLocalModelsPath(), asset)
	if err != nil {
		t.Fatalf("resolve managed HF entry: %v", err)
	}
	record.CanonicalRoot = entryPath
	record.VerifiedArtifacts = []string{entryPath}
	if !svc.profileRuntimeSelectedSourceSatisfiesPortableBinding(binding, record, asset) {
		t.Fatal("exact HF source binding must be satisfied")
	}

	cases := []struct {
		name   string
		mutate func(*profileRuntimeDescriptorAssetBinding)
	}{
		{
			name: "repo mismatch",
			mutate: func(next *profileRuntimeDescriptorAssetBinding) {
				next.HuggingFace.RepoID = "nimiplatform/other-image"
			},
		},
		{
			name: "revision mismatch",
			mutate: func(next *profileRuntimeDescriptorAssetBinding) {
				next.HuggingFace.Revision = "other"
			},
		},
		{
			name: "entry mismatch",
			mutate: func(next *profileRuntimeDescriptorAssetBinding) {
				next.HuggingFace.Entries = []string{"other.gguf"}
			},
		},
		{
			name: "secondary entry lacks current verification",
			mutate: func(next *profileRuntimeDescriptorAssetBinding) {
				next.HuggingFace.Entries = []string{"z_image_turbo-Q4_K.gguf", "secondary.gguf"}
			},
		},
		{
			name: "integrity mismatch",
			mutate: func(next *profileRuntimeDescriptorAssetBinding) {
				next.HuggingFace.ExpectedIntegrity = "sha256:" + strings.Repeat("b", 64)
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			next := binding
			hf := *binding.HuggingFace
			next.HuggingFace = &hf
			tc.mutate(&next)
			if svc.profileRuntimeSelectedSourceSatisfiesPortableBinding(next, record, asset) {
				t.Fatalf("%s must not associate", tc.name)
			}
		})
	}
}

func TestProfileRuntimeSelectedSourceSatisfiesVerifiedManualBindingExactly(t *testing.T) {
	svc := newTestService(t)
	contentHash := strings.Repeat("c", 64)
	binding := profileRuntimeDescriptorAssetBinding{
		BindingID:        "ae",
		AssetRole:        "companion",
		ComponentKind:    "vae",
		Source:           "manual",
		ExpectedIdentity: "portable:z-image-ae",
		ReadinessPolicy:  "required",
		Manual: &profileRuntimeDescriptorManualSource{
			ExpectedName:            "ae.safetensors",
			AssociationInstructions: "Associate the verified VAE.",
			AllowedFilePatterns:     []string{"*.safetensors"},
			ExpectedIntegrity:       "sha256:" + contentHash,
		},
	}
	record := localEnvironmentSelectedSourceRecordState{
		SourceKind: localEnvironmentSourceImported,
		Hashes: map[string]string{
			"entry_sha256": contentHash,
		},
	}
	asset := &runtimev1.LocalAssetRecord{
		LocalAssetId:   "artifact_ae",
		AssetId:        "local-import/ae/import-instance-01",
		Entry:          "ae.safetensors",
		SourceFileName: "ae.safetensors",
		Hashes: map[string]string{
			"ae.safetensors": "sha256:" + contentHash,
		},
	}
	if !svc.profileRuntimeSelectedSourceSatisfiesPortableBinding(binding, record, asset) {
		t.Fatal("verified imported manual binding must not depend on the machine-specific asset id")
	}

	t.Run("managed source is not manual verification", func(t *testing.T) {
		nextRecord := record
		nextRecord.SourceKind = localEnvironmentSourceManaged
		if svc.profileRuntimeSelectedSourceSatisfiesPortableBinding(binding, nextRecord, asset) {
			t.Fatal("managed source must not satisfy a manual association")
		}
	})
	t.Run("expected name mismatch", func(t *testing.T) {
		next := binding
		manual := *binding.Manual
		manual.ExpectedName = "other.safetensors"
		next.Manual = &manual
		if svc.profileRuntimeSelectedSourceSatisfiesPortableBinding(next, record, asset) {
			t.Fatal("manual expected name mismatch must not associate")
		}
	})
	t.Run("allowed pattern mismatch", func(t *testing.T) {
		next := binding
		manual := *binding.Manual
		manual.AllowedFilePatterns = []string{"*.gguf"}
		next.Manual = &manual
		if svc.profileRuntimeSelectedSourceSatisfiesPortableBinding(next, record, asset) {
			t.Fatal("manual allowed pattern mismatch must not associate")
		}
	})
	t.Run("integrity mismatch", func(t *testing.T) {
		next := binding
		manual := *binding.Manual
		manual.ExpectedIntegrity = "sha256:" + strings.Repeat("d", 64)
		next.Manual = &manual
		if svc.profileRuntimeSelectedSourceSatisfiesPortableBinding(next, record, asset) {
			t.Fatal("manual integrity mismatch must not associate")
		}
	})
	t.Run("missing exact source file name does not fall back to entry", func(t *testing.T) {
		nextAsset := cloneLocalAsset(asset)
		nextAsset.SourceFileName = ""
		if svc.profileRuntimeSelectedSourceSatisfiesPortableBinding(binding, record, nextAsset) {
			t.Fatal("manual association must require exact source_file_name")
		}
	})
}

func TestProfileRuntimePortableManualAssociationRejectsAmbiguousSelectedSources(t *testing.T) {
	svc := newTestService(t)
	content := []byte("same verified VAE content")
	contentHash := ""
	for index := 1; index <= 2; index++ {
		entryPath := filepath.Join(t.TempDir(), "ae.safetensors")
		if err := os.WriteFile(entryPath, content, 0o600); err != nil {
			t.Fatalf("write selected-source fixture: %v", err)
		}
		if contentHash == "" {
			var err error
			contentHash, err = computeFileSHA256(entryPath)
			if err != nil {
				t.Fatalf("hash selected-source fixture: %v", err)
			}
		}
		localAssetID := "local-vae-" + string(rune('0'+index))
		asset := &runtimev1.LocalAssetRecord{
			LocalAssetId:   localAssetID,
			AssetId:        "local-import/ae/import-instance-0" + string(rune('0'+index)),
			Kind:           runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE,
			Entry:          "ae.safetensors",
			SourceFileName: "ae.safetensors",
			Hashes:         map[string]string{"ae.safetensors": "sha256:" + contentHash},
			Status:         runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
		}
		svc.assets[localAssetID] = asset
		seedProfileRuntimePreparedAssetSelectedSourceForService(
			t,
			svc,
			localEnvironmentFamilyModelCompanion,
			asset,
			"machine-specific-main-asset",
			"parent-selected-source-record",
			entryPath,
			"stable-diffusion.cpp.cuda",
		)
	}
	binding := profileRuntimeDescriptorAssetBinding{
		BindingID:        "ae",
		AssetRole:        "companion",
		ComponentKind:    "vae",
		Source:           "manual",
		ExpectedIdentity: "portable:z-image-ae",
		ReadinessPolicy:  "required",
		Manual: &profileRuntimeDescriptorManualSource{
			ExpectedName:        "ae.safetensors",
			ExpectedIntegrity:   "sha256:" + contentHash,
			AllowedFilePatterns: []string{"*.safetensors"},
		},
	}
	_, _, found, err := svc.profileRuntimeSelectedSourcePreparedAsset(
		binding,
		localEnvironmentFamilyModelCompanion,
		"portable-main-identity",
		"stable-diffusion.cpp.cuda",
		"parent-selected-source-record",
	)
	if err == nil || found || !strings.Contains(err.Error(), "prepared_asset_association_ambiguous") {
		t.Fatalf("ambiguous portable association: found=%v err=%v", found, err)
	}
}

func TestProfileRuntimeExpectedIntegrityRequiresSelectedSourceObservedEntryHash(t *testing.T) {
	contentHash := strings.Repeat("e", 64)
	if profileRuntimeExpectedIntegritySatisfied(contentHash, map[string]string{
		"asset_id":       "sha256:" + contentHash,
		"local_asset_id": "sha256:" + contentHash,
	}) {
		t.Fatal("identity or copied hash values must never satisfy expected content integrity")
	}
	if !profileRuntimeExpectedIntegritySatisfied("sha256:"+contentHash, map[string]string{
		"entry_sha256": contentHash,
	}) {
		t.Fatal("current selected-source observed entry_sha256 must satisfy expected integrity")
	}
}

func TestProfileRuntimePortableAssociationRequiresEverySliceConsumer(t *testing.T) {
	svc := newTestService(t)
	descriptor := testProfileRuntimeImageCompanionDescriptor()
	cudaSlice := descriptor.CapabilitySlices[0]
	cudaSlice.SliceID = "slice:image-native-cuda"
	cudaSlice.RuntimeConsumerID = "stable-diffusion.cpp.cuda"
	descriptor.CapabilitySlices = append(descriptor.CapabilitySlices, cudaSlice)

	seedProfileRuntimePortableSelectedSourcesForService(t, svc, descriptor)
	validated, err := validateProfileRuntimeDescriptor(marshalProfileRuntimeDescriptor(t, descriptor))
	if err != nil {
		t.Fatalf("validate multi-consumer portable descriptor: %v", err)
	}
	if err := svc.associateProfileRuntimeDescriptorPreparedAssets(validated); err != nil {
		t.Fatalf("associate multi-consumer portable descriptor: %v", err)
	}
	for _, binding := range validated.AssetBindings {
		if strings.TrimSpace(binding.PreparedAssetID) != "" {
			t.Fatalf(
				"binding %q must stay unassociated when the CUDA slice lacks an exact selected-source consumer: %q",
				binding.BindingID,
				binding.PreparedAssetID,
			)
		}
	}
}
