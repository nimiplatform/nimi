package runtimeagent

import (
	"context"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type agentRealtimeExecutorStub struct {
	onInterrupt    func()
	onClose        func()
	onCloseRequest func(*runtimev1.CloseRealtimeSessionRequest)
	onControl      func(*runtimev1.SubmitRealtimeOwnerControlRequest)
	onAppend       func(*runtimev1.AppendRealtimeInputRequest) error
}

func (s agentRealtimeExecutorStub) OpenRuntimeAgentRealtime(context.Context, string, *runtimev1.OpenRealtimeSessionRequest) (*runtimev1.OpenRealtimeSessionResponse, error) {
	return &runtimev1.OpenRealtimeSessionResponse{}, nil
}

func (s agentRealtimeExecutorStub) AppendRuntimeAgentRealtimeInput(_ context.Context, _ string, req *runtimev1.AppendRealtimeInputRequest) (*runtimev1.AppendRealtimeInputResponse, error) {
	if s.onAppend != nil {
		if err := s.onAppend(req); err != nil {
			return nil, err
		}
	}
	return &runtimev1.AppendRealtimeInputResponse{}, nil
}

func (s agentRealtimeExecutorStub) SubmitRuntimeAgentRealtimeControl(_ context.Context, _ string, req *runtimev1.SubmitRealtimeOwnerControlRequest) (*runtimev1.SubmitRealtimeOwnerControlResponse, error) {
	if s.onControl != nil {
		s.onControl(req)
	}
	return &runtimev1.SubmitRealtimeOwnerControlResponse{}, nil
}

func (s agentRealtimeExecutorStub) InterruptRuntimeAgentRealtimeOutput(context.Context, string, *runtimev1.InterruptRealtimeOutputRequest) (*runtimev1.InterruptRealtimeOutputResponse, error) {
	if s.onInterrupt != nil {
		s.onInterrupt()
	}
	return &runtimev1.InterruptRealtimeOutputResponse{}, nil
}

func (s agentRealtimeExecutorStub) CloseRuntimeAgentRealtime(_ context.Context, _ string, req *runtimev1.CloseRealtimeSessionRequest) (*runtimev1.CloseRealtimeSessionResponse, error) {
	if s.onClose != nil {
		s.onClose()
	}
	if s.onCloseRequest != nil {
		s.onCloseRequest(req)
	}
	return &runtimev1.CloseRealtimeSessionResponse{}, nil
}

func (agentRealtimeExecutorStub) ClaimRuntimeAgentRealtimeEvents(context.Context, string, string, uint64) (<-chan *runtimev1.AiRealtimeEvent, func(), error) {
	return nil, func() {}, nil
}

func TestAgentRealtimeOutputInterruptFencesAndReleasesCanonicalTurnBeforeDriver(t *testing.T) {
	svc, session, decision, handle := prepareActiveAgentRealtimeTurnForTest(t, accountservice.LocalAppOperationAgentRealtimeOutputInterrupt)
	observedReleased := false
	svc.SetAgentRealtimeAIExecutor(agentRealtimeExecutorStub{onInterrupt: func() {
		_, active, _, _, err := svc.snapshotPublicChatAnchorForCaller(decision.AppID, session.conversationAnchorID)
		if err != nil {
			t.Fatalf("snapshot during interrupt: %v", err)
		}
		observedReleased = active == nil
	}})

	_, err := svc.InterruptLocalAppAgentRealtimeOutput(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision),
		&runtimev1.InterruptLocalAppAgentRealtimeOutputRequest{
			AgentHandle: handle, RealtimeSessionId: session.realtimeSessionID, Generation: session.generation,
			OutputTrackId: "output-1", InterruptAgentTurn: true,
		},
	)
	if err != nil {
		t.Fatalf("InterruptLocalAppAgentRealtimeOutput: %v", err)
	}
	if !observedReleased {
		t.Fatal("neutral Driver interrupt observed an active canonical Agent turn")
	}
	assertAgentRealtimeTurnReleased(t, svc, session, decision.AppID)
}

