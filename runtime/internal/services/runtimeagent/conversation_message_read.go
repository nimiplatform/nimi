package runtimeagent

import (
	"context"
	"sort"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
)

type conversationMessageLocation struct {
	turnID string
	index  int
}
type conversationMessageLookup struct {
	byMessage       map[string]conversationMessageLocation
	byTurn          map[string]int
	turnOrder       []string
	turnPosition    map[string]int
	transcriptCount int
	recoveryCount   int
}

// A disposable owner index over the existing transcript/recoveries, never a second store.
func conversationLookupLocked(anchor *publicChatAnchorState) *conversationMessageLookup {
	lookup := anchor.messageLookup
	initial := lookup == nil
	if lookup == nil {
		lookup = &conversationMessageLookup{byMessage: map[string]conversationMessageLocation{}, byTurn: map[string]int{}, turnPosition: map[string]int{}}
		anchor.messageLookup = lookup
	}
	for i := lookup.transcriptCount; i < len(anchor.CommittedTranscript); i++ {
		turn := anchor.CommittedTranscript[i]
		lookup.byTurn[turn.TurnID] = i
		indexConversationTurnOrder(lookup, turn.TurnID)
		userID := localAppConversationMessageID(firstNonEmpty(turn.InputTurnID, turn.TurnID), "user", "")
		if old, ok := lookup.byMessage[userID]; !ok || old.index < 0 {
			lookup.byMessage[userID] = conversationMessageLocation{firstNonEmpty(turn.InputTurnID, turn.TurnID), i}
		}
		lookup.byMessage[localAppConversationMessageID(turn.TurnID, "assistant", "")] = conversationMessageLocation{turn.TurnID, i}
		for _, artifact := range turn.OutputArtifacts {
			lookup.byMessage[localAppConversationMessageID(turn.TurnID, "image", artifact.ArtifactID)] = conversationMessageLocation{turn.TurnID, i}
		}
	}
	lookup.transcriptCount = len(anchor.CommittedTranscript)
	if lookup.recoveryCount != len(anchor.Recoveries) {
		for id, recovery := range anchor.Recoveries {
			indexConversationRecovery(lookup, id, recovery)
		}
		lookup.recoveryCount = len(anchor.Recoveries)
	}
	if initial {
		order := func(id string) time.Time {
			if item := anchor.Recoveries[id]; item != nil {
				return item.AcceptedAt
			}
			if i, ok := lookup.byTurn[id]; ok {
				return anchor.CommittedTranscript[i].CommittedAt
			}
			return time.Time{}
		}
		sort.SliceStable(lookup.turnOrder, func(i, j int) bool {
			left, right := order(lookup.turnOrder[i]), order(lookup.turnOrder[j])
			if left.Equal(right) {
				return lookup.turnOrder[i] < lookup.turnOrder[j]
			}
			return left.Before(right)
		})
		for i, id := range lookup.turnOrder {
			lookup.turnPosition[id] = i
		}
	}
	return lookup
}

func indexConversationTurnOrder(lookup *conversationMessageLookup, id string) {
	if _, ok := lookup.turnPosition[id]; ok {
		return
	}
	lookup.turnPosition[id] = len(lookup.turnOrder)
	lookup.turnOrder = append(lookup.turnOrder, id)
}

func indexConversationRecovery(lookup *conversationMessageLookup, id string, recovery *publicChatTurnRecovery) {
	indexConversationTurnOrder(lookup, id)
	userID := localAppConversationMessageID(recovery.InputTurnID, "user", "")
	if _, ok := lookup.byMessage[userID]; !ok {
		lookup.byMessage[userID] = conversationMessageLocation{recovery.InputTurnID, -1}
	}
	assistantID := localAppConversationMessageID(id, "assistant", "")
	if _, ok := lookup.byMessage[assistantID]; !ok {
		lookup.byMessage[assistantID] = conversationMessageLocation{id, -1}
	}
}

func conversationTurnProjectionLocked(anchor *publicChatAnchorState, turnID string) *publicChatTurnProjectionState {
	if active := anchor.ActiveTurnSnapshot; active != nil && active.TurnID == turnID {
		return active
	}
	return anchor.CompletedTurnSnapshots[turnID]
}

