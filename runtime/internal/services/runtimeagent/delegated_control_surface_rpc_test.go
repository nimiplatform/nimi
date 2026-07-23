package runtimeagent

import (
	"context"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/services/delegation"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/durationpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestM1DelegatedControlOwnershipAndAuditMatrix(t *testing.T) {
	svc := testDelegatedControlSurfaceService()
	svc.agents["agent-1"].Agent.OwnerUserId = "user-1"
	svc.agents["agent-1"].Agent.RuntimeSourceRef = "agent-1"
	svc.agents["agent-1"].Agent.LocalAgentRef = "local-agent:agent-1"
	svc.agents["agent-other"] = &agentEntry{Agent: &runtimev1.AgentRecord{
		AgentId: "agent-other", OwnerUserId: "user-2", RuntimeSourceRef: "agent-other", LocalAgentRef: "local-agent:agent-other",
	}, State: &runtimev1.AgentStateProjection{ActiveUserId: "user-2"}}
	callContext := desktopAccountProductTestPrincipalContext("user-1", make(chan struct{}))
	selector := func() *runtimev1.AgentRequestContext { return &runtimev1.AgentRequestContext{AppId: "nimi.desktop"} }
	assertWrongOwner := func(t *testing.T, err error) {
		t.Helper()
		if status.Code(err) != codes.NotFound {
			t.Fatalf("wrong-owner delegated call did not fail closed: %v", err)
		}
	}
	profile := func() *runtimev1.DelegatedProviderProfile {
		return &runtimev1.DelegatedProviderProfile{
			ProviderProfileId: "m1-provider", DisplayName: "M1 Provider",
			ProviderKind:  runtimev1.DelegatedProviderKind_DELEGATED_PROVIDER_KIND_MCP_TOOL_PROVIDER,
			TransportKind: runtimev1.DelegatedTransportKind_DELEGATED_TRANSPORT_KIND_STDIO_COMMAND,
			TrustTier:     runtimev1.DelegatedProviderTrustTier_DELEGATED_PROVIDER_TRUST_TIER_USER_ADDED_REVIEWED,
			AllowedTools:  []*runtimev1.DelegatedToolAllowlistEntry{{ToolName: "read", EffectClass: runtimev1.EffectClass_EFFECT_CLASS_READ_ONLY}},
			TransportRef:  "runtime-transport://m1",
		}
	}

	t.Run("GetDelegatedControlSurfaceSnapshot", func(t *testing.T) {
		_, err := svc.GetDelegatedControlSurfaceSnapshot(callContext, &runtimev1.GetDelegatedControlSurfaceSnapshotRequest{Context: selector(), AgentId: "agent-other"})
		assertWrongOwner(t, err)
		response, err := svc.GetDelegatedControlSurfaceSnapshot(callContext, &runtimev1.GetDelegatedControlSurfaceSnapshotRequest{Context: selector(), AgentId: "agent-1"})
		if err != nil || response.GetSnapshot().GetAgentId() != "agent-1" {
			t.Fatalf("current owner snapshot=%+v err=%v", response, err)
		}
	})
	t.Run("UpsertDelegatedProviderProfile", func(t *testing.T) {
		_, err := svc.UpsertDelegatedProviderProfile(callContext, &runtimev1.UpsertDelegatedProviderProfileRequest{Context: selector(), AgentId: "agent-other", ProviderProfile: profile()})
		assertWrongOwner(t, err)
		response, err := svc.UpsertDelegatedProviderProfile(callContext, &runtimev1.UpsertDelegatedProviderProfileRequest{Context: selector(), AgentId: "agent-1", ProviderProfile: profile()})
		if err != nil || response.GetProviderProfile().GetProviderProfileId() != "m1-provider" {
			t.Fatalf("current owner upsert=%+v err=%v", response, err)
		}
	})
	t.Run("SetDelegatedProviderState", func(t *testing.T) {
		_, err := svc.SetDelegatedProviderState(callContext, &runtimev1.SetDelegatedProviderStateRequest{Context: selector(), AgentId: "agent-other", ProviderProfileId: "m1-provider", State: runtimev1.DelegatedProviderState_DELEGATED_PROVIDER_STATE_DISABLED, LifecycleReasonCode: "m1"})
		assertWrongOwner(t, err)
		response, err := svc.SetDelegatedProviderState(callContext, &runtimev1.SetDelegatedProviderStateRequest{Context: selector(), AgentId: "agent-1", ProviderProfileId: "m1-provider", State: runtimev1.DelegatedProviderState_DELEGATED_PROVIDER_STATE_DISABLED, LifecycleReasonCode: "m1"})
		if err != nil || response.GetProviderProfile().GetState() != runtimev1.DelegatedProviderState_DELEGATED_PROVIDER_STATE_DISABLED {
			t.Fatalf("current owner state=%+v err=%v", response, err)
		}
	})
	t.Run("GetDelegatedReplayTrace", func(t *testing.T) {
		_, err := svc.GetDelegatedReplayTrace(callContext, &runtimev1.GetDelegatedReplayTraceRequest{Context: selector(), AgentId: "agent-other", DecisionId: "deleg-decision-1"})
		assertWrongOwner(t, err)
		recordDelegatedApprovalDecisionForTest(t, svc)
		response, err := svc.GetDelegatedReplayTrace(callContext, &runtimev1.GetDelegatedReplayTraceRequest{Context: selector(), AgentId: "agent-1", DecisionId: "deleg-decision-1"})
		if err != nil || response.GetTrace().GetAgentId() != "agent-1" {
			t.Fatalf("current owner replay=%+v err=%v", response, err)
		}
	})
	t.Run("SubmitDelegatedApprovalDecision", func(t *testing.T) {
		_, err := svc.SubmitDelegatedApprovalDecision(callContext, &runtimev1.SubmitDelegatedApprovalDecisionRequest{Context: selector(), AgentId: "agent-other", ApprovalRequestId: "missing", Decision: runtimev1.DelegatedApprovalDecision_DELEGATED_APPROVAL_DECISION_REJECTED})
		assertWrongOwner(t, err)
		_, err = svc.SubmitDelegatedApprovalDecision(callContext, &runtimev1.SubmitDelegatedApprovalDecisionRequest{Context: selector(), AgentId: "agent-1", ApprovalRequestId: "missing", Decision: runtimev1.DelegatedApprovalDecision_DELEGATED_APPROVAL_DECISION_REJECTED})
		if status.Code(err) != codes.NotFound {
			t.Fatalf("current owner did not reach approval domain: %v", err)
		}
	})
}

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
			TrustTier:         runtimev1.DelegatedProviderTrustTier_DELEGATED_PROVIDER_TRUST_TIER_USER_ADDED_REVIEWED,
			AllowedTools: []*runtimev1.DelegatedToolAllowlistEntry{{
				ToolName:          "calendar_lookup",
				EffectClass:       runtimev1.EffectClass_EFFECT_CLASS_READ_ONLY,
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
	if upserted.GetProviderProfile().GetState() != runtimev1.DelegatedProviderState_DELEGATED_PROVIDER_STATE_REGISTERED {
		t.Fatalf("expected registered default state, got %+v", upserted.GetProviderProfile())
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
		Context:             ctx,
		AgentId:             "agent-1",
		ProviderProfileId:   "calendar-mcp",
		State:               runtimev1.DelegatedProviderState_DELEGATED_PROVIDER_STATE_DISABLED,
		LifecycleReasonCode: "provider_disabled_by_policy",
	})
	if err != nil {
		t.Fatalf("disable delegated provider profile: %v", err)
	}
	if disabled.GetProviderProfile().GetState() != runtimev1.DelegatedProviderState_DELEGATED_PROVIDER_STATE_DISABLED {
		t.Fatalf("expected disabled provider profile, got %+v", disabled.GetProviderProfile())
	}
	if disabled.GetProviderProfile().GetLifecycleReasonCode() != "provider_disabled_by_policy" {
		t.Fatalf("expected lifecycle reason custody, got %+v", disabled.GetProviderProfile())
	}
}

