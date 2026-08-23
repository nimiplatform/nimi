package runtimeagent

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	aicatalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/aiconfig"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/known/structpb"
)

func newLocalAppConfigureTestService(t *testing.T) (*Service, string, string) {
	t.Helper()
	svc := newRuntimeAgentTestService(t)
	svc.SetAIConfigStore(aiconfig.NewMemoryStore())
	svc.SetMachineLocalExecutionResolver(sharedAIConfigLocalResolver{})
	if _, err := materializeRealmSourceTestAgent(t, svc, context.Background(), &realmSourceTestAgentInput{
		Context: testRuntimeAgentIdentityContext("agent-configure"),
	}); err != nil {
		t.Fatalf("materialize configure test Agent: %v", err)
	}
	return svc, "user-1", testRuntimeAgentLocalRef("agent-configure")
}

func localAppConfigureDecision(
	operation accountservice.LocalAppOperation,
	seed byte,
	accountID string,
) accountservice.LocalAppCallerDecision {
	decision := accountservice.LocalAppCallerDecision{
		AppID:                "nimi.thirdparty.configure",
		AccountID:            accountID,
		Operation:            operation,
		AuthorityClass:       localappop.AuthorityClassAppAccess,
		OperationCapability:  "agent.configure",
		RegisteredAppSubject: "registered-app-subject",
	}
	for index := range decision.SessionID {
		decision.SessionID[index] = seed + byte(index)
	}
	return decision
}

func localAppConfigureContext(
	operation accountservice.LocalAppOperation,
	seed byte,
	accountID string,
) (accountservice.LocalAppCallerDecision, context.Context) {
	decision := localAppConfigureDecision(operation, seed, accountID)
	return decision, accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision)
}

func TestLocalAppConfigureWireCarriesNoCallerAssertionOrOwnerIdentity(t *testing.T) {
	requests := map[string]protoreflect.MessageDescriptor{
		"GetLocalAppSharedLocalAgentAIConfig":       (&runtimev1.GetLocalAppSharedLocalAgentAIConfigRequest{}).ProtoReflect().Descriptor(),
		"OverwriteLocalAppSharedLocalAgentAIConfig": (&runtimev1.OverwriteLocalAppSharedLocalAgentAIConfigRequest{}).ProtoReflect().Descriptor(),
		"GetLocalAppAgentAutonomySnapshot":          (&runtimev1.GetLocalAppAgentAutonomySnapshotRequest{}).ProtoReflect().Descriptor(),
		"UpdateLocalAppAgentAutonomy":               (&runtimev1.UpdateLocalAppAgentAutonomyRequest{}).ProtoReflect().Descriptor(),
		"GetLocalAppAgentPresentationSnapshot":      (&runtimev1.GetLocalAppAgentPresentationSnapshotRequest{}).ProtoReflect().Descriptor(),
		"CommitLocalAppAgentPresentation":           (&runtimev1.CommitLocalAppAgentPresentationRequest{}).ProtoReflect().Descriptor(),
	}
	for _, forbidden := range []string{
		"agent_id", "local_agent_id", "local_agent_ref", "runtime_source_ref",
		"account", "account_id", "owner_user_id", "subject_user_id", "context",
		"session", "session_id", "permission", "permission_id", "grant", "posture",
		"credential", "provider", "model",
	} {
		for name, descriptor := range requests {
			if descriptor.Fields().ByName(protoreflect.Name(forbidden)) != nil {
				t.Fatalf("%s request exposes forbidden field %q", name, forbidden)
			}
		}
	}
	empty := (&runtimev1.GetLocalAppSharedLocalAgentAIConfigRequest{}).ProtoReflect().Descriptor()
	if empty.Fields().Len() != 0 {
		t.Fatalf("shared AIConfig get carries %d caller-selectable fields", empty.Fields().Len())
	}
	overwrite := (&runtimev1.OverwriteLocalAppSharedLocalAgentAIConfigRequest{}).ProtoReflect().Descriptor()
	if overwrite.Fields().Len() != 2 || overwrite.Fields().ByName("expected_revision") == nil || overwrite.Fields().ByName("capabilities") == nil {
		t.Fatalf("shared AIConfig overwrite fields = %d, want expected_revision plus capabilities", overwrite.Fields().Len())
	}
}

