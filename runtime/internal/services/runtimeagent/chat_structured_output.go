package runtimeagent

import (
	"fmt"
	"strings"
)

const (
	publicChatStructuredSchemaID = "nimi.agent.chat.message-action.v1"
)

type publicChatStructuredEnvelope struct {
	SchemaID  string                         `json:"schemaId"`
	Message   publicChatStructuredMessage    `json:"message"`
	StatusCue *publicChatStructuredStatusCue `json:"statusCue,omitempty"`
	Actions   []publicChatStructuredAction   `json:"actions"`
}

type publicChatStructuredMessage struct {
	MessageID string `json:"messageId"`
	Text      string `json:"text"`
}

type publicChatStructuredStatusCue struct {
	SourceMessageID string   `json:"sourceMessageId"`
	Mood            string   `json:"mood,omitempty"`
	Label           string   `json:"label,omitempty"`
	Intensity       *float64 `json:"intensity,omitempty"`
	ActionCue       string   `json:"actionCue,omitempty"`
}

type publicChatStructuredAction struct {
	ActionID         string                            `json:"actionId"`
	ActionIndex      int                               `json:"actionIndex"`
	ActionCount      int                               `json:"actionCount"`
	Modality         string                            `json:"modality"`
	Operation        string                            `json:"operation"`
	PromptPayload    publicChatStructuredPromptPayload `json:"promptPayload"`
	SourceMessageID  string                            `json:"sourceMessageId"`
	DeliveryCoupling string                            `json:"deliveryCoupling"`
}

type publicChatStructuredPromptPayload struct {
	Kind          string `json:"kind"`
	PromptText    string `json:"promptText"`
	DelayMs       int    `json:"delayMs,omitempty"`
	TriggerFamily string `json:"triggerFamily,omitempty"`
	TriggerEvent  string `json:"triggerEvent,omitempty"`
	IdleMs        int    `json:"idleMs,omitempty"`
}

func parsePublicChatStructuredEnvelope(raw string) (*publicChatStructuredEnvelope, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, fmt.Errorf("structured chat output is required")
	}
	if !startsWithAPMLRoot(trimmed, "message") {
		return nil, fmt.Errorf("structured chat output must be APML beginning with <message>")
	}
	return parsePublicChatAPMLOutput(trimmed)
}

func validatePublicChatStructuredEnvelope(envelope *publicChatStructuredEnvelope) error {
	if envelope == nil {
		return fmt.Errorf("structured chat output is required")
	}
	if strings.TrimSpace(envelope.SchemaID) != publicChatStructuredSchemaID {
		return fmt.Errorf("schemaId must equal %s", publicChatStructuredSchemaID)
	}
	envelope.Message.MessageID = strings.TrimSpace(envelope.Message.MessageID)
	envelope.Message.Text = strings.TrimSpace(envelope.Message.Text)
	if envelope.Message.MessageID == "" {
		return fmt.Errorf("message.messageId is required")
	}
	if envelope.Message.Text == "" {
		return fmt.Errorf("message.text is required")
	}
	if envelope.StatusCue != nil {
		if err := validatePublicChatStructuredStatusCue(envelope.StatusCue, envelope.Message.MessageID); err != nil {
			return err
		}
	}
	seenActionIDs := make(map[string]struct{}, len(envelope.Actions))
	imageCount := 0
	voiceCount := 0
	followUpCount := 0
	for index := range envelope.Actions {
		action := &envelope.Actions[index]
		if err := validatePublicChatStructuredAction(action, index, len(envelope.Actions), envelope.Message.MessageID); err != nil {
			return err
		}
		if _, exists := seenActionIDs[action.ActionID]; exists {
			return fmt.Errorf("duplicate actionId: %s", action.ActionID)
		}
		seenActionIDs[action.ActionID] = struct{}{}
		switch action.Modality {
		case "image":
			imageCount++
		case "voice":
			voiceCount++
		case "follow-up-turn":
			followUpCount++
		}
	}
	if imageCount > 1 {
		return fmt.Errorf("at most one image action is admitted per turn")
	}
	if voiceCount > 1 {
		return fmt.Errorf("at most one voice action is admitted per turn")
	}
	if followUpCount > 1 {
		return fmt.Errorf("at most one follow-up-turn action is admitted per turn")
	}
	return nil
}

