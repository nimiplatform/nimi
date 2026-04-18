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
		{"speech/kokoro-82m", "speech/kokoro-82m"},
		{"sidecar/musicgen", "sidecar/musicgen"},
		{"LOCAL/qwen2.5", "local/qwen2.5"},
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
		{"local/vendor/model:fp16", "local/vendor/model:fp16"},
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
			"openai": {BaseURL: "https://api.openai.com", APIKey: "test-api-key"},
		},
	}
	name, target, err := ResolveCloudProvider(cfg, "openai")
	if err != nil {
		t.Fatalf("ResolveCloudProvider: %v", err)
	}
	if name != "openai" {
		t.Fatalf("name: got=%q want=%q", name, "openai")
	}
	if target.APIKey != "test-api-key" {
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

func TestResolveCloudProviderUsesQuotedProviderNames(t *testing.T) {
	cfg := config.Config{
		DefaultCloudProvider: "openai",
		Providers:            map[string]config.RuntimeFileTarget{},
	}
	_, _, err := ResolveCloudProvider(cfg, "")
	if err == nil {
		t.Fatal("expected missing default provider config to fail")
	}
	if got := err.Error(); got != `default cloud provider "openai" is not configured` {
		t.Fatalf("unexpected error: %v", err)
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

func TestResolveProviderDefaultTextModelRequiresConfiguredProvider(t *testing.T) {
	cfg := config.Config{
		Providers: map[string]config.RuntimeFileTarget{
			"openai": {},
		},
	}

	_, _, err := ResolveProviderDefaultTextModel(cfg, "anthropic")
	if err == nil {
		t.Fatal("expected missing provider configuration to fail")
	}
	if got := err.Error(); got != `provider "anthropic" is not configured` {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestResolveProviderDefaultTextModelOmitsCLIInstructions(t *testing.T) {
	cfg := config.Config{
		Providers: map[string]config.RuntimeFileTarget{
			"custom": {},
		},
	}

	_, _, err := ResolveProviderDefaultTextModel(cfg, "custom")
	if err == nil {
		t.Fatal("expected no-default-model error")
	}
	if got := err.Error(); got != `provider "custom" has no default text model` {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestResolveProviderDefaultTextModelFailsClosedForDynamicProvider(t *testing.T) {
	cfg := config.Config{
		Providers: map[string]config.RuntimeFileTarget{
			"openrouter": {},
		},
	}

	_, _, err := ResolveProviderDefaultTextModel(cfg, "openrouter")
	if err == nil {
		t.Fatal("expected dynamic provider without explicit default model to fail")
	}
	if got := err.Error(); got != `provider "openrouter" uses dynamic inventory and requires explicit provider.defaultModel or route-selected model` {
		t.Fatalf("unexpected error: %v", err)
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
		{"speech/kokoro-82m", true},
		{"sidecar/musicgen", true},
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

func TestResolveInternalDefaultAlias(t *testing.T) {
	cfg := config.Config{
		DefaultLocalTextModel: "qwen3",
		DefaultCloudProvider:  "openai",
		Providers: map[string]config.RuntimeFileTarget{
			"openai": {DefaultModel: "gpt-4.1"},
		},
	}

	tests := []struct {
		input string
		want  string
	}{
		{input: "local/default", want: "local/qwen3"},
		{input: "cloud/default", want: "openai/gpt-4.1"},
		{input: "openai/default", want: "openai/gpt-4.1"},
		{input: "openai/gpt-4.1", want: "openai/gpt-4.1"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got, err := ResolveInternalDefaultAlias(cfg, tt.input)
			if err != nil {
				t.Fatalf("ResolveInternalDefaultAlias(%q): %v", tt.input, err)
			}
			if got != tt.want {
				t.Fatalf("ResolveInternalDefaultAlias(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}
