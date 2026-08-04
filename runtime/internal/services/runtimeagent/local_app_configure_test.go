package runtimeagent

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aiconfig"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
)

func newLocalAppConfigureTestAgent(t *testing.T) (*Service, string, string) {
	t.Helper()
	svc := newRuntimeAgentTestService(t)
	svc.SetAIConfigStore(aiconfig.NewMemoryStore())
	identityContext := testRuntimeAgentIdentityContext("local-app-configure-source")
	if _, err := materializeRealmSourceTestAgent(t, svc, context.Background(), &realmSourceTestAgentInput{Context: identityContext}); err != nil {
		t.Fatalf("materialize configure test Agent: %v", err)
	}
	return svc, identityContext.GetLocalAgentRef(), identityContext.GetOwnerUserId()
}

func localAppConfigureContext(operation accountservice.LocalAppOperation, localAgentRef, accountID string) context.Context {
	return accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{
		LocalAppPrincipalID: "principal-configure", LocalAppRecordID: "record-configure",
		AppID: "third.party.configure", AccountID: accountID, LocalAgentID: localAgentRef,
		Operation: operation, OperationCapability: "agents.configure",
	})
}

func localAppSharedAIConfigContext(operation accountservice.LocalAppOperation, accountID string) context.Context {
	return localAppConfigureContext(operation, "", accountID)
}

func TestLocalAppSharedAIConfigGetMissingAndWholeOverwrite(t *testing.T) {
	svc, _, accountID := newLocalAppConfigureTestAgent(t)
	missing, err := svc.GetLocalAppSharedLocalAgentAIConfig(
		localAppSharedAIConfigContext(accountservice.LocalAppOperationSharedAIConfigGet, accountID),
		&runtimev1.GetLocalAppSharedLocalAgentAIConfigRequest{},
	)
	if err != nil {
		t.Fatalf("GetLocalAppSharedLocalAgentAIConfig: %v", err)
	}
	if missing.GetProjection().GetConfig().GetOwner().GetRuntimeLocalAgentSubsystem() == nil || len(missing.GetProjection().GetConfig().GetCapabilities()) != 0 {
		t.Fatalf("missing shared projection = %+v", missing.GetProjection())
	}
	written, err := svc.OverwriteLocalAppSharedLocalAgentAIConfig(
		localAppSharedAIConfigContext(accountservice.LocalAppOperationSharedAIConfigOverwrite, accountID),
		&runtimev1.OverwriteLocalAppSharedLocalAgentAIConfigRequest{Capabilities: []*runtimev1.AIConfigCapabilityIntent{
			sharedLocalIntent("text.generate"), sharedLocalIntent("audio.transcribe"),
		}},
	)
	if err != nil {
		t.Fatalf("OverwriteLocalAppSharedLocalAgentAIConfig: %v", err)
	}
	if len(written.GetProjection().GetConfig().GetCapabilities()) != 2 {
		t.Fatalf("overwritten projection = %+v", written.GetProjection())
	}
}

func TestLocalAppSharedAIProfilePreviewAndApplyUseAccountOwner(t *testing.T) {
	svc, _, accountID := newLocalAppConfigureTestAgent(t)
	preview, err := svc.PreviewLocalAppSharedLocalAgentAIProfile(
		localAppSharedAIConfigContext(accountservice.LocalAppOperationSharedAIProfilePreview, accountID),
		&runtimev1.PreviewLocalAppSharedLocalAgentAIProfileRequest{ProfileJson: portableAIProfileJSON()},
	)
	if err != nil {
		t.Fatalf("PreviewLocalAppSharedLocalAgentAIProfile: %v", err)
	}
	if preview.GetBefore() != nil || preview.GetAfter().GetConfig().GetOwner().GetRuntimeLocalAgentSubsystem() == nil {
		t.Fatalf("preview = %+v", preview)
	}
	if _, found, err := svc.readSharedLocalAgentAIConfig(context.Background(), accountID); err != nil || found {
		t.Fatalf("Local App preview persisted config: found=%v err=%v", found, err)
	}
	applied, err := svc.ApplyLocalAppSharedLocalAgentAIProfile(
		localAppSharedAIConfigContext(accountservice.LocalAppOperationSharedAIProfileApply, accountID),
		&runtimev1.ApplyLocalAppSharedLocalAgentAIProfileRequest{ProfileJson: portableAIProfileJSON()},
	)
	if err != nil || len(applied.GetProjection().GetConfig().GetCapabilities()) != 2 {
		t.Fatalf("ApplyLocalAppSharedLocalAgentAIProfile = (%+v, %v)", applied, err)
	}
}

func TestLocalAppConfigureHandlerDenialPreservesPermissionID(t *testing.T) {
	svc, _, _ := newLocalAppConfigureTestAgent(t)
	_, err := svc.GetLocalAppSharedLocalAgentAIConfig(context.Background(), &runtimev1.GetLocalAppSharedLocalAgentAIConfigRequest{})
	metadata, ok := grpcerr.ExtractReasonMetadata(err)
	if !ok || metadata["permission_id"] != "agents.configure" || metadata["permission_reason"] != "denied" {
		t.Fatalf("direct configure denial metadata = %#v, %v (err=%v)", metadata, ok, err)
	}
}

