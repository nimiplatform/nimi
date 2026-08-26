package runtimeagent

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

const (
	agentRealtimeMaxInstructionBytes = 16 * 1024
	agentRealtimeMaxContextBytes     = 32 * 1024
	agentRealtimeOutputContractID    = "local-agent-realtime-text-output"
	agentRealtimeOutputContractV1    = "nimi.runtime.local-agent-realtime-text-output/v1"
	agentRealtimeOutputInstruction   = "Runtime Realtime output contract: return only the final user-visible reply as plain text in the user's language. Do not emit APML, XML, JSON, Markdown fences, hidden reasoning, action requests, tool requests, or provider control. Runtime Agent Service owns any action, tool, Memory, persistence, and response-control decisions outside this provider output."
)

type agentRealtimeAIExecutor interface {
	OpenRuntimeAgentRealtime(context.Context, string, *runtimev1.OpenRealtimeSessionRequest) (*runtimev1.OpenRealtimeSessionResponse, error)
	AppendRuntimeAgentRealtimeInput(context.Context, string, *runtimev1.AppendRealtimeInputRequest) (*runtimev1.AppendRealtimeInputResponse, error)
	SubmitRuntimeAgentRealtimeControl(context.Context, string, *runtimev1.SubmitRealtimeOwnerControlRequest) (*runtimev1.SubmitRealtimeOwnerControlResponse, error)
	InterruptRuntimeAgentRealtimeOutput(context.Context, string, *runtimev1.InterruptRealtimeOutputRequest) (*runtimev1.InterruptRealtimeOutputResponse, error)
	CloseRuntimeAgentRealtime(context.Context, string, *runtimev1.CloseRealtimeSessionRequest) (*runtimev1.CloseRealtimeSessionResponse, error)
	ClaimRuntimeAgentRealtimeEvents(context.Context, string, string, uint64) (<-chan *runtimev1.AiRealtimeEvent, func(), error)
}

type localAppAgentRealtimeTurn struct {
	session publicChatAnchorState
	turn    publicChatTurnState
	req     publicChatTurnRequestPayload
	text    string
	started bool
}

type localAppAgentRealtimeSession struct {
	eventMu              sync.Mutex
	mu                   sync.Mutex
	realtimeSessionID    string
	channelID            string
	generation           uint64
	accountID            string
	appID                string
	registeredAppSubject string
	agentID              string
	agentHandle          string
	conversationAnchorID string
	control              *runtimev1.RealtimeControlStatus
	turn                 *localAppAgentRealtimeTurn
	inputTrackID         string
	utteranceID          string
	inputFrameSequence   uint64
	inputCommitted       bool
	inputFinalizing      bool
	privateInputRequests map[string]struct{}
	closed               bool
}

func (s *Service) SetAgentRealtimeAIExecutor(executor agentRealtimeAIExecutor) {
	if s == nil {
		return
	}
	s.agentRealtimeMu.Lock()
	s.agentRealtimeAI = executor
	s.agentRealtimeMu.Unlock()
}

// @nimi-authority: rule.nimi.runtime.agent-participation.r185
func (s *Service) OpenLocalAppAgentRealtime(ctx context.Context, req *runtimev1.OpenLocalAppAgentRealtimeRequest) (*runtimev1.OpenLocalAppAgentRealtimeResponse, error) {
	if req == nil || s == nil {
		return nil, localAppConversationInvalid("Agent Realtime open request is required")
	}
	resolved, ownerCtx, err := s.resolveLocalAppAgent(ctx, accountservice.LocalAppOperationAgentRealtimeOpen, req.GetAgentHandle())
	if err != nil {
		return nil, err
	}
	anchorID := strings.TrimSpace(req.GetConversationAnchorId())
	if anchorID == "" {
		// Agent Realtime open is allowed to attach the already verified handle to
		// the Agent owner's one canonical Conversation. Derive the nested owner
		// action inside Runtime; the App neither supplies a raw LocalAgent id nor
		// a second Conversation selector.
		anchorDecision := resolved.decision
		anchorDecision.Operation = accountservice.LocalAppOperationOpenConversation
		anchorCtx := accountservice.ContextWithAuthorizedLocalAppDecision(ownerCtx, anchorDecision)
		opened, openErr := s.OpenConversationAnchor(anchorCtx, &runtimev1.OpenConversationAnchorRequest{AgentId: req.GetAgentHandle()})
		if openErr != nil {
			return nil, openErr
		}
		anchorID = strings.TrimSpace(opened.GetSnapshot().GetAnchor().GetConversationAnchorId())
	}
	if err := s.validateLocalAppConversationResource(resolved, anchorID); err != nil {
		return nil, err
	}
	s.agentRealtimeMu.RLock()
	executor := s.agentRealtimeAI
	s.agentRealtimeMu.RUnlock()
	if executor == nil {
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	initialInstruction, err := s.agentRealtimeInitialInstruction(ownerCtx, resolved)
	if err != nil {
		return nil, err
	}
	opened, err := executor.OpenRuntimeAgentRealtime(ownerCtx, resolved.decision.AccountID, &runtimev1.OpenRealtimeSessionRequest{
		InputAudio: req.GetInputAudio(), AudioOutputEnabled: true, TurnDetection: req.GetTurnDetection(), InitialInstruction: initialInstruction,
	})
	if err != nil {
		return nil, err
	}
	session := &localAppAgentRealtimeSession{
		realtimeSessionID: opened.GetRealtimeSessionId(), channelID: opened.GetChannelId(), generation: opened.GetGeneration(),
		accountID: resolved.decision.AccountID, appID: resolved.decision.AppID, registeredAppSubject: resolved.decision.RegisteredAppSubject,
		agentID: resolved.identity.LocalAgentRef, agentHandle: req.GetAgentHandle(), conversationAnchorID: anchorID,
		control: cloneAgentRealtimeControl(opened.GetControl()), privateInputRequests: make(map[string]struct{}),
	}
	s.chatSurfaceMu.Lock()
	if s.agentTerminationFencedLocked(session.agentID) {
		s.chatSurfaceMu.Unlock()
		_, _ = executor.CloseRuntimeAgentRealtime(ownerCtx, session.accountID, &runtimev1.CloseRealtimeSessionRequest{RealtimeSessionId: session.realtimeSessionID, Generation: session.generation})
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_OWNER_UNAVAILABLE)
	}
	s.agentRealtimeMu.Lock()
	if s.agentRealtimeSessions[session.realtimeSessionID] != nil {
		s.agentRealtimeMu.Unlock()
		s.chatSurfaceMu.Unlock()
		_, _ = executor.CloseRuntimeAgentRealtime(ownerCtx, session.accountID, &runtimev1.CloseRealtimeSessionRequest{RealtimeSessionId: session.realtimeSessionID, Generation: session.generation})
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	s.agentRealtimeSessions[session.realtimeSessionID] = session
	s.agentRealtimeMu.Unlock()
	s.chatSurfaceMu.Unlock()
	return &runtimev1.OpenLocalAppAgentRealtimeResponse{
		ConversationAnchorId: anchorID, RealtimeSessionId: opened.GetRealtimeSessionId(), ChannelId: opened.GetChannelId(), Generation: opened.GetGeneration(),
		NegotiatedInputAudio: opened.GetNegotiatedInputAudio(), NegotiatedOutputAudio: opened.GetNegotiatedOutputAudio(), Control: cloneAgentRealtimeControl(opened.GetControl()),
	}, nil
}

func (s *Service) agentRealtimeInitialInstruction(ctx context.Context, resolved localAppAgentIdentity) (string, error) {
	if s == nil || s.publicChatSourceSnapshotResolve == nil {
		return "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
	}
	snapshot, found, err := s.publicChatSourceSnapshotResolve(ctx, resolved.identity.LocalAgentRef)
	if err != nil || !found {
		return "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
	}
	profile, err := decodeRealmSourceCompilerProfileV3(snapshot.Semantic.Source.Profile)
	if err != nil {
		return "", grpcerr.WithReasonCode(codes.DataLoss, runtimev1.ReasonCode_AI_CONFIG_INVALID)
	}
	lines := []string{
		"You are the selected Nimi LocalAgent. Stay in character and never identify yourself as a model, provider, or engine.",
		"Name: " + strings.TrimSpace(profile.Identity.Name),
		"Identity: " + strings.TrimSpace(profile.Identity.Summary),
		"Narrative: " + strings.TrimSpace(profile.Narrative.Summary),
		"Reply naturally and concisely in the user's language. Do not emit JSON, XML, Markdown fences, tool calls, or hidden reasoning.",
	}
	if profile.Presentation.ShortBio != nil && strings.TrimSpace(*profile.Presentation.ShortBio) != "" {
		lines = append(lines, "Biography: "+strings.TrimSpace(*profile.Presentation.ShortBio))
	}
	if profile.Narrative.Traits != nil && len(*profile.Narrative.Traits) > 0 {
		lines = append(lines, "Traits: "+strings.Join(*profile.Narrative.Traits, ", "))
	}
	if profile.Knowledge != nil && profile.Knowledge.Topics != nil && len(*profile.Knowledge.Topics) > 0 {
		lines = append(lines, "Knowledge topics: "+strings.Join(*profile.Knowledge.Topics, ", "))
	}
	instruction := strings.Join(lines, "\n")
	if len(instruction) > agentRealtimeMaxInstructionBytes {
		return "", grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_AI_CONFIG_INVALID)
	}
	return instruction, nil
}

