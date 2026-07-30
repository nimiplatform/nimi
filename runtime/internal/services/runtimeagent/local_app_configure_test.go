package runtimeagent

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aicapabilities"
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
	source := "local-app-configure-source"
	identityContext := testRuntimeAgentIdentityContext(source)
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

type localAppRouteOptionInventoryStub struct {
	assets []*runtimev1.LocalAssetRecord
}

func (s localAppRouteOptionInventoryStub) ListLocalAssets(
	_ context.Context,
	request *runtimev1.ListLocalAssetsRequest,
) (*runtimev1.ListLocalAssetsResponse, error) {
	assets := make([]*runtimev1.LocalAssetRecord, 0, len(s.assets))
	for _, asset := range s.assets {
		if asset != nil && asset.GetStatus() == request.GetStatusFilter() {
			assets = append(assets, proto.Clone(asset).(*runtimev1.LocalAssetRecord))
		}
	}
	return &runtimev1.ListLocalAssetsResponse{Assets: assets}, nil
}

func TestLocalAppConfigureHandlerDenialPreservesPermissionID(t *testing.T) {
	svc, _, _ := newLocalAppConfigureTestAgent(t)
	_, err := svc.GetLocalAppAgentConfigurationSnapshot(context.Background(), &runtimev1.GetLocalAppAgentConfigurationSnapshotRequest{AgentHandle: "lah_v1_opaque"})
	metadata, ok := grpcerr.ExtractReasonMetadata(err)
	if !ok || metadata["permission_id"] != "agents.configure" || metadata["permission_reason"] != "denied" {
		t.Fatalf("direct configure denial metadata = %#v, %v (err=%v)", metadata, ok, err)
	}
}

func TestLocalAppConfigurationSnapshotIsDedicatedTypedProjection(t *testing.T) {
	svc, localAgentRef, accountID := newLocalAppConfigureTestAgent(t)
	response, err := svc.GetLocalAppAgentConfigurationSnapshot(
		localAppConfigureContext(accountservice.LocalAppOperationConfigurationSnapshot, localAgentRef, accountID),
		&runtimev1.GetLocalAppAgentConfigurationSnapshotRequest{AgentHandle: "lah_v1_opaque"},
	)
	if err != nil {
		t.Fatal(err)
	}
	projection := response.GetProjection()
	if projection.GetConfigurationRevision() != 1 || len(projection.GetRouteIntents()) != 2 {
		t.Fatalf("model settings projection = %+v", projection)
	}
	catalog := aicapabilities.CanonicalCatalog()
	if len(projection.GetCapabilities()) != len(catalog) {
		t.Fatalf("capability projection = %v, want canonical catalog %v", projection.GetCapabilities(), catalog)
	}
	foundTranscribe := false
	for _, capability := range projection.GetCapabilities() {
		foundTranscribe = foundTranscribe || capability == aicapabilities.AudioTranscribe
	}
	if !foundTranscribe {
		t.Fatalf("canonical audio.transcribe missing from %v", projection.GetCapabilities())
	}
	if len(projection.GetRouteOptions()) != 2 {
		t.Fatalf("seeded selectable route options = %+v", projection.GetRouteOptions())
	}
}

