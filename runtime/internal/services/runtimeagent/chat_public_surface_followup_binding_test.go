package runtimeagent

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

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
			"local_agent_ref":        testRuntimeAgentLocalRef("agent-alpha"),
			"owner_user_id":          "user-1",
			"runtime_source_ref":     testRuntimeAgentSourceRef("agent-alpha"),
			"conversation_anchor_id": anchorID,
			"messages": []any{
				map[string]any{"role": "user", "content": "second turn"},
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
			"local_agent_ref":        testRuntimeAgentLocalRef("agent-alpha"),
			"owner_user_id":          "user-1",
			"runtime_source_ref":     testRuntimeAgentSourceRef("agent-alpha"),
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

// TestPublicChatTurnAdmissionFollowsMachineBindingReplacement proves every
// turn resolves independent exact machine binding truth at admission. The
// retired AIConfig revision remains zero in the legacy snapshot field.
func TestPublicChatTurnAdmissionFollowsMachineBindingReplacement(t *testing.T) {
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
		t.Fatalf("ConsumePublicChatAppMessage(initial session): %v", err)
	}
	_ = capture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = capture.waitForMessageType(t, publicChatTurnStartedType)
	_ = capture.waitForMessageType(t, publicChatTurnTextDeltaType)
	_ = capture.waitForMessageType(t, publicChatTurnStructuredType)
	_ = capture.waitForMessageType(t, publicChatTurnPostTurnType)
	_ = capture.waitForMessageType(t, publicChatTurnCompletedType)
	waitForPublicChatAgentIdle(t, svc, "agent-alpha")

	firstSnapshot := requestPublicChatSessionSnapshot(t, svc, capture, anchorID, "snapshot-config-revision-first")
	firstDetail := publicChatSessionSnapshotDetail(t, firstSnapshot)
	if got := firstDetail["config_revision"]; got != float64(0) {
		t.Fatalf("retired config revision must remain zero, got=%v", firstDetail)
	}
	firstBindings := firstDetail["execution_bindings"].(map[string]any)
	firstText := firstBindings["text.generate"].(map[string]any)
	if got := firstText["model_id"]; got != "local/default" {
		t.Fatalf("expected first turn to bind seeded text model, got=%v", firstText)
	}

	// Replace independent machine execution truth; the next turn binds the
	// new exact target without a config revision or CAS.
	upsertPublicChatTestAgentAIConfig(t, svc, publicChatExecutionBinding{
		BindingAlias: "local/qwen3-chat", ModelID: "local/qwen3-chat",
		RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		TargetRef:   publicChatTestLocalRuntimeTargetRef("test_runtime_readiness:v2:qwen3-chat"),
	})

	err = svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
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
				map[string]any{"role": "user", "content": "hello again"},
			},
		}),
	})
	if err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(post-mutation turn): %v", err)
	}
	_ = capture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = capture.waitForMessageType(t, publicChatTurnCompletedType)
	waitForPublicChatAgentIdle(t, svc, "agent-alpha")

	secondSnapshot := requestPublicChatSessionSnapshot(t, svc, capture, anchorID, "snapshot-config-revision-second")
	secondDetail := publicChatSessionSnapshotDetail(t, secondSnapshot)
	if got := secondDetail["config_revision"]; got != float64(0) {
		t.Fatalf("retired config revision must remain zero after replacement, got=%v", secondDetail)
	}
	secondBindings := secondDetail["execution_bindings"].(map[string]any)
	secondText := secondBindings["text.generate"].(map[string]any)
	if got := secondText["model_id"]; got != "local/qwen3-chat" {
		t.Fatalf("expected post-mutation turn to bind committed model, got=%v", secondText)
	}
}

// TestPublicChatTurnRequestRejectsMissingConversationAnchorID is a fail-closed
// negative proof for K-AGCORE-034: runtime.agent.turn.request
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
			"local_agent_ref":    testRuntimeAgentLocalRef("agent-alpha"),
			"owner_user_id":      "user-1",
			"runtime_source_ref": testRuntimeAgentSourceRef("agent-alpha"),
			"messages": []any{
				map[string]any{"role": "user", "content": "hello"},
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
			"local_agent_ref":        testRuntimeAgentLocalRef("agent-alpha"),
			"owner_user_id":          "user-1",
			"runtime_source_ref":     testRuntimeAgentSourceRef("agent-alpha"),
			"conversation_anchor_id": "agent_anchor_never_opened",
			"messages": []any{
				map[string]any{"role": "user", "content": "hello"},
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
// runtime carrier. Any inbound message with
// those message types must fail closed -not be silently upgraded or
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
					"local_agent_ref":    testRuntimeAgentLocalRef("agent-alpha"),
					"owner_user_id":      "user-1",
					"runtime_source_ref": testRuntimeAgentSourceRef("agent-alpha"),
					"session_id":         "session-legacy",
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