func (s *Service) AppendLocalAppAgentRealtimeInput(ctx context.Context, req *runtimev1.AppendLocalAppAgentRealtimeInputRequest) (*runtimev1.AppendLocalAppAgentRealtimeInputResponse, error) {
	if req == nil {
		return nil, localAppConversationInvalid("Agent Realtime input request is required")
	}
	session, resolved, executor, err := s.authorizeLocalAppAgentRealtime(ctx, accountservice.LocalAppOperationAgentRealtimeInputAppend, req.GetRealtimeSessionId(), req.GetGeneration(), req.GetAgentHandle())
	if err != nil {
		return nil, err
	}
	aiReq := &runtimev1.AppendRealtimeInputRequest{RealtimeSessionId: session.realtimeSessionID, Generation: session.generation}
	var textInput string
	switch input := req.GetInput().(type) {
	case *runtimev1.AppendLocalAppAgentRealtimeInputRequest_AudioFrame:
		if input.AudioFrame == nil {
			return nil, localAppConversationInvalid("Agent Realtime audio frame is required")
		}
		if !session.acceptsAudioFrame(input.AudioFrame) {
			return nil, localAppConversationInvalid("Agent Realtime audio frame continuity is invalid")
		}
		aiReq.Input = &runtimev1.AppendRealtimeInputRequest_AudioFrame{AudioFrame: &runtimev1.AiRealtimeAudioFrameInput{
			InputTrackId: input.AudioFrame.GetInputTrackId(), UtteranceId: input.AudioFrame.GetUtteranceId(),
			FrameSequence: input.AudioFrame.GetFrameSequence(), Frame: append([]byte(nil), input.AudioFrame.GetFrame()...),
		}}
	case *runtimev1.AppendLocalAppAgentRealtimeInputRequest_Text:
		if input.Text == nil {
			return nil, localAppConversationInvalid("Agent Realtime text input is required")
		}
		textInput = strings.TrimSpace(input.Text.GetText())
		aiReq.Input = &runtimev1.AppendRealtimeInputRequest_Text{Text: &runtimev1.AiRealtimeTextInput{RequestId: input.Text.GetRequestId(), Text: input.Text.GetText()}}
	case *runtimev1.AppendLocalAppAgentRealtimeInputRequest_CaptureStopped:
		if input.CaptureStopped == nil || !session.commitCapture(
			input.CaptureStopped.GetInputTrackId(),
			input.CaptureStopped.GetUtteranceId(),
		) {
			return nil, localAppConversationInvalid("Agent Realtime capture stop is invalid")
		}
		committed, commitErr := executor.SubmitRuntimeAgentRealtimeControl(ctx, session.accountID, &runtimev1.SubmitRealtimeOwnerControlRequest{
			RealtimeSessionId: session.realtimeSessionID,
			Generation:        session.generation,
			RequestId:         "agent_capture_" + ulid.Make().String(),
			Control:           runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_COMMIT_INPUT,
		})
		if commitErr != nil {
			session.releaseCaptureCommit()
			return nil, commitErr
		}
		session.setControl(committed.GetControl())
		return &runtimev1.AppendLocalAppAgentRealtimeInputResponse{
			Ack: committed.GetAck(), Control: cloneAgentRealtimeControl(committed.GetControl()),
		}, nil
	default:
		return nil, localAppConversationInvalid("Agent Realtime input variant is required")
	}
	if textInput != "" {
		requestID := req.GetText().GetRequestId()
		if err := s.ensureAgentRealtimeTurn(ctx, session, resolved, requestID); err != nil {
			return nil, err
		}
		if err := s.composeAgentRealtimeTurnContext(ctx, session, textInput, executor); err != nil {
			return nil, err
		}
	}
	appended, err := executor.AppendRuntimeAgentRealtimeInput(ctx, session.accountID, aiReq)
	if err != nil {
		if textInput != "" {
			reason := runtimeErrorDetailFromError(err).ReasonCode
			if reason == runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
				reason = runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE
			}
			s.failAgentRealtimeTurn(session, reason, err.Error())
			s.abortAgentRealtimeSession(session, executor)
		}
		return nil, err
	}
	session.setControl(appended.GetControl())
	if frame := req.GetAudioFrame(); frame != nil {
		session.commitAudioFrame(frame)
	}
	if textInput != "" {
		if err := s.activateAgentRealtimeTurn(ctx, session, executor); err != nil {
			return nil, err
		}
	}
	return &runtimev1.AppendLocalAppAgentRealtimeInputResponse{Ack: appended.GetAck(), Control: cloneAgentRealtimeControl(appended.GetControl())}, nil
}

