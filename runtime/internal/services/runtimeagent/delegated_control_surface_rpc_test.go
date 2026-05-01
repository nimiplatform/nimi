package runtimeagent

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/durationpb"
)

func TestDelegatedProviderProfilesAreRuntimeOwned(t *testing.T) {
	svc := testDelegatedControlSurfaceService()
	ctx := testDelegatedControlContext()

	upserted, err := svc.UpsertDelegatedProviderProfile(context.Background(), &runtimev1.UpsertDelegatedProviderProfileRequest{
		Context: ctx,
		AgentId: "agent-1",
		ProviderProfile: &runtimev1.DelegatedProviderProfile{
			ProviderProfileId: "calendar-mcp",
			DisplayName:       "Calendar MCP",
			ProviderKind:      runtimev1.DelegatedProviderKind_DELEGATED_PROVIDER_KIND_MCP_TOOL_PROVIDER,
			TransportKind:     runtimev1.DelegatedTransportKind_DELEGATED_TRANSPORT_KIND_STDIO_COMMAND,
			AllowedTools: []*runtimev1.DelegatedToolAllowlistEntry{{
				ToolName:          "calendar_lookup",
				InputSchemaDigest: "sha256:calendar",
			}},
			CredentialRef: "connector://calendar/oauth",
			Timeout:       durationpb.New(5_000_000_000),
			TransportRef:  "runtime-transport://calendar-mcp",
		},
	})
	if err != nil {
		t.Fatalf("upsert delegated provider profile: %v", err)
	}
	if upserted.GetProviderProfile().GetState() != runtimev1.DelegatedProviderState_DELEGATED_PROVIDER_STATE_ACTIVE {
		t.Fatalf("expected active default state, got %+v", upserted.GetProviderProfile())
	}

	listed, err := svc.ListDelegatedProviderProfiles(context.Background(), &runtimev1.ListDelegatedProviderProfilesRequest{
		Context: ctx,
		AgentId: "agent-1",
	})
	if err != nil {
		t.Fatalf("list delegated provider profiles: %v", err)
	}
	if len(listed.GetProviderProfiles()) != 1 || listed.GetProviderProfiles()[0].GetCredentialRef() != "connector://calendar/oauth" {
		t.Fatalf("provider profile list mismatch: %+v", listed.GetProviderProfiles())
	}

	disabled, err := svc.SetDelegatedProviderState(context.Background(), &runtimev1.SetDelegatedProviderStateRequest{
		Context:           ctx,
		AgentId:           "agent-1",
		ProviderProfileId: "calendar-mcp",
		State:             runtimev1.DelegatedProviderState_DELEGATED_PROVIDER_STATE_DISABLED,
	})
	if err != nil {
		t.Fatalf("disable delegated provider profile: %v", err)
	}
	if disabled.GetProviderProfile().GetState() != runtimev1.DelegatedProviderState_DELEGATED_PROVIDER_STATE_DISABLED {
		t.Fatalf("expected disabled provider profile, got %+v", disabled.GetProviderProfile())
	}
}

