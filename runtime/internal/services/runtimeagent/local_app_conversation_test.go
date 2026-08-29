package runtimeagent

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/png"
	"strings"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/protectedprincipal"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	runtimeartifact "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
)

func TestLocalAppConversationWireIsExactAndHasNoGenericMessageEnvelope(t *testing.T) {
	send := (&runtimev1.SendLocalAppConversationTurnRequest{}).ProtoReflect().Descriptor()
	if send.Fields().Len() != 4 {
		t.Fatalf("send field count = %d, want handle, anchor, request id, parts", send.Fields().Len())
	}
	for _, forbidden := range []string{
		"agent_id", "local_agent_id", "attachments", "message_type", "payload", "context",
		"provider", "model", "credential", "subject_user_id",
	} {
		if send.Fields().ByName(protoreflectName(forbidden)) != nil {
			t.Fatalf("send wire exposes forbidden field %q", forbidden)
		}
	}
	event := (&runtimev1.LocalAppConversationEvent{}).ProtoReflect().Descriptor()
	if event.Fields().Len() != 19 || event.Oneofs().Len() != 1 {
		t.Fatalf("event descriptor fields=%d oneofs=%d", event.Fields().Len(), event.Oneofs().Len())
	}
	for _, forbidden := range []string{
		"message_type", "payload", "agent_id", "local_agent_id", "trace_id", "credential", "private_context",
	} {
		if event.Fields().ByName(protoreflectName(forbidden)) != nil {
			t.Fatalf("event wire exposes forbidden field %q", forbidden)
		}
	}
	snapshot := (&runtimev1.LocalAppConversationSnapshot{}).ProtoReflect().Descriptor()
	if snapshot.Fields().Len() != 7 {
		t.Fatalf("snapshot field count = %d", snapshot.Fields().Len())
	}
}

func TestLocalAppConversationLiveToolHasClosedLifecycleAndLateEventFence(t *testing.T) {
	svc, session, _, _ := prepareActiveAgentRealtimeTurnForTest(t, accountservice.LocalAppOperationAgentRealtimeOpen)
	turnID := session.turn.turn.TurnID
	payload := func(lifecycle string, progress any, result any) map[string]any {
		detail := map[string]any{"tool_id": "tool-child-1", "name": "calendar.lookup", "lifecycle": lifecycle}
		if progress != nil {
			detail["progress"] = progress
		}
		if result != nil {
			detail["result"] = result
		}
		return map[string]any{
			"conversation_anchor_id": session.conversationAnchorID,
			"turn_id":                turnID,
			"detail":                 detail,
			"timeline":               map[string]any{},
		}
	}
	started, supported, err := svc.projectLocalAppConversationEvents(publicChatTurnLiveToolType, payload("started", nil, nil), 1)
	if err != nil || !supported || len(started) != 1 || started[0].GetLiveTool().GetToolId() != "tool-child-1" {
		t.Fatalf("started live tool = %+v supported=%v err=%v", started, supported, err)
	}
	updated, _, err := svc.projectLocalAppConversationEvents(publicChatTurnLiveToolType, payload("updated", "halfway", nil), 2)
	if err != nil || updated[0].GetLiveTool().GetProgress() != "halfway" {
		t.Fatalf("updated live tool = %+v err=%v", updated, err)
	}
	completed, _, err := svc.projectLocalAppConversationEvents(publicChatTurnLiveToolType, payload("completed", nil, "sanitized result"), 3)
	if err != nil || completed[0].GetLiveTool().GetResult() != "sanitized result" {
		t.Fatalf("completed live tool = %+v err=%v", completed, err)
	}
	if _, supported, err := svc.projectLocalAppConversationEvents(publicChatTurnLiveToolType, payload("updated", "late", nil), 4); err == nil || !supported {
		t.Fatalf("late live tool update = supported=%v err=%v", supported, err)
	}
}

func TestLocalAppConversationTextDeltaValidationPreservesStreamingWhitespace(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	payload := func(text string) map[string]any {
		return map[string]any{
			"conversation_anchor_id": "anchor-1",
			"turn_id":                "turn-1",
			"timeline":               map[string]any{"sequence": int64(1)},
			"detail":                 map[string]any{"text": text},
		}
	}
	for _, fragment := range []string{"DeepSeek", " burst", "trailing ", "\n", " \t"} {
		events, supported, err := svc.projectLocalAppConversationEvents(publicChatTurnTextDeltaType, payload(fragment), 1)
		if err != nil || !supported || len(events) != 1 || events[0].GetTextDelta().GetDelta() != fragment {
			t.Fatalf("streaming fragment %q projection=%+v supported=%v err=%v", fragment, events, supported, err)
		}
	}
	for name, fragment := range map[string]string{
		"empty":    "",
		"nul":      "a\x00b",
		"invalid":  string([]byte{0xff}),
		"oversize": strings.Repeat("x", 16*1024+1),
	} {
		if _, supported, err := svc.projectLocalAppConversationEvents(publicChatTurnTextDeltaType, payload(fragment), 1); err == nil || !supported {
			t.Fatalf("invalid delta %s was admitted: supported=%v err=%v", name, supported, err)
		}
	}
}

func TestLocalAppConversationSubscriberOverflowIsExactAndRetryable(t *testing.T) {
	subscriber := &localAppConversationSubscriber{events: make(chan localAppConversationEmission, 1)}
	subscriber.events <- localAppConversationEmission{event: &runtimev1.LocalAppConversationEvent{}}
	sendLocalAppConversationEmission(subscriber, localAppConversationEmission{event: &runtimev1.LocalAppConversationEvent{}})
	emission := <-subscriber.events
	if status.Code(emission.err) != codes.ResourceExhausted {
		t.Fatalf("overflow status = %v", emission.err)
	}
	reason, ok := grpcerr.ExtractReasonCode(emission.err)
	if !ok || reason != runtimev1.ReasonCode_LOCAL_APP_OWNER_UNAVAILABLE {
		t.Fatalf("overflow reason = %s ok=%v", reason, ok)
	}
	metadata, ok := grpcerr.ExtractReasonMetadata(emission.err)
	if !ok || metadata["diagnostic_stage"] != "local_app_conversation_subscription_overflow" || metadata["retryable"] != "true" {
		t.Fatalf("overflow metadata = %#v ok=%v", metadata, ok)
	}
}

func TestLocalAppConversationSubscriberBatchesNormalTextDeltaBurst(t *testing.T) {
	subscriber := &localAppConversationSubscriber{events: make(chan localAppConversationEmission, 4)}
	for sequence := uint64(1); sequence <= 128; sequence++ {
		sendLocalAppConversationEmission(subscriber, localAppConversationEmission{event: &runtimev1.LocalAppConversationEvent{
			ConversationAnchorId: "anchor-1",
			Sequence:             sequence,
			Event: &runtimev1.LocalAppConversationEvent_TextDelta{TextDelta: &runtimev1.LocalAppConversationTextDelta{
				TurnId: "turn-1", Delta: "x",
			}},
		}})
	}
	var combined strings.Builder
	previousSequence := uint64(0)
	for len(subscriber.events) > 0 {
		emission := <-subscriber.events
		if emission.err != nil {
			t.Fatalf("normal provider delta burst became slow-consumer terminal: %v", emission.err)
		}
		if emission.event.GetSequence() <= previousSequence {
			t.Fatalf("batched delta sequence regressed: previous=%d current=%d", previousSequence, emission.event.GetSequence())
		}
		if len(emission.event.GetTextDelta().GetDelta()) > localAppConversationTextDeltaBatchBytes {
			t.Fatalf("batched delta exceeded bound: %d", len(emission.event.GetTextDelta().GetDelta()))
		}
		previousSequence = emission.event.GetSequence()
		combined.WriteString(emission.event.GetTextDelta().GetDelta())
	}
	if combined.Len() != 128 || previousSequence != 128 {
		t.Fatalf("batched burst lost data: bytes=%d through=%d", combined.Len(), previousSequence)
	}
}

func TestLocalAppConversationPublisherBatchesDeepSeekStyleDeltaBurst(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	_, events := svc.addLocalAppConversationSubscriber(localAppConversationSubscriber{
		accountID: "user-1", conversationAnchorID: anchorID,
	})
	for index := 0; index < 128; index++ {
		if err := svc.publishLocalAppConversationEvent("user-1", publicChatTurnTextDeltaType, map[string]any{
			"conversation_anchor_id": anchorID,
			"turn_id":                "agent_turn_deepseek_burst",
			"timeline":               map[string]any{"sequence": int64(index + 1)},
			"detail":                 map[string]any{"text": "x"},
		}); err != nil {
			t.Fatalf("normal DeepSeek-style delta %d failed: %v", index+1, err)
		}
	}
	var combined strings.Builder
	previousSequence := uint64(0)
	for len(events) > 0 {
		emission := <-events
		if emission.err != nil {
			t.Fatalf("normal DeepSeek-style burst terminalized: %v", emission.err)
		}
		if emission.event.GetSequence() <= previousSequence {
			t.Fatalf("publisher batch sequence regressed: previous=%d current=%d", previousSequence, emission.event.GetSequence())
		}
		previousSequence = emission.event.GetSequence()
		combined.WriteString(emission.event.GetTextDelta().GetDelta())
	}
	if combined.Len() != 128 || previousSequence != 128 {
		t.Fatalf("publisher batch lost text: bytes=%d through=%d", combined.Len(), previousSequence)
	}
}

