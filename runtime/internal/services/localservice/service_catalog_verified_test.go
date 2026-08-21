package localservice

import (
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	catalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestDefaultCatalogPreservesVerifiedSourceProvenance(t *testing.T) {
	metadata, _ := structpb.NewStruct(map[string]any{"provenance": "upstream/model converted by exact-owner"})
	items := defaultCatalogFromVerified([]*runtimev1.LocalVerifiedAssetDescriptor{{
		TemplateId: "local.test.model", AssetId: "local.test.model", Metadata: metadata,
	}})
	if len(items) != 1 || items[0].GetSourceProvenance() != "upstream/model converted by exact-owner" {
		t.Fatalf("catalog source provenance = %+v", items)
	}
}

func TestProjectVerifiedVoxCPMAssetCarriesCanonicalFamilyAndPrivateBackend(t *testing.T) {
	row := catalog.ModelEntry{
		ModelID:      "voxcpm2-local",
		ModelType:    "tts",
		Family:       "voxcpm",
		Capabilities: []string{"audio.synthesize"},
		Install: &catalog.LocalPlaneInstall{
			Repo:            "openbmb/VoxCPM2",
			Revision:        "bffb3df5a29440629464e5e839f4d214c8714c3d",
			InstallKind:     "verified-hf-multi-file",
			Entry:           "model.safetensors",
			ArtifactRoles:   []string{"tts_model"},
			PreferredEngine: "speech",
		},
	}
	variant := catalog.LocalPlaneVariant{
		VariantID:      "local.tts.voxcpm2.mlx.metal",
		Quant:          "Q4_0",
		Entry:          "model.safetensors",
		Files:          []string{"model.safetensors"},
		Hashes:         map[string]string{"model.safetensors": "sha256:25bddc99a7cc6d28214f12dd676ed0afa9b0a805d6477f85c275bb113cb8acee"},
		TotalSizeBytes: 2300904017,
		Repo:           "mlx-community/VoxCPM2-4bit",
		Revision:       "dc9e5c187858da5f4a13dc4c247e297339216381",
		DriverBackend:  "mlx",
		HostRequirement: catalog.LocalPlaneHostRequirement{
			Accelerator:  "metal",
			MinRAMBytes:  8589934592,
			MinVRAMBytes: 6442450944,
		},
	}

	descriptor, err := projectVerifiedAssetDescriptor(row, variant)
	if err != nil {
		t.Fatalf("project VoxCPM descriptor: %v", err)
	}
	if descriptor.GetRepo() != variant.Repo || descriptor.GetRevision() != variant.Revision {
		t.Fatalf("variant source override was lost: repo=%q revision=%q", descriptor.GetRepo(), descriptor.GetRevision())
	}
	if descriptor.GetMetadata().GetFields()["family"].GetStringValue() != "voxcpm" ||
		descriptor.GetEngineConfig().GetFields()["driver_family"].GetStringValue() != "voxcpm" ||
		descriptor.GetEngineConfig().GetFields()["driver_backend"].GetStringValue() != "mlx" {
		t.Fatalf("VoxCPM descriptor identity material=%+v engine=%+v", descriptor.GetMetadata(), descriptor.GetEngineConfig())
	}
	if len(descriptor.GetCapabilities()) != 1 || descriptor.GetCapabilities()[0] != "audio.synthesize" {
		t.Fatalf("VoxCPM capabilities=%v", descriptor.GetCapabilities())
	}
	if descriptor.GetTotalSizeBytes() != variant.TotalSizeBytes {
		t.Fatalf("VoxCPM total size=%d, want %d", descriptor.GetTotalSizeBytes(), variant.TotalSizeBytes)
	}
	if descriptor.GetContentId() != variant.Hashes[variant.Files[0]] {
		t.Fatalf("VoxCPM descriptor content identity=%q want=%q", descriptor.GetContentId(), variant.Hashes[variant.Files[0]])
	}
}

func TestProjectVerifiedSingleFileDescriptorDoesNotDoublePrefixContentIdentity(t *testing.T) {
	const digest = "25bddc99a7cc6d28214f12dd676ed0afa9b0a805d6477f85c275bb113cb8acee"
	descriptor, err := projectVerifiedAssetDescriptor(catalog.ModelEntry{
		ModelID:      "single-file-chat",
		Capabilities: []string{"text.generate"},
		Install: &catalog.LocalPlaneInstall{
			InstallKind:     "verified-hf-single-file",
			PreferredEngine: "llama",
		},
	}, catalog.LocalPlaneVariant{
		VariantID: "local.chat.single-file",
		Entry:     "model.gguf",
		Files:     []string{"model.gguf"},
		Hashes:    map[string]string{"model.gguf": "sha256:" + digest},
	})
	if err != nil {
		t.Fatalf("project single-file descriptor: %v", err)
	}
	if got, want := descriptor.GetContentId(), "sha256:"+digest; got != want {
		t.Fatalf("single-file descriptor content identity=%q want=%q", got, want)
	}
}

func TestProjectVerifiedAssetDescriptorCarriesCanonicalMultiFileContentIdentity(t *testing.T) {
	row := catalog.ModelEntry{
		ModelID:      "multi-file-chat",
		Capabilities: []string{"text.generate"},
		Install: &catalog.LocalPlaneInstall{
			InstallKind:     "verified-hf-multi-file",
			PreferredEngine: "llama",
		},
	}
	variant := catalog.LocalPlaneVariant{
		VariantID: "local.chat.multi-file",
		Entry:     "model.safetensors",
		Files:     []string{"model.safetensors", "config.json"},
		Hashes: map[string]string{
			"model.safetensors": "sha256:" + strings.Repeat("1", 64),
			"config.json":       "sha256:" + strings.Repeat("2", 64),
		},
	}
	descriptor, err := projectVerifiedAssetDescriptor(row, variant)
	if err != nil {
		t.Fatalf("project multi-file descriptor: %v", err)
	}
	expected := modelAssetContentID([]*runtimev1.ModelAssetFile{
		{RelativePath: "model.safetensors", Sha256: variant.Hashes["model.safetensors"]},
		{RelativePath: "config.json", Sha256: variant.Hashes["config.json"]},
	})
	if descriptor.GetContentId() != expected || descriptor.GetContentId() == variant.Hashes[variant.Entry] {
		t.Fatalf("multi-file descriptor content identity=%q want=%q", descriptor.GetContentId(), expected)
	}
}

func TestVerifiedAssetsFromLocalCatalogProjectsIndependentModelAssetOffers(t *testing.T) {
	local, err := catalog.LoadBuiltInLocalProviderCatalog()
	if err != nil {
		t.Fatalf("load local catalog: %v", err)
	}
	descriptors, err := verifiedAssetsFromLocalCatalog(local)
	if err != nil {
		t.Fatalf("project verified catalog assets: %v", err)
	}
	service := &Service{verified: descriptors}

	tests := []struct {
		name           string
		assetID        string
		kind           runtimev1.LocalAssetKind
		family         string
		artifactRole   string
		repo           string
		revision       string
		file           string
		hash           string
		logicalModelID string
		runnable       bool
	}{
		{
			name:           "qwen generation main",
			assetID:        "local.image.qwen-image.q4-k-m.cuda",
			kind:           runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE,
			family:         "qwen-image",
			artifactRole:   "diffusion_model",
			repo:           "QuantStack/Qwen-Image-GGUF",
			revision:       "257f261fa92593bed760aa6fa3f7921a49fea00f",
			file:           "Qwen_Image-Q4_K_M.gguf",
			hash:           "sha256:645473886d7dbb0103f84c563c798f7b0867293d919752d4d6be6a432b0bc988",
			logicalModelID: "qwen-image-local",
			runnable:       true,
		},
		{
			name:           "qwen edit main",
			assetID:        "local.image.qwen-image-edit-2511.q4-k-m.cuda",
			kind:           runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE,
			family:         "qwen-image",
			artifactRole:   "edit_diffusion_model",
			repo:           "unsloth/Qwen-Image-Edit-2511-GGUF",
			revision:       "0d33d9692b4b26212297240d87b0d4719aa4fd06",
			file:           "qwen-image-edit-2511-Q4_K_M.gguf",
			hash:           "sha256:8677bac90627adbbc11efab87b1870e701c4eb3689ee865a3de8ab81b705a723",
			logicalModelID: "qwen-image-edit-2511-local",
			runnable:       true,
		},
		{
			name:         "z image vae",
			assetID:      "local.image-vae.z-image-ae.f16.cuda",
			kind:         runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE,
			family:       "flux1-vae",
			artifactRole: "vae",
			repo:         "Comfy-Org/z_image_turbo",
			revision:     "2f862278568d3f0a83167a16e5f11094da6dee72",
			file:         "split_files/vae/ae.safetensors",
			hash:         "sha256:afc8e28272cd15db3919bacdb6918ce9c1ed22e96cb12c4d5ed0fba823529e38",
		},
		{
			name:         "z image text encoder",
			assetID:      "local.image-textenc.qwen3-4b-instruct-2507.q4-k-m.cuda",
			kind:         runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_AUXILIARY,
			family:       "qwen",
			artifactRole: "text_encoder",
			repo:         "unsloth/Qwen3-4B-Instruct-2507-GGUF",
			revision:     "a06e946bb6b655725eafa393f4a9745d460374c9",
			file:         "Qwen3-4B-Instruct-2507-Q4_K_M.gguf",
			hash:         "sha256:3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597",
		},
		{
			name:         "qwen image vae",
			assetID:      "local.image-vae.qwen-image.f16.cuda",
			kind:         runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE,
			family:       "qwen-image-vae",
			artifactRole: "vae",
			repo:         "QuantStack/Qwen-Image-GGUF",
			revision:     "257f261fa92593bed760aa6fa3f7921a49fea00f",
			file:         "VAE/Qwen_Image-VAE.safetensors",
			hash:         "sha256:a70580f0213e67967ee9c95f05bb400e8fb08307e017a924bf3441223e023d1f",
		},
		{
			name:         "qwen image text encoder",
			assetID:      "local.image-textenc.qwen2.5-vl-7b.q4-k-m.cuda",
			kind:         runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_AUXILIARY,
			family:       "qwen-vl",
			artifactRole: "text_encoder",
			repo:         "mradermacher/Qwen2.5-VL-7B-Instruct-GGUF",
			revision:     "cfa2baa09946b211c107e6e104948987a64dd2c1",
			file:         "Qwen2.5-VL-7B-Instruct.Q4_K_M.gguf",
			hash:         "sha256:0f00a930ba3108b6861ddadf74d8ebbd82e257c63eba728e62c3e8970f5eed94",
		},
		{
			name:         "qwen edit vae",
			assetID:      "local.image-vae.qwen-image-edit-2511.f16.cuda",
			kind:         runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE,
			family:       "qwen-image-vae",
			artifactRole: "vae",
			repo:         "QuantStack/Qwen-Image-GGUF",
			revision:     "257f261fa92593bed760aa6fa3f7921a49fea00f",
			file:         "VAE/Qwen_Image-VAE.safetensors",
			hash:         "sha256:a70580f0213e67967ee9c95f05bb400e8fb08307e017a924bf3441223e023d1f",
		},
		{
			name:         "qwen edit text encoder",
			assetID:      "local.image-textenc.qwen2.5-vl-7b-edit-2511.q4-k-m.cuda",
			kind:         runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_AUXILIARY,
			family:       "qwen-vl",
			artifactRole: "text_encoder",
			repo:         "mradermacher/Qwen2.5-VL-7B-Instruct-GGUF",
			revision:     "cfa2baa09946b211c107e6e104948987a64dd2c1",
			file:         "Qwen2.5-VL-7B-Instruct.Q4_K_M.gguf",
			hash:         "sha256:0f00a930ba3108b6861ddadf74d8ebbd82e257c63eba728e62c3e8970f5eed94",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			descriptor := service.verifiedAssetDescriptorForAssetID(test.assetID)
			if descriptor == nil {
				t.Fatalf("verified descriptor %q was not materialized", test.assetID)
			}
			if descriptor.GetAssetId() != test.assetID || descriptor.GetTemplateId() != test.assetID {
				t.Fatalf("descriptor identity mismatch: asset=%q template=%q", descriptor.GetAssetId(), descriptor.GetTemplateId())
			}
			if descriptor.GetKind() != test.kind {
				t.Fatalf("kind=%s want=%s", descriptor.GetKind(), test.kind)
			}
			if got := descriptor.GetMetadata().GetFields()["family"].GetStringValue(); got != test.family {
				t.Fatalf("family=%q want=%q", got, test.family)
			}
			if roles := descriptor.GetArtifactRoles(); len(roles) != 1 || roles[0] != test.artifactRole {
				t.Fatalf("artifact roles=%v want=%q", roles, test.artifactRole)
			}
			if descriptor.GetRepo() != test.repo || descriptor.GetRevision() != test.revision {
				t.Fatalf("source=%q@%q want=%q@%q", descriptor.GetRepo(), descriptor.GetRevision(), test.repo, test.revision)
			}
			if test.runnable {
				if descriptor.GetEngine() != "media" || descriptor.GetPreferredEngine() != "media" {
					t.Fatalf("runnable engine=%q preferred=%q want media", descriptor.GetEngine(), descriptor.GetPreferredEngine())
				}
			} else if descriptor.GetEngine() != "" || descriptor.GetPreferredEngine() != "" {
				t.Fatalf("passive engine=%q preferred=%q want empty", descriptor.GetEngine(), descriptor.GetPreferredEngine())
			}
			if got := descriptor.GetHashes()[test.file]; got != test.hash {
				t.Fatalf("hash[%q]=%q want=%q", test.file, got, test.hash)
			}
			if descriptor.GetLogicalModelId() != test.logicalModelID {
				t.Fatalf("logical_model_id=%q want=%q", descriptor.GetLogicalModelId(), test.logicalModelID)
			}
			if test.runnable {
				if capabilities := descriptor.GetCapabilities(); len(capabilities) != 1 || capabilities[0] != "image.generate" {
					t.Fatalf("runnable capabilities=%v", capabilities)
				}
				return
			}
			if len(descriptor.GetCapabilities()) != 0 {
				t.Fatalf("passive offer must not carry capabilities: %v", descriptor.GetCapabilities())
			}
			if descriptor.GetEngineConfig() != nil {
				t.Fatalf("passive offer must not carry runnable engine config: %v", descriptor.GetEngineConfig())
			}
			metadata := descriptor.GetMetadata().GetFields()
			if metadata["parent_model_id"] != nil || metadata["engine_slot"] != nil {
				t.Fatalf("independent ModelAsset offer leaked parent or slot identity: %+v", metadata)
			}
		})
	}
}
