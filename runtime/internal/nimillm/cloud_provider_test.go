package nimillm

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/providerhealth"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
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
	if err := health.Mark("cloud-openai", false, "down"); err != nil {
		t.Fatalf("Mark openai unhealthy: %v", err)
	}
	if err := health.Mark("cloud-nimillm", true, "healthy"); err != nil {
		t.Fatalf("Mark nimillm healthy: %v", err)
	}

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

func TestCloudProviderPickBackendEmptyModelHonorsProviderHealth(t *testing.T) {
	health := providerhealth.New()
	if err := health.Mark("cloud-nimillm", false, "down"); err != nil {
		t.Fatalf("Mark nimillm unhealthy: %v", err)
	}
	provider := NewCloudProvider(CloudConfig{
		Providers: map[string]ProviderCredentials{
			"nimillm": {BaseURL: "https://api.nimillm.dev/v1"},
		},
	}, nil, health)
	backend, resolvedModelID, explicit, ok := provider.PickBackend("")
	if backend != nil {
		t.Fatalf("expected unhealthy implicit default to return no backend, got %q", backend.Name)
	}
	if resolvedModelID != "cloud-default" {
		t.Fatalf("resolved model = %q", resolvedModelID)
	}
	if explicit {
		t.Fatal("empty model should not be explicit")
	}
	if ok {
		t.Fatal("expected unhealthy implicit default to fail closed")
	}
}

func TestCloudProviderRemoteTargetRejectsMismatchedProviderPrefix(t *testing.T) {
	provider := NewCloudProvider(CloudConfig{
		Providers: map[string]ProviderCredentials{
			"openai": {BaseURL: "https://api.openai.com/v1"},
		},
	}, nil, nil)
	spec := &runtimev1.TextGenerateScenarioSpec{
		Input: []*runtimev1.ChatMessage{{Role: "user", Content: "hello"}},
	}
	_, _, _, _, err := provider.GenerateTextScenarioWithTarget(context.Background(), "dashscope/qwen-max", spec, "hello", &RemoteTarget{
		ProviderType: "openai",
		Endpoint:     "https://api.openai.com/v1",
	})
	if status.Code(err) != codes.Unavailable {
		t.Fatalf("expected unavailable for mismatched target/model provider prefix, got %v", err)
	}
}

func TestCloudProviderAlwaysEnforcesEndpointSecurity(t *testing.T) {
	provider := NewCloudProvider(CloudConfig{
		Providers: map[string]ProviderCredentials{
			"openai": {BaseURL: "http://example.com/v1"},
		},
		EnforceEndpointSecurity: false,
	}, nil, nil)
	if backend := provider.Backends()["openai"]; backend != nil {
		t.Fatalf("expected insecure remote endpoint to be rejected even when EnforceEndpointSecurity=false, got %q", backend.Name)
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
