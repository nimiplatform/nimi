package localservice

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
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
	repo := strings.TrimSpace(asset.GetSource().GetRepo())
	if strings.HasPrefix(repo, "local-import/") {
		target = filepath.Join(modelsRoot, "resolved", filepath.FromSlash(strings.Trim(strings.TrimPrefix(repo, "local-import/"), "/")), cleanEntry)
	} else if isRunnableKind(asset.GetKind()) && strings.Trim(strings.TrimSpace(asset.GetLogicalModelId()), "/") != "" {
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
		Family:       "flux2-vae",
		ArtifactRoles: []string{
			"vae",
		},
		Status: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
		Source: &runtimev1.LocalAssetSource{},
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

	uncondRecord := &runtimev1.LocalAssetRecord{
		LocalAssetId: "artifact_" + ulid.Make().String(),
		AssetId:      "ideogram4_uncond",
		Kind:         runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE,
		Engine:       "media",
		Entry:        "ideogram4_uncond-Q4_0.gguf",
		Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
		Source:       &runtimev1.LocalAssetSource{},
	}
	svc.assets[uncondRecord.GetLocalAssetId()] = uncondRecord
	writeManagedAssetEntryFixture(t, modelsRoot, uncondRecord, "uncond")

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
				Capability: "image.generate",
				AssetId:    "z_image_ae",
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
			{
				EntryId:    "uncond-slot",
				Kind:       runtimev1.LocalProfileEntryKind_LOCAL_PROFILE_ENTRY_KIND_ASSET,
				Capability: "image.generate",
				AssetId:    "ideogram4_uncond",
				AssetKind:  runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE,
				Engine:     "media",
				EngineSlot: "uncond_diffusion_model",
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
	if !containsString(options, "uncond_diffusion_model:resolved/local_ideogram4_uncond/ideogram4_uncond-Q4_0.gguf") {
		t.Fatalf("expected uncond_diffusion_model option, got=%v", options)
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
	cached, ok := svc.cachedManagedMediaImageProfile(modelResp.GetLocalAssetId())
	if !ok || !cached.MaterializationResolved {
		t.Fatalf("expected image profile materialization bindings to be cached, got ok=%v state=%+v", ok, cached)
	}
	if len(cached.MaterializationBindings) != 4 {
		t.Fatalf("expected main + three companion materialization bindings, got %+v", cached.MaterializationBindings)
	}
	companionIDs := map[string]string{}
	for _, binding := range cached.MaterializationBindings {
		if binding.CompanionAssetID != "" {
			companionIDs[binding.EngineSlot] = binding.CompanionAssetID + "|" + binding.ParentAssetID
		}
	}
	if got := companionIDs["vae_path"]; got != "z_image_ae|z_image_turbo" {
		t.Fatalf("unexpected vae materialization binding: %+v", cached.MaterializationBindings)
	}
	if got := companionIDs["llm_path"]; got != "qwen3_4b_companion|z_image_turbo" {
		t.Fatalf("unexpected llm materialization binding: %+v", cached.MaterializationBindings)
	}
	if got := companionIDs["uncond_diffusion_model"]; got != "ideogram4_uncond|z_image_turbo" {
		t.Fatalf("unexpected uncond materialization binding: %+v", cached.MaterializationBindings)
	}
	plan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:        "local-image-native",
		ConsumerScope: "stable-diffusion.cpp.metal",
		AssetID:       modelResp.GetAssetId(),
		LocalAssetID:  modelResp.GetLocalAssetId(),
	})
	companionDeps := []localEnvironmentPlanDependency{}
	for _, dep := range plan.Dependencies {
		if dep.DependencyFamily == localEnvironmentFamilyModelCompanion {
			companionDeps = append(companionDeps, dep)
		}
	}
	if len(companionDeps) != 3 {
		t.Fatalf("expected cached profile to expand two companion dependencies, got %+v", companionDeps)
	}
	depIDs := map[string]bool{}
	for _, dep := range companionDeps {
		depIDs[dep.DependencyID] = true
	}
	if !depIDs["asset_id=z_image_ae|parent_asset_id=z_image_turbo"] {
		t.Fatalf("missing vae companion dependency: %+v", companionDeps)
	}
	if !depIDs["asset_id=qwen3_4b_companion|parent_asset_id=z_image_turbo"] {
		t.Fatalf("missing llm companion dependency: %+v", companionDeps)
	}
	if !depIDs["asset_id=ideogram4_uncond|parent_asset_id=z_image_turbo"] {
		t.Fatalf("missing uncond companion dependency: %+v", companionDeps)
	}
}

func TestResolveManagedMediaImageProfileForBindingRejectsWorkflowOverrides(t *testing.T) {
	svc := newTestService(t)
	_, _, _, err := svc.resolveManagedMediaImageProfileForModel(
		&runtimev1.LocalAssetRecord{LocalAssetId: "image-local-asset"},
		"committed-binding",
		map[string]any{
			"profile_entries": []any{},
		},
	)
	if err == nil {
		t.Fatal("committed image binding must reject caller-provided workflow definitions")
	}
	assertGRPCReasonCode(t, err, "committed workflow override", runtimev1.ReasonCode_AI_INPUT_INVALID)
}

