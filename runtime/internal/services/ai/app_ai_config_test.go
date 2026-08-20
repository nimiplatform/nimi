package ai

import (
	"context"
	"io"
	"log/slog"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protectedprincipal"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestAppAIConfigWholeOverwriteAndAccountIsolation(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	accountAWrite := protectedAppAIConfigPrincipalContext("account-a", "app.example")
	accountARead := localAppAIConfigContext(
		"account-a",
		"app.example",
		accountservice.LocalAppOperationAppAIConfigRead,
	)

	first := appAIConfig("app.example",
		localAppAIConfigIntent("text.generate"),
		localAppAIConfigIntent("image.generate"),
	)
	if _, err := svc.OverwriteAppAIConfig(accountAWrite, &runtimev1.OverwriteAppAIConfigRequest{Config: first}); err != nil {
		t.Fatalf("OverwriteAppAIConfig(first): %v", err)
	}

	second := appAIConfig("app.example", cloudAIConfigIntent(t, "text.generate"))
	overwritten, err := svc.OverwriteAppAIConfig(accountAWrite, &runtimev1.OverwriteAppAIConfigRequest{Config: second})
	if err != nil {
		t.Fatalf("OverwriteAppAIConfig(second): %v", err)
	}
	if got := overwritten.GetConfig().GetOwner().GetApp().GetAppId(); got != "app.example" {
		t.Fatalf("Runtime-derived owner = %q, want app.example", got)
	}
	if second.GetOwner().GetApp().GetAppId() != "app.example" {
		t.Fatalf("caller payload owner was mutated: %+v", second.GetOwner())
	}
	if got := overwritten.GetConfig().GetCapabilities(); len(got) != 1 || got[0].GetCapabilityContract() != "text.generate" || got[0].GetCloud() == nil {
		t.Fatalf("whole overwrite response = %+v", overwritten.GetConfig())
	}

	read, err := svc.GetAppAIConfig(accountARead, &runtimev1.GetAppAIConfigRequest{})
	if err != nil {
		t.Fatalf("GetAppAIConfig(account-a): %v", err)
	}
	if got := read.GetConfig().GetCapabilities(); len(got) != 1 || got[0].GetCapabilityContract() != "text.generate" {
		t.Fatalf("stored whole overwrite = %+v", read.GetConfig())
	}

	_, err = svc.GetAppAIConfig(
		localAppAIConfigContext(
			"account-b",
			"app.example",
			accountservice.LocalAppOperationAppAIConfigRead,
		),
		&runtimev1.GetAppAIConfigRequest{},
	)
	assertAppAIConfigError(t, err, codes.NotFound, runtimev1.ReasonCode_AI_CONFIG_NOT_FOUND)
}

func TestAppAIConfigCloudIntentPersistsWithoutConnectorSelection(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	intent := cloudAIConfigIntent(t, "text.generate")
	writeCtx := protectedAppAIConfigPrincipalContext("account-a", "app.example")
	overwritten, err := svc.OverwriteAppAIConfig(writeCtx, &runtimev1.OverwriteAppAIConfigRequest{Config: appAIConfig("app.example", intent)})
	if err != nil {
		t.Fatalf("OverwriteAppAIConfig(connector-free Cloud intent): %v", err)
	}
	cloud := overwritten.GetConfig().GetCapabilities()[0].GetCloud()
	if cloud == nil || cloud.GetImplementation() == nil || cloud.GetProviderModelTarget() == nil {
		t.Fatalf("stored Cloud intent = %+v", cloud)
	}
}

func TestDesktopAccountProductManagesExactAdmittedAppAIConfig(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx := desktopManagedAppAIConfigContext("account-a", "acme.widget")
	input := appAIConfig("acme.widget", cloudAIConfigIntent(t, "voice.create"))

	written, err := svc.OverwriteAppAIConfig(ctx, &runtimev1.OverwriteAppAIConfigRequest{Config: input})
	if err != nil || written.GetConfig().GetOwner().GetApp().GetAppId() != "acme.widget" {
		t.Fatalf("managed overwrite = (%+v, %v)", written, err)
	}
	read, err := svc.GetAppAIConfig(ctx, &runtimev1.GetAppAIConfigRequest{Owner: appAIConfigOwner("acme.widget")})
	if err != nil || len(read.GetConfig().GetCapabilities()) != 1 {
		t.Fatalf("managed read = (%+v, %v)", read, err)
	}
	_, err = svc.GetAppAIConfig(desktopManagedAppAIConfigContext("account-b", "acme.widget"), &runtimev1.GetAppAIConfigRequest{Owner: appAIConfigOwner("acme.widget")})
	assertAppAIConfigError(t, err, codes.NotFound, runtimev1.ReasonCode_AI_CONFIG_NOT_FOUND)
}

