package engine

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"google.golang.org/protobuf/types/known/structpb"
	"gopkg.in/yaml.v3"
)

func TestExtractManagedLlamaEngineConfigNil(t *testing.T) {
	cfg, err := ExtractManagedLlamaEngineConfig(nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.CtxSize != 0 || cfg.CacheTypeK != "" || cfg.FlashAttn != "" || cfg.Mmproj != "" || cfg.NGPULayers != nil {
		t.Fatalf("expected zero config, got %+v", cfg)
	}
}

func TestExtractManagedLlamaEngineConfigValidCacheTypes(t *testing.T) {
	validTypes := []string{"f32", "f16", "bf16", "q8_0", "q4_0", "q4_1", "iq4_nl", "q5_0", "q5_1"}
	for _, ct := range validTypes {
		s := makeEngineConfigStruct(t, map[string]any{"cache_type_k": ct})
		cfg, err := ExtractManagedLlamaEngineConfig(s)
		if err != nil {
			t.Fatalf("cache_type_k=%q should be valid: %v", ct, err)
		}
		if cfg.CacheTypeK != ct {
			t.Fatalf("cache_type_k=%q, got %q", ct, cfg.CacheTypeK)
		}
	}
}

func TestExtractManagedLlamaEngineConfigInvalidCacheType(t *testing.T) {
	s := makeEngineConfigStruct(t, map[string]any{"cache_type_k": "q3_0"})
	_, err := ExtractManagedLlamaEngineConfig(s)
	if err == nil {
		t.Fatal("expected error for invalid cache_type_k q3_0")
	}
	if !strings.Contains(err.Error(), "cache_type_k") {
		t.Fatalf("error should mention cache_type_k: %v", err)
	}
}

func TestExtractManagedLlamaEngineConfigCtxSizeBounds(t *testing.T) {
	tests := []struct {
		value   float64
		wantErr bool
	}{
		{511, true},
		{512, false},
		{1048576, false},
		{1048577, true},
	}
	for _, tt := range tests {
		s := makeEngineConfigStruct(t, map[string]any{"ctx_size": tt.value})
		_, err := ExtractManagedLlamaEngineConfig(s)
		if (err != nil) != tt.wantErr {
			t.Fatalf("ctx_size=%.0f: err=%v, wantErr=%v", tt.value, err, tt.wantErr)
		}
	}
}

func TestExtractManagedLlamaEngineConfigFlashAttnTriState(t *testing.T) {
	for _, valid := range []string{"on", "off", "auto", "ON", "Auto"} {
		s := makeEngineConfigStruct(t, map[string]any{"flash_attn": valid})
		cfg, err := ExtractManagedLlamaEngineConfig(s)
		if err != nil {
			t.Fatalf("flash_attn=%q should be valid: %v", valid, err)
		}
		if cfg.FlashAttn != strings.ToLower(valid) {
			t.Fatalf("flash_attn=%q, got %q", strings.ToLower(valid), cfg.FlashAttn)
		}
	}
	s := makeEngineConfigStruct(t, map[string]any{"flash_attn": "yes"})
	_, err := ExtractManagedLlamaEngineConfig(s)
	if err == nil {
		t.Fatal("expected error for invalid flash_attn=yes")
	}
}

func TestExtractManagedLlamaEngineConfigMmprojGguf(t *testing.T) {
	s := makeEngineConfigStruct(t, map[string]any{"mmproj": "mmproj-model.gguf"})
	cfg, err := ExtractManagedLlamaEngineConfig(s)
	if err != nil {
		t.Fatalf("valid mmproj should pass: %v", err)
	}
	if cfg.Mmproj != "mmproj-model.gguf" {
		t.Fatalf("mmproj=%q", cfg.Mmproj)
	}

	s = makeEngineConfigStruct(t, map[string]any{"mmproj": "model.bin"})
	_, err = ExtractManagedLlamaEngineConfig(s)
	if err == nil {
		t.Fatal("expected error for non-gguf mmproj")
	}
}

func TestExtractManagedLlamaEngineConfigNGPULayers(t *testing.T) {
	s := makeEngineConfigStruct(t, map[string]any{"n_gpu_layers": float64(99)})
	cfg, err := ExtractManagedLlamaEngineConfig(s)
	if err != nil {
		t.Fatalf("n_gpu_layers=99 should pass: %v", err)
	}
	if cfg.NGPULayers == nil || *cfg.NGPULayers != 99 {
		t.Fatalf("n_gpu_layers=%v", cfg.NGPULayers)
	}

	s = makeEngineConfigStruct(t, map[string]any{"n_gpu_layers": float64(0)})
	cfg, err = ExtractManagedLlamaEngineConfig(s)
	if err != nil {
		t.Fatalf("n_gpu_layers=0 should pass: %v", err)
	}
	if cfg.NGPULayers == nil || *cfg.NGPULayers != 0 {
		t.Fatalf("n_gpu_layers=0 not preserved: %v", cfg.NGPULayers)
	}
}

func TestProjectLlamaEngineParamsEmpty(t *testing.T) {
	args, err := projectLlamaEngineParams("/models", llamaModelsConfigParameter{Model: "model.gguf"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(args) != 0 {
		t.Fatalf("expected no args, got %v", args)
	}
}

func TestProjectLlamaEngineParamsFull(t *testing.T) {
	nGPU := 99
	params := llamaModelsConfigParameter{
		Model:      "model.gguf",
		Mmproj:     "mmproj.gguf",
		CtxSize:    4096,
		CacheTypeK: "q4_0",
		CacheTypeV: "q8_0",
		FlashAttn:  "auto",
		NGPULayers: &nGPU,
	}
	modelsRoot := t.TempDir()
	// Create mmproj file so the path resolves
	mmDir := modelsRoot
	if err := os.WriteFile(filepath.Join(mmDir, "mmproj.gguf"), []byte("x"), 0o600); err != nil {
		t.Fatalf("write mmproj: %v", err)
	}

	args, err := projectLlamaEngineParams(modelsRoot, params)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	joined := strings.Join(args, " ")
	for _, want := range []string{"--ctx-size 4096", "--cache-type-k q4_0", "--cache-type-v q8_0", "--flash-attn auto", "--mmproj", "--n-gpu-layers 99"} {
		if !strings.Contains(joined, want) {
			t.Fatalf("missing %q in args: %s", want, joined)
		}
	}
}

func TestProjectLlamaEngineParamsMmprojEscape(t *testing.T) {
	params := llamaModelsConfigParameter{
		Model:  "model.gguf",
		Mmproj: "../../../etc/passwd.gguf",
	}
	_, err := projectLlamaEngineParams("/models", params)
	if err == nil {
		t.Fatal("expected error for mmproj path escape")
	}
	if !strings.Contains(err.Error(), "escapes") {
		t.Fatalf("error should mention escapes: %v", err)
	}
}

func TestLlamaCommandIncludesEngineParams(t *testing.T) {
	dir := t.TempDir()
	modelsDir := filepath.Join(dir, "models")
	if err := os.MkdirAll(modelsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	configPath := filepath.Join(dir, "llama-models.yaml")

	nGPU := 42
	entries := []struct {
		Name       string                     `yaml:"name"`
		Backend    string                     `yaml:"backend"`
		Parameters llamaModelsConfigParameter `yaml:"parameters"`
	}{
		{
			Name:    "test-model",
			Backend: "llama-cpp",
			Parameters: llamaModelsConfigParameter{
				Model:      "test/model.gguf",
				CtxSize:    8192,
				CacheTypeK: "q4_0",
				FlashAttn:  "on",
				NGPULayers: &nGPU,
			},
		},
	}
	raw, err := yaml.Marshal(entries)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(configPath, raw, 0o644); err != nil {
		t.Fatal(err)
	}

	cfg := EngineConfig{
		Kind:             EngineLlama,
		Port:             1234,
		BinaryPath:       "/usr/bin/true",
		ModelsPath:       modelsDir,
		ModelsConfigPath: configPath,
	}
	cmd, err := llamaCommand(cfg)
	if err != nil {
		t.Fatalf("llamaCommand: %v", err)
	}
	args := strings.Join(cmd.Args, " ")
	for _, want := range []string{"--ctx-size 8192", "--cache-type-k q4_0", "--flash-attn on", "--n-gpu-layers 42"} {
		if !strings.Contains(args, want) {
			t.Fatalf("missing %q in command: %s", want, args)
		}
	}
}

// makeEngineConfigStruct builds a *structpb.Struct with shape:
//
//	{"llama": {<fields>}}
func makeEngineConfigStruct(t *testing.T, fields map[string]any) *structpb.Struct {
	t.Helper()
	llamaFields := make(map[string]*structpb.Value, len(fields))
	for k, v := range fields {
		switch val := v.(type) {
		case string:
			llamaFields[k] = structpb.NewStringValue(val)
		case float64:
			llamaFields[k] = structpb.NewNumberValue(val)
		default:
			t.Fatalf("unsupported type for key %q: %T", k, v)
		}
	}
	return &structpb.Struct{
		Fields: map[string]*structpb.Value{
			"llama": structpb.NewStructValue(&structpb.Struct{Fields: llamaFields}),
		},
	}
}
