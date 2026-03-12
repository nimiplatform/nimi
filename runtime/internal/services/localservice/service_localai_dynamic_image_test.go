package localservice

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/oklog/ulid/v2"
	"google.golang.org/genproto/googleapis/rpc/errdetails"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestResolveLocalAIImageProfileInjectsDynamicComponents(t *testing.T) {
	svc := newTestService(t)
	modelsRoot := filepath.Join(t.TempDir(), "models")
	svc.SetLocalAIRegistrationConfig(modelsRoot, "", false)

	mainModelPath := filepath.Join(modelsRoot, slugifyLocalModelID("z_image_turbo"), "z_image_turbo-Q4_K_M.gguf")
	if err := os.MkdirAll(filepath.Dir(mainModelPath), 0o755); err != nil {
		t.Fatalf("mkdir main model dir: %v", err)
	}
	if err := os.WriteFile(mainModelPath, []byte("main-model"), 0o600); err != nil {
		t.Fatalf("write main model file: %v", err)
	}
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
	modelResp, err := svc.InstallLocalModel(context.Background(), &runtimev1.InstallLocalModelRequest{
		ModelId:      "z_image_turbo",
		Capabilities: []string{"image"},
		Engine:       "localai",
		Entry:        "z_image_turbo-Q4_K_M.gguf",
		EngineConfig: engineConfig,
	})
	if err != nil {
		t.Fatalf("install local image model: %v", err)
	}
	svc.mu.Lock()
	svc.models[modelResp.GetModel().GetLocalModelId()].Status = runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE
	svc.mu.Unlock()

	vaePath := filepath.Join(modelsRoot, slugifyLocalModelID("z_image_ae"), "vae", "diffusion_pytorch_model.safetensors")
	if err := os.MkdirAll(filepath.Dir(vaePath), 0o755); err != nil {
		t.Fatalf("mkdir vae dir: %v", err)
	}
	if err := os.WriteFile(vaePath, []byte("vae"), 0o600); err != nil {
		t.Fatalf("write vae file: %v", err)
	}
	vaeRecord, err := svc.installLocalArtifactRecord(&runtimev1.LocalArtifactRecord{
		LocalArtifactId: "artifact_" + ulid.Make().String(),
		ArtifactId:      "z_image_ae",
		Kind:            runtimev1.LocalArtifactKind_LOCAL_ARTIFACT_KIND_VAE,
		Engine:          "localai",
		Entry:           "vae/diffusion_pytorch_model.safetensors",
		Status:          runtimev1.LocalArtifactStatus_LOCAL_ARTIFACT_STATUS_INSTALLED,
		Source:          &runtimev1.LocalArtifactSource{},
	})
	if err != nil {
		t.Fatalf("install vae artifact: %v", err)
	}

	llmPath := filepath.Join(modelsRoot, slugifyLocalModelID("qwen3_4b_companion"), "Qwen3-4B-Q4_K_M.gguf")
	if err := os.MkdirAll(filepath.Dir(llmPath), 0o755); err != nil {
		t.Fatalf("mkdir llm dir: %v", err)
	}
	if err := os.WriteFile(llmPath, []byte("llm"), 0o600); err != nil {
		t.Fatalf("write llm file: %v", err)
	}
	llmRecord, err := svc.installLocalArtifactRecord(&runtimev1.LocalArtifactRecord{
		LocalArtifactId: "artifact_" + ulid.Make().String(),
		ArtifactId:      "qwen3_4b_companion",
		Kind:            runtimev1.LocalArtifactKind_LOCAL_ARTIFACT_KIND_LLM,
		Engine:          "localai",
		Entry:           "Qwen3-4B-Q4_K_M.gguf",
		Status:          runtimev1.LocalArtifactStatus_LOCAL_ARTIFACT_STATUS_INSTALLED,
		Source:          &runtimev1.LocalArtifactSource{},
	})
	if err != nil {
		t.Fatalf("install llm artifact: %v", err)
	}

	alias, profile, forwarded, err := svc.ResolveLocalAIImageProfile(context.Background(), "localai/z_image_turbo", map[string]any{
		"components": []any{
			map[string]any{"slot": "vae_path", "localArtifactId": vaeRecord.GetLocalArtifactId()},
			map[string]any{"slot": "llm_path", "localArtifactId": llmRecord.GetLocalArtifactId()},
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
		t.Fatalf("resolve localai image profile: %v", err)
	}
	if alias == "" {
		t.Fatalf("expected non-empty alias")
	}
	if profile["name"] != alias {
		t.Fatalf("profile name mismatch: got=%v want=%s", profile["name"], alias)
	}
	if got := valueAsString(valueAsObject(profile["parameters"])["model"]); got != "z-image-turbo/z_image_turbo-Q4_K_M.gguf" {
		t.Fatalf("unexpected model parameter: %q", got)
	}
	options := valueAsStringSlice(profile["options"])
	if !containsString(options, "llm_path:qwen3-4b-companion/Qwen3-4B-Q4_K_M.gguf") {
		t.Fatalf("expected llm_path option, got=%v", options)
	}
	if !containsString(options, "vae_path:z-image-ae/vae/diffusion_pytorch_model.safetensors") {
		t.Fatalf("expected vae_path option, got=%v", options)
	}
	if containsString(options, "vae_path:old.safetensors") {
		t.Fatalf("expected previous vae_path override to be replaced, got=%v", options)
	}
	if valueAsString(forwarded["user_note"]) != "keep-me" {
		t.Fatalf("expected workflow-only extensions to be stripped but user fields to remain: %#v", forwarded)
	}
	if _, exists := forwarded["components"]; exists {
		t.Fatalf("components should not be forwarded: %#v", forwarded)
	}
	if _, exists := forwarded["profile_overrides"]; exists {
		t.Fatalf("profile_overrides should not be forwarded: %#v", forwarded)
	}
}

func TestResolveLocalAIImageProfileRejectsPathOverrides(t *testing.T) {
	svc := newTestService(t)
	modelsRoot := filepath.Join(t.TempDir(), "models")
	svc.SetLocalAIRegistrationConfig(modelsRoot, "", false)

	mainModelPath := filepath.Join(modelsRoot, slugifyLocalModelID("z_image_turbo"), "z_image_turbo-Q4_K_M.gguf")
	if err := os.MkdirAll(filepath.Dir(mainModelPath), 0o755); err != nil {
		t.Fatalf("mkdir main model dir: %v", err)
	}
	if err := os.WriteFile(mainModelPath, []byte("main-model"), 0o600); err != nil {
		t.Fatalf("write main model file: %v", err)
	}
	engineConfig, err := structpb.NewStruct(map[string]any{
		"backend": "stablediffusion-ggml",
	})
	if err != nil {
		t.Fatalf("build engine config: %v", err)
	}
	modelResp, err := svc.InstallLocalModel(context.Background(), &runtimev1.InstallLocalModelRequest{
		ModelId:      "z_image_turbo",
		Capabilities: []string{"image"},
		Engine:       "localai",
		Entry:        "z_image_turbo-Q4_K_M.gguf",
		EngineConfig: engineConfig,
	})
	if err != nil {
		t.Fatalf("install local image model: %v", err)
	}
	svc.mu.Lock()
	svc.models[modelResp.GetModel().GetLocalModelId()].Status = runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE
	svc.mu.Unlock()

	_, _, _, err = svc.ResolveLocalAIImageProfile(context.Background(), "localai/z_image_turbo", map[string]any{
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

func TestResolveLocalAIImageProfileRejectsMissingComponents(t *testing.T) {
	svc := newTestService(t)
	modelsRoot := filepath.Join(t.TempDir(), "models")
	svc.SetLocalAIRegistrationConfig(modelsRoot, "", false)

	mainModelPath := filepath.Join(modelsRoot, slugifyLocalModelID("z_image_turbo"), "z_image_turbo-Q4_K_M.gguf")
	if err := os.MkdirAll(filepath.Dir(mainModelPath), 0o755); err != nil {
		t.Fatalf("mkdir main model dir: %v", err)
	}
	if err := os.WriteFile(mainModelPath, []byte("main-model"), 0o600); err != nil {
		t.Fatalf("write main model file: %v", err)
	}
	engineConfig, err := structpb.NewStruct(map[string]any{
		"backend": "stablediffusion-ggml",
	})
	if err != nil {
		t.Fatalf("build engine config: %v", err)
	}
	modelResp, err := svc.InstallLocalModel(context.Background(), &runtimev1.InstallLocalModelRequest{
		ModelId:      "z_image_turbo",
		Capabilities: []string{"image"},
		Engine:       "localai",
		Entry:        "z_image_turbo-Q4_K_M.gguf",
		EngineConfig: engineConfig,
	})
	if err != nil {
		t.Fatalf("install local image model: %v", err)
	}
	svc.mu.Lock()
	svc.models[modelResp.GetModel().GetLocalModelId()].Status = runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE
	svc.mu.Unlock()

	_, _, _, err = svc.ResolveLocalAIImageProfile(context.Background(), "localai/z_image_turbo", map[string]any{
		"profile_overrides": map[string]any{
			"step": 25,
		},
	})
	if err == nil {
		t.Fatalf("expected missing companion selections to fail")
	}
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected invalid argument, got %v", status.Code(err))
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok {
		t.Fatalf("expected reason code on missing components error")
	}
	if reason != runtimev1.ReasonCode_AI_INPUT_INVALID {
		t.Fatalf("unexpected reason code: %s", reason)
	}
	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("expected grpc status error")
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(st.Message()), &payload); err != nil {
		t.Fatalf("decode status message payload: %v", err)
	}
	if got := payload["message"]; got != "LocalAI dynamic image workflow requires explicit companion artifact selections via components[]" {
		t.Fatalf("unexpected message payload: %#v", payload)
	}
	if got := payload["actionHint"]; got != "select_local_image_companions" {
		t.Fatalf("unexpected action hint payload: %#v", payload)
	}
	details := st.Details()
	if len(details) != 1 {
		t.Fatalf("expected 1 detail, got %d", len(details))
	}
	info, ok := details[0].(*errdetails.ErrorInfo)
	if !ok {
		t.Fatalf("expected ErrorInfo detail, got %T", details[0])
	}
	if info.GetMetadata()["action_hint"] != "select_local_image_companions" {
		t.Fatalf("unexpected action hint: %q", info.GetMetadata()["action_hint"])
	}
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
