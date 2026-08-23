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
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestAppAIConfigWholeOverwriteAndAccountIsolation(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selectedTextExecutionForTest(t, "app-config", "app-config.gguf")})
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
	if _, err := svc.OverwriteAppAIConfig(accountAWrite, &runtimev1.OverwriteAppAIConfigRequest{Config: first, ExpectedRevision: "0"}); err != nil {
		t.Fatalf("OverwriteAppAIConfig(first): %v", err)
	}

	second := appAIConfig("app.example", localAppAIConfigIntent("text.generate"))
	overwritten, err := svc.OverwriteAppAIConfig(accountAWrite, &runtimev1.OverwriteAppAIConfigRequest{Config: second, ExpectedRevision: "1"})
	if err != nil {
		t.Fatalf("OverwriteAppAIConfig(second): %v", err)
	}
	if got := overwritten.GetConfig().GetOwner().GetApp().GetAppId(); got != "app.example" {
		t.Fatalf("Runtime-derived owner = %q, want app.example", got)
	}
	if second.GetOwner().GetApp().GetAppId() != "app.example" {
		t.Fatalf("caller payload owner was mutated: %+v", second.GetOwner())
	}
	if got := overwritten.GetConfig().GetCapabilities(); len(got) != 1 || got[0].GetCapabilityContract() != "text.generate" || got[0].GetLocal() == nil {
		t.Fatalf("whole overwrite response = %+v", overwritten.GetConfig())
	}

	read, err := svc.GetAppAIConfig(accountARead, &runtimev1.GetAppAIConfigRequest{})
	if err != nil {
		t.Fatalf("GetAppAIConfig(account-a): %v", err)
	}
	if got := read.GetConfig().GetCapabilities(); len(got) != 1 || got[0].GetCapabilityContract() != "text.generate" {
		t.Fatalf("stored whole overwrite = %+v", read.GetConfig())
	}

	absent, err := svc.GetAppAIConfig(
		localAppAIConfigContext(
			"account-b",
			"app.example",
			accountservice.LocalAppOperationAppAIConfigRead,
		),
		&runtimev1.GetAppAIConfigRequest{},
	)
	if err != nil || absent.GetConfig() != nil || absent.GetRevision() != "0" {
		t.Fatalf("absent account snapshot = %+v, %v", absent, err)
	}
}

func TestAppLocalAIConfigsShareCurrentMachineSelectionWithoutRevisionChanges(t *testing.T) {
	resolver := &mutableLocalExecutionResolver{projection: selectedTextExecutionForTest(t, "loadout-a", "a.gguf")}
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	svc.SetLocalExecutionResolver(resolver)

	for _, appID := range []string{"app.a", "app.b"} {
		written, err := svc.OverwriteAppAIConfig(
			protectedAppAIConfigPrincipalContext("account-a", appID),
			&runtimev1.OverwriteAppAIConfigRequest{
				Config: appAIConfig(appID, localAppAIConfigIntent("text.generate")), ExpectedRevision: "0",
			},
		)
		if err != nil || written.GetRevision() != "1" {
			t.Fatalf("write %s = %+v, %v", appID, written, err)
		}
	}

	assertEffectiveLoadout := func(appID, loadoutID string) {
		t.Helper()
		read, err := svc.GetAppAIConfig(
			localAppAIConfigContext("account-a", appID, accountservice.LocalAppOperationAppAIConfigRead),
			&runtimev1.GetAppAIConfigRequest{},
		)
		if err != nil || read.GetRevision() != "1" || len(read.GetEffectiveSelections()) != 1 {
			t.Fatalf("read %s = %+v, %v", appID, read, err)
		}
		intent := read.GetConfig().GetCapabilities()[0]
		selection := read.GetEffectiveSelections()[0]
		if intent.GetLocal() == nil || len(intent.GetLocal().ProtoReflect().GetUnknown()) != 0 ||
			selection.GetState() != runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_READY ||
			selection.GetLocal().GetLoadoutRef() != loadoutID {
			t.Fatalf("effective %s = intent=%+v selection=%+v", appID, intent, selection)
		}
	}

	assertEffectiveLoadout("app.a", "loadout-a")
	assertEffectiveLoadout("app.b", "loadout-a")
	resolver.set(selectedTextExecutionForTest(t, "loadout-b", "b.gguf"))
	assertEffectiveLoadout("app.a", "loadout-b")
	assertEffectiveLoadout("app.b", "loadout-b")
}

