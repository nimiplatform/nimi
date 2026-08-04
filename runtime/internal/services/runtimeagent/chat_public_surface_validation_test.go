package runtimeagent

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// TestPublicChatTurnRequestRejectsRequestCarriedExecutionBindings is the
// K-AGCORE-147 hard-cut proof: request-carried execution_bindings on
// runtime.agent.turn.request fail closed with InvalidArgument; Runtime Agent AI
// Config is the only binding truth.
func TestPublicChatTurnRequestRejectsRequestCarriedExecutionBindings(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(context.Context, *PublicChatTurnExecutionRequest, func(*runtimev1.StreamScenarioEvent) error) error {
			t.Fatalf("turn executor must not run when request carries execution_bindings")
			return nil
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
			"runtime_source_ref":     testRuntimeAgentSourceRef("agent-alpha"),
			"conversation_anchor_id": anchorID,
			"thread_id":              publicChatTestAnchorThreadID(t, svc, anchorID),
			"messages": []any{
				map[string]any{"role": "user", "content": "hello"},
			},
			"execution_bindings": map[string]any{"text.generate": map[string]any{
				"route":    "local",
				"model_id": "local/default",
			}},
		}),
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument for request-carried execution_bindings, got %v", err)
	}
	if !strings.Contains(err.Error(), "public chat execution_bindings are not admitted; Runtime resolves execution bindings independently") {
		t.Fatalf("expected K-AGCORE-147 rejection message, got %v", err)
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
			"runtime_source_ref":     testRuntimeAgentSourceRef("agent-alpha"),
			"conversation_anchor_id": anchorID,
			"thread_id":              publicChatTestAnchorThreadID(t, svc, anchorID),
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
			"runtime_source_ref":     testRuntimeAgentSourceRef("agent-alpha"),
			"conversation_anchor_id": anchorID,
			"messages": []any{
				map[string]any{"role": "user", "content": "hello"},
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

func TestPublicChatTurnInvalidAPMLFailsClosedWithoutRepairOrCommit(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		raw  string
	}{
		{
			name: "malformed",
			raw:  `<message id="message-malformed"><activity>thinking</activity>Hello</message><action id="action-malformed" kind="image"><prompt-payload kind="image"><prompt-text>must not execute</prompt-text></prompt-payload>`,
		},
		{
			name: "unknown tag",
			raw:  `<message id="message-unknown">Hello</message><unknown/>`,
		},
		{
			name: "wrapped",
			raw:  `<response><message id="message-wrapped">Hello</message></response>`,
		},
		{
			name: "fenced",
			raw:  "```xml\n<message id=\"message-fenced\">Hello</message>\n```",
		},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			svc := newRuntimeAgentServiceForPublicChatTest(t)
			anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
			capture := newPublicChatEmitCapture()
			svc.SetPublicChatAppEmitter(capture.emit)
			providerCalls := 0
			svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
				stream: func(_ context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
					providerCalls++
					traceID := fmt.Sprintf("trace-invalid-apml-%s-%d", strings.ReplaceAll(tt.name, " ", "-"), providerCalls)
					if err := emit(&runtimev1.StreamScenarioEvent{
						EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
						TraceId:   traceID,
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
						TraceId:   traceID,
						Payload: &runtimev1.StreamScenarioEvent_Delta{
							Delta: &runtimev1.ScenarioStreamDelta{
								Delta: &runtimev1.ScenarioStreamDelta_Text{
									Text: &runtimev1.TextStreamDelta{Text: tt.raw},
								},
							},
						},
					}); err != nil {
						return err
					}
					return emit(&runtimev1.StreamScenarioEvent{
						EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
						TraceId:   traceID,
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
					"runtime_source_ref":     testRuntimeAgentSourceRef("agent-alpha"),
					"conversation_anchor_id": anchorID,
					"messages": []any{
						map[string]any{"role": "user", "content": "hello"},
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
				t.Fatalf("expected AI_OUTPUT_INVALID, got=%v", failedDetail)
			}
			if providerCalls != 1 {
				t.Fatalf("invalid APML must stop after the first provider completion; got %d calls", providerCalls)
			}
			for _, messageType := range capture.messageTypes() {
				switch messageType {
				case publicChatTurnStructuredType,
					publicChatTurnMessageCommittedType,
					publicChatTurnTextDeltaType,
					publicChatTurnActionPlannedType,
					publicChatTurnActionStartedType,
					publicChatTurnArtifactReadyType,
					publicChatTurnActionCompletedType,
					publicChatTurnActionFailedType,
					publicChatTurnPostTurnType,
					publicChatTurnCompletedType:
					t.Fatalf("invalid APML must not emit committed output, action, memory/post-turn, or completed events; saw %s", messageType)
				}
			}
			snapshot := requestPublicChatSessionSnapshot(t, svc, capture, anchorID, "snapshot-invalid-apml-"+tt.name)
			lastTurn := publicChatLastTurnSnapshot(t, snapshot)
			for _, forbidden := range []string{"message_id", "text", "structured", "assistant_memory", "chat_sidecar", "follow_up"} {
				if _, present := lastTurn[forbidden]; present {
					t.Fatalf("invalid APML must not persist %s in last_turn, got=%v", forbidden, lastTurn)
				}
			}
			detail := publicChatSessionSnapshotDetail(t, snapshot)
			transcript, ok := detail["transcript"].([]any)
			if !ok || len(transcript) != 0 {
				t.Fatalf("invalid provider output must not commit current input or assistant output, got=%v", detail["transcript"])
			}
			waitForPublicChatAgentIdle(t, svc, "agent-alpha")
		})
	}
}

func TestPublicChatTurnRequestPreservesCommittedTranscriptOnFailedTurn(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	svc.chatSurfaceMu.Lock()
	svc.chatAnchors[anchorID].CommittedTranscript = testPublicChatCommittedTranscript([2]string{"hello", "previous runtime reply"})
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
			"runtime_source_ref":     testRuntimeAgentSourceRef("agent-alpha"),
			"conversation_anchor_id": anchorID,
			"messages": []any{
				map[string]any{"role": "user", "content": "new user message"},
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
	if got := detail["transcript_message_count"]; got != float64(2) {
		t.Fatalf("failed turn must preserve only the prior committed pair, got=%v transcript=%v", got, transcript)
	}
	if got := transcript[1].(map[string]any)["content"]; got != "previous runtime reply" {
		t.Fatalf("expected committed assistant transcript to survive failed turn, got=%v", transcript)
	}
	waitForPublicChatAgentIdle(t, svc, "agent-alpha")
}

func TestPublicChatTurnRequestUsesOnlyCompleteRuntimeCommittedTranscript(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	svc.chatSurfaceMu.Lock()
	svc.chatAnchors[anchorID].CommittedTranscript = testPublicChatCommittedTranscript([2]string{"previous user message", "previous runtime reply"})
	svc.chatAnchors[anchorID].LastTurnSnapshot = &publicChatTurnProjectionState{
		TurnID:        "agent_turn_previous",
		Status:        publicChatTurnStatusCompleted,
		MessageID:     "message-previous",
		AssistantText: "previous runtime reply",
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
	if got := beforeTranscript[1].(map[string]any)["content"]; got != "previous runtime reply" {
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
							Text: &runtimev1.TextStreamDelta{Text: publicChatStructuredEnvelopeAPML("message-next", "next message received")},
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
			"runtime_source_ref":     testRuntimeAgentSourceRef("agent-alpha"),
			"conversation_anchor_id": anchorID,
			"messages":               []any{map[string]any{"role": "user", "content": "next"}},
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
	if got := afterTranscript[1].(map[string]any)["content"]; got != "previous runtime reply" {
		t.Fatalf("expected previous assistant to survive next turn, got=%v", afterTranscript)
	}
	if got := afterTranscript[2].(map[string]any)["content"]; got != "next" {
		t.Fatalf("expected next user after previous assistant, got=%v", afterTranscript)
	}
	if got := afterTranscript[3].(map[string]any)["content"]; got != "next message received" {
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
			"runtime_source_ref":     testRuntimeAgentSourceRef("agent-alpha"),
			"conversation_anchor_id": anchorID,
			"messages": []any{
				map[string]any{"role": "user", "content": "hello"},
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
	followUpGate := installPublicChatFollowUpGate(t, svc)
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
				if got := strings.TrimSpace(req.SystemPrompt); got != "" {
					t.Fatalf("follow-up must not use a parallel system prompt path, got=%q", got)
				}
				if len(req.Messages) < 3 || req.Messages[len(req.Messages)-1].GetRole() != "user" || req.Messages[len(req.Messages)-1].GetContent() != "Runtime-admitted follow-up instruction: continue naturally" {
					t.Fatalf("expected follow-up context to end with the Runtime-admitted instruction, got=%v", req.Messages)
				}
				priorAssistantObserved := false
				for _, message := range req.Messages[:len(req.Messages)-1] {
					if message.GetRole() == "assistant" && message.GetContent() == "hello from runtime" {
						priorAssistantObserved = true
					}
				}
				if !priorAssistantObserved {
					t.Fatalf("expected follow-up context to include committed prior assistant text, got=%v", req.Messages)
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
			"runtime_source_ref":     testRuntimeAgentSourceRef("agent-alpha"),
			"conversation_anchor_id": anchorID,
			"thread_id":              publicChatTestAnchorThreadID(t, svc, anchorID),
			"messages": []any{
				map[string]any{"role": "user", "content": "hello"},
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
	followUpGate.release(t)
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
	firstBindings := publicChatSessionSnapshotDetail(t, firstSnapshot)["execution_bindings"].(map[string]any)
	firstBinding := firstBindings["text.generate"].(map[string]any)
	if got := firstBinding["route"]; got != "local" {
		t.Fatalf("expected first snapshot execution_bindings.text.generate.route local, got=%v", firstBinding)
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
	secondBindings := publicChatSessionSnapshotDetail(t, secondSnapshot)["execution_bindings"].(map[string]any)
	secondBinding := secondBindings["text.generate"].(map[string]any)
	if got := secondBinding["route"]; got != "local" {
		t.Fatalf("expected second snapshot execution_bindings.text.generate.route local, got=%v", secondBinding)
	}
	if got := publicChatSessionSnapshotDetail(t, secondSnapshot)["transcript_message_count"]; got != float64(2) {
		t.Fatalf("follow-up output must not fabricate a public user/assistant transcript pair, got=%v", publicChatSessionSnapshotDetail(t, secondSnapshot))
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
