package localservice

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestFindMmprojCandidates(t *testing.T) {
	tests := []struct {
		name  string
		files []string
		want  int
	}{
		{"no mmproj", []string{"model.gguf", "tokenizer.json"}, 0},
		{"single mmproj", []string{"model.gguf", "mmproj-vision.gguf"}, 1},
		{"multiple mmproj", []string{"mmproj-a.gguf", "mmproj-b.gguf"}, 2},
		{"non-gguf mmproj ignored", []string{"mmproj.bin"}, 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := findMmprojCandidates(tt.files)
			if len(got) != tt.want {
				t.Fatalf("findMmprojCandidates(%v) = %v (len %d), want len %d", tt.files, got, len(got), tt.want)
			}
		})
	}
}

// setupRegistrarTestModel creates the directory layout expected by
// resolveManagedModelEntryAbsolutePath for a given assetId and entry.
func setupRegistrarTestModel(t *testing.T, modelsPath string, assetID string, entry string) {
	t.Helper()
	slug := slugifyLocalModelID(assetID)
	modelDir := filepath.Join(modelsPath, slug)
	if err := os.MkdirAll(modelDir, 0o755); err != nil {
		t.Fatal(err)
	}
	modelFile := filepath.Join(modelDir, entry)
	// Write enough bytes to pass minManagedGGUFSizeBytes if checked later.
	if err := os.WriteFile(modelFile, make([]byte, 1024), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestInspectManagedLlamaRegistrationMmprojAutoDetect(t *testing.T) {
	modelsPath := t.TempDir()
	setupRegistrarTestModel(t, modelsPath, "test/test-model", "model.gguf")
	if err := os.WriteFile(filepath.Join(modelsPath, slugifyLocalModelID("test/test-model"), "mmproj-vision.gguf"), validTestGGUF(), 0o600); err != nil {
		t.Fatalf("write mmproj companion: %v", err)
	}

	model := &runtimev1.LocalAssetRecord{
		LocalAssetId: "test-id",
		AssetId:      "test/test-model",
		Capabilities: []string{"chat"},
		Engine:       "llama",
		Entry:        "model.gguf",
		Files:        []string{"model.gguf", "mmproj-vision.gguf"},
	}

	reg := inspectManagedLlamaModelRegistration(
		model,
		runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED,
		modelsPath, true, false, nil,
	)
	if reg.Problem != "" {
		t.Fatalf("unexpected problem: %s", reg.Problem)
	}
	if reg.LlamaEngineConfig == nil || reg.LlamaEngineConfig.Mmproj != "test-test-model/mmproj-vision.gguf" {
		t.Fatalf("expected mmproj auto-detected, got %+v", reg.LlamaEngineConfig)
	}
}

func TestInspectManagedLlamaRegistrationMmprojMultipleFailClose(t *testing.T) {
	modelsPath := t.TempDir()
	setupRegistrarTestModel(t, modelsPath, "test/test-model", "model.gguf")

	model := &runtimev1.LocalAssetRecord{
		LocalAssetId: "test-id",
		AssetId:      "test/test-model",
		Capabilities: []string{"chat"},
		Engine:       "llama",
		Entry:        "model.gguf",
		Files:        []string{"model.gguf", "mmproj-a.gguf", "mmproj-b.gguf"},
	}

	reg := inspectManagedLlamaModelRegistration(
		model,
		runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED,
		modelsPath, true, false, nil,
	)
	if reg.Problem == "" {
		t.Fatal("expected fail-close for multiple mmproj candidates")
	}
	if !strings.Contains(reg.Problem, "multiple mmproj") {
		t.Fatalf("unexpected problem: %s", reg.Problem)
	}
}

func TestInspectManagedLlamaRegistrationVisionMissingMmprojFailClose(t *testing.T) {
	modelsPath := t.TempDir()
	setupRegistrarTestModel(t, modelsPath, "test/test-model", "model.gguf")

	model := &runtimev1.LocalAssetRecord{
		LocalAssetId: "test-id",
		AssetId:      "test/test-model",
		Capabilities: []string{"chat", "text.generate.vision"},
		Engine:       "llama",
		Entry:        "model.gguf",
		Files:        []string{"model.gguf"},
	}

	reg := inspectManagedLlamaModelRegistration(
		model,
		runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED,
		modelsPath, true, false, nil,
	)
	if reg.Problem == "" {
		t.Fatal("expected fail-close for vision model without mmproj")
	}
	if !strings.Contains(reg.Problem, "text.generate.vision") {
		t.Fatalf("unexpected problem: %s", reg.Problem)
	}
}

func TestBuildManagedLlamaRegistrationsPrimaryModelFirst(t *testing.T) {
	svc := newTestService(t)
	modelsPath := filepath.Join(t.TempDir(), "models")
	configPath := filepath.Join(t.TempDir(), "runtime", "llama-models.yaml")
	mgr := &registrarTestEngineManager{statusErr: errors.New("engine llama not started")}
	svc.SetManagedLlamaRegistrationConfig(modelsPath, configPath, true)
	svc.SetEngineManager(mgr)

	// Install two models whose names sort alphabetically as alpha < beta.
	writeManagedLlamaManifest(t, modelsPath, "local/alpha-model", "./weights/alpha.gguf", []string{"chat"})
	installManagedLlamaModelForRegistrarTest(t, svc, "local/alpha-model", "./weights/alpha.gguf", []string{"chat"}, "", nil)
	writeManagedLlamaManifest(t, modelsPath, "local/beta-model", "./weights/beta.gguf", []string{"chat"})
	installManagedLlamaModelForRegistrarTest(t, svc, "local/beta-model", "./weights/beta.gguf", []string{"chat"}, "", nil)

	// Without primary set, alpha-model comes first (alphabetical).
	raw, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("read config: %v", err)
	}
	configText := string(raw)
	if strings.Index(configText, "[alpha-model]") == -1 || strings.Index(configText, "[beta-model]") == -1 {
		t.Fatalf("expected both alpha and beta sections, got:\n%s", configText)
	}
	if strings.Index(configText, "[alpha-model]") > strings.Index(configText, "[beta-model]") {
		t.Fatalf("expected alpha-model first without primary, got:\n%s", configText)
	}

	// Set beta-model as primary and rebuild.
	svc.mu.Lock()
	svc.primaryManagedLlamaModelName = "beta-model"
	svc.mu.Unlock()
	mgr.statusErr = nil
	if err := svc.SyncManagedLlamaAssets(context.Background()); err != nil {
		t.Fatalf("sync after setting primary: %v", err)
	}

	raw, err = os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("read config after primary: %v", err)
	}
	configText = string(raw)
	if strings.Index(configText, "[beta-model]") > strings.Index(configText, "[alpha-model]") {
		t.Fatalf("expected beta-model first when set as primary, got:\n%s", configText)
	}
	if !strings.Contains(configText, "[beta-model]\nmodel = "+filepath.Join(modelsPath, "resolved", "nimi", "local-beta-model", "weights", "beta.gguf")+"\nload-on-startup = true") {
		t.Fatalf("expected primary model to load on startup, got:\n%s", configText)
	}
}

