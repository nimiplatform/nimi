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
			"llama": {BaseURL: "http://127.0.0.1:18080/v1"},
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
			"llama": {BaseURL: "http://127.0.0.1:18080/v1"},
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

	_, _, err = p.Embed(context.Background(), "llama/embedding-model", []string{"hello"})
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

func TestLocalProviderResolveModelIDPreservesExplicitEnginePrefixes(t *testing.T) {
	p := &localProvider{}

	cases := map[string]string{
		"local/qwen2.5":               "qwen2.5",
		"llama/z-image-turbo":         "llama/z-image-turbo",
		"media/flux.1-schnell":        "media/flux.1-schnell",
		"speech/qwen3-tts":            "speech/qwen3-tts",
		"sidecar/stable-audio-open-1": "sidecar/stable-audio-open-1",
	}
	for input, want := range cases {
		if got := p.ResolveModelID(input); got != want {
			t.Fatalf("ResolveModelID(%q): got=%q want=%q", input, got, want)
		}
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
	svc.SetLocalProviderEndpoint("llama", "http://127.0.0.1:18080/v1", "")
	local, ok := svc.selector.local.(*localProvider)
	if !ok || local == nil {
		t.Fatalf("expected local provider")
	}
	backend, _, _, available := local.pickAvailabilityBackend("llama/dynamic-image")
	if backend == nil || !available {
		t.Fatalf("llama backend should be hot-swapped after endpoint injection")
	}
	if backend.Name != "local-llama" {
		t.Fatalf("unexpected llama backend name: %q", backend.Name)
	}
	svc.SetLocalProviderEndpoint("sidecar", "http://127.0.0.1:19191", "sidecar-key")
	sidecarBackend, resolvedModel, explicit, available := local.pickAvailabilityBackend("sidecar/stable-audio-open-sidecar")
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

func TestLocalProviderCanonicalRoutingPrefersLlamaForTextAndEmbed(t *testing.T) {
	local := &localProvider{
		llama: &nimillm.Backend{Name: "local-llama"},
		media: &nimillm.Backend{Name: "local-media"},
	}

	backend, resolvedModel, explicit, available := local.pickTextBackend("local/qwen2.5")
	if backend == nil || backend.Name != "local-llama" {
		t.Fatalf("expected canonical local text backend to resolve to llama, got %#v", backend)
	}
	if resolvedModel != "qwen2.5" || !explicit || !available {
		t.Fatalf("unexpected text backend resolution: model=%q explicit=%v available=%v", resolvedModel, explicit, available)
	}

	embedBackend, embedModel, embedExplicit, embedAvailable := local.pickEmbeddingBackend("local/qwen2.5")
	if embedBackend == nil || embedBackend.Name != "local-llama" {
		t.Fatalf("expected canonical local embed backend to resolve to llama, got %#v", embedBackend)
	}
	if embedModel != "qwen2.5" || !embedExplicit || !embedAvailable {
		t.Fatalf("unexpected embed backend resolution: model=%q explicit=%v available=%v", embedModel, embedExplicit, embedAvailable)
	}
}

func TestLocalProviderCanonicalAvailabilityAndImageRouting(t *testing.T) {
	local := &localProvider{
		llama: &nimillm.Backend{Name: "local-llama"},
		media: &nimillm.Backend{Name: "local-media"},
	}

	availabilityBackend, resolvedModel, explicit, available := local.pickAvailabilityBackend("local/qwen2.5")
	if availabilityBackend == nil || availabilityBackend.Name != "local-llama" {
		t.Fatalf("expected local availability to prefer llama, got %#v", availabilityBackend)
	}
	if resolvedModel != "qwen2.5" || !explicit || !available {
		t.Fatalf("unexpected availability resolution: model=%q explicit=%v available=%v", resolvedModel, explicit, available)
	}

	imageBackend, imageModel, providerType := local.resolveMediaBackendForModal("local/flux.1-schnell", runtimev1.Modal_MODAL_IMAGE)
	if imageBackend == nil || imageBackend.Name != "local-media" {
		t.Fatalf("expected local image backend to resolve to media, got %#v", imageBackend)
	}
	if imageModel != "flux.1-schnell" || providerType != "media" {
		t.Fatalf("unexpected image resolution: model=%q providerType=%q", imageModel, providerType)
	}
}

func TestLocalProviderHardCutDoesNotFallbackAcrossEngines(t *testing.T) {
	local := &localProvider{
		llama: &nimillm.Backend{Name: "local-llama"},
	}

	textBackend, resolvedModel, explicit, available := local.pickTextBackend("local/qwen2.5")
	if textBackend == nil || !available {
		t.Fatalf("text route should still resolve to llama: backend=%#v available=%v", textBackend, available)
	}
	if resolvedModel != "qwen2.5" || !explicit {
		t.Fatalf("unexpected text hard-cut resolution: model=%q explicit=%v", resolvedModel, explicit)
	}

	imageBackend, imageModel, providerType := local.resolveMediaBackendForModal("local/flux.1-schnell", runtimev1.Modal_MODAL_IMAGE)
	if imageBackend != nil || providerType != "" {
		t.Fatalf("image route must not fallback to llama: backend=%#v providerType=%q", imageBackend, providerType)
	}
	if imageModel != "flux.1-schnell" {
		t.Fatalf("unexpected image hard-cut model resolution: %q", imageModel)
	}
}

func TestLocalProviderExplicitEngineSelectionSurvivesRouting(t *testing.T) {
	selector := newRouteSelector(Config{
		LocalProviders: map[string]nimillm.ProviderCredentials{
			"llama": {BaseURL: "http://127.0.0.1:18080/v1"},
			"media": {BaseURL: "http://127.0.0.1:18181/v1"},
		},
	})

	provider, route, modelResolved, _, err := selector.resolveProvider(
		context.Background(),
		runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		runtimev1.FallbackPolicy_FALLBACK_POLICY_ALLOW,
		"media/flux.1-schnell",
	)
	if err != nil {
		t.Fatalf("resolve explicit media route: %v", err)
	}
	if route != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL || modelResolved != "media/flux.1-schnell" {
		t.Fatalf("unexpected explicit media resolution: route=%v model=%q", route, modelResolved)
	}

	local, ok := provider.(*localProvider)
	if !ok || local == nil {
		t.Fatalf("expected local provider wrapper")
	}
	backend, resolvedModel, explicit, available := local.pickAvailabilityBackend(modelResolved)
	if backend == nil || backend.Name != "local-media" {
		t.Fatalf("explicit media route should keep media backend, got %#v", backend)
	}
	if resolvedModel != "flux.1-schnell" || !explicit || !available {
		t.Fatalf("unexpected explicit media availability: model=%q explicit=%v available=%v", resolvedModel, explicit, available)
	}
}