func validatePublicChatStructuredStatusCue(cue *publicChatStructuredStatusCue, messageID string) error {
	if cue == nil {
		return nil
	}
	cue.SourceMessageID = strings.TrimSpace(cue.SourceMessageID)
	cue.Mood = strings.TrimSpace(cue.Mood)
	cue.Label = strings.TrimSpace(cue.Label)
	cue.ActionCue = strings.TrimSpace(cue.ActionCue)
	if cue.SourceMessageID == "" {
		return fmt.Errorf("statusCue.sourceMessageId is required")
	}
	if cue.SourceMessageID != messageID {
		return fmt.Errorf("statusCue.sourceMessageId must equal message.messageId")
	}
	if cue.Mood != "" {
		switch cue.Mood {
		case "neutral", "joy", "focus", "calm", "playful", "concerned", "surprised":
		default:
			return fmt.Errorf("statusCue.mood is invalid")
		}
	}
	if cue.Intensity != nil && (*cue.Intensity < 0 || *cue.Intensity > 1) {
		return fmt.Errorf("statusCue.intensity must be between 0 and 1")
	}
	if cue.Mood == "" && cue.Label == "" && cue.ActionCue == "" {
		return fmt.Errorf("statusCue must include at least one usable affect field")
	}
	if cue.ActionCue != "" {
		if _, _, err := normalizePublicChatActivityProjection(cue.ActionCue, cue.Intensity); err != nil {
			return err
		}
	}
	return nil
}

func validatePublicChatStructuredAction(action *publicChatStructuredAction, index int, actionCount int, messageID string) error {
	if action == nil {
		return fmt.Errorf("actions[%d] is required", index)
	}
	action.ActionID = strings.TrimSpace(action.ActionID)
	action.Modality = strings.TrimSpace(action.Modality)
	action.Operation = strings.TrimSpace(action.Operation)
	action.SourceMessageID = strings.TrimSpace(action.SourceMessageID)
	action.DeliveryCoupling = strings.TrimSpace(action.DeliveryCoupling)
	action.PromptPayload.Kind = strings.TrimSpace(action.PromptPayload.Kind)
	action.PromptPayload.PromptText = strings.TrimSpace(action.PromptPayload.PromptText)

	if action.ActionID == "" {
		return fmt.Errorf("actions[%d].actionId is required", index)
	}
	if action.ActionIndex != index {
		return fmt.Errorf("actions[%d].actionIndex must equal %d", index, index)
	}
	if action.ActionCount != actionCount {
		return fmt.Errorf("actions[%d].actionCount must equal %d", index, actionCount)
	}
	switch action.Modality {
	case "image", "voice", "follow-up-turn":
	default:
		return fmt.Errorf("actions[%d].modality is invalid", index)
	}
	if action.Operation == "" {
		return fmt.Errorf("actions[%d].operation is required", index)
	}
	if action.SourceMessageID != messageID {
		return fmt.Errorf("action %s source message reference is inconsistent", action.ActionID)
	}
	switch action.DeliveryCoupling {
	case "after-message", "with-message":
	default:
		return fmt.Errorf("actions[%d].deliveryCoupling is invalid", index)
	}
	if action.PromptPayload.PromptText == "" {
		return fmt.Errorf("actions[%d].promptPayload.promptText is required", index)
	}
	switch action.Modality {
	case "image":
		if action.PromptPayload.Kind != "image-prompt" {
			return fmt.Errorf("actions[%d].promptPayload.kind must match modality image", index)
		}
	case "voice":
		if action.PromptPayload.Kind != "voice-prompt" {
			return fmt.Errorf("actions[%d].promptPayload.kind must match modality voice", index)
		}
	case "follow-up-turn":
		if action.PromptPayload.Kind != "follow-up-turn" {
			return fmt.Errorf("actions[%d].promptPayload.kind must match modality follow-up-turn", index)
		}
		switch firstNonEmpty(action.PromptPayload.TriggerFamily, "time") {
		case "time":
			if action.PromptPayload.DelayMs <= 0 {
				return fmt.Errorf("actions[%d].promptPayload.delayMs must be positive", index)
			}
			if action.Operation != "assistant.turn.schedule" {
				return fmt.Errorf("follow-up-turn action %s must use assistant.turn.schedule", action.ActionID)
			}
		case "event":
			if action.Operation != "assistant.turn.hook" {
				return fmt.Errorf("follow-up-turn event hook %s must use assistant.turn.hook", action.ActionID)
			}
			switch action.PromptPayload.TriggerEvent {
			case "user-idle":
				if action.PromptPayload.IdleMs <= 0 {
					return fmt.Errorf("actions[%d].promptPayload.idleMs must be positive", index)
				}
			case "chat-ended":
			default:
				return fmt.Errorf("actions[%d].promptPayload.triggerEvent is invalid", index)
			}
		default:
			return fmt.Errorf("actions[%d].promptPayload.triggerFamily is invalid", index)
		}
	}
	return nil
}