func TestBuildManagedLlamaRegistrationsRendersEmbeddingPreset(t *testing.T) {
	svc := newTestService(t)
	modelsPath := filepath.Join(t.TempDir(), "models")
	configPath := filepath.Join(t.TempDir(), "runtime", "llama-models.yaml")
	svc.SetManagedLlamaRegistrationConfig(modelsPath, configPath, true)

	writeManagedLlamaManifest(t, modelsPath, "local/qwen-embed", "./weights/embed.gguf", []string{"text.embed"})
	installManagedLlamaModelForRegistrarTest(t, svc, "local/qwen-embed", "./weights/embed.gguf", []string{"text.embed"}, "", nil)

	raw, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("read config: %v", err)
	}
	configText := string(raw)
	for _, want := range []string{
		"[qwen-embed]",
		"model = " + filepath.Join(modelsPath, "resolved", "nimi", "local-qwen-embed", "weights", "embed.gguf"),
		"embeddings = true",
	} {
		if !strings.Contains(configText, want) {
			t.Fatalf("expected embedding preset to contain %q, got:\n%s", want, configText)
		}
	}
}

func TestRenderManagedLlamaPresetResolvesMmprojAgainstModelsRoot(t *testing.T) {
	modelsPath := filepath.Join(t.TempDir(), "models")
	modelPath := filepath.Join(modelsPath, "resolved", "nimi", "local-gemma-test", "weights", "model.gguf")
	registrations := []managedLlamaRegistration{
		{
			ExposedModelName:  "gemma-test",
			AbsoluteModelPath: modelPath,
			LlamaEngineConfig: &engine.ManagedLlamaEngineConfig{
				Mmproj: "resolved/nimi/local-gemma-test/mmproj-BF16.gguf",
			},
			Capabilities: []string{"chat", "text.generate.vision"},
		},
	}

	rendered, err := renderManagedLlamaPreset(modelsPath, registrations, "")
	if err != nil {
		t.Fatalf("render preset: %v", err)
	}
	configText := string(rendered)
	wantMmproj := filepath.Join(modelsPath, "resolved", "nimi", "local-gemma-test", "mmproj-BF16.gguf")
	if !strings.Contains(configText, "mmproj = "+wantMmproj) {
		t.Fatalf("expected mmproj to resolve against models root, got:\n%s", configText)
	}
	if strings.Contains(configText, filepath.Join(filepath.Dir(modelPath), "resolved", "nimi", "local-gemma-test", "mmproj-BF16.gguf")) {
		t.Fatalf("preset duplicated bundle root in mmproj path:\n%s", configText)
	}
}

