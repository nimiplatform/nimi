package runtimeagent

import (
	"context"
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
		stream: func(ctx context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
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
		AccountID:      expectedAccount,
		CallerAppID:    "nimi.desktop",
		LocalAgentRef:  agentRef,
		WorkSessionRef: "ws_brain_inline_1",
		SessionKind:    "general_inbox",
		TrustTier:      "trusted",
		UserText:       "hello",
		RequestID:      "req-inline-1",
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