func (s *Service) SubscribeLocalAppAgentRealtimeEvents(req *runtimev1.SubscribeLocalAppAgentRealtimeEventsRequest, stream runtimev1.RuntimeAgentService_SubscribeLocalAppAgentRealtimeEventsServer) error {
	session, _, executor, err := s.authorizeLocalAppAgentRealtime(stream.Context(), accountservice.LocalAppOperationAgentRealtimeEventsSubscribe, req.GetRealtimeSessionId(), req.GetGeneration(), req.GetAgentHandle())
	if err != nil {
		return err
	}
	// The neutral opened event is intentionally absent from the Agent-owned
	// public union. Establish the stream before waiting for the first
	// projectable Agent media/status event so the caller can append input.
	if err := stream.SendHeader(metadata.MD{}); err != nil {
		return err
	}
	events, release, err := executor.ClaimRuntimeAgentRealtimeEvents(stream.Context(), session.accountID, session.realtimeSessionID, session.generation)
	if err != nil {
		return err
	}
	defer release()
	for {
		select {
		case <-stream.Context().Done():
			if s.logger != nil {
				s.logger.Warn("Agent Realtime consumer stream closed", "error", stream.Context().Err())
			}
			return stream.Context().Err()
		case event, ok := <-events:
			if !ok {
				return nil
			}
			projected, err := s.projectAgentRealtimeEvent(stream.Context(), session, executor, event)
			if err != nil {
				if s.logger != nil {
					s.logger.Warn("Agent Realtime event projection failed", "error", err)
				}
				return err
			}
			if projected != nil {
				if err := stream.Send(projected); err != nil {
					if s.logger != nil {
						s.logger.Warn("Agent Realtime event delivery failed", "error", err)
					}
					return err
				}
			}
		}
	}
}

func (s *Service) GetLocalAppAgentRealtimeStatus(ctx context.Context, req *runtimev1.GetLocalAppAgentRealtimeStatusRequest) (*runtimev1.GetLocalAppAgentRealtimeStatusResponse, error) {
	session, _, _, err := s.authorizeLocalAppAgentRealtime(ctx, accountservice.LocalAppOperationAgentRealtimeStatusGet, req.GetRealtimeSessionId(), req.GetGeneration(), req.GetAgentHandle())
	if err != nil {
		return nil, err
	}
	return &runtimev1.GetLocalAppAgentRealtimeStatusResponse{Control: session.currentControl()}, nil
}

func (s *Service) InterruptLocalAppAgentRealtimeOutput(ctx context.Context, req *runtimev1.InterruptLocalAppAgentRealtimeOutputRequest) (*runtimev1.InterruptLocalAppAgentRealtimeOutputResponse, error) {
	session, _, executor, err := s.authorizeLocalAppAgentRealtime(ctx, accountservice.LocalAppOperationAgentRealtimeOutputInterrupt, req.GetRealtimeSessionId(), req.GetGeneration(), req.GetAgentHandle())
	if err != nil {
		return nil, err
	}
	var active *localAppAgentRealtimeTurn
	if req.GetInterruptAgentTurn() {
		// Fence the Agent-owned turn before asking the neutral AI Realtime layer
		// to interrupt its output track. The Driver can publish a terminal event
		// synchronously with the interrupt request; detaching first prevents that
		// event from racing the explicit owner interruption into a committed final.
		active = session.detachTurn()
		if active != nil {
			s.interruptDetachedAgentRealtimeTurn(active, "user_cancel")
		}
	}
	interrupted, err := executor.InterruptRuntimeAgentRealtimeOutput(ctx, session.accountID, &runtimev1.InterruptRealtimeOutputRequest{
		RealtimeSessionId: session.realtimeSessionID, Generation: session.generation, OutputTrackId: req.GetOutputTrackId(),
	})
	if err != nil {
		return nil, err
	}
	session.setControl(interrupted.GetControl())
	return &runtimev1.InterruptLocalAppAgentRealtimeOutputResponse{Ack: interrupted.GetAck(), Control: cloneAgentRealtimeControl(interrupted.GetControl())}, nil
}

func (s *Service) CloseLocalAppAgentRealtime(ctx context.Context, req *runtimev1.CloseLocalAppAgentRealtimeRequest) (*runtimev1.CloseLocalAppAgentRealtimeResponse, error) {
	session, _, executor, err := s.authorizeLocalAppAgentRealtime(ctx, accountservice.LocalAppOperationAgentRealtimeClose, req.GetRealtimeSessionId(), req.GetGeneration(), req.GetAgentHandle())
	if err != nil {
		return nil, err
	}
	if session.hasActiveTurn() {
		return nil, status.Error(codes.FailedPrecondition, "Agent Realtime turn must be interrupted explicitly before closing media")
	}
	defer s.removeAgentRealtimeSession(session.realtimeSessionID)
	closed, err := executor.CloseRuntimeAgentRealtime(ctx, session.accountID, &runtimev1.CloseRealtimeSessionRequest{RealtimeSessionId: session.realtimeSessionID, Generation: session.generation})
	if err != nil {
		return nil, err
	}
	return &runtimev1.CloseLocalAppAgentRealtimeResponse{Ack: closed.GetAck(), Control: cloneAgentRealtimeControl(closed.GetControl())}, nil
}