func TestDelegatedProviderProfileRequiresTrustTier(t *testing.T) {
	svc := testDelegatedControlSurfaceService()
	_, err := svc.UpsertDelegatedProviderProfile(context.Background(), &runtimev1.UpsertDelegatedProviderProfileRequest{
		Context: testDelegatedControlContext(),
		AgentId: "agent-1",
		ProviderProfile: &runtimev1.DelegatedProviderProfile{
			ProviderProfileId: "calendar-mcp",
			DisplayName:       "Calendar MCP",
			ProviderKind:      runtimev1.DelegatedProviderKind_DELEGATED_PROVIDER_KIND_MCP_TOOL_PROVIDER,
			TransportKind:     runtimev1.DelegatedTransportKind_DELEGATED_TRANSPORT_KIND_STDIO_COMMAND,
			AllowedTools:      []*runtimev1.DelegatedToolAllowlistEntry{{ToolName: "calendar_lookup", EffectClass: runtimev1.EffectClass_EFFECT_CLASS_READ_ONLY}},
			TransportRef:      "runtime-transport://calendar-mcp",
		},
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected missing trust tier to fail closed, got %v", err)
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
			TrustTier:         runtimev1.DelegatedProviderTrustTier_DELEGATED_PROVIDER_TRUST_TIER_USER_ADDED_REVIEWED,
			AllowedTools:      []*runtimev1.DelegatedToolAllowlistEntry{{ToolName: "calendar_lookup", EffectClass: runtimev1.EffectClass_EFFECT_CLASS_READ_ONLY}},
			CredentialRef:     "connector://calendar?token=secret",
			TransportRef:      "runtime-transport://calendar-mcp",
		},
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected raw credential material rejection, got %v", err)
	}
}

