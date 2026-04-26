package runtimeagent

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestPublicChatTurnFailureProjectsRuntimeActionHintAndBindingContext(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(context.Context, *PublicChatTurnExecutionRequest, func(*runtimev1.StreamScenarioEvent) error) error {
			return grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
				ActionHint: "inspect_local_runtime_model_health",
				Message:    "local model unavailable during runtime public chat preflight",
			})
		},
	})
	err := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"agent_id":               "agent-alpha",
			"conversation_anchor_id": anchorID,
			"thread_id":              "thread-preflight-failure",
			"messages": []any{
				map[string]any{"role": "user", "content": "hello"},
			},
			"execution_binding": map[string]any{
				"route":    "local",
				"model_id": "local/default",
			},
		}),
	})
	if err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(request): %v", err)
	}
	accepted := capture.waitForMessageType(t, publicChatTurnAcceptedType)
	failed := capture.waitForMessageType(t, publicChatTurnFailedType)
	failedDetail := publicChatTurnDetail(t, failed)
	if got := failedDetail["reason_code"]; got != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE.String() {
		t.Fatalf("expected AI_LOCAL_MODEL_UNAVAILABLE failed.detail.reason_code, got=%v", failedDetail)
	}
	if got := publicChatPayloadMap(t, accepted)["conversation_anchor_id"].(string); got != anchorID {
		t.Fatalf("expected accepted conversation_anchor_id=%s, got=%s", anchorID, got)
	}
	snapshot := requestPublicChatSessionSnapshot(t, svc, capture, anchorID, "snapshot-preflight-failure")
	lastTurn := publicChatLastTurnSnapshot(t, snapshot)
	if got := lastTurn["status"]; got != publicChatTurnStatusFailed {
		t.Fatalf("expected failed last_turn, got=%v", lastTurn)
	}
	if got := lastTurn["reason_code"]; got != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE.String() {
		t.Fatalf("expected failed reason_code in snapshot, got=%v", lastTurn)
	}
	if got := lastTurn["action_hint"]; got != "inspect_local_runtime_model_health" {
		t.Fatalf("expected action_hint in snapshot, got=%v", lastTurn)
	}
	if got := lastTurn["message"]; got != "local model unavailable during runtime public chat preflight" {
		t.Fatalf("expected message in snapshot, got=%v", lastTurn)
	}
	if got := lastTurn["model_resolved"]; got != "local/default" {
		t.Fatalf("expected model_resolved in snapshot, got=%v", lastTurn)
	}
	if got := lastTurn["route_decision"]; got != "local" {
		t.Fatalf("expected route_decision in snapshot, got=%v", lastTurn)
	}
	waitForPublicChatAgentIdle(t, svc, "agent-alpha")
}
func TestPublicChatFollowUpCancelsOnNewUserTurn(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})
	var mu sync.Mutex
	callCount := 0
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(_ context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			mu.Lock()
			callCount++
			currentCall := callCount
			mu.Unlock()
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   fmt.Sprintf("trace-cancel-follow-up-%d", currentCall),
				Payload: &runtimev1.StreamScenarioEvent_Started{
					Started: &runtimev1.ScenarioStreamStarted{
						ModelResolved: "qwen3-chat",
						RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
					},
				},
			}); err != nil {
				return err
			}
			envelope := publicChatStructuredEnvelopeAPML(fmt.Sprintf("message-%d", currentCall), fmt.Sprintf("turn-%d", currentCall))
			if currentCall == 1 {
				envelope = publicChatStructuredEnvelopeWithFollowUpAPML("message-1", "turn-1", "action-follow-up-1", "come back later", 150)
			}
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
				TraceId:   fmt.Sprintf("trace-cancel-follow-up-%d", currentCall),
				Payload: &runtimev1.StreamScenarioEvent_Delta{
					Delta: &runtimev1.ScenarioStreamDelta{
						Delta: &runtimev1.ScenarioStreamDelta_Text{
							Text: &runtimev1.TextStreamDelta{Text: envelope},
						},
					},
				},
			}); err != nil {
				return err
			}
			return emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
				TraceId:   fmt.Sprintf("trace-cancel-follow-up-%d", currentCall),
				Payload: &runtimev1.StreamScenarioEvent_Completed{
					Completed: &runtimev1.ScenarioStreamCompleted{
						FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
					},
				},
			})
		},
	})
	firstErr := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"agent_id":               "agent-alpha",
			"conversation_anchor_id": anchorID,
			"thread_id":              "thread-cancel-follow-up",
			"messages": []any{
				map[string]any{"role": "user", "content": "hello"},
			},
			"execution_binding": map[string]any{
				"route":    "local",
				"model_id": "local/default",
			},
		}),
	})
	if firstErr != nil {
		t.Fatalf("ConsumePublicChatAppMessage(first): %v", firstErr)
	}
	_ = capture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = capture.waitForMessageType(t, publicChatTurnStartedType)
	_ = capture.waitForMessageType(t, publicChatTurnTextDeltaType)
	_ = capture.waitForMessageType(t, publicChatTurnStructuredType)
	firstPostTurn := capture.waitForMessageType(t, publicChatTurnPostTurnType)
	_ = capture.waitForMessageType(t, publicChatTurnCompletedType)
	firstSnapshot := requestPublicChatSessionSnapshot(t, svc, capture, anchorID, "snapshot-cancel-follow-up-first")
	firstFollowUp := publicChatLastTurnSnapshot(t, firstSnapshot)["follow_up"].(map[string]any)
	if got := firstFollowUp["status"]; got != "scheduled" {
		t.Fatalf("expected snapshot last_turn.follow_up scheduled, got=%v", firstFollowUp)
	}
	if detail := publicChatTurnDetail(t, firstPostTurn); detail["action"] != nil {
		t.Fatalf("post_turn detail must not expose HookIntent as action indication, got=%v", detail)
	}
	requirePublicChatPostTurnHookIntent(t, firstPostTurn, "action-follow-up-1", "pending", 150)
	secondErr := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"agent_id":               "agent-alpha",
			"conversation_anchor_id": anchorID,
			"thread_id":              "thread-cancel-follow-up",
			"messages": []any{
				map[string]any{"role": "user", "content": "new user reply"},
			},
			"execution_binding": map[string]any{
				"route":    "local",
				"model_id": "local/default",
			},
		}),
	})
	if secondErr != nil {
		t.Fatalf("ConsumePublicChatAppMessage(second): %v", secondErr)
	}
	// Per Exec Pack 1 scope, there is no admitted runtime.agent.follow_up.*
	// public event family. Follow-up cancellation on new-user-turn must be
	// observed through the admitted session_envelope projection (last_turn
	// follow_up status), and through the next accepted turn's user origin.
	_ = capture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = capture.waitForMessageType(t, publicChatTurnStartedType)
	_ = capture.waitForMessageType(t, publicChatTurnTextDeltaType)
	_ = capture.waitForMessageType(t, publicChatTurnStructuredType)
	_ = capture.waitForMessageType(t, publicChatTurnPostTurnType)
	_ = capture.waitForMessageType(t, publicChatTurnCompletedType)
	secondSnapshot := requestPublicChatSessionSnapshot(t, svc, capture, anchorID, "snapshot-cancel-follow-up-second")
	if got := publicChatLastTurnSnapshot(t, secondSnapshot)["turn_origin"]; got != publicChatTurnOriginUser {
		t.Fatalf("expected second snapshot last_turn.turn_origin=user, got=%v", publicChatLastTurnSnapshot(t, secondSnapshot))
	}
	time.Sleep(250 * time.Millisecond)
	waitForPublicChatAgentIdle(t, svc, "agent-alpha")
	mu.Lock()
	if callCount != 2 {
		mu.Unlock()
		t.Fatalf("expected pending follow-up to be canceled before execution, got callCount=%d", callCount)
	}
	mu.Unlock()
}
func TestPublicChatFollowUpRecoversAfterRestart(t *testing.T) {
	t.Parallel()
	localStatePath := t.TempDir() + "/local-state.json"
	svc, closeFirst := newRuntimeAgentServiceForPublicChatStatePathWithClose(t, localStatePath)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	firstCapture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(firstCapture.emit)
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})
	var mu sync.Mutex
	callCount := 0
	executor := stubPublicChatTurnExecutor{
		stream: func(_ context.Context, req *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			mu.Lock()
			callCount++
			currentCall := callCount
			mu.Unlock()
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   fmt.Sprintf("trace-recovery-%d", currentCall),
				Payload: &runtimev1.StreamScenarioEvent_Started{
					Started: &runtimev1.ScenarioStreamStarted{
						ModelResolved: "qwen3-chat",
						RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
					},
				},
			}); err != nil {
				return err
			}
			var envelope string
			switch currentCall {
			case 1:
				envelope = publicChatStructuredEnvelopeWithFollowUpAPML("message-1", "persist me", "action-recover", "resume after restart", 200)
			case 2:
				if got := strings.TrimSpace(req.SystemPrompt); !strings.Contains(got, "resume after restart") {
					t.Fatalf("expected recovered follow-up system prompt, got=%q", got)
				}
				if len(req.Messages) < 2 || req.Messages[len(req.Messages)-1].GetContent() != "persist me" {
					t.Fatalf("expected recovered follow-up transcript to include persisted assistant text, got=%v", req.Messages)
				}
				envelope = publicChatStructuredEnvelopeAPML("message-2", "recovered follow up")
			default:
				t.Fatalf("unexpected recovered call count=%d", currentCall)
			}
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
				TraceId:   fmt.Sprintf("trace-recovery-%d", currentCall),
				Payload: &runtimev1.StreamScenarioEvent_Delta{
					Delta: &runtimev1.ScenarioStreamDelta{
						Delta: &runtimev1.ScenarioStreamDelta_Text{
							Text: &runtimev1.TextStreamDelta{Text: envelope},
						},
					},
				},
			}); err != nil {
				return err
			}
			return emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
				TraceId:   fmt.Sprintf("trace-recovery-%d", currentCall),
				Payload: &runtimev1.StreamScenarioEvent_Completed{
					Completed: &runtimev1.ScenarioStreamCompleted{
						FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
					},
				},
			})
		},
	}
	svc.SetPublicChatTurnExecutor(executor)
	err := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"agent_id":               "agent-alpha",
			"conversation_anchor_id": anchorID,
			"thread_id":              "thread-recovery",
			"messages": []any{
				map[string]any{"role": "user", "content": "hello"},
			},
			"execution_binding": map[string]any{
				"route":    "local",
				"model_id": "local/default",
			},
		}),
	})
	if err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(first): %v", err)
	}
	_ = firstCapture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = firstCapture.waitForMessageType(t, publicChatTurnStartedType)
	_ = firstCapture.waitForMessageType(t, publicChatTurnTextDeltaType)
	_ = firstCapture.waitForMessageType(t, publicChatTurnStructuredType)
	postTurn := firstCapture.waitForMessageType(t, publicChatTurnPostTurnType)
	_ = firstCapture.waitForMessageType(t, publicChatTurnCompletedType)
	firstSnapshot := requestPublicChatSessionSnapshot(t, svc, firstCapture, anchorID, "snapshot-recovery-first")
	firstFollowUp := publicChatLastTurnSnapshot(t, firstSnapshot)["follow_up"].(map[string]any)
	if got := firstFollowUp["status"]; got != "scheduled" {
		t.Fatalf("expected persisted snapshot last_turn.follow_up scheduled, got=%v", firstFollowUp)
	}
	if detail := publicChatTurnDetail(t, postTurn); detail["action"] != nil {
		t.Fatalf("post_turn detail must not expose HookIntent as action indication, got=%v", detail)
	}
	requirePublicChatPostTurnHookIntent(t, postTurn, "action-recover", "pending", 200)
	closeFirst()
	recoveredSvc, closeRecovered := newRuntimeAgentServiceForPublicChatStatePathWithClose(t, localStatePath)
	defer closeRecovered()
	recoveredCapture := newPublicChatEmitCapture()
	recoveredSvc.SetPublicChatAppEmitter(recoveredCapture.emit)
	recoveredSvc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})
	recoveredSvc.SetPublicChatTurnExecutor(executor)
	_ = recoveredCapture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = recoveredCapture.waitForMessageType(t, publicChatTurnStartedType)
	_ = recoveredCapture.waitForMessageType(t, publicChatTurnTextDeltaType)
	_ = recoveredCapture.waitForMessageType(t, publicChatTurnStructuredType)
	recoveredPostTurn := recoveredCapture.waitForMessageType(t, publicChatTurnPostTurnType)
	recoveredCompleted := recoveredCapture.waitForMessageType(t, publicChatTurnCompletedType)
	recoveredSnapshot := requestPublicChatSessionSnapshot(t, recoveredSvc, recoveredCapture, anchorID, "snapshot-recovery-second")
	recoveredLastTurn := publicChatLastTurnSnapshot(t, recoveredSnapshot)
	if got := recoveredLastTurn["turn_origin"]; got != publicChatTurnOriginFollowUp {
		t.Fatalf("expected recovered snapshot last_turn.turn_origin=follow_up, got=%v", recoveredLastTurn)
	}
	if got := recoveredLastTurn["follow_up_depth"]; got != float64(1) {
		t.Fatalf("expected recovered snapshot last_turn.follow_up_depth=1, got=%v", recoveredLastTurn)
	}
	recoveredFollowUp := recoveredLastTurn["follow_up"].(map[string]any)
	if got := recoveredFollowUp["status"]; got != "skipped" {
		t.Fatalf("expected recovered snapshot last_turn.follow_up skipped, got=%v", recoveredFollowUp)
	}
	if got := recoveredLastTurn["text"]; got != "recovered follow up" {
		t.Fatalf("unexpected recovered snapshot last_turn.text: %v", recoveredLastTurn)
	}
	if detail := publicChatTurnDetail(t, recoveredPostTurn); len(detail) > 1 {
		t.Fatalf("expected recovered post_turn detail to remain indication-only, got=%v", detail)
	}
	if detail := publicChatTurnDetail(t, recoveredCompleted); len(detail) != 1 || detail["terminal_reason"] != "stop" {
		t.Fatalf("completed detail must be terminal_reason-only, got=%v", detail)
	}
	waitForPublicChatAgentIdle(t, recoveredSvc, "agent-alpha")
	mu.Lock()
	defer mu.Unlock()
	if callCount != 2 {
		t.Fatalf("expected executor to run original turn plus recovered follow-up, got=%d", callCount)
	}
}
func TestPublicChatFollowUpCancelsOnSessionReuseWithoutThreadReplay(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})
	var mu sync.Mutex
	callCount := 0
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(_ context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			mu.Lock()
			callCount++
			currentCall := callCount
			mu.Unlock()
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   fmt.Sprintf("trace-session-reuse-%d", currentCall),
				Payload: &runtimev1.StreamScenarioEvent_Started{
					Started: &runtimev1.ScenarioStreamStarted{
						ModelResolved: "qwen3-chat",
						RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
					},
				},
			}); err != nil {
				return err
			}
			var envelope string
			switch currentCall {
			case 1:
				envelope = publicChatStructuredEnvelopeWithFollowUpAPML("message-1", "hello from runtime", "action-follow-up-1", "continue naturally", 200)
			default:
				envelope = publicChatStructuredEnvelopeAPML("message-2", "new user reply handled")
			}
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
				TraceId:   fmt.Sprintf("trace-session-reuse-%d", currentCall),
				Payload: &runtimev1.StreamScenarioEvent_Delta{
					Delta: &runtimev1.ScenarioStreamDelta{
						Delta: &runtimev1.ScenarioStreamDelta_Text{
							Text: &runtimev1.TextStreamDelta{Text: envelope},
						},
					},
				},
			}); err != nil {
				return err
			}
			return emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
				TraceId:   fmt.Sprintf("trace-session-reuse-%d", currentCall),
				Payload: &runtimev1.StreamScenarioEvent_Completed{
					Completed: &runtimev1.ScenarioStreamCompleted{
						FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
					},
				},
			})
		},
	})
	err := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"agent_id":               "agent-alpha",
			"conversation_anchor_id": anchorID,
			"thread_id":              "thread-session-reuse-cancel",
			"messages": []any{
				map[string]any{"role": "user", "content": "hello"},
			},
			"execution_binding": map[string]any{
				"route":    "local",
				"model_id": "local/default",
			},
		}),
	})
	if err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(first): %v", err)
	}
	firstAccepted := capture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = capture.waitForMessageType(t, publicChatTurnStartedType)
	_ = capture.waitForMessageType(t, publicChatTurnTextDeltaType)
	_ = capture.waitForMessageType(t, publicChatTurnPostTurnType)
	_ = capture.waitForMessageType(t, publicChatTurnCompletedType)
	firstSnapshot := requestPublicChatSessionSnapshot(t, svc, capture, anchorID, "snapshot-session-reuse-first")
	firstFollowUp := publicChatLastTurnSnapshot(t, firstSnapshot)["follow_up"].(map[string]any)
	if got := firstFollowUp["status"]; got != "scheduled" {
		t.Fatalf("expected snapshot last_turn.follow_up scheduled, got=%v", firstFollowUp)
	}
	if got := publicChatPayloadMap(t, firstAccepted)["conversation_anchor_id"].(string); got != anchorID {
		t.Fatalf("expected accepted conversation_anchor_id=%s, got=%s", anchorID, got)
	}
	secondErr := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"agent_id":               "agent-alpha",
			"conversation_anchor_id": anchorID,
			"messages": []any{
				map[string]any{"role": "user", "content": "new user reply"},
			},
		}),
	})
	if secondErr != nil {
		t.Fatalf("ConsumePublicChatAppMessage(second): %v", secondErr)
	}
	// Anchor reuse with new user-originated turn must invalidate the pending
	// follow-up without requiring any runtime.agent.follow_up.* public event
	// (not admitted in Exec Pack 1). Verification uses the admitted accepted
	// projection plus the executor call-count invariant.
	_ = capture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = capture.waitForMessageType(t, publicChatTurnStartedType)
	_ = capture.waitForMessageType(t, publicChatTurnTextDeltaType)
	_ = capture.waitForMessageType(t, publicChatTurnStructuredType)
	_ = capture.waitForMessageType(t, publicChatTurnPostTurnType)
	_ = capture.waitForMessageType(t, publicChatTurnCompletedType)
	secondSnapshot := requestPublicChatSessionSnapshot(t, svc, capture, anchorID, "snapshot-session-reuse-second")
	if got := publicChatLastTurnSnapshot(t, secondSnapshot)["turn_origin"]; got != publicChatTurnOriginUser {
		t.Fatalf("expected second snapshot last_turn.turn_origin=user, got=%v", publicChatLastTurnSnapshot(t, secondSnapshot))
	}
	time.Sleep(250 * time.Millisecond)
	waitForPublicChatAgentIdle(t, svc, "agent-alpha")
	mu.Lock()
	if callCount != 2 {
		mu.Unlock()
		t.Fatalf("expected pending follow-up to be canceled before execution, got callCount=%d", callCount)
	}
	mu.Unlock()
}
func TestPublicChatFollowUpCanceledProjectsRuntimeActionHint(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	capture := newPublicChatEmitCapture()
	acceptedCount := 0
	svc.SetPublicChatAppEmitter(func(ctx context.Context, req *runtimev1.SendAppMessageRequest) (*runtimev1.SendAppMessageResponse, error) {
		if req.GetMessageType() == publicChatTurnAcceptedType {
			acceptedCount++
			if acceptedCount == 2 {
				return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
					ActionHint: "inspect_local_runtime_model_health",
					Message:    "local model unavailable before follow-up turn dispatch",
				})
			}
		}
		return capture.emit(ctx, req)
	})
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})
	var mu sync.Mutex
	callCount := 0
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(_ context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			mu.Lock()
			callCount++
			currentCall := callCount
			mu.Unlock()
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   fmt.Sprintf("trace-follow-up-cancel-%d", currentCall),
				Payload: &runtimev1.StreamScenarioEvent_Started{
					Started: &runtimev1.ScenarioStreamStarted{
						ModelResolved: "qwen3-chat",
						RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
					},
				},
			}); err != nil {
				return err
			}
			envelope := publicChatStructuredEnvelopeWithFollowUpAPML("message-1", "turn-1", "action-follow-up-1", "come back later", 20)
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
				TraceId:   fmt.Sprintf("trace-follow-up-cancel-%d", currentCall),
				Payload: &runtimev1.StreamScenarioEvent_Delta{
					Delta: &runtimev1.ScenarioStreamDelta{
						Delta: &runtimev1.ScenarioStreamDelta_Text{
							Text: &runtimev1.TextStreamDelta{Text: envelope},
						},
					},
				},
			}); err != nil {
				return err
			}
			return emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
				TraceId:   fmt.Sprintf("trace-follow-up-cancel-%d", currentCall),
				Payload: &runtimev1.StreamScenarioEvent_Completed{
					Completed: &runtimev1.ScenarioStreamCompleted{
						FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
					},
				},
			})
		},
	})
	err := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"agent_id":               "agent-alpha",
			"conversation_anchor_id": anchorID,
			"thread_id":              "thread-follow-up-cancel-action-hint",
			"messages": []any{
				map[string]any{"role": "user", "content": "hello"},
			},
			"execution_binding": map[string]any{
				"route":    "local",
				"model_id": "local/default",
			},
		}),
	})
	if err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(first): %v", err)
	}
	accepted := capture.waitForMessageType(t, publicChatTurnAcceptedType)
	if got := publicChatPayloadMap(t, accepted)["conversation_anchor_id"].(string); got != anchorID {
		t.Fatalf("expected accepted conversation_anchor_id=%s, got=%s", anchorID, got)
	}
	_ = capture.waitForMessageType(t, publicChatTurnStartedType)
	_ = capture.waitForMessageType(t, publicChatTurnTextDeltaType)
	firstPostTurn := capture.waitForMessageType(t, publicChatTurnPostTurnType)
	_ = capture.waitForMessageType(t, publicChatTurnCompletedType)
	firstSnapshot := requestPublicChatSessionSnapshot(t, svc, capture, anchorID, "snapshot-follow-up-cancel-action-hint-first")
	firstFollowUp := publicChatLastTurnSnapshot(t, firstSnapshot)["follow_up"].(map[string]any)
	if got := firstFollowUp["status"]; got != "scheduled" {
		t.Fatalf("expected snapshot last_turn.follow_up scheduled, got=%v", firstFollowUp)
	}
	requirePublicChatPostTurnHookIntent(t, firstPostTurn, "action-follow-up-1", "pending", 20)
	// Poll the committed session snapshot until follow-up cancellation lands.
	// Exec Pack 1 does not admit a public runtime.agent.follow_up.* event
	// family; cancellation is observed through the admitted session_envelope
	// projection only (`session.snapshot.last_turn.follow_up.status`).
	deadline := time.Now().Add(2 * time.Second)
	var lastSnapshotPayload map[string]any
	for time.Now().Before(deadline) {
		err = svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
			ToAppId:       publicChatRuntimeAppID,
			FromAppId:     "desktop.app",
			SubjectUserId: "user-1",
			MessageType:   publicChatSessionSnapshotRequestType,
			Payload: publicChatStructPayload(t, map[string]any{
				"conversation_anchor_id": anchorID,
				"request_id":             "snapshot-follow-up-launch-failed",
			}),
		})
		if err != nil {
			t.Fatalf("ConsumePublicChatAppMessage(snapshot): %v", err)
		}
		snapshot := capture.waitForMessageType(t, publicChatSessionSnapshotType)
		lastSnapshotPayload = publicChatSessionSnapshotDetail(t, snapshot)
		if lastTurn, ok := lastSnapshotPayload["last_turn"].(map[string]any); ok {
			if fu, ok := lastTurn["follow_up"].(map[string]any); ok && fu["status"] == "canceled" {
				break
			}
		}
		time.Sleep(20 * time.Millisecond)
	}
	// Emit one more snapshot request so the assertion block below consumes
	// a fresh snapshot (mirrors original test shape).
	err = svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatSessionSnapshotRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"conversation_anchor_id": anchorID,
			"request_id":             "snapshot-follow-up-launch-failed",
		}),
	})
	if err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(snapshot): %v", err)
	}
	snapshot := capture.waitForMessageType(t, publicChatSessionSnapshotType)
	lastTurn := publicChatLastTurnSnapshot(t, snapshot)
	lastTurnFollowUp := lastTurn["follow_up"].(map[string]any)
	if got := lastTurnFollowUp["status"]; got != "canceled" {
		t.Fatalf("expected snapshot follow_up canceled, got=%v", lastTurnFollowUp)
	}
	if got := lastTurnFollowUp["action_hint"]; got != "inspect_local_runtime_model_health" {
		t.Fatalf("expected snapshot follow_up action_hint, got=%v", lastTurnFollowUp)
	}
	if got := lastTurnFollowUp["reason_code"]; got != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE.String() {
		t.Fatalf("expected snapshot follow_up reason_code, got=%v", lastTurnFollowUp)
	}
	if got := lastTurnFollowUp["message"]; got != "local model unavailable before follow-up turn dispatch" {
		t.Fatalf("expected snapshot follow_up message, got=%v", lastTurnFollowUp)
	}
	time.Sleep(50 * time.Millisecond)
	mu.Lock()
	defer mu.Unlock()
	if callCount != 1 {
		t.Fatalf("expected follow-up launch to fail before executor call, got callCount=%d", callCount)
	}
}
func TestPublicChatSessionSnapshotPersistsLastTurnAcrossRestart(t *testing.T) {
	t.Parallel()
	localStatePath := t.TempDir() + "/local-state.json"
	svc, closeFirst := newRuntimeAgentServiceForPublicChatStatePathWithClose(t, localStatePath)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	firstCapture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(firstCapture.emit)
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(_ context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			envelope := publicChatStructuredEnvelopeAPML("message-restart-snapshot", "persisted terminal text")
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   "trace-restart-snapshot",
				Payload: &runtimev1.StreamScenarioEvent_Started{
					Started: &runtimev1.ScenarioStreamStarted{
						ModelResolved: "qwen3-chat",
						RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
					},
				},
			}); err != nil {
				return err
			}
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
				TraceId:   "trace-restart-snapshot",
				Payload: &runtimev1.StreamScenarioEvent_Delta{
					Delta: &runtimev1.ScenarioStreamDelta{
						Delta: &runtimev1.ScenarioStreamDelta_Text{
							Text: &runtimev1.TextStreamDelta{Text: envelope},
						},
					},
				},
			}); err != nil {
				return err
			}
			return emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
				TraceId:   "trace-restart-snapshot",
				Payload: &runtimev1.StreamScenarioEvent_Completed{
					Completed: &runtimev1.ScenarioStreamCompleted{
						FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
					},
				},
			})
		},
	})
	err := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"agent_id":               "agent-alpha",
			"conversation_anchor_id": anchorID,
			"thread_id":              "thread-restart-snapshot",
			"messages": []any{
				map[string]any{"role": "user", "content": "hello"},
			},
			"execution_binding": map[string]any{
				"route":    "local",
				"model_id": "local/default",
			},
		}),
	})
	if err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(first): %v", err)
	}
	accepted := firstCapture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = firstCapture.waitForMessageType(t, publicChatTurnStartedType)
	_ = firstCapture.waitForMessageType(t, publicChatTurnTextDeltaType)
	_ = firstCapture.waitForMessageType(t, publicChatTurnStructuredType)
	_ = firstCapture.waitForMessageType(t, publicChatTurnPostTurnType)
	_ = firstCapture.waitForMessageType(t, publicChatTurnCompletedType)
	if got := publicChatPayloadMap(t, accepted)["conversation_anchor_id"].(string); got != anchorID {
		t.Fatalf("expected accepted conversation_anchor_id=%s, got=%s", anchorID, got)
	}
	closeFirst()
	recoveredSvc, closeRecovered := newRuntimeAgentServiceForPublicChatStatePathWithClose(t, localStatePath)
	defer closeRecovered()
	recoveredCapture := newPublicChatEmitCapture()
	recoveredSvc.SetPublicChatAppEmitter(recoveredCapture.emit)
	err = recoveredSvc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatSessionSnapshotRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"conversation_anchor_id": anchorID,
			"request_id":             "restart-snapshot-1",
		}),
	})
	if err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(snapshot after restart): %v", err)
	}
	snapshot := recoveredCapture.waitForMessageType(t, publicChatSessionSnapshotType)
	payload := publicChatSessionSnapshotDetail(t, snapshot)
	if got := payload["request_id"]; got != "restart-snapshot-1" {
		t.Fatalf("expected request_id echo, got=%v", payload)
	}
	if got := payload["session_status"]; got != "idle" {
		t.Fatalf("expected idle session after restart, got=%v", payload)
	}
	lastTurn := payload["last_turn"].(map[string]any)
	if got := lastTurn["status"]; got != publicChatTurnStatusCompleted {
		t.Fatalf("expected persisted last turn completed, got=%v", lastTurn)
	}
	if got := lastTurn["message_id"]; got != "message-restart-snapshot" {
		t.Fatalf("expected persisted message id, got=%v", lastTurn)
	}
	if got := lastTurn["text"]; got != "persisted terminal text" {
		t.Fatalf("expected persisted terminal text, got=%v", lastTurn)
	}
	if structured, ok := lastTurn["structured"].(map[string]any); !ok || structured["schema_id"] != publicChatStructuredSchemaID {
		t.Fatalf("expected persisted structured payload, got=%v", lastTurn)
	}
	if assistantMemory, ok := lastTurn["assistant_memory"].(map[string]any); !ok || assistantMemory["status"] != "applied" {
		t.Fatalf("expected persisted assistant memory outcome, got=%v", lastTurn)
	}
}
func TestPublicChatTurnRejectsConcurrentTurnForSameAgent(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	capture := newPublicChatEmitCapture()
	release := make(chan struct{})
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(ctx context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			envelope := publicChatStructuredEnvelopeAPML("message-concurrent", "done")
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   "trace-concurrent",
				Payload: &runtimev1.StreamScenarioEvent_Started{
					Started: &runtimev1.ScenarioStreamStarted{
						ModelResolved: "qwen3-chat",
						RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
					},
				},
			}); err != nil {
				return err
			}
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-release:
				if err := emit(&runtimev1.StreamScenarioEvent{
					EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
					TraceId:   "trace-concurrent",
					Payload: &runtimev1.StreamScenarioEvent_Delta{
						Delta: &runtimev1.ScenarioStreamDelta{
							Delta: &runtimev1.ScenarioStreamDelta_Text{
								Text: &runtimev1.TextStreamDelta{Text: envelope},
							},
						},
					},
				}); err != nil {
					return err
				}
				return emit(&runtimev1.StreamScenarioEvent{
					EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
					TraceId:   "trace-concurrent",
					Payload: &runtimev1.StreamScenarioEvent_Completed{
						Completed: &runtimev1.ScenarioStreamCompleted{
							FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
						},
					},
				})
			}
		},
	})
	err := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"agent_id":               "agent-alpha",
			"conversation_anchor_id": anchorID,
			"messages": []any{
				map[string]any{"role": "user", "content": "hello"},
			},
			"execution_binding": map[string]any{
				"route":    "local",
				"model_id": "local/default",
			},
		}),
	})
	if err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(first): %v", err)
	}
	_ = capture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = capture.waitForMessageType(t, publicChatTurnStartedType)
	err = svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"agent_id":               "agent-alpha",
			"conversation_anchor_id": anchorID,
			"messages": []any{
				map[string]any{"role": "user", "content": "second turn"},
			},
			"execution_binding": map[string]any{
				"route":    "local",
				"model_id": "local/default",
			},
		}),
	})
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected concurrent turn rejection, got err=%v code=%v", err, status.Code(err))
	}
	close(release)
	_ = capture.waitForMessageType(t, publicChatTurnTextDeltaType)
	_ = capture.waitForMessageType(t, publicChatTurnStructuredType)
	_ = capture.waitForMessageType(t, publicChatTurnPostTurnType)
	_ = capture.waitForMessageType(t, publicChatTurnCompletedType)
	waitForPublicChatAgentIdle(t, svc, "agent-alpha")
}
func TestPublicChatSessionRejectsThreadIdentityDrift(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(_ context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			envelope := publicChatStructuredEnvelopeAPML("message-session", "hello")
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   "trace-session",
				Payload: &runtimev1.StreamScenarioEvent_Started{
					Started: &runtimev1.ScenarioStreamStarted{
						ModelResolved: "qwen3-chat",
						RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
					},
				},
			}); err != nil {
				return err
			}
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
				TraceId:   "trace-session",
				Payload: &runtimev1.StreamScenarioEvent_Delta{
					Delta: &runtimev1.ScenarioStreamDelta{
						Delta: &runtimev1.ScenarioStreamDelta_Text{
							Text: &runtimev1.TextStreamDelta{Text: envelope},
						},
					},
				},
			}); err != nil {
				return err
			}
			return emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
				TraceId:   "trace-session",
				Payload: &runtimev1.StreamScenarioEvent_Completed{
					Completed: &runtimev1.ScenarioStreamCompleted{
						FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
					},
				},
			})
		},
	})
	err := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"agent_id":               "agent-alpha",
			"conversation_anchor_id": anchorID,
			"thread_id":              "thread-1",
			"messages": []any{
				map[string]any{"role": "user", "content": "hello"},
			},
			"execution_binding": map[string]any{
				"route":    "local",
				"model_id": "local/default",
			},
		}),
	})
	if err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(initial session): %v", err)
	}
	_ = capture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = capture.waitForMessageType(t, publicChatTurnStartedType)
	_ = capture.waitForMessageType(t, publicChatTurnTextDeltaType)
	_ = capture.waitForMessageType(t, publicChatTurnStructuredType)
	_ = capture.waitForMessageType(t, publicChatTurnPostTurnType)
	_ = capture.waitForMessageType(t, publicChatTurnCompletedType)
	waitForPublicChatAgentIdle(t, svc, "agent-alpha")
	err = svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"agent_id":               "agent-alpha",
			"conversation_anchor_id": anchorID,
			"thread_id":              "thread-2",
			"messages": []any{
				map[string]any{"role": "user", "content": "hello again"},
			},
		}),
	})
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected thread identity drift rejection, got err=%v code=%v", err, status.Code(err))
	}
}
func TestPublicChatSessionRejectsExecutionBindingDrift(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(_ context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			envelope := publicChatStructuredEnvelopeAPML("message-binding", "hello")
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   "trace-binding",
				Payload: &runtimev1.StreamScenarioEvent_Started{
					Started: &runtimev1.ScenarioStreamStarted{
						ModelResolved: "qwen3-chat",
						RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
					},
				},
			}); err != nil {
				return err
			}
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
				TraceId:   "trace-binding",
				Payload: &runtimev1.StreamScenarioEvent_Delta{
					Delta: &runtimev1.ScenarioStreamDelta{
						Delta: &runtimev1.ScenarioStreamDelta_Text{
							Text: &runtimev1.TextStreamDelta{Text: envelope},
						},
					},
				},
			}); err != nil {
				return err
			}
			return emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
				TraceId:   "trace-binding",
				Payload: &runtimev1.StreamScenarioEvent_Completed{
					Completed: &runtimev1.ScenarioStreamCompleted{
						FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
					},
				},
			})
		},
	})
	err := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"agent_id":               "agent-alpha",
			"conversation_anchor_id": anchorID,
			"thread_id":              "thread-1",
			"messages": []any{
				map[string]any{"role": "user", "content": "hello"},
			},
			"execution_binding": map[string]any{
				"route":    "local",
				"model_id": "local/default",
			},
		}),
	})
	if err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(initial session): %v", err)
	}
	_ = capture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = capture.waitForMessageType(t, publicChatTurnStartedType)
	_ = capture.waitForMessageType(t, publicChatTurnTextDeltaType)
	_ = capture.waitForMessageType(t, publicChatTurnStructuredType)
	_ = capture.waitForMessageType(t, publicChatTurnPostTurnType)
	_ = capture.waitForMessageType(t, publicChatTurnCompletedType)
	waitForPublicChatAgentIdle(t, svc, "agent-alpha")
	err = svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"agent_id":               "agent-alpha",
			"conversation_anchor_id": anchorID,
			"thread_id":              "thread-1",
			"messages": []any{
				map[string]any{"role": "user", "content": "hello again"},
			},
			"execution_binding": map[string]any{
				"route":    "cloud",
				"model_id": "cloud/gpt-5.4-mini",
			},
		}),
	})
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected execution binding drift rejection, got err=%v code=%v", err, status.Code(err))
	}
}

