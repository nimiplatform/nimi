package runtimeagent

import (
	"context"
	"fmt"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestPublicChatTurnRequestStreamsAndAppliesPostTurnEffects(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(_ context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			envelope := publicChatStructuredEnvelopeAPML("message-1", "hello from runtime")
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   "trace-public-chat",
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
				TraceId:   "trace-public-chat",
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
				TraceId:   "trace-public-chat",
				Payload: &runtimev1.StreamScenarioEvent_Completed{
					Completed: &runtimev1.ScenarioStreamCompleted{
						FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
						Usage: &runtimev1.UsageStats{
							InputTokens:  11,
							OutputTokens: 7,
							ComputeMs:    13,
						},
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
			"runtime_source_ref":     "agent-alpha",
			"conversation_anchor_id": anchorID,
			"request_id":             "desktop-turn-request-1",
			"thread_id":              publicChatTestAnchorThreadID(t, svc, anchorID),
			"messages": []any{
				map[string]any{"role": "user", "content": "hello"},
			},
		}),
	})
	if err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(request): %v", err)
	}
	accepted := capture.waitForMessageType(t, publicChatTurnAcceptedType)
	started := capture.waitForMessageType(t, publicChatTurnStartedType)
	delta := capture.waitForMessageType(t, publicChatTurnTextDeltaType)
	structured := capture.waitForMessageType(t, publicChatTurnStructuredType)
	committed := capture.waitForMessageType(t, publicChatTurnMessageCommittedType)
	postTurn := capture.waitForMessageType(t, publicChatTurnPostTurnType)
	completed := capture.waitForMessageType(t, publicChatTurnCompletedType)
	assertPublicChatDeltaPrecedesCommit(t, capture)
	acceptedPayload := publicChatPayloadMap(t, accepted)
	gotAnchorID := acceptedPayload["conversation_anchor_id"].(string)
	turnID := acceptedPayload["turn_id"].(string)
	if gotAnchorID != anchorID || turnID == "" {
		t.Fatalf("expected accepted envelope to carry conversation_anchor_id and turn_id, got=%v", acceptedPayload)
	}
	if _, ok := acceptedPayload["stream_id"].(string); !ok {
		t.Fatalf("expected accepted envelope stream_id, got=%v", acceptedPayload)
	}
	acceptedDetail := publicChatTurnDetail(t, accepted)
	if got := acceptedDetail["request_id"]; got != "desktop-turn-request-1" {
		t.Fatalf("expected accepted.detail.request_id to echo request payload correlation id, got=%v", acceptedDetail)
	}
	// session/transcript/execution truth must NOT live on turn events per yaml.
	for _, banned := range []string{"session_status", "transcript_message_count", "execution_binding", "model_resolved", "trace_id", "stream_sequence", "thread_id", "turn_origin"} {
		if _, present := acceptedPayload[banned]; present {
			t.Fatalf("runtime.agent.turn.accepted envelope must not carry %q per yaml; got=%v", banned, acceptedPayload)
		}
	}
	startedDetail := publicChatTurnDetail(t, started)
	if got := startedDetail["track"]; got != "chat" {
		t.Fatalf("expected started.detail.track=chat, got=%v", startedDetail)
	}
	if _, banned := publicChatPayloadMap(t, started)["model_resolved"]; banned {
		t.Fatalf("runtime.agent.turn.started must not carry model_resolved per yaml")
	}
	deltaDetail := publicChatTurnDetail(t, delta)
	if got := deltaDetail["text"]; got != "hello from runtime" {
		t.Fatalf("unexpected delta.detail.text: %v", got)
	}
	structuredDetail := publicChatTurnDetail(t, structured)
	if got := structuredDetail["kind"]; got != publicChatStructuredSchemaID {
		t.Fatalf("expected structured.detail.kind=schema id, got=%v", structuredDetail)
	}
	structuredPayload := structuredDetail["payload"].(map[string]any)
	messagePayload := structuredPayload["message"].(map[string]any)
	if got := messagePayload["text"]; got != "hello from runtime" {
		t.Fatalf("unexpected structured message text: %v", got)
	}
	// runtime.agent.turn.message_committed: yaml requires `message_id`
	// envelope extra plus `{message_id, text}` detail.
	committedPayload := publicChatPayloadMap(t, committed)
	if got := committedPayload["message_id"]; got != "message-1" {
		t.Fatalf("expected message_committed envelope message_id=message-1, got=%v", committedPayload)
	}
	committedDetail := publicChatTurnDetail(t, committed)
	if got := committedDetail["message_id"]; got != "message-1" {
		t.Fatalf("expected message_committed.detail.message_id=message-1, got=%v", committedDetail)
	}
	if got := committedDetail["text"]; got != "hello from runtime" {
		t.Fatalf("expected message_committed.detail.text=hello from runtime, got=%v", committedDetail)
	}
	// post_turn.detail is indication-only; runtime execution truth
	// (assistant_memory etc.) must not appear here.
	postTurnDetail := publicChatTurnDetail(t, postTurn)
	for _, banned := range []string{"assistant_memory", "chat_sidecar", "follow_up", "trace_id"} {
		if _, present := postTurnDetail[banned]; present {
			t.Fatalf("runtime.agent.turn.post_turn.detail must be indication-only; saw %q in %v", banned, postTurnDetail)
		}
	}
	// completed.detail is `terminal_reason?` only.
	completedDetail := publicChatTurnDetail(t, completed)
	if got := completedDetail["terminal_reason"]; got != "stop" {
		t.Fatalf("expected completed.detail.terminal_reason=stop, got=%v", completedDetail)
	}
	for _, banned := range []string{"text", "message_id", "usage", "model_resolved", "trace_id"} {
		if _, present := completedDetail[banned]; present {
			t.Fatalf("runtime.agent.turn.completed.detail must be terminal_reason-only; saw %q in %v", banned, completedDetail)
		}
	}
	waitForPublicChatAgentIdle(t, svc, "agent-alpha")
	memoryResp, err := svc.QueryAgentMemory(context.Background(), &runtimev1.QueryAgentMemoryRequest{
		Context:          testRuntimeAgentIdentityContext("agent-alpha"),
		AgentId:          testRuntimeAgentLocalRef("agent-alpha"),
		Query:            "",
		Limit:            10,
		CanonicalClasses: []runtimev1.MemoryCanonicalClass{runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_DYADIC},
	})
	if err != nil {
		t.Fatalf("QueryAgentMemory: %v", err)
	}
	if len(memoryResp.GetMemories()) != 0 {
		t.Fatalf("public chat must not auto-write dyadic assistant memory without committed verdict evidence, got=%d", len(memoryResp.GetMemories()))
	}
	snapshot := requestPublicChatSessionSnapshot(t, svc, capture, anchorID, "snapshot-committed-transcript")
	snapshotDetail := publicChatSessionSnapshotDetail(t, snapshot)
	if got := snapshotDetail["transcript_message_count"]; got != float64(2) {
		t.Fatalf("expected committed assistant in transcript, got snapshot=%v", snapshotDetail)
	}
	transcript := snapshotDetail["transcript"].([]any)
	user := transcript[0].(map[string]any)
	if got := user["id"]; got != anchorID+":transcript:0" {
		t.Fatalf("expected transcript[0].id to be runtime-owned envelope id, got=%v", user)
	}
	if got := user["status"]; got != "complete" {
		t.Fatalf("expected transcript[0].status=complete, got=%v", user)
	}
	if got := user["kind"]; got != "text" {
		t.Fatalf("expected transcript[0].kind=text, got=%v", user)
	}
	if got := strings.TrimSpace(fmt.Sprint(user["created_at"])); got == "" {
		t.Fatalf("expected transcript[0].created_at, got=%v", user)
	}
	assistant := transcript[1].(map[string]any)
	if got := assistant["id"]; got != anchorID+":transcript:1" {
		t.Fatalf("expected transcript[1].id to be runtime-owned envelope id, got=%v", assistant)
	}
	if got := assistant["role"]; got != "assistant" {
		t.Fatalf("expected transcript[1].role=assistant, got=%v", assistant)
	}
	if got := assistant["content"]; got != "hello from runtime" {
		t.Fatalf("expected transcript[1].content=hello from runtime, got=%v", assistant)
	}
}