func TestLocalAppConversationSlowSubscriberDoesNotTerminalizeIndependentSubscriber(t *testing.T) {
	slow := &localAppConversationSubscriber{events: make(chan localAppConversationEmission, 1)}
	fast := &localAppConversationSubscriber{events: make(chan localAppConversationEmission, 2)}
	nonDelta := localAppConversationEmission{event: &runtimev1.LocalAppConversationEvent{
		ConversationAnchorId: "anchor-1", Sequence: 1,
		Event: &runtimev1.LocalAppConversationEvent_TurnStarted{TurnStarted: &runtimev1.LocalAppConversationTurnStarted{TurnId: "turn-1"}},
	}}
	sendLocalAppConversationEmission(slow, nonDelta)
	sendLocalAppConversationEmission(slow, nonDelta)
	sendLocalAppConversationEmission(fast, nonDelta)
	if terminal := <-slow.events; status.Code(terminal.err) != codes.ResourceExhausted {
		t.Fatalf("slow subscriber terminal=%v", terminal.err)
	}
	if delivered := <-fast.events; delivered.err != nil || delivered.event.GetTurnStarted() == nil {
		t.Fatalf("independent subscriber was contaminated: %+v", delivered)
	}
}

func TestLocalAppConversationHandleRevalidatesSessionAccountAndLifecycle(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	decision := localAppConversationDecision(accountservice.LocalAppOperationOpenConversation, 0x21, "user-1")
	handle := mintLocalAppAgentHandle(decision, testRuntimeAgentLocalRef("agent-alpha"))
	ctx := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision)
	opened, err := svc.OpenLocalAppConversation(ctx, &runtimev1.OpenLocalAppConversationRequest{AgentHandle: handle})
	if err != nil || opened.GetConversationAnchorId() == "" {
		t.Fatalf("OpenLocalAppConversation: response=%+v err=%v", opened, err)
	}

	for name, changed := range map[string]accountservice.LocalAppCallerDecision{
		"session":   localAppConversationDecision(accountservice.LocalAppOperationOpenConversation, 0x31, "user-1"),
		"account":   localAppConversationDecision(accountservice.LocalAppOperationOpenConversation, 0x21, "user-2"),
		"operation": localAppConversationDecision(accountservice.LocalAppOperationConversationSnapshot, 0x21, "user-1"),
	} {
		t.Run(name, func(t *testing.T) {
			_, err := svc.OpenLocalAppConversation(
				accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), changed),
				&runtimev1.OpenLocalAppConversationRequest{AgentHandle: handle},
			)
			if status.Code(err) != codes.PermissionDenied {
				t.Fatalf("stale handle error = %v", err)
			}
		})
	}

	svc.mu.Lock()
	localAgentID := testRuntimeAgentLocalRef("agent-alpha")
	entry := svc.agents[localAgentID]
	original := entry.Agent.GetLifecycleStatus()
	entry.Agent.LifecycleStatus = runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_SUSPENDED
	svc.mu.Unlock()
	_, err = svc.OpenLocalAppConversation(ctx, &runtimev1.OpenLocalAppConversationRequest{AgentHandle: handle})
	if status.Code(err) != codes.PermissionDenied {
		t.Fatalf("inactive Agent error = %v", err)
	}
	svc.mu.Lock()
	entry.Agent.LifecycleStatus = original
	delete(svc.agents, localAgentID)
	svc.mu.Unlock()
	_, err = svc.OpenLocalAppConversation(ctx, &runtimev1.OpenLocalAppConversationRequest{AgentHandle: handle})
	if status.Code(err) != codes.PermissionDenied {
		t.Fatalf("deleted Agent error = %v", err)
	}
	svc.mu.Lock()
	svc.agents[localAgentID] = entry
	svc.mu.Unlock()
}

func TestLocalAppReferenceToConversationJourneyUsesTheOwnerEngine(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(_ context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			for _, event := range []*runtimev1.StreamScenarioEvent{
				{
					EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
					TraceId:   "trace-local-app",
					Payload: &runtimev1.StreamScenarioEvent_Started{Started: &runtimev1.ScenarioStreamStarted{
						ModelResolved: "qwen3-chat", RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
					}},
				},
				{
					EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
					TraceId:   "trace-local-app",
					Payload: &runtimev1.StreamScenarioEvent_Delta{Delta: &runtimev1.ScenarioStreamDelta{
						Delta: &runtimev1.ScenarioStreamDelta_Text{Text: &runtimev1.TextStreamDelta{
							Text: publicChatStructuredEnvelopeAPML("message-local-app", "hello from Runtime"),
						}},
					}},
				},
				{
					EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
					TraceId:   "trace-local-app",
					Payload: &runtimev1.StreamScenarioEvent_Completed{Completed: &runtimev1.ScenarioStreamCompleted{
						FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
					}},
				},
			} {
				if err := emit(event); err != nil {
					return err
				}
			}
			return nil
		},
	})

	referenceDecision := localAppConversationDecision(accountservice.LocalAppOperationReferenceList, 0x39, "user-1")
	references, err := svc.ListLocalAppAgentReferences(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), referenceDecision),
		&runtimev1.ListLocalAppAgentReferencesRequest{},
	)
	if err != nil || len(references.GetReferences()) != 1 {
		t.Fatalf("reference list = %+v err=%v", references, err)
	}
	handle := references.GetReferences()[0].GetAgentHandle()

	openDecision := referenceDecision
	openDecision.Operation = accountservice.LocalAppOperationOpenConversation
	opened, err := svc.OpenLocalAppConversation(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), openDecision),
		&runtimev1.OpenLocalAppConversationRequest{AgentHandle: handle},
	)
	if err != nil {
		t.Fatal(err)
	}
	anchorID := opened.GetConversationAnchorId()

	subscribeDecision := referenceDecision
	subscribeDecision.Operation = accountservice.LocalAppOperationSubscribeConversation
	svc.SetLocalAppIngressRevalidator(localAppIngressRevalidatorFunc(func(ctx context.Context, _ localappop.Ingress) (context.Context, error) {
		return accountservice.ContextWithAuthorizedLocalAppDecision(ctx, subscribeDecision), nil
	}))
	stream := newLocalAppConversationCaptureStream(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), subscribeDecision),
		6,
	)
	streamDone := make(chan error, 1)
	go func() {
		streamDone <- svc.SubscribeLocalAppConversationEvents(
			&runtimev1.SubscribeLocalAppConversationEventsRequest{
				AgentHandle: handle, ConversationAnchorId: anchorID,
			},
			stream,
		)
	}()
	waitForLocalAppConversationSubscriber(t, svc)

	sendDecision := referenceDecision
	sendDecision.Operation = accountservice.LocalAppOperationSendConversationTurn
	sent, err := svc.SendLocalAppConversationTurn(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), sendDecision),
		&runtimev1.SendLocalAppConversationTurnRequest{
			AgentHandle: handle, ConversationAnchorId: anchorID,
			RequestId: "request-local-app",
			Parts: []*runtimev1.LocalAppConversationInputPart{{
				Part: &runtimev1.LocalAppConversationInputPart_Text{Text: &runtimev1.LocalAppConversationTextPart{Text: "hello"}},
			}},
		},
	)
	if err != nil || sent.GetTurnId() == "" {
		t.Fatalf("send = %+v err=%v", sent, err)
	}
	select {
	case err := <-streamDone:
		if err != nil {
			t.Fatalf("conversation stream: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("conversation stream did not reach terminal event")
	}
	if len(stream.events) != 6 || stream.events[5].GetTurnCompleted() == nil {
		t.Fatalf("typed conversation events = %+v", stream.events)
	}
	for _, event := range stream.events {
		if event.GetConversationAnchorId() != anchorID {
			t.Fatalf("event escaped anchor scope: %+v", event)
		}
	}

	snapshotDecision := referenceDecision
	snapshotDecision.Operation = accountservice.LocalAppOperationConversationSnapshot
	snapshot, err := svc.GetLocalAppConversationSnapshot(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), snapshotDecision),
		&runtimev1.GetLocalAppConversationSnapshotRequest{AgentHandle: handle, ConversationAnchorId: anchorID},
	)
	if err != nil || len(snapshot.GetSnapshot().GetMessages()) != 2 ||
		localAppConversationTestMessageText(snapshot.GetSnapshot().GetMessages()[1]) != "hello from Runtime" {
		t.Fatalf("journey snapshot = %+v err=%v", snapshot, err)
	}
	committed := make([]*runtimev1.LocalAppConversationMessage, 0, 2)
	for _, event := range stream.events {
		if message := event.GetMessageCommitted().GetMessage(); message != nil {
			committed = append(committed, message)
		}
	}
	if len(committed) != 2 || committed[0].GetMessageId() != snapshot.GetSnapshot().GetMessages()[0].GetMessageId() ||
		committed[1].GetMessageId() != snapshot.GetSnapshot().GetMessages()[1].GetMessageId() ||
		committed[0].GetRole() != runtimev1.LocalAppConversationMessageRole_LOCAL_APP_CONVERSATION_MESSAGE_ROLE_USER ||
		committed[1].GetRole() != runtimev1.LocalAppConversationMessageRole_LOCAL_APP_CONVERSATION_MESSAGE_ROLE_ASSISTANT {
		t.Fatalf("live/snapshot message identity or order diverged: events=%+v snapshot=%+v", stream.events, snapshot.GetSnapshot())
	}
}