// TestPublicChatTurnRequestRejectsMissingConversationAnchorID is a fail-closed
// negative proof for Exec Pack 1 / K-AGCORE-034: runtime.agent.turn.request
// must not route an agent_id alone; the caller must supply an explicit
// conversation_anchor_id obtained via OpenConversationAnchor.
func TestPublicChatTurnRequestRejectsMissingConversationAnchorID(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(context.Context, *PublicChatTurnExecutionRequest, func(*runtimev1.StreamScenarioEvent) error) error {
			t.Fatalf("executor must not be called when conversation_anchor_id is absent")
			return nil
		},
	})
	err := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"agent_id": "agent-alpha",
			"messages": []any{
				map[string]any{"role": "user", "content": "hello"},
			},
			"execution_binding": map[string]any{
				"route":    "local",
				"model_id": "local/default",
			},
		}),
	})
	if err == nil {
		t.Fatalf("expected rejection for missing conversation_anchor_id, got nil")
	}
	if got := status.Code(err); got != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument for missing conversation_anchor_id, got code=%v err=%v", got, err)
	}
}

// TestPublicChatTurnRequestRejectsUnknownConversationAnchorID is a fail-closed
// negative proof for K-AGCORE-035: client-side shadow anchor creation is not
// admitted. A turn request referencing an anchor that was never opened must
// fail with NotFound; runtime must not implicitly create anchors on turn.
func TestPublicChatTurnRequestRejectsUnknownConversationAnchorID(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(context.Context, *PublicChatTurnExecutionRequest, func(*runtimev1.StreamScenarioEvent) error) error {
			t.Fatalf("executor must not be called for unknown conversation_anchor_id")
			return nil
		},
	})
	err := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"agent_id":               "agent-alpha",
			"conversation_anchor_id": "agent_anchor_never_opened",
			"messages": []any{
				map[string]any{"role": "user", "content": "hello"},
			},
			"execution_binding": map[string]any{
				"route":    "local",
				"model_id": "local/default",
			},
		}),
	})
	if err == nil {
		t.Fatalf("expected rejection for unknown conversation_anchor_id, got nil")
	}
	if got := status.Code(err); got != codes.NotFound {
		t.Fatalf("expected NotFound for unknown conversation_anchor_id, got code=%v err=%v", got, err)
	}
}

