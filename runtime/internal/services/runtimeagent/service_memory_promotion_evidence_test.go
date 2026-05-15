package runtimeagent

import (
	"context"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestWriteAgentMemoryRejectsMissingPromotionEvidence(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		Context: testRuntimeAgentIdentityContext("agent-promotion-missing")}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}

	resp, err := svc.WriteAgentMemory(ctx, &runtimev1.WriteAgentMemoryRequest{
		Context:    testRuntimeAgentIdentityContext("agent-promotion-missing"),
		AgentId:    "agent-promotion-missing",
		Candidates: []*runtimev1.CanonicalMemoryCandidate{promotionEvidenceTestCandidate("agent-promotion-missing", nil)},
	})
	if err != nil {
		t.Fatalf("WriteAgentMemory: %v", err)
	}
	if len(resp.GetAccepted()) != 0 || len(resp.GetRejected()) != 1 {
		t.Fatalf("expected missing promotion evidence rejection, accepted=%d rejected=%d", len(resp.GetAccepted()), len(resp.GetRejected()))
	}
	rejected := resp.GetRejected()[0]
	if rejected.GetReasonCode() != runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID {
		t.Fatalf("expected protocol invalid rejection, got %s", rejected.GetReasonCode())
	}
	if !strings.Contains(rejected.GetMessage(), "promotion evidence") {
		t.Fatalf("expected promotion evidence rejection message, got %q", rejected.GetMessage())
	}
}

func TestWriteAgentMemoryAcceptsCompletePromotionEvidence(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		Context: testRuntimeAgentIdentityContext("agent-promotion-complete")}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}

	resp, err := svc.WriteAgentMemory(ctx, &runtimev1.WriteAgentMemoryRequest{
		Context:    testRuntimeAgentIdentityContext("agent-promotion-complete"),
		AgentId:    "agent-promotion-complete",
		Candidates: []*runtimev1.CanonicalMemoryCandidate{promotionEvidenceTestCandidate("agent-promotion-complete", completePromotionEvidence(t))},
	})
	if err != nil {
		t.Fatalf("WriteAgentMemory: %v", err)
	}
	if len(resp.GetAccepted()) != 1 || len(resp.GetRejected()) != 0 {
		t.Fatalf("expected complete promotion evidence acceptance, accepted=%d rejected=%d", len(resp.GetAccepted()), len(resp.GetRejected()))
	}
}

func TestWriteAgentMemoryAcceptsCanonicalAgentChatPromotionEvidence(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		Context: testRuntimeAgentIdentityContext("agent-promotion-canonical-chat")}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}

	evidence := completePromotionEvidenceWithSourceProfile(t, "canonical_agent_chat")
	resp, err := svc.WriteAgentMemory(ctx, &runtimev1.WriteAgentMemoryRequest{
		Context:    testRuntimeAgentIdentityContext("agent-promotion-canonical-chat"),
		AgentId:    "agent-promotion-canonical-chat",
		Candidates: []*runtimev1.CanonicalMemoryCandidate{promotionEvidenceTestCandidate("agent-promotion-canonical-chat", evidence)},
	})
	if err != nil {
		t.Fatalf("WriteAgentMemory: %v", err)
	}
	if len(resp.GetAccepted()) != 1 || len(resp.GetRejected()) != 0 {
		t.Fatalf("expected canonical agent chat promotion evidence acceptance, accepted=%d rejected=%d", len(resp.GetAccepted()), len(resp.GetRejected()))
	}
}

func promotionEvidenceTestCandidate(agentID string, evidence *structpb.Struct) *runtimev1.CanonicalMemoryCandidate {
	return &runtimev1.CanonicalMemoryCandidate{
		CanonicalClass: runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_PUBLIC_SHARED,
		TargetBank: &runtimev1.MemoryBankLocator{
			Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
			Owner: &runtimev1.MemoryBankLocator_AgentCore{
				AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: testRuntimeAgentLocalRef(agentID)},
			},
		},
		SourceEventId: "promotion-evidence-event",
		PolicyReason:  "validated runtime memory promotion",
		Extensions:    evidence,
		Record: &runtimev1.MemoryRecordInput{
			Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_SEMANTIC,
			Payload: &runtimev1.MemoryRecordInput_Semantic{
				Semantic: &runtimev1.SemanticMemoryRecord{
					Subject:   "PromotionEvidence",
					Predicate: "guards",
					Object:    "WriteAgentMemory",
				},
			},
		},
	}
}

func completePromotionEvidence(t *testing.T) *structpb.Struct {
	return completePromotionEvidenceWithSourceProfile(t, "scenario_sandbox")
}

func completePromotionEvidenceWithSourceProfile(t *testing.T, sourceProfile string) *structpb.Struct {
	t.Helper()
	out, err := structpb.NewStruct(map[string]any{
		"promotion_target_id":                 "RUNTIME_MEMORY_OR_COGNITION",
		"participation_id":                    "participation-1",
		"source_profile":                      sourceProfile,
		"output_candidate_ref":                "candidate-1",
		"audit_id":                            "audit-1",
		"provenance_ref":                      "provenance-1",
		"policy_verdict_ref":                  "policy-verdict-1",
		"memory_read_verdict":                 "PASS",
		"memory_write_verdict":                "PASS",
		"capability_scope_verdict":            "PASS",
		"target_owner_authorization_ref":      "target-owner-authorization-1",
		"explicit_user_or_manager_intent_ref": "manager-intent-1",
	})
	if err != nil {
		t.Fatalf("structpb.NewStruct: %v", err)
	}
	return out
}
