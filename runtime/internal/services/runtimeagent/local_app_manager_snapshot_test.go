package runtimeagent

import (
	"context"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aiconfig"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
)

func TestCanonicalLocalAppManagerSnapshotIsBoundedAndConversationScoped(t *testing.T) {
	const (
		accountID      = "account-manager-test"
		localAgentRef  = "local-agent:manager-test"
		runtimeSource  = "realm-character:manager-test"
		conversationID = "agent_anchor_manager_test"
	)
	requestDescriptor := (&runtimev1.GetLocalAppAgentManagerSnapshotRequest{}).ProtoReflect().Descriptor()
	if requestDescriptor.Fields().Len() != 2 || requestDescriptor.Fields().ByName("agent_handle") == nil ||
		requestDescriptor.Fields().ByName("conversation_anchor_id") == nil {
		t.Fatalf("manager snapshot request shape = %v", requestDescriptor.Fields())
	}
	for _, forbidden := range []protoreflect.Name{
		"agent_id", "local_agent_ref", "owner_user_id", "runtime_source_ref", "account_id", "subject_user_id", "context",
	} {
		if requestDescriptor.Fields().ByName(forbidden) != nil {
			t.Fatalf("manager snapshot request exposes %q", forbidden)
		}
	}
	contextSummary := managerSnapshotTestContext(localAgentRef, conversationID)
	svc := &Service{
		aiConfigStore: aiconfig.NewMemoryStore(),
		agents: map[string]*agentEntry{localAgentRef: {
			Agent: &runtimev1.LocalAgentRecord{
				LocalAgentRef: localAgentRef, OwnerUserId: accountID, RuntimeSourceRef: runtimeSource,
				LifecycleStatus: runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE,
				Autonomy: &runtimev1.AgentAutonomyState{
					Revision: 1,
					Config:   &runtimev1.AgentAutonomyConfig{Mode: runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_LOW},
				},
				SourceContextStatus: &runtimev1.LocalAgentSourceContextStatus{
					Ready: true, State: runtimev1.AgentLocalSourceContextState_AGENT_LOCAL_SOURCE_CONTEXT_STATE_READY,
					ReasonCode:    runtimev1.AgentContextProjectionReasonCode_AGENT_CONTEXT_PROJECTION_REASON_CODE_NONE,
					LorebookReady: true, LorebookItemCount: 3, LorebookEstimatedTokens: 144,
				},
			},
			State: &runtimev1.AgentStateProjection{
				ExecutionState: runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_IDLE,
				StatusText:     "steady and present", CurrentEmotion: "happy",
			},
		}},
		chatAnchors: map[string]*publicChatAnchorState{conversationID: {
			ConversationAnchorID: conversationID, AgentID: localAgentRef, LocalAgentRef: localAgentRef,
			OwnerUserID: accountID, SubjectUserID: accountID, RuntimeSourceRef: runtimeSource,
			Status:           runtimev1.ConversationAnchorStatus_CONVERSATION_ANCHOR_STATUS_ACTIVE,
			LastTurnSnapshot: &publicChatTurnProjectionState{TurnID: "PRIVATE-TURN-ID", ContextSummary: contextSummary},
		}},
	}
	decision := managerSnapshotTestDecision(accountID, 0x41)
	handle := mintLocalAppAgentHandle(decision, localAgentRef)
	ctx := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision)
	response, err := svc.GetLocalAppAgentManagerSnapshot(ctx, &runtimev1.GetLocalAppAgentManagerSnapshotRequest{
		AgentHandle: handle, ConversationAnchorId: proto.String(conversationID),
	})
	if err != nil {
		t.Fatal(err)
	}
	snapshot := response.GetSnapshot()
	if snapshot.GetLifecycleStatus() != runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE ||
		snapshot.GetExecutionState() != runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_IDLE ||
		snapshot.GetStatusText() != "steady and present" || snapshot.GetCurrentEmotion() != "happy" ||
		!snapshot.GetSource().GetReady() || !snapshot.GetContext().GetReady() ||
		snapshot.GetContext().GetUsedTokens() != 1024 || snapshot.GetContext().GetMemoryItemCount() != 3 {
		t.Fatalf("manager snapshot = %+v", snapshot)
	}
	if len(snapshot.GetActionAvailability()) != 11 {
		t.Fatalf("manager action availability count = %d", len(snapshot.GetActionAvailability()))
	}
	availabilityDescriptor := (&runtimev1.LocalAppAgentManagerActionAvailability{}).ProtoReflect().Descriptor()
	if availabilityDescriptor.Fields().Len() != 3 || availabilityDescriptor.Fields().ByName("action") == nil ||
		availabilityDescriptor.Fields().ByName("state") == nil || availabilityDescriptor.Fields().ByName("reason") == nil {
		t.Fatalf("manager action availability shape = %v", availabilityDescriptor.Fields())
	}
	for _, forbidden := range []protoreflect.Name{
		"app_operation_id", "operation_id", "effective_app_access_snapshot", "coverage", "account_id",
		"local_agent_ref", "owner_user_id", "runtime_source_ref",
	} {
		if availabilityDescriptor.Fields().ByName(forbidden) != nil {
			t.Fatalf("manager action availability exposes %q", forbidden)
		}
	}
	assertManagerActionAvailability(t, snapshot,
		runtimev1.LocalAppAgentManagerProductAction_LOCAL_APP_AGENT_MANAGER_PRODUCT_ACTION_SHARED_AI_CONFIG_READ,
		runtimev1.LocalAppAgentManagerActionAvailabilityState_LOCAL_APP_AGENT_MANAGER_ACTION_AVAILABILITY_STATE_AVAILABLE,
		runtimev1.LocalAppAgentManagerActionUnavailableReason_LOCAL_APP_AGENT_MANAGER_ACTION_UNAVAILABLE_REASON_NONE,
	)
	assertManagerActionAvailability(t, snapshot,
		runtimev1.LocalAppAgentManagerProductAction_LOCAL_APP_AGENT_MANAGER_PRODUCT_ACTION_AUTONOMY_WRITE,
		runtimev1.LocalAppAgentManagerActionAvailabilityState_LOCAL_APP_AGENT_MANAGER_ACTION_AVAILABILITY_STATE_AVAILABLE,
		runtimev1.LocalAppAgentManagerActionUnavailableReason_LOCAL_APP_AGENT_MANAGER_ACTION_UNAVAILABLE_REASON_NONE,
	)
	for _, action := range []runtimev1.LocalAppAgentManagerProductAction{
		runtimev1.LocalAppAgentManagerProductAction_LOCAL_APP_AGENT_MANAGER_PRODUCT_ACTION_MEMORY_INSPECT,
		runtimev1.LocalAppAgentManagerProductAction_LOCAL_APP_AGENT_MANAGER_PRODUCT_ACTION_MEMORY_CORRECT,
		runtimev1.LocalAppAgentManagerProductAction_LOCAL_APP_AGENT_MANAGER_PRODUCT_ACTION_MEMORY_FORGET,
		runtimev1.LocalAppAgentManagerProductAction_LOCAL_APP_AGENT_MANAGER_PRODUCT_ACTION_MEMORY_SWITCH,
		runtimev1.LocalAppAgentManagerProductAction_LOCAL_APP_AGENT_MANAGER_PRODUCT_ACTION_MEMORY_DELETE,
	} {
		assertManagerActionAvailability(t, snapshot, action,
			runtimev1.LocalAppAgentManagerActionAvailabilityState_LOCAL_APP_AGENT_MANAGER_ACTION_AVAILABILITY_STATE_UNAVAILABLE,
			runtimev1.LocalAppAgentManagerActionUnavailableReason_LOCAL_APP_AGENT_MANAGER_ACTION_UNAVAILABLE_REASON_OWNER_UNAVAILABLE,
		)
	}
	assertManagerActionAvailability(t, snapshot,
		runtimev1.LocalAppAgentManagerProductAction_LOCAL_APP_AGENT_MANAGER_PRODUCT_ACTION_APPEARANCE_COMMIT,
		runtimev1.LocalAppAgentManagerActionAvailabilityState_LOCAL_APP_AGENT_MANAGER_ACTION_AVAILABILITY_STATE_AVAILABLE,
		runtimev1.LocalAppAgentManagerActionUnavailableReason_LOCAL_APP_AGENT_MANAGER_ACTION_UNAVAILABLE_REASON_NONE,
	)
	assertManagerActionAvailability(t, snapshot,
		runtimev1.LocalAppAgentManagerProductAction_LOCAL_APP_AGENT_MANAGER_PRODUCT_ACTION_APPEARANCE_RESTORE,
		runtimev1.LocalAppAgentManagerActionAvailabilityState_LOCAL_APP_AGENT_MANAGER_ACTION_AVAILABILITY_STATE_UNAVAILABLE,
		runtimev1.LocalAppAgentManagerActionUnavailableReason_LOCAL_APP_AGENT_MANAGER_ACTION_UNAVAILABLE_REASON_PREVIOUS_PRESENTATION_UNAVAILABLE,
	)
	raw, err := protojson.Marshal(response)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{
		"PRIVATE-MANIFEST-HASH", "PRIVATE-CONTEXT-HASH", "PRIVATE-PROMPT-HASH", "PRIVATE-ROUTE-DIGEST",
		"PRIVATE-CATALOG-DIGEST", "PRIVATE-TURN-ID", localAgentRef, accountID, runtimeSource,
		"manifestInstanceHash", "contextContentHash", "promptHash", "reservedReasoningTokens", "generation", "revision",
	} {
		if strings.Contains(string(raw), forbidden) {
			t.Fatalf("manager snapshot leaked %q: %s", forbidden, raw)
		}
	}

	withoutConversation, err := svc.GetLocalAppAgentManagerSnapshot(ctx, &runtimev1.GetLocalAppAgentManagerSnapshotRequest{AgentHandle: handle})
	if err != nil || withoutConversation.GetSnapshot().GetContext() != nil {
		t.Fatalf("snapshot without Conversation = (%+v, %v)", withoutConversation, err)
	}
	svc.chatAnchors["agent_anchor_foreign"] = &publicChatAnchorState{
		ConversationAnchorID: "agent_anchor_foreign", AgentID: "local-agent:other", LocalAgentRef: "local-agent:other",
		OwnerUserID: accountID, SubjectUserID: accountID, RuntimeSourceRef: "realm-character:other",
		Status: runtimev1.ConversationAnchorStatus_CONVERSATION_ANCHOR_STATUS_ACTIVE,
	}
	if _, err := svc.GetLocalAppAgentManagerSnapshot(ctx, &runtimev1.GetLocalAppAgentManagerSnapshotRequest{
		AgentHandle: handle, ConversationAnchorId: proto.String("agent_anchor_foreign"),
	}); status.Code(err) != codes.NotFound {
		t.Fatalf("cross-Agent Conversation code = %s, err=%v", status.Code(err), err)
	}
	staleHandle := mintLocalAppAgentHandle(managerSnapshotTestDecision(accountID, 0x51), localAgentRef)
	if _, err := svc.GetLocalAppAgentManagerSnapshot(ctx, &runtimev1.GetLocalAppAgentManagerSnapshotRequest{AgentHandle: staleHandle}); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("stale handle code = %s, err=%v", status.Code(err), err)
	}
}