func (s *Service) authorizeLocalAppAgentRealtime(ctx context.Context, operation accountservice.LocalAppOperation, sessionID string, generation uint64, handle string) (*localAppAgentRealtimeSession, localAppAgentIdentity, agentRealtimeAIExecutor, error) {
	resolved, _, err := s.resolveLocalAppAgent(ctx, operation, handle)
	if err != nil {
		return nil, localAppAgentIdentity{}, nil, err
	}
	s.agentRealtimeMu.RLock()
	session := s.agentRealtimeSessions[strings.TrimSpace(sessionID)]
	executor := s.agentRealtimeAI
	s.agentRealtimeMu.RUnlock()
	if session == nil || executor == nil || generation == 0 || session.generation != generation || session.closed ||
		session.accountID != resolved.decision.AccountID || session.appID != resolved.decision.AppID ||
		session.registeredAppSubject != resolved.decision.RegisteredAppSubject || session.agentID != resolved.identity.LocalAgentRef {
		return nil, localAppAgentIdentity{}, nil, localAppAgentAccessDenied()
	}
	return session, resolved, executor, nil
}

func (s *Service) ensureAgentRealtimeTurn(ctx context.Context, session *localAppAgentRealtimeSession, resolved localAppAgentIdentity, requestID string) error {
	requestID = strings.TrimSpace(requestID)
	if session == nil || requestID == "" {
		return localAppConversationInvalid("Agent Realtime request identity is invalid")
	}
	session.mu.Lock()
	if session.turn != nil {
		session.mu.Unlock()
		return status.Error(codes.FailedPrecondition, "Agent Realtime already has an active Agent turn")
	}
	session.mu.Unlock()
	req := publicChatTurnRequestPayload{
		LocalAgentRef: resolved.identity.LocalAgentRef, OwnerUserID: resolved.identity.OwnerUserID,
		RuntimeSourceRef: resolved.identity.RuntimeSourceRef, ConversationAnchorID: session.conversationAnchorID,
		RequestID: requestID,
	}
	runtime := s.publicChatRuntime()
	ownerSession, turn, _, err := runtime.reserveTurn(ctx, session.appID, session.accountID, req)
	if err != nil {
		return err
	}
	origin := stateEventOrigin{ConversationAnchorID: ownerSession.ConversationAnchorID, OriginatingTurnID: turn.TurnID, OriginatingStreamID: turn.StreamID}
	if err := runtime.setExecutionStateWithOrigin(ownerSession.AgentID, ownerSession.SubjectUserID, "", runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_CHAT_ACTIVE, origin); err != nil {
		runtime.releaseTurn(ownerSession.ConversationAnchorID, turn.TurnID)
		return err
	}
	s.setPublicChatTurnRequestID(turn.TurnID, requestID)
	turn.RequestID = requestID
	session.mu.Lock()
	if session.turn != nil {
		session.mu.Unlock()
		runtime.releaseTurn(ownerSession.ConversationAnchorID, turn.TurnID)
		return status.Error(codes.FailedPrecondition, "Agent Realtime already has an active Agent turn")
	}
	session.turn = &localAppAgentRealtimeTurn{session: ownerSession, turn: turn, req: req}
	session.mu.Unlock()
	return nil
}

func (s *Service) composeAgentRealtimeTurnContext(ctx context.Context, session *localAppAgentRealtimeSession, text string, executor agentRealtimeAIExecutor) error {
	text = strings.TrimSpace(text)
	if session == nil || executor == nil || text == "" {
		return localAppConversationInvalid("Agent Realtime final input is invalid")
	}
	session.mu.Lock()
	active := session.turn
	if active == nil || active.started {
		session.mu.Unlock()
		return status.Error(codes.FailedPrecondition, "Agent Realtime turn is unavailable for context composition")
	}
	active.req.Messages = []publicChatMessagePayload{{Role: "user", Content: text}}
	req := active.req
	ownerSession, turn := active.session, active.turn
	session.mu.Unlock()
	compiled, err := s.publicChatRuntime().composeLocalAgentTurnContext(
		ctx,
		ownerSession,
		turn,
		req,
		agentTurnOutputContractInput{
			ContractID:  agentRealtimeOutputContractID,
			Version:     agentRealtimeOutputContractV1,
			Instruction: agentRealtimeOutputInstruction,
		},
		nil,
	)
	if err != nil {
		s.failAgentRealtimeTurn(session, runtimeErrorDetailFromError(err).ReasonCode, err.Error())
		return err
	}
	s.mutatePublicChatTurnProjection(turn.TurnID, true, func(projection *publicChatTurnProjectionState) {
		projection.ContextSummary = cloneAgentTurnContextSummary(compiled.Summary)
	})
	ownerInputs := make([]*runtimev1.AiRealtimeOwnerContextInput, 0, len(compiled.ProviderPrompt.Messages))
	for index, message := range compiled.ProviderPrompt.Messages {
		// The provider already owns the current user's typed text/audio item. The
		// penultimate canonical prompt entry is that current user turn; do not
		// duplicate it when projecting Runtime-private owner context.
		if len(compiled.ProviderPrompt.Messages) >= 2 && index == len(compiled.ProviderPrompt.Messages)-2 {
			continue
		}
		kind := runtimev1.AiRealtimeOwnerContextKind_AI_REALTIME_OWNER_CONTEXT_KIND_CONTEXT
		if message.Role == "system" {
			kind = runtimev1.AiRealtimeOwnerContextKind_AI_REALTIME_OWNER_CONTEXT_KIND_INSTRUCTION
		}
		content := fmt.Sprintf("Canonical LocalAgent %s context:\n%s", message.Role, strings.TrimSpace(message.Content))
		if strings.TrimSpace(message.Content) == "" || len(content) > agentRealtimeMaxContextBytes {
			err := grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_AI_INPUT_INVALID)
			s.failAgentRealtimeTurn(session, runtimev1.ReasonCode_AI_INPUT_INVALID, err.Error())
			return err
		}
		ownerInputs = append(ownerInputs, &runtimev1.AiRealtimeOwnerContextInput{
			RequestId: "agent_context_" + ulid.Make().String(),
			Kind:      kind,
			Text:      content,
		})
	}
	for _, ownerInput := range ownerInputs {
		requestID := ownerInput.GetRequestId()
		session.registerPrivateInputRequest(requestID)
		if _, err := executor.AppendRuntimeAgentRealtimeInput(ctx, session.accountID, &runtimev1.AppendRealtimeInputRequest{
			RealtimeSessionId: session.realtimeSessionID,
			Generation:        session.generation,
			Input:             &runtimev1.AppendRealtimeInputRequest_OwnerContext{OwnerContext: ownerInput},
		}); err != nil {
			session.forgetPrivateInputRequest(requestID)
			reason := runtimeErrorDetailFromError(err).ReasonCode
			if reason == runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
				reason = runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE
			}
			s.failAgentRealtimeTurn(session, reason, err.Error())
			s.abortAgentRealtimeSession(session, executor)
			return err
		}
	}
	session.mu.Lock()
	if session.turn == active {
		active.req = req
	}
	session.mu.Unlock()
	return nil
}