func TestResolveManagedMediaImageProfileAcceptsLocalAssetIDRequestIdentity(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	modelsRoot := filepath.Join(t.TempDir(), "models")
	svc.SetManagedLlamaRegistrationConfig(modelsRoot, "", false)

	modelResp := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "local-import/z-image-turbo-Q4_K_M",
		capabilities: []string{"image"},
		engine:       "media",
		entry:        "z-image-turbo-Q4_K_M.gguf",
	})
	svc.mu.Lock()
	svc.assets[modelResp.GetLocalAssetId()].Status = runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE
	svc.mu.Unlock()
	writeManagedAssetEntryFixture(t, modelsRoot, modelResp, "main-model")

	if _, err := svc.ResolveCanonicalImageSelection(context.Background(), modelResp.GetLocalAssetId()); err != nil {
		t.Fatalf("canonical image selection should accept local asset id: %v", err)
	}

	_, profile, _, err := svc.ResolveManagedMediaImageProfile(context.Background(), modelResp.GetLocalAssetId(), map[string]any{
		"profile_entries": []*runtimev1.LocalProfileEntryDescriptor{
			{
				EntryId:   "main-image",
				Kind:      runtimev1.LocalProfileEntryKind_LOCAL_PROFILE_ENTRY_KIND_ASSET,
				AssetId:   modelResp.GetLocalAssetId(),
				AssetKind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE,
				Engine:    "media",
			},
		},
	})
	if err != nil {
		t.Fatalf("resolve local media image profile by local asset id: %v", err)
	}
	if got := valueAsString(valueAsObject(profile["parameters"])["model"]); got != "resolved/local-import/z-image-turbo-Q4_K_M/z-image-turbo-Q4_K_M.gguf" {
		t.Fatalf("unexpected model parameter: %q", got)
	}
}

func TestResolveManagedMediaImageProfileDoesNotRequireEngineConfigDefaults(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "windows", "amd64")
	setNvidiaGPUProbeForTest(t, true)
	modelsRoot := filepath.Join(t.TempDir(), "models")
	svc.SetManagedLlamaRegistrationConfig(modelsRoot, "", false)

	modelResp := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "z_image_turbo",
		capabilities: []string{"image"},
		engine:       "media",
		entry:        "z_image_turbo-Q4_K_M.gguf",
	})
	svc.mu.Lock()
	svc.assets[modelResp.GetLocalAssetId()].Status = runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE
	svc.mu.Unlock()
	writeManagedAssetEntryFixture(t, modelsRoot, modelResp, "main-model")

	alias, profile, _, err := svc.ResolveManagedMediaImageProfile(context.Background(), "media/z_image_turbo", map[string]any{
		"profile_entries": []*runtimev1.LocalProfileEntryDescriptor{
			{
				EntryId:   "main-image",
				Kind:      runtimev1.LocalProfileEntryKind_LOCAL_PROFILE_ENTRY_KIND_ASSET,
				AssetId:   "z_image_turbo",
				AssetKind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE,
				Engine:    "llama",
			},
		},
		"profile_overrides": map[string]any{
			"step": 25,
		},
	})
	if err != nil {
		t.Fatalf("resolve local media image profile without engine_config defaults: %v", err)
	}
	if alias == "" {
		t.Fatalf("expected alias for profile without engine_config defaults")
	}
	if got := valueAsString(valueAsObject(profile["parameters"])["model"]); got != "resolved/z_image_turbo/z_image_turbo-Q4_K_M.gguf" {
		t.Fatalf("unexpected model parameter: %q", got)
	}
	options := valueAsStringSlice(profile["options"])
	if !containsString(options, "diffusion_model") {
		t.Fatalf("expected runtime-owned image profile to inject diffusion_model option, got=%v", options)
	}
	switch got := profile["cfg_scale"].(type) {
	case int:
		if got != 1 {
			t.Fatalf("expected default cfg_scale=1 for canonical image profile, got=%#v", profile["cfg_scale"])
		}
	case float64:
		if got != 1 {
			t.Fatalf("expected default cfg_scale=1 for canonical image profile, got=%#v", profile["cfg_scale"])
		}
	default:
		t.Fatalf("expected default cfg_scale=1 for canonical image profile, got=%#v", profile["cfg_scale"])
	}
	switch got := profile["step"].(type) {
	case int:
		if got != 25 {
			t.Fatalf("expected profile overrides to carry through without engine_config defaults, got=%#v", profile["step"])
		}
	case float64:
		if got != 25 {
			t.Fatalf("expected profile overrides to carry through without engine_config defaults, got=%#v", profile["step"])
		}
	default:
		t.Fatalf("expected profile overrides to carry through without engine_config defaults, got=%#v", profile["step"])
	}
}

