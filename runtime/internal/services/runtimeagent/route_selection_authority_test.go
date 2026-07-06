package runtimeagent

import (
	"context"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/services/memory"
)

// committedConfigTestBinding is the committed execution config text.generate
// binding runtime stamps into runtime-private executor requests
// (K-AGCORE-147).
var committedConfigTestBinding = publicChatExecutionBinding{
	ModelID:     "local/qwen3-chat",
	RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
}

func TestAIBackedLifeTrackExecutorUsesCommittedConfigBinding(t *testing.T) {
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
		Agent:            &runtimev1.AgentRecord{AgentId: "agent-route"},
		State:            &runtimev1.AgentStateProjection{ActiveUserId: "user-route"},
		Hook:             &runtimev1.PendingHook{Intent: &runtimev1.HookIntent{IntentId: "hook-route"}},
		ExecutionBinding: committedConfigTestBinding,
	})
	if err != nil {
		t.Fatalf("ExecuteLifeTrackHook: %v", err)
	}
	if len(fakeAI.requests) != 1 {
		t.Fatalf("expected one scenario request, got %d", len(fakeAI.requests))
	}
	head := fakeAI.requests[0].GetHead()
	if head.GetModelId() != committedConfigTestBinding.ModelID {
		t.Fatalf("expected committed config model, got %q", head.GetModelId())
	}
	if head.GetRoutePolicy() != committedConfigTestBinding.RoutePolicy {
		t.Fatalf("expected committed config route policy, got %v", head.GetRoutePolicy())
	}
}

func TestAIBackedLifeTrackExecutorFailsClosedWithoutConfigBinding(t *testing.T) {
	t.Parallel()

	fakeAI := &fakeLifeTurnAI{}
	executor := NewAIBackedLifeTrackExecutor(fakeAI)
	_, err := executor.ExecuteLifeTrackHook(context.Background(), &lifeTurnRequest{
		Agent: &runtimev1.AgentRecord{AgentId: "agent-route"},
		State: &runtimev1.AgentStateProjection{ActiveUserId: "user-route"},
		Hook:  &runtimev1.PendingHook{Intent: &runtimev1.HookIntent{IntentId: "hook-route"}},
	})
	if err == nil || !strings.Contains(err.Error(), "committed execution config text.generate binding") {
		t.Fatalf("expected fail-closed missing config binding rejection, got %v", err)
	}
	if len(fakeAI.requests) != 0 {
		t.Fatalf("life-track executor must not execute without the committed config binding")
	}
}

func TestAIBackedCanonicalReviewExecutorUsesCommittedConfigBinding(t *testing.T) {
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
				AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: testRuntimeAgentLocalRef("agent-review-route")},
			},
		},
		Clusters: []memory.ReviewTopicCluster{
			{RecordIDs: []string{"mem-1", "mem-2"}},
		},
		ExecutionBinding: committedConfigTestBinding,
	})
	if err != nil {
		t.Fatalf("ExecuteCanonicalReview: %v", err)
	}
	if len(fakeAI.requests) != 1 {
		t.Fatalf("expected one scenario request, got %d", len(fakeAI.requests))
	}
	head := fakeAI.requests[0].GetHead()
	if head.GetModelId() != committedConfigTestBinding.ModelID {
		t.Fatalf("expected committed config model, got %q", head.GetModelId())
	}
	if head.GetRoutePolicy() != committedConfigTestBinding.RoutePolicy {
		t.Fatalf("expected committed config route policy, got %v", head.GetRoutePolicy())
	}
}

func TestAIBackedCanonicalReviewExecutorFailsClosedWithoutConfigBinding(t *testing.T) {
	t.Parallel()

	fakeAI := &fakeLifeTurnAI{}
	executor := NewAIBackedCanonicalReviewExecutor(fakeAI)
	_, err := executor.ExecuteCanonicalReview(context.Background(), &CanonicalReviewExecutorRequest{
		Agent: &runtimev1.AgentRecord{AgentId: "agent-review-route"},
		State: &runtimev1.AgentStateProjection{ActiveUserId: "user-route"},
		Bank: &runtimev1.MemoryBankLocator{
			Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
			Owner: &runtimev1.MemoryBankLocator_AgentCore{
				AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: testRuntimeAgentLocalRef("agent-review-route")},
			},
		},
	})
	if err == nil || !strings.Contains(err.Error(), "committed execution config text.generate binding") {
		t.Fatalf("expected fail-closed missing config binding rejection, got %v", err)
	}
	if len(fakeAI.requests) != 0 {
		t.Fatalf("canonical review executor must not execute without the committed config binding")
	}
}