func (s *Service) activateAgentRealtimeTurn(ctx context.Context, session *localAppAgentRealtimeSession, executor agentRealtimeAIExecutor) error {
	if session == nil || executor == nil {
		return localAppConversationInvalid("Agent Realtime turn is unavailable")
	}
	session.mu.Lock()
	active := session.turn
	if active == nil || active.started || len(active.req.Messages) == 0 {
		session.mu.Unlock()
		return status.Error(codes.FailedPrecondition, "Agent Realtime turn is not composed")
	}
	active.started = true
	ownerSession, turn, requestID := active.session, active.turn, active.req.RequestID
	session.mu.Unlock()
	runtime := s.publicChatRuntime()
	if err := runtime.emitTurnEvent(ownerSession, turn.TurnID, publicChatTurnAcceptedType, publicChatAcceptedDetail(requestID)); err != nil {
		s.failAgentRealtimeTurn(session, runtimev1.ReasonCode_LOCAL_APP_OWNER_UNAVAILABLE, err.Error())
		return err
	}
	if err := runtime.emitTurnEvent(ownerSession, turn.TurnID, publicChatTurnStartedType, map[string]any{}); err != nil {
		s.failAgentRealtimeTurn(session, runtimev1.ReasonCode_LOCAL_APP_OWNER_UNAVAILABLE, err.Error())
		return err
	}
	_, err := executor.SubmitRuntimeAgentRealtimeControl(ctx, session.accountID, &runtimev1.SubmitRealtimeOwnerControlRequest{
		RealtimeSessionId: session.realtimeSessionID, Generation: session.generation, RequestId: turn.TurnID,
		Control: runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_START_RESPONSE,
	})
	if err != nil {
		if s.logger != nil {
			s.logger.Warn("Agent Realtime owner response control failed", "turn_id", turn.TurnID, "error", err)
		}
		s.failAgentRealtimeTurn(session, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, err.Error())
	}
	return err
}