func TestAppLocalAIConfigPersistsWhenMachineSelectionIsMissing(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{})
	appID := "app.missing-local"
	written, err := svc.OverwriteAppAIConfig(
		protectedAppAIConfigPrincipalContext("account-a", appID),
		&runtimev1.OverwriteAppAIConfigRequest{
			Config: appAIConfig(appID, localAppAIConfigIntent("text.generate")), ExpectedRevision: "0",
		},
	)
	if err != nil || !written.GetCommitted() || written.GetRevision() != "1" {
		t.Fatalf("route-only Local write = %+v, %v", written, err)
	}
	read, err := svc.GetAppAIConfig(
		localAppAIConfigContext("account-a", appID, accountservice.LocalAppOperationAppAIConfigRead),
		&runtimev1.GetAppAIConfigRequest{},
	)
	if err != nil || read.GetRevision() != "1" || read.GetConfig().GetCapabilities()[0].GetLocal() == nil ||
		len(read.GetEffectiveSelections()) != 1 ||
		read.GetEffectiveSelections()[0].GetState() != runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_MISSING ||
		len(read.GetEffectiveSelections()[0].GetReasons()) != 1 ||
		read.GetEffectiveSelections()[0].GetReasons()[0] != runtimev1.ReasonCode_AI_LOCAL_SELECTION_NOT_FOUND.String() {
		t.Fatalf("missing selection projection = %+v, %v", read, err)
	}
}

func TestAppLocalAIConfigEffectiveSelectionBlocksFeatureIncompatibleLoadout(t *testing.T) {
	selected := selectedTextExecutionForTest(t, "loadout-feature-mismatch", "feature-mismatch.gguf")
	selected.SupportedFeatures = []string{"input.audio"}
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selected})
	intent := localAppAIConfigIntent("text.generate")
	intent.RequiredFeatures = []string{"input.image"}
	appID := "app.feature-mismatch"

	if _, err := svc.OverwriteAppAIConfig(
		protectedAppAIConfigPrincipalContext("account-a", appID),
		&runtimev1.OverwriteAppAIConfigRequest{Config: appAIConfig(appID, intent), ExpectedRevision: "0"},
	); err != nil {
		t.Fatalf("OverwriteAppAIConfig: %v", err)
	}
	read, err := svc.GetAppAIConfig(
		localAppAIConfigContext("account-a", appID, accountservice.LocalAppOperationAppAIConfigRead),
		&runtimev1.GetAppAIConfigRequest{},
	)
	selection := read.GetEffectiveSelections()[0]
	if err != nil || selection.GetState() != runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_BLOCKED ||
		len(selection.GetReasons()) != 1 || selection.GetReasons()[0] != runtimev1.ReasonCode_AI_LOCAL_CAPABILITY_MISMATCH.String() ||
		selection.GetLocal().GetLoadoutRef() != selected.LoadoutID {
		t.Fatalf("feature-incompatible effective selection = %+v, %v", selection, err)
	}
}

func TestAppAIConfigCloudIntentRejectsMissingExactConnector(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	intent := cloudAIConfigIntent(t, "text.generate")
	intent.GetCloud().ConnectorRef = ""
	writeCtx := protectedAppAIConfigPrincipalContext("account-a", "app.example")
	overwritten, err := svc.OverwriteAppAIConfig(writeCtx, &runtimev1.OverwriteAppAIConfigRequest{Config: appAIConfig("app.example", intent), ExpectedRevision: "0"})
	if overwritten != nil || status.Code(err) != codes.InvalidArgument {
		t.Fatalf("connector-free Cloud intent = (%+v, %v)", overwritten, err)
	}
}

