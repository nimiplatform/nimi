package runtimeagent

import (
	"context"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/services/memory"
)

// committedConfigTestBinding is the committed Runtime Agent AI Config
// text.generate binding runtime stamps into runtime-private executor requests
// (K-AGCORE-147).
var committedConfigTestBinding = publicChatExecutionBinding{
	ModelID:     "local/qwen3-chat",
	RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
}

func assertCapturedCommittedConfigIntent(t *testing.T, fakeAI *fakeLifeTurnAI, index int) {
	t.Helper()
	if fakeAI == nil || index < 0 || index >= len(fakeAI.contexts) {
		t.Fatalf("missing captured execution context at index %d", index)
	}
	intent, ok := executionintent.FromContext(fakeAI.contexts[index])
	if !ok || !intent.IsLocal() || intent.CapabilityContract != "text.generate" {
		t.Fatalf("committed private execution intent = %+v, ok=%v", intent, ok)
	}
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
		Agent:            &runtimev1.LocalAgentRecord{LocalAgentRef: "agent-route"},
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
	assertCapturedCommittedConfigIntent(t, fakeAI, 0)
}

func TestAIBackedLifeTrackExecutorFailsClosedWithoutConfigBinding(t *testing.T) {
	t.Parallel()

	fakeAI := &fakeLifeTurnAI{}
	executor := NewAIBackedLifeTrackExecutor(fakeAI)
	_, err := executor.ExecuteLifeTrackHook(context.Background(), &lifeTurnRequest{
		Agent: &runtimev1.LocalAgentRecord{LocalAgentRef: "agent-route"},
		State: &runtimev1.AgentStateProjection{ActiveUserId: "user-route"},
		Hook:  &runtimev1.PendingHook{Intent: &runtimev1.HookIntent{IntentId: "hook-route"}},
	})
	if err == nil || !strings.Contains(err.Error(), "exact machine execution binding") {
		t.Fatalf("expected fail-closed missing Runtime Agent AI Config text.generate intent rejection, got %v", err)
	}
	if len(fakeAI.requests) != 0 {
		t.Fatalf("life-track executor must not execute without the committed Runtime Agent AI Config binding")
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
		Agent: &runtimev1.LocalAgentRecord{LocalAgentRef: "agent-review-route"},
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
	assertCapturedCommittedConfigIntent(t, fakeAI, 0)
}

func TestAIBackedCanonicalReviewExecutorFailsClosedWithoutConfigBinding(t *testing.T) {
	t.Parallel()

	fakeAI := &fakeLifeTurnAI{}
	executor := NewAIBackedCanonicalReviewExecutor(fakeAI)
	_, err := executor.ExecuteCanonicalReview(context.Background(), &CanonicalReviewExecutorRequest{
		Agent: &runtimev1.LocalAgentRecord{LocalAgentRef: "agent-review-route"},
		State: &runtimev1.AgentStateProjection{ActiveUserId: "user-route"},
		Bank: &runtimev1.MemoryBankLocator{
			Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
			Owner: &runtimev1.MemoryBankLocator_AgentCore{
				AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: testRuntimeAgentLocalRef("agent-review-route")},
			},
		},
	})
	if err == nil || !strings.Contains(err.Error(), "exact machine execution binding") {
		t.Fatalf("expected fail-closed missing Runtime Agent AI Config text.generate intent rejection, got %v", err)
	}
	if len(fakeAI.requests) != 0 {
		t.Fatalf("canonical review executor must not execute without the committed Runtime Agent AI Config binding")
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
		Agent: &runtimev1.LocalAgentRecord{LocalAgentRef: "agent-chat-route"},
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
	assertCapturedCommittedConfigIntent(t, fakeAI, 0)
	head := fakeAI.requests[0].GetHead()
	if head.GetTimeoutMs() != publicChatDefaultTurnTimeoutMs {
		t.Fatalf("chat-track sidecar must share the provider-compatible public turn timeout budget, got %d", head.GetTimeoutMs())
	}
}

func TestAIBackedChatTrackSidecarExecutorFailsClosedWithoutConfigBinding(t *testing.T) {
	t.Parallel()

	fakeAI := &fakeLifeTurnAI{}
	executor := NewAIBackedChatTrackSidecarExecutor(fakeAI)
	_, err := executor.ExecuteChatTrackSidecar(context.Background(), &ChatTrackSidecarExecutorRequest{
		Agent: &runtimev1.LocalAgentRecord{LocalAgentRef: "agent-chat-route"},
		State: &runtimev1.AgentStateProjection{ActiveUserId: "user-route"},
		Messages: []*runtimev1.ChatMessage{
			{Role: "user", Content: "hello"},
		},
	})
	if err == nil || !strings.Contains(err.Error(), "exact machine execution binding") {
		t.Fatalf("expected fail-closed missing Runtime Agent AI Config text.generate intent rejection, got %v", err)
	}
	if len(fakeAI.requests) != 0 {
		t.Fatalf("chat-track sidecar executor must not execute without the committed Runtime Agent AI Config binding")
	}
}

// TestChatTrackSidecarServiceCarriesCommittedConfigIntent proves the service
// path carries the committed Runtime Agent AIConfig route privately.
func TestChatTrackSidecarServiceCarriesCommittedConfigIntent(t *testing.T) {
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
	upsertPublicChatTestAgentAIConfig(t, svc, publicChatExecutionBinding{
		BindingAlias: "local/qwen3-chat", ModelID: "local/qwen3-chat",
		RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		TargetRef:   publicChatTestLocalRuntimeTargetRef("test_runtime_readiness:v2:qwen3-chat"),
	})
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
	assertCapturedCommittedConfigIntent(t, fakeAI, 0)
}
