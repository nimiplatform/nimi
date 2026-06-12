package runtimeagent

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestPublicChatTurnRequestAllowsExecutionBindingOmissionWhenRuntimeResolvesBinding(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(_ context.Context, req *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			if req.AppID != "desktop.app" {
				t.Fatalf("expected public chat execution request to preserve caller app id, got=%q", req.AppID)
			}
			if req.Binding.RoutePolicy != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL {
				t.Fatalf("expected runtime-resolved local route, got=%v", req.Binding.RoutePolicy)
			}
			if req.Binding.ModelID != "local/default" {
				t.Fatalf("expected runtime-resolved default model, got=%q", req.Binding.ModelID)
			}
			envelope := publicChatStructuredEnvelopeAPML("message-route-omission", "runtime resolved route")
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   "trace-route-omission",
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
				TraceId:   "trace-route-omission",
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
				TraceId:   "trace-route-omission",
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
			"local_agent_ref":        testRuntimeAgentLocalRef("agent-alpha"),
			"owner_user_id":          "user-1",
			"realm_agent_id":         "agent-alpha",
			"conversation_anchor_id": anchorID,
			"thread_id":              "thread-route-omission",
			"messages": []any{
				map[string]any{"role": "user", "content": "hello"},
			},
		}),
	})
	if err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(request): %v", err)
	}
	accepted := capture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = capture.waitForMessageType(t, publicChatTurnStartedType)
	_ = capture.waitForMessageType(t, publicChatTurnTextDeltaType)
	_ = capture.waitForMessageType(t, publicChatTurnStructuredType)
	_ = capture.waitForMessageType(t, publicChatTurnMessageCommittedType)
	_ = capture.waitForMessageType(t, publicChatTurnPostTurnType)
	_ = capture.waitForMessageType(t, publicChatTurnCompletedType)
	acceptedPayload := publicChatPayloadMap(t, accepted)
	if _, ok := acceptedPayload["turn_id"].(string); !ok {
		t.Fatalf("expected accepted envelope turn_id, got=%v", acceptedPayload)
	}
	// Snapshot is the only admitted carrier for execution-binding truth.
	snapshot := requestPublicChatSessionSnapshot(t, svc, capture, anchorID, "snapshot-route-omission")
	snapMap := publicChatSessionSnapshotDetail(t, snapshot)
	executionBinding := snapMap["execution_binding"].(map[string]any)
	if got := executionBinding["route"]; got != "local" {
		t.Fatalf("expected runtime-resolved snapshot route local, got=%v", executionBinding)
	}
	if got := executionBinding["model_id"]; got != "local/default" {
		t.Fatalf("expected runtime-resolved snapshot model_id local/default, got=%v", executionBinding)
	}
	lastTurn := snapMap["last_turn"].(map[string]any)
	if got := lastTurn["route_decision"]; got != "local" {
		t.Fatalf("expected last_turn route_decision local, got=%v", lastTurn)
	}
}

