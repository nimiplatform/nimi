package nimillm

import (
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/providerhealth"
)

func TestCloudProviderPickBackendRoutesByPrefix(t *testing.T) {
	provider := NewCloudProvider(CloudConfig{
		Providers: map[string]ProviderCredentials{
			"nimillm": {BaseURL: "https://api.nimillm.dev/v1"},
			"openai":  {BaseURL: "https://api.openai.com/v1"},
		},
	}, nil, nil)

	backend, resolvedModelID, explicit, ok := provider.PickBackend("openai/gpt-4o-mini")
	if backend == nil {
		t.Fatal("expected openai backend")
	}
	if backend.Name != "cloud-openai" {
		t.Fatalf("unexpected backend: %q", backend.Name)
	}
	if resolvedModelID != "gpt-4o-mini" {
		t.Fatalf("unexpected resolved model id: %q", resolvedModelID)
	}
	if !explicit {
		t.Fatal("expected explicit route")
	}
	if !ok {
		t.Fatal("expected explicit route to be available")
	}
}

func TestCloudProviderPickBackendRejectsUnavailableExplicitPrefixWithoutFallback(t *testing.T) {
	health := providerhealth.New()
	health.Mark("cloud-openai", false, "down")
	health.Mark("cloud-nimillm", true, "healthy")

	provider := NewCloudProvider(CloudConfig{
		Providers: map[string]ProviderCredentials{
			"nimillm": {BaseURL: "https://api.nimillm.dev/v1"},
			"openai":  {BaseURL: "https://api.openai.com/v1"},
		},
	}, nil, health)

	backend, resolvedModelID, explicit, ok := provider.PickBackend("openai/gpt-4o-mini")
	if backend != nil {
		t.Fatalf("expected no backend fallback for unavailable explicit prefix, got %q", backend.Name)
	}
	if resolvedModelID != "gpt-4o-mini" {
		t.Fatalf("unexpected resolved model id: %q", resolvedModelID)
	}
	if !explicit {
		t.Fatal("expected explicit route")
	}
	if ok {
		t.Fatal("expected unavailable explicit route")
	}
}

func TestCloudProviderPickBackendRejectsLegacyAliasPrefix(t *testing.T) {
	provider := NewCloudProvider(CloudConfig{
		Providers: map[string]ProviderCredentials{
			"dashscope": {BaseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1"},
		},
	}, nil, nil)

	backend, resolvedModelID, explicit, ok := provider.PickBackend("aliyun/qwen-max")
	if backend != nil {
		t.Fatalf("expected legacy alias prefix to be rejected, got %q", backend.Name)
	}
	if resolvedModelID != "qwen-max" {
		t.Fatalf("unexpected resolved model id: %q", resolvedModelID)
	}
	if !explicit {
		t.Fatal("expected explicit route for legacy alias prefix")
	}
	if ok {
		t.Fatal("expected legacy alias prefix to stay unavailable")
	}
}

func TestStripModelPrefix(t *testing.T) {
	cases := []struct {
		input string
		want  string
	}{
		{"deepseek/deepseek-chat", "deepseek-chat"},
		{"openai/gpt-4o-mini", "gpt-4o-mini"},
		{"gemini/gemini-2.0-flash", "gemini-2.0-flash"},
		{"cloud/deepseek/deepseek-chat", "deepseek-chat"},
		{"token/openai/gpt-4o", "gpt-4o"},
		{"cloud/some-model", "some-model"},
		{"deepseek-chat", "deepseek-chat"},
		{"", "cloud-default"},
		{"cloud/", "cloud-default"},
		{"  deepseek / deepseek-chat  ", "deepseek-chat"},
	}
	for _, tc := range cases {
		got := stripModelPrefix(tc.input)
		if got != tc.want {
			t.Errorf("stripModelPrefix(%q) = %q, want %q", tc.input, got, tc.want)
		}
	}
}