func TestLocalAppManagerActionAvailabilityUsesOwnerState(t *testing.T) {
	ready := projectLocalAppAgentManagerActionAvailability(localAppManagerActionOwnerState{
		agentConfigureCovered:     true,
		sharedAIConfigReady:       true,
		autonomyReady:             true,
		memoryOwnerReady:          true,
		memoryEnabled:             true,
		presentationReady:         true,
		previousPresentationReady: true,
	})
	if len(ready) != 11 {
		t.Fatalf("ready action count = %d", len(ready))
	}
	for _, item := range ready {
		if item.GetState() != runtimev1.LocalAppAgentManagerActionAvailabilityState_LOCAL_APP_AGENT_MANAGER_ACTION_AVAILABILITY_STATE_AVAILABLE ||
			item.GetReason() != runtimev1.LocalAppAgentManagerActionUnavailableReason_LOCAL_APP_AGENT_MANAGER_ACTION_UNAVAILABLE_REASON_NONE {
			t.Fatalf("ready action = %+v", item)
		}
	}

	disabled := projectLocalAppAgentManagerActionAvailability(localAppManagerActionOwnerState{
		agentConfigureCovered: true, sharedAIConfigReady: true, autonomyReady: true,
		memoryOwnerReady: true, presentationReady: true,
	})
	assertManagerActionAvailabilityFromItems(t, disabled,
		runtimev1.LocalAppAgentManagerProductAction_LOCAL_APP_AGENT_MANAGER_PRODUCT_ACTION_MEMORY_CORRECT,
		runtimev1.LocalAppAgentManagerActionAvailabilityState_LOCAL_APP_AGENT_MANAGER_ACTION_AVAILABILITY_STATE_UNAVAILABLE,
		runtimev1.LocalAppAgentManagerActionUnavailableReason_LOCAL_APP_AGENT_MANAGER_ACTION_UNAVAILABLE_REASON_MEMORY_DISABLED,
	)
	assertManagerActionAvailabilityFromItems(t, disabled,
		runtimev1.LocalAppAgentManagerProductAction_LOCAL_APP_AGENT_MANAGER_PRODUCT_ACTION_MEMORY_FORGET,
		runtimev1.LocalAppAgentManagerActionAvailabilityState_LOCAL_APP_AGENT_MANAGER_ACTION_AVAILABILITY_STATE_AVAILABLE,
		runtimev1.LocalAppAgentManagerActionUnavailableReason_LOCAL_APP_AGENT_MANAGER_ACTION_UNAVAILABLE_REASON_NONE,
	)

	adoption := projectLocalAppAgentManagerActionAvailability(localAppManagerActionOwnerState{
		agentConfigureCovered: true, sharedAIConfigReady: true, autonomyReady: true,
		memoryOwnerReady: true, memoryEnabled: true, memoryAdoptionRequired: true, presentationReady: true,
	})
	assertManagerActionAvailabilityFromItems(t, adoption,
		runtimev1.LocalAppAgentManagerProductAction_LOCAL_APP_AGENT_MANAGER_PRODUCT_ACTION_MEMORY_CORRECT,
		runtimev1.LocalAppAgentManagerActionAvailabilityState_LOCAL_APP_AGENT_MANAGER_ACTION_AVAILABILITY_STATE_UNAVAILABLE,
		runtimev1.LocalAppAgentManagerActionUnavailableReason_LOCAL_APP_AGENT_MANAGER_ACTION_UNAVAILABLE_REASON_MEMORY_ADOPTION_REQUIRED,
	)

	noCoverage := projectLocalAppAgentManagerActionAvailability(localAppManagerActionOwnerState{})
	for _, item := range noCoverage {
		if item.GetState() != runtimev1.LocalAppAgentManagerActionAvailabilityState_LOCAL_APP_AGENT_MANAGER_ACTION_AVAILABILITY_STATE_UNAVAILABLE ||
			item.GetReason() != runtimev1.LocalAppAgentManagerActionUnavailableReason_LOCAL_APP_AGENT_MANAGER_ACTION_UNAVAILABLE_REASON_OPERATION_UNAVAILABLE {
			t.Fatalf("uncovered action = %+v", item)
		}
	}
}