func TestAgentRealtimeCloseDoesNotMutateCanonicalTurn(t *testing.T) {
	svc, session, decision, handle := prepareActiveAgentRealtimeTurnForTest(t, accountservice.LocalAppOperationAgentRealtimeClose)
	closeCalled := false
	svc.SetAgentRealtimeAIExecutor(agentRealtimeExecutorStub{onClose: func() {
		closeCalled = true
	}})

	_, err := svc.CloseLocalAppAgentRealtime(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision),
		&runtimev1.CloseLocalAppAgentRealtimeRequest{
			AgentHandle: handle, RealtimeSessionId: session.realtimeSessionID, Generation: session.generation,
		},
	)
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("CloseLocalAppAgentRealtime code=%s err=%v", status.Code(err), err)
	}
	if closeCalled {
		t.Fatal("media Driver close ran before explicit Agent-turn interruption")
	}
	_, active, _, _, snapshotErr := svc.snapshotPublicChatAnchorForCaller(decision.AppID, session.conversationAnchorID)
	if snapshotErr != nil || active == nil {
		t.Fatalf("media close mutated canonical turn: active=%+v err=%v", active, snapshotErr)
	}
}

func TestAgentRealtimeFirstAudioFrameDoesNotCreateCanonicalTurn(t *testing.T) {
	svc, session, decision, handle := prepareAgentRealtimeSessionForTest(t, accountservice.LocalAppOperationAgentRealtimeInputAppend, false)
	appends := 0
	svc.SetAgentRealtimeAIExecutor(agentRealtimeExecutorStub{onAppend: func(*runtimev1.AppendRealtimeInputRequest) error {
		appends++
		return nil
	}})
	_, err := svc.AppendLocalAppAgentRealtimeInput(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision),
		&runtimev1.AppendLocalAppAgentRealtimeInputRequest{
			AgentHandle: handle, RealtimeSessionId: session.realtimeSessionID, Generation: session.generation,
			Input: &runtimev1.AppendLocalAppAgentRealtimeInputRequest_AudioFrame{AudioFrame: &runtimev1.LocalAppAgentRealtimeAudioFrameInput{
				InputTrackId: "input-1", UtteranceId: "utterance-1", FrameSequence: 1, Frame: []byte{0, 0},
			}},
		},
	)
	if err != nil || appends != 1 {
		t.Fatalf("first audio append count=%d err=%v", appends, err)
	}
	_, active, _, _, err := svc.snapshotPublicChatAnchorForCaller(decision.AppID, session.conversationAnchorID)
	if err != nil || active != nil || session.turn != nil {
		t.Fatalf("first audio created canonical turn: snapshot=%+v session=%+v err=%v", active, session.turn, err)
	}
}

func TestAgentRealtimeRejectsOverlappingUtteranceBeforeProviderMutation(t *testing.T) {
	svc, session, decision, handle := prepareActiveAgentRealtimeTurnForTest(t, accountservice.LocalAppOperationAgentRealtimeInputAppend)
	appends := 0
	svc.SetAgentRealtimeAIExecutor(agentRealtimeExecutorStub{onAppend: func(*runtimev1.AppendRealtimeInputRequest) error {
		appends++
		return nil
	}})
	_, err := svc.AppendLocalAppAgentRealtimeInput(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision),
		&runtimev1.AppendLocalAppAgentRealtimeInputRequest{
			AgentHandle: handle, RealtimeSessionId: session.realtimeSessionID, Generation: session.generation,
			Input: &runtimev1.AppendLocalAppAgentRealtimeInputRequest_AudioFrame{AudioFrame: &runtimev1.LocalAppAgentRealtimeAudioFrameInput{
				InputTrackId: "input-2", UtteranceId: "utterance-2", FrameSequence: 1, Frame: []byte{0, 0},
			}},
		},
	)
	if err == nil || appends != 0 {
		t.Fatalf("overlapping utterance reached provider: appends=%d err=%v", appends, err)
	}
}

func TestAgentRealtimePrivateOwnerInputAcceptanceIsNotProjected(t *testing.T) {
	svc, session, _, _ := prepareAgentRealtimeSessionForTest(t, accountservice.LocalAppOperationAgentRealtimeEventsSubscribe, false)
	requestID := "agent_context_private"
	session.registerPrivateInputRequest(requestID)
	projected, err := svc.projectAgentRealtimeEvent(context.Background(), session, agentRealtimeExecutorStub{}, &runtimev1.AiRealtimeEvent{
		Event: &runtimev1.AiRealtimeEvent_InputAccepted{InputAccepted: &runtimev1.AiRealtimeInputAccepted{RequestId: requestID}},
	})
	if err != nil || projected != nil {
		t.Fatalf("private owner input projection=%+v err=%v", projected, err)
	}
}

