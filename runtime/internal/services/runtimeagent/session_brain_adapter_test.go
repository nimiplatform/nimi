package runtimeagent

import (
	"context"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
)

func TestSessionBrainAdapterPropagatesRuntimeAccountSubjectOnDetachedContext(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	agentRef := testRuntimeAgentLocalRef("agent-alpha")
	const expectedAccount = "user-1"

	var observedSubjects []string
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(ctx context.Context, req *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			if len(observedSubjects) == 0 {
				const marker = "offline-recall-fixture"
				if strings.Contains(req.SystemPrompt, marker) || len(req.Messages) < 3 {
					t.Fatalf("unexpected recall placement")
				}
				msgs := req.Messages[len(req.Messages)-3:]
				if msgs[0].Role != "assistant" || msgs[1].Role != "tool" || msgs[2].Role != "user" || msgs[2].GetContent() != "hello" {
					t.Fatalf("wrong recall exchange or changed user input")
				}
				call := msgs[0].GetTurnItems()[0].GetOutput().GetToolCall()
				result := msgs[1].GetTurnItems()[0].GetToolResult()
				if call.GetId() == "" || result.GetToolCallId() != call.GetId() || result.GetResult().GetStringValue() != marker {
					t.Fatal("unpaired recall result")
				}
			}
			subject, ok := executionintent.RuntimeAccountSubjectFromContext(ctx)
			if !ok {
				subject = ""
			}
			observedSubjects = append(observedSubjects, subject)
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
				Payload: &runtimev1.StreamScenarioEvent_Delta{
					Delta: runtimeAgentTextStreamDelta("ok"),
				},
			}); err != nil {
				return err
			}
			return emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
				Payload: &runtimev1.StreamScenarioEvent_Completed{
					Completed: &runtimev1.ScenarioStreamCompleted{
						FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
						Usage:        &runtimev1.UsageStats{InputTokens: 5, OutputTokens: 2},
					},
				},
			})
		},
	})

	// 1. ExecuteBrainInlineTurn called with bare context.Background()
	if err := svc.ExecuteBrainInlineTurn(context.Background(), BrainInlineTurnRuntimeInput{
		AccountID:            expectedAccount,
		CallerAppID:          "nimi.desktop",
		LocalAgentRef:        agentRef,
		WorkSessionRef:       "ws_brain_inline_1",
		SessionKind:          "general_inbox",
		TrustTier:            "trusted",
		UserText:             "hello",
		OfflineRecallContext: "offline-recall-fixture",
		RequestID:            "req-inline-1",
	}, func(_, _ string, _ bool) error { return nil }); err != nil {
		t.Fatalf("ExecuteBrainInlineTurn: %v", err)
	}

	// 2. ExecuteAgentBodyStep called with bare context.Background()
	if _, err := svc.ExecuteAgentBodyStep(context.Background(), BodyStepRuntimeInput{
		AccountID:      expectedAccount,
		CallerAppID:    "nimi.harness",
		AgentBinding:   agentRef,
		WorkSessionRef: "ws_body_step_1",
		Purpose:        runtimev1.BodyStepPurpose_BODY_STEP_PURPOSE_INFERENCE,
		CanonicalMessages: []*runtimev1.BodyWorkingMessage{
			{Role: "user", ContentJson: `"check status"`},
		},
	}, BodyStepRuntimeCallbacks{}); err != nil {
		t.Fatalf("ExecuteAgentBodyStep: %v", err)
	}

	// 3. RunAlarmLLM called with bare context.Background()
	if _, _, _, err := svc.RunAlarmLLM(
		context.Background(),
		expectedAccount,
		agentRef,
		"Standup reminder",
		"Starts in 5 minutes",
		"ws_alarm_1", func(int64) error { return nil },
	); err != nil {
		t.Fatalf("RunAlarmLLM: %v", err)
	}

	if len(observedSubjects) != 3 {
		t.Fatalf("expected 3 StreamChatTurn calls, got %d (%v)", len(observedSubjects), observedSubjects)
	}
	for i, got := range observedSubjects {
		if got != expectedAccount {
			t.Fatalf("call %d: expected RuntimeAccountSubject=%q in StreamChatTurn ctx, got %q", i, expectedAccount, got)
		}
	}
}