func conversationMessageLocked(anchor *publicChatAnchorState, id string) (*runtimev1.LocalAppConversationMessage, bool) {
	location, ok := conversationLookupLocked(anchor).byMessage[id]
	if !ok {
		return nil, false
	}
	if location.index >= 0 {
		turn := anchor.CommittedTranscript[location.index]
		if user := localAppConversationUserMessage(turn); (turn.Origin == publicChatTurnOriginUser || turn.Origin == publicChatTurnOriginApp) && user != nil && user.MessageId == id {
			return user, conversationMessageBody(user) != ""
		}
		if strings.TrimSpace(turn.AssistantText) != "" && localAppConversationMessageID(turn.TurnID, "assistant", "") == id {
			return localAppConversationTextMessage(turn.TurnID, runtimev1.LocalAppConversationMessageRole_LOCAL_APP_CONVERSATION_MESSAGE_ROLE_ASSISTANT, turn.AssistantText), true
		}
		for _, artifact := range turn.OutputArtifacts {
			if message := localAppConversationArtifactMessage(turn.TurnID, artifact); message.MessageId == id {
				return message, false
			}
		}
	}
	item := anchor.Recoveries[location.turnID]
	if item != nil {
		if input := publicChatRecoveryInputForTurn(anchor, item); input != nil && input.Role == "user" {
			message := localAppConversationUserMessage(publicChatCommittedTranscriptTurn{TurnID: item.InputTurnID, Origin: publicChatTurnOriginUser, InputText: input.Text, InputAttachment: input.Attachment, InputQuote: input.Quote})
			if message != nil && message.MessageId == id {
				return message, conversationMessageBody(message) != ""
			}
		}
		projection := conversationTurnProjectionLocked(anchor, location.turnID)
		if item.PublicText != "" && projection != nil && publicChatTurnProjectionIsTerminal(projection) && localAppConversationMessageID(item.TurnID, "assistant", "") == id {
			return localAppConversationPartialMessage(item), true
		}
	}
	return nil, false
}

// @nimi-authority: rule.nimi.runtime.conversation-message-interaction.message-read
func (s *Service) ReadLocalAppConversationMessage(ctx context.Context, req *runtimev1.ReadLocalAppConversationMessageRequest) (*runtimev1.ReadLocalAppConversationMessageResponse, error) {
	if req == nil || len(req.ProtoReflect().GetUnknown()) != 0 || !validLocalAppConversationSelector(req.ConversationAnchorId) || !validLocalAppConversationSelector(req.MessageId) {
		return nil, localAppConversationInvalid("conversation message read input is invalid")
	}
	resolved, _, err := s.resolveLocalAppAgent(ctx, accountservice.LocalAppOperationConversationMessageRead, req.AgentHandle)
	if err != nil {
		return nil, err
	}
	if err := s.validateLocalAppConversationResource(resolved, req.ConversationAnchorId); err != nil {
		return nil, err
	}
	s.chatSurfaceMu.Lock()
	anchor := s.chatAnchors[req.ConversationAnchorId]
	if anchor == nil || s.agentTerminationFencedLocked(resolved.identity.LocalAgentRef) {
		s.chatSurfaceMu.Unlock()
		return nil, localAppConversationOwnerUnavailable()
	}
	message, quotable := conversationMessageLocked(anchor, req.MessageId)
	if message == nil {
		s.chatSurfaceMu.Unlock()
		return nil, localAppConversationInvalid("conversation message is unavailable")
	}
	window, err := s.conversationMessageWindowLocked(anchor, req.MessageId, resolved.decision.RegisteredAppSubject)
	watermark := anchor.LocalAppSequence
	s.chatSurfaceMu.Unlock()
	if err != nil {
		return nil, err
	}
	result := &runtimev1.ReadLocalAppConversationMessageResponse{ConversationAnchorId: req.ConversationAnchorId, ReadWatermark: watermark, Message: message, Window: window}
	if quotable {
		value, deriveErr := conversationQuoteText(conversationMessageBody(message))
		if deriveErr != nil {
			return nil, deriveErr
		}
		if strings.TrimSpace(value) != "" {
			format := conversationQuoteFormat
			result.QuoteText = &value
			result.QuoteFormat = &format
		}
	}
	if s.localAppIngressRevalidator == nil {
		return nil, localAppConversationOwnerUnavailable()
	}
	currentCtx, err := s.localAppIngressRevalidator.AuthorizeLocalAppIngress(ctx, localappop.IngressConversationMessageRead)
	if err != nil {
		return nil, err
	}
	current, _, err := s.resolveLocalAppAgent(currentCtx, accountservice.LocalAppOperationConversationMessageRead, req.AgentHandle)
	if err != nil {
		return nil, err
	}
	if current.decision.SessionID != resolved.decision.SessionID || current.decision.AccountID != resolved.decision.AccountID || current.decision.RegisteredAppSubject != resolved.decision.RegisteredAppSubject || current.identity.LocalAgentRef != resolved.identity.LocalAgentRef {
		return nil, localAppAgentAccessDenied()
	}
	if err := s.validateLocalAppConversationResource(current, req.ConversationAnchorId); err != nil {
		return nil, err
	}
	return result, nil
}