func TestLocalAppSharedAIConfigGetMissingAndWholeOverwrite(t *testing.T) {
	svc, accountID, _ := newLocalAppConfigureTestService(t)
	_, getCtx := localAppConfigureContext(accountservice.LocalAppOperationSharedAIConfigGet, 0x21, accountID)
	missing, err := svc.GetLocalAppSharedLocalAgentAIConfig(getCtx, &runtimev1.GetLocalAppSharedLocalAgentAIConfigRequest{})
	if err != nil {
		t.Fatalf("GetLocalAppSharedLocalAgentAIConfig: %v", err)
	}
	if missing.GetProjection().GetConfig() != nil || missing.GetProjection().GetRevision() != "0" {
		t.Fatalf("missing shared projection = %+v", missing.GetProjection())
	}

	_, overwriteCtx := localAppConfigureContext(accountservice.LocalAppOperationSharedAIConfigOverwrite, 0x21, accountID)
	written, err := svc.OverwriteLocalAppSharedLocalAgentAIConfig(overwriteCtx, &runtimev1.OverwriteLocalAppSharedLocalAgentAIConfigRequest{
		ExpectedRevision: "0",
		Capabilities: []*runtimev1.AIConfigCapabilityIntent{
			sharedLocalIntent("text.generate"), sharedLocalIntent("audio.transcribe"),
		},
	})
	if err != nil {
		t.Fatalf("OverwriteLocalAppSharedLocalAgentAIConfig: %v", err)
	}
	if len(written.GetProjection().GetConfig().GetCapabilities()) != 2 {
		t.Fatalf("overwritten projection = %+v", written.GetProjection())
	}
	reread, err := svc.GetLocalAppSharedLocalAgentAIConfig(getCtx, &runtimev1.GetLocalAppSharedLocalAgentAIConfigRequest{})
	if err != nil || len(reread.GetProjection().GetConfig().GetCapabilities()) != 2 {
		t.Fatalf("shared AIConfig reread = (%+v, %v)", reread.GetProjection(), err)
	}
}

