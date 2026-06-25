package localservice

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestResolveManagedMediaImageProfileRejectsPathOverrides(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	modelsRoot := filepath.Join(t.TempDir(), "models")
	svc.SetManagedLlamaRegistrationConfig(modelsRoot, "", false)

	engineConfig, err := structpb.NewStruct(map[string]any{
		"backend": "stablediffusion-ggml",
	})
	if err != nil {
		t.Fatalf("build engine config: %v", err)
	}
	modelResp := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "z_image_turbo",
		capabilities: []string{"image"},
		engine:       "media",
		entry:        "z_image_turbo-Q4_K_M.gguf",
		engineConfig: engineConfig,
	})
	svc.mu.Lock()
	svc.assets[modelResp.GetLocalAssetId()].Status = runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE
	svc.mu.Unlock()
	writeManagedAssetEntryFixture(t, modelsRoot, modelResp, "main-model")

	cases := []struct {
		name      string
		overrides map[string]any
	}{
		{
			name: "option path",
			overrides: map[string]any{
				"options": []any{"vae_path:/tmp/outside.safetensors"},
			},
		},
		{
			name: "option uncond diffusion model",
			overrides: map[string]any{
				"options": []any{"uncond_diffusion_model:/tmp/ideogram4_uncond.gguf"},
			},
		},
		{
			name: "option diffusion model value",
			overrides: map[string]any{
				"options": []any{"diffusion_model:/tmp/main.gguf"},
			},
		},
		{
			name: "top-level path",
			overrides: map[string]any{
				"vae_path": "/tmp/outside.safetensors",
			},
		},
		{
			name: "top-level uncond diffusion model",
			overrides: map[string]any{
				"uncond_diffusion_model": "/tmp/ideogram4_uncond.gguf",
			},
		},
		{
			name: "nested path",
			overrides: map[string]any{
				"parameters": map[string]any{
					"extras": map[string]any{
						"controlnet_path": "/tmp/controlnet.safetensors",
					},
				},
			},
		},
		{
			name: "nested model",
			overrides: map[string]any{
				"parameters": map[string]any{
					"model": "/tmp/model.safetensors",
				},
			},
		},
		{
			name: "nested download files",
			overrides: map[string]any{
				"parameters": map[string]any{
					"download_files": []any{"https://example.invalid/model.bin"},
				},
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, _, _, err = svc.ResolveManagedMediaImageProfile(context.Background(), "media/z_image_turbo", map[string]any{
				"profile_overrides": tc.overrides,
			})
			if err == nil {
				t.Fatalf("expected path override rejection")
			}
			if status.Code(err) != codes.InvalidArgument {
				t.Fatalf("expected invalid argument, got %v", status.Code(err))
			}
		})
	}
}

func TestResolveManagedMediaImageProfileFailsCloseWithoutProfileEntries(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	modelsRoot := filepath.Join(t.TempDir(), "models")
	svc.SetManagedLlamaRegistrationConfig(modelsRoot, "", false)

	engineConfig, err := structpb.NewStruct(map[string]any{
		"backend": "stablediffusion-ggml",
		"parameters": map[string]any{
			"scheduler": "karras",
		},
	})
	if err != nil {
		t.Fatalf("build engine config: %v", err)
	}
	modelResp := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "z_image_turbo",
		capabilities: []string{"image"},
		engine:       "media",
		entry:        "z_image_turbo-Q4_K_M.gguf",
		engineConfig: engineConfig,
	})
	svc.mu.Lock()
	svc.assets[modelResp.GetLocalAssetId()].Status = runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE
	svc.mu.Unlock()
	writeManagedAssetEntryFixture(t, modelsRoot, modelResp, "main-model")

	_, _, _, err = svc.ResolveManagedMediaImageProfile(context.Background(), "media/z_image_turbo", map[string]any{
		"profile_overrides": map[string]any{
			"step": 25,
		},
	})
	if err == nil {
		t.Fatalf("expected fail-close when no profile entries are supplied")
	}
	assertGRPCReasonCode(t, err, "missing profile entries", runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
}