func (s *Service) conversationReadTurnLocked(anchor *publicChatAnchorState, turnID, appSubject string) *runtimev1.LocalAppConversationMessageWindow {
	window := &runtimev1.LocalAppConversationMessageWindow{}
	lookup := conversationLookupLocked(anchor)
	projection := conversationTurnProjectionLocked(anchor, turnID)
	if live := s.chatTurns[turnID]; live != nil && live.ConversationAnchorID == anchor.ConversationAnchorID {
		projection = live.Projection
	}
	if i, ok := lookup.byTurn[turnID]; ok {
		turn := anchor.CommittedTranscript[i]
		if projection == nil {
			projection = &publicChatTurnProjectionState{TurnID: turnID, Origin: turn.Origin, Status: publicChatTurnStatusCompleted}
		}
		if turn.Origin == publicChatTurnOriginUser || turn.Origin == publicChatTurnOriginApp {
			if message := localAppConversationUserMessage(turn); message != nil {
				window.Messages = append(window.Messages, message)
			}
		}
		if turn.AssistantText != "" {
			window.Messages = append(window.Messages, localAppConversationTextMessage(turnID, runtimev1.LocalAppConversationMessageRole_LOCAL_APP_CONVERSATION_MESSAGE_ROLE_ASSISTANT, turn.AssistantText))
		}
		for _, artifact := range turn.OutputArtifacts {
			message := localAppConversationArtifactMessage(turnID, artifact)
			window.Messages = append(window.Messages, message)
			window.Actions = append(window.Actions, localAppConversationCompletedAction(turnID, projection, message, artifact))
		}
	}
	if item := anchor.Recoveries[turnID]; item != nil {
		if projection == nil {
			projection = &publicChatTurnProjectionState{TurnID: turnID, Origin: "user", Status: publicChatTurnStatusInterrupted}
		}
		if len(window.Messages) == 0 {
			if input := publicChatRecoveryInputForTurn(anchor, item); input != nil && input.Role == "user" {
				window.Messages = append(window.Messages, localAppConversationUserMessage(publicChatCommittedTranscriptTurn{TurnID: item.InputTurnID, Origin: publicChatTurnOriginUser, InputText: input.Text, InputAttachment: input.Attachment, InputQuote: input.Quote}))
			}
		}
		if item.PublicText != "" && publicChatTurnProjectionIsTerminal(projection) {
			window.Messages = append(window.Messages, localAppConversationPartialMessage(item))
		}
	}
	active := projection != nil && !publicChatTurnProjectionIsTerminal(projection)
	projected := localAppConversationTurnFromProjection(turnID, projection, active)
	if recovery := anchor.Recoveries[turnID]; recovery != nil {
		if recovery.RegisteredAppSubject == appSubject && recovery.RequestID != "" {
			requestID := recovery.RequestID
			projected.RequestId = &requestID
		}
		if recovery.RetryOfTurnID != "" {
			retry := recovery.RetryOfTurnID
			projected.RetryOfTurnId = &retry
		}
		inputID := recovery.InputTurnID
		projected.InputTurnId = &inputID
		projected.CanRegenerate = publicChatCanRegenerate(anchor, turnID)
	}
	window.Turns = append(window.Turns, projected)
	for _, message := range window.Messages {
		if message != nil && message.TurnId != turnID {
			window.Turns = append(window.Turns, localAppConversationTurnFromProjection(message.TurnId, conversationTurnProjectionLocked(anchor, message.TurnId), false))
		}
	}
	if len(window.Actions) == 0 {
		if action := localAppConversationNonCompletedAction(turnID, projection); action != nil {
			window.Actions = append(window.Actions, action)
		}
	}
	if voice := localAppConversationVoiceFromState(anchor.VoiceSidecars[turnID]); voice != nil {
		window.Voices = append(window.Voices, voice)
	}
	return window
}

