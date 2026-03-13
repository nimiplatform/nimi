package ai

import (
	"context"
	"io"
	"log/slog"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	runtimecfg "github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
)

func TestProviderHelpersAndRouteSelectorWrapper(t *testing.T) {
	if got := normalizeFallbackText("   "); got != "empty input" {
		t.Fatalf("unexpected normalized fallback text: %q", got)
	}
	if got := normalizeFallbackText("  ok "); got != "ok" {
		t.Fatalf("unexpected trimmed fallback text: %q", got)
	}

	selector := newRouteSelector(Config{
		LocalProviders: map[string]nimillm.ProviderCredentials{
			"localai": {BaseURL: "http://127.0.0.1:18080/v1"},
		},
	})
	if selector == nil {
		t.Fatal("selector should not be nil")
	}
	if selector.local == nil {
		t.Fatal("local provider should be initialized")
	}

	provider, route, modelResolved, _, err := selector.resolveProvider(
		context.Background(),
		runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		runtimev1.FallbackPolicy_FALLBACK_POLICY_ALLOW,
		"local/qwen2.5",
	)
	if err != nil {
		t.Fatalf("resolveProvider wrapper should succeed: %v", err)
	}
	if provider == nil || route != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL || modelResolved == "" {
		t.Fatalf("unexpected resolveProvider result: provider=%v route=%v model=%q", provider, route, modelResolved)
	}
}

func TestRouteSelectorResolvesDefaultAliases(t *testing.T) {
	selector := newRouteSelector(Config{
		LocalProviders: map[string]nimillm.ProviderCredentials{
			"localai": {BaseURL: "http://127.0.0.1:18080/v1"},
		},
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"gemini": {BaseURL: "https://gemini.example/v1", APIKey: "gemini-key"},
			"openai": {BaseURL: "https://openai.example/v1", APIKey: "openai-key"},
		},
		DefaultCloudProvider: "openai",
		ProviderDefaultModels: map[string]string{
			"gemini": "gemini-2.5-pro",
			"openai": "gpt-5.2",
		},
	})

	_, route, modelResolved, _, err := selector.resolveProvider(
		context.Background(),
		runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		runtimev1.FallbackPolicy_FALLBACK_POLICY_ALLOW,
		"local/default",
	)
	if err != nil {
		t.Fatalf("resolve local default: %v", err)
	}
	if route != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL || modelResolved != "qwen2.5" {
		t.Fatalf("unexpected local default resolution: route=%v model=%q", route, modelResolved)
	}

	_, route, modelResolved, _, err = selector.resolveProvider(
		context.Background(),
		runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
		runtimev1.FallbackPolicy_FALLBACK_POLICY_ALLOW,
		"gemini/default",
	)
	if err != nil {
		t.Fatalf("resolve provider default: %v", err)
	}
	if route != runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD || modelResolved != "gemini/gemini-2.5-pro" {
		t.Fatalf("unexpected provider default resolution: route=%v model=%q", route, modelResolved)
	}

	_, route, modelResolved, _, err = selector.resolveProvider(
		context.Background(),
		runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
		runtimev1.FallbackPolicy_FALLBACK_POLICY_ALLOW,
		"cloud/default",
	)
	if err != nil {
		t.Fatalf("resolve cloud default: %v", err)
	}
	if route != runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD || modelResolved != "openai/gpt-5.2" {
		t.Fatalf("unexpected cloud default resolution: route=%v model=%q", route, modelResolved)
	}
}

func TestLocalProviderLegacyWrappers(t *testing.T) {
	p := &localProvider{}

	if _, _, _, err := p.GenerateText(context.Background(), "local/qwen", nil, ""); err == nil {
		t.Fatalf("GenerateText should reject nil spec")
	}
	if _, _, err := p.StreamGenerateText(context.Background(), "local/qwen", nil, func(string) error { return nil }); err == nil {
		t.Fatalf("StreamGenerateText should reject nil spec")
	}

	spec := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "hi"}}}
	_, _, _, err := p.GenerateText(context.Background(), "local/qwen", spec, "")
	if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_MODEL_PROVIDER_MISMATCH {
		t.Fatalf("unexpected GenerateText fallback reason: %v", reason)
	}
	_, _, err = p.StreamGenerateText(context.Background(), "local/qwen", spec, func(string) error { return nil })
	if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_MODEL_PROVIDER_MISMATCH {
		t.Fatalf("unexpected StreamGenerateText fallback reason: %v", reason)
	}

	_, _, err = p.Embed(context.Background(), "localai/embedding-model", []string{"hello"})
	if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_MODEL_PROVIDER_MISMATCH {
		t.Fatalf("unexpected explicit backend mismatch reason: %v", reason)
	}
	_, _, err = p.Embed(context.Background(), "", []string{"hello"})
	if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE {
		t.Fatalf("unexpected embed unavailable reason: %v", reason)
	}

	if got := p.ResolveModelID("   "); got != "" {
		t.Fatalf("expected empty resolved model id, got %q", got)
	}
}

func TestServicePublicSettersAndAccessors(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	constructed := New(logger, nil, nil, nil, nil, runtimecfg.Config{})
	if constructed == nil {
		t.Fatalf("New should return service instance")
	}
	svc := newTestService(logger)
	if svc.CloudProvider() == nil {
		t.Fatalf("cloud provider accessor should return non-nil")
	}
	if svc.SpeechCatalogResolver() == nil {
		t.Fatalf("speech catalog resolver should return non-nil")
	}
	svc.SetModelRegistryPersistencePath("  /tmp/registry.json  ")
	if svc.registryPath != "/tmp/registry.json" {
		t.Fatalf("registry path should be trimmed, got %q", svc.registryPath)
	}
	fakeLister := &fakeLocalModelLister{}
	svc.SetLocalModelLister(fakeLister)
	if svc.localModel != fakeLister {
		t.Fatalf("local model lister should be set")
	}
	svc.SetLocalProviderEndpoint("localai", "http://127.0.0.1:18080/v1", "")
	local, ok := svc.selector.local.(*localProvider)
	if !ok || local == nil {
		t.Fatalf("expected local provider")
	}
	backend, _, _, available, _ := local.pickBackend("localai/dynamic-image")
	if backend == nil || !available {
		t.Fatalf("localai backend should be hot-swapped after endpoint injection")
	}
	svc.SetLocalProviderEndpoint("sidecar", "http://127.0.0.1:19191", "sidecar-key")
	sidecarBackend, resolvedModel, explicit, available, _ := local.pickBackend("sidecar/stable-audio-open-sidecar")
	if sidecarBackend == nil || !available {
		t.Fatalf("sidecar backend should be hot-swapped after endpoint injection")
	}
	if sidecarBackend.Name != "local-sidecar" {
		t.Fatalf("unexpected sidecar backend name: %q", sidecarBackend.Name)
	}
	if resolvedModel != "stable-audio-open-sidecar" || !explicit {
		t.Fatalf("unexpected sidecar resolution: model=%q explicit=%v", resolvedModel, explicit)
	}
}