func localAppConversationTestMessageText(message *runtimev1.LocalAppConversationMessage) string {
	if message == nil || len(message.GetParts()) != 1 {
		return ""
	}
	return message.GetParts()[0].GetText().GetText()
}

func TestLocalAppConversationSnapshotIsBoundedOwnerProjection(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	openDecision := localAppConversationDecision(accountservice.LocalAppOperationOpenConversation, 0x41, "user-1")
	handle := mintLocalAppAgentHandle(openDecision, testRuntimeAgentLocalRef("agent-alpha"))
	opened, err := svc.OpenLocalAppConversation(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), openDecision),
		&runtimev1.OpenLocalAppConversationRequest{AgentHandle: handle},
	)
	if err != nil {
		t.Fatal(err)
	}
	anchorID := opened.GetConversationAnchorId()
	svc.chatSurfaceMu.Lock()
	svc.chatAnchors[anchorID].CommittedTranscript = testPublicChatCommittedTranscript(
		[2]string{"hello", "hi"},
		[2]string{"status", "ready"},
	)
	svc.chatSurfaceMu.Unlock()

	snapshotDecision := openDecision
	snapshotDecision.Operation = accountservice.LocalAppOperationConversationSnapshot
	snapshot, err := svc.GetLocalAppConversationSnapshot(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), snapshotDecision),
		&runtimev1.GetLocalAppConversationSnapshotRequest{
			AgentHandle: handle, ConversationAnchorId: anchorID,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	projected := snapshot.GetSnapshot()
	if projected.GetConversationAnchorId() != anchorID || projected.GetTruncatedBefore() || len(projected.GetMessages()) != 4 {
		t.Fatalf("snapshot = %+v", projected)
	}
	for _, message := range projected.GetMessages() {
		if message.GetTurnId() == "" || message.GetMessageId() == "" || localAppConversationTestMessageText(message) == "" ||
			(message.GetRole() != runtimev1.LocalAppConversationMessageRole_LOCAL_APP_CONVERSATION_MESSAGE_ROLE_USER &&
				message.GetRole() != runtimev1.LocalAppConversationMessageRole_LOCAL_APP_CONVERSATION_MESSAGE_ROLE_ASSISTANT) {
			t.Fatalf("message = %+v", message)
		}
	}
}

func TestLocalAppConversationSnapshotKeepsActiveActionBeyondTerminalHistoryBound(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	openDecision := localAppConversationDecision(accountservice.LocalAppOperationOpenConversation, 0x43, "user-1")
	handle := mintLocalAppAgentHandle(openDecision, testRuntimeAgentLocalRef("agent-alpha"))
	opened, err := svc.OpenLocalAppConversation(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), openDecision),
		&runtimev1.OpenLocalAppConversationRequest{AgentHandle: handle},
	)
	if err != nil {
		t.Fatal(err)
	}
	anchorID := opened.GetConversationAnchorId()
	pairs := make([][2]string, 101)
	for index := range pairs {
		pairs[index] = [2]string{"user", "assistant"}
	}
	transcript := testPublicChatCommittedTranscript(pairs...)
	terminal := make(map[string]*publicChatTurnProjectionState, 100)
	for index := 0; index < 100; index++ {
		turnID := transcript[index].TurnID
		terminal[turnID] = &publicChatTurnProjectionState{TurnID: turnID, Status: publicChatTurnStatusCompleted}
	}
	activeTurnID := transcript[100].TurnID
	active := &publicChatTurnProjectionState{
		TurnID: activeTurnID,
		Status: publicChatTurnStatusCommitted,
		Structured: &publicChatStructuredEnvelope{Actions: []publicChatStructuredAction{{
			ActionID: "action-active", Modality: "image", Operation: "image.generate",
		}}},
		ActionStatus: publicChatActionStatusStarted,
	}
	svc.chatSurfaceMu.Lock()
	anchor := svc.chatAnchors[anchorID]
	anchor.CommittedTranscript = transcript
	anchor.CompletedTurnSnapshots = terminal
	anchor.ActiveTurnSnapshot = active
	anchor.ActiveTurnID = activeTurnID
	svc.chatSurfaceMu.Unlock()

	snapshotDecision := openDecision
	snapshotDecision.Operation = accountservice.LocalAppOperationConversationSnapshot
	response, err := svc.GetLocalAppConversationSnapshot(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), snapshotDecision),
		&runtimev1.GetLocalAppConversationSnapshotRequest{AgentHandle: handle, ConversationAnchorId: anchorID},
	)
	if err != nil {
		t.Fatal(err)
	}
	snapshot := response.GetSnapshot()
	if snapshot.GetTruncatedBefore() || len(snapshot.GetMessages()) != 202 {
		t.Fatalf("terminal history at the exact bound plus active closure = %+v", snapshot)
	}
	if len(snapshot.GetTurns()) != 101 || snapshot.GetTurns()[100].GetTurnId() != activeTurnID ||
		snapshot.GetTurns()[100].GetStatus() != runtimev1.LocalAppConversationTurnStatus_LOCAL_APP_CONVERSATION_TURN_STATUS_ACTIVE {
		t.Fatalf("active turn closure missing: %+v", snapshot.GetTurns())
	}
	if len(snapshot.GetActions()) != 1 || snapshot.GetActions()[0].GetActionId() != "action-active" ||
		snapshot.GetActions()[0].GetStatus() != runtimev1.LocalAppConversationActionStatus_LOCAL_APP_CONVERSATION_ACTION_STATUS_STARTED {
		t.Fatalf("active action closure missing: %+v", snapshot.GetActions())
	}
}

func TestLocalAppConversationFeatureMismatchProjectsUserOnlyLiveAndSnapshot(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	openDecision := localAppConversationDecision(accountservice.LocalAppOperationOpenConversation, 0x46, "user-1")
	handle := mintLocalAppAgentHandle(openDecision, testRuntimeAgentLocalRef("agent-alpha"))
	opened, err := svc.OpenLocalAppConversation(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), openDecision),
		&runtimev1.OpenLocalAppConversationRequest{AgentHandle: handle},
	)
	if err != nil {
		t.Fatal(err)
	}
	anchorID := opened.GetConversationAnchorId()
	turnID := "turn-feature-mismatch"
	svc.chatSurfaceMu.Lock()
	anchor := svc.chatAnchors[anchorID]
	anchor.CommittedTranscript = []publicChatCommittedTranscriptTurn{{
		TurnID: turnID, Sequence: 0, Origin: publicChatTurnOriginUser, InputText: "look",
		InputAttachment: &publicChatCommittedTranscriptAttachment{ArtifactID: "artifact-feature-mismatch", MimeType: "image/png", DisplayName: "photo.png"},
	}}
	anchor.CompletedTurnSnapshots = map[string]*publicChatTurnProjectionState{
		turnID: {TurnID: turnID, Status: publicChatTurnStatusFailed, ReasonCode: runtimev1.ReasonCode_AI_MODALITY_NOT_SUPPORTED, Message: publicChatTurnAttachmentVisionUnsupportedMessage},
	}
	svc.chatSurfaceMu.Unlock()

	events, supported, err := svc.projectLocalAppConversationEvents(publicChatTurnMessageCommittedType, map[string]any{
		"conversation_anchor_id": anchorID,
		"turn_id":                turnID,
		"detail":                 map[string]any{},
		"timeline":               map[string]any{},
	}, 7)
	if err != nil || !supported || len(events) != 1 || events[0].GetMessageCommitted().GetMessage().GetRole() != runtimev1.LocalAppConversationMessageRole_LOCAL_APP_CONVERSATION_MESSAGE_ROLE_USER {
		t.Fatalf("feature mismatch live projection = %+v supported=%v err=%v", events, supported, err)
	}

	snapshotDecision := openDecision
	snapshotDecision.Operation = accountservice.LocalAppOperationConversationSnapshot
	response, err := svc.GetLocalAppConversationSnapshot(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), snapshotDecision),
		&runtimev1.GetLocalAppConversationSnapshotRequest{AgentHandle: handle, ConversationAnchorId: anchorID},
	)
	if err != nil {
		t.Fatal(err)
	}
	snapshot := response.GetSnapshot()
	if len(snapshot.GetMessages()) != 1 || snapshot.GetMessages()[0].GetMessageId() != events[0].GetMessageCommitted().GetMessage().GetMessageId() {
		t.Fatalf("feature mismatch live/snapshot identity diverged: live=%+v snapshot=%+v", events, snapshot)
	}
	if len(snapshot.GetTurns()) != 1 || snapshot.GetTurns()[0].GetStatus() != runtimev1.LocalAppConversationTurnStatus_LOCAL_APP_CONVERSATION_TURN_STATUS_FAILED {
		t.Fatalf("feature mismatch failed turn missing from snapshot: %+v", snapshot.GetTurns())
	}
}