func TestResolveManagedMediaImageProfileRejectsMissingRequiredSlotAsset(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	modelsRoot := filepath.Join(t.TempDir(), "models")
	svc.SetManagedLlamaRegistrationConfig(modelsRoot, "", false)

	engineConfig, err := structpb.NewStruct(map[string]any{
		"backend": "stablediffusion-ggml",
	})
	if err != nil {
		t.Fatalf("build engine config: %v", err)
	}
	modelResp := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "z_image_turbo",
		capabilities: []string{"image"},
		engine:       "media",
		entry:        "z_image_turbo-Q4_K_M.gguf",
		engineConfig: engineConfig,
	})
	svc.mu.Lock()
	svc.assets[modelResp.GetLocalAssetId()].Status = runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE
	svc.mu.Unlock()
	writeManagedAssetEntryFixture(t, modelsRoot, modelResp, "main-model")

	required := true
	_, _, _, err = svc.ResolveManagedMediaImageProfile(context.Background(), "media/z_image_turbo", map[string]any{
		"profile_entries": []*runtimev1.LocalProfileEntryDescriptor{
			{
				EntryId:    "vae-slot",
				Kind:       runtimev1.LocalProfileEntryKind_LOCAL_PROFILE_ENTRY_KIND_ASSET,
				Capability: "image",
				AssetId:    "nonexistent_vae",
				AssetKind:  runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE,
				Engine:     "media",
				EngineSlot: "vae_path",
				Required:   &required,
			},
		},
	})
	if err == nil {
		t.Fatalf("expected missing required slot asset to fail")
	}
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected failed precondition, got %v", status.Code(err))
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok {
		t.Fatalf("expected reason code on missing slot asset error")
	}
	if reason != runtimev1.ReasonCode_AI_LOCAL_ASSET_SLOT_MISSING {
		t.Fatalf("unexpected reason code: %s", reason)
	}
}

func TestResolveManagedMediaImageProfileRejectsOptionalMissingSlotAsset(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	modelsRoot := filepath.Join(t.TempDir(), "models")
	svc.SetManagedLlamaRegistrationConfig(modelsRoot, "", false)

	engineConfig, err := structpb.NewStruct(map[string]any{"backend": "stablediffusion-ggml"})
	if err != nil {
		t.Fatalf("build engine config: %v", err)
	}
	modelResp := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "z_image_turbo",
		capabilities: []string{"image"},
		engine:       "media",
		entry:        "z_image_turbo-Q4_K_M.gguf",
		engineConfig: engineConfig,
	})
	svc.mu.Lock()
	svc.assets[modelResp.GetLocalAssetId()].Status = runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE
	svc.mu.Unlock()
	writeManagedAssetEntryFixture(t, modelsRoot, modelResp, "main-model")

	optional := false
	_, _, _, err = svc.ResolveManagedMediaImageProfile(context.Background(), "media/z_image_turbo", map[string]any{
		"profile_entries": []*runtimev1.LocalProfileEntryDescriptor{
			{
				EntryId:    "main-image",
				Kind:       runtimev1.LocalProfileEntryKind_LOCAL_PROFILE_ENTRY_KIND_ASSET,
				Capability: "image",
				AssetId:    "z_image_turbo",
				AssetKind:  runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE,
				Engine:     "media",
			},
			{
				EntryId:    "missing-optional-vae",
				Kind:       runtimev1.LocalProfileEntryKind_LOCAL_PROFILE_ENTRY_KIND_ASSET,
				Capability: "image",
				AssetId:    "nonexistent_vae",
				AssetKind:  runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE,
				Engine:     "media",
				EngineSlot: "vae_path",
				Required:   &optional,
			},
		},
	})
	if err == nil {
		t.Fatalf("expected optional missing slot asset to fail-close")
	}
	assertGRPCReasonCode(t, err, "optional slot asset missing", runtimev1.ReasonCode_AI_LOCAL_ASSET_SLOT_MISSING)
}

