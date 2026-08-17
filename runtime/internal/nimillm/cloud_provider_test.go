package nimillm

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestCloudProviderResolvesOnlyExactRemoteTarget(t *testing.T) {
	provider := NewCloudProvider(CloudConfig{
		Providers: map[string]ProviderCredentials{
			"openai": {BaseURL: "https://api.openai.com/v1"},
		},
	}, nil)
	target := &RemoteTarget{
		ProviderType:    "openai",
		Endpoint:        "https://api.openai.com/v1",
		ProviderModelID: "gpt-4o-mini",
	}
	backend, modelID := provider.ResolveMediaBackendWithTarget("gpt-4o-mini", target)
	if backend == nil || backend.Name != "cloud-openai" {
		t.Fatalf("exact target backend = %#v", backend)
	}
	if modelID != "gpt-4o-mini" {
		t.Fatalf("exact target model = %q", modelID)
	}
}

func TestCloudProviderRejectsMissingOrConflictingTarget(t *testing.T) {
	provider := NewCloudProvider(CloudConfig{
		Providers: map[string]ProviderCredentials{
			"openai": {BaseURL: "https://api.openai.com/v1"},
		},
	}, nil)
	spec := &runtimev1.TextGenerateScenarioSpec{
		Input: []*runtimev1.ChatMessage{{Role: "user", Content: "hello"}},
	}
	_, _, _, _, err := provider.GenerateTextScenarioWithTarget(context.Background(), "gpt-4o-mini", spec, "hello", nil)
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("missing target code = %v, err=%v", status.Code(err), err)
	}
	backend, _ := provider.ResolveMediaBackendWithTarget("openai/gpt-4o-mini", &RemoteTarget{
		ProviderType:    "openai",
		Endpoint:        "https://api.openai.com/v1",
		ProviderModelID: "gpt-4o-mini",
	})
	if backend != nil {
		t.Fatalf("model prefix must not be interpreted against an exact target")
	}
	backend, _ = provider.ResolveMediaBackendWithTarget("gpt-4o-mini", &RemoteTarget{
		ProviderType:    "OpenAI",
		Endpoint:        "https://api.openai.com/v1",
		ProviderModelID: "gpt-4o-mini",
	})
	if backend != nil {
		t.Fatalf("non-canonical provider must not be normalized into execution truth")
	}
}

func TestResolveRemoteTargetModelIDRequiresExactBinding(t *testing.T) {
	for _, tc := range []struct {
		name      string
		requested string
		bound     string
		want      string
		ok        bool
	}{
		{name: "exact", requested: "siliconflow/deepseek-v3.2", bound: "siliconflow/deepseek-v3.2", want: "siliconflow/deepseek-v3.2", ok: true},
		{name: "empty requested", requested: "", bound: "gpt-4o-mini", want: "gpt-4o-mini", ok: false},
		{name: "conflict", requested: "openai/gpt-4o-mini", bound: "gpt-4o-mini", want: "gpt-4o-mini", ok: false},
		{name: "missing binding", requested: "gpt-4o-mini", bound: "", want: "", ok: false},
		{name: "noncanonical whitespace", requested: " gpt-4o-mini ", bound: "gpt-4o-mini", want: "gpt-4o-mini", ok: false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := resolveRemoteTargetModelID(tc.requested, tc.bound)
			if got != tc.want || ok != tc.ok {
				t.Fatalf("resolveRemoteTargetModelID(%q, %q) = %q, %t; want %q, %t", tc.requested, tc.bound, got, ok, tc.want, tc.ok)
			}
		})
	}
}

func TestCloudProviderAlwaysEnforcesEndpointSecurity(t *testing.T) {
	provider := NewCloudProvider(CloudConfig{
		Providers: map[string]ProviderCredentials{
			"openai": {BaseURL: "http://example.com/v1"},
		},
		EnforceEndpointSecurity: false,
	}, nil)
	if backend := provider.backends["openai"]; backend != nil {
		t.Fatalf("expected insecure remote endpoint to be rejected even when EnforceEndpointSecurity=false, got %q", backend.Name)
	}
}

func TestCloudProviderExecutionNeverInheritsConfiguredBackendFacts(t *testing.T) {
	provider := NewCloudProvider(CloudConfig{
		Providers: map[string]ProviderCredentials{
			"openai": {
				BaseURL: "https://ambient.example/v1",
				APIKey:  "ambient-key",
				Headers: map[string]string{
					"X-Ambient": "forbidden",
				},
			},
		},
	}, nil)
	target := &RemoteTarget{
		ProviderType:    "openai",
		Endpoint:        "https://exact.example/v1",
		ProviderModelID: "gpt-4o-mini",
	}
	backend, modelID := provider.ResolveMediaBackendWithTarget("gpt-4o-mini", target)
	if backend == nil {
		t.Fatal("exact target backend is nil")
	}
	if modelID != "gpt-4o-mini" || backend.baseURL != "https://exact.example" || backend.apiKey != "" || len(backend.headers) != 0 {
		t.Fatalf("execution inherited ambient facts: model=%q endpoint=%q api_key=%q headers=%#v", modelID, backend.baseURL, backend.apiKey, backend.headers)
	}

	target.Endpoint = ""
	backend, _ = provider.ResolveMediaBackendWithTarget("gpt-4o-mini", target)
	if backend != nil {
		t.Fatalf("missing exact endpoint fell back to configured backend: %#v", backend)
	}
}