func TestLocalAppConfigurationSnapshotProjectsOnlyBoundedSelectableRouteOptions(t *testing.T) {
	svc, localAgentRef, accountID := newLocalAppConfigureTestAgent(t)
	svc.SetLocalAppRouteOptionInventory(localAppRouteOptionInventoryStub{assets: []*runtimev1.LocalAssetRecord{
		{
			LocalAssetId:   "private-local-asset-id",
			AssetId:        "private-asset-id",
			LogicalModelId: "local.chat.gemma-test",
			DisplayName:    "Gemma Test",
			Endpoint:       "http://127.0.0.1:9999/private",
			Status:         runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
			Capabilities:   []string{aicapabilities.TextGenerate},
		},
		{
			LogicalModelId: "local.embed.test",
			DisplayName:    "Embedding Test",
			Status:         runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
			Capabilities:   []string{aicapabilities.TextEmbed},
		},
		{
			LogicalModelId: "local.unhealthy",
			Status:         runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY,
			Capabilities:   []string{aicapabilities.TextGenerate},
		},
	}})
	response, err := svc.GetLocalAppAgentConfigurationSnapshot(
		localAppConfigureContext(accountservice.LocalAppOperationConfigurationSnapshot, localAgentRef, accountID),
		&runtimev1.GetLocalAppAgentConfigurationSnapshotRequest{AgentHandle: "lah_v1_opaque"},
	)
	if err != nil {
		t.Fatal(err)
	}
	options := response.GetProjection().GetRouteOptions()
	if len(options) != 4 {
		t.Fatalf("bounded route options = %+v", options)
	}
	var foundActive, foundInstalled bool
	for _, option := range options {
		if option.GetProvider() != "" || option.GetRoutePolicy() != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL {
			t.Fatalf("local option exposed non-local route material: %+v", option)
		}
		switch option.GetModel() {
		case "local.chat.gemma-test":
			foundActive = option.GetLabel() == "Gemma Test" &&
				option.GetAvailability() == runtimev1.LocalAppAgentRouteOptionAvailability_LOCAL_APP_AGENT_ROUTE_OPTION_AVAILABILITY_READY
		case "local.embed.test":
			foundInstalled = option.GetLabel() == "Embedding Test" &&
				option.GetAvailability() == runtimev1.LocalAppAgentRouteOptionAvailability_LOCAL_APP_AGENT_ROUTE_OPTION_AVAILABILITY_INSTALLED
		case "local.unhealthy", "private-local-asset-id", "private-asset-id", "http://127.0.0.1:9999/private":
			t.Fatalf("private or unselectable inventory material escaped: %+v", option)
		}
	}
	if !foundActive || !foundInstalled {
		t.Fatalf("selectable inventory candidates missing: %+v", options)
	}
}

func TestLocalAppConfigurationUpdateReturnsTypedCASConflict(t *testing.T) {
	svc, localAgentRef, accountID := newLocalAppConfigureTestAgent(t)
	ctx := localAppConfigureContext(accountservice.LocalAppOperationUpdateConfiguration, localAgentRef, accountID)
	intents := []*runtimev1.LocalAppAgentRouteIntent{
		{Capability: aicapabilities.TextGenerate, Model: "local/new-text", RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL},
		{Capability: aicapabilities.TextEmbed, Model: "local/new-embed", RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL},
		{Capability: aicapabilities.AudioTranscribe, Model: "local/new-stt", RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL},
	}
	response, err := svc.UpdateLocalAppAgentConfiguration(ctx, &runtimev1.UpdateLocalAppAgentConfigurationRequest{
		AgentHandle: "lah_v1_opaque", ExpectedConfigurationRevision: 1, RouteIntents: intents,
	})
	if err != nil || response.GetProjection().GetConfigurationRevision() != 2 {
		t.Fatalf("configuration update = (%+v, %v)", response, err)
	}
	_, err = svc.UpdateLocalAppAgentConfiguration(ctx, &runtimev1.UpdateLocalAppAgentConfigurationRequest{
		AgentHandle: "lah_v1_opaque", ExpectedConfigurationRevision: 1, RouteIntents: intents,
	})
	if status.Code(err) != codes.Aborted {
		t.Fatalf("stale config update code = %s, err=%v", status.Code(err), err)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AGENT_AI_CONFIG_REVISION_CONFLICT {
		t.Fatalf("stale config reason = %s, %v", reason, ok)
	}
}

func TestLocalAppConfigurationRejectsUnsupportedCanonicalRouteWithoutMutation(t *testing.T) {
	svc, localAgentRef, accountID := newLocalAppConfigureTestAgent(t)
	_, err := svc.UpdateLocalAppAgentConfiguration(
		localAppConfigureContext(accountservice.LocalAppOperationUpdateConfiguration, localAgentRef, accountID),
		&runtimev1.UpdateLocalAppAgentConfigurationRequest{
			AgentHandle: "lah_v1_opaque", ExpectedConfigurationRevision: 1,
			RouteIntents: []*runtimev1.LocalAppAgentRouteIntent{{Capability: aicapabilities.ImageEdit, Model: "local/editor", RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL}},
		},
	)
	if status.Code(err) != codes.Unimplemented {
		t.Fatalf("unsupported typed route code = %s, err=%v", status.Code(err), err)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE {
		t.Fatalf("unsupported typed route reason = %s, %v", reason, ok)
	}
	config, err := svc.committedRuntimeAgentAIConfigByAgentInstanceID(localAgentRef)
	if err != nil || config.GetRevision() != 1 {
		t.Fatalf("unsupported route mutated config = (%+v, %v)", config, err)
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
	intent := &runtimev1.LocalAppAgentPresentationIntent{
		BackendKind: runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_VRM,
	}
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
