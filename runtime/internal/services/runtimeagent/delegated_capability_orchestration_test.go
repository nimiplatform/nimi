package runtimeagent

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/services/delegation"
)

type fakeDelegatedGateway struct {
	called bool
	last   delegation.ToolCallRequest
	out    *delegation.QuarantinedEvidence
	err    error
}

func (g *fakeDelegatedGateway) CallTool(_ context.Context, req delegation.ToolCallRequest) (*delegation.QuarantinedEvidence, error) {
	g.called = true
	g.last = req
	if g.err != nil {
		return nil, g.err
	}
	return g.out, nil
}

type fakeDelegatedFirewall struct {
	called bool
	last   delegation.FirewallInput
	out    *delegation.FirewallDecision
}

func (f *fakeDelegatedFirewall) Evaluate(_ context.Context, input delegation.FirewallInput) (*delegation.FirewallDecision, error) {
	f.called = true
	f.last = input
	return f.out, nil
}

func TestRuntimeAgentDelegatedCapabilityUsesGatewayAndFirewall(t *testing.T) {
	gateway := &fakeDelegatedGateway{out: cleanRuntimeAgentDelegatedEvidence(t)}
	firewall := &fakeDelegatedFirewall{out: &delegation.FirewallDecision{
		Verdict: delegation.FirewallVerdictAcceptedObservation,
	}}
	svc := &Service{}
	svc.SetAuditStore(auditlog.New(128, 128))
	svc.SetDelegatedCapabilityRuntime(gateway, firewall)

	decision, err := svc.publicChatRuntime().executeDelegatedCapability(context.Background(), testDelegatedSession(), testDelegatedTurn(), validDelegatedRequest())
	if err != nil {
		t.Fatalf("executeDelegatedCapability returned error: %v", err)
	}
	if !gateway.called {
		t.Fatal("expected gateway call")
	}
	if !firewall.called {
		t.Fatal("expected firewall evaluation")
	}
	if gateway.last.ProviderID != "provider-1" || gateway.last.ToolName != "calendar_lookup" {
		t.Fatalf("gateway request mismatch: %+v", gateway.last)
	}
	if firewall.last.Evidence != gateway.out {
		t.Fatal("firewall did not receive gateway quarantined evidence")
	}
	if decision.RuntimeDecision != "context_candidate" {
		t.Fatalf("runtime decision mismatch: %+v", decision)
	}
	if decision.ModelContextAdmitted || decision.ProjectionAdmitted || decision.ActionAdmitted {
		t.Fatalf("delegated capability decision must not directly admit consumers: %+v", decision)
	}
	records := svc.delegatedCapabilityDecisionAuditSnapshot()
	if len(records) != 1 {
		t.Fatalf("audit record count mismatch: got=%d want=1", len(records))
	}
	record := records[0]
	if record.ConversationAnchorID == "" || record.TurnID == "" || record.StreamID == "" ||
		record.ProviderID == "" || record.ToolName == "" || record.GatewayEvidenceID == "" ||
		record.FirewallInputID == "" || record.FirewallVerdict == "" || record.RuntimeDecision == "" {
		t.Fatalf("audit record missing linkage: %+v", record)
	}
}

func TestRuntimeAgentDelegatedCapabilityRequiresGatewayAndFirewall(t *testing.T) {
	svc := &Service{}
	_, err := svc.publicChatRuntime().executeDelegatedCapability(context.Background(), testDelegatedSession(), testDelegatedTurn(), validDelegatedRequest())
	if err == nil || !strings.Contains(err.Error(), "gateway") {
		t.Fatalf("expected missing gateway failure, got %v", err)
	}
	svc.SetDelegatedCapabilityRuntime(&fakeDelegatedGateway{out: cleanRuntimeAgentDelegatedEvidence(t)}, nil)
	_, err = svc.publicChatRuntime().executeDelegatedCapability(context.Background(), testDelegatedSession(), testDelegatedTurn(), validDelegatedRequest())
	if err == nil || !strings.Contains(err.Error(), "firewall") {
		t.Fatalf("expected missing firewall failure, got %v", err)
	}
}

