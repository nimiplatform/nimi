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

func writeManagedAssetEntryFixture(t *testing.T, modelsRoot string, asset *runtimev1.LocalAssetRecord, content string) string {
	t.Helper()
	if asset == nil {
		t.Fatal("asset fixture requires record")
	}
	cleanEntry := filepath.Clean(strings.TrimSpace(asset.GetEntry()))
	if cleanEntry == "." || cleanEntry == "" {
		t.Fatal("asset fixture requires entry path")
	}
	var target string
	if isRunnableKind(asset.GetKind()) && strings.Trim(strings.TrimSpace(asset.GetLogicalModelId()), "/") != "" {
		target = filepath.Join(modelsRoot, "resolved", filepath.FromSlash(strings.Trim(strings.TrimSpace(asset.GetLogicalModelId()), "/")), cleanEntry)
	} else {
		target = filepath.Join(modelsRoot, "resolved", slugifyLocalAssetID(asset.GetAssetId()), cleanEntry)
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		t.Fatalf("mkdir asset fixture dir: %v", err)
	}
	if err := os.WriteFile(target, []byte(content), 0o600); err != nil {
		t.Fatalf("write asset fixture: %v", err)
	}
	return target
}

func TestResolveManagedMediaImageProfileInjectsDynamicSlots(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	modelsRoot := filepath.Join(t.TempDir(), "models")
	svc.SetManagedLlamaRegistrationConfig(modelsRoot, "", false)
	engineConfig, err := structpb.NewStruct(map[string]any{
		"backend": "stablediffusion-ggml",
		"options": []any{
			"diffusion_model",
			"offload_params_to_cpu:true",
			"vae_path:old.safetensors",
		},
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

	vaeRecord := &runtimev1.LocalAssetRecord{
		LocalAssetId: "artifact_" + ulid.Make().String(),
		AssetId:      "z_image_ae",
		Kind:         runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE,
		Engine:       "media",
		Entry:        "vae/diffusion_pytorch_model.safetensors",
		Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
		Source:       &runtimev1.LocalAssetSource{},
	}
	svc.assets[vaeRecord.GetLocalAssetId()] = vaeRecord
	writeManagedAssetEntryFixture(t, modelsRoot, vaeRecord, "vae")

	llmRecord := &runtimev1.LocalAssetRecord{
		LocalAssetId:   "artifact_" + ulid.Make().String(),
		AssetId:        "qwen3_4b_companion",
		Kind:           runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT,
		Engine:         "llama",
		Entry:          "Qwen3-4B-Q4_K_M.gguf",
		LogicalModelId: "nimi/qwen3_4b_companion",
		Status:         runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
		Source:         &runtimev1.LocalAssetSource{},
	}
	svc.assets[llmRecord.GetLocalAssetId()] = llmRecord
	writeManagedAssetEntryFixture(t, modelsRoot, llmRecord, "llm")

	alias, profile, forwarded, err := svc.ResolveManagedMediaImageProfile(context.Background(), "media/z_image_turbo", map[string]any{
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
				Capability: "image",
				AssetId:    "z_image_ae",
				AssetKind:  runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE,
				Engine:     "media",
				EngineSlot: "vae_path",
			},
			{
				EntryId:    "llm-slot",
				Kind:       runtimev1.LocalProfileEntryKind_LOCAL_PROFILE_ENTRY_KIND_ASSET,
				Capability: "image",
				AssetId:    "qwen3_4b_companion",
				AssetKind:  runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT,
				Engine:     "llama",
				EngineSlot: "llm_path",
			},
		},
		"profile_overrides": map[string]any{
			"step": 30,
			"options": []any{
				"diffusion_model",
				"offload_params_to_cpu:false",
			},
		},
		"user_note": "keep-me",
	})
	if err != nil {
		t.Fatalf("resolve local media image profile: %v", err)
	}
	if alias == "" {
		t.Fatalf("expected non-empty alias")
	}
	if profile["name"] != alias {
		t.Fatalf("profile name mismatch: got=%v want=%s", profile["name"], alias)
	}
	if got := valueAsString(valueAsObject(profile["parameters"])["model"]); got != "resolved/z_image_turbo/z_image_turbo-Q4_K_M.gguf" {
		t.Fatalf("unexpected model parameter: %q", got)
	}
	options := valueAsStringSlice(profile["options"])
	if !containsString(options, "llm_path:resolved/nimi/qwen3_4b_companion/Qwen3-4B-Q4_K_M.gguf") {
		t.Fatalf("expected llm_path option, got=%v", options)
	}
	if !containsString(options, "vae_path:resolved/local_z_image_ae/vae/diffusion_pytorch_model.safetensors") {
		t.Fatalf("expected vae_path option, got=%v", options)
	}
	if containsString(options, "vae_path:old.safetensors") {
		t.Fatalf("expected previous vae_path override to be replaced, got=%v", options)
	}
	if valueAsString(forwarded["user_note"]) != "keep-me" {
		t.Fatalf("expected workflow-only extensions to be stripped but user fields to remain: %#v", forwarded)
	}
	if _, exists := forwarded["profile_entries"]; exists {
		t.Fatalf("profile_entries should not be forwarded: %#v", forwarded)
	}
	if _, exists := forwarded["profile_overrides"]; exists {
		t.Fatalf("profile_overrides should not be forwarded: %#v", forwarded)
	}
	if _, exists := forwarded["entry_overrides"]; exists {
		t.Fatalf("entry_overrides should not be forwarded: %#v", forwarded)
	}
}