// TestPublicChatIngressRejectsLegacyAgentChatCarrier proves the legacy
// `agent.chat.*.v1` ingress names are not admitted anywhere on the primary
// runtime carrier after the Exec Pack 1 hard cut. Any inbound message with
// those message types must fail closed — not be silently upgraded or
// accepted as an alias.
func TestPublicChatIngressRejectsLegacyAgentChatCarrier(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(context.Context, *PublicChatTurnExecutionRequest, func(*runtimev1.StreamScenarioEvent) error) error {
			t.Fatalf("executor must not be called for legacy agent.chat.*.v1 ingress")
			return nil
		},
	})
	legacyTypes := []string{
		"agent.chat.turn.request.v1",
		"agent.chat.turn.interrupt.v1",
		"agent.chat.session.snapshot.request.v1",
	}
	for _, messageType := range legacyTypes {
		messageType := messageType
		t.Run(messageType, func(t *testing.T) {
			err := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
				ToAppId:       publicChatRuntimeAppID,
				FromAppId:     "desktop.app",
				SubjectUserId: "user-1",
				MessageType:   messageType,
				Payload: publicChatStructPayload(t, map[string]any{
					"agent_id":   "agent-alpha",
					"session_id": "session-legacy",
					"messages": []any{
						map[string]any{"role": "user", "content": "hello"},
					},
				}),
			})
			if err == nil {
				t.Fatalf("expected rejection for legacy %s, got nil", messageType)
			}
			if got := status.Code(err); got != codes.InvalidArgument {
				t.Fatalf("expected InvalidArgument rejection for legacy %s, got code=%v err=%v", messageType, got, err)
			}
		})
	}
	// Parallel invariant: the legacy names must not appear as admitted
	// public ingress carrier anywhere.
	for _, messageType := range legacyTypes {
		if IsPublicChatIngressMessageType(messageType) {
			t.Fatalf("legacy %s must not be admitted as public chat ingress message type", messageType)
		}
	}
}