func TestPublicChatTurnRequestRejectsCallerSystemPrompt(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	err := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"local_agent_ref":        testRuntimeAgentLocalRef("agent-alpha"),
			"owner_user_id":          "user-1",
			"realm_agent_id":         "agent-alpha",
			"conversation_anchor_id": anchorID,
			"thread_id":              "thread-reject-system-prompt",
			"system_prompt":          "caller supplied raw prompt",
			"messages": []any{
				map[string]any{"role": "user", "content": "hello"},
			},
		}),
	})
	if err == nil || !strings.Contains(err.Error(), "must not include system_prompt") {
		t.Fatalf("expected caller system_prompt rejection, got %v", err)
	}
}
func TestPublicChatTurnInvalidStructuredOutputFailsClosed(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(_ context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   "trace-invalid-structured",
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
				TraceId:   "trace-invalid-structured",
				Payload: &runtimev1.StreamScenarioEvent_Delta{
					Delta: &runtimev1.ScenarioStreamDelta{
						Delta: &runtimev1.ScenarioStreamDelta_Text{
							Text: &runtimev1.TextStreamDelta{Text: `{"schemaId":"bad","message":{"messageId":"m1","text":"hello"},"actions":[]}`},
						},
					},
				},
			}); err != nil {
				return err
			}
			return emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
				TraceId:   "trace-invalid-structured",
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
			"local_agent_ref":        testRuntimeAgentLocalRef("agent-alpha"),
			"owner_user_id":          "user-1",
			"realm_agent_id":         "agent-alpha",
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
		t.Fatalf("ConsumePublicChatAppMessage(request): %v", err)
	}
	_ = capture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = capture.waitForMessageType(t, publicChatTurnStartedType)
	failed := capture.waitForMessageType(t, publicChatTurnFailedType)
	failedDetail := publicChatTurnDetail(t, failed)
	if got := failedDetail["reason_code"]; got != runtimev1.ReasonCode_AI_OUTPUT_INVALID.String() {
		t.Fatalf("expected AI_OUTPUT_INVALID failed.detail.reason_code, got=%v", failedDetail)
	}
	if got := strings.TrimSpace(fmt.Sprint(failedDetail["message"])); got == "" {
		t.Fatalf("expected failed.detail.message to carry structured parse detail, got=%v", failedDetail)
	}
	snapshot := requestPublicChatSessionSnapshot(t, svc, capture, anchorID, "snapshot-invalid-structured")
	lastTurn := publicChatLastTurnSnapshot(t, snapshot)
	if got := lastTurn["status"]; got != publicChatTurnStatusFailed {
		t.Fatalf("expected failed last_turn after structured parse error, got=%v", lastTurn)
	}
	if got := lastTurn["reason_code"]; got != runtimev1.ReasonCode_AI_OUTPUT_INVALID.String() {
		t.Fatalf("expected snapshot last_turn.reason_code=AI_OUTPUT_INVALID, got=%v", lastTurn)
	}
	if got := strings.TrimSpace(fmt.Sprint(lastTurn["message"])); got == "" {
		t.Fatalf("expected snapshot last_turn.message to preserve parse detail, got=%v", lastTurn)
	}
	waitForPublicChatAgentIdle(t, svc, "agent-alpha")
}

func TestPublicChatTurnRequestPreservesCommittedTranscriptOnFailedTurn(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	svc.chatSurfaceMu.Lock()
	svc.chatAnchors[anchorID].Transcript = []*runtimev1.ChatMessage{
		{Role: "user", Content: "hello"},
		{Role: "assistant", Content: "previous runtime reply"},
	}
	svc.chatSurfaceMu.Unlock()
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(_ context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   "trace-invalid-after-committed-transcript",
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
				TraceId:   "trace-invalid-after-committed-transcript",
				Payload: &runtimev1.StreamScenarioEvent_Delta{
					Delta: &runtimev1.ScenarioStreamDelta{
						Delta: &runtimev1.ScenarioStreamDelta_Text{
							Text: &runtimev1.TextStreamDelta{Text: "plain text without apml"},
						},
					},
				},
			}); err != nil {
				return err
			}
			return emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
				TraceId:   "trace-invalid-after-committed-transcript",
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
			"local_agent_ref":        testRuntimeAgentLocalRef("agent-alpha"),
			"owner_user_id":          "user-1",
			"realm_agent_id":         "agent-alpha",
			"conversation_anchor_id": anchorID,
			"messages": []any{
				map[string]any{"role": "user", "content": "hello"},
				map[string]any{"role": "user", "content": "new user message"},
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
	_ = capture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = capture.waitForMessageType(t, publicChatTurnStartedType)
	_ = capture.waitForMessageType(t, publicChatTurnFailedType)
	snapshot := requestPublicChatSessionSnapshot(t, svc, capture, anchorID, "snapshot-preserve-committed-transcript")
	detail := publicChatSessionSnapshotDetail(t, snapshot)
	transcript, ok := detail["transcript"].([]any)
	if !ok {
		t.Fatalf("expected transcript array, got=%v", detail["transcript"])
	}
	if got := detail["transcript_message_count"]; got != float64(3) {
		t.Fatalf("expected transcript_message_count=3, got=%v transcript=%v", got, transcript)
	}
	if got := transcript[1].(map[string]any)["content"]; got != "previous runtime reply" {
		t.Fatalf("expected committed assistant transcript to survive failed turn, got=%v", transcript)
	}
	if got := transcript[2].(map[string]any)["content"]; got != "new user message" {
		t.Fatalf("expected latest user message appended without dropping assistant, got=%v", transcript)
	}
	waitForPublicChatAgentIdle(t, svc, "agent-alpha")
}