func TestLocalAppSharedAIConfigListsExactCloudOptions(t *testing.T) {
	svc, accountID, _ := newLocalAppConfigureTestService(t)
	modelCatalog, err := aicatalog.NewResolver(aicatalog.ResolverConfig{})
	if err != nil {
		t.Fatal(err)
	}
	connectorStore := connector.NewConnectorStoreWithMemorySecrets(t.TempDir())
	record, err := connectorStore.Create(connector.ConnectorRecord{
		ConnectorID: "connector-shared-options", Kind: runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
		OwnerType: runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER, OwnerID: accountID,
		Provider: "openai", Label: "Shared OpenAI", Status: runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
	}, "test-credential")
	if err != nil {
		t.Fatal(err)
	}
	svc.SetConnectorStore(connectorStore)
	svc.SetModelCatalog(modelCatalog)
	_, optionsCtx := localAppConfigureContext(accountservice.LocalAppOperationSharedAIConfigOptions, 0x22, accountID)
	connectors, err := svc.ListLocalAppSharedLocalAgentAIConfigOptions(optionsCtx, &runtimev1.ListLocalAppSharedLocalAgentAIConfigOptionsRequest{
		Query: &runtimev1.ListLocalAppSharedLocalAgentAIConfigOptionsRequest_CloudConnectors{
			CloudConnectors: &runtimev1.AIConfigCloudConnectorOptionsQuery{CapabilityContract: "text.generate"},
		},
	})
	if err != nil || connectors.GetCloudConnectors().GetOptions()[0].GetConnectorRef() != record.ConnectorID {
		t.Fatalf("shared Cloud Connector options = (%+v, %v)", connectors, err)
	}
	targets, err := svc.ListLocalAppSharedLocalAgentAIConfigOptions(optionsCtx, &runtimev1.ListLocalAppSharedLocalAgentAIConfigOptionsRequest{
		Query: &runtimev1.ListLocalAppSharedLocalAgentAIConfigOptionsRequest_CloudTargets{
			CloudTargets: &runtimev1.AIConfigCloudTargetOptionsQuery{CapabilityContract: "text.generate", ConnectorRef: record.ConnectorID},
		},
	})
	if err != nil || len(targets.GetCloudTargets().GetOptions()) == 0 {
		t.Fatalf("shared Cloud target options = (%+v, %v)", targets, err)
	}
	selected := targets.GetCloudTargets().GetOptions()[0]
	badImplementation, _ := proto.Clone(selected.GetImplementation()).(*runtimev1.CapabilityImplementationIdentity)
	badImplementation.DriverDialect += ".forged"
	badIntent := &runtimev1.AIConfigCapabilityIntent{
		CapabilityContract: "text.generate",
		Route: &runtimev1.AIConfigCapabilityIntent_Cloud{Cloud: &runtimev1.AIConfigCloudIntent{
			ConnectorRef: record.ConnectorID, Implementation: badImplementation,
			ProviderModelTarget: proto.Clone(selected.GetProviderModelTarget()).(*structpb.Struct),
		}},
	}
	_, overwriteCtx := localAppConfigureContext(accountservice.LocalAppOperationSharedAIConfigOverwrite, 0x22, accountID)
	if _, err := svc.OverwriteLocalAppSharedLocalAgentAIConfig(overwriteCtx, &runtimev1.OverwriteLocalAppSharedLocalAgentAIConfigRequest{
		ExpectedRevision: "0", Capabilities: []*runtimev1.AIConfigCapabilityIntent{badIntent},
	}); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("forged shared Cloud implementation code = %s, want InvalidArgument: %v", status.Code(err), err)
	}
	badStored := &runtimev1.AIConfig{
		Owner: aiconfig.LocalAgentSubsystemOwner(), Capabilities: []*runtimev1.AIConfigCapabilityIntent{badIntent},
	}
	if _, _, committed, err := svc.aiConfigStore.Overwrite(context.Background(), accountID, "0", badStored); err != nil || !committed {
		t.Fatalf("seed incompatible shared Cloud intent = committed=%v err=%v", committed, err)
	}
	_, getCtx := localAppConfigureContext(accountservice.LocalAppOperationSharedAIConfigGet, 0x22, accountID)
	read, err := svc.GetLocalAppSharedLocalAgentAIConfig(getCtx, &runtimev1.GetLocalAppSharedLocalAgentAIConfigRequest{})
	effective := read.GetProjection().GetEffectiveSelections()
	if err != nil || len(effective) != 1 ||
		effective[0].GetState() != runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_BLOCKED {
		t.Fatalf("incompatible stored shared Cloud effective projection = (%+v, %v)", read, err)
	}
}

func TestLocalAppSharedAIConfigDeniesWithoutExactDecision(t *testing.T) {
	svc, accountID, localAgentRef := newLocalAppConfigureTestService(t)
	if _, err := svc.GetLocalAppSharedLocalAgentAIConfig(context.Background(), &runtimev1.GetLocalAppSharedLocalAgentAIConfigRequest{}); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("decisionless shared get code = %s", status.Code(err))
	}
	_, wrongOperation := localAppConfigureContext(accountservice.LocalAppOperationSharedAIConfigOverwrite, 0x31, accountID)
	if _, err := svc.GetLocalAppSharedLocalAgentAIConfig(wrongOperation, &runtimev1.GetLocalAppSharedLocalAgentAIConfigRequest{}); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("operation-mismatched shared get code = %s", status.Code(err))
	}
	bound, _ := localAppConfigureContext(accountservice.LocalAppOperationSharedAIConfigGet, 0x31, accountID)
	bound.LocalAgentID = localAgentRef
	if _, err := svc.GetLocalAppSharedLocalAgentAIConfig(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), bound),
		&runtimev1.GetLocalAppSharedLocalAgentAIConfigRequest{},
	); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("Agent-bound shared get code = %s", status.Code(err))
	}
}

