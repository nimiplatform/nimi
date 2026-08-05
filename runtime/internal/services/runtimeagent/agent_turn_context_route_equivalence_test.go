package runtimeagent

import (
	"reflect"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/runtimeidentity"
)

func TestAgentTurnContextLocalAndCloudRoutesPreserveSemanticPromptIdentity(t *testing.T) {
	t.Parallel()

	localResolution := PublicChatBindingResolution{
		ModelID:             "fixture-local-model",
		RoutePolicy:         runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		ContextWindowTokens: 32768,
		CatalogRevision:     "fixture-local-catalog-v3",
		ModelRevision:       "fixture-local-model-r7",
		ProviderID:          "fixture-local-provider",
	}
	localTarget := &runtimeidentity.Target{Local: &runtimeidentity.LocalTarget{ProfileBindingID: "fixture-local-profile"}}
	cloudResolution := PublicChatBindingResolution{
		ModelID:             "fixture-cloud-model",
		RoutePolicy:         runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
		ConnectorID:         "fixture-cloud-connector",
		ContextWindowTokens: 32768,
		CatalogRevision:     "fixture-cloud-catalog-v9",
		ModelRevision:       "fixture-cloud-model-r11",
		ProviderID:          "fixture-cloud-provider",
	}
	cloudTarget := &runtimeidentity.Target{Cloud: &runtimeidentity.CloudTarget{
		ConnectorID:          cloudResolution.ConnectorID,
		RemoteModelCatalogID: cloudResolution.CatalogRevision,
		ProviderModelID:      cloudResolution.ModelID,
		Provider:             cloudResolution.ProviderID,
	}}

	localRoute := agentTurnContextTestRouteIdentity(t, localResolution, localTarget)
	cloudRoute := agentTurnContextTestRouteIdentity(t, cloudResolution, cloudTarget)
	if localRoute.RouteDigest == cloudRoute.RouteDigest {
		t.Fatal("local and cloud provider/model route fingerprints unexpectedly match")
	}
	if localRoute.CatalogRevisionDigest == cloudRoute.CatalogRevisionDigest {
		t.Fatal("local and cloud provider/model catalog revision digests unexpectedly match")
	}

	localInput := agentTurnContextTestInput(t, "worldCharacter")
	localInput.Route = localRoute
	cloudInput := localInput
	cloudInput.Route = cloudRoute

	localCompiled, err := compileAgentTurnContext(localInput)
	if err != nil {
		t.Fatalf("compile local route context: %v", err)
	}
	cloudCompiled, err := compileAgentTurnContext(cloudInput)
	if err != nil {
		t.Fatalf("compile cloud route context: %v", err)
	}

	if !reflect.DeepEqual(localCompiled.ProviderPrompt.Messages, cloudCompiled.ProviderPrompt.Messages) {
		t.Fatalf("route adapter identity changed semantic provider messages:\nlocal=%+v\ncloud=%+v", localCompiled.ProviderPrompt.Messages, cloudCompiled.ProviderPrompt.Messages)
	}
	if localCompiled.Manifest.ContextContentHash != cloudCompiled.Manifest.ContextContentHash {
		t.Fatalf("route identity changed contextContentHash: local=%s cloud=%s", localCompiled.Manifest.ContextContentHash, cloudCompiled.Manifest.ContextContentHash)
	}
	if localCompiled.Manifest.PromptHash != cloudCompiled.Manifest.PromptHash {
		t.Fatalf("route identity changed promptHash: local=%s cloud=%s", localCompiled.Manifest.PromptHash, cloudCompiled.Manifest.PromptHash)
	}
	if localCompiled.Manifest.ManifestInstanceHash == cloudCompiled.Manifest.ManifestInstanceHash {
		t.Fatal("route/catalog identity did not bind manifestInstanceHash")
	}
	if localCompiled.Manifest.RouteDigest != localRoute.RouteDigest || cloudCompiled.Manifest.RouteDigest != cloudRoute.RouteDigest ||
		localCompiled.Manifest.CatalogRevisionDigest != localRoute.CatalogRevisionDigest || cloudCompiled.Manifest.CatalogRevisionDigest != cloudRoute.CatalogRevisionDigest {
		t.Fatal("compiled manifests did not retain their resolved route/catalog identities")
	}
}

func agentTurnContextTestRouteIdentity(t *testing.T, resolution PublicChatBindingResolution, target *runtimeidentity.Target) agentTurnContextRouteInput {
	t.Helper()

	routeDigest := publicChatResolvedRouteDigest(resolution, target)
	catalogDigest, err := hashSourceMaterializationDomainJCS(publicChatCatalogRevisionHashDomain, struct {
		CatalogRevision string `json:"catalogRevision"`
		ModelRevision   string `json:"modelRevision"`
		ProviderID      string `json:"providerId"`
	}{resolution.CatalogRevision, resolution.ModelRevision, resolution.ProviderID})
	if err != nil {
		t.Fatalf("hash fixture catalog revision: %v", err)
	}
	if !validSHA256Hex(routeDigest) || !validSHA256Hex(catalogDigest) {
		t.Fatalf("fixture route identity is invalid: route=%q catalog=%q", routeDigest, catalogDigest)
	}
	return agentTurnContextRouteInput{
		RouteDigest:           routeDigest,
		CatalogRevisionDigest: catalogDigest,
	}
}
