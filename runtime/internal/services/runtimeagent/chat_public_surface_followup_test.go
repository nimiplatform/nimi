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
	"google.golang.org/protobuf/proto"
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
			"local_agent_ref":        testRuntimeAgentLocalRef("agent-alpha"),
			"owner_user_id":          "user-1",
			"runtime_source_ref":     "agent-alpha",
			"conversation_anchor_id": anchorID,
			"thread_id":              "thread-preflight-failure",
			"messages": []any{
				map[string]any{"role": "user", "content": "hello"},
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

func TestPublicChatReserveKeepsRuntimeTranscriptAndCommitsCurrentPairAtomically(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	committed := []*runtimev1.ChatMessage{
		{Role: "user", Content: "first user"},
		{Role: "assistant", Content: "first assistant"},
	}
	svc.chatSurfaceMu.Lock()
	svc.chatAnchors[anchorID].CommittedTranscript = testPublicChatCommittedTranscript([2]string{"first user", "first assistant"})
	svc.chatSurfaceMu.Unlock()

	req := publicChatTurnRequestPayload{
		LocalAgentRef:        testRuntimeAgentLocalRef("agent-alpha"),
		OwnerUserID:          "user-1",
		RuntimeSourceRef:     "agent-alpha",
		ConversationAnchorID: anchorID,
		Messages: []publicChatMessagePayload{
			{Role: "user", Content: "forged caller replay"},
			{Role: "assistant", Content: "forged caller assistant"},
			{Role: "user", Content: "second user"},
		},
	}
	_, turn, _, err := svc.reservePublicChatTurn(context.Background(), "zhiyu.app", "user-1", req)
	if err != nil {
		t.Fatalf("reservePublicChatTurn: %v", err)
	}
	defer turn.Cancel()
	defer svc.releasePublicChatTurn(anchorID, turn.TurnID)

	svc.chatSurfaceMu.Lock()
	afterReserve, projectionErr := publicChatTranscriptProjection(svc.chatAnchors[anchorID].CommittedTranscript)
	svc.chatSurfaceMu.Unlock()
	if projectionErr != nil {
		t.Fatalf("project committed transcript after reserve: %v", projectionErr)
	}
	if len(afterReserve) != len(committed) || !proto.Equal(afterReserve[0], committed[0]) || !proto.Equal(afterReserve[1], committed[1]) {
		t.Fatalf("reserve must not reconcile caller history into Runtime transcript: got=%v", afterReserve)
	}
	current := &runtimev1.ChatMessage{Role: "user", Content: "second user"}
	if err := svc.commitPublicChatTurnTranscript(anchorID, current, "second assistant"); err != nil {
		t.Fatalf("commitPublicChatTurnTranscript: %v", err)
	}
	if err := svc.commitPublicChatTurnTranscript(anchorID, current, "second assistant"); err != nil {
		t.Fatalf("commitPublicChatTurnTranscript replay: %v", err)
	}
	svc.chatSurfaceMu.Lock()
	transcript, projectionErr := publicChatTranscriptProjection(svc.chatAnchors[anchorID].CommittedTranscript)
	svc.chatSurfaceMu.Unlock()
	if projectionErr != nil {
		t.Fatalf("project committed transcript after commit: %v", projectionErr)
	}
	if len(transcript) != 4 || transcript[2].GetContent() != "second user" || transcript[3].GetContent() != "second assistant" {
		t.Fatalf("expected one atomic current user/assistant pair, got=%v", transcript)
	}
}

func TestPublicChatCommittedTranscriptTurnReplayIsIdempotentAcrossLaterTurns(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	first := &runtimev1.ChatMessage{Role: "user", Content: "first user"}
	second := &runtimev1.ChatMessage{Role: "user", Content: "second user"}
	if err := svc.commitPublicChatTurnTranscriptForTurn(anchorID, "turn-first", first, "first assistant"); err != nil {
		t.Fatalf("commit first transcript turn: %v", err)
	}
	if err := svc.commitPublicChatTurnTranscriptForTurn(anchorID, "turn-second", second, "second assistant"); err != nil {
		t.Fatalf("commit second transcript turn: %v", err)
	}
	if err := svc.commitPublicChatTurnTranscriptForTurn(anchorID, "turn-first", first, "first assistant"); err != nil {
		t.Fatalf("replay first transcript turn: %v", err)
	}
	svc.chatSurfaceMu.Lock()
	turnCount := len(svc.chatAnchors[anchorID].CommittedTranscript)
	svc.chatSurfaceMu.Unlock()
	if turnCount != 2 {
		t.Fatalf("exact replay must not append a duplicate committed turn, got=%d", turnCount)
	}
	if err := svc.commitPublicChatTurnTranscriptForTurn(anchorID, "turn-first", first, "conflicting assistant"); err == nil {
		t.Fatal("conflicting replay must fail closed")
	}
}

func TestPublicChatAnchorContinuityCrossesAppsButEventsStayWithTurnCaller(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	req := publicChatTurnRequestPayload{
		LocalAgentRef:        testRuntimeAgentLocalRef("agent-alpha"),
		OwnerUserID:          "user-1",
		RuntimeSourceRef:     "agent-alpha",
		ConversationAnchorID: anchorID,
		Messages:             []publicChatMessagePayload{{Role: "user", Content: "continue from Zhiyu"}},
	}
	session, turn, _, err := svc.reservePublicChatTurn(context.Background(), "zhiyu.app", "user-1", req)
	if err != nil {
		t.Fatalf("cross-app reservePublicChatTurn: %v", err)
	}
	defer turn.Cancel()
	defer svc.releasePublicChatTurn(anchorID, turn.TurnID)
	if session.CallerAppID != "zhiyu.app" || turn.CallerAppID != "zhiyu.app" {
		t.Fatalf("turn caller projection mismatch: session=%q turn=%q", session.CallerAppID, turn.CallerAppID)
	}
	if err := svc.emitPublicChatTurnEvent(session, turn.TurnID, publicChatTurnAcceptedType, publicChatAcceptedDetail("cross-app")); err != nil {
		t.Fatalf("emitPublicChatTurnEvent: %v", err)
	}
	if emitted := capture.waitForMessageType(t, publicChatTurnAcceptedType); emitted.GetToAppId() != "zhiyu.app" {
		t.Fatalf("turn event delivered to %q, want current turn caller", emitted.GetToAppId())
	}
	if _, _, _, _, err := svc.snapshotPublicChatAnchorForCaller("third-surface.app", anchorID); err != nil {
		t.Fatalf("cross-app snapshot: %v", err)
	}
	if _, gotTurn, err := svc.lookupPublicChatTurnForInterrupt("third-surface.app", "user-1", publicChatTurnInterruptPayload{
		ConversationAnchorID: anchorID,
		TurnID:               turn.TurnID,
	}); err != nil || gotTurn.TurnID != turn.TurnID {
		t.Fatalf("cross-app interrupt lookup: turn=%q err=%v", gotTurn.TurnID, err)
	}
	if _, _, err := svc.lookupPublicChatTurnForInterrupt("third-surface.app", "other-user", publicChatTurnInterruptPayload{
		ConversationAnchorID: anchorID,
		TurnID:               turn.TurnID,
	}); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("cross-subject interrupt lookup must fail closed, got %v", err)
	}
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
			"local_agent_ref":        testRuntimeAgentLocalRef("agent-alpha"),
			"owner_user_id":          "user-1",
			"runtime_source_ref":     "agent-alpha",
			"conversation_anchor_id": anchorID,
			"thread_id":              "thread-cancel-follow-up",
			"messages": []any{
				map[string]any{"role": "user", "content": "hello"},
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
		FromAppId:     "zhiyu.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"local_agent_ref":        testRuntimeAgentLocalRef("agent-alpha"),
			"owner_user_id":          "user-1",
			"runtime_source_ref":     "agent-alpha",
			"conversation_anchor_id": anchorID,
			"thread_id":              "thread-cancel-follow-up",
			"messages": []any{
				map[string]any{"role": "user", "content": "new user reply"},
			},
		}),
	})
	if secondErr != nil {
		t.Fatalf("ConsumePublicChatAppMessage(second): %v", secondErr)
	}
	// There is no admitted runtime.agent.follow_up.* public event family.
	// Follow-up cancellation on new-user-turn must be
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
				if got := strings.TrimSpace(req.SystemPrompt); strings.Contains(got, "resume after restart") {
					t.Fatalf("follow-up instruction must not own a special system prompt path, got=%q", got)
				}
				if len(req.Messages) == 0 || req.Messages[len(req.Messages)-1].GetRole() != "user" || req.Messages[len(req.Messages)-1].GetContent() != "Runtime-admitted follow-up instruction: resume after restart" {
					t.Fatalf("expected composed context to end with the Runtime-admitted follow-up instruction, got=%v", req.Messages)
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
			"local_agent_ref":        testRuntimeAgentLocalRef("agent-alpha"),
			"owner_user_id":          "user-1",
			"runtime_source_ref":     "agent-alpha",
			"conversation_anchor_id": anchorID,
			"thread_id":              "thread-recovery",
			"messages": []any{
				map[string]any{"role": "user", "content": "hello"},
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
	svc.mu.RLock()
	hookCursor := svc.sequence
	svc.mu.RUnlock()
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
			"thread_id":              "thread-session-reuse-cancel",
			"messages": []any{
				map[string]any{"role": "user", "content": "hello"},
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
			"local_agent_ref":        testRuntimeAgentLocalRef("agent-alpha"),
			"owner_user_id":          "user-1",
			"runtime_source_ref":     "agent-alpha",
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
	// follow-up without requiring any runtime.agent.follow_up.* public event.
	// Verification uses the admitted accepted
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
	hookStream := newAgentEventCaptureStreamLimit(context.Background(), 3)
	if err := svc.SubscribeAgentEvents(&runtimev1.SubscribeAgentEventsRequest{
		Context:      testRuntimeAgentIdentityContext("agent-alpha"),
		AgentId:      "agent-alpha",
		Cursor:       encodeCursor(hookCursor),
		EventFilters: []runtimev1.AgentEventType{runtimev1.AgentEventType_AGENT_EVENT_TYPE_HOOK},
	}, hookStream); err != context.Canceled {
		t.Fatalf("SubscribeAgentEvents(hook cancellation): %v", err)
	}
	if len(hookStream.events) != 3 {
		t.Fatalf("expected proposed+pending+canceled hook events, got %#v", hookStream.events)
	}
	for index, want := range []runtimev1.HookAdmissionState{
		runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PROPOSED,
		runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PENDING,
		runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_CANCELED,
	} {
		detail := hookStream.events[index].GetHook()
		if got := detail.GetFamily(); got != want {
			t.Fatalf("unexpected hook lifecycle event at index %d: got %s want %s", index, got, want)
		}
		intent := detail.GetIntent()
		if got := strings.TrimSpace(intent.GetIntentId()); got != "action-follow-up-1" {
			t.Fatalf("expected canceled hook to preserve action id, got %#v", intent)
		}
		if got := strings.TrimSpace(intent.GetConversationAnchorId()); got != anchorID {
			t.Fatalf("expected canceled hook to preserve anchor id %s, got %#v", anchorID, intent)
		}
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
			"local_agent_ref":        testRuntimeAgentLocalRef("agent-alpha"),
			"owner_user_id":          "user-1",
			"runtime_source_ref":     "agent-alpha",
			"conversation_anchor_id": anchorID,
			"thread_id":              "thread-follow-up-cancel-action-hint",
			"messages": []any{
				map[string]any{"role": "user", "content": "hello"},
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
	// Public chat does not admit a runtime.agent.follow_up.* event family;
	// cancellation is observed through the unary public chat session
	// snapshot only (`last_turn.follow_up.status`).
	deadline := time.Now().Add(2 * time.Second)
	var lastSnapshotPayload map[string]any
	for time.Now().Before(deadline) {
		snapshot := requestPublicChatSessionSnapshot(t, svc, capture, anchorID, "snapshot-follow-up-launch-failed")
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
	snapshot := requestPublicChatSessionSnapshot(t, svc, capture, anchorID, "snapshot-follow-up-launch-failed")
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
			"local_agent_ref":        testRuntimeAgentLocalRef("agent-alpha"),
			"owner_user_id":          "user-1",
			"runtime_source_ref":     "agent-alpha",
			"conversation_anchor_id": anchorID,
			"thread_id":              "thread-restart-snapshot",
			"messages": []any{
				map[string]any{"role": "user", "content": "hello"},
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
	snapshot := requestPublicChatSessionSnapshot(t, recoveredSvc, recoveredCapture, anchorID, "restart-snapshot-1")
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
	if assistantMemory, ok := lastTurn["assistant_memory"].(map[string]any); !ok || assistantMemory["status"] != "skipped" {
		t.Fatalf("expected persisted assistant memory outcome, got=%v", lastTurn)
	}
}