func TestAIBackedChatTrackSidecarExecutorUsesCommittedConfigBinding(t *testing.T) {
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
		ExecutionBinding: committedConfigTestBinding,
	})
	if err != nil {
		t.Fatalf("ExecuteChatTrackSidecar: %v", err)
	}
	if len(fakeAI.requests) != 1 {
		t.Fatalf("expected one scenario request, got %d", len(fakeAI.requests))
	}
	head := fakeAI.requests[0].GetHead()
	if head.GetModelId() != committedConfigTestBinding.ModelID {
		t.Fatalf("expected committed config model, got %q", head.GetModelId())
	}
	if head.GetRoutePolicy() != committedConfigTestBinding.RoutePolicy {
		t.Fatalf("expected committed config route policy, got %v", head.GetRoutePolicy())
	}
}

func TestAIBackedChatTrackSidecarExecutorFailsClosedWithoutConfigBinding(t *testing.T) {
	t.Parallel()

	fakeAI := &fakeLifeTurnAI{}
	executor := NewAIBackedChatTrackSidecarExecutor(fakeAI)
	_, err := executor.ExecuteChatTrackSidecar(context.Background(), &ChatTrackSidecarExecutorRequest{
		Agent: &runtimev1.AgentRecord{AgentId: "agent-chat-route"},
		State: &runtimev1.AgentStateProjection{ActiveUserId: "user-route"},
		Messages: []*runtimev1.ChatMessage{
			{Role: "user", Content: "hello"},
		},
	})
	if err == nil || !strings.Contains(err.Error(), "committed execution config text.generate binding") {
		t.Fatalf("expected fail-closed missing config binding rejection, got %v", err)
	}
	if len(fakeAI.requests) != 0 {
		t.Fatalf("chat-track sidecar executor must not execute without the committed config binding")
	}
}

// TestChatTrackSidecarServiceStampsCommittedConfigModel proves the service
// path stamps the committed (upserted) execution config text.generate model
// into the runtime-private sidecar scenario head (K-AGCORE-147).
func TestChatTrackSidecarServiceStampsCommittedConfigModel(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	fakeAI := &fakeLifeTurnAI{
		response: &runtimev1.ExecuteScenarioResponse{
			Output: &runtimev1.ScenarioOutput{
				Output: &runtimev1.ScenarioOutput_TextGenerate{
					TextGenerate: &runtimev1.TextGenerateOutput{Text: `<chat-track-sidecar><canonical-memory-candidates></canonical-memory-candidates></chat-track-sidecar>`},
				},
			},
		},
	}
	svc.SetChatTrackSidecarExecutor(NewAIBackedChatTrackSidecarExecutor(fakeAI))
	upsertPublicChatTestExecutionConfig(t, svc)
	if _, err := svc.UpsertAgentExecutionConfig(context.Background(), &runtimev1.UpsertAgentExecutionConfigRequest{
		Context:          &runtimev1.AgentRequestContext{AppId: "desktop.app"},
		ExpectedRevision: 2,
		Bindings: []*runtimev1.RuntimeAgentExecutionCapabilityBinding{
			{
				Capability:  executionCapabilityTextGenerate,
				ModelId:     "local/qwen3-chat",
				RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			},
		},
	}); err != nil {
		t.Fatalf("UpsertAgentExecutionConfig: %v", err)
	}
	if err := svc.ExecuteChatTrackSidecar(context.Background(), ChatTrackSidecarExecutionRequest{
		CallerAppID:   "desktop.app",
		AgentID:       testRuntimeAgentLocalRef("agent-alpha"),
		SourceEventID: "sidecar-config-model",
		Messages: []*runtimev1.ChatMessage{
			{Role: "user", Content: "hello"},
		},
	}); err != nil {
		t.Fatalf("ExecuteChatTrackSidecar: %v", err)
	}
	if len(fakeAI.requests) != 1 {
		t.Fatalf("expected one scenario request, got %d", len(fakeAI.requests))
	}
	if got := fakeAI.requests[0].GetHead().GetModelId(); got != "local/qwen3-chat" {
		t.Fatalf("expected upserted committed config model on sidecar head, got %q", got)
	}
}
