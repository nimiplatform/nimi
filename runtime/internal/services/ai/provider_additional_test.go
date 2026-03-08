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
		runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
		runtimev1.FallbackPolicy_FALLBACK_POLICY_ALLOW,
		"local/qwen2.5",
	)
	if err != nil {
		t.Fatalf("resolveProvider wrapper should succeed: %v", err)
	}
	if provider == nil || route != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME || modelResolved == "" {
		t.Fatalf("unexpected resolveProvider result: provider=%v route=%v model=%q", provider, route, modelResolved)
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
}
