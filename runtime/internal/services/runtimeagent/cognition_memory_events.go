package runtimeagent

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/services/cognitionmemory"
	"github.com/oklog/ulid/v2"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *Service) cognitionMemoryTranscriptTxHook(
	session *publicChatAnchorState,
	committedTurnID string,
	origin string,
	inputText string,
	inputAttachment *publicChatCommittedTranscriptAttachment,
	assistantText string,
) (runtimeAgentStateTxHook, bool, error) {
	if s == nil || s.cognitionMemoryStore == nil || session == nil {
		return nil, false, nil
	}
	binding, err := s.cognitionMemoryStore.BindingForAgent(context.Background(), session.LocalAgentRef)
	if err != nil {
		return nil, false, fmt.Errorf("prepare Cognition Memory outbox: %w", err)
	}
	if !binding.Enabled || binding.AdoptionRequired {
		return nil, false, nil
	}
	committedAt := time.Now().UTC()
	turnSource := &runtimev1.CognitionMemorySourceRef{Kind: "conversation_turn", Value: committedTurnID}
	conversationSource := &runtimev1.CognitionMemorySourceRef{Kind: "conversation", Value: session.ConversationAnchorID}
	userEvent := cognitionMemoryMessageEnvelope(binding, committedAt, turnSource, conversationSource, origin, inputText, inputAttachment, true)
	assistantEvent := cognitionMemoryMessageEnvelope(binding, committedAt, turnSource, conversationSource, origin, assistantText, nil, false)
	return func(tx *sql.Tx) error {
		for _, envelope := range []*runtimev1.CognitionMemoryCommittedEventEnvelope{userEvent, assistantEvent} {
			if _, err := s.cognitionMemoryStore.EnqueueCommittedEventTx(tx, session.LocalAgentRef, envelope); err != nil {
				if errors.Is(err, cognitionmemory.ErrMemoryDisabled) {
					return nil
				}
				return err
			}
		}
		return nil
	}, true, nil
}

func cognitionMemoryMessageEnvelope(binding cognitionmemory.Binding, committedAt time.Time, turnSource, conversationSource *runtimev1.CognitionMemorySourceRef, origin, text string, attachment *publicChatCommittedTranscriptAttachment, userSide bool) *runtimev1.CognitionMemoryCommittedEventEnvelope {
	eventRef := "cmevt_" + ulid.Make().String()
	operationID := "cmop_" + ulid.Make().String()
	messageRef := "cmmsg_" + ulid.Make().String()
	actor := runtimev1.CognitionMemoryActorRole_COGNITION_MEMORY_ACTOR_ROLE_ASSISTANT
	if userSide {
		actor = runtimev1.CognitionMemoryActorRole_COGNITION_MEMORY_ACTOR_ROLE_USER
		if origin == publicChatTurnOriginFollowUp {
			actor = runtimev1.CognitionMemoryActorRole_COGNITION_MEMORY_ACTOR_ROLE_TOOL
		}
	}
	parts := make([]*runtimev1.CognitionMemoryMessagePart, 0, 2)
	if value := strings.TrimSpace(text); value != "" {
		parts = append(parts, &runtimev1.CognitionMemoryMessagePart{
			Part:    &runtimev1.CognitionMemorySourceRef{Kind: "message_part", Value: "cmpart_" + ulid.Make().String()},
			Content: &runtimev1.CognitionMemoryMessagePart_Text{Text: &runtimev1.CognitionMemoryTextPart{Text: value}},
		})
	}
	if attachment != nil && strings.TrimSpace(attachment.ArtifactID) != "" {
		parts = append(parts, &runtimev1.CognitionMemoryMessagePart{
			Part: &runtimev1.CognitionMemorySourceRef{Kind: "message_part", Value: "cmpart_" + ulid.Make().String()},
			Content: &runtimev1.CognitionMemoryMessagePart_Artifact{Artifact: &runtimev1.CognitionMemoryArtifactPart{
				Artifact:  &runtimev1.CognitionMemorySourceRef{Kind: "runtime_artifact", Value: attachment.ArtifactID},
				MediaKind: strings.TrimSpace(attachment.MimeType),
			}},
		})
	}
	return &runtimev1.CognitionMemoryCommittedEventEnvelope{
		Event:       &runtimev1.CognitionMemoryEventRef{Value: eventRef},
		Operation:   &runtimev1.CognitionMemoryOperationRef{Value: operationID},
		Subjects:    []*runtimev1.CognitionMemorySubjectRef{{Kind: "account_subject", Value: binding.AccountSubjectRef}},
		Sources:     []*runtimev1.CognitionMemorySourceRef{turnSource, conversationSource, {Kind: "message", Value: messageRef}},
		CommittedAt: timestamppb.New(committedAt),
		Fact: &runtimev1.CognitionMemoryCommittedEventEnvelope_MessageCommitted{MessageCommitted: &runtimev1.CognitionMemoryMessageCommitted{
			Actor: actor, Conversation: conversationSource, Message: &runtimev1.CognitionMemorySourceRef{Kind: "message", Value: messageRef}, Parts: parts,
		}},
	}
}

