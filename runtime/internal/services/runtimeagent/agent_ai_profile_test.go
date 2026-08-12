package runtimeagent

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aiconfig"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func portableAIProfileJSON() []byte {
	return []byte(`{
		"profileId":"portable-profile",
		"title":"Portable Profile",
		"description":"shared intent only",
		"capabilities":{
			"text.generate":{
				"route":"local",
				"requiredFeatures":["input.image"],
				"defaults":{"temperature":0.7},
				"implementation":{
					"implementationId":"local.llama.cpp",
					"driverId":"nimi.local.llama",
					"driverDialect":"v1",
					"supportedFeatures":["input.image"]
				},
				"driverPortableConfig":{"contextSize":8192},
				"resourceOccurrences":[{"occurrenceId":"main","role":"main"}]
			},
			"image.generate":{
				"route":"cloud",
				"requiredFeatures":[],
				"implementation":{
					"implementationId":"cloud.image",
					"driverId":"nimi.cloud.image",
					"driverDialect":"v1",
					"supportedFeatures":[]
				},
				"providerModelTarget":{"provider":"provider-a","providerModelId":"image-1","remoteModelCatalogId":"remote-model-catalog-image-1"}
			}
		},
		"provenance":{"publisher":"example"},
		"license":{"name":"test"},
		"displayMetadata":{"category":"demo"}
	}`)
}

func TestSharedLocalAgentAIProfilePreviewDoesNotPersistAndApplyOverwrites(t *testing.T) {
	svc := newSharedAIConfigTestService(t)
	ctx, requestContext := sharedAIConfigTestContext("account-a", "nimi.desktop")

	preview, err := svc.PreviewSharedLocalAgentAIProfile(ctx, &runtimev1.PreviewSharedLocalAgentAIProfileRequest{
		Context: requestContext, ProfileJson: portableAIProfileJSON(),
	})
	if err != nil {
		t.Fatalf("PreviewSharedLocalAgentAIProfile: %v", err)
	}
	if preview.GetBefore() != nil {
		t.Fatalf("missing current config projected as before: %+v", preview.GetBefore())
	}
	after := preview.GetAfter()
	if after.GetOwner().GetRuntimeLocalAgentSubsystem() == nil || len(after.GetCapabilities()) != 2 {
		t.Fatalf("preview after = %+v", after)
	}
	if _, found, err := svc.readSharedLocalAgentAIConfig(ctx, "account-a"); err != nil || found {
		t.Fatalf("preview persisted config: found=%v err=%v", found, err)
	}
	local := after.GetCapabilities()[1]
	if local.GetCapabilityContract() != "text.generate" || local.GetLocal() == nil || local.GetCloud() != nil {
		t.Fatalf("Local profile recommendation was not projected as intent-only: %+v", local)
	}
	cloud := after.GetCapabilities()[0].GetCloud()
	if cloud == nil || cloud.GetImplementation().GetImplementationId() != "cloud.image" ||
		cloud.GetProviderModelTarget().GetFields()["providerModelId"].GetStringValue() != "image-1" ||
		cloud.GetProviderModelTarget().GetFields()["remoteModelCatalogId"].GetStringValue() != "remote-model-catalog-image-1" {
		t.Fatalf("Cloud profile recommendation = %+v", cloud)
	}

	applied, err := svc.ApplySharedLocalAgentAIProfile(ctx, &runtimev1.ApplySharedLocalAgentAIProfileRequest{
		Context: requestContext, ProfileJson: portableAIProfileJSON(),
	})
	if err != nil {
		t.Fatalf("ApplySharedLocalAgentAIProfile: %v", err)
	}
	if aiconfig.Hash(applied.GetConfig()) != aiconfig.Hash(after) {
		t.Fatalf("applied config differs from preview: preview=%+v apply=%+v", after, applied.GetConfig())
	}
	stored, found, err := svc.readSharedLocalAgentAIConfig(ctx, "account-a")
	if err != nil || !found || aiconfig.Hash(stored) != aiconfig.Hash(after) {
		t.Fatalf("applied config not persisted: found=%v config=%+v err=%v", found, stored, err)
	}
}