func TestResolveManagedMediaImageProfileAppliesEntryOverrides(t *testing.T) {
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

	defaultLLM := &runtimev1.LocalAssetRecord{
		LocalAssetId:   "asset_" + ulid.Make().String(),
		AssetId:        "qwen3_4b_companion",
		Kind:           runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT,
		Engine:         "llama",
		Entry:          "Qwen3-4B-Q4_K_M.gguf",
		LogicalModelId: "nimi/qwen3_4b_companion",
		Status:         runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
		Source:         &runtimev1.LocalAssetSource{},
	}
	svc.assets[defaultLLM.GetLocalAssetId()] = defaultLLM
	writeManagedAssetEntryFixture(t, modelsRoot, defaultLLM, "default-llm")

	overrideLLM := &runtimev1.LocalAssetRecord{
		LocalAssetId:   "asset_" + ulid.Make().String(),
		AssetId:        "qwen3_4b_override",
		Kind:           runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT,
		Engine:         "llama",
		Entry:          "Qwen3-4B-Override.gguf",
		LogicalModelId: "nimi/qwen3_4b_override",
		Status:         runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
		Source:         &runtimev1.LocalAssetSource{},
	}
	svc.assets[overrideLLM.GetLocalAssetId()] = overrideLLM
	writeManagedAssetEntryFixture(t, modelsRoot, overrideLLM, "override-llm")

	_, profile, _, err := svc.ResolveManagedMediaImageProfile(context.Background(), "media/z_image_turbo", map[string]any{
		"profile_entries": []*runtimev1.LocalProfileEntryDescriptor{
			{
				EntryId:   "main-image",
				Kind:      runtimev1.LocalProfileEntryKind_LOCAL_PROFILE_ENTRY_KIND_ASSET,
				AssetId:   "z_image_turbo",
				AssetKind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE,
				Engine:    "media",
			},
			{
				EntryId:    "llm-slot",
				Kind:       runtimev1.LocalProfileEntryKind_LOCAL_PROFILE_ENTRY_KIND_ASSET,
				Capability: "image",
				AssetId:    "qwen3_4b_companion",
				AssetKind:  runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT,
				Engine:     "llama",
				EngineSlot: "llm_path",
			},
		},
		"entry_overrides": []any{
			map[string]any{
				"entry_id":       "llm-slot",
				"local_asset_id": overrideLLM.GetLocalAssetId(),
			},
		},
	})
	if err != nil {
		t.Fatalf("resolve local media image profile with entry override: %v", err)
	}
	options := valueAsStringSlice(profile["options"])
	if !containsString(options, "llm_path:resolved/nimi/qwen3_4b_override/Qwen3-4B-Override.gguf") {
		t.Fatalf("expected overridden llm_path option, got=%v", options)
	}
	if containsString(options, "llm_path:resolved/nimi/qwen3_4b_companion/Qwen3-4B-Q4_K_M.gguf") {
		t.Fatalf("expected default llm_path to be replaced, got=%v", options)
	}
}

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

	_, _, _, err = svc.ResolveManagedMediaImageProfile(context.Background(), "media/z_image_turbo", map[string]any{
		"profile_overrides": map[string]any{
			"options": []any{"vae_path:/tmp/outside.safetensors"},
		},
	})
	if err == nil {
		t.Fatalf("expected path override rejection")
	}
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected invalid argument, got %v", status.Code(err))
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