func TestLocalAppAutonomySnapshotAndCASUpdate(t *testing.T) {
	svc, accountID, localAgentRef := newLocalAppConfigureTestService(t)
	snapshotDecision, snapshotCtx := localAppConfigureContext(accountservice.LocalAppOperationAutonomySnapshot, 0x41, accountID)
	handle := mintLocalAppAgentHandle(snapshotDecision, localAgentRef)
	snapshot, err := svc.GetLocalAppAgentAutonomySnapshot(snapshotCtx, &runtimev1.GetLocalAppAgentAutonomySnapshotRequest{AgentHandle: handle})
	if err != nil {
		t.Fatalf("GetLocalAppAgentAutonomySnapshot: %v", err)
	}
	revision := snapshot.GetProjection().GetAutonomyRevision()
	if revision == 0 {
		t.Fatalf("initial autonomy revision = %d, want Runtime-initialized revision", revision)
	}

	_, updateCtx := localAppConfigureContext(accountservice.LocalAppOperationUpdateAutonomy, 0x41, accountID)
	updated, err := svc.UpdateLocalAppAgentAutonomy(updateCtx, &runtimev1.UpdateLocalAppAgentAutonomyRequest{
		AgentHandle: handle, ExpectedAutonomyRevision: revision,
		Intent: &runtimev1.LocalAppAgentAutonomyIntent{Enabled: proto.Bool(true), Config: &runtimev1.LocalAppAgentAutonomyConfig{
			Mode: runtimev1.LocalAppAgentAutonomyMode_LOCAL_APP_AGENT_AUTONOMY_MODE_LOW, DailyTokenBudget: 1000, MaxTokensPerHook: 100,
		}},
	})
	if err != nil || !updated.GetProjection().GetEnabled() || updated.GetProjection().GetAutonomyRevision() != revision+1 {
		t.Fatalf("autonomy CAS update = (%+v, %v)", updated, err)
	}

	_, err = svc.UpdateLocalAppAgentAutonomy(updateCtx, &runtimev1.UpdateLocalAppAgentAutonomyRequest{
		AgentHandle: handle, ExpectedAutonomyRevision: revision,
		Intent: &runtimev1.LocalAppAgentAutonomyIntent{Enabled: proto.Bool(false)},
	})
	if status.Code(err) != codes.Aborted {
		t.Fatalf("stale autonomy update code = %s, err=%v", status.Code(err), err)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AGENT_AUTONOMY_REVISION_CONFLICT {
		t.Fatalf("stale autonomy reason = %s, %v", reason, ok)
	}

	reread, err := svc.GetLocalAppAgentAutonomySnapshot(snapshotCtx, &runtimev1.GetLocalAppAgentAutonomySnapshotRequest{AgentHandle: handle})
	if err != nil || !reread.GetProjection().GetEnabled() ||
		reread.GetProjection().GetAutonomyRevision() != revision+1 ||
		reread.GetProjection().GetConfig().GetDailyTokenBudget() != 1000 {
		t.Fatalf("autonomy reread = (%+v, %v)", reread.GetProjection(), err)
	}
}

func TestLocalAppAutonomyUpdateRejectsHandleAndOperationDrift(t *testing.T) {
	svc, accountID, localAgentRef := newLocalAppConfigureTestService(t)
	snapshotDecision, _ := localAppConfigureContext(accountservice.LocalAppOperationAutonomySnapshot, 0x51, accountID)
	handle := mintLocalAppAgentHandle(snapshotDecision, localAgentRef)

	foreignDecision, foreignCtx := localAppConfigureContext(accountservice.LocalAppOperationAutonomySnapshot, 0x51, "account-foreign")
	foreignHandle := mintLocalAppAgentHandle(foreignDecision, localAgentRef)
	if _, err := svc.GetLocalAppAgentAutonomySnapshot(foreignCtx, &runtimev1.GetLocalAppAgentAutonomySnapshotRequest{AgentHandle: foreignHandle}); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("cross-account snapshot code = %s", status.Code(err))
	}
	if _, err := svc.GetLocalAppAgentAutonomySnapshot(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), snapshotDecision),
		&runtimev1.GetLocalAppAgentAutonomySnapshotRequest{AgentHandle: "agent_ref_forged"},
	); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("forged handle snapshot code = %s", status.Code(err))
	}

	_, updateCtx := localAppConfigureContext(accountservice.LocalAppOperationUpdateAutonomy, 0x51, accountID)
	if _, err := svc.UpdateLocalAppAgentAutonomy(updateCtx, &runtimev1.UpdateLocalAppAgentAutonomyRequest{
		AgentHandle: handle, ExpectedAutonomyRevision: 1,
		Intent: &runtimev1.LocalAppAgentAutonomyIntent{Enabled: proto.Bool(true)},
	}); err != nil {
		t.Fatalf("handle must remain valid across operations of one session: %v", err)
	}
	snapshotDecision.Operation = accountservice.LocalAppOperationUpdateAutonomy
	if _, err := svc.GetLocalAppAgentAutonomySnapshot(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), snapshotDecision),
		&runtimev1.GetLocalAppAgentAutonomySnapshotRequest{AgentHandle: handle},
	); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("operation-mismatched snapshot code = %s", status.Code(err))
	}
}