func TestAgentRealtimeOwnerContextFailureFencesNeutralSession(t *testing.T) {
	svc, session, decision, _ := prepareActiveAgentRealtimeTurnForTest(t, accountservice.LocalAppOperationAgentRealtimeInputAppend)
	appendCount, closeCount := 0, 0
	executor := agentRealtimeExecutorStub{
		onAppend: func(*runtimev1.AppendRealtimeInputRequest) error {
			appendCount++
			if appendCount == 2 {
				return status.Error(codes.Unavailable, "owner context transport failed")
			}
			return nil
		},
		onClose: func() { closeCount++ },
	}
	ownerCtx := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision)
	if err := svc.composeAgentRealtimeTurnContext(ownerCtx, session, "hello", executor); err == nil {
		t.Fatal("partial owner-context failure was accepted")
	}
	if appendCount != 2 || closeCount != 1 || !session.closed {
		t.Fatalf("contaminated session not fenced: appends=%d closes=%d closed=%v", appendCount, closeCount, session.closed)
	}
	_, active, last, _, err := svc.snapshotPublicChatAnchorForCaller(decision.AppID, session.conversationAnchorID)
	if err != nil || active != nil || last == nil || last.Status != publicChatTurnStatusFailed {
		t.Fatalf("owner-context failure did not converge turn: active=%+v last=%+v err=%v", active, last, err)
	}
}

func TestAgentRealtimeUsesPlainTextOwnerOutputContract(t *testing.T) {
	svc, session, decision, _ := prepareActiveAgentRealtimeTurnForTest(t, accountservice.LocalAppOperationAgentRealtimeInputAppend)
	var contexts []string
	executor := agentRealtimeExecutorStub{onAppend: func(req *runtimev1.AppendRealtimeInputRequest) error {
		if owner := req.GetOwnerContext(); owner != nil {
			contexts = append(contexts, owner.GetText())
		}
		return nil
	}}
	ownerCtx := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision)
	if err := svc.composeAgentRealtimeTurnContext(ownerCtx, session, "hello", executor); err != nil {
		t.Fatalf("compose Realtime owner context: %v", err)
	}
	joined := strings.Join(contexts, "\n")
	if !strings.Contains(joined, agentRealtimeOutputInstruction) || strings.Contains(joined, "Runtime APML contract") {
		t.Fatalf("Realtime output contract is inconsistent: %q", joined)
	}
}

func TestAgentRealtimeCaptureStopCommitsInputWithoutClosingSession(t *testing.T) {
	svc, session, decision, handle := prepareAgentRealtimeSessionForTest(t, accountservice.LocalAppOperationAgentRealtimeInputAppend, false)
	session.inputTrackID = "input-track-1"
	session.utteranceID = "utterance-1"
	session.inputFrameSequence = 7
	var control runtimev1.AiRealtimeOwnerControlKind
	svc.SetAgentRealtimeAIExecutor(agentRealtimeExecutorStub{onControl: func(req *runtimev1.SubmitRealtimeOwnerControlRequest) {
		control = req.GetControl()
	}})

	_, err := svc.AppendLocalAppAgentRealtimeInput(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision),
		&runtimev1.AppendLocalAppAgentRealtimeInputRequest{
			AgentHandle: handle, RealtimeSessionId: session.realtimeSessionID, Generation: session.generation,
			Input: &runtimev1.AppendLocalAppAgentRealtimeInputRequest_CaptureStopped{
				CaptureStopped: &runtimev1.LocalAppAgentRealtimeCaptureStopped{
					InputTrackId: "input-track-1", UtteranceId: "utterance-1",
				},
			},
		},
	)
	if err != nil {
		t.Fatalf("AppendLocalAppAgentRealtimeInput(capture stopped): %v", err)
	}
	if control != runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_COMMIT_INPUT {
		t.Fatalf("capture stop control = %s", control)
	}
	if !session.inputCommitted || session.closed {
		t.Fatalf("capture stop session state = committed:%v closed:%v", session.inputCommitted, session.closed)
	}
}