func TestDelegatedProviderProfileRejectsRawCredentialMaterial(t *testing.T) {
	svc := testDelegatedControlSurfaceService()
	_, err := svc.UpsertDelegatedProviderProfile(context.Background(), &runtimev1.UpsertDelegatedProviderProfileRequest{
		Context: testDelegatedControlContext(),
		AgentId: "agent-1",
		ProviderProfile: &runtimev1.DelegatedProviderProfile{
			ProviderProfileId: "calendar-mcp",
			DisplayName:       "Calendar MCP",
			ProviderKind:      runtimev1.DelegatedProviderKind_DELEGATED_PROVIDER_KIND_MCP_TOOL_PROVIDER,
			TransportKind:     runtimev1.DelegatedTransportKind_DELEGATED_TRANSPORT_KIND_STDIO_COMMAND,
			AllowedTools:      []*runtimev1.DelegatedToolAllowlistEntry{{ToolName: "calendar_lookup"}},
			CredentialRef:     "connector://calendar?token=secret",
			TransportRef:      "runtime-transport://calendar-mcp",
		},
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected raw credential material rejection, got %v", err)
	}
}

func TestDelegatedApprovalAndDiagnosticsSurfaceRuntimeDecisions(t *testing.T) {
	svc := testDelegatedControlSurfaceService()
	ctx := testDelegatedControlContext()
	svc.recordDelegatedCapabilityDecision(&runtimeAgentDelegatedCapabilityDecision{
		DecisionID:           "deleg-decision-1",
		AgentID:              "agent-1",
		DelegationRequestID:  "deleg-request-1",
		DelegationResultID:   "deleg-result-1",
		ConversationAnchorID: "anchor-1",
		TurnID:               "turn-1",
		ProviderID:           "calendar-mcp",
		CapabilityID:         "calendar.read",
		ToolName:             "calendar_lookup",
		GatewayEvidenceID:    "evidence-1",
		FirewallInputID:      "fw-1",
		FirewallVerdict:      "approval_required",
		ReasonCode:           "requires_human_approval",
		RuntimeDecision:      "approval_required",
	})

	approvals, err := svc.ListDelegatedApprovalRequests(context.Background(), &runtimev1.ListDelegatedApprovalRequestsRequest{
		Context:              ctx,
		AgentId:              "agent-1",
		ConversationAnchorId: "anchor-1",
	})
	if err != nil {
		t.Fatalf("list delegated approvals: %v", err)
	}
	if len(approvals.GetApprovalRequests()) != 1 {
		t.Fatalf("expected one approval request, got %+v", approvals.GetApprovalRequests())
	}

	approved, err := svc.SubmitDelegatedApprovalDecision(context.Background(), &runtimev1.SubmitDelegatedApprovalDecisionRequest{
		Context:           ctx,
		AgentId:           "agent-1",
		ApprovalRequestId: "deleg-decision-1",
		Decision:          runtimev1.DelegatedApprovalDecision_DELEGATED_APPROVAL_DECISION_APPROVE,
		DecisionReason:    "user confirmed",
	})
	if err != nil {
		t.Fatalf("submit delegated approval: %v", err)
	}
	if approved.GetApprovalRequest().GetState() != runtimev1.DelegatedApprovalRequestState_DELEGATED_APPROVAL_REQUEST_STATE_APPROVED {
		t.Fatalf("expected approved request, got %+v", approved.GetApprovalRequest())
	}

	snapshot, err := svc.GetDelegatedControlSurfaceSnapshot(context.Background(), &runtimev1.GetDelegatedControlSurfaceSnapshotRequest{
		Context:              ctx,
		AgentId:              "agent-1",
		ConversationAnchorId: "anchor-1",
	})
	if err != nil {
		t.Fatalf("get delegated control snapshot: %v", err)
	}
	if len(snapshot.GetSnapshot().GetApprovalRequests()) != 1 || len(snapshot.GetSnapshot().GetDiagnostics()) != 1 {
		t.Fatalf("snapshot missing approval or diagnostic evidence: %+v", snapshot.GetSnapshot())
	}
	if snapshot.GetSnapshot().GetDiagnostics()[0].GetGatewayEvidenceId() != "evidence-1" {
		t.Fatalf("diagnostic did not preserve gateway evidence linkage: %+v", snapshot.GetSnapshot().GetDiagnostics()[0])
	}
}

func TestDelegatedReplayTraceReconstructsRuntimeOwnedLineage(t *testing.T) {
	svc := testDelegatedControlSurfaceService()
	ctx := testDelegatedControlContext()
	svc.recordDelegatedCapabilityDecision(&runtimeAgentDelegatedCapabilityDecision{
		DecisionID:           "deleg-decision-1",
		AgentID:              "agent-1",
		DelegationRequestID:  "deleg-request-1",
		DelegationResultID:   "deleg-result-1",
		ConversationAnchorID: "anchor-1",
		TurnID:               "turn-1",
		ProviderID:           "calendar-mcp",
		CapabilityID:         "calendar.read",
		ToolName:             "calendar_lookup",
		GatewayEvidenceID:    "evidence-1",
		FirewallInputID:      "fw-1",
		FirewallVerdict:      "ACCEPTED_OBSERVATION",
		ReasonCode:           "DELEG_ACCEPTED",
		RuntimeDecision:      "context_candidate",
	})

	replay, err := svc.GetDelegatedReplayTrace(context.Background(), &runtimev1.GetDelegatedReplayTraceRequest{
		Context:    ctx,
		AgentId:    "agent-1",
		DecisionId: "deleg-decision-1",
	})
	if err != nil {
		t.Fatalf("get delegated replay trace: %v", err)
	}
	trace := replay.GetTrace()
	if trace.GetOutcome() != runtimev1.DelegatedReplayOutcome_DELEGATED_REPLAY_OUTCOME_RECONSTRUCTED {
		t.Fatalf("expected reconstructed replay, got %+v", trace)
	}
	if !trace.GetRedacted() || len(trace.GetStages()) != 5 {
		t.Fatalf("expected redacted five-stage replay trace, got %+v", trace)
	}
	if trace.GetStages()[1].GetStageId() != "evidence-1" || trace.GetStages()[1].GetRedactedSummary() == "" {
		t.Fatalf("expected redacted gateway evidence stage, got %+v", trace.GetStages()[1])
	}
}

func TestDelegatedReplayTraceFailsClosedOnMissingJoinKeys(t *testing.T) {
	svc := testDelegatedControlSurfaceService()
	svc.recordDelegatedCapabilityDecision(&runtimeAgentDelegatedCapabilityDecision{
		DecisionID:           "deleg-decision-1",
		AgentID:              "agent-1",
		ConversationAnchorID: "anchor-1",
		TurnID:               "turn-1",
		ProviderID:           "calendar-mcp",
		CapabilityID:         "calendar.read",
		ToolName:             "calendar_lookup",
		GatewayEvidenceID:    "evidence-1",
		FirewallInputID:      "fw-1",
		FirewallVerdict:      "ACCEPTED_OBSERVATION",
		RuntimeDecision:      "context_candidate",
	})

	_, err := svc.GetDelegatedReplayTrace(context.Background(), &runtimev1.GetDelegatedReplayTraceRequest{
		Context:    testDelegatedControlContext(),
		AgentId:    "agent-1",
		DecisionId: "deleg-decision-1",
	})
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected invalid lineage failure, got %v", err)
	}
}