func TestResolveManagedMediaImageProfileRejectsLocalImportSlotSourceRepo(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	modelsRoot := filepath.Join(t.TempDir(), "models")
	svc.SetManagedLlamaRegistrationConfig(modelsRoot, "", false)

	engineConfig, err := structpb.NewStruct(map[string]any{
		"backend": "stablediffusion-ggml",
		"options": []any{
			"diffusion_model",
			"vae_path:old.safetensors",
		},
	})
	if err != nil {
		t.Fatalf("build engine config: %v", err)
	}
	modelResp := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "z_image_turbo",
		capabilities: []string{"image"},
		engine:       "media",
		entry:        "z_image_turbo-Q4_K_M.gguf",
		engineConfig: engineConfig,
	})
	svc.mu.Lock()
	svc.assets[modelResp.GetLocalAssetId()].Status = runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE
	svc.mu.Unlock()
	writeManagedAssetEntryFixture(t, modelsRoot, modelResp, "main-model")

	vaeRecord := &runtimev1.LocalAssetRecord{
		LocalAssetId: "artifact_" + ulid.Make().String(),
		AssetId:      "local-import/ae",
		Kind:         runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE,
		Engine:       "media",
		Entry:        "ae.safetensors",
		Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
		Source: &runtimev1.LocalAssetSource{
			Repo: "local-import/local-import-ae",
		},
	}
	svc.assets[vaeRecord.GetLocalAssetId()] = vaeRecord
	writeManagedAssetEntryFixture(t, modelsRoot, vaeRecord, "vae")

	_, _, _, err = svc.ResolveManagedMediaImageProfile(context.Background(), "media/z_image_turbo", map[string]any{
		"profile_entries": []*runtimev1.LocalProfileEntryDescriptor{
			{
				EntryId:   "main-image",
				Kind:      runtimev1.LocalProfileEntryKind_LOCAL_PROFILE_ENTRY_KIND_ASSET,
				AssetId:   "z_image_turbo",
				AssetKind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE,
				Engine:    "media",
			},
			{
				EntryId:    "legacy-vae-slot",
				Kind:       runtimev1.LocalProfileEntryKind_LOCAL_PROFILE_ENTRY_KIND_ASSET,
				Capability: "image",
				AssetId:    "local-import/ae",
				AssetKind:  runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE,
				Engine:     "media",
				EngineSlot: "vae_path",
			},
		},
	})
	if err == nil {
		t.Fatal("expected local-import source repo slot to fail closed")
	}
	assertGRPCReasonCode(t, err, "local-import source repo slot", runtimev1.ReasonCode_AI_LOCAL_ASSET_SLOT_MISSING)
	if !strings.Contains(err.Error(), "local-import source repos are not storage truth") {
		t.Fatalf("expected local-import storage truth error, got %v", err)
	}
}

func TestResolveManagedMediaImageProfileRejectsRunnableEngineSlotBinding(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	modelsRoot := filepath.Join(t.TempDir(), "models")
	svc.SetManagedLlamaRegistrationConfig(modelsRoot, "", false)

	engineConfig, err := structpb.NewStruct(map[string]any{"backend": "stablediffusion-ggml"})
	if err != nil {
		t.Fatalf("build engine config: %v", err)
	}
	modelResp := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "z_image_turbo",
		capabilities: []string{"image"},
		engine:       "media",
		entry:        "z_image_turbo-Q4_K_M.gguf",
		engineConfig: engineConfig,
	})
	svc.mu.Lock()
	svc.assets[modelResp.GetLocalAssetId()].Status = runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE
	svc.mu.Unlock()
	writeManagedAssetEntryFixture(t, modelsRoot, modelResp, "main-model")

	_, _, _, err = svc.ResolveManagedMediaImageProfile(context.Background(), "media/z_image_turbo", map[string]any{
		"profile_entries": []*runtimev1.LocalProfileEntryDescriptor{
			{
				EntryId:    "main-image",
				Kind:       runtimev1.LocalProfileEntryKind_LOCAL_PROFILE_ENTRY_KIND_ASSET,
				Capability: "image",
				AssetId:    "z_image_turbo",
				AssetKind:  runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE,
				Engine:     "media",
				EngineSlot: "vae_path",
			},
		},
	})
	if err == nil {
		t.Fatalf("expected runnable slot binding to fail-close")
	}
	assertGRPCReasonCode(t, err, "runnable engineSlot forbidden", runtimev1.ReasonCode_AI_LOCAL_ASSET_SLOT_FORBIDDEN)
}