func assertManagerActionAvailability(
	t *testing.T,
	snapshot *runtimev1.LocalAppAgentManagerSnapshot,
	action runtimev1.LocalAppAgentManagerProductAction,
	state runtimev1.LocalAppAgentManagerActionAvailabilityState,
	reason runtimev1.LocalAppAgentManagerActionUnavailableReason,
) {
	t.Helper()
	assertManagerActionAvailabilityFromItems(t, snapshot.GetActionAvailability(), action, state, reason)
}

func assertManagerActionAvailabilityFromItems(
	t *testing.T,
	items []*runtimev1.LocalAppAgentManagerActionAvailability,
	action runtimev1.LocalAppAgentManagerProductAction,
	state runtimev1.LocalAppAgentManagerActionAvailabilityState,
	reason runtimev1.LocalAppAgentManagerActionUnavailableReason,
) {
	t.Helper()
	matches := 0
	for _, item := range items {
		if item.GetAction() != action {
			continue
		}
		matches++
		if item.GetState() != state || item.GetReason() != reason {
			t.Fatalf("action %s = %+v, want state=%s reason=%s", action, item, state, reason)
		}
	}
	if matches != 1 {
		t.Fatalf("action %s matches = %d", action, matches)
	}
}

func managerSnapshotTestDecision(accountID string, seed byte) accountservice.LocalAppCallerDecision {
	decision := accountservice.LocalAppCallerDecision{
		AppID: "nimi.test.manager", AccountID: accountID,
		Operation: accountservice.LocalAppOperationManagerSnapshot, AuthorityClass: localappop.AuthorityClassAppAccess,
		OperationCapability: "agent.configure", RegisteredAppSubject: "manager-test-subject",
	}
	for index := range decision.SessionID {
		decision.SessionID[index] = seed + byte(index)
	}
	return decision
}