func TestLocalAppConversationSnapshotIncludesTerminalTurnWithoutMessages(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	openDecision := localAppConversationDecision(accountservice.LocalAppOperationOpenConversation, 0x48, "user-1")
	handle := mintLocalAppAgentHandle(openDecision, testRuntimeAgentLocalRef("agent-alpha"))
	opened, err := svc.OpenLocalAppConversation(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), openDecision),
		&runtimev1.OpenLocalAppConversationRequest{AgentHandle: handle},
	)
	if err != nil {
		t.Fatal(err)
	}
	anchorID := opened.GetConversationAnchorId()
	turnID := "turn-failed-before-commit"
	svc.chatSurfaceMu.Lock()
	svc.chatAnchors[anchorID].CompletedTurnSnapshots = map[string]*publicChatTurnProjectionState{
		turnID: {
			TurnID: turnID, Status: publicChatTurnStatusFailed,
			ReasonCode: runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
			Message:    "provider unavailable before commit", UpdatedAt: time.Now().UTC(),
		},
	}
	svc.chatSurfaceMu.Unlock()
	snapshotDecision := openDecision
	snapshotDecision.Operation = accountservice.LocalAppOperationConversationSnapshot
	response, err := svc.GetLocalAppConversationSnapshot(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), snapshotDecision),
		&runtimev1.GetLocalAppConversationSnapshotRequest{AgentHandle: handle, ConversationAnchorId: anchorID},
	)
	if err != nil {
		t.Fatal(err)
	}
	snapshot := response.GetSnapshot()
	if len(snapshot.GetMessages()) != 0 || len(snapshot.GetTurns()) != 1 {
		t.Fatalf("terminal-only snapshot closure = %+v", snapshot)
	}
	turn := snapshot.GetTurns()[0]
	if turn.GetTurnId() != turnID || turn.GetStatus() != runtimev1.LocalAppConversationTurnStatus_LOCAL_APP_CONVERSATION_TURN_STATUS_FAILED ||
		turn.GetReasonCode() != runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE {
		t.Fatalf("terminal-only turn = %+v", turn)
	}
}

func TestLocalAppConversationSnapshotOrdersTerminalOnlyTurnBeforeLaterCommittedTurn(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	openDecision := localAppConversationDecision(accountservice.LocalAppOperationOpenConversation, 0x49, "user-1")
	handle := mintLocalAppAgentHandle(openDecision, testRuntimeAgentLocalRef("agent-alpha"))
	opened, err := svc.OpenLocalAppConversation(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), openDecision),
		&runtimev1.OpenLocalAppConversationRequest{AgentHandle: handle},
	)
	if err != nil {
		t.Fatal(err)
	}
	anchorID := opened.GetConversationAnchorId()
	failedTurnID := "turn-failed-before-later-commit"
	completedTurnID := "turn-completed-after-failure"
	startedAt := time.Now().UTC()
	svc.chatSurfaceMu.Lock()
	anchor := svc.chatAnchors[anchorID]
	anchor.CommittedTranscript = []publicChatCommittedTranscriptTurn{{
		TurnID: completedTurnID, Sequence: 0, Origin: publicChatTurnOriginUser,
		InputText: "later", AssistantText: "completed",
	}}
	anchor.CompletedTurnSnapshots = map[string]*publicChatTurnProjectionState{
		failedTurnID: {
			TurnID: failedTurnID, Status: publicChatTurnStatusFailed,
			ReasonCode:        runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
			TimelineStartedAt: startedAt,
		},
		completedTurnID: {
			TurnID: completedTurnID, Status: publicChatTurnStatusCompleted,
			TimelineStartedAt: startedAt.Add(time.Second),
		},
	}
	svc.chatSurfaceMu.Unlock()

	snapshotDecision := openDecision
	snapshotDecision.Operation = accountservice.LocalAppOperationConversationSnapshot
	response, err := svc.GetLocalAppConversationSnapshot(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), snapshotDecision),
		&runtimev1.GetLocalAppConversationSnapshotRequest{AgentHandle: handle, ConversationAnchorId: anchorID},
	)
	if err != nil {
		t.Fatal(err)
	}
	turns := response.GetSnapshot().GetTurns()
	if len(turns) != 2 || turns[0].GetTurnId() != failedTurnID || turns[1].GetTurnId() != completedTurnID ||
		turns[1].GetStatus() != runtimev1.LocalAppConversationTurnStatus_LOCAL_APP_CONVERSATION_TURN_STATUS_COMPLETED {
		t.Fatalf("snapshot turn order = %+v", turns)
	}
}

func TestLocalAppConversationAttachmentCandidateAdoptsIntoCrossAppReadableMembership(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	openDecision := localAppConversationDecision(accountservice.LocalAppOperationOpenConversation, 0x45, "user-1")
	handle := mintLocalAppAgentHandle(openDecision, testRuntimeAgentLocalRef("agent-alpha"))
	opened, err := svc.OpenLocalAppConversation(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), openDecision),
		&runtimev1.OpenLocalAppConversationRequest{AgentHandle: handle},
	)
	if err != nil {
		t.Fatal(err)
	}
	anchorID := opened.GetConversationAnchorId()

	uploadDecision := openDecision
	uploadDecision.Operation = accountservice.LocalAppOperationConversationAttachmentUpload
	displayName := "photo.png"
	uploaded, err := svc.UploadLocalAppConversationAttachment(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), uploadDecision),
		&runtimev1.UploadLocalAppConversationAttachmentRequest{
			AgentHandle: handle, ConversationAnchorId: anchorID,
			MimeType: "image/png", DisplayName: &displayName, Data: localAppConversationTestPNG(t),
		},
	)
	if err != nil {
		t.Fatalf("UploadLocalAppConversationAttachment: %v", err)
	}
	expiresAt, err := time.Parse(time.RFC3339Nano, uploaded.GetExpiresAt())
	if err != nil || time.Until(expiresAt) < 59*time.Minute || time.Until(expiresAt) > time.Hour {
		t.Fatalf("upload expiry = %q err=%v", uploaded.GetExpiresAt(), err)
	}

	readDecision := openDecision
	readDecision.Operation = accountservice.LocalAppOperationConversationArtifactRead
	_, err = svc.ReadLocalAppConversationArtifact(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), readDecision),
		&runtimev1.ReadLocalAppConversationArtifactRequest{
			AgentHandle: handle, ConversationAnchorId: anchorID, ArtifactId: uploaded.GetArtifactId(),
		},
	)
	if status.Code(err) != codes.PermissionDenied {
		t.Fatalf("uncommitted candidate read error = %v", err)
	}

	attachment := &publicChatCommittedTranscriptAttachment{
		ArtifactID: uploaded.GetArtifactId(), MimeType: "image/png", DisplayName: "photo.png",
	}
	if err := svc.commitPublicChatTranscriptTurn(
		context.Background(), anchorID, "turn-image-1", publicChatTurnOriginUser,
		"show this", attachment, "I received the image.", nil,
	); err != nil {
		t.Fatalf("commit attachment membership: %v", err)
	}

	crossAppDecision := readDecision
	crossAppDecision.AppID = "nimi.other.fixture"
	crossAppDecision.RegisteredAppSubject = "other-registered-app-subject"
	crossAppHandle := mintLocalAppAgentHandle(crossAppDecision, testRuntimeAgentLocalRef("agent-alpha"))
	read, err := svc.ReadLocalAppConversationArtifact(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), crossAppDecision),
		&runtimev1.ReadLocalAppConversationArtifactRequest{
			AgentHandle: crossAppHandle, ConversationAnchorId: anchorID, ArtifactId: uploaded.GetArtifactId(),
		},
	)
	if err != nil || read.GetArtifactId() != uploaded.GetArtifactId() || read.GetMimeType() != "image/png" ||
		read.GetByteLength() != int64(len(read.GetData())) || len(read.GetData()) == 0 {
		t.Fatalf("cross-App committed read = %+v err=%v", read, err)
	}
	firstPartyRead, err := svc.ReadConversationArtifact(
		authenticatedRuntimeAgentTestContext(context.Background(), "user-1"),
		&runtimev1.ReadConversationArtifactRequest{
			Context: &runtimev1.AgentRequestContext{
				AppId:            "nimi.desktop",
				LocalAgentRef:    testRuntimeAgentLocalRef("agent-alpha"),
				OwnerUserId:      "user-1",
				RuntimeSourceRef: testRuntimeAgentSourceRef("agent-alpha"),
			},
			AgentId:              testRuntimeAgentLocalRef("agent-alpha"),
			ConversationAnchorId: anchorID,
			ArtifactId:           uploaded.GetArtifactId(),
		},
	)
	if err != nil || firstPartyRead.GetArtifactId() != uploaded.GetArtifactId() || firstPartyRead.GetMimeType() != "image/png" ||
		firstPartyRead.GetByteLength() != int64(len(firstPartyRead.GetData())) || len(firstPartyRead.GetData()) == 0 {
		t.Fatalf("first-party committed read = %+v err=%v", firstPartyRead, err)
	}

	sendDecision := openDecision
	sendDecision.Operation = accountservice.LocalAppOperationSendConversationTurn
	resolved, _, err := svc.resolveLocalAppAgent(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), sendDecision),
		accountservice.LocalAppOperationSendConversationTurn,
		handle,
	)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.resolveLocalAppConversationAttachmentCandidate(resolved, anchorID, uploaded.GetArtifactId()); status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("adopted candidate reuse error = %v", err)
	}

	snapshotDecision := openDecision
	snapshotDecision.Operation = accountservice.LocalAppOperationConversationSnapshot
	snapshot, err := svc.GetLocalAppConversationSnapshot(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), snapshotDecision),
		&runtimev1.GetLocalAppConversationSnapshotRequest{AgentHandle: handle, ConversationAnchorId: anchorID},
	)
	if err != nil || len(snapshot.GetSnapshot().GetMessages()) != 2 {
		t.Fatalf("attachment snapshot = %+v err=%v", snapshot, err)
	}
	user := snapshot.GetSnapshot().GetMessages()[0]
	if len(user.GetParts()) != 2 || user.GetParts()[1].GetArtifact().GetArtifactId() != uploaded.GetArtifactId() ||
		user.GetParts()[1].GetArtifact().GetDisplayName() != "photo.png" {
		t.Fatalf("committed user attachment message = %+v", user)
	}
}