func TestProtectedAppAIConfigListsExactCloudConnectorAndTargets(t *testing.T) {
	fixture := newManagedCloudScenarioTestFixture(t, "openai", "gpt-4o-mini", "https://api.openai.com", Config{})
	ctx := localAppAIConfigContext(
		"user-001", "app.options", accountservice.LocalAppOperationAppAIConfigOptionsList,
	)
	connectors, err := fixture.service.ListAppAIConfigOptions(ctx, &runtimev1.ListAppAIConfigOptionsRequest{
		Query: &runtimev1.ListAppAIConfigOptionsRequest_CloudConnectors{
			CloudConnectors: &runtimev1.AIConfigCloudConnectorOptionsQuery{CapabilityContract: "text.generate"},
		},
	})
	if err != nil || connectors.GetCloudConnectors().GetOptions()[0].GetConnectorRef() != fixture.connectorID {
		t.Fatalf("Cloud Connector options = (%+v, %v)", connectors, err)
	}
	targets, err := fixture.service.ListAppAIConfigOptions(ctx, &runtimev1.ListAppAIConfigOptionsRequest{
		Query: &runtimev1.ListAppAIConfigOptionsRequest_CloudTargets{
			CloudTargets: &runtimev1.AIConfigCloudTargetOptionsQuery{
				CapabilityContract: "text.generate", ConnectorRef: fixture.connectorID,
			},
		},
	})
	if err != nil || len(targets.GetCloudTargets().GetOptions()) == 0 {
		t.Fatalf("Cloud target options = (%+v, %v)", targets, err)
	}
	selected := targets.GetCloudTargets().GetOptions()[0]
	if selected.GetConnectorRef() != fixture.connectorID || selected.GetProviderModelTarget() == nil || selected.GetImplementation() == nil {
		t.Fatalf("Cloud target option = %+v", selected)
	}
	badImplementation, _ := proto.Clone(selected.GetImplementation()).(*runtimev1.CapabilityImplementationIdentity)
	badImplementation.DriverId += ".forged"
	badIntent := &runtimev1.AIConfigCapabilityIntent{
		CapabilityContract: "text.generate",
		Route: &runtimev1.AIConfigCapabilityIntent_Cloud{Cloud: &runtimev1.AIConfigCloudIntent{
			ConnectorRef: fixture.connectorID, Implementation: badImplementation,
			ProviderModelTarget: proto.Clone(selected.GetProviderModelTarget()).(*structpb.Struct),
		}},
	}
	writeCtx := localAppAIConfigContext(
		"user-001", "app.options", accountservice.LocalAppOperationAppAIConfigOverwrite,
	)
	if _, err := fixture.service.OverwriteAppAIConfig(writeCtx, &runtimev1.OverwriteAppAIConfigRequest{
		Config: ownerlessAppAIConfig(badIntent), ExpectedRevision: "0",
	}); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("forged Cloud implementation code = %s, want InvalidArgument: %v", status.Code(err), err)
	}
	badStored := appAIConfig("app.options", badIntent)
	if _, _, committed, err := fixture.service.aiConfigStore.Overwrite(context.Background(), "user-001", "0", badStored); err != nil || !committed {
		t.Fatalf("seed incompatible stored Cloud intent = committed=%v err=%v", committed, err)
	}
	readCtx := localAppAIConfigContext(
		"user-001", "app.options", accountservice.LocalAppOperationAppAIConfigRead,
	)
	read, err := fixture.service.GetAppAIConfig(readCtx, &runtimev1.GetAppAIConfigRequest{})
	if err != nil || len(read.GetEffectiveSelections()) != 1 ||
		read.GetEffectiveSelections()[0].GetState() != runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_BLOCKED {
		t.Fatalf("incompatible stored Cloud effective projection = (%+v, %v)", read, err)
	}
}

