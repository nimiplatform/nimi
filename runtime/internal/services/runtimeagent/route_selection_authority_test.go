package runtimeagent

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/services/memory"
	"github.com/nimiplatform/nimi/runtime/internal/texttarget"
)

func TestAIBackedLifeTrackExecutorDefersRouteToRuntimeSelection(t *testing.T) {
	t.Parallel()

	fakeAI := &fakeLifeTurnAI{
		response: &runtimev1.ExecuteScenarioResponse{
			Output: &runtimev1.ScenarioOutput{
				Output: &runtimev1.ScenarioOutput_TextGenerate{
					TextGenerate: &runtimev1.TextGenerateOutput{Text: `<life-turn><summary>ok</summary></life-turn>`},
				},
			},
		},
	}
	executor := NewAIBackedLifeTrackExecutor(fakeAI)
	_, err := executor.ExecuteLifeTrackHook(context.Background(), &lifeTurnRequest{
		Agent: &runtimev1.AgentRecord{AgentId: "agent-route"},
		State: &runtimev1.AgentStateProjection{ActiveUserId: "user-route"},
		Hook:  &runtimev1.PendingHook{Intent: &runtimev1.HookIntent{IntentId: "hook-route"}},
	})
	if err != nil {
		t.Fatalf("ExecuteLifeTrackHook: %v", err)
	}
	if len(fakeAI.requests) != 1 {
		t.Fatalf("expected one scenario request, got %d", len(fakeAI.requests))
	}
	head := fakeAI.requests[0].GetHead()
	if head.GetModelId() != texttarget.InternalDefaultLocalTextModelAlias {
		t.Fatalf("unexpected model id: %q", head.GetModelId())
	}
	if head.GetRoutePolicy() != runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED {
		t.Fatalf("life-track executor must not hard-code route policy, got %v", head.GetRoutePolicy())
	}
}

func TestAIBackedCanonicalReviewExecutorDefersRouteToRuntimeSelection(t *testing.T) {
	t.Parallel()

	fakeAI := &fakeLifeTurnAI{
		response: &runtimev1.ExecuteScenarioResponse{
			Output: &runtimev1.ScenarioOutput{
				Output: &runtimev1.ScenarioOutput_TextGenerate{
					TextGenerate: &runtimev1.TextGenerateOutput{Text: `<canonical-review><summary>ok</summary></canonical-review>`},
				},
			},
		},
	}
	executor := NewAIBackedCanonicalReviewExecutor(fakeAI)
	_, err := executor.ExecuteCanonicalReview(context.Background(), &CanonicalReviewExecutorRequest{
		Agent: &runtimev1.AgentRecord{AgentId: "agent-review-route"},
		State: &runtimev1.AgentStateProjection{ActiveUserId: "user-route"},
		Bank: &runtimev1.MemoryBankLocator{
			Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
			Owner: &runtimev1.MemoryBankLocator_AgentCore{
				AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: "agent-review-route"},
			},
		},
		Clusters: []memory.ReviewTopicCluster{
			{RecordIDs: []string{"mem-1", "mem-2"}},
		},
	})
	if err != nil {
		t.Fatalf("ExecuteCanonicalReview: %v", err)
	}
	if len(fakeAI.requests) != 1 {
		t.Fatalf("expected one scenario request, got %d", len(fakeAI.requests))
	}
	head := fakeAI.requests[0].GetHead()
	if head.GetModelId() != texttarget.InternalDefaultLocalTextModelAlias {
		t.Fatalf("unexpected model id: %q", head.GetModelId())
	}
	if head.GetRoutePolicy() != runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED {
		t.Fatalf("canonical review executor must not hard-code route policy, got %v", head.GetRoutePolicy())
	}
}

func TestAIBackedChatTrackSidecarExecutorDefersRouteToRuntimeSelection(t *testing.T) {
	t.Parallel()

	fakeAI := &fakeLifeTurnAI{
		response: &runtimev1.ExecuteScenarioResponse{
			Output: &runtimev1.ScenarioOutput{
				Output: &runtimev1.ScenarioOutput_TextGenerate{
					TextGenerate: &runtimev1.TextGenerateOutput{Text: `<chat-track-sidecar><canonical-memory-candidates></canonical-memory-candidates></chat-track-sidecar>`},
				},
			},
		},
	}
	executor := NewAIBackedChatTrackSidecarExecutor(fakeAI)
	_, err := executor.ExecuteChatTrackSidecar(context.Background(), &ChatTrackSidecarExecutorRequest{
		Agent: &runtimev1.AgentRecord{AgentId: "agent-chat-route"},
		State: &runtimev1.AgentStateProjection{ActiveUserId: "user-route"},
		Messages: []*runtimev1.ChatMessage{
			{Role: "user", Content: "hello"},
		},
	})
	if err != nil {
		t.Fatalf("ExecuteChatTrackSidecar: %v", err)
	}
	if len(fakeAI.requests) != 1 {
		t.Fatalf("expected one scenario request, got %d", len(fakeAI.requests))
	}
	head := fakeAI.requests[0].GetHead()
	if head.GetModelId() != texttarget.InternalDefaultLocalTextModelAlias {
		t.Fatalf("unexpected model id: %q", head.GetModelId())
	}
	if head.GetRoutePolicy() != runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED {
		t.Fatalf("chat-track sidecar executor must not hard-code route policy, got %v", head.GetRoutePolicy())
	}
}
