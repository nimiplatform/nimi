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

func TestLocalProviderResolveModelIDPreservesExplicitEnginePrefixes(t *testing.T) {
	p := &localProvider{}

	cases := map[string]string{
		"local/qwen2.5":               "qwen2.5",
		"localai/z-image-turbo":       "localai/z-image-turbo",
		"nexa/qwen-rerank":            "nexa/qwen-rerank",
		"nimi_media/flux.1-schnell":   "nimi_media/flux.1-schnell",
		"localsidecar/stable-audio-1": "localsidecar/stable-audio-1",
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
	svc.SetLocalProviderEndpoint("localai", "http://127.0.0.1:18080/v1", "")
	local, ok := svc.selector.local.(*localProvider)
	if !ok || local == nil {
		t.Fatalf("expected local provider")
	}
	backend, _, _, available, _ := local.pickAvailabilityBackend("localai/dynamic-image")
	if backend == nil || !available {
		t.Fatalf("localai backend should be hot-swapped after endpoint injection")
	}
	svc.SetLocalProviderEndpoint("sidecar", "http://127.0.0.1:19191", "sidecar-key")
	sidecarBackend, resolvedModel, explicit, available, _ := local.pickAvailabilityBackend("sidecar/stable-audio-open-sidecar")
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

func TestLocalProviderWindowsLocalRoutingPrefersNexaForTextAndEmbed(t *testing.T) {
	origGOOS := localProviderGOOS
	localProviderGOOS = "windows"
	defer func() { localProviderGOOS = origGOOS }()

	local := &localProvider{
		localai: &nimillm.Backend{Name: "local-localai"},
		nexa:    &nimillm.Backend{Name: "local-nexa"},
	}

	backend, resolvedModel, explicit, available, isNexa := local.pickTextBackend("local/qwen2.5")
	if backend == nil || backend.Name != "local-nexa" {
		t.Fatalf("expected windows local text backend to resolve to nexa, got %#v", backend)
	}
	if resolvedModel != "qwen2.5" || !explicit || !available || !isNexa {
		t.Fatalf("unexpected text backend resolution: model=%q explicit=%v available=%v isNexa=%v", resolvedModel, explicit, available, isNexa)
	}

	embedBackend, embedModel, embedExplicit, embedAvailable, embedIsNexa := local.pickEmbeddingBackend("local/qwen2.5")
	if embedBackend == nil || embedBackend.Name != "local-nexa" {
		t.Fatalf("expected windows local embed backend to resolve to nexa, got %#v", embedBackend)
	}
	if embedModel != "qwen2.5" || !embedExplicit || !embedAvailable || !embedIsNexa {
		t.Fatalf("unexpected embed backend resolution: model=%q explicit=%v available=%v isNexa=%v", embedModel, embedExplicit, embedAvailable, embedIsNexa)
	}
}

func TestLocalProviderWindowsLocalAvailabilityAndImageRouting(t *testing.T) {
	origGOOS := localProviderGOOS
	localProviderGOOS = "windows"
	defer func() { localProviderGOOS = origGOOS }()

	local := &localProvider{
		localai:   &nimillm.Backend{Name: "local-localai"},
		nexa:      &nimillm.Backend{Name: "local-nexa"},
		nimimedia: &nimillm.Backend{Name: "local-nimi-media"},
	}

	availabilityBackend, resolvedModel, explicit, available, isNexa := local.pickAvailabilityBackend("local/qwen2.5")
	if availabilityBackend == nil || availabilityBackend.Name != "local-nexa" {
		t.Fatalf("expected windows local availability to prefer nexa, got %#v", availabilityBackend)
	}
	if resolvedModel != "qwen2.5" || !explicit || !available || !isNexa {
		t.Fatalf("unexpected availability resolution: model=%q explicit=%v available=%v isNexa=%v", resolvedModel, explicit, available, isNexa)
	}

	imageBackend, imageModel, providerType := local.resolveMediaBackendForModal("local/flux.1-schnell", runtimev1.Modal_MODAL_IMAGE)
	if imageBackend == nil || imageBackend.Name != "local-nimi-media" {
		t.Fatalf("expected windows local image backend to resolve to nimi_media, got %#v", imageBackend)
	}
	if imageModel != "flux.1-schnell" || providerType != "nimi_media" {
		t.Fatalf("unexpected image resolution: model=%q providerType=%q", imageModel, providerType)
	}
}

func TestLocalProviderWindowsHardCutDoesNotFallbackAcrossEngines(t *testing.T) {
	origGOOS := localProviderGOOS
	localProviderGOOS = "windows"
	defer func() { localProviderGOOS = origGOOS }()

	local := &localProvider{
		localai: &nimillm.Backend{Name: "local-localai"},
	}

	textBackend, resolvedModel, explicit, available, isNexa := local.pickTextBackend("local/qwen2.5")
	if textBackend != nil || available {
		t.Fatalf("windows local text must not fallback to localai: backend=%#v available=%v", textBackend, available)
	}
	if resolvedModel != "qwen2.5" || !explicit || isNexa {
		t.Fatalf("unexpected text hard-cut resolution: model=%q explicit=%v isNexa=%v", resolvedModel, explicit, isNexa)
	}

	imageBackend, imageModel, providerType := local.resolveMediaBackendForModal("local/flux.1-schnell", runtimev1.Modal_MODAL_IMAGE)
	if imageBackend != nil || providerType != "" {
		t.Fatalf("windows local image must not fallback to localai: backend=%#v providerType=%q", imageBackend, providerType)
	}
	if imageModel != "flux.1-schnell" {
		t.Fatalf("unexpected image hard-cut model resolution: %q", imageModel)
	}
}

func TestLocalProviderExplicitEngineSelectionSurvivesRouting(t *testing.T) {
	origGOOS := localProviderGOOS
	localProviderGOOS = "darwin"
	defer func() { localProviderGOOS = origGOOS }()

	selector := newRouteSelector(Config{
		LocalProviders: map[string]nimillm.ProviderCredentials{
			"localai": {BaseURL: "http://127.0.0.1:18080/v1"},
			"nexa":    {BaseURL: "http://127.0.0.1:18181/v1"},
		},
	})

	provider, route, modelResolved, _, err := selector.resolveProvider(
		context.Background(),
		runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		runtimev1.FallbackPolicy_FALLBACK_POLICY_ALLOW,
		"nexa/qwen2.5",
	)
	if err != nil {
		t.Fatalf("resolve explicit nexa route: %v", err)
	}
	if route != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL || modelResolved != "nexa/qwen2.5" {
		t.Fatalf("unexpected explicit nexa resolution: route=%v model=%q", route, modelResolved)
	}

	local, ok := provider.(*localProvider)
	if !ok || local == nil {
		t.Fatalf("expected local provider wrapper")
	}
	backend, resolvedModel, explicit, available, isNexa := local.pickAvailabilityBackend(modelResolved)
	if backend == nil || backend.Name != "local-nexa" {
		t.Fatalf("explicit nexa route should keep nexa backend, got %#v", backend)
	}
	if resolvedModel != "qwen2.5" || !explicit || !available || !isNexa {
		t.Fatalf("unexpected explicit nexa availability: model=%q explicit=%v available=%v isNexa=%v", resolvedModel, explicit, available, isNexa)
	}
}