func TestAgentRealtimeEmptyFinalTranscriptFailsTypedWithoutCreatingCanonicalTurn(t *testing.T) {
	svc, session, decision, _ := prepareAgentRealtimeSessionForTest(t, accountservice.LocalAppOperationAgentRealtimeEventsSubscribe, false)
	session.inputTrackID = "input-track-1"
	session.utteranceID = "utterance-1"
	session.inputFrameSequence = 4
	session.inputCommitted = true
	closeCount := 0
	projected, err := svc.projectAgentRealtimeEvent(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision),
		session,
		agentRealtimeExecutorStub{onClose: func() { closeCount++ }},
		&runtimev1.AiRealtimeEvent{Event: &runtimev1.AiRealtimeEvent_Transcript{Transcript: &runtimev1.AiRealtimeTranscript{
			InputTrackId: "input-track-1", UtteranceId: "utterance-1", Final: true,
		}}},
	)
	if err != nil {
		t.Fatalf("project empty final transcript: %v", err)
	}
	if projected.GetTerminal().GetReasonCode() != runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID {
		t.Fatalf("empty transcript terminal = %+v", projected.GetTerminal())
	}
	if closeCount != 1 || !session.closed {
		t.Fatalf("empty transcript did not close neutral session: closes=%d closed=%v", closeCount, session.closed)
	}
	_, active, _, _, snapshotErr := svc.snapshotPublicChatAnchorForCaller(decision.AppID, session.conversationAnchorID)
	if snapshotErr != nil || active != nil {
		t.Fatalf("empty transcript created canonical turn: active=%+v err=%v", active, snapshotErr)
	}
}

func prepareActiveAgentRealtimeTurnForTest(
	t *testing.T,
	operation accountservice.LocalAppOperation,
) (*Service, *localAppAgentRealtimeSession, accountservice.LocalAppCallerDecision, string) {
	return prepareAgentRealtimeSessionForTest(t, operation, true)
}

func prepareAgentRealtimeSessionForTest(
	t *testing.T,
	operation accountservice.LocalAppOperation,
	withActiveTurn bool,
) (*Service, *localAppAgentRealtimeSession, accountservice.LocalAppCallerDecision, string) {
	t.Helper()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	decision := localAppConversationDecision(operation, 0x61, "user-1")
	agentID := testRuntimeAgentLocalRef("agent-alpha")
	handle := mintLocalAppAgentHandle(decision, agentID)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", decision.AppID, decision.AccountID)
	session := &localAppAgentRealtimeSession{
		realtimeSessionID: "realtime-session-1", channelID: "channel-1", generation: 1,
		accountID: decision.AccountID, appID: decision.AppID, registeredAppSubject: decision.RegisteredAppSubject,
		agentID: agentID, agentHandle: handle, conversationAnchorID: anchorID,
		privateInputRequests: make(map[string]struct{}),
	}
	if withActiveTurn {
		ownerCtx := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision)
		resolved, ownerCtx, err := svc.resolveLocalAppAgent(ownerCtx, operation, handle)
		if err != nil {
			t.Fatalf("resolve Agent Realtime test owner: %v", err)
		}
		if err := svc.ensureAgentRealtimeTurn(ownerCtx, session, resolved, "agent-realtime-request-1"); err != nil {
			t.Fatalf("reserve Agent Realtime turn: %v", err)
		}
	}
	svc.agentRealtimeMu.Lock()
	svc.agentRealtimeSessions[session.realtimeSessionID] = session
	svc.agentRealtimeMu.Unlock()
	return svc, session, decision, handle
}

func assertAgentRealtimeTurnReleased(t *testing.T, svc *Service, session *localAppAgentRealtimeSession, callerAppID string) {
	t.Helper()
	_, active, last, _, err := svc.snapshotPublicChatAnchorForCaller(callerAppID, session.conversationAnchorID)
	if err != nil {
		t.Fatalf("snapshot after Agent Realtime terminal: %v", err)
	}
	if active != nil {
		t.Fatalf("canonical Agent turn remains active: %+v", active)
	}
	if last == nil || last.Status != publicChatTurnStatusInterrupted {
		t.Fatalf("last canonical Agent turn = %+v, want interrupted", last)
	}
}