func TestRuntimeAgentServiceDoesNotInstallADelegatedProviderGateway(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	defer closeRuntimeAgentServiceForTest(t, svc)

	gateway, firewall := svc.delegatedCapabilityRuntime()
	if gateway != nil {
		t.Fatal("Runtime must not install a provider gateway without a separately admitted capability owner")
	}
	if firewall == nil {
		t.Fatal("Runtime must retain the delegated output firewall")
	}
}

func TestRuntimeAgentDelegatedCapabilityRequiresExplicitProtocol(t *testing.T) {
	req := validDelegatedRequest()
	req.ProtocolName = ""
	_, err := normalizeRuntimeAgentDelegatedCapabilityRequest(req)
	if err == nil || !strings.Contains(err.Error(), "protocol") {
		t.Fatalf("expected missing protocol failure, got %v", err)
	}
}

func TestRuntimeAgentDelegatedCapabilityApprovalRequiredDoesNotExecute(t *testing.T) {
	gateway := &fakeDelegatedGateway{out: cleanRuntimeAgentDelegatedEvidence(t)}
	firewall := &fakeDelegatedFirewall{out: &delegation.FirewallDecision{
		Verdict:    delegation.FirewallVerdictApprovalRequired,
		ReasonCode: delegation.ReasonApprovalRequired,
	}}
	svc := &Service{}
	svc.SetAuditStore(auditlog.New(128, 128))
	svc.SetDelegatedCapabilityRuntime(gateway, firewall)
	decision, err := svc.publicChatRuntime().executeDelegatedCapability(context.Background(), testDelegatedSession(), testDelegatedTurn(), validDelegatedRequest())
	if err != nil {
		t.Fatalf("executeDelegatedCapability returned error: %v", err)
	}
	if decision.RuntimeDecision != "approval_required" {
		t.Fatalf("expected approval_required decision, got %+v", decision)
	}
	if decision.ActionAdmitted {
		t.Fatalf("approval-required delegated output must not execute: %+v", decision)
	}
	approvals := svc.listDelegatedApprovalRequests("agent-1", "anchor-1")
	if len(approvals) != 1 {
		t.Fatalf("expected one runtime-owned approval request, got %d", len(approvals))
	}
	approval := approvals[0]
	if approval.GetApprovalRequestId() != decision.DecisionID ||
		approval.GetState() != runtimev1.DelegatedApprovalRequestState_DELEGATED_APPROVAL_REQUEST_STATE_PENDING ||
		approval.GetProviderProfileId() != "provider-1" ||
		approval.GetToolName() != "calendar_lookup" {
		t.Fatalf("approval request mismatch: %+v", approval)
	}
}

func TestRuntimeAgentDelegatedCapabilityApprovalStateFailsClosedOnPersistenceFailure(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	if err := svc.backend.Close(); err != nil {
		t.Fatalf("close backend: %v", err)
	}

	decision := runtimeAgentDelegatedCapabilityDecision{
		DecisionID:           "delegated-persist-failure",
		AgentID:              "agent-1",
		ConversationAnchorID: "anchor-1",
		TurnID:               "turn-1",
		StreamID:             "stream-1",
		ProviderID:           "provider-1",
		CapabilityID:         "calendar.read",
		ToolName:             "calendar_lookup",
		FirewallVerdict:      delegation.FirewallVerdictApprovalRequired,
		ReasonCode:           delegation.ReasonApprovalRequired,
		RuntimeDecision:      "approval_required",
		DecidedAt:            time.Now().UTC(),
	}
	err := svc.recordDelegatedCapabilityDecision(&decision)
	if err == nil || !strings.Contains(err.Error(), "delegated approval state persistence failed") {
		t.Fatalf("expected delegated approval persistence failure, got %v", err)
	}
	key := delegatedApprovalRequestKey("agent-1", "delegated-persist-failure")
	svc.delegatedMu.Lock()
	approval := svc.delegatedApprovalRequests[key]
	paused := svc.delegatedPausedRequests[key]
	svc.delegatedMu.Unlock()
	if approval != nil || paused != nil {
		t.Fatalf("approval-required state must roll back after persistence failure, approval=%+v paused=%+v", approval, paused)
	}
	if records := svc.delegatedCapabilityDecisionAuditSnapshot(); len(records) != 0 {
		t.Fatalf("failed approval-required decision must not publish committed audit state, got=%+v", records)
	}
}