func (s *Service) conversationMessageWindowLocked(anchor *publicChatAnchorState, messageID, appSubject string) (*runtimev1.LocalAppConversationMessageWindow, error) {
	lookup := conversationLookupLocked(anchor)
	target := lookup.byMessage[messageID]
	// The owner index includes failed attempts as well as completed turns;
	// navigation never erases failed attempts between two successful messages.
	position := lookup.turnPosition[target.turnID]
	selected := []string{target.turnID}
	for distance := 1; distance <= 2; distance++ {
		if i := position - distance; i >= 0 {
			selected = append(selected, lookup.turnOrder[i])
		}
		i := position + distance
		if i < len(lookup.turnOrder) {
			selected = append(selected, lookup.turnOrder[i])
		}
	}
	result := &runtimev1.LocalAppConversationMessageWindow{TruncatedBefore: position > 2, TruncatedAfter: position+3 < len(lookup.turnOrder)}
	total := 0
	messageCount, turnCount, actionCount, voiceCount := 0, 0, 0, 0
	accepted := make(map[string]bool)
	for _, id := range selected {
		group := s.conversationReadTurnLocked(anchor, id, appSubject)
		size := 0
		for _, message := range group.Messages {
			size += conversationMessageContentBytes(message)
		}
		if total+size > conversationReadWindowMaxBytes || messageCount+len(group.Messages) > 15 || turnCount+len(group.Turns) > 10 || actionCount+len(group.Actions) > 5 || voiceCount+len(group.Voices) > 5 {
			if id == target.turnID {
				return nil, localAppConversationInvalid("target turn closure exceeds message-read bounds")
			}
			result.TruncatedBefore = true
			result.TruncatedAfter = true
			continue
		}
		total += size
		accepted[id] = true
		messageCount += len(group.Messages)
		turnCount += len(group.Turns)
		actionCount += len(group.Actions)
		voiceCount += len(group.Voices)
	}
	// Emit in chronology rather than the target-first budget admission order.
	sort.SliceStable(selected, func(i, j int) bool {
		return lookup.turnPosition[selected[i]] < lookup.turnPosition[selected[j]]
	})
	seenMessages, seenTurns := map[string]bool{}, map[string]bool{}
	for _, id := range selected {
		if !accepted[id] {
			continue
		}
		group := s.conversationReadTurnLocked(anchor, id, appSubject)
		for _, message := range group.Messages {
			if message != nil && !seenMessages[message.MessageId] {
				result.Messages = append(result.Messages, message)
				seenMessages[message.MessageId] = true
			}
		}
		for _, turn := range group.Turns {
			if !seenTurns[turn.TurnId] {
				result.Turns = append(result.Turns, turn)
				seenTurns[turn.TurnId] = true
			}
		}
		result.Actions = append(result.Actions, group.Actions...)
		result.Voices = append(result.Voices, group.Voices...)
	}
	if !seenMessages[messageID] {
		return nil, localAppConversationOwnerUnavailable()
	}
	return result, nil
}
