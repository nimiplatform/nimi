package aiconfig

import (
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestCanonicalizeLocalIntentOrdersCapabilitiesAndFeatures(t *testing.T) {
	config := &runtimev1.AIConfig{
		Owner: appOwner("app.example"),
		Capabilities: []*runtimev1.AIConfigCapabilityIntent{
			localIntent(t, "text.generate", []string{"input.audio", "input.image"}, map[string]any{
				"temperature":   0.7,
				"maxTokens":     512,
				"ghostMode":     false,
				"modelingStyle": "concise",
			}),
			localIntent(t, "image.generate", []string{"input.mask", "input.image"}, nil),
		},
	}

	canonical, err := Canonicalize(config)
	if err != nil {
		t.Fatalf("Canonicalize: %v", err)
	}
	if got := canonical.GetCapabilities()[0].GetCapabilityContract(); got != "image.generate" {
		t.Fatalf("first capability = %q, want image.generate", got)
	}
	features := canonical.GetCapabilities()[0].GetRequiredFeatures()
	if len(features) != 2 || features[0] != "input.image" || features[1] != "input.mask" {
		t.Fatalf("features not canonical: %v", features)
	}
	if config.GetCapabilities()[0].GetCapabilityContract() != "text.generate" {
		t.Fatal("Canonicalize mutated input capability ordering")
	}
}

func TestCanonicalizeAcceptsEmptyCapabilitiesAndRuntimeLocalAgentSubsystemSingleton(t *testing.T) {
	if _, err := Canonicalize(&runtimev1.AIConfig{
		Owner: &runtimev1.AIConfigOwner{
			Owner: &runtimev1.AIConfigOwner_RuntimeLocalAgentSubsystem{RuntimeLocalAgentSubsystem: &runtimev1.AIConfigRuntimeLocalAgentSubsystemOwner{}},
		},
	}); err != nil {
		t.Fatalf("empty shared LocalAgent config: %v", err)
	}
	_, err := Canonicalize(&runtimev1.AIConfig{
		Owner: &runtimev1.AIConfigOwner{
			Owner: &runtimev1.AIConfigOwner_App{App: &runtimev1.AIConfigAppOwner{AppId: " local-agent-1"}},
		},
	})
	if err == nil || !strings.Contains(err.Error(), "canonical text") {
		t.Fatalf("expected non-canonical App owner rejection, got %v", err)
	}
	_, err = Canonicalize(&runtimev1.AIConfig{Owner: &runtimev1.AIConfigOwner{}})
	if err == nil || !strings.Contains(err.Error(), "owner kind") {
		t.Fatalf("expected absent owner discriminator rejection, got %v", err)
	}
}

func TestCanonicalizeEnforcesLocalCloudStructure(t *testing.T) {
	validCloud := cloudIntent(t, "image.generate")
	validCloud.GetCloud().ProviderModelTarget = mustStruct(t, map[string]any{
		"provider":             "provider-a",
		"providerModelId":      "/projects/p/locations/us/publishers/provider-a/models/image-1",
		"remoteModelCatalogId": "remote-model-catalog-image-1",
	})
	if _, err := Canonicalize(&runtimev1.AIConfig{Owner: appOwner("app.cloud"), Capabilities: []*runtimev1.AIConfigCapabilityIntent{validCloud}}); err != nil {
		t.Fatalf("valid Cloud intent: %v", err)
	}
	validDefaultPath := localIntent(t, "text.generate", nil, map[string]any{"helpCommand": "/help"})
	if _, err := Canonicalize(&runtimev1.AIConfig{Owner: appOwner("app.help"), Capabilities: []*runtimev1.AIConfigCapabilityIntent{validDefaultPath}}); err != nil {
		t.Fatalf("portable default beginning with slash: %v", err)
	}

	missingRoute := localIntent(t, "image.generate", nil, nil)
	missingRoute.Route = nil
	assertCanonicalizeFails(t, missingRoute, "route must be Local or Cloud")

	cloudWithSecretTarget := cloudIntent(t, "image.generate")
	cloudWithSecretTarget.GetCloud().ProviderModelTarget = mustStruct(t, map[string]any{"provider": "provider-a", "api_key": "secret"})
	assertCanonicalizeFails(t, cloudWithSecretTarget, "not permitted")

	cloudWithEndpoint := cloudIntent(t, "image.generate")
	cloudWithEndpoint.GetCloud().ProviderModelTarget = mustStruct(t, map[string]any{"provider": "provider-a", "providerModelId": "image-1", "remoteModelCatalogId": "remote-model-catalog-image-1", "endpoint": "https://example.invalid"})
	assertCanonicalizeFails(t, cloudWithEndpoint, "not permitted")

	cloudWithAlias := cloudIntent(t, "image.generate")
	cloudWithAlias.GetCloud().ProviderModelTarget = mustStruct(t, map[string]any{"provider": "provider-a", "model": "image-1", "remoteModelCatalogId": "remote-model-catalog-image-1"})
	assertCanonicalizeFails(t, cloudWithAlias, "model is not permitted")

	cloudWithoutCatalogIdentity := cloudIntent(t, "image.generate")
	cloudWithoutCatalogIdentity.GetCloud().ProviderModelTarget = mustStruct(t, map[string]any{"provider": "provider-a", "providerModelId": "image-1"})
	assertCanonicalizeFails(t, cloudWithoutCatalogIdentity, "remoteModelCatalogId is required")
}

func TestCanonicalizeRejectsDuplicateAndForbiddenLocalTruth(t *testing.T) {
	assertCanonicalizeFails(t, localIntent(t, "text.generate.vision", nil, nil), "canonical capability catalog")
	assertCanonicalizeFails(t, localIntent(t, "TEXT.GENERATE", nil, nil), "canonical capability catalog")
	duplicateFeature := localIntent(t, "text.generate", []string{"input.image", "input.image"}, nil)
	assertCanonicalizeFails(t, duplicateFeature, "duplicate required_feature")
	qualifiedFeature := localIntent(t, "text.generate", []string{"text.generate.input.image"}, nil)
	assertCanonicalizeFails(t, qualifiedFeature, "must be contract-local")
	mismatchedFeature := localIntent(t, "video.generate", []string{"input.mask"}, nil)
	assertCanonicalizeFails(t, mismatchedFeature, "standardized feature vocabulary")
	unknownFeature := localIntent(t, "text.generate", []string{"provider.magic"}, nil)
	assertCanonicalizeFails(t, unknownFeature, "standardized feature vocabulary")

	for name, testCase := range map[string]struct {
		defaults map[string]any
		contains string
	}{
		"nested model":     {defaults: map[string]any{"advanced": map[string]any{"model_id": "gemma.gguf"}}, contains: "canonical AIConfig"},
		"companion model":  {defaults: map[string]any{"main_model": "gemma.gguf"}, contains: "canonical AIConfig"},
		"account identity": {defaults: map[string]any{"advanced": map[string]any{"account_id": "account-a"}}, contains: "canonical AIConfig"},
		"asset ref":        {defaults: map[string]any{"source": "local-asset:asset-1"}, contains: "machine-private value"},
		"file URI":         {defaults: map[string]any{"source": "file:///models/gemma.gguf"}, contains: "machine-private value"},
		"secret":           {defaults: map[string]any{"advanced": map[string]any{"apiKey": "secret"}}, contains: "canonical AIConfig"},
		"secret alias":     {defaults: map[string]any{"advanced": map[string]any{"clientSecret": "secret"}}, contains: "canonical AIConfig"},
		"implementation":   {defaults: map[string]any{"implementationId": "local.llama"}, contains: "canonical AIConfig"},
		"target":           {defaults: map[string]any{"targetRef": "runtime-private"}, contains: "canonical AIConfig"},
		"probe":            {defaults: map[string]any{"probeResult": "ok"}, contains: "canonical AIConfig"},
		"warm":             {defaults: map[string]any{"warm": true}, contains: "canonical AIConfig"},
	} {
		t.Run(name, func(t *testing.T) {
			assertCanonicalizeFails(t, localIntent(t, "text.generate", nil, testCase.defaults), testCase.contains)
		})
	}
}

func assertCanonicalizeFails(t *testing.T, capability *runtimev1.AIConfigCapabilityIntent, contains string) {
	t.Helper()
	_, err := Canonicalize(&runtimev1.AIConfig{
		Owner:        appOwner("app.invalid"),
		Capabilities: []*runtimev1.AIConfigCapabilityIntent{capability},
	})
	if err == nil || !strings.Contains(err.Error(), contains) {
		t.Fatalf("expected error containing %q, got %v", contains, err)
	}
}

func appOwner(id string) *runtimev1.AIConfigOwner {
	return &runtimev1.AIConfigOwner{Owner: &runtimev1.AIConfigOwner_App{App: &runtimev1.AIConfigAppOwner{AppId: id}}}
}

func localIntent(t *testing.T, contract string, features []string, defaults map[string]any) *runtimev1.AIConfigCapabilityIntent {
	t.Helper()
	return &runtimev1.AIConfigCapabilityIntent{
		CapabilityContract: contract,
		RequiredFeatures:   features,
		Defaults:           mustStruct(t, defaults),
		Route:              &runtimev1.AIConfigCapabilityIntent_Local{Local: &runtimev1.AIConfigLocalIntent{}},
	}
}

func cloudIntent(t *testing.T, contract string) *runtimev1.AIConfigCapabilityIntent {
	t.Helper()
	return &runtimev1.AIConfigCapabilityIntent{
		CapabilityContract: contract,
		Route: &runtimev1.AIConfigCapabilityIntent_Cloud{Cloud: &runtimev1.AIConfigCloudIntent{
			Implementation: &runtimev1.CapabilityImplementationIdentity{
				ImplementationId: "cloud.image.provider-a",
				DriverId:         "cloud.provider-a",
				DriverDialect:    "v1",
			},
			ProviderModelTarget: mustStruct(t, map[string]any{
				"provider":             "provider-a",
				"providerModelId":      "image-1",
				"remoteModelCatalogId": "remote-model-catalog-image-1",
			}),
		}},
	}
}

func mustStruct(t *testing.T, value map[string]any) *structpb.Struct {
	t.Helper()
	if value == nil {
		return nil
	}
	result, err := structpb.NewStruct(value)
	if err != nil {
		t.Fatalf("structpb.NewStruct: %v", err)
	}
	return result
}