func TestPortableAIProfileMatchesSDKNumberAndTrimSemantics(t *testing.T) {
	config, err := sharedLocalAgentAIConfigFromProfile([]byte(`{
		"profileId":"p",
		"title":"\u0085title",
		"capabilities":{"text.generate":{"route":"local","defaults":{"temperature":1e-4000},"resourceOccurrences":[]}}
	}`))
	if err != nil {
		t.Fatalf("SDK-valid underflow/NEL profile rejected: %v", err)
	}
	if got := config.GetCapabilities()[0].GetDefaults().GetFields()["temperature"].GetNumberValue(); got != 0 {
		t.Fatalf("underflow projection = %v, want JavaScript number zero", got)
	}
	if _, err := sharedLocalAgentAIConfigFromProfile([]byte(`{
		"profileId":"\ufeffp",
		"title":"title",
		"capabilities":{"text.generate":{"route":"local"}}
	}`)); err == nil {
		t.Fatal("ECMAScript-trimmed profileId was accepted")
	}
}

func TestSharedLocalAgentAIProfileRejectsSDKInvalidDocumentsFailClosed(t *testing.T) {
	tests := map[string]string{
		"empty":                   ``,
		"non-object":              `[]`,
		"unknown root field":      `{"profileId":"p","title":"t","capabilities":{"text.generate":{"route":"local"}},"extra":true}`,
		"missing capabilities":    `{"profileId":"p","title":"t","capabilities":{}}`,
		"trimmed identity":        `{"profileId":" p","title":"t","capabilities":{"text.generate":{"route":"local"}}}`,
		"portable path":           `{"profileId":"p","title":"t","capabilities":{"text.generate":{"route":"local","defaults":{"output":"/tmp/model"}}}}`,
		"duplicate feature":       `{"profileId":"p","title":"t","capabilities":{"text.generate":{"route":"local","requiredFeatures":["vision","vision"]}}}`,
		"unsupported requirement": `{"profileId":"p","title":"t","capabilities":{"text.generate":{"route":"local","requiredFeatures":["vision"],"implementation":{"implementationId":"i","driverId":"d","driverDialect":"v1","supportedFeatures":[]}}}}`,
		"local cloud target":      `{"profileId":"p","title":"t","capabilities":{"text.generate":{"route":"local","providerModelTarget":{}}}}`,
		"local config no impl":    `{"profileId":"p","title":"t","capabilities":{"text.generate":{"route":"local","driverPortableConfig":{}}}}`,
		"cloud local config":      `{"profileId":"p","title":"t","capabilities":{"image.generate":{"route":"cloud","implementation":{"implementationId":"i","driverId":"d","driverDialect":"v1","supportedFeatures":[]},"providerModelTarget":{"provider":"p","model":"m"},"resourceOccurrences":[]}}}`,
		"empty cloud target":      `{"profileId":"p","title":"t","capabilities":{"image.generate":{"route":"cloud","implementation":{"implementationId":"i","driverId":"d","driverDialect":"v1","supportedFeatures":[]},"providerModelTarget":{}}}}`,
		"trailing JSON":           `{"profileId":"p","title":"t","capabilities":{"text.generate":{"route":"local"}}}{}`,
	}
	for name, raw := range tests {
		t.Run(name, func(t *testing.T) {
			svc := newSharedAIConfigTestService(t)
			ctx, requestContext := sharedAIConfigTestContext("account-a", "nimi.desktop")
			_, err := svc.ApplySharedLocalAgentAIProfile(ctx, &runtimev1.ApplySharedLocalAgentAIProfileRequest{
				Context: requestContext, ProfileJson: []byte(raw),
			})
			if status.Code(err) != codes.InvalidArgument {
				t.Fatalf("code = %s, want InvalidArgument: %v", status.Code(err), err)
			}
			if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_CONFIG_INVALID {
				t.Fatalf("reason = %s, present=%v", reason, ok)
			}
			if _, found, readErr := svc.readSharedLocalAgentAIConfig(ctx, "account-a"); readErr != nil || found {
				t.Fatalf("invalid profile persisted partial config: found=%v err=%v", found, readErr)
			}
		})
	}
}