func TestRuntimeAgentDelegatedCapabilityPreinvokeApprovalDoesNotCallProvider(t *testing.T) {
	gateway := &fakeDelegatedGateway{out: cleanRuntimeAgentDelegatedEvidence(t)}
	firewall := &fakeDelegatedFirewall{out: &delegation.FirewallDecision{
		Verdict: delegation.FirewallVerdictAcceptedObservation,
	}}
	svc := &Service{}
	svc.SetAuditStore(auditlog.New(128, 128))
	svc.SetDelegatedCapabilityRuntime(gateway, firewall)
	req := validDelegatedRequest()
	req.RequiresApproval = true

	decision, err := svc.publicChatRuntime().executeDelegatedCapability(context.Background(), testDelegatedSession(), testDelegatedTurn(), req)
	if err != nil {
		t.Fatalf("executeDelegatedCapability returned error: %v", err)
	}
	if gateway.called {
		t.Fatal("pre-invocation approval must not call delegated provider")
	}
	if firewall.called {
		t.Fatal("pre-invocation approval must not rely on post-provider firewall repair")
	}
	if decision.RuntimeDecision != "approval_required" ||
		decision.FirewallVerdict != delegation.FirewallVerdictApprovalRequired ||
		decision.ReasonCode != delegation.ReasonApprovalRequired {
		t.Fatalf("expected pre-invocation approval decision, got %+v", decision)
	}
	approvals := svc.listDelegatedApprovalRequests("agent-1", "anchor-1")
	if len(approvals) != 1 {
		t.Fatalf("expected one pending approval request, got %+v", approvals)
	}
	if approvals[0].GetExpiresAt() == nil || approvals[0].GetDetail().GetFields()["descriptor_hash"].GetStringValue() == "" {
		t.Fatalf("pre-invocation approval request lost expiry or descriptor lineage: %+v", approvals[0])
	}
}

func TestRuntimeAgentDelegatedCapabilityRejectedDoesNotProject(t *testing.T) {
	gateway := &fakeDelegatedGateway{out: cleanRuntimeAgentDelegatedEvidence(t)}
	firewall := &fakeDelegatedFirewall{out: &delegation.FirewallDecision{
		Verdict:    delegation.FirewallVerdictPolicyBlocked,
		ReasonCode: delegation.ReasonFirewallQuarantined,
	}}
	svc := &Service{}
	svc.SetAuditStore(auditlog.New(128, 128))
	svc.SetDelegatedCapabilityRuntime(gateway, firewall)
	decision, err := svc.publicChatRuntime().executeDelegatedCapability(context.Background(), testDelegatedSession(), testDelegatedTurn(), validDelegatedRequest())
	if err != nil {
		t.Fatalf("executeDelegatedCapability returned error: %v", err)
	}
	if decision.RuntimeDecision != "rejected" {
		t.Fatalf("expected rejected decision, got %+v", decision)
	}
	if decision.ModelContextAdmitted || decision.ProjectionAdmitted || decision.ActionAdmitted {
		t.Fatalf("rejected delegated output must not be admitted: %+v", decision)
	}
}