func (s *Service) projectAgentRealtimeEvent(ctx context.Context, session *localAppAgentRealtimeSession, executor agentRealtimeAIExecutor, event *runtimev1.AiRealtimeEvent) (*runtimev1.LocalAppAgentRealtimeEvent, error) {
	if session == nil || event == nil {
		return nil, nil
	}
	// Serialize the complete owner projection/commit boundary against an
	// Agent-scoped lifecycle fence. Once termination closes this exact session
	// generation, queued provider events can neither reach the App nor commit a
	// late canonical turn.
	session.eventMu.Lock()
	defer session.eventMu.Unlock()
	if session.isClosed() {
		return nil, nil
	}
	session.setControl(event.GetControl())
	projected := &runtimev1.LocalAppAgentRealtimeEvent{Control: cloneAgentRealtimeControl(event.GetControl())}
	switch value := event.GetEvent().(type) {
	case *runtimev1.AiRealtimeEvent_Opened:
		return nil, nil
	case *runtimev1.AiRealtimeEvent_InputAccepted:
		if session.consumePrivateInputRequest(value.InputAccepted.GetRequestId()) {
			return nil, nil
		}
		projected.Event = &runtimev1.LocalAppAgentRealtimeEvent_InputAccepted{InputAccepted: &runtimev1.LocalAppAgentRealtimeInputAccepted{
			InputTrackId: value.InputAccepted.GetInputTrackId(), UtteranceId: value.InputAccepted.GetUtteranceId(),
			FrameSequence: value.InputAccepted.GetFrameSequence(), RequestId: value.InputAccepted.GetRequestId(),
		}}
	case *runtimev1.AiRealtimeEvent_SpeechStatus:
		projected.Event = &runtimev1.LocalAppAgentRealtimeEvent_SpeechStatus{SpeechStatus: &runtimev1.LocalAppAgentRealtimeSpeechStatus{
			InputTrackId: value.SpeechStatus.GetInputTrackId(), UtteranceId: value.SpeechStatus.GetUtteranceId(), State: value.SpeechStatus.GetState(),
		}}
	case *runtimev1.AiRealtimeEvent_Transcript:
		if value.Transcript.GetFinal() {
			if !session.completeDetectedInput(value.Transcript.GetInputTrackId(), value.Transcript.GetUtteranceId()) {
				return nil, localAppConversationInvalid("Agent Realtime transcript input identity is stale")
			}
			if strings.TrimSpace(value.Transcript.GetText()) == "" {
				projected.Event = &runtimev1.LocalAppAgentRealtimeEvent_Terminal{Terminal: &runtimev1.LocalAppAgentRealtimeTerminal{
					ReasonCode: runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID,
				}}
				s.abortAgentRealtimeSession(session, executor)
				return projected, nil
			}
		}
		projected.Event = &runtimev1.LocalAppAgentRealtimeEvent_Transcript{Transcript: &runtimev1.LocalAppAgentRealtimeTranscript{
			InputTrackId: value.Transcript.GetInputTrackId(), UtteranceId: value.Transcript.GetUtteranceId(), Text: value.Transcript.GetText(), Final: value.Transcript.GetFinal(),
		}}
		if value.Transcript.GetFinal() {
			resolved := localAppAgentIdentity{decision: accountservice.LocalAppCallerDecision{AccountID: session.accountID, AppID: session.appID, RegisteredAppSubject: session.registeredAppSubject}, identity: localAgentIdentity{LocalAgentRef: session.agentID}}
			entry, err := s.agentByID(session.agentID)
			if err != nil {
				return nil, err
			}
			resolved.entry = entry.Agent
			identity, err := validateLocalAgentIdentity(entry.Agent.GetOwnerUserId(), entry.Agent.GetRuntimeSourceRef(), entry.Agent.GetLocalAgentRef())
			if err != nil {
				return nil, err
			}
			resolved.identity = identity
			if err := s.ensureAgentRealtimeTurn(ctx, session, resolved, "agent_realtime_"+ulid.Make().String()); err != nil {
				s.abortAgentRealtimeSession(session, executor)
				return nil, err
			}
			if err := s.composeAgentRealtimeTurnContext(ctx, session, value.Transcript.GetText(), executor); err != nil {
				s.abortAgentRealtimeSession(session, executor)
				return nil, err
			}
			if err := s.activateAgentRealtimeTurn(ctx, session, executor); err != nil {
				s.abortAgentRealtimeSession(session, executor)
				return nil, err
			}
			session.completeTurnAdmission()
		}
	case *runtimev1.AiRealtimeEvent_TextOutput:
		session.mu.Lock()
		conversationDelta := value.TextOutput.GetText()
		if session.turn != nil {
			if value.TextOutput.GetFinal() {
				previous := session.turn.text
				finalText := value.TextOutput.GetText()
				if strings.HasPrefix(finalText, previous) {
					conversationDelta = finalText[len(previous):]
				}
				session.turn.text = finalText
			} else {
				session.turn.text += value.TextOutput.GetText()
			}
		}
		turn := session.turn
		session.mu.Unlock()
		if turn != nil && conversationDelta != "" {
			_ = s.publicChatRuntime().emitTurnEvent(turn.session, turn.turn.TurnID, publicChatTurnTextDeltaType, map[string]any{"text": conversationDelta})
		}
		projected.Event = &runtimev1.LocalAppAgentRealtimeEvent_TextOutput{TextOutput: &runtimev1.LocalAppAgentRealtimeTextOutput{
			RequestId: value.TextOutput.GetRequestId(), OutputTrackId: value.TextOutput.GetOutputTrackId(), Text: value.TextOutput.GetText(), Final: value.TextOutput.GetFinal(),
		}}
	case *runtimev1.AiRealtimeEvent_AudioFrame:
		projected.Event = &runtimev1.LocalAppAgentRealtimeEvent_AudioFrame{AudioFrame: &runtimev1.LocalAppAgentRealtimeAudioFrameOutput{
			RequestId: value.AudioFrame.GetRequestId(), OutputTrackId: value.AudioFrame.GetOutputTrackId(), FrameSequence: value.AudioFrame.GetFrameSequence(),
			Frame: append([]byte(nil), value.AudioFrame.GetFrame()...), Format: value.AudioFrame.GetFormat(),
		}}
	case *runtimev1.AiRealtimeEvent_OutputTrack:
		projected.Event = &runtimev1.LocalAppAgentRealtimeEvent_OutputTrack{OutputTrack: &runtimev1.LocalAppAgentRealtimeOutputTrackStatus{
			RequestId: value.OutputTrack.GetRequestId(), OutputTrackId: value.OutputTrack.GetOutputTrackId(), Lifecycle: value.OutputTrack.GetLifecycle(), ReasonCode: value.OutputTrack.GetReasonCode(),
		}}
	case *runtimev1.AiRealtimeEvent_RequestTerminal:
		if err := s.completeAgentRealtimeTurn(ctx, session, value.RequestTerminal.GetUsage()); err != nil {
			return nil, err
		}
		projected.Event = &runtimev1.LocalAppAgentRealtimeEvent_Terminal{Terminal: &runtimev1.LocalAppAgentRealtimeTerminal{
			ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		}}
	case *runtimev1.AiRealtimeEvent_Failure:
		s.failAgentRealtimeTurn(session, value.Failure.GetReasonCode(), "AI Realtime request failed")
		projected.Event = &runtimev1.LocalAppAgentRealtimeEvent_Terminal{Terminal: &runtimev1.LocalAppAgentRealtimeTerminal{ReasonCode: value.Failure.GetReasonCode()}}
	case *runtimev1.AiRealtimeEvent_SessionTerminal:
		s.failAgentRealtimeTurn(session, value.SessionTerminal.GetReasonCode(), "AI Realtime session closed")
		projected.Event = &runtimev1.LocalAppAgentRealtimeEvent_Terminal{Terminal: &runtimev1.LocalAppAgentRealtimeTerminal{ReasonCode: value.SessionTerminal.GetReasonCode()}}
		s.removeAgentRealtimeSession(session.realtimeSessionID)
	default:
		return nil, localAppConversationInvalid("Agent Realtime event variant is invalid")
	}
	return projected, nil
}

