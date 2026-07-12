package runtimeagent

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func publicChatContinuityMemoryInput(id string, class runtimev1.MemoryCanonicalClass, scope runtimev1.MemoryBankScope, object string) publicChatPreTurnMemoryInput {
	return publicChatPreTurnMemoryInput{
		CanonicalClass: class,
		BankScope:      scope,
		View: &runtimev1.CanonicalMemoryView{Record: &runtimev1.MemoryRecord{
			MemoryId:       id,
			CanonicalClass: class,
			Payload: &runtimev1.MemoryRecord_Semantic{Semantic: &runtimev1.SemanticMemoryRecord{
				Subject: "user", Predicate: "preferred_name", Object: object,
			}},
		}},
	}
}

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

func TestPublicChatPreTurnMemoryReservesRecentScopedDyadicContinuity(t *testing.T) {
	primary := publicChatPreTurnMemoryInputs{Items: []publicChatPreTurnMemoryInput{
		publicChatContinuityMemoryInput("public-fact", runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_PUBLIC_SHARED, runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE, "public"),
	}}
	recentDyadic := publicChatPreTurnMemoryInputs{Items: []publicChatPreTurnMemoryInput{
		publicChatContinuityMemoryInput("preferred-name", runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_DYADIC, runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_DYADIC, "墨契"),
	}}
	merged, err := mergePublicChatPreTurnMemoryInputs(primary, recentDyadic)
	if err != nil {
		t.Fatalf("mergePublicChatPreTurnMemoryInputs: %v", err)
	}
	if len(merged.Items) != 2 || merged.Items[0].View.GetRecord().GetMemoryId() != "preferred-name" || merged.Items[1].View.GetRecord().GetMemoryId() != "public-fact" {
		t.Fatalf("recent dyadic continuity must be reserved before query recall: %+v", merged.Items)
	}
}

func TestPublicChatPreTurnMemoryRejectsConflictingRecallCopies(t *testing.T) {
	primary := publicChatPreTurnMemoryInputs{Items: []publicChatPreTurnMemoryInput{
		publicChatContinuityMemoryInput("preferred-name", runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_DYADIC, runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_DYADIC, "墨契"),
	}}
	recentDyadic := publicChatPreTurnMemoryInputs{Items: []publicChatPreTurnMemoryInput{
		publicChatContinuityMemoryInput("preferred-name", runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_DYADIC, runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_DYADIC, "蓝轨"),
	}}
	if _, err := mergePublicChatPreTurnMemoryInputs(primary, recentDyadic); status.Code(err) != codes.DataLoss {
		t.Fatalf("conflicting canonical memory copies must fail closed, got %v", err)
	}
}

func TestPublicChatPreTurnMemoryDeduplicatesEquivalentRecallViews(t *testing.T) {
	primaryInput := publicChatContinuityMemoryInput("preferred-name", runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_DYADIC, runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_DYADIC, "墨契")
	primaryInput.View.RecallScore = 0.9
	primaryInput.View.PolicyReason = "query_agent_memory"
	recentInput := publicChatContinuityMemoryInput("preferred-name", runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_DYADIC, runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_DYADIC, "墨契")
	recentInput.View.PolicyReason = "query_agent_memory_history"
	merged, err := mergePublicChatPreTurnMemoryInputs(
		publicChatPreTurnMemoryInputs{Items: []publicChatPreTurnMemoryInput{primaryInput}},
		publicChatPreTurnMemoryInputs{Items: []publicChatPreTurnMemoryInput{recentInput}},
	)
	if err != nil {
		t.Fatalf("equivalent recall views must deduplicate: %v", err)
	}
	if len(merged.Items) != 1 || merged.Items[0].View.GetRecord().GetMemoryId() != "preferred-name" {
		t.Fatalf("equivalent recall views were not deduplicated: %+v", merged.Items)
	}
}

func TestPublicChatPreferredNameMemoryProjectsAsRelationalContinuity(t *testing.T) {
	for _, predicate := range []string{"preferred_name", "preferred-designation", "has nickname", "is_addressed_as", "relationship_status"} {
		record := &runtimev1.MemoryRecord{
			MemoryId: "memory-" + predicate,
			Provenance: &runtimev1.MemoryProvenance{
				SourceSystem:  "runtime.agent.internal.chat_sidecar",
				SourceEventId: "turn-relationship",
			},
			Payload: &runtimev1.MemoryRecord_Semantic{Semantic: &runtimev1.SemanticMemoryRecord{
				Subject: "user", Predicate: predicate, Object: "墨契",
			}},
		}
		if !publicChatCanonicalMemoryIsRelational(record) {
			t.Fatalf("predicate %q must be relational continuity", predicate)
		}
		memory, relationships, err := publicChatAgentTurnMemoryInputs(publicChatPreTurnMemoryInputs{Items: []publicChatPreTurnMemoryInput{{
			CanonicalClass: runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_DYADIC,
			BankScope:      runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_DYADIC,
			View:           &runtimev1.CanonicalMemoryView{Record: record},
		}}})
		if err != nil {
			t.Fatalf("project predicate %q: %v", predicate, err)
		}
		if len(memory) != 1 || len(relationships) != 1 || relationships[0].Summary != "user "+predicate+" 墨契" {
			t.Fatalf("predicate %q projection mismatch: memory=%+v relationships=%+v", predicate, memory, relationships)
		}
	}

	nonRelational := &runtimev1.MemoryRecord{Payload: &runtimev1.MemoryRecord_Semantic{Semantic: &runtimev1.SemanticMemoryRecord{
		Subject: "user", Predicate: "not_relationship", Object: "unrelated",
	}}}
	if publicChatCanonicalMemoryIsRelational(nonRelational) {
		t.Fatal("non-relational predicate must not gain mandatory relationship authority")
	}
}