func TestRuntimeAgentDelegatedCapabilityRequiresAuditStoreBeforeGateway(t *testing.T) {
	gateway := &fakeDelegatedGateway{out: cleanRuntimeAgentDelegatedEvidence(t)}
	firewall := &fakeDelegatedFirewall{out: &delegation.FirewallDecision{
		Verdict: delegation.FirewallVerdictAcceptedObservation,
	}}
	svc := &Service{}
	svc.SetDelegatedCapabilityRuntime(gateway, firewall)

	_, err := svc.publicChatRuntime().executeDelegatedCapability(context.Background(), testDelegatedSession(), testDelegatedTurn(), validDelegatedRequest())
	if err == nil || !strings.Contains(err.Error(), "audit store") {
		t.Fatalf("expected missing audit store failure, got %v", err)
	}
	if gateway.called {
		t.Fatal("gateway must not be called before audit store availability is proven")
	}
	if firewall.called {
		t.Fatal("firewall must not run when pre-gateway audit preflight fails")
	}
}

func TestRuntimeAgentDelegatedCapabilityRejectsMissingGatewayEvidenceID(t *testing.T) {
	evidence := cleanRuntimeAgentDelegatedEvidence(t)
	evidence.EvidenceID = ""
	gateway := &fakeDelegatedGateway{out: evidence}
	firewall := &fakeDelegatedFirewall{out: &delegation.FirewallDecision{
		Verdict: delegation.FirewallVerdictAcceptedObservation,
	}}
	svc := &Service{}
	svc.SetAuditStore(auditlog.New(128, 128))
	svc.SetDelegatedCapabilityRuntime(gateway, firewall)

	_, err := svc.publicChatRuntime().executeDelegatedCapability(context.Background(), testDelegatedSession(), testDelegatedTurn(), validDelegatedRequest())
	if err == nil || !strings.Contains(err.Error(), "evidence id") {
		t.Fatalf("expected missing gateway evidence id failure, got %v", err)
	}
	if !gateway.called {
		t.Fatal("expected gateway call before validating returned evidence id")
	}
	if firewall.called {
		t.Fatal("firewall must not accept missing gateway evidence lineage")
	}
	if records := svc.delegatedCapabilityDecisionAuditSnapshot(); len(records) != 0 {
		t.Fatalf("missing gateway evidence id must not create audit decision records: %+v", records)
	}
}

func validDelegatedRequest() runtimeAgentDelegatedCapabilityRequest {
	return runtimeAgentDelegatedCapabilityRequest{
		ProviderID:       "provider-1",
		CapabilityID:     "calendar.read",
		ToolName:         "calendar_lookup",
		Arguments:        json.RawMessage(`{"day":"tomorrow"}`),
		DescriptorHash:   "sha256:descriptor",
		ProtocolName:     "controlled-test",
		ProtocolRevision: "1",
		OutputKind:       delegation.OutputKindObservation,
	}
}

func testDelegatedSession() publicChatAnchorState {
	return publicChatAnchorState{
		ConversationAnchorID: "anchor-1",
		AgentID:              "agent-1",
		CallerAppID:          "desktop.app",
		SubjectUserID:        "user-1",
		ThreadID:             "thread-1",
	}
}

func testDelegatedTurn() publicChatTurnState {
	return publicChatTurnState{
		ConversationAnchorID: "anchor-1",
		TurnID:               "turn-1",
		StreamID:             "stream-1",
		RequestID:            "request-1",
		AgentID:              "agent-1",
	}
}

func cleanRuntimeAgentDelegatedEvidence(t *testing.T) *delegation.QuarantinedEvidence {
	t.Helper()
	payload := struct {
		Content json.RawMessage `json:"content,omitempty"`
	}{
		Content: json.RawMessage(`[{"type":"text","text":"calendar has three events tomorrow"}]`),
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal evidence: %v", err)
	}
	return &delegation.QuarantinedEvidence{
		EvidenceID:        "evidence-1",
		ProviderID:        "provider-1",
		ToolName:          "calendar_lookup",
		State:             delegation.EvidenceStateQuarantined,
		FirewallState:     delegation.FirewallStateNotEvaluated,
		InputSchemaDigest: "sha256:descriptor",
		RawProviderResult: raw,
	}
}
