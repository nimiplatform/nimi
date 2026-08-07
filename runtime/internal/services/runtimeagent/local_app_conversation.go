package runtimeagent

import (
	"context"
	"crypto/subtle"
	"strings"
	"time"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

const (
	localAppConversationMaxSelectorBytes     = 256
	localAppConversationMaxRequestIDBytes    = 256
	localAppConversationMaxTextBytes         = 64 * 1024
	localAppConversationSnapshotMaxMessages  = 200
	localAppConversationSnapshotMaxTextBytes = 1024 * 1024
	localAppConversationSubscriberBuffer     = 32
	localAppConversationRevalidationInterval = 250 * time.Millisecond
)

type localAppIngressRevalidator interface {
	AuthorizeLocalAppIngress(context.Context, localappop.Ingress) (context.Context, error)
}

type localAppConversationSubscriber struct {
	accountID            string
	registeredAppSubject string
	agentID              string
	conversationAnchorID string
	events               chan localAppConversationEmission
}

type localAppConversationEmission struct {
	event *runtimev1.LocalAppConversationEvent
	err   error
}

type localAppConversationIdentity struct {
	decision accountservice.LocalAppCallerDecision
	identity localAgentIdentity
	entry    *runtimev1.LocalAgentRecord
}

func (s *Service) SetLocalAppIngressRevalidator(revalidator localAppIngressRevalidator) {
	if s != nil {
		s.localAppIngressRevalidator = revalidator
	}
}

func (s *Service) OpenLocalAppConversation(
	ctx context.Context,
	req *runtimev1.OpenLocalAppConversationRequest,
) (*runtimev1.OpenLocalAppConversationResponse, error) {
	if req == nil {
		return nil, localAppConversationInvalid("local-app conversation open request is required")
	}
	resolved, ownerCtx, err := s.resolveLocalAppConversationAgent(
		ctx,
		accountservice.LocalAppOperationOpenConversation,
		req.GetAgentHandle(),
	)
	if err != nil {
		return nil, err
	}
	ownerResponse, err := s.OpenConversationAnchor(ownerCtx, &runtimev1.OpenConversationAnchorRequest{
		AgentId: req.GetAgentHandle(),
	})
	if err != nil {
		return nil, err
	}
	snapshot := ownerResponse.GetSnapshot()
	anchorID := strings.TrimSpace(snapshot.GetAnchor().GetConversationAnchorId())
	if !validLocalAppConversationSelector(anchorID) {
		return nil, localAppConversationOwnerUnavailable()
	}
	if err := s.validateLocalAppConversationResource(resolved, anchorID); err != nil {
		return nil, err
	}
	response := &runtimev1.OpenLocalAppConversationResponse{ConversationAnchorId: anchorID}
	if activeTurnID := strings.TrimSpace(snapshot.GetActiveTurnId()); activeTurnID != "" {
		if !validLocalAppConversationSelector(activeTurnID) {
			return nil, localAppConversationOwnerUnavailable()
		}
		response.ActiveTurnId = &activeTurnID
	}
	return response, nil
}

func (s *Service) SendLocalAppConversationTurn(
	ctx context.Context,
	req *runtimev1.SendLocalAppConversationTurnRequest,
) (*runtimev1.SendLocalAppConversationTurnResponse, error) {
	if req == nil {
		return nil, localAppConversationInvalid("local-app conversation turn request is required")
	}
	anchorID := strings.TrimSpace(req.GetConversationAnchorId())
	requestID := strings.TrimSpace(req.GetRequestId())
	text := req.GetText()
	if !validLocalAppConversationSelector(anchorID) ||
		!validLocalAppConversationText(requestID, localAppConversationMaxRequestIDBytes, false) ||
		!validLocalAppConversationText(text, localAppConversationMaxTextBytes, true) {
		return nil, localAppConversationInvalid("local-app conversation turn input is invalid")
	}
	resolved, ownerCtx, err := s.resolveLocalAppConversationAgent(
		ctx,
		accountservice.LocalAppOperationSendConversationTurn,
		req.GetAgentHandle(),
	)
	if err != nil {
		return nil, err
	}
	if err := s.validateLocalAppConversationResource(resolved, anchorID); err != nil {
		return nil, err
	}
	turnID, err := s.publicChatRuntime().handleTurnRequestWithID(ownerCtx, &runtimev1.AppMessageEvent{
		FromAppId:     resolved.decision.AppID,
		SubjectUserId: resolved.decision.AccountID,
		MessageId:     requestID,
	}, publicChatTurnRequestPayload{
		LocalAgentRef:        resolved.identity.LocalAgentRef,
		OwnerUserID:          resolved.identity.OwnerUserID,
		RuntimeSourceRef:     resolved.identity.RuntimeSourceRef,
		ConversationAnchorID: anchorID,
		RequestID:            requestID,
		Messages: []publicChatMessagePayload{{
			Role:    "user",
			Content: text,
		}},
	})
	if err != nil {
		return nil, err
	}
	if !validLocalAppConversationSelector(turnID) {
		return nil, localAppConversationOwnerUnavailable()
	}
	return &runtimev1.SendLocalAppConversationTurnResponse{TurnId: turnID}, nil
}

func (s *Service) InterruptLocalAppConversationTurn(
	ctx context.Context,
	req *runtimev1.InterruptLocalAppConversationTurnRequest,
) (*runtimev1.InterruptLocalAppConversationTurnResponse, error) {
	if req == nil {
		return nil, localAppConversationInvalid("local-app conversation interrupt request is required")
	}
	anchorID := strings.TrimSpace(req.GetConversationAnchorId())
	if !validLocalAppConversationSelector(anchorID) {
		return nil, localAppConversationInvalid("local-app conversation anchor is invalid")
	}
	resolved, _, err := s.resolveLocalAppConversationAgent(
		ctx,
		accountservice.LocalAppOperationInterruptConversation,
		req.GetAgentHandle(),
	)
	if err != nil {
		return nil, err
	}
	if err := s.validateLocalAppConversationResource(resolved, anchorID); err != nil {
		return nil, err
	}
	turnID, err := s.publicChatRuntime().handleTurnInterruptWithID(&runtimev1.AppMessageEvent{
		FromAppId:     resolved.decision.AppID,
		SubjectUserId: resolved.decision.AccountID,
	}, publicChatTurnInterruptPayload{
		ConversationAnchorID: anchorID,
		Reason:               "user_cancel",
	})
	if err != nil {
		return nil, err
	}
	if !validLocalAppConversationSelector(turnID) {
		return nil, localAppConversationOwnerUnavailable()
	}
	return &runtimev1.InterruptLocalAppConversationTurnResponse{TurnId: turnID}, nil
}

func (s *Service) GetLocalAppConversationSnapshot(
	ctx context.Context,
	req *runtimev1.GetLocalAppConversationSnapshotRequest,
) (*runtimev1.GetLocalAppConversationSnapshotResponse, error) {
	if req == nil {
		return nil, localAppConversationInvalid("local-app conversation snapshot request is required")
	}
	anchorID := strings.TrimSpace(req.GetConversationAnchorId())
	if !validLocalAppConversationSelector(anchorID) {
		return nil, localAppConversationInvalid("local-app conversation anchor is invalid")
	}
	resolved, _, err := s.resolveLocalAppConversationAgent(
		ctx,
		accountservice.LocalAppOperationConversationSnapshot,
		req.GetAgentHandle(),
	)
	if err != nil {
		return nil, err
	}
	snapshot, err := s.buildLocalAppConversationSnapshot(resolved, anchorID)
	if err != nil {
		return nil, err
	}
	return &runtimev1.GetLocalAppConversationSnapshotResponse{Snapshot: snapshot}, nil
}

func (s *Service) SubscribeLocalAppConversationEvents(
	req *runtimev1.SubscribeLocalAppConversationEventsRequest,
	stream runtimev1.RuntimeAgentService_SubscribeLocalAppConversationEventsServer,
) error {
	if req == nil || stream == nil {
		return localAppConversationInvalid("local-app conversation subscription request is required")
	}
	anchorID := strings.TrimSpace(req.GetConversationAnchorId())
	if !validLocalAppConversationSelector(anchorID) {
		return localAppConversationInvalid("local-app conversation anchor is invalid")
	}
	resolved, _, err := s.resolveLocalAppConversationAgent(
		stream.Context(),
		accountservice.LocalAppOperationSubscribeConversation,
		req.GetAgentHandle(),
	)
	if err != nil {
		return err
	}
	if err := s.validateLocalAppConversationResource(resolved, anchorID); err != nil {
		return err
	}
	if s.localAppIngressRevalidator == nil {
		return localAppConversationOwnerUnavailable()
	}
	subscriberID, events := s.addLocalAppConversationSubscriber(localAppConversationSubscriber{
		accountID:            resolved.decision.AccountID,
		registeredAppSubject: resolved.decision.RegisteredAppSubject,
		agentID:              resolved.identity.LocalAgentRef,
		conversationAnchorID: anchorID,
	})
	defer s.removeLocalAppConversationSubscriber(subscriberID)

	// The streaming client treats response headers as the subscription-established
	// signal; without an explicit flush gRPC defers headers until the first event
	// and an idle conversation blocks the subscriber indefinitely.
	if err := stream.SendHeader(metadata.MD{}); err != nil {
		return err
	}

	ticker := time.NewTicker(localAppConversationRevalidationInterval)
	defer ticker.Stop()
	for {
		select {
		case <-stream.Context().Done():
			return nil
		case <-ticker.C:
			if err := s.revalidateLocalAppConversationSubscription(stream.Context(), req, resolved); err != nil {
				return err
			}
		case emitted := <-events:
			if emitted.err != nil {
				return emitted.err
			}
			if emitted.event == nil {
				return localAppConversationOwnerUnavailable()
			}
			if err := s.revalidateLocalAppConversationSubscription(stream.Context(), req, resolved); err != nil {
				return err
			}
			if err := stream.Send(proto.Clone(emitted.event).(*runtimev1.LocalAppConversationEvent)); err != nil {
				return err
			}
		}
	}
}

func (s *Service) resolveLocalAppConversationAgent(
	ctx context.Context,
	operation accountservice.LocalAppOperation,
	agentHandle string,
) (localAppConversationIdentity, context.Context, error) {
	decision, ok := authorizedLocalAppAgentDecision(ctx, operation)
	if !ok || decision.OperationCapability != "agent.local" ||
		!validLocalAppAgentHandle(agentHandle) {
		return localAppConversationIdentity{}, nil, localAppAgentAccessDenied()
	}

	s.mu.RLock()
	var selected *runtimev1.LocalAgentRecord
	matches := 0
	for _, candidate := range s.agents {
		if candidate == nil || candidate.Agent == nil ||
			candidate.Agent.GetLifecycleStatus() != runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE ||
			strings.TrimSpace(candidate.Agent.GetOwnerUserId()) != decision.AccountID {
			continue
		}
		localAgentID := strings.TrimSpace(candidate.Agent.GetLocalAgentRef())
		if localAgentID == "" {
			continue
		}
		expected := mintLocalAppAgentHandle(decision, localAgentID)
		if len(expected) == len(agentHandle) && subtle.ConstantTimeCompare([]byte(expected), []byte(agentHandle)) == 1 {
			selected = proto.Clone(candidate.Agent).(*runtimev1.LocalAgentRecord)
			matches++
		}
	}
	s.mu.RUnlock()
	if matches != 1 || selected == nil {
		return localAppConversationIdentity{}, nil, localAppAgentAccessDenied()
	}
	identity, err := validateLocalAgentIdentity(
		selected.GetOwnerUserId(),
		selected.GetRuntimeSourceRef(),
		selected.GetLocalAgentRef(),
	)
	if err != nil || identity.OwnerUserID != decision.AccountID {
		return localAppConversationIdentity{}, nil, localAppAgentAccessDenied()
	}
	decision.LocalAgentID = identity.LocalAgentRef
	ownerCtx := accountservice.ContextWithAuthorizedLocalAppDecision(ctx, decision)
	return localAppConversationIdentity{decision: decision, identity: identity, entry: selected}, ownerCtx, nil
}

func (s *Service) validateLocalAppConversationResource(
	resolved localAppConversationIdentity,
	anchorID string,
) error {
	if s == nil || resolved.entry == nil ||
		resolved.entry.GetLifecycleStatus() != runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE ||
		resolved.identity.OwnerUserID != resolved.decision.AccountID ||
		!validLocalAppConversationSelector(anchorID) {
		return localAppAgentAccessDenied()
	}
	s.chatSurfaceMu.Lock()
	anchor := s.chatAnchors[anchorID]
	valid := anchor != nil && conversationAnchorIsResumable(anchor.Status) &&
		anchor.AgentID == resolved.identity.LocalAgentRef &&
		anchor.LocalAgentRef == resolved.identity.LocalAgentRef &&
		anchor.OwnerUserID == resolved.identity.OwnerUserID &&
		anchor.SubjectUserID == resolved.decision.AccountID &&
		anchor.RuntimeSourceRef == resolved.identity.RuntimeSourceRef
	s.chatSurfaceMu.Unlock()
	if !valid {
		return status.Error(codes.NotFound, "local-app conversation resource not found")
	}
	return nil
}

func (s *Service) buildLocalAppConversationSnapshot(
	resolved localAppConversationIdentity,
	anchorID string,
) (*runtimev1.LocalAppConversationSnapshot, error) {
	if err := s.validateLocalAppConversationResource(resolved, anchorID); err != nil {
		return nil, err
	}
	s.chatSurfaceMu.Lock()
	anchor := s.chatAnchors[anchorID]
	transcript := clonePublicChatCommittedTranscript(anchor.CommittedTranscript)
	activeTurnID := strings.TrimSpace(anchor.ActiveTurnID)
	s.chatSurfaceMu.Unlock()
	if err := validatePublicChatCommittedTranscript(transcript); err != nil {
		return nil, localAppConversationOwnerUnavailable()
	}

	type messageGroup struct {
		messages []*runtimev1.LocalAppConversationMessage
		bytes    int
	}
	groups := make([]messageGroup, 0, len(transcript))
	for _, turn := range transcript {
		if turn.Origin != publicChatTurnOriginUser || !validLocalAppConversationSelector(turn.TurnID) {
			continue
		}
		group := messageGroup{}
		if turn.InputText != "" {
			if !validLocalAppConversationText(turn.InputText, localAppConversationMaxTextBytes, false) {
				return nil, localAppConversationOwnerUnavailable()
			}
			group.messages = append(group.messages, &runtimev1.LocalAppConversationMessage{
				TurnId: turn.TurnID,
				Role:   runtimev1.LocalAppConversationMessageRole_LOCAL_APP_CONVERSATION_MESSAGE_ROLE_USER,
				Text:   turn.InputText,
			})
			group.bytes += len(turn.InputText)
		}
		if !validLocalAppConversationText(turn.AssistantText, localAppConversationMaxTextBytes, true) {
			return nil, localAppConversationOwnerUnavailable()
		}
		group.messages = append(group.messages, &runtimev1.LocalAppConversationMessage{
			TurnId: turn.TurnID,
			Role:   runtimev1.LocalAppConversationMessageRole_LOCAL_APP_CONVERSATION_MESSAGE_ROLE_ASSISTANT,
			Text:   turn.AssistantText,
		})
		group.bytes += len(turn.AssistantText)
		groups = append(groups, group)
	}

	start := len(groups)
	messageCount := 0
	textBytes := 0
	for start > 0 {
		candidate := groups[start-1]
		if messageCount+len(candidate.messages) > localAppConversationSnapshotMaxMessages ||
			textBytes+candidate.bytes > localAppConversationSnapshotMaxTextBytes {
			break
		}
		start--
		messageCount += len(candidate.messages)
		textBytes += candidate.bytes
	}
	messages := make([]*runtimev1.LocalAppConversationMessage, 0, messageCount)
	for _, group := range groups[start:] {
		messages = append(messages, group.messages...)
	}
	snapshot := &runtimev1.LocalAppConversationSnapshot{
		ConversationAnchorId: anchorID,
		Messages:             messages,
		TruncatedBefore:      start > 0,
	}
	if activeTurnID != "" {
		if !validLocalAppConversationSelector(activeTurnID) {
			return nil, localAppConversationOwnerUnavailable()
		}
		snapshot.ActiveTurnId = &activeTurnID
	}
	return snapshot, nil
}

func (s *Service) revalidateLocalAppConversationSubscription(
	ctx context.Context,
	req *runtimev1.SubscribeLocalAppConversationEventsRequest,
	initial localAppConversationIdentity,
) error {
	ownerCtx, err := s.localAppIngressRevalidator.AuthorizeLocalAppIngress(
		ctx,
		localappop.IngressConversationEventsSubscribe,
	)
	if err != nil {
		return err
	}
	current, _, err := s.resolveLocalAppConversationAgent(
		ownerCtx,
		accountservice.LocalAppOperationSubscribeConversation,
		req.GetAgentHandle(),
	)
	if err != nil {
		return err
	}
	if current.decision.SessionID != initial.decision.SessionID ||
		current.decision.AccountID != initial.decision.AccountID ||
		current.decision.RegisteredAppSubject != initial.decision.RegisteredAppSubject ||
		current.identity.LocalAgentRef != initial.identity.LocalAgentRef {
		return localAppAgentAccessDenied()
	}
	return s.validateLocalAppConversationResource(current, req.GetConversationAnchorId())
}

func (s *Service) addLocalAppConversationSubscriber(
	input localAppConversationSubscriber,
) (uint64, <-chan localAppConversationEmission) {
	s.localAppConversationMu.Lock()
	defer s.localAppConversationMu.Unlock()
	s.localAppConversationNextSubscriberID++
	input.events = make(chan localAppConversationEmission, localAppConversationSubscriberBuffer)
	s.localAppConversationSubscribers[s.localAppConversationNextSubscriberID] = &input
	return s.localAppConversationNextSubscriberID, input.events
}

func (s *Service) removeLocalAppConversationSubscriber(id uint64) {
	s.localAppConversationMu.Lock()
	delete(s.localAppConversationSubscribers, id)
	s.localAppConversationMu.Unlock()
}

func (s *Service) failLocalAppConversationSubscribers(err error) {
	if s == nil || err == nil {
		return
	}
	s.localAppConversationMu.Lock()
	subscribers := make([]*localAppConversationSubscriber, 0, len(s.localAppConversationSubscribers))
	for _, subscriber := range s.localAppConversationSubscribers {
		if subscriber != nil {
			subscribers = append(subscribers, subscriber)
		}
	}
	s.localAppConversationMu.Unlock()
	for _, subscriber := range subscribers {
		select {
		case subscriber.events <- localAppConversationEmission{err: err}:
		default:
		}
	}
}

func (s *Service) publishLocalAppConversationEvent(
	subjectUserID string,
	messageType string,
	payload map[string]any,
) {
	event, supported, err := projectLocalAppConversationEvent(messageType, payload)
	if !supported {
		return
	}
	anchorID := ""
	if event != nil {
		anchorID = event.GetConversationAnchorId()
	}
	s.localAppConversationMu.Lock()
	subscribers := make([]*localAppConversationSubscriber, 0, len(s.localAppConversationSubscribers))
	for _, subscriber := range s.localAppConversationSubscribers {
		if subscriber != nil && subscriber.accountID == strings.TrimSpace(subjectUserID) &&
			(subscriber.conversationAnchorID == anchorID || (err != nil && anchorID == "")) {
			subscribers = append(subscribers, subscriber)
		}
	}
	s.localAppConversationMu.Unlock()
	for _, subscriber := range subscribers {
		emission := localAppConversationEmission{event: event, err: err}
		select {
		case subscriber.events <- emission:
		default:
			select {
			case <-subscriber.events:
			default:
			}
			select {
			case subscriber.events <- localAppConversationEmission{err: grpcerr.WithReasonCode(
				codes.ResourceExhausted,
				runtimev1.ReasonCode_LOCAL_APP_OWNER_UNAVAILABLE,
			)}:
			default:
			}
		}
	}
}

func projectLocalAppConversationEvent(
	messageType string,
	payload map[string]any,
) (*runtimev1.LocalAppConversationEvent, bool, error) {
	supported := false
	switch strings.TrimSpace(messageType) {
	case publicChatTurnAcceptedType, publicChatTurnStartedType, publicChatTurnTextDeltaType,
		publicChatTurnMessageCommittedType, publicChatTurnCompletedType,
		publicChatTurnFailedType, publicChatTurnInterruptedType:
		supported = true
	}
	if !supported {
		return nil, false, nil
	}
	anchorID, anchorOK := localAppConversationMapString(payload, "conversation_anchor_id", false)
	turnID, turnOK := localAppConversationMapString(payload, "turn_id", false)
	detail, detailOK := payload["detail"].(map[string]any)
	timeline, timelineOK := payload["timeline"].(map[string]any)
	sequence, sequenceOK := localAppConversationSequence(timeline["sequence"])
	if !anchorOK || !turnOK || !detailOK || !timelineOK || !sequenceOK ||
		!validLocalAppConversationSelector(anchorID) || !validLocalAppConversationSelector(turnID) {
		return nil, true, localAppConversationOwnerUnavailable()
	}
	event := &runtimev1.LocalAppConversationEvent{
		ConversationAnchorId: anchorID,
		Sequence:             sequence,
	}
	switch strings.TrimSpace(messageType) {
	case publicChatTurnAcceptedType:
		requestID, ok := localAppConversationMapString(detail, "request_id", false)
		if !ok || !validLocalAppConversationText(requestID, localAppConversationMaxRequestIDBytes, false) {
			return nil, true, localAppConversationOwnerUnavailable()
		}
		event.Event = &runtimev1.LocalAppConversationEvent_TurnAccepted{TurnAccepted: &runtimev1.LocalAppConversationTurnAccepted{
			TurnId: turnID, RequestId: requestID,
		}}
	case publicChatTurnStartedType:
		event.Event = &runtimev1.LocalAppConversationEvent_TurnStarted{TurnStarted: &runtimev1.LocalAppConversationTurnStarted{TurnId: turnID}}
	case publicChatTurnTextDeltaType:
		text, ok := localAppConversationMapString(detail, "text", true)
		if !ok || !validLocalAppConversationText(text, localAppConversationMaxTextBytes, true) {
			return nil, true, localAppConversationOwnerUnavailable()
		}
		event.Event = &runtimev1.LocalAppConversationEvent_TextDelta{TextDelta: &runtimev1.LocalAppConversationTextDelta{TurnId: turnID, Text: text}}
	case publicChatTurnMessageCommittedType:
		messageID, messageOK := localAppConversationMapString(detail, "message_id", false)
		text, textOK := localAppConversationMapString(detail, "text", true)
		if !messageOK || !textOK || !validLocalAppConversationSelector(messageID) ||
			!validLocalAppConversationText(text, localAppConversationMaxTextBytes, true) {
			return nil, true, localAppConversationOwnerUnavailable()
		}
		event.Event = &runtimev1.LocalAppConversationEvent_MessageCommitted{MessageCommitted: &runtimev1.LocalAppConversationMessageCommitted{
			TurnId: turnID, MessageId: messageID, Text: text,
		}}
	case publicChatTurnCompletedType:
		reason, ok := localAppConversationMapString(detail, "terminal_reason", true)
		if !ok || !validLocalAppConversationTerminalReason(reason) {
			return nil, true, localAppConversationOwnerUnavailable()
		}
		event.Event = &runtimev1.LocalAppConversationEvent_TurnCompleted{TurnCompleted: &runtimev1.LocalAppConversationTurnCompleted{
			TurnId: turnID, TerminalReason: reason,
		}}
	case publicChatTurnFailedType:
		reasonCode, ok := localAppConversationMapString(detail, "reason_code", false)
		if !ok || !validLocalAppConversationReasonCode(reasonCode) {
			return nil, true, localAppConversationOwnerUnavailable()
		}
		failed := &runtimev1.LocalAppConversationTurnFailed{TurnId: turnID, ReasonCode: reasonCode}
		if message, present := detail["message"]; present {
			value, ok := message.(string)
			if !ok || !validLocalAppConversationText(value, 1024, true) {
				return nil, true, localAppConversationOwnerUnavailable()
			}
			failed.Message = &value
		}
		event.Event = &runtimev1.LocalAppConversationEvent_TurnFailed{TurnFailed: failed}
	case publicChatTurnInterruptedType:
		reason, ok := localAppConversationMapString(detail, "reason", false)
		if !ok || !validLocalAppConversationInterruptReason(reason) {
			return nil, true, localAppConversationOwnerUnavailable()
		}
		event.Event = &runtimev1.LocalAppConversationEvent_TurnInterrupted{TurnInterrupted: &runtimev1.LocalAppConversationTurnInterrupted{
			TurnId: turnID, Reason: reason,
		}}
	}
	return event, true, nil
}

func validLocalAppAgentHandle(value string) bool {
	if len(value) != len(localAppAgentHandlePrefix)+43 || !strings.HasPrefix(value, localAppAgentHandlePrefix) {
		return false
	}
	for _, value := range value[len(localAppAgentHandlePrefix):] {
		if !((value >= 'a' && value <= 'z') || (value >= 'A' && value <= 'Z') ||
			(value >= '0' && value <= '9') || value == '-' || value == '_') {
			return false
		}
	}
	return true
}

func validLocalAppConversationSelector(value string) bool {
	return value != "" && value == strings.TrimSpace(value) &&
		len(value) <= localAppConversationMaxSelectorBytes && utf8.ValidString(value) &&
		!strings.ContainsAny(value, "\x00\r\n")
}

func validLocalAppConversationText(value string, maxBytes int, allowOuterWhitespace bool) bool {
	if value == "" || len(value) > maxBytes || !utf8.ValidString(value) || strings.ContainsRune(value, '\x00') {
		return false
	}
	if !allowOuterWhitespace && value != strings.TrimSpace(value) {
		return false
	}
	return strings.TrimSpace(value) != ""
}

func validLocalAppConversationTerminalReason(value string) bool {
	switch value {
	case "", "stop", "length", "tool_call", "content_filter", "error", "unspecified":
		return true
	default:
		return false
	}
}

func validLocalAppConversationInterruptReason(value string) bool {
	switch value {
	case "user_cancel", "room_closed", "superseded_turn", "budget_exhausted", "timeout", "gateway_revoked", "policy_refusal":
		return true
	default:
		return false
	}
}

func validLocalAppConversationReasonCode(value string) bool {
	if value == "" || len(value) > 128 || value != strings.TrimSpace(value) {
		return false
	}
	for _, value := range value {
		if !((value >= 'A' && value <= 'Z') || (value >= '0' && value <= '9') || value == '_' || value == '-') {
			return false
		}
	}
	return true
}

func localAppConversationMapString(input map[string]any, key string, optional bool) (string, bool) {
	value, present := input[key]
	if !present {
		return "", optional
	}
	text, ok := value.(string)
	return text, ok
}

func localAppConversationSequence(value any) (uint64, bool) {
	switch typed := value.(type) {
	case uint64:
		return typed, typed > 0
	case int64:
		return uint64(typed), typed > 0
	case int:
		return uint64(typed), typed > 0
	case float64:
		converted := uint64(typed)
		return converted, typed > 0 && float64(converted) == typed
	default:
		return 0, false
	}
}

func localAppConversationInvalid(message string) error {
	return grpcerr.WrapWithReasonCode(
		codes.InvalidArgument,
		runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID,
		status.Error(codes.InvalidArgument, message),
		grpcerr.ReasonOptions{Message: message},
	)
}

func localAppConversationOwnerUnavailable() error {
	return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_LOCAL_APP_OWNER_UNAVAILABLE)
}
