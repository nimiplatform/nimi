package runtimeagent

import (
	"context"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestQueryAgentMemoryRejectsDyadicReadWithoutOwnerContext(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{AgentId: "agent-read-scope"}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}
	if _, err := svc.UpdateAgentState(ctx, &runtimev1.UpdateAgentStateRequest{
		AgentId: "agent-read-scope",
		Mutations: []*runtimev1.AgentStateMutation{
			{
				Mutation: &runtimev1.AgentStateMutation_SetDyadicContext{
					SetDyadicContext: &runtimev1.AgentStateSetDyadicContext{UserId: "user-1"},
				},
			},
		},
	}); err != nil {
		t.Fatalf("UpdateAgentState: %v", err)
	}
	if _, err := svc.WriteAgentMemory(ctx, &runtimev1.WriteAgentMemoryRequest{
		AgentId: "agent-read-scope",
		Candidates: []*runtimev1.CanonicalMemoryCandidate{
			{
				CanonicalClass: runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_DYADIC,
				TargetBank: &runtimev1.MemoryBankLocator{
					Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_DYADIC,
					Owner: &runtimev1.MemoryBankLocator_AgentDyadic{
						AgentDyadic: &runtimev1.AgentDyadicBankOwner{AgentId: "agent-read-scope", UserId: "user-1"},
					},
				},
				Extensions: completePromotionEvidence(t),
				Record: &runtimev1.MemoryRecordInput{
					Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
					Payload: &runtimev1.MemoryRecordInput_Observational{
						Observational: &runtimev1.ObservationalMemoryRecord{Observation: "private dyadic memory"},
					},
				},
			},
		},
	}); err != nil {
		t.Fatalf("WriteAgentMemory: %v", err)
	}

	_, err := svc.QueryAgentMemory(ctx, &runtimev1.QueryAgentMemoryRequest{
		AgentId:          "agent-read-scope",
		CanonicalClasses: []runtimev1.MemoryCanonicalClass{runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_DYADIC},
	})
	if status.Code(err) != codes.PermissionDenied {
		t.Fatalf("expected PermissionDenied without canonical read-scope context, got %v", err)
	}
	if !strings.Contains(err.Error(), "attach_canonical_memory_read_scope_context") {
		t.Fatalf("expected read-scope action hint, got %v", err)
	}

	_, err = svc.QueryAgentMemory(ctx, &runtimev1.QueryAgentMemoryRequest{
		Context:          &runtimev1.AgentRequestContext{SubjectUserId: "user-2"},
		AgentId:          "agent-read-scope",
		CanonicalClasses: []runtimev1.MemoryCanonicalClass{runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_DYADIC},
	})
	if status.Code(err) != codes.PermissionDenied {
		t.Fatalf("expected PermissionDenied for mismatched canonical read-scope context, got %v", err)
	}

	resp, err := svc.QueryAgentMemory(ctx, &runtimev1.QueryAgentMemoryRequest{
		Context:          &runtimev1.AgentRequestContext{SubjectUserId: "user-1"},
		AgentId:          "agent-read-scope",
		CanonicalClasses: []runtimev1.MemoryCanonicalClass{runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_DYADIC},
	})
	if err != nil {
		t.Fatalf("QueryAgentMemory with canonical read-scope context: %v", err)
	}
	if len(resp.GetMemories()) != 1 {
		t.Fatalf("expected one dyadic memory, got %#v", resp.GetMemories())
	}
}