func TestInspectManagedLlamaRegistrationEngineConfigThreaded(t *testing.T) {
	modelsPath := t.TempDir()
	setupRegistrarTestModel(t, modelsPath, "test/test-model", "model.gguf")

	llamaFields := map[string]*structpb.Value{
		"ctx_size":     structpb.NewNumberValue(4096),
		"cache_type_k": structpb.NewStringValue("q4_0"),
		"flash_attn":   structpb.NewStringValue("auto"),
	}
	engineConfig := &structpb.Struct{
		Fields: map[string]*structpb.Value{
			"llama": structpb.NewStructValue(&structpb.Struct{Fields: llamaFields}),
		},
	}

	model := &runtimev1.LocalAssetRecord{
		LocalAssetId: "test-id",
		AssetId:      "test/test-model",
		Capabilities: []string{"chat"},
		Engine:       "llama",
		Entry:        "model.gguf",
		Files:        []string{"model.gguf"},
		EngineConfig: engineConfig,
	}

	reg := inspectManagedLlamaModelRegistration(
		model,
		runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED,
		modelsPath, true, false, nil,
	)
	if reg.Problem != "" {
		t.Fatalf("unexpected problem: %s", reg.Problem)
	}
	if reg.LlamaEngineConfig == nil {
		t.Fatal("expected LlamaEngineConfig to be set")
	}
	if reg.LlamaEngineConfig.CtxSize != 4096 {
		t.Fatalf("ctx_size=%d, want 4096", reg.LlamaEngineConfig.CtxSize)
	}
	if reg.LlamaEngineConfig.CacheTypeK != "q4_0" {
		t.Fatalf("cache_type_k=%q, want q4_0", reg.LlamaEngineConfig.CacheTypeK)
	}
	if reg.LlamaEngineConfig.FlashAttn != "auto" {
		t.Fatalf("flash_attn=%q, want auto", reg.LlamaEngineConfig.FlashAttn)
	}
}

func TestInspectManagedLlamaRegistrationExplicitMmprojMissingFailClose(t *testing.T) {
	modelsPath := t.TempDir()
	setupRegistrarTestModel(t, modelsPath, "test/test-model", "model.gguf")

	engineConfig, err := structpb.NewStruct(map[string]any{
		"llama": map[string]any{
			"mmproj": "test-test-model/missing-mmproj.gguf",
		},
	})
	if err != nil {
		t.Fatalf("build engine config: %v", err)
	}

	model := &runtimev1.LocalAssetRecord{
		LocalAssetId: "test-id",
		AssetId:      "test/test-model",
		Capabilities: []string{"text.generate", "text.generate.vision"},
		Engine:       "llama",
		Entry:        "model.gguf",
		EngineConfig: engineConfig,
	}

	reg := inspectManagedLlamaModelRegistration(
		model,
		runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED,
		modelsPath, true, false, nil,
	)
	if reg.Problem == "" {
		t.Fatal("expected fail-close for missing explicit mmproj")
	}
	if !strings.Contains(reg.Problem, "missing under models root") {
		t.Fatalf("unexpected problem: %s", reg.Problem)
	}
}