func TestAppAIConfigCASReturnsCurrentSnapshotAndNoOpKeepsRevision(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selectedTextExecutionForTest(t, "app-cas", "app-cas.gguf")})
	ctx := protectedAppAIConfigPrincipalContext("account-a", "app.cas")
	config := appAIConfig("app.cas", localAppAIConfigIntent("text.generate"))
	first, err := svc.OverwriteAppAIConfig(ctx, &runtimev1.OverwriteAppAIConfigRequest{
		Config: config, ExpectedRevision: "0",
	})
	if err != nil || !first.GetCommitted() || first.GetRevision() != "1" {
		t.Fatalf("first CAS = %+v, %v", first, err)
	}
	conflict, err := svc.OverwriteAppAIConfig(ctx, &runtimev1.OverwriteAppAIConfigRequest{
		Config: config, ExpectedRevision: "0",
	})
	if err != nil || conflict.GetCommitted() || conflict.GetRevision() != "1" ||
		conflict.GetReasonCode() != runtimev1.ReasonCode_AI_CONFIG_REVISION_CONFLICT || conflict.GetConfig() == nil {
		t.Fatalf("stale CAS = %+v, %v", conflict, err)
	}
	noOp, err := svc.OverwriteAppAIConfig(ctx, &runtimev1.OverwriteAppAIConfigRequest{
		Config: config, ExpectedRevision: "1",
	})
	if err != nil || !noOp.GetCommitted() || noOp.GetRevision() != "1" {
		t.Fatalf("no-op CAS = %+v, %v", noOp, err)
	}
}

func TestDesktopAccountProductManagesExactAdmittedAppAIConfig(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selectedTextExecutionForTest(t, "app-managed", "app-managed.gguf")})
	ctx := desktopManagedAppAIConfigContext("account-a", "acme.widget")
	input := appAIConfig("acme.widget", localAppAIConfigIntent("voice.create"))

	written, err := svc.OverwriteAppAIConfig(ctx, &runtimev1.OverwriteAppAIConfigRequest{Config: input, ExpectedRevision: "0"})
	if err != nil || written.GetConfig().GetOwner().GetApp().GetAppId() != "acme.widget" {
		t.Fatalf("managed overwrite = (%+v, %v)", written, err)
	}
	read, err := svc.GetAppAIConfig(ctx, &runtimev1.GetAppAIConfigRequest{Owner: appAIConfigOwner("acme.widget")})
	if err != nil || len(read.GetConfig().GetCapabilities()) != 1 {
		t.Fatalf("managed read = (%+v, %v)", read, err)
	}
	options, err := svc.ListAppAIConfigOptions(ctx, &runtimev1.ListAppAIConfigOptionsRequest{
		Owner: appAIConfigOwner("acme.widget"),
		Query: &runtimev1.ListAppAIConfigOptionsRequest_LocalLoadouts{
			LocalLoadouts: &runtimev1.AIConfigLocalLoadoutOptionsQuery{CapabilityContract: "text.generate"},
		},
	})
	if err != nil || options.GetLocalLoadouts() == nil {
		t.Fatalf("managed options = (%+v, %v)", options, err)
	}
	absent, err := svc.GetAppAIConfig(desktopManagedAppAIConfigContext("account-b", "acme.widget"), &runtimev1.GetAppAIConfigRequest{Owner: appAIConfigOwner("acme.widget")})
	if err != nil || absent.GetConfig() != nil || absent.GetRevision() != "0" {
		t.Fatalf("managed absent read = (%+v, %v)", absent, err)
	}
}