func TestAppAIConfigRejectsUnadmittedOrNonDesktopCrossAppOwner(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	desktop := desktopAccountProductAIConfigContext("account-a")
	_, err := svc.OverwriteAppAIConfig(desktop, &runtimev1.OverwriteAppAIConfigRequest{Config: appAIConfig("nimi.unknown")})
	assertAppAIConfigError(t, err, codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)

	ordinary := protectedprincipal.ContextWithAuthorizedAppOwnerDecision(
		protectedAppAIConfigPrincipalContext("account-a", "app.manager"),
		"acme.widget",
	)
	_, err = svc.OverwriteAppAIConfig(ordinary, &runtimev1.OverwriteAppAIConfigRequest{Config: appAIConfig("acme.widget")})
	assertAppAIConfigError(t, err, codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)

	local := localAppAIConfigContext("account-a", "acme.widget", accountservice.LocalAppOperationAppAIConfigRead)
	_, err = svc.OverwriteAppAIConfig(local, &runtimev1.OverwriteAppAIConfigRequest{Config: ownerlessAppAIConfig()})
	assertAppAIConfigError(t, err, codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
}

func TestProtectedLocalAppAIConfigRejectsCallerOwnerAndWrongOperation(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	writeContext := localAppAIConfigContext(
		"account-a",
		"app.a",
		accountservice.LocalAppOperationAppAIConfigRead,
	)
	readContext := localAppAIConfigContext(
		"account-a",
		"app.a",
		accountservice.LocalAppOperationAppAIConfigRead,
	)

	_, err := svc.OverwriteAppAIConfig(writeContext, &runtimev1.OverwriteAppAIConfigRequest{Config: appAIConfig("app.a")})
	assertAppAIConfigError(t, err, codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)

	_, err = svc.OverwriteAppAIConfig(writeContext, &runtimev1.OverwriteAppAIConfigRequest{Config: appAIConfig("app.b")})
	assertAppAIConfigError(t, err, codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)

	_, err = svc.GetAppAIConfig(readContext, &runtimev1.GetAppAIConfigRequest{Owner: appAIConfigOwner("app.a")})
	assertAppAIConfigError(t, err, codes.InvalidArgument, runtimev1.ReasonCode_AI_CONFIG_INVALID)

	_, err = svc.GetAppAIConfig(readContext, &runtimev1.GetAppAIConfigRequest{Owner: &runtimev1.AIConfigOwner{
		Owner: &runtimev1.AIConfigOwner_RuntimeLocalAgentSubsystem{
			RuntimeLocalAgentSubsystem: &runtimev1.AIConfigRuntimeLocalAgentSubsystemOwner{},
		},
	}})
	assertAppAIConfigError(t, err, codes.InvalidArgument, runtimev1.ReasonCode_AI_CONFIG_INVALID)

	_, err = svc.GetAppAIConfig(writeContext, &runtimev1.GetAppAIConfigRequest{})
	assertAppAIConfigError(t, err, codes.NotFound, runtimev1.ReasonCode_AI_CONFIG_NOT_FOUND)
}

func TestAppAIConfigRejectsOwnerlessFirstPartyAndUnauthenticatedCalls(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	principal := protectedprincipal.New(
		"nimi.desktop", "desktop-account-product.v1", "desktop-account-product.v1",
		&runtimev1.AccountProjection{AccountId: "account-desktop", RealmEnvironmentId: "realm-test"},
		1, [32]byte{1}, make(chan struct{}),
	)
	ctx := protectedprincipal.With(context.Background(), principal)

	_, err := svc.OverwriteAppAIConfig(ctx, &runtimev1.OverwriteAppAIConfigRequest{Config: ownerlessAppAIConfig()})
	assertAppAIConfigError(t, err, codes.InvalidArgument, runtimev1.ReasonCode_AI_CONFIG_INVALID)

	_, err = svc.GetAppAIConfig(ctx, &runtimev1.GetAppAIConfigRequest{})
	assertAppAIConfigError(t, err, codes.InvalidArgument, runtimev1.ReasonCode_AI_CONFIG_INVALID)

	_, err = svc.GetAppAIConfig(context.Background(), &runtimev1.GetAppAIConfigRequest{Owner: appAIConfigOwner("app.a")})
	assertAppAIConfigError(t, err, codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
}

func TestAppAIConfigAcceptsExactProtectedPrincipalOwner(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	principal := protectedprincipal.New(
		"nimi.desktop", "desktop-account-product.v1", "desktop-account-product.v1",
		&runtimev1.AccountProjection{AccountId: "account-desktop", RealmEnvironmentId: "realm-test"},
		1, [32]byte{1}, make(chan struct{}),
	)
	ctx := protectedprincipal.With(context.Background(), principal)

	if _, err := svc.OverwriteAppAIConfig(ctx, &runtimev1.OverwriteAppAIConfigRequest{Config: appAIConfig("nimi.desktop", localAppAIConfigIntent("text.generate"))}); err != nil {
		t.Fatalf("OverwriteAppAIConfig(protected principal): %v", err)
	}
	read, err := svc.GetAppAIConfig(ctx, &runtimev1.GetAppAIConfigRequest{Owner: appAIConfigOwner("nimi.desktop")})
	if err != nil || read.GetConfig().GetOwner().GetApp().GetAppId() != "nimi.desktop" {
		t.Fatalf("GetAppAIConfig(protected principal) = %+v, %v", read, err)
	}
}

func protectedAppAIConfigPrincipalContext(accountID string, appID string) context.Context {
	principal := protectedprincipal.New(
		appID, "test-app-ai-config.v1", "test-app-ai-config.v1",
		&runtimev1.AccountProjection{AccountId: accountID, RealmEnvironmentId: "realm-test"},
		1, [32]byte{1}, make(chan struct{}),
	)
	return protectedprincipal.With(context.Background(), principal)
}

func desktopAccountProductAIConfigContext(accountID string) context.Context {
	principal := protectedprincipal.NewDesktopAccountProduct(
		&runtimev1.AccountProjection{AccountId: accountID, RealmEnvironmentId: "realm-test"},
		1, [32]byte{1}, make(chan struct{}),
	)
	return protectedprincipal.With(context.Background(), principal)
}

func desktopManagedAppAIConfigContext(accountID string, appID string) context.Context {
	return protectedprincipal.ContextWithAuthorizedAppOwnerDecision(
		desktopAccountProductAIConfigContext(accountID),
		appID,
	)
}

func localAppAIConfigContext(
	accountID string,
	appID string,
	operation accountservice.LocalAppOperation,
) context.Context {
	return accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{
		AccountID:            accountID,
		AppID:                appID,
		Operation:            operation,
		RegisteredAppSubject: "principal-record",
	})
}

func appAIConfigOwner(appID string) *runtimev1.AIConfigOwner {
	return &runtimev1.AIConfigOwner{Owner: &runtimev1.AIConfigOwner_App{App: &runtimev1.AIConfigAppOwner{AppId: appID}}}
}

func appAIConfig(appID string, capabilities ...*runtimev1.AIConfigCapabilityIntent) *runtimev1.AIConfig {
	return &runtimev1.AIConfig{Owner: appAIConfigOwner(appID), Capabilities: capabilities}
}

func ownerlessAppAIConfig(capabilities ...*runtimev1.AIConfigCapabilityIntent) *runtimev1.AIConfig {
	return &runtimev1.AIConfig{Capabilities: capabilities}
}

func localAppAIConfigIntent(contract string) *runtimev1.AIConfigCapabilityIntent {
	return &runtimev1.AIConfigCapabilityIntent{
		CapabilityContract: contract,
		Route: &runtimev1.AIConfigCapabilityIntent_Local{
			Local: &runtimev1.AIConfigLocalIntent{},
		},
	}
}

func cloudAIConfigIntent(t *testing.T, contract string) *runtimev1.AIConfigCapabilityIntent {
	t.Helper()
	target, err := structpb.NewStruct(map[string]any{
		"provider":             "openai",
		"providerModelId":      "gpt-4o-mini",
		"remoteModelCatalogId": "remote-model-catalog-openai-gpt-4o-mini",
	})
	if err != nil {
		t.Fatalf("cloud target: %v", err)
	}
	return &runtimev1.AIConfigCapabilityIntent{
		CapabilityContract: contract,
		Route: &runtimev1.AIConfigCapabilityIntent_Cloud{Cloud: &runtimev1.AIConfigCloudIntent{
			Implementation: &runtimev1.CapabilityImplementationIdentity{
				ImplementationId: "cloud.text.openai",
				DriverId:         "nimi.runtime.driver.openai",
				DriverDialect:    "openai/chat-completions/v1",
			},
			ProviderModelTarget: target,
		}},
	}
}

func assertAppAIConfigError(t *testing.T, err error, code codes.Code, reason runtimev1.ReasonCode) {
	t.Helper()
	if status.Code(err) != code {
		t.Fatalf("error code = %v, want %v: %v", status.Code(err), code, err)
	}
	got, ok := grpcerr.ExtractReasonCode(err)
	if !ok || got != reason {
		t.Fatalf("error reason = %v, %v; want %v: %v", got, ok, reason, err)
	}
}