func TestLocalAppConversationVoiceTranscriptionReturnsTextOnly(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	openDecision := localAppConversationDecision(accountservice.LocalAppOperationOpenConversation, 0x47, "user-1")
	handle := mintLocalAppAgentHandle(openDecision, testRuntimeAgentLocalRef("agent-alpha"))
	opened, err := svc.OpenLocalAppConversation(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), openDecision),
		&runtimev1.OpenLocalAppConversationRequest{AgentHandle: handle},
	)
	if err != nil {
		t.Fatal(err)
	}
	configureLocalAgentVoiceTranscriptionBinding(t, svc)
	executor := &captureAgentVoiceTranscriptionExecutor{}
	svc.SetAgentVoiceTranscriptionScenarioExecutor(executor)
	decision := openDecision
	decision.Operation = accountservice.LocalAppOperationConversationVoiceTranscribe
	response, err := svc.TranscribeLocalAppConversationVoice(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision),
		&runtimev1.TranscribeLocalAppConversationVoiceRequest{
			AgentHandle: handle, ConversationAnchorId: opened.GetConversationAnchorId(),
			RequestId: "voice-input-local-app-1", MimeType: "audio/webm;codecs=opus",
			AudioBytes: []byte{1, 2, 3, 4},
		},
	)
	if err != nil || response.GetText() != "transcribed intent" {
		t.Fatalf("TranscribeLocalAppConversationVoice: response=%+v err=%v", response, err)
	}
	if response.ProtoReflect().Descriptor().Fields().Len() != 1 {
		t.Fatalf("protected transcription response exposed execution identity: %+v", response)
	}
	firstSubmit := proto.Clone(executor.submit).(*runtimev1.SubmitScenarioJobRequest)
	otherDecision := decision
	otherDecision.AppID = "nimi.other.fixture"
	otherDecision.RegisteredAppSubject = "other-registered-app-subject"
	otherHandle := mintLocalAppAgentHandle(otherDecision, testRuntimeAgentLocalRef("agent-alpha"))
	otherExecutor := &captureAgentVoiceTranscriptionExecutor{}
	svc.SetAgentVoiceTranscriptionScenarioExecutor(otherExecutor)
	_, err = svc.TranscribeLocalAppConversationVoice(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), otherDecision),
		&runtimev1.TranscribeLocalAppConversationVoiceRequest{
			AgentHandle: otherHandle, ConversationAnchorId: opened.GetConversationAnchorId(),
			RequestId: "voice-input-local-app-1", MimeType: "audio/webm;codecs=opus",
			AudioBytes: []byte{1, 2, 3, 4},
		},
	)
	if err != nil {
		t.Fatalf("cross-App protected transcription: %v", err)
	}
	if firstSubmit.GetRequestId() == otherExecutor.submit.GetRequestId() ||
		firstSubmit.GetIdempotencyKey() == otherExecutor.submit.GetIdempotencyKey() {
		t.Fatalf("protected transcription request identity joined across Apps: first=%+v other=%+v", firstSubmit, otherExecutor.submit)
	}
	if firstSubmit.GetRequestId() == "voice-input-local-app-1" || otherExecutor.submit.GetRequestId() == "voice-input-local-app-1" {
		t.Fatalf("caller-local request id escaped into private Scenario identity: first=%q other=%q", firstSubmit.GetRequestId(), otherExecutor.submit.GetRequestId())
	}
}

func TestLocalAppConversationVoiceRenderUsesHandleAndCommittedMessageOnly(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	upsertPublicChatTestAgentAIConfig(t, svc, publicChatTestAudioSynthesizeBinding())
	metadata := publicChatVoicePolicyMetadata(t, false)
	anchorID := openPublicChatTestAnchorWithMetadata(t, svc, "agent-alpha", "desktop.app", "user-1", metadata)
	setPublicChatTestPresentationProfile(t, svc, "agent-alpha", "desktop.app", "user-1", false)

	const (
		turnID     = "turn-local-app-manual-voice"
		artifactID = "artifact-local-app-manual-voice"
	)
	messageID := localAppConversationMessageID(turnID, "assistant", "")
	if err := svc.commitPublicChatTranscriptTurn(
		context.Background(), anchorID, turnID, publicChatTurnOriginUser,
		"Please read the answer.", nil, "This answer is canonical Conversation truth.", nil,
	); err != nil {
		t.Fatal(err)
	}
	session, ok := svc.publicChatAnchorSnapshot(anchorID)
	if !ok {
		t.Fatal("conversation anchor missing")
	}
	startedAt := time.Now().Add(-time.Second)
	turn := &publicChatTurnState{
		ConversationAnchorID: anchorID,
		TurnID:               turnID,
		StreamID:             "stream-local-app-manual-voice",
		AgentID:              session.AgentID,
		CallerAppID:          "desktop.app",
		SubjectUserID:        "user-1",
		TimelineStartedAt:    startedAt,
	}
	svc.chatSurfaceMu.Lock()
	svc.chatTurns[turnID] = turn
	projection := &publicChatTurnProjectionState{
		TurnID:            turnID,
		StreamID:          turn.StreamID,
		Status:            publicChatTurnStatusCompleted,
		TimelineStartedAt: startedAt,
		MessageID:         "message-0",
		AssistantText:     "This answer is canonical Conversation truth.",
	}
	anchor := svc.chatAnchors[anchorID]
	anchor.LastTurnSnapshot = clonePublicChatTurnProjectionState(projection)
	anchor.CompletedTurnSnapshots = map[string]*publicChatTurnProjectionState{
		turnID: clonePublicChatTurnProjectionState(projection),
	}
	svc.chatSurfaceMu.Unlock()
	audioBytes := []byte("RIFF\x24\x00\x00\x00WAVEfmt canonical")
	if err := svc.runtimeArtifacts.Put(artifactID, runtimeartifact.ArtifactRecord{
		Bytes: audioBytes, MimeType: "audio/wav", SizeBytes: int64(len(audioBytes)),
	}); err != nil {
		t.Fatal(err)
	}
	svc.SetVoiceLipsyncScenarioExecutor(&fakeVoiceLipsyncScenarioExecutor{
		jobID:         "job-local-app-manual-voice",
		modelResolved: "speech/qwen3tts-ready",
		artifact:      &runtimev1.ScenarioArtifact{ArtifactId: artifactID, MimeType: "audio/wav"},
	}, "", runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED)

	decision := localAppConversationDecision(accountservice.LocalAppOperationConversationVoiceRender, 0x58, "user-1")
	handle := mintLocalAppAgentHandle(decision, testRuntimeAgentLocalRef("agent-alpha"))
	response, err := svc.RenderLocalAppConversationVoice(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision),
		&runtimev1.RenderLocalAppConversationVoiceRequest{
			AgentHandle: handle, ConversationAnchorId: anchorID,
			MessageId: messageID, RequestId: "manual-voice-render-1",
		},
	)
	if err != nil {
		t.Fatalf("RenderLocalAppConversationVoice: %v", err)
	}
	voice := response.GetVoice()
	if voice.GetState() != runtimev1.LocalAppConversationVoiceState_LOCAL_APP_CONVERSATION_VOICE_STATE_READY ||
		voice.GetTurnId() != turnID || voice.GetMessageId() != messageID || voice.GetArtifactId() != artifactID {
		t.Fatalf("canonical voice render response = %+v", response)
	}
	repeated, err := svc.RenderLocalAppConversationVoice(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision),
		&runtimev1.RenderLocalAppConversationVoiceRequest{
			AgentHandle: handle, ConversationAnchorId: anchorID,
			MessageId: messageID, RequestId: "manual-voice-render-1",
		},
	)
	if err != nil || !proto.Equal(response, repeated) {
		t.Fatalf("idempotent canonical voice render = %+v err=%v", repeated, err)
	}
	_, err = svc.RenderLocalAppConversationVoice(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision),
		&runtimev1.RenderLocalAppConversationVoiceRequest{
			AgentHandle: handle, ConversationAnchorId: anchorID,
			MessageId: "message-0", RequestId: "manual-voice-render-private-id",
		},
	)
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_LOCAL_APP_RECORD_NOT_FOUND {
		t.Fatalf("private message identity must fail with canonical reason: reason=%v ok=%v err=%v", reason, ok, err)
	}

	readDecision := decision
	readDecision.Operation = accountservice.LocalAppOperationConversationArtifactRead
	read, err := svc.ReadLocalAppConversationArtifact(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), readDecision),
		&runtimev1.ReadLocalAppConversationArtifactRequest{
			AgentHandle: handle, ConversationAnchorId: anchorID, ArtifactId: artifactID,
		},
	)
	if err != nil || read.GetMimeType() != "audio/wav" || !bytes.Equal(read.GetData(), audioBytes) {
		t.Fatalf("canonical rendered voice artifact read = %+v err=%v", read, err)
	}
}