func TestPublicChatTurnRequestFoldsCommittedLastTurnIntoTranscript(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	svc.chatSurfaceMu.Lock()
	svc.chatAnchors[anchorID].Transcript = []*runtimev1.ChatMessage{
		{Role: "user", Content: "测试"},
	}
	svc.chatAnchors[anchorID].LastTurnSnapshot = &publicChatTurnProjectionState{
		TurnID:        "agent_turn_previous",
		Status:        publicChatTurnStatusCompleted,
		MessageID:     "message-previous",
		AssistantText: "测试收到",
	}
	svc.chatSurfaceMu.Unlock()
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})
	beforeSnapshot := requestPublicChatSessionSnapshot(t, svc, capture, anchorID, "snapshot-fold-previous-committed")
	beforeDetail := publicChatSessionSnapshotDetail(t, beforeSnapshot)
	beforeTranscript := beforeDetail["transcript"].([]any)
	if got := beforeDetail["transcript_message_count"]; got != float64(2) {
		t.Fatalf("expected snapshot to fold previous last_turn into transcript, got=%v", beforeDetail)
	}
	if got := beforeTranscript[1].(map[string]any)["content"]; got != "测试收到" {
		t.Fatalf("expected previous assistant in restart transcript, got=%v", beforeTranscript)
	}
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(_ context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   "trace-fold-committed-last-turn",
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
				TraceId:   "trace-fold-committed-last-turn",
				Payload: &runtimev1.StreamScenarioEvent_Delta{
					Delta: &runtimev1.ScenarioStreamDelta{
						Delta: &runtimev1.ScenarioStreamDelta_Text{
							Text: &runtimev1.TextStreamDelta{Text: publicChatStructuredEnvelopeAPML("message-next", "下一句收到")},
						},
					},
				},
			}); err != nil {
				return err
			}
			return emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
				TraceId:   "trace-fold-committed-last-turn",
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
			"local_agent_ref":        testRuntimeAgentLocalRef("agent-alpha"),
			"owner_user_id":          "user-1",
			"realm_agent_id":         "agent-alpha",
			"conversation_anchor_id": anchorID,
			"messages": []any{
				map[string]any{"role": "user", "content": "测试"},
				map[string]any{"role": "user", "content": "下一句"},
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
	_ = capture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = capture.waitForMessageType(t, publicChatTurnStartedType)
	_ = capture.waitForMessageType(t, publicChatTurnTextDeltaType)
	_ = capture.waitForMessageType(t, publicChatTurnStructuredType)
	_ = capture.waitForMessageType(t, publicChatTurnCompletedType)
	afterSnapshot := requestPublicChatSessionSnapshot(t, svc, capture, anchorID, "snapshot-fold-after-next-turn")
	afterDetail := publicChatSessionSnapshotDetail(t, afterSnapshot)
	afterTranscript := afterDetail["transcript"].([]any)
	if got := afterDetail["transcript_message_count"]; got != float64(4) {
		t.Fatalf("expected previous and latest assistant in transcript, got=%v", afterDetail)
	}
	if got := afterTranscript[1].(map[string]any)["content"]; got != "测试收到" {
		t.Fatalf("expected previous assistant to survive next turn, got=%v", afterTranscript)
	}
	if got := afterTranscript[2].(map[string]any)["content"]; got != "下一句" {
		t.Fatalf("expected next user after previous assistant, got=%v", afterTranscript)
	}
	if got := afterTranscript[3].(map[string]any)["content"]; got != "下一句收到" {
		t.Fatalf("expected latest assistant committed to transcript, got=%v", afterTranscript)
	}
	waitForPublicChatAgentIdle(t, svc, "agent-alpha")
}