func TestLocalAppAutonomyUpdateIsAtomicCAS(t *testing.T) {
	svc, localAgentRef, accountID := newLocalAppConfigureTestAgent(t)
	snapshot, err := svc.GetLocalAppAgentAutonomySnapshot(
		localAppConfigureContext(accountservice.LocalAppOperationAutonomySnapshot, localAgentRef, accountID),
		&runtimev1.GetLocalAppAgentAutonomySnapshotRequest{AgentHandle: "lah_v1_opaque"},
	)
	if err != nil {
		t.Fatal(err)
	}
	revision := snapshot.GetProjection().GetAutonomyRevision()
	ctx := localAppConfigureContext(accountservice.LocalAppOperationUpdateAutonomy, localAgentRef, accountID)
	response, err := svc.UpdateLocalAppAgentAutonomy(ctx, &runtimev1.UpdateLocalAppAgentAutonomyRequest{
		AgentHandle: "lah_v1_opaque", ExpectedAutonomyRevision: revision,
		Intent: &runtimev1.LocalAppAgentAutonomyIntent{Enabled: proto.Bool(true), Config: &runtimev1.LocalAppAgentAutonomyConfig{
			Mode: runtimev1.LocalAppAgentAutonomyMode_LOCAL_APP_AGENT_AUTONOMY_MODE_LOW, DailyTokenBudget: 1000, MaxTokensPerHook: 100,
		}},
	})
	if err != nil || !response.GetProjection().GetEnabled() || response.GetProjection().GetAutonomyRevision() != revision+1 {
		t.Fatalf("autonomy CAS update = (%+v, %v)", response, err)
	}
	_, err = svc.UpdateLocalAppAgentAutonomy(ctx, &runtimev1.UpdateLocalAppAgentAutonomyRequest{
		AgentHandle: "lah_v1_opaque", ExpectedAutonomyRevision: revision,
		Intent: &runtimev1.LocalAppAgentAutonomyIntent{Enabled: proto.Bool(false)},
	})
	if status.Code(err) != codes.Aborted {
		t.Fatalf("stale autonomy update code = %s, err=%v", status.Code(err), err)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AGENT_AUTONOMY_REVISION_CONFLICT {
		t.Fatalf("stale autonomy reason = %s, %v", reason, ok)
	}
}

func TestLocalAppFirstPresentationCommitAcceptsInitialRevisionZeroAndRejectsStaleRevision(t *testing.T) {
	svc, localAgentRef, accountID := newLocalAppConfigureTestAgent(t)
	before, err := svc.GetLocalAppAgentPresentationSnapshot(
		localAppConfigureContext(accountservice.LocalAppOperationPresentationSnapshot, localAgentRef, accountID),
		&runtimev1.GetLocalAppAgentPresentationSnapshotRequest{AgentHandle: "lah_v1_opaque"},
	)
	if err != nil {
		t.Fatal(err)
	}
	if before.GetProjection().GetPresentationRevision() != 0 || before.GetProjection().GetProfile() != nil {
		t.Fatalf("fresh presentation projection = %+v, want revision zero without profile", before.GetProjection())
	}
	intent := &runtimev1.LocalAppAgentPresentationIntent{BackendKind: runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_VRM}
	commitCtx := localAppConfigureContext(accountservice.LocalAppOperationCommitPresentation, localAgentRef, accountID)
	committed, err := svc.CommitLocalAppAgentPresentation(commitCtx, &runtimev1.CommitLocalAppAgentPresentationRequest{
		AgentHandle: "lah_v1_opaque", ExpectedPresentationRevision: 0, Intent: intent,
		ImportedAssets: []*runtimev1.AgentPresentationAssetMaterial{testPresentationVRMMaterial()},
	})
	if err != nil || committed.GetProjection().GetPresentationRevision() != 1 {
		t.Fatalf("initial presentation commit = (%+v, %v)", committed, err)
	}
	_, err = svc.CommitLocalAppAgentPresentation(commitCtx, &runtimev1.CommitLocalAppAgentPresentationRequest{
		AgentHandle: "lah_v1_opaque", ExpectedPresentationRevision: 0, Intent: intent,
		ImportedAssets: []*runtimev1.AgentPresentationAssetMaterial{testPresentationVRMMaterial()},
	})
	if status.Code(err) != codes.Aborted {
		t.Fatalf("stale presentation commit code = %s, err=%v", status.Code(err), err)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AGENT_PRESENTATION_REVISION_CONFLICT {
		t.Fatalf("stale presentation reason = %s, %v", reason, ok)
	}
}

func TestLocalAppConfigureProtoTypesExposeNoRawIdentityFields(t *testing.T) {
	file := runtimev1.File_runtime_v1_agent_configure_proto
	forbidden := map[protoreflect.Name]bool{
		"owner_user_id": true, "runtime_source_ref": true, "local_agent_ref": true,
		"subject_user_id": true, "account_id": true, "principal_id": true, "session_id": true,
		"endpoint": true, "credential": true, "has_credential": true,
		"local_asset_id": true, "connector_id": true, "remote_model_catalog_id": true,
		"snapshot_id": true, "profile_binding_id": true, "readiness_ref": true,
		"render_evidence": true, "visible_pixel_evidence": true, "renderer_success": true, "render_failure": true,
	}
	var inspectMessages func(protoreflect.MessageDescriptors)
	inspectMessages = func(messages protoreflect.MessageDescriptors) {
		for index := 0; index < messages.Len(); index++ {
			message := messages.Get(index)
			for fieldIndex := 0; fieldIndex < message.Fields().Len(); fieldIndex++ {
				field := message.Fields().Get(fieldIndex)
				if forbidden[field.Name()] {
					t.Fatalf("local-app configure carrier %s exposes forbidden field %s", message.FullName(), field.Name())
				}
			}
			inspectMessages(message.Messages())
		}
	}
	inspectMessages(file.Messages())
}