func TestResolveManagedMediaImageProfileEnablesDiffusionFAOnAppleSilicon(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	modelsRoot := filepath.Join(t.TempDir(), "models")
	svc.SetManagedLlamaRegistrationConfig(modelsRoot, "", false)
	engineConfig, err := structpb.NewStruct(map[string]any{
		"backend": "stablediffusion-ggml",
		"options": []any{
			"diffusion_model",
			"offload_params_to_cpu:true",
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

	_, profile, _, err := svc.ResolveManagedMediaImageProfile(context.Background(), "media/z_image_turbo", map[string]any{
		"profile_entries": []*runtimev1.LocalProfileEntryDescriptor{
			{
				EntryId:   "main-image",
				Kind:      runtimev1.LocalProfileEntryKind_LOCAL_PROFILE_ENTRY_KIND_ASSET,
				AssetId:   "z_image_turbo",
				AssetKind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE,
				Engine:    "media",
			},
		},
	})
	if err != nil {
		t.Fatalf("resolve local media image profile on apple silicon: %v", err)
	}
	options := valueAsStringSlice(profile["options"])
	if !containsString(options, "offload_params_to_cpu:true") {
		t.Fatalf("expected explicit cpu offload option to remain intact, got=%v", options)
	}
	if !containsString(options, "diffusion_fa:true") {
		t.Fatalf("expected apple silicon profile to add diffusion_fa:true, got=%v", options)
	}
}

func TestResolveManagedMediaImageProfilePreservesExplicitCFGScale(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	modelsRoot := filepath.Join(t.TempDir(), "models")
	svc.SetManagedLlamaRegistrationConfig(modelsRoot, "", false)

	engineConfig, err := structpb.NewStruct(map[string]any{
		"cfg_scale": 3,
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

	_, profile, _, err := svc.ResolveManagedMediaImageProfile(context.Background(), "media/z_image_turbo", map[string]any{
		"profile_entries": []*runtimev1.LocalProfileEntryDescriptor{
			{
				EntryId:   "main-image",
				Kind:      runtimev1.LocalProfileEntryKind_LOCAL_PROFILE_ENTRY_KIND_ASSET,
				AssetId:   "z_image_turbo",
				AssetKind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE,
				Engine:    "media",
			},
		},
	})
	if err != nil {
		t.Fatalf("resolve local media image profile with explicit cfg_scale: %v", err)
	}
	switch got := profile["cfg_scale"].(type) {
	case int:
		if got != 3 {
			t.Fatalf("expected explicit cfg_scale to be preserved, got=%#v", profile["cfg_scale"])
		}
	case float64:
		if got != 3 {
			t.Fatalf("expected explicit cfg_scale to be preserved, got=%#v", profile["cfg_scale"])
		}
	default:
		t.Fatalf("expected explicit cfg_scale to be preserved, got=%#v", profile["cfg_scale"])
	}
}

func TestResolveManagedMediaImageProfileRetainsDiffusionModelWhenOverridesReplaceOptions(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	modelsRoot := filepath.Join(t.TempDir(), "models")
	svc.SetManagedLlamaRegistrationConfig(modelsRoot, "", false)

	modelResp := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "z_image_turbo",
		capabilities: []string{"image"},
		engine:       "media",
		entry:        "z_image_turbo-Q4_K_M.gguf",
	})
	svc.mu.Lock()
	svc.assets[modelResp.GetLocalAssetId()].Status = runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE
	svc.mu.Unlock()
	writeManagedAssetEntryFixture(t, modelsRoot, modelResp, "main-model")

	_, profile, _, err := svc.ResolveManagedMediaImageProfile(context.Background(), "media/z_image_turbo", map[string]any{
		"profile_entries": []*runtimev1.LocalProfileEntryDescriptor{
			{
				EntryId:   "main-image",
				Kind:      runtimev1.LocalProfileEntryKind_LOCAL_PROFILE_ENTRY_KIND_ASSET,
				AssetId:   "z_image_turbo",
				AssetKind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE,
				Engine:    "media",
			},
		},
		"profile_overrides": map[string]any{
			"options": []any{"offload_params_to_cpu:false"},
		},
	})
	if err != nil {
		t.Fatalf("resolve image profile with overriding options: %v", err)
	}
	options := valueAsStringSlice(profile["options"])
	if !containsString(options, "diffusion_model") {
		t.Fatalf("expected runtime-owned image profile to retain diffusion_model option, got=%v", options)
	}
	if !containsString(options, "offload_params_to_cpu:false") {
		t.Fatalf("expected override option to survive normalization, got=%v", options)
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

func TestResolveManagedMediaImageProfileAllowsSelectedUnhealthyMainOverride(t *testing.T) {
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
	svc.assets[modelResp.GetLocalAssetId()].Status = runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY
	svc.mu.Unlock()
	writeManagedAssetEntryFixture(t, modelsRoot, modelResp, "main-model")

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
				"entry_id":       "main-image",
				"local_asset_id": modelResp.GetLocalAssetId(),
			},
		},
	})
	if err != nil {
		t.Fatalf("resolve local media image profile with unhealthy selected main override: %v", err)
	}
	parameters := valueAsObject(profile["parameters"])
	if got := strings.TrimSpace(valueAsString(parameters["model"])); got != "resolved/z_image_turbo/z_image_turbo-Q4_K_M.gguf" {
		t.Fatalf("unexpected overridden main model path: %q", got)
	}
}