func TestAppAIConfigRejectsUnadmittedOrNonDesktopCrossAppOwner(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	desktop := desktopAccountProductAIConfigContext("account-a")
	_, err := svc.OverwriteAppAIConfig(desktop, &runtimev1.OverwriteAppAIConfigRequest{Config: appAIConfig("nimi.unknown"), ExpectedRevision: "0"})
	assertAppAIConfigError(t, err, codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)

	ordinary := protectedprincipal.ContextWithAuthorizedAppOwnerDecision(
		protectedAppAIConfigPrincipalContext("account-a", "app.manager"),
		"acme.widget",
	)
	_, err = svc.OverwriteAppAIConfig(ordinary, &runtimev1.OverwriteAppAIConfigRequest{Config: appAIConfig("acme.widget"), ExpectedRevision: "0"})
	assertAppAIConfigError(t, err, codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)

	local := localAppAIConfigContext("account-a", "acme.widget", accountservice.LocalAppOperationAppAIConfigRead)
	_, err = svc.OverwriteAppAIConfig(local, &runtimev1.OverwriteAppAIConfigRequest{Config: ownerlessAppAIConfig(), ExpectedRevision: "0"})
	assertAppAIConfigError(t, err, codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
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

	written, err := svc.OverwriteAppAIConfig(writeContext, &runtimev1.OverwriteAppAIConfigRequest{Config: ownerlessAppAIConfig(), ExpectedRevision: "0"})
	if err != nil || !written.GetCommitted() || written.GetConfig().GetOwner().GetApp().GetAppId() != "app.a" {
		t.Fatalf("protected App self overwrite = %+v, %v", written, err)
	}

	_, err = svc.OverwriteAppAIConfig(writeContext, &runtimev1.OverwriteAppAIConfigRequest{Config: appAIConfig("app.b"), ExpectedRevision: "1"})
	assertAppAIConfigError(t, err, codes.InvalidArgument, runtimev1.ReasonCode_AI_CONFIG_INVALID)

	_, err = svc.GetAppAIConfig(readContext, &runtimev1.GetAppAIConfigRequest{Owner: appAIConfigOwner("app.a")})
	assertAppAIConfigError(t, err, codes.InvalidArgument, runtimev1.ReasonCode_AI_CONFIG_INVALID)

	_, err = svc.GetAppAIConfig(readContext, &runtimev1.GetAppAIConfigRequest{Owner: &runtimev1.AIConfigOwner{
		Owner: &runtimev1.AIConfigOwner_RuntimeLocalAgentSubsystem{
			RuntimeLocalAgentSubsystem: &runtimev1.AIConfigRuntimeLocalAgentSubsystemOwner{},
		},
	}})
	assertAppAIConfigError(t, err, codes.InvalidArgument, runtimev1.ReasonCode_AI_CONFIG_INVALID)

	read, err := svc.GetAppAIConfig(readContext, &runtimev1.GetAppAIConfigRequest{})
	if err != nil || read.GetRevision() != "1" || read.GetConfig().GetOwner().GetApp().GetAppId() != "app.a" {
		t.Fatalf("protected App self read = %+v, %v", read, err)
	}
}

func TestAppAIConfigRejectsOwnerlessFirstPartyAndUnauthenticatedCalls(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	principal := protectedprincipal.New(
		"nimi.desktop", "desktop-account-product.v1", "desktop-account-product.v1",
		&runtimev1.AccountProjection{AccountId: "account-desktop", RealmEnvironmentId: "realm-test"},
		1, [32]byte{1}, make(chan struct{}),
	)
	ctx := protectedprincipal.With(context.Background(), principal)

	_, err := svc.OverwriteAppAIConfig(ctx, &runtimev1.OverwriteAppAIConfigRequest{Config: ownerlessAppAIConfig(), ExpectedRevision: "0"})
	assertAppAIConfigError(t, err, codes.InvalidArgument, runtimev1.ReasonCode_AI_CONFIG_INVALID)

	_, err = svc.GetAppAIConfig(ctx, &runtimev1.GetAppAIConfigRequest{})
	assertAppAIConfigError(t, err, codes.InvalidArgument, runtimev1.ReasonCode_AI_CONFIG_INVALID)

	_, err = svc.GetAppAIConfig(context.Background(), &runtimev1.GetAppAIConfigRequest{Owner: appAIConfigOwner("app.a")})
	assertAppAIConfigError(t, err, codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
}

func TestAppAIConfigAcceptsExactProtectedPrincipalOwner(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selectedTextExecutionForTest(t, "app-protected", "app-protected.gguf")})
	principal := protectedprincipal.New(
		"nimi.desktop", "desktop-account-product.v1", "desktop-account-product.v1",
		&runtimev1.AccountProjection{AccountId: "account-desktop", RealmEnvironmentId: "realm-test"},
		1, [32]byte{1}, make(chan struct{}),
	)
	ctx := protectedprincipal.With(context.Background(), principal)

	if _, err := svc.OverwriteAppAIConfig(ctx, &runtimev1.OverwriteAppAIConfigRequest{Config: appAIConfig("nimi.desktop", localAppAIConfigIntent("text.generate")), ExpectedRevision: "0"}); err != nil {
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
			ConnectorRef: "connector:test",
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