func managerSnapshotTestContext(localAgentRef, conversationID string) *runtimev1.AgentTurnContextSummary {
	summary := &runtimev1.AgentTurnContextSummary{
		SchemaVersion: runtimev1.AgentTurnContextSummarySchemaVersion_AGENT_TURN_CONTEXT_SUMMARY_SCHEMA_VERSION_V2,
		Ready:         true, State: runtimev1.AgentTurnContextState_AGENT_TURN_CONTEXT_STATE_READY,
		ReasonCode:           runtimev1.AgentContextProjectionReasonCode_AGENT_CONTEXT_PROJECTION_REASON_CODE_NONE,
		ManifestInstanceHash: "PRIVATE-MANIFEST-HASH", ContextContentHash: "PRIVATE-CONTEXT-HASH",
		PromptHash: "PRIVATE-PROMPT-HASH", RouteDigest: "PRIVATE-ROUTE-DIGEST", CatalogRevisionDigest: "PRIVATE-CATALOG-DIGEST",
		LocalAgentRef: localAgentRef, ConversationAnchorId: conversationID, TurnId: "PRIVATE-TURN-ID",
		Budget: &runtimev1.AgentTurnContextBudgetSummary{
			InputBudgetTokens: 4096, UsedTokens: 1024, RequiredInputTokens: 1200, RequiredContextWindowTokens: 1600,
			ReservedReasoningTokens: 333,
		},
		Truncation:          []*runtimev1.AgentTurnContextTruncationSummary{{Reason: runtimev1.AgentTurnContextTruncationReason_AGENT_TURN_CONTEXT_TRUNCATION_REASON_NONE}},
		TranscriptTurnCount: 4, MemoryItemCount: 3, MediaCount: 2, ToolCount: 1, PrivateRecallCount: 2,
		SourceCognition: &runtimev1.AgentSourceCognitionSummary{
			AdapterStatus:   runtimev1.AgentSourceCognitionStatus_AGENT_SOURCE_COGNITION_STATUS_READY,
			SelectionStatus: runtimev1.AgentSourceCognitionStatus_AGENT_SOURCE_COGNITION_STATUS_NO_HITS, Generation: 91,
		},
		ConversationSummary: &runtimev1.AgentConversationContextSummary{
			Status: runtimev1.AgentConversationSummaryStatus_AGENT_CONVERSATION_SUMMARY_STATUS_READY, Revision: 72,
		},
	}
	for _, laneID := range agentTurnContextFixedLaneOrder {
		summary.Lanes = append(summary.Lanes, &runtimev1.AgentTurnContextLaneSummary{
			LaneId: agentTurnContextProtoLaneID(laneID), State: runtimev1.AgentTurnContextLaneState_AGENT_TURN_CONTEXT_LANE_STATE_EMPTY,
		})
	}
	return summary
}
