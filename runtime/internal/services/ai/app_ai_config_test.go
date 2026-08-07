package ai

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protectedprincipal"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestAppAIConfigWholeOverwriteAndAccountIsolation(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	accountAWrite := localAppAIConfigContext(
		"account-a",
		"app.example",
		accountservice.LocalAppOperationAppAIConfigOverwrite,
	)
	accountARead := localAppAIConfigContext(
		"account-a",
		"app.example",
		accountservice.LocalAppOperationAppAIConfigRead,
	)

	first := ownerlessAppAIConfig(
		localAppAIConfigIntent("text.generate"),
		localAppAIConfigIntent("image.generate"),
	)
	if _, err := svc.OverwriteAppAIConfig(accountAWrite, &runtimev1.OverwriteAppAIConfigRequest{Config: first}); err != nil {
		t.Fatalf("OverwriteAppAIConfig(first): %v", err)
	}

	second := ownerlessAppAIConfig(grantlessCloudAIConfigIntent(t, "text.generate"))
	overwritten, err := svc.OverwriteAppAIConfig(accountAWrite, &runtimev1.OverwriteAppAIConfigRequest{Config: second})
	if err != nil {
		t.Fatalf("OverwriteAppAIConfig(second): %v", err)
	}
	if got := overwritten.GetConfig().GetOwner().GetApp().GetAppId(); got != "app.example" {
		t.Fatalf("Runtime-derived owner = %q, want app.example", got)
	}
	if second.GetOwner() != nil {
		t.Fatalf("owner-free caller payload was mutated: %+v", second.GetOwner())
	}
	if got := overwritten.GetConfig().GetCapabilities(); len(got) != 1 || got[0].GetCapabilityContract() != "text.generate" || got[0].GetCloud().GetConnectorGrantId() != "" {
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

func TestAppAIConfigGrantBindingValidationIsDeterministicAndDoesNotProbe(t *testing.T) {
	var providerRequests atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		providerRequests.Add(1)
	}))
	defer provider.Close()

	store := connector.NewConnectorStoreWithMemorySecrets(t.TempDir())
	created, err := store.Create(connector.ConnectorRecord{
		Kind:      runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
		OwnerType: runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER,
		OwnerID:   "account-a",
		Provider:  "openai",
		Endpoint:  provider.URL,
		Status:    runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
	}, "credential-must-not-be-opened")
	if err != nil {
		t.Fatal(err)
	}
	grant, err := store.CreateGrant("account-a", created.ConnectorID)
	if err != nil {
		t.Fatal(err)
	}
	target, _ := structpb.NewStruct(map[string]any{"provider": "openai", "model": "gpt-4o-mini"})
	intent := &runtimev1.AIConfigCapabilityIntent{
		CapabilityContract: "text.generate",
		Route: &runtimev1.AIConfigCapabilityIntent_Cloud{Cloud: &runtimev1.AIConfigCloudIntent{
			Implementation: &runtimev1.CapabilityImplementationIdentity{
				ImplementationId: "cloud.text.openai", DriverId: "nimi.runtime.driver.openai", DriverDialect: "openai/chat-completions/v1",
			},
			ProviderModelTarget: target,
			ConnectorGrantId:    grant.GrantID,
		}},
	}
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	svc.connStore = store
	writeCtx := localAppAIConfigContext("account-a", "app.example", accountservice.LocalAppOperationAppAIConfigOverwrite)
	if _, err := svc.OverwriteAppAIConfig(writeCtx, &runtimev1.OverwriteAppAIConfigRequest{Config: ownerlessAppAIConfig(intent)}); err != nil {
		t.Fatalf("OverwriteAppAIConfig(active grant): %v", err)
	}
	if providerRequests.Load() != 0 {
		t.Fatalf("binding commit probed provider %d times", providerRequests.Load())
	}
	if _, err := store.RevokeGrant("account-a", grant.GrantID); err != nil {
		t.Fatal(err)
	}
	_, err = svc.OverwriteAppAIConfig(writeCtx, &runtimev1.OverwriteAppAIConfigRequest{Config: ownerlessAppAIConfig(intent)})
	assertAppAIConfigError(t, err, codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONNECTOR_GRANT_REVOKED)
	if providerRequests.Load() != 0 {
		t.Fatalf("rejected binding commit probed provider %d times", providerRequests.Load())
	}

	intent.GetCloud().ConnectorGrantId = ""
	if _, err := svc.OverwriteAppAIConfig(writeCtx, &runtimev1.OverwriteAppAIConfigRequest{Config: ownerlessAppAIConfig(intent)}); err != nil {
		t.Fatalf("grantless Cloud intent must remain saveable: %v", err)
	}
}

func TestProtectedLocalAppAIConfigRejectsCallerOwnerAndWrongOperation(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	writeContext := localAppAIConfigContext(
		"account-a",
		"app.a",
		accountservice.LocalAppOperationAppAIConfigOverwrite,
	)
	readContext := localAppAIConfigContext(
		"account-a",
		"app.a",
		accountservice.LocalAppOperationAppAIConfigRead,
	)

	_, err := svc.OverwriteAppAIConfig(writeContext, &runtimev1.OverwriteAppAIConfigRequest{Config: appAIConfig("app.a")})
	assertAppAIConfigError(t, err, codes.InvalidArgument, runtimev1.ReasonCode_AI_CONFIG_INVALID)

	_, err = svc.OverwriteAppAIConfig(writeContext, &runtimev1.OverwriteAppAIConfigRequest{Config: appAIConfig("app.b")})
	assertAppAIConfigError(t, err, codes.InvalidArgument, runtimev1.ReasonCode_AI_CONFIG_INVALID)

	_, err = svc.GetAppAIConfig(readContext, &runtimev1.GetAppAIConfigRequest{Owner: appAIConfigOwner("app.a")})
	assertAppAIConfigError(t, err, codes.InvalidArgument, runtimev1.ReasonCode_AI_CONFIG_INVALID)

	_, err = svc.GetAppAIConfig(readContext, &runtimev1.GetAppAIConfigRequest{Owner: &runtimev1.AIConfigOwner{
		Owner: &runtimev1.AIConfigOwner_RuntimeLocalAgentSubsystem{
			RuntimeLocalAgentSubsystem: &runtimev1.AIConfigRuntimeLocalAgentSubsystemOwner{},
		},
	}})
	assertAppAIConfigError(t, err, codes.InvalidArgument, runtimev1.ReasonCode_AI_CONFIG_INVALID)

	_, err = svc.GetAppAIConfig(writeContext, &runtimev1.GetAppAIConfigRequest{})
	assertAppAIConfigError(t, err, codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
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

func grantlessCloudAIConfigIntent(t *testing.T, contract string) *runtimev1.AIConfigCapabilityIntent {
	t.Helper()
	target, err := structpb.NewStruct(map[string]any{"provider": "example", "model": "model-a"})
	if err != nil {
		t.Fatalf("cloud target: %v", err)
	}
	return &runtimev1.AIConfigCapabilityIntent{
		CapabilityContract: contract,
		Route: &runtimev1.AIConfigCapabilityIntent_Cloud{Cloud: &runtimev1.AIConfigCloudIntent{
			Implementation: &runtimev1.CapabilityImplementationIdentity{
				ImplementationId: "cloud.text.example",
				DriverId:         "cloud.example",
				DriverDialect:    "v1",
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
