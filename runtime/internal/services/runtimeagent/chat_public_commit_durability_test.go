package runtimeagent

import (
	"context"
	"fmt"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestPublicChatPostCommitEmissionFailuresPreserveCompletedTurnAcrossRestart(t *testing.T) {
	tests := []struct {
		name               string
		rejectedType       string
		rejectedMessage    string
		expectPostTurnSeen bool
	}{
		{name: "post_turn", rejectedType: publicChatTurnPostTurnType, rejectedMessage: "post-turn delivery rejected"},
		{name: "completed", rejectedType: publicChatTurnCompletedType, rejectedMessage: "completion delivery rejected", expectPostTurnSeen: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			statePath := t.TempDir() + "/runtime-state.json"
			svc, closeSvc := newRuntimeAgentServiceForPublicChatStatePathWithClose(t, statePath)
			firstClosed := false
			defer func() {
				if !firstClosed {
					closeSvc()
				}
			}()
			anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
			capture := newPublicChatEmitCapture()
			svc.SetPublicChatAppEmitter(func(ctx context.Context, req *runtimev1.SendAppMessageRequest) (*runtimev1.SendAppMessageResponse, error) {
				if req.GetMessageType() == tt.rejectedType {
					return nil, fmt.Errorf("%s", tt.rejectedMessage)
				}
				return capture.emit(ctx, req)
			})
			svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})
			svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
				stream: func(_ context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
					if err := emit(&runtimev1.StreamScenarioEvent{
						EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
						TraceId:   "trace-" + tt.name + "-failure",
						Payload: &runtimev1.StreamScenarioEvent_Started{
							Started: &runtimev1.ScenarioStreamStarted{ModelResolved: "qwen3-chat", RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL},
						},
					}); err != nil {
						return err
					}
					if err := emit(&runtimev1.StreamScenarioEvent{
						EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
						TraceId:   "trace-" + tt.name + "-failure",
						Payload: &runtimev1.StreamScenarioEvent_Delta{
							Delta: runtimeAgentTextStreamDelta(
								publicChatStructuredEnvelopeAPML("message-"+tt.name+"-failure", "committed before delivery failure")),
						},
					}); err != nil {
						return err
					}
					return emit(&runtimev1.StreamScenarioEvent{
						EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
						TraceId:   "trace-" + tt.name + "-failure",
						Payload: &runtimev1.StreamScenarioEvent_Completed{
							Completed: &runtimev1.ScenarioStreamCompleted{FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP},
						},
					})
				},
			})
			if err := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
				ToAppId:       publicChatRuntimeAppID,
				FromAppId:     "desktop.app",
				SubjectUserId: "user-1",
				MessageType:   publicChatTurnRequestType,
				Payload: publicChatStructPayload(t, map[string]any{
					"local_agent_ref":        testRuntimeAgentLocalRef("agent-alpha"),
					"owner_user_id":          "user-1",
					"runtime_source_ref":     testRuntimeAgentSourceRef("agent-alpha"),
					"conversation_anchor_id": anchorID,
					"messages":               []any{map[string]any{"role": "user", "content": "hello"}},
				}),
			}); err != nil {
				t.Fatalf("ConsumePublicChatAppMessage(request): %v", err)
			}
			_ = capture.waitForMessageType(t, publicChatTurnAcceptedType)
			_ = capture.waitForMessageType(t, publicChatTurnStartedType)
			_ = capture.waitForMessageType(t, publicChatTurnStructuredType)
			_ = capture.waitForMessageType(t, publicChatTurnMessageCommittedType)
			if tt.expectPostTurnSeen {
				_ = capture.waitForMessageType(t, publicChatTurnPostTurnType)
			}
			waitForPublicChatAgentIdle(t, svc, "agent-alpha")
			for _, messageType := range capture.messageTypes() {
				if messageType == publicChatTurnFailedType || messageType == publicChatTurnInterruptedType || messageType == tt.rejectedType {
					t.Fatalf("post-commit delivery failure emitted forbidden %s: %v", messageType, capture.messageTypes())
				}
			}
			snapshot := requestPublicChatSessionSnapshot(t, svc, capture, anchorID, "snapshot-"+tt.name+"-failure")
			lastTurn := publicChatLastTurnSnapshot(t, snapshot)
			if got := lastTurn["status"]; got != publicChatTurnStatusCompleted {
				t.Fatalf("post-commit delivery failure changed committed truth: %v", lastTurn)
			}

			closeSvc()
			firstClosed = true
			restarted, closeRestarted := newRuntimeAgentServiceForPublicChatStatePathWithClose(t, statePath)
			defer closeRestarted()
			restartedCapture := newPublicChatEmitCapture()
			restarted.SetPublicChatAppEmitter(restartedCapture.emit)
			recovered := requestPublicChatSessionSnapshot(t, restarted, restartedCapture, anchorID, "snapshot-"+tt.name+"-restarted")
			if got := publicChatSessionSnapshotDetail(t, recovered)["transcript_message_count"]; got != float64(2) {
				t.Fatalf("restart lost durably committed transcript: %v", publicChatSessionSnapshotDetail(t, recovered))
			}
			if got := publicChatLastTurnSnapshot(t, recovered)["status"]; got != publicChatTurnStatusCompleted {
				t.Fatalf("restart changed completed projection truth: %v", publicChatLastTurnSnapshot(t, recovered))
			}
		})
	}
}

