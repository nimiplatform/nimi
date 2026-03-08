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