func TestLocalAppConversationVoiceRenderReturnsTypedUnavailableWithoutVoicePolicy(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	upsertPublicChatTestAgentAIConfig(t, svc, publicChatTestAudioSynthesizeBinding())
	metadata := publicChatVoicePolicyMetadata(t, false)
	anchorID := openPublicChatTestAnchorWithMetadata(t, svc, "agent-alpha", "desktop.app", "user-1", metadata)

	const turnID = "turn-local-app-voice-policy-unconfigured"
	messageID := localAppConversationMessageID(turnID, "assistant", "")
	if err := svc.commitPublicChatTranscriptTurn(
		context.Background(), anchorID, turnID, publicChatTurnOriginUser,
		"Read this without a configured voice.", nil, "The canonical message remains readable.", nil,
	); err != nil {
		t.Fatal(err)
	}
	startedAt := time.Now().Add(-time.Second)
	svc.chatSurfaceMu.Lock()
	anchor := svc.chatAnchors[anchorID]
	projection := &publicChatTurnProjectionState{
		TurnID: turnID, StreamID: "stream-local-app-voice-policy-unconfigured",
		Status: publicChatTurnStatusCompleted, TimelineStartedAt: startedAt,
		MessageID: "message-0", AssistantText: "The canonical message remains readable.",
	}
	anchor.LastTurnSnapshot = clonePublicChatTurnProjectionState(projection)
	anchor.CompletedTurnSnapshots = map[string]*publicChatTurnProjectionState{
		turnID: clonePublicChatTurnProjectionState(projection),
	}
	svc.chatSurfaceMu.Unlock()
	svc.SetVoiceLipsyncScenarioExecutor(
		&fakeVoiceLipsyncScenarioExecutor{},
		"",
		runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED,
	)

	decision := localAppConversationDecision(accountservice.LocalAppOperationConversationVoiceRender, 0x59, "user-1")
	handle := mintLocalAppAgentHandle(decision, testRuntimeAgentLocalRef("agent-alpha"))
	response, err := svc.RenderLocalAppConversationVoice(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision),
		&runtimev1.RenderLocalAppConversationVoiceRequest{
			AgentHandle: handle, ConversationAnchorId: anchorID,
			MessageId: messageID, RequestId: "manual-voice-policy-unconfigured",
		},
	)
	if err != nil {
		t.Fatalf("RenderLocalAppConversationVoice: %v", err)
	}
	voice := response.GetVoice()
	if voice.GetState() != runtimev1.LocalAppConversationVoiceState_LOCAL_APP_CONVERSATION_VOICE_STATE_FAILED ||
		voice.GetMessageId() != messageID ||
		voice.GetReasonCode() != runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED ||
		voice.GetMessage() != "VOICE_POLICY_UNCONFIGURED" {
		t.Fatalf("typed unconfigured voice result = %+v", voice)
	}
}

func TestLocalAppConversationFinalVoiceSidecarsAreDurableReadableAndTerminal(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	openDecision := localAppConversationDecision(accountservice.LocalAppOperationOpenConversation, 0x49, "user-1")
	handle := mintLocalAppAgentHandle(openDecision, testRuntimeAgentLocalRef("agent-alpha"))
	opened, err := svc.OpenLocalAppConversation(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), openDecision),
		&runtimev1.OpenLocalAppConversationRequest{AgentHandle: handle},
	)
	if err != nil {
		t.Fatal(err)
	}
	anchorID := opened.GetConversationAnchorId()
	for _, turnID := range []string{"turn-voice-ready", "turn-voice-failed", "turn-voice-interrupted"} {
		if err := svc.commitPublicChatTranscriptTurn(
			context.Background(), anchorID, turnID, publicChatTurnOriginUser,
			"voice input "+turnID, nil, "voice answer "+turnID, nil,
		); err != nil {
			t.Fatal(err)
		}
		svc.chatSurfaceMu.Lock()
		svc.chatTurns[turnID] = &publicChatTurnState{
			ConversationAnchorID: anchorID, TurnID: turnID, SubjectUserID: "user-1",
		}
		svc.chatSurfaceMu.Unlock()
	}
	session, ok := svc.publicChatAnchorSnapshot(anchorID)
	if !ok {
		t.Fatal("conversation anchor missing")
	}
	readyTurn := *svc.chatTurns["turn-voice-ready"]
	ownerMessageID := "internal-assistant-message-ready"
	if err := svc.runtimeArtifacts.Put("artifact-voice-ready", runtimeartifact.ArtifactRecord{
		Bytes: []byte{1, 2, 3, 4}, MimeType: "audio/wav",
		GeneratedVoice: &runtimeartifact.GeneratedVoiceArtifactMetadata{
			AgentID: session.AgentID, ConversationAnchorID: anchorID,
			TurnID: readyTurn.TurnID, MessageID: ownerMessageID,
		},
	}); err != nil {
		t.Fatal(err)
	}
	if err := svc.commitLocalAppConversationVoiceReady(session, readyTurn, ownerMessageID, "artifact-voice-ready"); err != nil {
		t.Fatalf("commit ready voice: %v", err)
	}
	failedTurn := *svc.chatTurns["turn-voice-failed"]
	if err := svc.commitLocalAppConversationVoiceFailed(session, failedTurn, "VOICE_SYNTHESIS_UNAVAILABLE"); err != nil {
		t.Fatalf("commit failed voice: %v", err)
	}
	svc.chatSurfaceMu.Lock()
	svc.chatTurns["turn-voice-interrupted"].Interrupted = true
	interruptedTurn := *svc.chatTurns["turn-voice-interrupted"]
	svc.chatSurfaceMu.Unlock()
	if err := svc.commitLocalAppConversationVoiceFailed(session, interruptedTurn, "VOICE_SYNTHESIS_FAILED"); status.Code(err) != codes.Canceled {
		t.Fatalf("interrupted unpublished voice error = %v", err)
	}

	snapshotDecision := openDecision
	snapshotDecision.Operation = accountservice.LocalAppOperationConversationSnapshot
	snapshot, err := svc.GetLocalAppConversationSnapshot(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), snapshotDecision),
		&runtimev1.GetLocalAppConversationSnapshotRequest{AgentHandle: handle, ConversationAnchorId: anchorID},
	)
	if err != nil || len(snapshot.GetSnapshot().GetVoices()) != 2 {
		t.Fatalf("voice snapshot = %+v err=%v", snapshot, err)
	}
	voices := snapshot.GetSnapshot().GetVoices()
	if voices[0].GetState() != runtimev1.LocalAppConversationVoiceState_LOCAL_APP_CONVERSATION_VOICE_STATE_READY ||
		voices[0].GetArtifactId() != "artifact-voice-ready" ||
		voices[1].GetState() != runtimev1.LocalAppConversationVoiceState_LOCAL_APP_CONVERSATION_VOICE_STATE_FAILED ||
		voices[1].GetArtifactId() != "" {
		t.Fatalf("voice terminal shapes = %+v", voices)
	}

	readDecision := openDecision
	readDecision.Operation = accountservice.LocalAppOperationConversationArtifactRead
	read, err := svc.ReadLocalAppConversationArtifact(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), readDecision),
		&runtimev1.ReadLocalAppConversationArtifactRequest{
			AgentHandle: handle, ConversationAnchorId: anchorID, ArtifactId: "artifact-voice-ready",
		},
	)
	if err != nil || read.GetMimeType() != "audio/wav" || read.GetByteLength() != 4 {
		t.Fatalf("ready voice artifact read = %+v err=%v", read, err)
	}
}

func localAppConversationTestPNG(t *testing.T) []byte {
	t.Helper()
	var payload bytes.Buffer
	imageValue := image.NewRGBA(image.Rect(0, 0, 1, 1))
	imageValue.Set(0, 0, color.RGBA{R: 42, G: 84, B: 126, A: 255})
	if err := png.Encode(&payload, imageValue); err != nil {
		t.Fatal(err)
	}
	return payload.Bytes()
}