func (s *Service) completeAgentRealtimeTurn(ctx context.Context, session *localAppAgentRealtimeSession, usage *runtimev1.UsageStats) error {
	active := session.detachTurn()
	if active == nil {
		return nil
	}
	// Every terminal path must release the canonical one-active-turn
	// reservation, including a downstream delivery error after the transcript
	// commit. finishTurnReservation is idempotent when a failure path releases
	// the reservation first.
	defer s.publicChatRuntime().finishTurnReservation(active.session, active.turn.TurnID)
	text := strings.TrimSpace(active.text)
	if text == "" {
		s.failDetachedAgentRealtimeTurn(active, runtimev1.ReasonCode_AI_OUTPUT_INVALID, "AI Realtime response text is empty")
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	if err := validateAgentRealtimeResponseText(text); err != nil {
		s.failDetachedAgentRealtimeTurn(active, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err.Error())
		return err
	}
	structured := &publicChatStructuredEnvelope{SchemaID: publicChatStructuredSchemaID, Message: publicChatStructuredMessage{MessageID: "message_" + ulid.Make().String(), Text: text}}
	finish := &runtimev1.ScenarioStreamCompleted{FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP}
	finalize := func(projection *publicChatTurnProjectionState) {
		applyCommittedPublicChatMessageProjection(projection, "", "", runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED, structured, usage, finish, nil)
	}
	if err := s.commitPublicChatTurnTranscriptForTurnWithProjection(ctx, active.session.ConversationAnchorID, active.turn.TurnID, publicChatCurrentUserCommitMessage(active.req), text, finalize); err != nil {
		s.failDetachedAgentRealtimeTurn(active, runtimev1.ReasonCode_AI_STREAM_BROKEN, err.Error())
		return err
	}
	if err := s.publicChatRuntime().emitTurnMessageCommitted(active.session, active.turn.TurnID, structured.Message.MessageID, text); err != nil {
		return err
	}
	memory := s.publicChatRuntime().applyAssistantTurnMemory(ctx, active.session, active.turn, text)
	outcome := &publicChatPostTurnOutcome{AssistantMemory: memory, Sidecar: publicChatSidecarOutcome{Status: "skipped"}, FollowUp: publicChatFollowUpOutcome{Status: "skipped"}}
	s.finalizePublicChatTurnProjection(active.turn.TurnID, true, func(projection *publicChatTurnProjectionState) {
		applyCompletedPublicChatTurnProjection(projection, "", "", runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED, structured, usage, finish, outcome)
	})
	if err := s.publicChatRuntime().emitTurnEvent(active.session, active.turn.TurnID, publicChatTurnCompletedType, publicChatTurnCompletedDetail(runtimev1.FinishReason_FINISH_REASON_STOP)); err != nil {
		return err
	}
	return nil
}

func (s *Service) failAgentRealtimeTurn(session *localAppAgentRealtimeSession, reason runtimev1.ReasonCode, message string) {
	if session == nil {
		return
	}
	session.mu.Lock()
	active := session.turn
	session.turn = nil
	session.mu.Unlock()
	if active != nil {
		s.failDetachedAgentRealtimeTurn(active, reason, message)
	}
}

func (s *Service) failDetachedAgentRealtimeTurn(active *localAppAgentRealtimeTurn, reason runtimev1.ReasonCode, message string) {
	if active == nil {
		return
	}
	s.finalizePublicChatTurnProjection(active.turn.TurnID, true, func(projection *publicChatTurnProjectionState) {
		projection.Status = publicChatTurnStatusFailed
		projection.ReasonCode = reason
		projection.Message = strings.TrimSpace(message)
	})
	s.publicChatRuntime().emitTurnFailed(active.session, active.turn, "", "", 0, reason, message, "")
	s.publicChatRuntime().finishTurnReservation(active.session, active.turn.TurnID)
}

func (s *Service) interruptDetachedAgentRealtimeTurn(active *localAppAgentRealtimeTurn, reason string) {
	if active == nil {
		return
	}
	if active.turn.Cancel != nil {
		active.turn.Cancel()
	}
	s.finalizePublicChatTurnProjection(active.turn.TurnID, true, func(projection *publicChatTurnProjectionState) {
		projection.Status = publicChatTurnStatusInterrupted
		projection.ReasonCode = runtimev1.ReasonCode_AI_STREAM_BROKEN
		projection.Message = reason
	})
	s.publicChatRuntime().emitTurnInterrupted(active.session, active.turn, "", "", 0, reason)
	s.publicChatRuntime().finishTurnReservation(active.session, active.turn.TurnID)
}

func (s *Service) abortAgentRealtimeSession(session *localAppAgentRealtimeSession, executor agentRealtimeAIExecutor) {
	if s == nil || session == nil {
		return
	}
	s.removeAgentRealtimeSession(session.realtimeSessionID)
	if executor == nil {
		return
	}
	if _, err := executor.CloseRuntimeAgentRealtime(context.Background(), session.accountID, &runtimev1.CloseRealtimeSessionRequest{
		RealtimeSessionId: session.realtimeSessionID,
		Generation:        session.generation,
	}); err != nil && s.logger != nil {
		s.logger.Warn("Agent Realtime contaminated neutral session close failed", "error", err)
	}
}

type agentRealtimeTerminationFence struct {
	session    *localAppAgentRealtimeSession
	generation uint64
	active     *localAppAgentRealtimeTurn
}

// fenceAgentRealtimeSessions removes and closes only the target Agent's
// active media generations. eventMu makes the fence linearizable with event
// projection: an event either completes before this boundary or observes the
// closed session and is suppressed in full.
func (s *Service) fenceAgentRealtimeSessions(localAgentRef string) (agentRealtimeAIExecutor, []agentRealtimeTerminationFence) {
	if s == nil {
		return nil, nil
	}
	ref := strings.TrimSpace(localAgentRef)
	if ref == "" {
		return nil, nil
	}
	s.agentRealtimeMu.RLock()
	candidates := make([]*localAppAgentRealtimeSession, 0)
	for _, session := range s.agentRealtimeSessions {
		if session != nil && strings.TrimSpace(session.agentID) == ref {
			candidates = append(candidates, session)
		}
	}
	s.agentRealtimeMu.RUnlock()
	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].realtimeSessionID < candidates[j].realtimeSessionID
	})
	for _, session := range candidates {
		session.eventMu.Lock()
	}

	s.agentRealtimeMu.Lock()
	executor := s.agentRealtimeAI
	fenced := make([]agentRealtimeTerminationFence, 0, len(candidates))
	for _, session := range candidates {
		if s.agentRealtimeSessions[session.realtimeSessionID] != session || strings.TrimSpace(session.agentID) != ref {
			continue
		}
		delete(s.agentRealtimeSessions, session.realtimeSessionID)
		session.mu.Lock()
		if session.closed {
			session.mu.Unlock()
			continue
		}
		session.closed = true
		active := session.turn
		session.turn = nil
		session.inputFinalizing = false
		session.privateInputRequests = make(map[string]struct{})
		generation := session.generation
		session.mu.Unlock()
		fenced = append(fenced, agentRealtimeTerminationFence{session: session, generation: generation, active: active})
	}
	s.agentRealtimeMu.Unlock()
	for index := len(candidates) - 1; index >= 0; index-- {
		candidates[index].eventMu.Unlock()
	}
	return executor, fenced
}

func (s *Service) closeFencedAgentRealtimeSessions(executor agentRealtimeAIExecutor, fenced []agentRealtimeTerminationFence) {
	for _, item := range fenced {
		if item.active != nil {
			s.interruptDetachedAgentRealtimeTurn(item.active, "room_closed")
		}
		if executor == nil || item.session == nil {
			continue
		}
		_, _ = executor.CloseRuntimeAgentRealtime(context.Background(), item.session.accountID, &runtimev1.CloseRealtimeSessionRequest{
			RealtimeSessionId: item.session.realtimeSessionID,
			Generation:        item.generation,
		})
	}
}

func validateAgentRealtimeResponseText(text string) error {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	lower := strings.ToLower(trimmed)
	for _, marker := range []string{"<message", "<action", "<time-hook", "<event-hook", "<think", "```"} {
		if strings.HasPrefix(lower, marker) {
			return grpcerr.WrapWithReasonCode(
				codes.Internal,
				runtimev1.ReasonCode_AI_OUTPUT_INVALID,
				status.Error(codes.Internal, "Agent Realtime provider output violated the plain-text owner contract"),
				grpcerr.ReasonOptions{Message: "Agent Realtime provider output violated the plain-text owner contract"},
			)
		}
	}
	return nil
}