func TestPublicChatInterruptAfterDurableCommitCannotReclassifyTurn(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	capture := newPublicChatEmitCapture()
	interruptInjected := false
	svc.SetPublicChatAppEmitter(func(ctx context.Context, req *runtimev1.SendAppMessageRequest) (*runtimev1.SendAppMessageResponse, error) {
		if req.GetMessageType() == publicChatTurnMessageCommittedType && !interruptInjected {
			interruptInjected = true
			turnID := strings.TrimSpace(fmt.Sprint(req.GetPayload().AsMap()["turn_id"]))
			if err := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
				ToAppId:       publicChatRuntimeAppID,
				FromAppId:     "desktop.app",
				SubjectUserId: "user-1",
				MessageType:   publicChatTurnInterruptType,
				Payload: publicChatStructPayload(t, map[string]any{
					"conversation_anchor_id": anchorID,
					"turn_id":                turnID,
					"reason":                 "user_cancel",
				}),
			}); err != nil {
				return nil, fmt.Errorf("inject post-commit interrupt: %w", err)
			}
		}
		return capture.emit(ctx, req)
	})
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(_ context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   "trace-post-commit-interrupt",
				Payload: &runtimev1.StreamScenarioEvent_Started{Started: &runtimev1.ScenarioStreamStarted{
					ModelResolved: "qwen3-chat",
					RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
				}},
			}); err != nil {
				return err
			}
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
				TraceId:   "trace-post-commit-interrupt",
				Payload: &runtimev1.StreamScenarioEvent_Delta{Delta: runtimeAgentTextStreamDelta(

					publicChatStructuredEnvelopeAPML("message-post-commit-interrupt", "durable before interrupt"))},
			}); err != nil {
				return err
			}
			return emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
				TraceId:   "trace-post-commit-interrupt",
				Payload: &runtimev1.StreamScenarioEvent_Completed{Completed: &runtimev1.ScenarioStreamCompleted{
					FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
				}},
			})
		},
	})
	if err := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"local_agent_ref":        testRuntimeAgentLocalRef("agent-alpha"),
			"owner_user_id":          "user-1",
			"runtime_source_ref":     testRuntimeAgentSourceRef("agent-alpha"),
			"conversation_anchor_id": anchorID,
			"messages":               []any{map[string]any{"role": "user", "content": "commit then cancel"}},
		}),
	}); err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(request): %v", err)
	}
	_ = capture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = capture.waitForMessageType(t, publicChatTurnInterruptAckType)
	_ = capture.waitForMessageType(t, publicChatTurnMessageCommittedType)
	_ = capture.waitForMessageType(t, publicChatTurnCompletedType)
	waitForPublicChatAgentIdle(t, svc, "agent-alpha")
	for _, messageType := range capture.messageTypes() {
		if messageType == publicChatTurnFailedType || messageType == publicChatTurnInterruptedType {
			t.Fatalf("post-commit interrupt created forbidden terminal truth %s: %v", messageType, capture.messageTypes())
		}
	}
	snapshot := requestPublicChatSessionSnapshot(t, svc, capture, anchorID, "snapshot-post-commit-interrupt")
	if got := publicChatLastTurnSnapshot(t, snapshot)["status"]; got != publicChatTurnStatusCompleted {
		t.Fatalf("post-commit interrupt reclassified durable turn: %v", publicChatLastTurnSnapshot(t, snapshot))
	}
	if got := publicChatSessionSnapshotDetail(t, snapshot)["transcript_message_count"]; got != float64(2) {
		t.Fatalf("post-commit interrupt erased durable transcript: %v", publicChatSessionSnapshotDetail(t, snapshot))
	}
}