func TestResolveManagedMediaImageProfileRejectsDuplicateEngineSlotBindings(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	modelsRoot := filepath.Join(t.TempDir(), "models")
	svc.SetManagedLlamaRegistrationConfig(modelsRoot, "", false)

	engineConfig, err := structpb.NewStruct(map[string]any{"backend": "stablediffusion-ggml"})
	if err != nil {
		t.Fatalf("build engine config: %v", err)
	}
	modelResp := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "z_image_turbo",
		capabilities: []string{"image"},
		engine:       "media",
		entry:        "z_image_turbo-Q4_K_M.gguf",
		engineConfig: engineConfig,
	})
	svc.mu.Lock()
	svc.assets[modelResp.GetLocalAssetId()].Status = runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE
	svc.mu.Unlock()
	writeManagedAssetEntryFixture(t, modelsRoot, modelResp, "main-model")

	firstSlotPath := filepath.Join(modelsRoot, "resolved", slugifyLocalAssetID("z_image_vae_a"), "vae", "diffusion_pytorch_model.safetensors")
	if err := os.MkdirAll(filepath.Dir(firstSlotPath), 0o755); err != nil {
		t.Fatalf("mkdir first slot dir: %v", err)
	}
	if err := os.WriteFile(firstSlotPath, []byte("vae-a"), 0o600); err != nil {
		t.Fatalf("write first slot file: %v", err)
	}
	secondSlotPath := filepath.Join(modelsRoot, "resolved", slugifyLocalAssetID("z_image_vae_b"), "vae", "diffusion_pytorch_model.safetensors")
	if err := os.MkdirAll(filepath.Dir(secondSlotPath), 0o755); err != nil {
		t.Fatalf("mkdir second slot dir: %v", err)
	}
	if err := os.WriteFile(secondSlotPath, []byte("vae-b"), 0o600); err != nil {
		t.Fatalf("write second slot file: %v", err)
	}

	firstLocalAssetID := "artifact_" + ulid.Make().String()
	svc.assets[firstLocalAssetID] = &runtimev1.LocalAssetRecord{
		LocalAssetId: firstLocalAssetID,
		AssetId:      "z_image_vae_a",
		Kind:         runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE,
		Engine:       "media",
		Entry:        "vae/diffusion_pytorch_model.safetensors",
		Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
		Source:       &runtimev1.LocalAssetSource{},
	}
	secondLocalAssetID := "artifact_" + ulid.Make().String()
	svc.assets[secondLocalAssetID] = &runtimev1.LocalAssetRecord{
		LocalAssetId: secondLocalAssetID,
		AssetId:      "z_image_vae_b",
		Kind:         runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE,
		Engine:       "media",
		Entry:        "vae/diffusion_pytorch_model.safetensors",
		Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
		Source:       &runtimev1.LocalAssetSource{},
	}

	_, _, _, err = svc.ResolveManagedMediaImageProfile(context.Background(), "media/z_image_turbo", map[string]any{
		"profile_entries": []*runtimev1.LocalProfileEntryDescriptor{
			{
				EntryId:    "main-image",
				Kind:       runtimev1.LocalProfileEntryKind_LOCAL_PROFILE_ENTRY_KIND_ASSET,
				Capability: "image",
				AssetId:    "z_image_turbo",
				AssetKind:  runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE,
				Engine:     "media",
			},
			{
				EntryId:    "vae-slot-a",
				Kind:       runtimev1.LocalProfileEntryKind_LOCAL_PROFILE_ENTRY_KIND_ASSET,
				Capability: "image",
				AssetId:    "z_image_vae_a",
				AssetKind:  runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE,
				Engine:     "media",
				EngineSlot: "vae_path",
			},
			{
				EntryId:    "vae-slot-b",
				Kind:       runtimev1.LocalProfileEntryKind_LOCAL_PROFILE_ENTRY_KIND_ASSET,
				Capability: "image",
				AssetId:    "z_image_vae_b",
				AssetKind:  runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE,
				Engine:     "media",
				EngineSlot: "vae_path",
			},
		},
	})
	if err == nil {
		t.Fatalf("expected duplicate engineSlot binding to fail-close")
	}
	assertGRPCReasonCode(t, err, "duplicate engineSlot binding", runtimev1.ReasonCode_AI_LOCAL_PROFILE_SLOT_CONFLICT)
}