func (s *Service) removeAgentRealtimeSession(sessionID string) {
	s.agentRealtimeMu.Lock()
	if session := s.agentRealtimeSessions[strings.TrimSpace(sessionID)]; session != nil {
		session.mu.Lock()
		session.closed = true
		session.mu.Unlock()
		delete(s.agentRealtimeSessions, strings.TrimSpace(sessionID))
	}
	s.agentRealtimeMu.Unlock()
}

func (s *Service) shutdownAgentRealtime() {
	if s == nil {
		return
	}
	s.agentRealtimeMu.Lock()
	executor := s.agentRealtimeAI
	sessions := make([]*localAppAgentRealtimeSession, 0, len(s.agentRealtimeSessions))
	for _, session := range s.agentRealtimeSessions {
		sessions = append(sessions, session)
	}
	s.agentRealtimeSessions = make(map[string]*localAppAgentRealtimeSession)
	s.agentRealtimeMu.Unlock()
	for _, session := range sessions {
		if active := session.detachTurn(); active != nil {
			s.interruptDetachedAgentRealtimeTurn(active, "room_closed")
		}
		if executor != nil {
			_, _ = executor.CloseRuntimeAgentRealtime(context.Background(), session.accountID, &runtimev1.CloseRealtimeSessionRequest{RealtimeSessionId: session.realtimeSessionID, Generation: session.generation})
		}
	}
}

func (s *localAppAgentRealtimeSession) setControl(control *runtimev1.RealtimeControlStatus) {
	if s == nil || control == nil {
		return
	}
	s.mu.Lock()
	s.control = cloneAgentRealtimeControl(control)
	s.mu.Unlock()
}

func (s *localAppAgentRealtimeSession) detachTurn() *localAppAgentRealtimeTurn {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	active := s.turn
	s.turn = nil
	return active
}

func (s *localAppAgentRealtimeSession) hasActiveTurn() bool {
	if s == nil {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.turn != nil || s.inputFinalizing
}

func (s *localAppAgentRealtimeSession) currentControl() *runtimev1.RealtimeControlStatus {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return cloneAgentRealtimeControl(s.control)
}

func (s *localAppAgentRealtimeSession) isClosed() bool {
	if s == nil {
		return true
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.closed
}

func (s *localAppAgentRealtimeSession) acceptsAudioFrame(frame *runtimev1.LocalAppAgentRealtimeAudioFrameInput) bool {
	if s == nil || frame == nil || strings.TrimSpace(frame.GetInputTrackId()) == "" ||
		strings.TrimSpace(frame.GetUtteranceId()) == "" || frame.GetFrameSequence() == 0 {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return false
	}
	if s.turn != nil || s.inputFinalizing {
		return false
	}
	if s.inputCommitted {
		return s.inputTrackID != frame.GetInputTrackId() &&
			s.utteranceID != frame.GetUtteranceId() &&
			frame.GetFrameSequence() == 1
	}
	if s.inputFrameSequence == 0 {
		return frame.GetFrameSequence() == 1
	}
	return s.inputTrackID == frame.GetInputTrackId() &&
		s.utteranceID == frame.GetUtteranceId() &&
		frame.GetFrameSequence() == s.inputFrameSequence+1
}

func (s *localAppAgentRealtimeSession) commitAudioFrame(frame *runtimev1.LocalAppAgentRealtimeAudioFrameInput) {
	if s == nil || frame == nil {
		return
	}
	s.mu.Lock()
	if s.inputTrackID != frame.GetInputTrackId() || s.utteranceID != frame.GetUtteranceId() {
		s.inputCommitted = false
	}
	s.inputTrackID = frame.GetInputTrackId()
	s.utteranceID = frame.GetUtteranceId()
	s.inputFrameSequence = frame.GetFrameSequence()
	s.mu.Unlock()
}

func (s *localAppAgentRealtimeSession) completeDetectedInput(inputTrackID string, utteranceID string) bool {
	if s == nil {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed || s.inputFrameSequence == 0 ||
		s.inputTrackID != strings.TrimSpace(inputTrackID) ||
		s.utteranceID != strings.TrimSpace(utteranceID) {
		return false
	}
	s.inputCommitted = true
	s.inputFinalizing = true
	return true
}

func (s *localAppAgentRealtimeSession) completeTurnAdmission() {
	if s == nil {
		return
	}
	s.mu.Lock()
	s.inputFinalizing = false
	s.mu.Unlock()
}

func (s *localAppAgentRealtimeSession) commitCapture(inputTrackID string, utteranceID string) bool {
	if s == nil {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed || s.turn != nil || s.inputFinalizing || s.inputCommitted || s.inputFrameSequence == 0 ||
		s.inputTrackID != strings.TrimSpace(inputTrackID) ||
		s.utteranceID != strings.TrimSpace(utteranceID) {
		return false
	}
	s.inputCommitted = true
	return true
}

func (s *localAppAgentRealtimeSession) releaseCaptureCommit() {
	if s == nil {
		return
	}
	s.mu.Lock()
	s.inputCommitted = false
	s.mu.Unlock()
}

func (s *localAppAgentRealtimeSession) registerPrivateInputRequest(requestID string) {
	if s == nil || strings.TrimSpace(requestID) == "" {
		return
	}
	s.mu.Lock()
	if s.privateInputRequests == nil {
		s.privateInputRequests = make(map[string]struct{})
	}
	s.privateInputRequests[requestID] = struct{}{}
	s.mu.Unlock()
}

func (s *localAppAgentRealtimeSession) forgetPrivateInputRequest(requestID string) {
	if s == nil {
		return
	}
	s.mu.Lock()
	delete(s.privateInputRequests, strings.TrimSpace(requestID))
	s.mu.Unlock()
}

func (s *localAppAgentRealtimeSession) consumePrivateInputRequest(requestID string) bool {
	if s == nil {
		return false
	}
	requestID = strings.TrimSpace(requestID)
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.privateInputRequests[requestID]; !ok {
		return false
	}
	delete(s.privateInputRequests, requestID)
	return true
}

func cloneAgentRealtimeControl(control *runtimev1.RealtimeControlStatus) *runtimev1.RealtimeControlStatus {
	if control == nil {
		return nil
	}
	cloned, _ := proto.Clone(control).(*runtimev1.RealtimeControlStatus)
	if cloned != nil {
		cloned.AdapterKind = runtimev1.RealtimeAdapterKind_REALTIME_ADAPTER_KIND_LOCAL_AGENT
	}
	return cloned
}