func TestLocalAppPresentationCommitKeepsPreviousProfileRestoreCarrier(t *testing.T) {
	svc, accountID, localAgentRef := newLocalAppConfigureTestService(t)
	snapshotDecision, snapshotCtx := localAppConfigureContext(accountservice.LocalAppOperationPresentationSnapshot, 0x61, accountID)
	handle := mintLocalAppAgentHandle(snapshotDecision, localAgentRef)
	before, err := svc.GetLocalAppAgentPresentationSnapshot(snapshotCtx, &runtimev1.GetLocalAppAgentPresentationSnapshotRequest{AgentHandle: handle})
	if err != nil {
		t.Fatalf("GetLocalAppAgentPresentationSnapshot: %v", err)
	}
	if before.GetProjection().GetPresentationRevision() != 0 || before.GetProjection().GetProfile() != nil {
		t.Fatalf("fresh presentation projection = %+v, want revision zero without profile", before.GetProjection())
	}

	_, commitCtx := localAppConfigureContext(accountservice.LocalAppOperationCommitPresentation, 0x61, accountID)
	first, err := svc.CommitLocalAppAgentPresentation(commitCtx, &runtimev1.CommitLocalAppAgentPresentationRequest{
		AgentHandle: handle, ExpectedPresentationRevision: 0,
		Intent:         &runtimev1.LocalAppAgentPresentationIntent{BackendKind: runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_VRM},
		ImportedAssets: []*runtimev1.AgentPresentationAssetMaterial{testPresentationVRMMaterial()},
	})
	if err != nil || first.GetProjection().GetPresentationRevision() != 1 {
		t.Fatalf("initial presentation commit = (%+v, %v)", first, err)
	}
	if first.GetProjection().GetProfile().GetAvatarAssetRef() == "" || first.GetProjection().GetPreviousProfile() != nil {
		t.Fatalf("initial commit projection = %+v, want imported avatar without previous profile", first.GetProjection())
	}

	second, err := svc.CommitLocalAppAgentPresentation(commitCtx, &runtimev1.CommitLocalAppAgentPresentationRequest{
		AgentHandle: handle, ExpectedPresentationRevision: 1,
		Intent: &runtimev1.LocalAppAgentPresentationIntent{
			BackendKind:    runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_VRM,
			AvatarAssetRef: first.GetProjection().GetProfile().GetAvatarAssetRef(),
			IdlePreset:     "idle-breathe",
		},
	})
	if err != nil || second.GetProjection().GetPresentationRevision() != 2 {
		t.Fatalf("second presentation commit = (%+v, %v)", second, err)
	}
	restored := second.GetProjection().GetPreviousProfile()
	if restored == nil || restored.GetAvatarAssetRef() != first.GetProjection().GetProfile().GetAvatarAssetRef() {
		t.Fatalf("previous profile restore carrier = %+v, want first committed profile", restored)
	}

	_, err = svc.CommitLocalAppAgentPresentation(commitCtx, &runtimev1.CommitLocalAppAgentPresentationRequest{
		AgentHandle: handle, ExpectedPresentationRevision: 1,
		Intent: &runtimev1.LocalAppAgentPresentationIntent{BackendKind: runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_VRM},
	})
	if status.Code(err) != codes.Aborted {
		t.Fatalf("stale presentation commit code = %s, err=%v", status.Code(err), err)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AGENT_PRESENTATION_REVISION_CONFLICT {
		t.Fatalf("stale presentation reason = %s, %v", reason, ok)
	}
}