func TestDelegatedProviderStateReadyRequiresRunnableProfile(t *testing.T) {
	svc := testDelegatedControlSurfaceService()
	ctx := testDelegatedControlContext()
	_, err := svc.UpsertDelegatedProviderProfile(context.Background(), &runtimev1.UpsertDelegatedProviderProfileRequest{
		Context: ctx,
		AgentId: "agent-1",
		ProviderProfile: &runtimev1.DelegatedProviderProfile{
			ProviderProfileId: "calendar-mcp",
			DisplayName:       "Calendar MCP",
			ProviderKind:      runtimev1.DelegatedProviderKind_DELEGATED_PROVIDER_KIND_MCP_TOOL_PROVIDER,
			TransportKind:     runtimev1.DelegatedTransportKind_DELEGATED_TRANSPORT_KIND_STDIO_COMMAND,
			TrustTier:         runtimev1.DelegatedProviderTrustTier_DELEGATED_PROVIDER_TRUST_TIER_USER_ADDED_REVIEWED,
			AllowedTools:      []*runtimev1.DelegatedToolAllowlistEntry{{ToolName: "calendar_lookup", EffectClass: runtimev1.EffectClass_EFFECT_CLASS_READ_ONLY}},
			TransportRef:      "runtime-transport://calendar-mcp",
		},
	})
	if err != nil {
		t.Fatalf("upsert registered delegated provider: %v", err)
	}

	_, err = svc.SetDelegatedProviderState(context.Background(), &runtimev1.SetDelegatedProviderStateRequest{
		Context:           ctx,
		AgentId:           "agent-1",
		ProviderProfileId: "calendar-mcp",
		State:             runtimev1.DelegatedProviderState_DELEGATED_PROVIDER_STATE_READY,
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected READY without command to fail closed, got %v", err)
	}
	listed, err := svc.ListDelegatedProviderProfiles(context.Background(), &runtimev1.ListDelegatedProviderProfilesRequest{
		Context: ctx,
		AgentId: "agent-1",
	})
	if err != nil {
		t.Fatalf("list delegated provider profiles: %v", err)
	}
	if got := listed.GetProviderProfiles()[0].GetState(); got != runtimev1.DelegatedProviderState_DELEGATED_PROVIDER_STATE_REGISTERED {
		t.Fatalf("failed READY transition mutated provider state: %s", got)
	}
}

func TestBlockedDelegatedProviderCannotBecomeReady(t *testing.T) {
	svc := testDelegatedControlSurfaceService()
	ctx := testDelegatedControlContext()
	_, err := svc.UpsertDelegatedProviderProfile(context.Background(), &runtimev1.UpsertDelegatedProviderProfileRequest{
		Context: ctx,
		AgentId: "agent-1",
		ProviderProfile: &runtimev1.DelegatedProviderProfile{
			ProviderProfileId: "calendar-mcp",
			DisplayName:       "Calendar MCP",
			ProviderKind:      runtimev1.DelegatedProviderKind_DELEGATED_PROVIDER_KIND_MCP_TOOL_PROVIDER,
			TransportKind:     runtimev1.DelegatedTransportKind_DELEGATED_TRANSPORT_KIND_STDIO_COMMAND,
			TrustTier:         runtimev1.DelegatedProviderTrustTier_DELEGATED_PROVIDER_TRUST_TIER_BLOCKED,
			AllowedTools:      []*runtimev1.DelegatedToolAllowlistEntry{{ToolName: "calendar_lookup", EffectClass: runtimev1.EffectClass_EFFECT_CLASS_READ_ONLY}},
			TransportRef:      "runtime-transport://calendar-mcp",
			Command:           "calendar-mcp",
		},
	})
	if err != nil {
		t.Fatalf("upsert blocked delegated provider: %v", err)
	}

	_, err = svc.SetDelegatedProviderState(context.Background(), &runtimev1.SetDelegatedProviderStateRequest{
		Context:           ctx,
		AgentId:           "agent-1",
		ProviderProfileId: "calendar-mcp",
		State:             runtimev1.DelegatedProviderState_DELEGATED_PROVIDER_STATE_READY,
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected blocked READY transition to fail closed, got %v", err)
	}
}

func TestDelegatedProviderStateRequiresLifecycleReason(t *testing.T) {
	svc := testDelegatedControlSurfaceService()
	ctx := testDelegatedControlContext()
	_, err := svc.UpsertDelegatedProviderProfile(context.Background(), &runtimev1.UpsertDelegatedProviderProfileRequest{
		Context: ctx,
		AgentId: "agent-1",
		ProviderProfile: &runtimev1.DelegatedProviderProfile{
			ProviderProfileId: "calendar-mcp",
			DisplayName:       "Calendar MCP",
			ProviderKind:      runtimev1.DelegatedProviderKind_DELEGATED_PROVIDER_KIND_MCP_TOOL_PROVIDER,
			TransportKind:     runtimev1.DelegatedTransportKind_DELEGATED_TRANSPORT_KIND_STDIO_COMMAND,
			TrustTier:         runtimev1.DelegatedProviderTrustTier_DELEGATED_PROVIDER_TRUST_TIER_USER_ADDED_REVIEWED,
			AllowedTools:      []*runtimev1.DelegatedToolAllowlistEntry{{ToolName: "calendar_lookup", EffectClass: runtimev1.EffectClass_EFFECT_CLASS_READ_ONLY}},
			TransportRef:      "runtime-transport://calendar-mcp",
			Command:           "calendar-mcp",
		},
	})
	if err != nil {
		t.Fatalf("upsert delegated provider: %v", err)
	}

	_, err = svc.SetDelegatedProviderState(context.Background(), &runtimev1.SetDelegatedProviderStateRequest{
		Context:           ctx,
		AgentId:           "agent-1",
		ProviderProfileId: "calendar-mcp",
		State:             runtimev1.DelegatedProviderState_DELEGATED_PROVIDER_STATE_QUARANTINED,
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected missing lifecycle reason to fail closed, got %v", err)
	}
	listed, err := svc.ListDelegatedProviderProfiles(context.Background(), &runtimev1.ListDelegatedProviderProfilesRequest{
		Context: ctx,
		AgentId: "agent-1",
	})
	if err != nil {
		t.Fatalf("list delegated provider profiles: %v", err)
	}
	if got := listed.GetProviderProfiles()[0].GetState(); got != runtimev1.DelegatedProviderState_DELEGATED_PROVIDER_STATE_REGISTERED {
		t.Fatalf("failed quarantined transition mutated provider state: %s", got)
	}
}

func TestDelegatedApprovalAndDiagnosticsSurfaceRuntimeDecisions(t *testing.T) {
	svc := testDelegatedControlSurfaceService()
	ctx := testDelegatedControlContext()
	upsertDelegatedApprovalTestProfile(t, svc, "sha256:calendar")
	mustRecordDelegatedCapabilityDecision(t, svc, &runtimeAgentDelegatedCapabilityDecision{
		DecisionID:           "deleg-decision-1",
		AgentID:              "agent-1",
		DelegationRequestID:  "deleg-request-1",
		DelegationResultID:   "deleg-result-1",
		ConversationAnchorID: "anchor-1",
		TurnID:               "turn-1",
		ProviderID:           "calendar-mcp",
		CapabilityID:         "calendar.read",
		ToolName:             "calendar_lookup",
		DescriptorHash:       "sha256:calendar",
		PolicySnapshotID:     delegatedApprovalPolicySnapshotID("calendar-mcp", "calendar.read", "calendar_lookup", "sha256:calendar"),
		ApprovalPrincipalID:  "user-1",
		ApprovalExpiresAt:    time.Now().UTC().Add(defaultDelegatedApprovalTTL),
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
		Decision:          runtimev1.DelegatedApprovalDecision_DELEGATED_APPROVAL_DECISION_APPROVED_ONCE,
		DecisionReason:    "user confirmed",
	})
	if err != nil {
		t.Fatalf("submit delegated approval: %v", err)
	}
	if approved.GetApprovalRequest().GetState() != runtimev1.DelegatedApprovalRequestState_DELEGATED_APPROVAL_REQUEST_STATE_APPROVED_ONCE {
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

func TestDelegatedApprovalDecisionFailsClosedOnExpiredApproval(t *testing.T) {
	svc := testDelegatedControlSurfaceService()
	ctx := testDelegatedControlContext()
	upsertDelegatedApprovalTestProfile(t, svc, "sha256:calendar")
	recordDelegatedApprovalDecisionForTest(t, svc)
	svc.delegatedMu.Lock()
	approval := svc.delegatedApprovalRequests[delegatedApprovalRequestKey("agent-1", "deleg-decision-1")]
	approval.ExpiresAt = timestamppb.New(time.Now().UTC().Add(-time.Minute))
	svc.delegatedMu.Unlock()

	_, err := svc.SubmitDelegatedApprovalDecision(context.Background(), &runtimev1.SubmitDelegatedApprovalDecisionRequest{
		Context:           ctx,
		AgentId:           "agent-1",
		ApprovalRequestId: "deleg-decision-1",
		Decision:          runtimev1.DelegatedApprovalDecision_DELEGATED_APPROVAL_DECISION_APPROVED_ONCE,
	})
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected expired approval to fail closed, got %v", err)
	}
	if got := svc.delegatedApprovalRequest("agent-1", "deleg-decision-1").GetState(); got != runtimev1.DelegatedApprovalRequestState_DELEGATED_APPROVAL_REQUEST_STATE_EXPIRED {
		t.Fatalf("expected expired approval state, got %s", got)
	}
}

func TestDelegatedApprovalExpiryPersistsAcrossRestart(t *testing.T) {
	localStatePath := t.TempDir() + "/local-state.json"
	svc, closeFn := newRuntimeAgentServiceForPublicChatStatePathWithClose(t, localStatePath)
	agentID := testRuntimeAgentLocalRef("agent-alpha")
	ctx := testRuntimeAgentIdentityContext("agent-alpha")
	ctx.ScopedBinding = delegatedControlScopedBinding("binding-delegated-expiry-persist", agentID)
	installDelegatedControlScopedBindingValidator(svc, "binding-delegated-expiry-persist", agentID)
	upsertDelegatedApprovalTestProfileForAgent(t, svc, ctx, agentID, "sha256:calendar")
	mustRecordDelegatedCapabilityDecision(t, svc, &runtimeAgentDelegatedCapabilityDecision{
		DecisionID:           "deleg-decision-expiry-persist",
		AgentID:              agentID,
		DelegationRequestID:  "deleg-request-expiry-persist",
		DelegationResultID:   "deleg-result-expiry-persist",
		ConversationAnchorID: "anchor-expiry-persist",
		TurnID:               "turn-expiry-persist",
		ProviderID:           "calendar-mcp",
		CapabilityID:         "calendar.read",
		ToolName:             "calendar_lookup",
		DescriptorHash:       "sha256:calendar",
		PolicySnapshotID:     delegatedApprovalPolicySnapshotID("calendar-mcp", "calendar.read", "calendar_lookup", "sha256:calendar"),
		ApprovalPrincipalID:  "user-1",
		ApprovalExpiresAt:    time.Now().UTC().Add(defaultDelegatedApprovalTTL),
		GatewayEvidenceID:    "evidence-expiry-persist",
		FirewallInputID:      "fw-expiry-persist",
		FirewallVerdict:      "approval_required",
		ReasonCode:           "requires_human_approval",
		RuntimeDecision:      "approval_required",
	})
	svc.delegatedMu.Lock()
	approval := svc.delegatedApprovalRequests[delegatedApprovalRequestKey(agentID, "deleg-decision-expiry-persist")]
	approval.ExpiresAt = timestamppb.New(time.Now().UTC().Add(-time.Minute))
	svc.delegatedMu.Unlock()

	_, err := svc.SubmitDelegatedApprovalDecision(context.Background(), &runtimev1.SubmitDelegatedApprovalDecisionRequest{
		Context:           ctx,
		AgentId:           agentID,
		ApprovalRequestId: "deleg-decision-expiry-persist",
		Decision:          runtimev1.DelegatedApprovalDecision_DELEGATED_APPROVAL_DECISION_APPROVED_ONCE,
	})
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected expired approval to fail closed, got %v", err)
	}
	closeFn()

	restarted, restartClose := newRuntimeAgentServiceForPublicChatStatePathWithClose(t, localStatePath)
	defer restartClose()
	installDelegatedControlScopedBindingValidator(restarted, "binding-delegated-expiry-persist", agentID)
	listed, err := restarted.ListDelegatedApprovalRequests(context.Background(), &runtimev1.ListDelegatedApprovalRequestsRequest{
		Context:              ctx,
		AgentId:              agentID,
		ConversationAnchorId: "anchor-expiry-persist",
	})
	if err != nil {
		t.Fatalf("list approvals after restart: %v", err)
	}
	if len(listed.GetApprovalRequests()) != 1 {
		t.Fatalf("expected one persisted approval after restart, got %+v", listed.GetApprovalRequests())
	}
	if got := listed.GetApprovalRequests()[0].GetState(); got != runtimev1.DelegatedApprovalRequestState_DELEGATED_APPROVAL_REQUEST_STATE_EXPIRED {
		t.Fatalf("expected persisted expired approval, got %s", got)
	}
}

func TestDelegatedApprovalDecisionFailsClosedOnDescriptorDrift(t *testing.T) {
	svc := testDelegatedControlSurfaceService()
	ctx := testDelegatedControlContext()
	upsertDelegatedApprovalTestProfile(t, svc, "sha256:calendar")
	recordDelegatedApprovalDecisionForTest(t, svc)
	upsertDelegatedApprovalTestProfile(t, svc, "sha256:drifted")

	_, err := svc.SubmitDelegatedApprovalDecision(context.Background(), &runtimev1.SubmitDelegatedApprovalDecisionRequest{
		Context:           ctx,
		AgentId:           "agent-1",
		ApprovalRequestId: "deleg-decision-1",
		Decision:          runtimev1.DelegatedApprovalDecision_DELEGATED_APPROVAL_DECISION_APPROVED_ONCE,
	})
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected descriptor drift to fail closed, got %v", err)
	}
}

func TestDelegatedApprovalDecisionFailsClosedOnPrincipalMismatch(t *testing.T) {
	svc := testDelegatedControlSurfaceService()
	upsertDelegatedApprovalTestProfile(t, svc, "sha256:calendar")
	recordDelegatedApprovalDecisionForTest(t, svc)
	ctx := &runtimev1.AgentRequestContext{
		AppId:         "nimi.desktop",
		SubjectUserId: "other-user",
		ScopedBinding: delegatedControlScopedBinding("binding-delegated-control", "agent-1"),
	}

	_, err := svc.SubmitDelegatedApprovalDecision(context.Background(), &runtimev1.SubmitDelegatedApprovalDecisionRequest{
		Context:           ctx,
		AgentId:           "agent-1",
		ApprovalRequestId: "deleg-decision-1",
		Decision:          runtimev1.DelegatedApprovalDecision_DELEGATED_APPROVAL_DECISION_APPROVED_ONCE,
	})
	if status.Code(err) != codes.PermissionDenied {
		t.Fatalf("expected principal mismatch to fail closed, got %v", err)
	}
}

func TestDelegatedReplayTraceReconstructsRuntimeOwnedLineage(t *testing.T) {
	svc := testDelegatedControlSurfaceService()
	ctx := testDelegatedControlContext()
	mustRecordDelegatedCapabilityDecision(t, svc, &runtimeAgentDelegatedCapabilityDecision{
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

func TestDelegatedReplayTraceReconstructsApprovalDecisionFromAuditLineage(t *testing.T) {
	svc := testDelegatedControlSurfaceService()
	ctx := testDelegatedControlContext()
	upsertDelegatedApprovalTestProfile(t, svc, "sha256:calendar")
	mustRecordDelegatedCapabilityDecision(t, svc, &runtimeAgentDelegatedCapabilityDecision{
		DecisionID:           "deleg-decision-1",
		AgentID:              "agent-1",
		DelegationRequestID:  "deleg-request-1",
		DelegationResultID:   "deleg-result-1",
		ConversationAnchorID: "anchor-1",
		TurnID:               "turn-1",
		ProviderID:           "calendar-mcp",
		CapabilityID:         "calendar.read",
		ToolName:             "calendar_lookup",
		DescriptorHash:       "sha256:calendar",
		PolicySnapshotID:     delegatedApprovalPolicySnapshotID("calendar-mcp", "calendar.read", "calendar_lookup", "sha256:calendar"),
		ApprovalPrincipalID:  "user-1",
		ApprovalExpiresAt:    time.Now().UTC().Add(defaultDelegatedApprovalTTL),
		GatewayEvidenceID:    "evidence-1",
		FirewallInputID:      "fw-1",
		FirewallVerdict:      "approval_required",
		ReasonCode:           "requires_human_approval",
		RuntimeDecision:      "approval_required",
	})

	if _, err := svc.SubmitDelegatedApprovalDecision(context.Background(), &runtimev1.SubmitDelegatedApprovalDecisionRequest{
		Context:           ctx,
		AgentId:           "agent-1",
		ApprovalRequestId: "deleg-decision-1",
		Decision:          runtimev1.DelegatedApprovalDecision_DELEGATED_APPROVAL_DECISION_APPROVED_ONCE,
		DecisionReason:    "user confirmed",
	}); err != nil {
		t.Fatalf("submit delegated approval: %v", err)
	}

	replay, err := svc.GetDelegatedReplayTrace(context.Background(), &runtimev1.GetDelegatedReplayTraceRequest{
		Context:    ctx,
		AgentId:    "agent-1",
		DecisionId: "deleg-decision-1",
	})
	if err != nil {
		t.Fatalf("get delegated replay trace: %v", err)
	}
	var approvalStage *runtimev1.DelegatedReplayTraceStage
	for _, stage := range replay.GetTrace().GetStages() {
		if stage.GetKind() == runtimev1.DelegatedTraceStageKind_DELEGATED_TRACE_STAGE_KIND_APPROVAL_DECISION {
			approvalStage = stage
			break
		}
	}
	if approvalStage == nil {
		t.Fatalf("replay trace missing approval decision stage: %+v", replay.GetTrace().GetStages())
	}
	if approvalStage.GetState() != "approved_once" {
		t.Fatalf("approval stage status must come from the committed audit decision, got %q", approvalStage.GetState())
	}
	if !strings.Contains(approvalStage.GetRedactedSummary(), "reconstructed from audit lineage") {
		t.Fatalf("approval stage must be reconstructed from audit lineage, got %q", approvalStage.GetRedactedSummary())
	}

	// The committed decision must be independently queryable by decision_id
	// (the K-DELEG-086 join), not only via the in-memory approval object.
	audited := svc.delegatedApprovalDecisionAuditRecord("deleg-decision-1")
	if audited == nil || audited.ApprovalState != "approved_once" || audited.ApprovalID != "deleg-decision-1" {
		t.Fatalf("approval decision audit record not joinable by decision_id: %+v", audited)
	}
}

func TestDelegatedReplayTraceMarksSensitiveOutputPartialRedacted(t *testing.T) {
	svc := testDelegatedControlSurfaceService()
	ctx := testDelegatedControlContext()
	mustRecordDelegatedCapabilityDecision(t, svc, &runtimeAgentDelegatedCapabilityDecision{
		DecisionID:               "deleg-decision-sensitive",
		AgentID:                  "agent-1",
		DelegationRequestID:      "deleg-request-1",
		DelegationResultID:       "deleg-result-1",
		ConversationAnchorID:     "anchor-1",
		TurnID:                   "turn-1",
		ProviderID:               "calendar-mcp",
		CapabilityID:             "calendar.read",
		ToolName:                 "calendar_lookup",
		GatewayEvidenceID:        "evidence-1",
		FirewallInputID:          "fw-1",
		FirewallVerdict:          "ACCEPTED_OBSERVATION",
		ReasonCode:               "DELEG_ACCEPTED",
		RuntimeDecision:          "context_candidate",
		FirewallSensitivityClass: delegation.SensitivityClassCredentialLike,
	})

	replay, err := svc.GetDelegatedReplayTrace(context.Background(), &runtimev1.GetDelegatedReplayTraceRequest{
		Context:    ctx,
		AgentId:    "agent-1",
		DecisionId: "deleg-decision-sensitive",
	})
	if err != nil {
		t.Fatalf("get delegated replay trace: %v", err)
	}
	if replay.GetTrace().GetOutcome() != runtimev1.DelegatedReplayOutcome_DELEGATED_REPLAY_OUTCOME_PARTIAL_REDACTED {
		t.Fatalf("sensitive output replay must be PARTIAL_REDACTED, got %s", replay.GetTrace().GetOutcome())
	}
	if !replay.GetTrace().GetRedacted() {
		t.Fatalf("replay trace must remain redacted")
	}
}

func TestDelegatedReplayTraceRequiresRuntimeAuditRecord(t *testing.T) {
	svc := testDelegatedControlSurfaceServiceWithoutAudit()
	ctx := testDelegatedControlContext()
	mustRecordDelegatedCapabilityDecision(t, svc, &runtimeAgentDelegatedCapabilityDecision{
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

	diagnostics, err := svc.ListDelegatedDiagnostics(context.Background(), &runtimev1.ListDelegatedDiagnosticsRequest{
		Context: ctx,
		AgentId: "agent-1",
	})
	if err != nil {
		t.Fatalf("list delegated diagnostics: %v", err)
	}
	if len(diagnostics.GetDiagnostics()) != 0 {
		t.Fatalf("diagnostics must not be reconstructed without Runtime audit records: %+v", diagnostics.GetDiagnostics())
	}
	_, err = svc.GetDelegatedReplayTrace(context.Background(), &runtimev1.GetDelegatedReplayTraceRequest{
		Context:    ctx,
		AgentId:    "agent-1",
		DecisionId: "deleg-decision-1",
	})
	if status.Code(err) != codes.NotFound {
		t.Fatalf("expected replay to require Runtime audit record, got %v", err)
	}
}

func TestDelegatedReplayTraceFailsClosedOnMissingJoinKeys(t *testing.T) {
	svc := testDelegatedControlSurfaceService()
	mustRecordDelegatedCapabilityDecision(t, svc, &runtimeAgentDelegatedCapabilityDecision{
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

func TestDelegatedReplayTraceFailsClosedOnMissingFinalDisposition(t *testing.T) {
	svc := testDelegatedControlSurfaceService()
	_, err := svc.buildDelegatedReplayTrace("agent-1", delegatedCapabilityDecisionAuditRecord{
		DecisionID:          "deleg-decision-1",
		AgentID:             "agent-1",
		DelegationRequestID: "deleg-request-1",
		DelegationResultID:  "deleg-result-1",
		TurnID:              "turn-1",
		ProviderID:          "calendar-mcp",
		CapabilityID:        "calendar.read",
		ToolName:            "calendar_lookup",
		GatewayEvidenceID:   "evidence-1",
		FirewallInputID:     "fw-1",
		FirewallVerdict:     "ACCEPTED_OBSERVATION",
		RuntimeDecision:     "context_candidate",
		ReasonCode:          "DELEG_ACCEPTED",
		RecordedAt:          time.Now().UTC(),
	})
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected missing final disposition to fail closed, got %v", err)
	}
}

func TestDelegatedReplayTraceIncludesApprovalState(t *testing.T) {
	svc := testDelegatedControlSurfaceService()
	mustRecordDelegatedCapabilityDecision(t, svc, &runtimeAgentDelegatedCapabilityDecision{
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
	stages := replay.GetTrace().GetStages()
	if len(stages) != 4 {
		t.Fatalf("expected approval-only replay stages, got %+v", stages)
	}
	hasApprovalStage := false
	for _, stage := range stages {
		switch stage.GetKind() {
		case runtimev1.DelegatedTraceStageKind_DELEGATED_TRACE_STAGE_KIND_APPROVAL_DECISION:
			hasApprovalStage = true
		case runtimev1.DelegatedTraceStageKind_DELEGATED_TRACE_STAGE_KIND_GATEWAY_EVIDENCE,
			runtimev1.DelegatedTraceStageKind_DELEGATED_TRACE_STAGE_KIND_FIREWALL_VERDICT:
			t.Fatalf("pre-invocation approval replay must not claim execution-stage evidence: %+v", stages)
		}
	}
	if !hasApprovalStage {
		t.Fatalf("expected approval stage, got %+v", stages)
	}
}

func testDelegatedControlSurfaceService() *Service {
	svc := testDelegatedControlSurfaceServiceWithoutAudit()
	svc.auditStore = auditlog.New(128, 128)
	return svc
}

func testDelegatedControlSurfaceServiceWithoutAudit() *Service {
	svc := &Service{
		agents: map[string]*agentEntry{
			"agent-1": {
				Agent: &runtimev1.AgentRecord{AgentId: "agent-1"},
				State: &runtimev1.AgentStateProjection{ActiveUserId: "user-1"},
			},
		},
		delegatedProviderProfiles: map[string]*runtimev1.DelegatedProviderProfile{},
		delegatedApprovalRequests: map[string]*runtimev1.DelegatedApprovalRequest{},
		delegatedPausedRequests:   map[string]*runtimeAgentPausedDelegatedCapabilityRequest{},
	}
	installDelegatedControlScopedBindingValidator(svc, "binding-delegated-control", "agent-1")
	return svc
}

func upsertDelegatedApprovalTestProfile(t *testing.T, svc *Service, descriptorHash string) {
	t.Helper()
	upsertDelegatedApprovalTestProfileForAgent(t, svc, testDelegatedControlContext(), "agent-1", descriptorHash)
}

func upsertDelegatedApprovalTestProfileForAgent(t *testing.T, svc *Service, ctx *runtimev1.AgentRequestContext, agentID string, descriptorHash string) {
	t.Helper()
	_, err := svc.UpsertDelegatedProviderProfile(context.Background(), &runtimev1.UpsertDelegatedProviderProfileRequest{
		Context: ctx,
		AgentId: agentID,
		ProviderProfile: &runtimev1.DelegatedProviderProfile{
			ProviderProfileId: "calendar-mcp",
			DisplayName:       "Calendar MCP",
			ProviderKind:      runtimev1.DelegatedProviderKind_DELEGATED_PROVIDER_KIND_MCP_TOOL_PROVIDER,
			TransportKind:     runtimev1.DelegatedTransportKind_DELEGATED_TRANSPORT_KIND_STDIO_COMMAND,
			State:             runtimev1.DelegatedProviderState_DELEGATED_PROVIDER_STATE_READY,
			TrustTier:         runtimev1.DelegatedProviderTrustTier_DELEGATED_PROVIDER_TRUST_TIER_USER_ADDED_REVIEWED,
			AllowedTools: []*runtimev1.DelegatedToolAllowlistEntry{{
				ToolName:          "calendar_lookup",
				EffectClass:       runtimev1.EffectClass_EFFECT_CLASS_READ_ONLY,
				InputSchemaDigest: descriptorHash,
			}},
			TransportRef:        "runtime-transport://calendar-mcp",
			Command:             "calendar-mcp",
			LifecycleReasonCode: "",
			CredentialRef:       "connector://calendar/oauth",
			Timeout:             durationpb.New(5_000_000_000),
		},
	})
	if err != nil {
		t.Fatalf("upsert delegated approval test profile: %v", err)
	}
}

func recordDelegatedApprovalDecisionForTest(t *testing.T, svc *Service) {
	t.Helper()
	mustRecordDelegatedCapabilityDecision(t, svc, &runtimeAgentDelegatedCapabilityDecision{
		DecisionID:           "deleg-decision-1",
		AgentID:              "agent-1",
		DelegationRequestID:  "deleg-request-1",
		DelegationResultID:   "deleg-result-1",
		ConversationAnchorID: "anchor-1",
		TurnID:               "turn-1",
		ProviderID:           "calendar-mcp",
		CapabilityID:         "calendar.read",
		ToolName:             "calendar_lookup",
		DescriptorHash:       "sha256:calendar",
		PolicySnapshotID:     delegatedApprovalPolicySnapshotID("calendar-mcp", "calendar.read", "calendar_lookup", "sha256:calendar"),
		ApprovalPrincipalID:  "user-1",
		ApprovalExpiresAt:    time.Now().UTC().Add(defaultDelegatedApprovalTTL),
		GatewayEvidenceID:    "evidence-1",
		FirewallInputID:      "fw-1",
		FirewallVerdict:      "APPROVAL_REQUIRED",
		ReasonCode:           "DELEG_APPROVAL_REQUIRED",
		RuntimeDecision:      "approval_required",
	})
}

func mustRecordDelegatedCapabilityDecision(t *testing.T, svc *Service, decision *runtimeAgentDelegatedCapabilityDecision) {
	t.Helper()
	if err := svc.recordDelegatedCapabilityDecision(decision); err != nil {
		t.Fatalf("record delegated capability decision: %v", err)
	}
}

func testDelegatedControlContext() *runtimev1.AgentRequestContext {
	return &runtimev1.AgentRequestContext{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-1",
		ScopedBinding: delegatedControlScopedBinding("binding-delegated-control", "agent-1"),
	}
}

func delegatedControlScopedBinding(bindingID string, agentID string) *runtimev1.ScopedRuntimeBindingAttachment {
	return &runtimev1.ScopedRuntimeBindingAttachment{
		BindingId:    bindingID,
		RuntimeAppId: "nimi.desktop",
		AgentId:      agentID,
	}
}

func installDelegatedControlScopedBindingValidator(svc *Service, bindingID string, agentID string) {
	svc.SetScopedBindingValidator(stubScopedBindingValidator{
		validate: func(actualBindingID string, actual *runtimev1.ScopedAppBindingRelation, requiredScope string) (runtimev1.AccountReasonCode, bool) {
			if actualBindingID != bindingID ||
				actual.GetRuntimeAppId() != "nimi.desktop" ||
				actual.GetAgentId() != agentID ||
				!strings.HasPrefix(requiredScope, "runtime.agent.delegation.") {
				return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_NOT_FOUND, false
			}
			return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_UNSPECIFIED, true
		},
	})
}
