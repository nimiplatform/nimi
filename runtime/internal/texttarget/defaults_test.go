package texttarget

import (
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/config"
)

func TestResolveLocalDefaultModelFromConfig(t *testing.T) {
	cfg := config.Config{DefaultLocalTextModel: "llama3"}
	if got := ResolveLocalDefaultModel(cfg); got != "llama3" {
		t.Fatalf("got=%q want=%q", got, "llama3")
	}
}

func TestResolveLocalDefaultModelFallback(t *testing.T) {
	cfg := config.Config{}
	if got := ResolveLocalDefaultModel(cfg); got != BundledDefaultLocalTextModel {
		t.Fatalf("got=%q want=%q", got, BundledDefaultLocalTextModel)
	}
}

func TestEnsureLocalQualifiedModel(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"qwen2.5", "local/qwen2.5"},
		{"local/qwen2.5", "local/qwen2.5"},
		{"llama/phi3", "llama/phi3"},
		{"media/flux.1-schnell", "media/flux.1-schnell"},
		{"sidecar/musicgen", "sidecar/musicgen"},
		{"media.diffusers/wan2.2", "local/media.diffusers/wan2.2"},
		{"", ""},
		{"  ", ""},
	}
	for _, tt := range tests {
		if got := EnsureLocalQualifiedModel(tt.input); got != tt.want {
			t.Errorf("EnsureLocalQualifiedModel(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

func TestEnsureLocalLatestModelRef(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"qwen2.5", "local/qwen2.5@latest"},
		{"local/qwen2.5", "local/qwen2.5@latest"},
		{"local/qwen2.5@v1", "local/qwen2.5@v1"},
		{"local/qwen2.5:fp16", "local/qwen2.5:fp16"},
		{"", ""},
	}
	for _, tt := range tests {
		if got := EnsureLocalLatestModelRef(tt.input); got != tt.want {
			t.Errorf("EnsureLocalLatestModelRef(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

func TestResolveCloudProviderWithHint(t *testing.T) {
	cfg := config.Config{
		Providers: map[string]config.RuntimeFileTarget{
			"openai": {BaseURL: "https://api.openai.com", APIKey: "sk-test"},
		},
	}
	name, target, err := ResolveCloudProvider(cfg, "openai")
	if err != nil {
		t.Fatalf("ResolveCloudProvider: %v", err)
	}
	if name != "openai" {
		t.Fatalf("name: got=%q want=%q", name, "openai")
	}
	if target.APIKey != "sk-test" {
		t.Fatalf("api key: got=%q", target.APIKey)
	}
}

func TestResolveCloudProviderUnsupportedHint(t *testing.T) {
	cfg := config.Config{}
	_, _, err := ResolveCloudProvider(cfg, "unknown-provider")
	if err == nil {
		t.Fatal("should fail on unsupported provider")
	}
}

func TestResolveCloudProviderDefault(t *testing.T) {
	cfg := config.Config{
		DefaultCloudProvider: "openai",
		Providers: map[string]config.RuntimeFileTarget{
			"openai": {BaseURL: "https://api.openai.com"},
		},
	}
	name, _, err := ResolveCloudProvider(cfg, "")
	if err != nil {
		t.Fatalf("ResolveCloudProvider: %v", err)
	}
	if name != "openai" {
		t.Fatalf("name: got=%q want=%q", name, "openai")
	}
}

func TestResolveCloudProviderNoDefault(t *testing.T) {
	cfg := config.Config{}
	_, _, err := ResolveCloudProvider(cfg, "")
	if err == nil {
		t.Fatal("should fail when no default cloud provider")
	}
}

func TestLooksLikeQualifiedRemoteModel(t *testing.T) {
	tests := []struct {
		input string
		want  bool
	}{
		{"openai/gpt-4", true},
		{"cloud/gpt-4", true},
		{"local/qwen2.5", false},
		{"gpt-4", false},
		{"", false},
		{"openai/", false},
	}
	for _, tt := range tests {
		if got := LooksLikeQualifiedRemoteModel(tt.input); got != tt.want {
			t.Errorf("LooksLikeQualifiedRemoteModel(%q) = %v, want %v", tt.input, got, tt.want)
		}
	}
}

func TestIsHighLevelQualifiedModel(t *testing.T) {
	tests := []struct {
		input string
		want  bool
	}{
		{"local/qwen2.5", true},
		{"llama/phi3", true},
		{"media/flux.1-schnell", true},
		{"sidecar/musicgen", true},
		{"media.diffusers/wan2.2", false},
		{"openai/gpt-4", true},
		{"cloud/gpt-4", true},
		{"gpt-4", false},
		{"", false},
	}
	for _, tt := range tests {
		if got := IsHighLevelQualifiedModel(tt.input); got != tt.want {
			t.Errorf("IsHighLevelQualifiedModel(%q) = %v, want %v", tt.input, got, tt.want)
		}
	}
}
