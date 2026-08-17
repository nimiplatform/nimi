package runtimeagent

import (
	"bytes"
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aiconfig"
	"github.com/nimiplatform/nimi/runtime/internal/aiprofile"
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
				,"loadout":{"recipeId":"llama.cpp-text-generate","axes":[{"slotId":"model.gguf","contentId":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","expectedHash":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","source":{"repo":"example/Gemma-GGUF","revision":"main","file":"gemma-q8_0.gguf","sizeBytes":1024}}],"options":{"contextSize":8192}}
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

func TestImportPortableAIProfileSavesOnlyCatalogDocument(t *testing.T) {
	svc := newSharedAIConfigTestService(t)
	ctx, requestContext := sharedAIConfigTestContext("account-a", "nimi.desktop")

	imported, err := svc.ImportPortableAIProfile(ctx, &runtimev1.ImportPortableAIProfileRequest{
		Context: requestContext, ProfileJson: portableAIProfileJSON(),
	})
	if err != nil {
		t.Fatalf("ImportPortableAIProfile: %v", err)
	}
	if imported.GetProfile().GetProfileId() != "portable-profile" || imported.GetProfile().GetTitle() != "Portable Profile" {
		t.Fatalf("imported profile = %+v", imported.GetProfile())
	}
	if _, found, readErr := svc.readSharedLocalAgentAIConfig(ctx, "account-a"); readErr != nil || found {
		t.Fatalf("Import Profile changed AIConfig: found=%v err=%v", found, readErr)
	}

	listed, err := svc.ListPortableAIProfiles(ctx, &runtimev1.ListPortableAIProfilesRequest{Context: requestContext})
	if err != nil {
		t.Fatalf("ListPortableAIProfiles: %v", err)
	}
	if len(listed.GetProfiles()) != 1 || string(listed.GetProfiles()[0].GetProfileJson()) != string(portableAIProfileJSON()) {
		t.Fatalf("portable Profile catalog = %+v", listed.GetProfiles())
	}
}

func TestListPortableAIProfilesIsolatesInvalidStoredSibling(t *testing.T) {
	svc := newSharedAIConfigTestService(t)
	store := aiprofile.NewMemoryStore()
	svc.SetAIProfileStore(store)
	ctx, requestContext := sharedAIConfigTestContext("account-a", "nimi.desktop")
	if _, err := store.Import(context.Background(), "account-a", &runtimev1.PortableAIProfileRecord{
		ProfileId: "healthy", Title: "Healthy", ProfileJson: []byte(`{"profileId":"healthy","title":"Healthy","capabilities":{"text.generate":{"route":"local"}}}`),
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Import(context.Background(), "account-a", &runtimev1.PortableAIProfileRecord{
		ProfileId: "invalid", Title: "Invalid", ProfileJson: []byte(`{"profileId":"invalid","title":"Invalid","capabilities":{"text.generate":{"route":"local","defaults":{"token":"private"}}}}`),
	}); err != nil {
		t.Fatal(err)
	}
	listed, err := svc.ListPortableAIProfiles(ctx, &runtimev1.ListPortableAIProfilesRequest{Context: requestContext})
	if err != nil {
		t.Fatal(err)
	}
	if len(listed.GetProfiles()) != 1 || listed.GetProfiles()[0].GetProfileId() != "healthy" {
		t.Fatalf("isolated AIProfile catalog = %+v", listed.GetProfiles())
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

	raw := bytes.Replace(portableAIProfileJSON(), []byte(`"sizeBytes":1024`), []byte(`"sizeBytes":1e3`), 1)
	if bytes.Equal(raw, portableAIProfileJSON()) {
		t.Fatal("portable profile fixture does not contain sizeBytes")
	}
	if _, err := sharedLocalAgentAIConfigFromProfile(raw); err != nil {
		t.Fatalf("SDK-valid exponent-form sizeBytes rejected: %v", err)
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
		"UNC path":                `{"profileId":"p","title":"t","capabilities":{"text.generate":{"route":"local","defaults":{"output":"\\\\server\\share"}}}}`,
		"token authority":         `{"profileId":"p","title":"t","capabilities":{"text.generate":{"route":"local","defaults":{"token":"private"}}}}`,
		"asset identity":          `{"profileId":"p","title":"t","capabilities":{"text.generate":{"route":"local","defaults":{"assetId":"machine-private"}}}}`,
		"unsafe integer":          `{"profileId":"p","title":"t","capabilities":{"text.generate":{"route":"local","defaults":{"seed":9007199254740992}}}}`,
		"machine identity":        `{"profileId":"p","title":"t","capabilities":{"text.generate":{"route":"local","defaults":{"machineId":"machine-private"}}}}`,
		"device identity":         `{"profileId":"p","title":"t","capabilities":{"text.generate":{"route":"local","defaults":{"device_id":"device-private"}}}}`,
		"host identity":           `{"profileId":"p","title":"t","capabilities":{"text.generate":{"route":"local","defaults":{"host-id":"host-private"}}}}`,
		"duplicate feature":       `{"profileId":"p","title":"t","capabilities":{"text.generate":{"route":"local","requiredFeatures":["vision","vision"]}}}`,
		"unsupported requirement": `{"profileId":"p","title":"t","capabilities":{"text.generate":{"route":"local","requiredFeatures":["vision"],"implementation":{"implementationId":"i","driverId":"d","driverDialect":"v1","supportedFeatures":[]}}}}`,
		"local cloud target":      `{"profileId":"p","title":"t","capabilities":{"text.generate":{"route":"local","providerModelTarget":{}}}}`,
		"local config no impl":    `{"profileId":"p","title":"t","capabilities":{"text.generate":{"route":"local","driverPortableConfig":{}}}}`,
		"cloud local config":      `{"profileId":"p","title":"t","capabilities":{"image.generate":{"route":"cloud","implementation":{"implementationId":"i","driverId":"d","driverDialect":"v1","supportedFeatures":[]},"providerModelTarget":{"provider":"p","model":"m"},"resourceOccurrences":[]}}}`,
		"drive absolute source":   `{"profileId":"p","title":"t","capabilities":{"text.generate":{"route":"local","implementation":{"implementationId":"i","driverId":"d","driverDialect":"v1","supportedFeatures":[]},"loadout":{"recipeId":"r","axes":[{"slotId":"model","contentId":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","expectedHash":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","source":{"repo":"example/repo","revision":"main","file":"C:/private.gguf"}}],"options":{}}}}}`,
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