func TestPublicChatTurnRequestRejectsUnknownEmotionBeforeCommit(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(_ context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   "trace-unknown-emotion",
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
				TraceId:   "trace-unknown-emotion",
				Payload: &runtimev1.StreamScenarioEvent_Delta{
					Delta: &runtimev1.ScenarioStreamDelta{
						Delta: &runtimev1.ScenarioStreamDelta_Text{
							Text: &runtimev1.TextStreamDelta{Text: `<message id="m1"><emotion>curious</emotion>hello</message>`},
						},
					},
				},
			}); err != nil {
				return err
			}
			return emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
				TraceId:   "trace-unknown-emotion",
				Payload: &runtimev1.StreamScenarioEvent_Completed{
					Completed: &runtimev1.ScenarioStreamCompleted{FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP},
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
			"local_agent_ref":        testRuntimeAgentLocalRef("agent-alpha"),
			"owner_user_id":          "user-1",
			"realm_agent_id":         "agent-alpha",
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
		t.Fatalf("ConsumePublicChatAppMessage(request): %v", err)
	}
	_ = capture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = capture.waitForMessageType(t, publicChatTurnStartedType)
	failed := capture.waitForMessageType(t, publicChatTurnFailedType)
	failedDetail := publicChatTurnDetail(t, failed)
	if got := failedDetail["reason_code"]; got != runtimev1.ReasonCode_AI_OUTPUT_INVALID.String() {
		t.Fatalf("expected AI_OUTPUT_INVALID failed.detail.reason_code, got=%v", failedDetail)
	}
	if got := strings.TrimSpace(fmt.Sprint(failedDetail["message"])); !strings.Contains(got, "current emotion ontology") {
		t.Fatalf("expected failed.detail.message to identify emotion ontology rejection, got=%v", failedDetail)
	}
	capture.mu.Lock()
	defer capture.mu.Unlock()
	for _, item := range capture.items {
		if item.GetMessageType() == publicChatTurnMessageCommittedType {
			t.Fatalf("unknown emotion must fail before message commit; saw %s", item.GetMessageType())
		}
	}
}