func (e *publicChatStructuredEnvelope) payload() map[string]any {
	if e == nil {
		return map[string]any{}
	}
	payload := map[string]any{
		"schema_id": e.SchemaID,
		"message": map[string]any{
			"message_id": e.Message.MessageID,
			"text":       e.Message.Text,
		},
		"actions": publicChatStructuredActionsPayload(e.Actions),
	}
	if e.StatusCue != nil {
		cuePayload := map[string]any{
			"source_message_id": e.StatusCue.SourceMessageID,
		}
		if e.StatusCue.Mood != "" {
			cuePayload["mood"] = e.StatusCue.Mood
		}
		if e.StatusCue.Label != "" {
			cuePayload["label"] = e.StatusCue.Label
		}
		if e.StatusCue.Intensity != nil {
			cuePayload["intensity"] = *e.StatusCue.Intensity
		}
		if e.StatusCue.ActionCue != "" {
			cuePayload["action_cue"] = e.StatusCue.ActionCue
		}
		payload["status_cue"] = cuePayload
	}
	return payload
}

func publicChatStructuredActionsPayload(actions []publicChatStructuredAction) []any {
	out := make([]any, 0, len(actions))
	for _, action := range actions {
		item := map[string]any{
			"action_id":         action.ActionID,
			"action_index":      action.ActionIndex,
			"action_count":      action.ActionCount,
			"modality":          action.Modality,
			"operation":         action.Operation,
			"source_message_id": action.SourceMessageID,
			"delivery_coupling": action.DeliveryCoupling,
			"prompt_payload": map[string]any{
				"kind":        action.PromptPayload.Kind,
				"prompt_text": action.PromptPayload.PromptText,
			},
		}
		if action.PromptPayload.Kind == "follow-up-turn" {
			promptPayload := item["prompt_payload"].(map[string]any)
			promptPayload["trigger_family"] = firstNonEmpty(action.PromptPayload.TriggerFamily, "time")
			switch action.PromptPayload.TriggerFamily {
			case "event":
				promptPayload["trigger_event"] = action.PromptPayload.TriggerEvent
				if action.PromptPayload.TriggerEvent == "user-idle" {
					promptPayload["idle_ms"] = action.PromptPayload.IdleMs
				}
			default:
				promptPayload["delay_ms"] = action.PromptPayload.DelayMs
			}
		}
		out = append(out, item)
	}
	return out
}