func TestLocalAppConversationEventProjectionIsClosedTypedUnion(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	base := map[string]any{
		"conversation_anchor_id": "agent_anchor_01J",
		"turn_id":                "agent_turn_01J",
		"timeline":               map[string]any{"sequence": int64(3)},
	}
	tests := []struct {
		name        string
		messageType string
		detail      map[string]any
		assert      func(*testing.T, *runtimev1.LocalAppConversationEvent)
	}{
		{
			name: "accepted", messageType: publicChatTurnAcceptedType,
			detail: map[string]any{"request_id": "request-1"},
			assert: func(t *testing.T, event *runtimev1.LocalAppConversationEvent) {
				if event.GetTurnAccepted().GetTurnId() != "agent_turn_01J" {
					t.Fatalf("accepted = %+v", event)
				}
			},
		},
		{
			name: "failed", messageType: publicChatTurnFailedType,
			detail: map[string]any{"reason_code": "AI_OUTPUT_INVALID", "message": "invalid output"},
			assert: func(t *testing.T, event *runtimev1.LocalAppConversationEvent) {
				if event.GetTurnFailed().GetReasonCode() != "AI_OUTPUT_INVALID" {
					t.Fatalf("failed = %+v", event)
				}
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			payload := map[string]any{}
			for key, value := range base {
				payload[key] = value
			}
			payload["detail"] = test.detail
			events, supported, err := svc.projectLocalAppConversationEvents(test.messageType, payload, 3)
			if err != nil || !supported || len(events) != 1 || events[0].GetSequence() != 3 {
				t.Fatalf("projection events=%+v supported=%v err=%v", events, supported, err)
			}
			test.assert(t, events[0])
		})
	}
	if events, supported, err := svc.projectLocalAppConversationEvents(publicChatTurnReasoningDeltaType, base, 4); err != nil || supported || events != nil {
		t.Fatalf("reasoning event escaped union: events=%+v supported=%v err=%v", events, supported, err)
	}
	malformed := map[string]any{}
	for key, value := range base {
		malformed[key] = value
	}
	malformed["detail"] = map[string]any{"payload": map[string]any{"private": true}}
	if _, supported, err := svc.projectLocalAppConversationEvents(publicChatTurnActionPlannedType, malformed, 5); !supported || err == nil {
		t.Fatalf("generic payload was not rejected: supported=%v err=%v", supported, err)
	}
}

func TestLocalAppConversationStreamDeliversTypedEventAndClosesOnCancel(t *testing.T) {
	svc, req, decision, anchorID := localAppConversationStreamFixture(t)
	svc.SetLocalAppIngressRevalidator(localAppIngressRevalidatorFunc(func(ctx context.Context, ingress localappop.Ingress) (context.Context, error) {
		if ingress != localappop.IngressConversationEventsSubscribe {
			return nil, status.Error(codes.PermissionDenied, "wrong ingress")
		}
		return accountservice.ContextWithAuthorizedLocalAppDecision(ctx, decision), nil
	}))
	stream := newLocalAppConversationCaptureStream(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision),
		1,
	)
	done := make(chan error, 1)
	go func() { done <- svc.SubscribeLocalAppConversationEvents(req, stream) }()
	waitForLocalAppConversationSubscriber(t, svc)
	svc.publishLocalAppConversationEvent("user-1", publicChatTurnStartedType, map[string]any{
		"conversation_anchor_id": anchorID,
		"turn_id":                "agent_turn_01J",
		"timeline":               map[string]any{"sequence": int64(1)},
		"detail":                 map[string]any{},
	})
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("stream returned %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("stream did not close after consumer cancellation")
	}
	if len(stream.events) != 1 || stream.events[0].GetTurnStarted().GetTurnId() != "agent_turn_01J" {
		t.Fatalf("stream events = %+v", stream.events)
	}
}

func TestLocalAppConversationStreamPreservesWhitespaceDeltaFragments(t *testing.T) {
	svc, req, decision, anchorID := localAppConversationStreamFixture(t)
	svc.SetLocalAppIngressRevalidator(localAppIngressRevalidatorFunc(func(ctx context.Context, _ localappop.Ingress) (context.Context, error) {
		return accountservice.ContextWithAuthorizedLocalAppDecision(ctx, decision), nil
	}))
	fragments := []string{"DeepSeek", " burst", "\n", " "}
	stream := newLocalAppConversationCaptureStream(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision),
		len(fragments),
	)
	done := make(chan error, 1)
	go func() { done <- svc.SubscribeLocalAppConversationEvents(req, stream) }()
	waitForLocalAppConversationSubscriber(t, svc)
	for index, fragment := range fragments {
		if err := svc.publishLocalAppConversationEvent("user-1", publicChatTurnTextDeltaType, map[string]any{
			"conversation_anchor_id": anchorID,
			"turn_id":                "agent_turn_whitespace_delta",
			"timeline":               map[string]any{"sequence": int64(index + 1)},
			"detail":                 map[string]any{"text": fragment},
		}); err != nil {
			t.Fatalf("publish whitespace delta %q: %v", fragment, err)
		}
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("whitespace delta stream: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("whitespace delta stream did not complete")
	}
	var combined strings.Builder
	for _, event := range stream.events {
		combined.WriteString(event.GetTextDelta().GetDelta())
	}
	if combined.String() != strings.Join(fragments, "") {
		t.Fatalf("whitespace delta stream changed fragments: got=%q want=%q", combined.String(), strings.Join(fragments, ""))
	}
}

func TestLocalAppConversationSequencePersistenceFailsBeforePublication(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	_, events := svc.addLocalAppConversationSubscriber(localAppConversationSubscriber{
		accountID: "user-1", conversationAnchorID: anchorID,
	})
	svc.chatStateRepo = nil
	err := svc.publishLocalAppConversationEvent("user-1", publicChatTurnStartedType, map[string]any{
		"conversation_anchor_id": anchorID,
		"turn_id":                "agent_turn_01J",
		"timeline":               map[string]any{"sequence": int64(1)},
		"detail":                 map[string]any{},
	})
	if err == nil {
		t.Fatal("Conversation event published without durable sequence high-water")
	}
	select {
	case emission := <-events:
		t.Fatalf("unpersisted Conversation event became observable: %+v", emission)
	default:
	}
}

func TestLocalAppConversationStreamSendsHeaderOnEstablishmentBeforeEvents(t *testing.T) {
	svc, req, decision, anchorID := localAppConversationStreamFixture(t)
	svc.SetLocalAppIngressRevalidator(localAppIngressRevalidatorFunc(func(ctx context.Context, _ localappop.Ingress) (context.Context, error) {
		return accountservice.ContextWithAuthorizedLocalAppDecision(ctx, decision), nil
	}))
	stream := newLocalAppConversationCaptureStream(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision),
		1,
	)
	done := make(chan error, 1)
	go func() { done <- svc.SubscribeLocalAppConversationEvents(req, stream) }()
	waitForLocalAppConversationSubscriber(t, svc)
	headerDeadline := time.Now().Add(2 * time.Second)
	for !stream.headerObserved() {
		if time.Now().After(headerDeadline) {
			t.Fatal("subscription established without sending response headers; an idle conversation would block the streaming client indefinitely")
		}
		time.Sleep(5 * time.Millisecond)
	}
	svc.publishLocalAppConversationEvent("user-1", publicChatTurnStartedType, map[string]any{
		"conversation_anchor_id": anchorID,
		"turn_id":                "agent_turn_01J",
		"timeline":               map[string]any{"sequence": int64(1)},
		"detail":                 map[string]any{},
	})
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("stream returned %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("stream did not close after consumer cancellation")
	}
	if stream.eventBeforeHeader {
		t.Fatal("an event was sent before response headers")
	}
}

func TestDesktopConversationStreamRevalidatesFormalBuiltInAppSession(t *testing.T) {
	svc, req, decision, anchorID := localAppConversationStreamFixture(t)
	decision.AppID = "nimi.desktop"
	decision.AccountGeneration = 7
	decision.RealmEnvironmentID = "realm-test"
	invalidated := make(chan struct{})
	principal := protectedprincipal.NewDesktopAccountProduct(
		&runtimev1.AccountProjection{
			AccountId:          decision.AccountID,
			RealmEnvironmentId: decision.RealmEnvironmentID,
		},
		decision.AccountGeneration,
		decision.SessionID,
		invalidated,
	)
	decision.RegisteredAppSubject = "ras_v1_desktop_built_in"
	handle := mintLocalAppAgentHandle(decision, testRuntimeAgentLocalRef("agent-alpha"))
	req.AgentHandle = handle
	revalidatorCalled := false
	svc.SetLocalAppIngressRevalidator(localAppIngressRevalidatorFunc(func(ctx context.Context, ingress localappop.Ingress) (context.Context, error) {
		revalidatorCalled = true
		if ingress != localappop.IngressConversationEventsSubscribe {
			return nil, status.Error(codes.PermissionDenied, "unexpected built-in App ingress")
		}
		return accountservice.ContextWithAuthorizedLocalAppDecision(ctx, decision), nil
	}))
	streamCtx := protectedprincipal.With(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision),
		principal,
	)
	stream := newLocalAppConversationCaptureStream(streamCtx, 1)
	done := make(chan error, 1)
	go func() { done <- svc.SubscribeLocalAppConversationEvents(req, stream) }()
	waitForLocalAppConversationSubscriber(t, svc)
	svc.publishLocalAppConversationEvent("user-1", publicChatTurnStartedType, map[string]any{
		"conversation_anchor_id": anchorID,
		"turn_id":                "agent_turn_01J",
		"timeline":               map[string]any{"sequence": int64(1)},
		"detail":                 map[string]any{},
	})
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("desktop stream returned %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("desktop stream did not deliver the canonical event")
	}
	if !revalidatorCalled {
		t.Fatal("Desktop built-in App stream bypassed the formal local-App session revalidator")
	}
	if len(stream.events) != 1 || stream.events[0].GetTurnStarted().GetTurnId() != "agent_turn_01J" {
		t.Fatalf("desktop stream events = %+v", stream.events)
	}
}