func TestPublicChatFollowUpRunsInsideRuntime(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
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
				TraceId:   fmt.Sprintf("trace-follow-up-%d", currentCall),
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
				envelope = publicChatStructuredEnvelopeWithFollowUpAPML("message-1", "hello from runtime", "action-follow-up-1", "continue naturally", 20)
			case 2:
				if got := strings.TrimSpace(req.SystemPrompt); !strings.Contains(got, "FollowUpInstruction:") || !strings.Contains(got, "continue naturally") {
					t.Fatalf("expected follow-up system prompt to include internal continuation cue, got=%q", got)
				}
				if len(req.Messages) < 2 || req.Messages[len(req.Messages)-1].GetContent() != "hello from runtime" {
					t.Fatalf("expected follow-up request to include prior assistant text, got=%v", req.Messages)
				}
				envelope = publicChatStructuredEnvelopeAPML("message-2", "runtime follow up complete")
			default:
				t.Fatalf("unexpected follow-up executor call %d", currentCall)
			}
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
				TraceId:   fmt.Sprintf("trace-follow-up-%d", currentCall),
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
				TraceId:   fmt.Sprintf("trace-follow-up-%d", currentCall),
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
			"local_agent_ref":        testRuntimeAgentLocalRef("agent-alpha"),
			"owner_user_id":          "user-1",
			"realm_agent_id":         "agent-alpha",
			"conversation_anchor_id": anchorID,
			"thread_id":              "thread-follow-up",
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
	_ = capture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = capture.waitForMessageType(t, publicChatTurnStartedType)
	_ = capture.waitForMessageType(t, publicChatTurnTextDeltaType)
	_ = capture.waitForMessageType(t, publicChatTurnStructuredType)
	firstPostTurn := capture.waitForMessageType(t, publicChatTurnPostTurnType)
	firstCompleted := capture.waitForMessageType(t, publicChatTurnCompletedType)
	firstSnapshot := requestPublicChatSessionSnapshot(t, svc, capture, anchorID, "snapshot-follow-up-first")
	_ = capture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = capture.waitForMessageType(t, publicChatTurnStartedType)
	_ = capture.waitForMessageType(t, publicChatTurnTextDeltaType)
	_ = capture.waitForMessageType(t, publicChatTurnStructuredType)
	secondPostTurn := capture.waitForMessageType(t, publicChatTurnPostTurnType)
	secondCompleted := capture.waitForMessageType(t, publicChatTurnCompletedType)
	secondSnapshot := requestPublicChatSessionSnapshot(t, svc, capture, anchorID, "snapshot-follow-up-second")
	firstPostTurnDetail := publicChatTurnDetail(t, firstPostTurn)
	if _, present := firstPostTurnDetail["follow_up"]; present {
		t.Fatalf("post_turn detail must not carry follow_up execution truth, got=%v", firstPostTurnDetail)
	}
	requirePublicChatPostTurnHookIntent(t, firstPostTurn, "action-follow-up-1", "pending", 20)
	firstLastTurn := publicChatLastTurnSnapshot(t, firstSnapshot)
	firstFollowUp := firstLastTurn["follow_up"].(map[string]any)
	if got := firstFollowUp["status"]; got != "scheduled" {
		t.Fatalf("expected first snapshot last_turn.follow_up scheduled, got=%v", firstFollowUp)
	}
	if got := firstLastTurn["turn_origin"]; got != publicChatTurnOriginUser {
		t.Fatalf("expected first snapshot last_turn.turn_origin=user, got=%v", firstLastTurn)
	}
	firstBinding := publicChatSessionSnapshotDetail(t, firstSnapshot)["execution_binding"].(map[string]any)
	if got := firstBinding["route"]; got != "local" {
		t.Fatalf("expected first snapshot execution_binding.route local, got=%v", firstBinding)
	}
	secondLastTurn := publicChatLastTurnSnapshot(t, secondSnapshot)
	if got := secondLastTurn["turn_origin"]; got != publicChatTurnOriginFollowUp {
		t.Fatalf("expected second snapshot last_turn.turn_origin=follow_up, got=%v", secondLastTurn)
	}
	if got := secondLastTurn["follow_up_depth"]; got != float64(1) {
		t.Fatalf("expected second snapshot last_turn.follow_up_depth=1, got=%v", secondLastTurn)
	}
	if got := secondLastTurn["chain_id"]; got == "" {
		t.Fatalf("expected second snapshot last_turn.chain_id, got=%v", secondLastTurn)
	}
	secondBinding := publicChatSessionSnapshotDetail(t, secondSnapshot)["execution_binding"].(map[string]any)
	if got := secondBinding["route"]; got != "local" {
		t.Fatalf("expected second snapshot execution_binding.route local, got=%v", secondBinding)
	}
	if got := publicChatSessionSnapshotDetail(t, secondSnapshot)["transcript_message_count"]; got != float64(3) {
		t.Fatalf("expected second snapshot transcript_message_count=3, got=%v", publicChatSessionSnapshotDetail(t, secondSnapshot))
	}
	secondPostTurnDetail := publicChatTurnDetail(t, secondPostTurn)
	if _, present := secondPostTurnDetail["follow_up"]; present {
		t.Fatalf("post_turn detail must not carry follow_up execution truth, got=%v", secondPostTurnDetail)
	}
	if _, present := secondPostTurnDetail["hook_intent"]; present {
		t.Fatalf("post_turn detail must omit hook_intent when no follow-up proposal exists, got=%v", secondPostTurnDetail)
	}
	secondFollowUp := secondLastTurn["follow_up"].(map[string]any)
	if got := secondFollowUp["status"]; got != "skipped" {
		t.Fatalf("expected second snapshot last_turn.follow_up skipped, got=%v", secondFollowUp)
	}
	if got := firstLastTurn["text"]; got != "hello from runtime" {
		t.Fatalf("unexpected first snapshot last_turn.text: %v", firstLastTurn)
	}
	if got := secondLastTurn["text"]; got != "runtime follow up complete" {
		t.Fatalf("unexpected second snapshot last_turn.text: %v", secondLastTurn)
	}
	if detail := publicChatTurnDetail(t, firstCompleted); len(detail) != 1 || detail["terminal_reason"] != "stop" {
		t.Fatalf("completed detail must be terminal_reason-only, got=%v", detail)
	}
	if detail := publicChatTurnDetail(t, secondCompleted); len(detail) != 1 || detail["terminal_reason"] != "stop" {
		t.Fatalf("completed detail must be terminal_reason-only, got=%v", detail)
	}
	waitForPublicChatAgentIdle(t, svc, "agent-alpha")
	mu.Lock()
	defer mu.Unlock()
	if callCount != 2 {
		t.Fatalf("expected runtime executor to run two turns including follow-up, got=%d", callCount)
	}
}