func TestDelegatedReplayTraceIncludesApprovalState(t *testing.T) {
	svc := testDelegatedControlSurfaceService()
	svc.recordDelegatedCapabilityDecision(&runtimeAgentDelegatedCapabilityDecision{
		DecisionID:           "deleg-decision-1",
		AgentID:              "agent-1",
		DelegationRequestID:  "deleg-request-1",
		DelegationResultID:   "deleg-result-1",
		ConversationAnchorID: "anchor-1",
		TurnID:               "turn-1",
		ProviderID:           "calendar-mcp",
		CapabilityID:         "calendar.read",
		ToolName:             "calendar_lookup",
		GatewayEvidenceID:    "evidence-1",
		FirewallInputID:      "fw-1",
		FirewallVerdict:      "APPROVAL_REQUIRED",
		ReasonCode:           "DELEG_APPROVAL_REQUIRED",
		RuntimeDecision:      "approval_required",
	})

	replay, err := svc.GetDelegatedReplayTrace(context.Background(), &runtimev1.GetDelegatedReplayTraceRequest{
		Context:    testDelegatedControlContext(),
		AgentId:    "agent-1",
		DecisionId: "deleg-decision-1",
	})
	if err != nil {
		t.Fatalf("get delegated approval replay trace: %v", err)
	}
	if len(replay.GetTrace().GetStages()) != 6 {
		t.Fatalf("expected approval replay stage, got %+v", replay.GetTrace().GetStages())
	}
	if replay.GetTrace().GetStages()[3].GetKind() != runtimev1.DelegatedTraceStageKind_DELEGATED_TRACE_STAGE_KIND_APPROVAL_DECISION {
		t.Fatalf("expected approval stage, got %+v", replay.GetTrace().GetStages()[3])
	}
}

func testDelegatedControlSurfaceService() *Service {
	return &Service{
		agents: map[string]*agentEntry{
			"agent-1": {
				Agent: &runtimev1.AgentRecord{AgentId: "agent-1"},
				State: &runtimev1.AgentStateProjection{ActiveUserId: "user-1"},
			},
		},
		delegatedProviderProfiles: map[string]*runtimev1.DelegatedProviderProfile{},
		delegatedApprovalRequests: map[string]*runtimev1.DelegatedApprovalRequest{},
	}
}

func testDelegatedControlContext() *runtimev1.AgentRequestContext {
	return &runtimev1.AgentRequestContext{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-1",
	}
}