func TestLocalAppConversationStreamAdmissionRejectionSendsNoHeader(t *testing.T) {
	svc, req, decision, _ := localAppConversationStreamFixture(t)
	svc.SetLocalAppIngressRevalidator(localAppIngressRevalidatorFunc(func(ctx context.Context, _ localappop.Ingress) (context.Context, error) {
		return accountservice.ContextWithAuthorizedLocalAppDecision(ctx, decision), nil
	}))
	// A stream context without an authorized local-App decision fails admission
	// before subscriber registration.
	stream := newLocalAppConversationCaptureStream(context.Background(), 0)
	err := runLocalAppConversationStreamWithTimeout(t, svc, req, stream)
	if status.Code(err) != codes.PermissionDenied {
		t.Fatalf("pre-admission rejection error = %v", err)
	}
	if stream.headerObserved() {
		t.Fatal("rejected subscription must not send response headers")
	}
}

func TestLocalAppConversationStreamTerminatesOnAccountAndAgentInvalidation(t *testing.T) {
	t.Run("account change", func(t *testing.T) {
		svc, req, decision, _ := localAppConversationStreamFixture(t)
		changed := decision
		changed.AccountID = "user-2"
		svc.SetLocalAppIngressRevalidator(localAppIngressRevalidatorFunc(func(ctx context.Context, _ localappop.Ingress) (context.Context, error) {
			return accountservice.ContextWithAuthorizedLocalAppDecision(ctx, changed), nil
		}))
		stream := newLocalAppConversationCaptureStream(
			accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision),
			0,
		)
		err := runLocalAppConversationStreamWithTimeout(t, svc, req, stream)
		if status.Code(err) != codes.PermissionDenied {
			t.Fatalf("account invalidation error = %v", err)
		}
	})

	t.Run("inactive Agent", func(t *testing.T) {
		svc, req, decision, _ := localAppConversationStreamFixture(t)
		svc.SetLocalAppIngressRevalidator(localAppIngressRevalidatorFunc(func(ctx context.Context, _ localappop.Ingress) (context.Context, error) {
			return accountservice.ContextWithAuthorizedLocalAppDecision(ctx, decision), nil
		}))
		stream := newLocalAppConversationCaptureStream(
			accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision),
			0,
		)
		done := make(chan error, 1)
		go func() { done <- svc.SubscribeLocalAppConversationEvents(req, stream) }()
		waitForLocalAppConversationSubscriber(t, svc)
		svc.mu.Lock()
		svc.agents[testRuntimeAgentLocalRef("agent-alpha")].Agent.LifecycleStatus = runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_SUSPENDED
		svc.mu.Unlock()
		select {
		case err := <-done:
			if status.Code(err) != codes.PermissionDenied {
				t.Fatalf("inactive Agent stream error = %v", err)
			}
		case <-time.After(2 * time.Second):
			t.Fatal("stream survived inactive Agent")
		}
	})
}

func TestLocalAppConversationStreamSurfacesBoundedOwnerTerminalError(t *testing.T) {
	svc, req, decision, anchorID := localAppConversationStreamFixture(t)
	svc.SetLocalAppIngressRevalidator(localAppIngressRevalidatorFunc(func(ctx context.Context, _ localappop.Ingress) (context.Context, error) {
		return accountservice.ContextWithAuthorizedLocalAppDecision(ctx, decision), nil
	}))
	stream := newLocalAppConversationCaptureStream(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision),
		0,
	)
	done := make(chan error, 1)
	go func() { done <- svc.SubscribeLocalAppConversationEvents(req, stream) }()
	waitForLocalAppConversationSubscriber(t, svc)
	svc.publishLocalAppConversationEvent("user-1", publicChatTurnActionPlannedType, map[string]any{
		"conversation_anchor_id": anchorID,
		"turn_id":                "agent_turn_01J",
		"timeline":               map[string]any{"sequence": int64(1)},
		"detail":                 map[string]any{"payload": "forbidden"},
	})
	select {
	case err := <-done:
		if status.Code(err) != codes.Unavailable {
			t.Fatalf("terminal owner error = %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("malformed owner event did not terminate stream")
	}
}

func localAppConversationStreamFixture(
	t *testing.T,
) (*Service, *runtimev1.SubscribeLocalAppConversationEventsRequest, accountservice.LocalAppCallerDecision, string) {
	t.Helper()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	openDecision := localAppConversationDecision(accountservice.LocalAppOperationOpenConversation, 0x51, "user-1")
	handle := mintLocalAppAgentHandle(openDecision, testRuntimeAgentLocalRef("agent-alpha"))
	opened, err := svc.OpenLocalAppConversation(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), openDecision),
		&runtimev1.OpenLocalAppConversationRequest{AgentHandle: handle},
	)
	if err != nil {
		t.Fatal(err)
	}
	decision := openDecision
	decision.Operation = accountservice.LocalAppOperationSubscribeConversation
	return svc, &runtimev1.SubscribeLocalAppConversationEventsRequest{
		AgentHandle: handle, ConversationAnchorId: opened.GetConversationAnchorId(),
	}, decision, opened.GetConversationAnchorId()
}

func localAppConversationDecision(
	operation accountservice.LocalAppOperation,
	seed byte,
	accountID string,
) accountservice.LocalAppCallerDecision {
	decision := accountservice.LocalAppCallerDecision{
		AppID:                "nimi.thirdparty.fixture",
		AccountID:            accountID,
		Operation:            operation,
		AuthorityClass:       localappop.AuthorityClassAppAccess,
		OperationCapability:  "agent.local",
		RegisteredAppSubject: "registered-app-subject",
	}
	for index := range decision.SessionID {
		decision.SessionID[index] = seed + byte(index)
	}
	return decision
}

type localAppIngressRevalidatorFunc func(context.Context, localappop.Ingress) (context.Context, error)

func (function localAppIngressRevalidatorFunc) AuthorizeLocalAppIngress(
	ctx context.Context,
	ingress localappop.Ingress,
) (context.Context, error) {
	return function(ctx, ingress)
}

type localAppConversationCaptureStream struct {
	ctx               context.Context
	cancel            context.CancelFunc
	max               int
	mu                sync.Mutex
	events            []*runtimev1.LocalAppConversationEvent
	headerSent        bool
	eventBeforeHeader bool
}

func newLocalAppConversationCaptureStream(parent context.Context, max int) *localAppConversationCaptureStream {
	ctx, cancel := context.WithCancel(parent)
	return &localAppConversationCaptureStream{ctx: ctx, cancel: cancel, max: max}
}

func (stream *localAppConversationCaptureStream) SetHeader(metadata.MD) error { return nil }
func (stream *localAppConversationCaptureStream) SendHeader(metadata.MD) error {
	stream.mu.Lock()
	stream.headerSent = true
	stream.mu.Unlock()
	return nil
}

func (stream *localAppConversationCaptureStream) headerObserved() bool {
	stream.mu.Lock()
	defer stream.mu.Unlock()
	return stream.headerSent
}
func (stream *localAppConversationCaptureStream) SetTrailer(metadata.MD)   {}
func (stream *localAppConversationCaptureStream) Context() context.Context { return stream.ctx }
func (stream *localAppConversationCaptureStream) SendMsg(any) error        { return nil }
func (stream *localAppConversationCaptureStream) RecvMsg(any) error        { return nil }
func (stream *localAppConversationCaptureStream) Send(event *runtimev1.LocalAppConversationEvent) error {
	stream.mu.Lock()
	if !stream.headerSent {
		stream.eventBeforeHeader = true
	}
	stream.events = append(stream.events, proto.Clone(event).(*runtimev1.LocalAppConversationEvent))
	shouldCancel := stream.max > 0 && len(stream.events) >= stream.max
	stream.mu.Unlock()
	if shouldCancel {
		stream.cancel()
	}
	return nil
}

func waitForLocalAppConversationSubscriber(t *testing.T, svc *Service) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		svc.localAppConversationMu.Lock()
		count := len(svc.localAppConversationSubscribers)
		svc.localAppConversationMu.Unlock()
		if count > 0 {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("local-app conversation subscriber was not registered")
}

func runLocalAppConversationStreamWithTimeout(
	t *testing.T,
	svc *Service,
	req *runtimev1.SubscribeLocalAppConversationEventsRequest,
	stream *localAppConversationCaptureStream,
) error {
	t.Helper()
	done := make(chan error, 1)
	go func() { done <- svc.SubscribeLocalAppConversationEvents(req, stream) }()
	select {
	case err := <-done:
		return err
	case <-time.After(2 * time.Second):
		stream.cancel()
		t.Fatal("local-app conversation stream did not terminate")
		return nil
	}
}

func protoreflectName(value string) protoreflect.Name {
	return protoreflect.Name(value)
}