func TestResolveManagedMediaImageProfileRejectsIncompatibleVAEFamily(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	modelsRoot := filepath.Join(t.TempDir(), "models")
	svc.SetManagedLlamaRegistrationConfig(modelsRoot, "", false)

	engineConfig, err := structpb.NewStruct(map[string]any{"backend": "stablediffusion-ggml"})
	if err != nil {
		t.Fatalf("build engine config: %v", err)
	}
	modelResp := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "z_image_turbo",
		capabilities: []string{"image"},
		engine:       "media",
		entry:        "z_image_turbo-Q4_K_M.gguf",
		engineConfig: engineConfig,
	})
	svc.mu.Lock()
	svc.assets[modelResp.GetLocalAssetId()].Status = runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE
	svc.assets[modelResp.GetLocalAssetId()].Family = "z-image-turbo"
	svc.mu.Unlock()
	writeManagedAssetEntryFixture(t, modelsRoot, modelResp, "main-model")

	vaeRecord := &runtimev1.LocalAssetRecord{
		LocalAssetId:  "artifact_" + ulid.Make().String(),
		AssetId:       "local-import/ae",
		Kind:          runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE,
		Engine:        "media",
		Entry:         "ae.safetensors",
		Family:        "flux2-vae",
		ArtifactRoles: []string{"vae"},
		Status:        runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
		Source:        &runtimev1.LocalAssetSource{},
	}
	svc.assets[vaeRecord.GetLocalAssetId()] = vaeRecord
	writeManagedAssetEntryFixture(t, modelsRoot, vaeRecord, "vae")

	llmRecord := &runtimev1.LocalAssetRecord{
		LocalAssetId: "artifact_" + ulid.Make().String(),
		AssetId:      "qwen3_4b_companion",
		Kind:         runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT,
		Engine:       "llama",
		Entry:        "Qwen3-4B-Q4_K_M.gguf",
		Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
		Source:       &runtimev1.LocalAssetSource{},
	}
	svc.assets[llmRecord.GetLocalAssetId()] = llmRecord
	writeManagedAssetEntryFixture(t, modelsRoot, llmRecord, "llm")

	_, _, _, err = svc.ResolveManagedMediaImageProfile(context.Background(), "media/z_image_turbo", map[string]any{
		"profile_entries": []*runtimev1.LocalProfileEntryDescriptor{
			{
				EntryId:   "main-image",
				Kind:      runtimev1.LocalProfileEntryKind_LOCAL_PROFILE_ENTRY_KIND_ASSET,
				AssetId:   "z_image_turbo",
				AssetKind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE,
				Engine:    "media",
			},
			{
				EntryId:    "vae-slot",
				Kind:       runtimev1.LocalProfileEntryKind_LOCAL_PROFILE_ENTRY_KIND_ASSET,
				Capability: "image.generate",
				AssetId:    "local-import/ae",
				AssetKind:  runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE,
				Engine:     "media",
				EngineSlot: "vae_path",
			},
			{
				EntryId:    "llm-slot",
				Kind:       runtimev1.LocalProfileEntryKind_LOCAL_PROFILE_ENTRY_KIND_ASSET,
				Capability: "image.generate",
				AssetId:    "qwen3_4b_companion",
				AssetKind:  runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT,
				Engine:     "llama",
				EngineSlot: "llm_path",
			},
		},
	})
	if err == nil {
		t.Fatal("expected incompatible z-image vae family to fail closed")
	}
	assertGRPCReasonCode(t, err, "incompatible vae family", runtimev1.ReasonCode_AI_LOCAL_COMPONENT_INCOMPATIBLE)
	if !strings.Contains(err.Error(), "flux2-vae") || !strings.Contains(err.Error(), "z-image-turbo") {
		t.Fatalf("expected incompatible family detail, got %v", err)
	}
}

func TestResolveManagedAssetPathRejectsSymlinkedBaseDirOutsideModelsRoot(t *testing.T) {
	svc := newTestService(t)
	modelsRoot := filepath.Join(t.TempDir(), "models")
	svc.SetManagedLlamaRegistrationConfig(modelsRoot, "", false)

	outsideDir := filepath.Join(t.TempDir(), "outside-artifact")
	if err := os.MkdirAll(outsideDir, 0o755); err != nil {
		t.Fatalf("mkdir outside artifact dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(outsideDir, "weights.safetensors"), []byte("artifact"), 0o600); err != nil {
		t.Fatalf("write outside artifact file: %v", err)
	}

	if err := os.MkdirAll(modelsRoot, 0o755); err != nil {
		t.Fatalf("mkdir models root: %v", err)
	}
	linkedDir := filepath.Join(modelsRoot, "linked-artifact")
	if err := os.Symlink(outsideDir, linkedDir); err != nil {
		if strings.Contains(err.Error(), "A required privilege is not held by the client") {
			t.Skip("symlink privilege unavailable on this Windows host")
		}
		t.Fatalf("create symlinked artifact dir: %v", err)
	}

	artifact := &runtimev1.LocalAssetRecord{
		LocalAssetId: "artifact_" + ulid.Make().String(),
		AssetId:      "linked/artifact",
		Kind:         runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE,
		Engine:       "media",
		Entry:        "weights.safetensors",
		Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
		Source: &runtimev1.LocalAssetSource{
			Repo: "file://" + filepath.Join(linkedDir, "asset.manifest.json"),
		},
	}
	svc.assets[artifact.GetLocalAssetId()] = artifact

	_, err := svc.ResolveManagedAssetPath(context.Background(), artifact.GetLocalAssetId())
	if err == nil {
		t.Fatal("expected symlinked artifact base dir outside root to be rejected")
	}
	assertGRPCReasonCode(t, err, "ResolveManagedAssetPath(symlink outside root)", runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