func (s *Service) cognitionMemoryActivityTerminalTxHook(
	entry *agentEntry,
	outcome *runtimev1.HookExecutionOutcome,
	now time.Time,
) (runtimeAgentStateTxHook, bool, error) {
	if s == nil || s.cognitionMemoryStore == nil || entry == nil || outcome == nil || outcome.GetIntent() == nil {
		return nil, false, nil
	}
	var terminal runtimev1.CognitionMemoryTerminalState
	stateLabel := ""
	switch outcome.GetIntent().GetAdmissionState() {
	case runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_COMPLETED,
		runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_RESCHEDULED:
		terminal = runtimev1.CognitionMemoryTerminalState_COGNITION_MEMORY_TERMINAL_STATE_COMPLETED
		stateLabel = "completed"
	case runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_FAILED,
		runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_REJECTED:
		terminal = runtimev1.CognitionMemoryTerminalState_COGNITION_MEMORY_TERMINAL_STATE_FAILED
		stateLabel = "failed"
	case runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_CANCELED:
		terminal = runtimev1.CognitionMemoryTerminalState_COGNITION_MEMORY_TERMINAL_STATE_CANCELED
		stateLabel = "canceled"
	default:
		return nil, false, nil
	}
	binding, err := s.cognitionMemoryStore.BindingForAgent(context.Background(), entry.Agent.GetLocalAgentRef())
	if err != nil {
		return nil, false, fmt.Errorf("prepare Cognition Memory activity terminal: %w", err)
	}
	if !binding.Enabled || binding.AdoptionRequired {
		return nil, false, nil
	}
	intentID := strings.TrimSpace(outcome.GetIntent().GetIntentId())
	if intentID == "" {
		return nil, false, fmt.Errorf("prepare Cognition Memory activity terminal: hook intent identity is required")
	}
	boundedOutcome := firstNonEmpty(strings.TrimSpace(outcome.GetMessage()), strings.TrimSpace(outcome.GetReason()), "Life Track activity "+stateLabel)
	boundedOutcome = boundCognitionMemoryText(boundedOutcome, 2048)
	sources := []*runtimev1.CognitionMemorySourceRef{{Kind: "life_track_hook", Value: intentID}}
	if anchorID := strings.TrimSpace(outcome.GetIntent().GetConversationAnchorId()); anchorID != "" {
		sources = append(sources, &runtimev1.CognitionMemorySourceRef{Kind: "conversation", Value: anchorID})
	}
	envelope := &runtimev1.CognitionMemoryCommittedEventEnvelope{
		Event:       &runtimev1.CognitionMemoryEventRef{Value: "cmevt_" + ulid.Make().String()},
		Operation:   &runtimev1.CognitionMemoryOperationRef{Value: "cmop_" + ulid.Make().String()},
		Subjects:    []*runtimev1.CognitionMemorySubjectRef{{Kind: "account_subject", Value: binding.AccountSubjectRef}},
		Sources:     sources,
		CommittedAt: timestamppb.New(now.UTC()),
		Fact: &runtimev1.CognitionMemoryCommittedEventEnvelope_ActivityTerminal{ActivityTerminal: &runtimev1.CognitionMemoryActivityTerminal{
			Activity:       &runtimev1.CognitionMemorySourceRef{Kind: "life_track_hook", Value: intentID},
			ActivityKind:   "life_track",
			State:          terminal,
			BoundedOutcome: boundedOutcome,
		}},
	}
	return func(tx *sql.Tx) error {
		if _, err := s.cognitionMemoryStore.EnqueueCommittedEventTx(tx, entry.Agent.GetLocalAgentRef(), envelope); err != nil {
			if errors.Is(err, cognitionmemory.ErrMemoryDisabled) {
				return nil
			}
			return err
		}
		return nil
	}, true, nil
}

func boundCognitionMemoryText(value string, maxRunes int) string {
	trimmed := strings.TrimSpace(value)
	if maxRunes <= 0 {
		return ""
	}
	runes := []rune(trimmed)
	if len(runes) <= maxRunes {
		return trimmed
	}
	return strings.TrimSpace(string(runes[:maxRunes]))
}
