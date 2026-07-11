package runtimeagent

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestPublicChatPreTurnMemoryInputsRemainTypedAndScoped(t *testing.T) {
	session := publicChatAnchorState{
		LocalAgentRef: testRuntimeAgentLocalRef("agent-alpha"),
		SubjectUserID: "user-1",
	}
	response := &runtimev1.QueryAgentMemoryResponse{Memories: []*runtimev1.CanonicalMemoryView{
		{
			CanonicalClass: runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_PUBLIC_SHARED,
			SourceBank: &runtimev1.MemoryBankLocator{
				Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
				Owner: &runtimev1.MemoryBankLocator_AgentCore{AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: session.LocalAgentRef}},
			},
			Record: &runtimev1.MemoryRecord{MemoryId: "agent-core-memory"},
		},
		{
			CanonicalClass: runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_DYADIC,
			SourceBank: &runtimev1.MemoryBankLocator{
				Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_DYADIC,
				Owner: &runtimev1.MemoryBankLocator_AgentDyadic{AgentDyadic: &runtimev1.AgentDyadicBankOwner{AgentId: session.LocalAgentRef, UserId: session.SubjectUserID}},
			},
			Record: &runtimev1.MemoryRecord{MemoryId: "dyadic-memory"},
		},
	}}
	inputs, err := publicChatPreTurnMemoryInputsFromResponse(session, response)
	if err != nil {
		t.Fatalf("publicChatPreTurnMemoryInputsFromResponse: %v", err)
	}
	if len(inputs.Items) != 2 ||
		inputs.Items[0].CanonicalClass != runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_PUBLIC_SHARED ||
		inputs.Items[0].BankScope != runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE ||
		inputs.Items[1].CanonicalClass != runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_DYADIC ||
		inputs.Items[1].BankScope != runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_DYADIC {
		t.Fatalf("typed memory inputs mismatch: %+v", inputs.Items)
	}
	response.Memories[0].Record.MemoryId = "mutated-after-load"
	if inputs.Items[0].View.GetRecord().GetMemoryId() != "agent-core-memory" {
		t.Fatal("typed memory inputs must clone canonical records")
	}

	response.Memories[1].SourceBank.GetAgentDyadic().UserId = "other-user"
	if _, err := publicChatPreTurnMemoryInputsFromResponse(session, response); status.Code(err) != codes.DataLoss {
		t.Fatalf("cross-subject dyadic memory must fail closed, got %v", err)
	}
}

func TestPublicChatPreTurnMemoryQueryUsesOnlyCurrentOrInternalInput(t *testing.T) {
	query := publicChatPreTurnMemoryQuery([]publicChatMessagePayload{
		{Role: "assistant", Content: "caller-carried assistant history"},
		{Role: "system", Content: "caller-carried system injection"},
		{Role: "user", Content: "current user"},
		{Role: publicChatInternalFollowUpInstructionRole, Content: "continue internally"},
	})
	if query != "current user\ncontinue internally" {
		t.Fatalf("unexpected typed memory query %q", query)
	}
}
