package localservice

import (
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestProfileRuntimeSelectedSourceSatisfiesPortableHFBindingExactly(t *testing.T) {
	svc := newTestService(t)
	svc.SetManagedLlamaRegistrationConfig(filepath.Join(t.TempDir(), "models"), "", false)
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
		Capabilities:   []string{"image"},
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
		ExpectedIdentity: "z_image_ae",
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
		AssetId:        "z_image_ae",
		Entry:          "ae.safetensors",
		SourceFileName: "ae.safetensors",
		Hashes: map[string]string{
			"ae.safetensors": "sha256:" + contentHash,
		},
	}
	if !svc.profileRuntimeSelectedSourceSatisfiesPortableBinding(binding, record, asset) {
		t.Fatal("verified imported manual binding must be satisfied")
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
