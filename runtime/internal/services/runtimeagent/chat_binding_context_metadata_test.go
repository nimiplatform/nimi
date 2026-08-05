package runtimeagent

import (
	"context"
	"errors"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/runtimeidentity"
)

type contextMetadataBindingAIStub struct {
	window          uint64
	catalogRevision string
	modelRevision   string
	providerID      string
	resolvedTarget  *runtimeidentity.Target
	metadataErr     error
}

func (s contextMetadataBindingAIStub) ResolvePublicChatTextBinding(_ context.Context, route runtimev1.RoutePolicy, modelID string) (runtimev1.RoutePolicy, string, error) {
	return route, modelID, nil
}

func (s contextMetadataBindingAIStub) ResolvePublicChatTextContextMetadataLease(_ context.Context, _ runtimev1.RoutePolicy, _ string, targetRef *runtimeidentity.Target) (uint64, string, string, string, *runtimeidentity.Target, func(), error) {
	if s.resolvedTarget != nil {
		targetRef = s.resolvedTarget
	}
	return s.window, s.catalogRevision, s.modelRevision, s.providerID, clonePublicChatTargetRef(targetRef), nil, s.metadataErr
}

func TestPublicChatBindingResolutionBindsLocalConfigurationMetadataAndRouteDigest(t *testing.T) {
	resolver := NewAIBackedPublicChatBindingResolver(contextMetadataBindingAIStub{
		window: 32768, catalogRevision: "catalog-v1", modelRevision: "model-v1", providerID: "local",
	})

	first, err := resolver.ResolvePublicChatBinding(context.Background(), PublicChatBindingResolutionRequest{
		ModelID: "gemma-4-e2b-it-local", RouteHint: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
	})
	if err != nil {
		t.Fatalf("ResolvePublicChatBinding: %v", err)
	}
	second, err := resolver.ResolvePublicChatBinding(context.Background(), PublicChatBindingResolutionRequest{
		ModelID: "gemma-4-e2b-it-local", RouteHint: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
	})
	if err != nil {
		t.Fatalf("ResolvePublicChatBinding replay: %v", err)
	}
	if first.ContextWindowTokens != 32768 || first.CatalogRevision != "catalog-v1" || first.ModelRevision != "model-v1" || first.ProviderID != "local" {
		t.Fatalf("resolution metadata = %+v", first)
	}
	if first.RouteDigest == "" || first.RouteDigest != second.RouteDigest {
		t.Fatalf("route digest is not stable: first=%q second=%q", first.RouteDigest, second.RouteDigest)
	}

	changedResolver := NewAIBackedPublicChatBindingResolver(contextMetadataBindingAIStub{
		window: 32768, catalogRevision: "catalog-v1", modelRevision: "model-v2", providerID: "local",
	})
	changed, err := changedResolver.ResolvePublicChatBinding(context.Background(), PublicChatBindingResolutionRequest{
		ModelID: "gemma-4-e2b-it-local", RouteHint: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
	})
	if err != nil {
		t.Fatalf("ResolvePublicChatBinding changed content: %v", err)
	}
	if changed.RouteDigest == first.RouteDigest {
		t.Fatal("route digest must bind exact local content revision")
	}
}

func TestPublicChatBindingResolutionKeepsLocalIntentTargetless(t *testing.T) {
	resolver := NewAIBackedPublicChatBindingResolver(contextMetadataBindingAIStub{
		window: 32768, catalogRevision: "catalog-v1", modelRevision: "model-v1", providerID: "local",
	})

	resolved, err := resolver.ResolvePublicChatBinding(context.Background(), PublicChatBindingResolutionRequest{
		BindingAlias: "local/default", ModelID: "gemma-4-e2b-it-local", RouteHint: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
	})
	if err != nil {
		t.Fatalf("ResolvePublicChatBinding alias: %v", err)
	}
	if resolved.BindingAlias != "local/default" {
		t.Fatalf("binding alias = %q", resolved.BindingAlias)
	}
	if resolved.TargetRef != nil {
		t.Fatalf("LocalAgent intent gained a durable target: %+v", resolved.TargetRef)
	}
	if resolved.RouteDigest == "" {
		t.Fatal("resolved alias route digest is empty")
	}
}

func TestPublicChatBindingResolutionFailsClosedWithoutCatalogMetadata(t *testing.T) {
	resolver := NewAIBackedPublicChatBindingResolver(contextMetadataBindingAIStub{metadataErr: errors.New("catalog capacity unavailable")})
	_, err := resolver.ResolvePublicChatBinding(context.Background(), PublicChatBindingResolutionRequest{
		ModelID: "gpt-test", RouteHint: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
	})
	if err == nil {
		t.Fatal("expected missing catalog metadata to fail closed")
	}
}
