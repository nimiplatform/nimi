package runtimeagent

import (
	"encoding/xml"
	"fmt"
	"io"
	"strconv"
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
	if !strings.HasPrefix(trimmed, "<message") {
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

type publicChatAPMLActionDraft struct {
	actionID         string
	modality         string
	operation        string
	sourceMessageID  string
	deliveryCoupling string
	promptKind       string
	promptText       strings.Builder
}

type publicChatAPMLHookDraft struct {
	intentID      string
	triggerFamily string
	triggerEvent  string
	delayMs       int
	idleMs        int
	prompt        strings.Builder
}

func parsePublicChatAPMLOutput(raw string) (*publicChatStructuredEnvelope, error) {
	decoder := xml.NewDecoder(strings.NewReader("<apml>" + raw + "</apml>"))
	decoder.Strict = false
	var envelope publicChatStructuredEnvelope
	envelope.SchemaID = publicChatStructuredSchemaID
	envelope.Actions = []publicChatStructuredAction{}
	var messageSeen bool
	var messageDepth int
	var messageText strings.Builder
	var captureKind string
	var captureDepth int
	var capture strings.Builder
	var suppressMessageTextDepth int
	var action *publicChatAPMLActionDraft
	var hook *publicChatAPMLHookDraft
	var hookSeen bool
	for {
		token, err := decoder.Token()
		if errorsIsEOF(err) {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("APML output invalid: %w", err)
		}
		switch item := token.(type) {
		case xml.StartElement:
			name := item.Name.Local
			if err := rejectPublicChatAPMLNamespace(item); err != nil {
				return nil, err
			}
			if name == "apml" {
				continue
			}
			if captureKind != "" {
				return nil, fmt.Errorf("APML %s must contain text only", captureKind)
			}
			switch {
			case name == "message":
				if err := requirePublicChatAPMLAttrs(item, "message", "id"); err != nil {
					return nil, err
				}
				if messageSeen {
					return nil, fmt.Errorf("APML output must contain exactly one message")
				}
				if action != nil || hook != nil {
					return nil, fmt.Errorf("APML message must not be nested in action or hook")
				}
				messageSeen = true
				messageDepth = 1
				envelope.Message.MessageID = strings.TrimSpace(xmlAttr(item, "id"))
				if envelope.Message.MessageID == "" {
					return nil, fmt.Errorf("APML message.id is required")
				}
			case messageDepth > 0:
				messageDepth++
				switch name {
				case "activity", "emotion":
					if err := requirePublicChatAPMLAttrs(item, name); err != nil {
						return nil, err
					}
					captureKind = "message:" + name
					captureDepth = 1
					capture.Reset()
					suppressMessageTextDepth++
				case "pause", "speed", "pitch", "emphasis", "whisper", "voice", "surface":
					if err := requirePublicChatAPMLAttrs(item, name); err != nil {
						return nil, err
					}
					suppressMessageTextDepth++
				default:
					return nil, fmt.Errorf("unsupported APML message tag <%s>", name)
				}
			case name == "action":
				if err := requirePublicChatAPMLAttrs(item, "action", "id", "kind", "operation", "source-message", "coupling"); err != nil {
					return nil, err
				}
				if action != nil {
					return nil, fmt.Errorf("APML action must not be nested")
				}
				kind := strings.TrimSpace(xmlAttr(item, "kind"))
				switch kind {
				case "image", "voice":
				case "video":
					return nil, fmt.Errorf("APML video action is deferred")
				default:
					return nil, fmt.Errorf("APML action.kind is invalid")
				}
				action = &publicChatAPMLActionDraft{
					actionID:         strings.TrimSpace(xmlAttr(item, "id")),
					modality:         kind,
					operation:        firstNonEmpty(strings.TrimSpace(xmlAttr(item, "operation")), publicChatDefaultAPMLOperation(kind)),
					sourceMessageID:  strings.TrimSpace(xmlAttr(item, "source-message")),
					deliveryCoupling: firstNonEmpty(strings.TrimSpace(xmlAttr(item, "coupling")), "after-message"),
					promptKind:       kind,
				}
				if action.actionID == "" {
					return nil, fmt.Errorf("APML action.id is required")
				}
			case action != nil:
				switch name {
				case "prompt-payload":
					if err := requirePublicChatAPMLAttrs(item, "prompt-payload", "kind"); err != nil {
						return nil, err
					}
					kind := strings.TrimSpace(xmlAttr(item, "kind"))
					if kind != "" {
						action.promptKind = kind
					}
				case "prompt-text":
					if err := requirePublicChatAPMLAttrs(item, "prompt-text"); err != nil {
						return nil, err
					}
					captureKind = "action:prompt-text"
					captureDepth = 1
					capture.Reset()
				case "voice-id", "voice-emotion", "duration", "aspect-ratio", "style", "negative-prompt":
					if err := requirePublicChatAPMLAttrs(item, name); err != nil {
						return nil, err
					}
				default:
					return nil, fmt.Errorf("unsupported APML action tag <%s>", name)
				}
			case name == "time-hook":
				if err := requirePublicChatAPMLAttrs(item, "time-hook", "id"); err != nil {
					return nil, err
				}
				if hookSeen {
					return nil, fmt.Errorf("APML output admits at most one hook")
				}
				hookSeen = true
				hook = &publicChatAPMLHookDraft{
					intentID:      strings.TrimSpace(xmlAttr(item, "id")),
					triggerFamily: "time",
				}
				if hook.intentID == "" {
					hook.intentID = fmt.Sprintf("hook-%d", len(envelope.Actions))
				}
			case name == "event-hook":
				if err := requirePublicChatAPMLAttrs(item, "event-hook", "id"); err != nil {
					return nil, err
				}
				if hookSeen {
					return nil, fmt.Errorf("APML output admits at most one hook")
				}
				hookSeen = true
				hook = &publicChatAPMLHookDraft{
					intentID:      strings.TrimSpace(xmlAttr(item, "id")),
					triggerFamily: "event",
				}
				if hook.intentID == "" {
					hook.intentID = fmt.Sprintf("hook-%d", len(envelope.Actions))
				}
			case hook != nil:
				switch name {
				case "delay-ms":
					if hook.triggerFamily != "time" {
						return nil, fmt.Errorf("APML event-hook does not admit delay-ms")
					}
					if err := requirePublicChatAPMLAttrs(item, "delay-ms"); err != nil {
						return nil, err
					}
					captureKind = "hook:delay-ms"
					captureDepth = 1
					capture.Reset()
				case "effect":
					if err := requirePublicChatAPMLAttrs(item, "effect", "kind"); err != nil {
						return nil, err
					}
					if strings.TrimSpace(xmlAttr(item, "kind")) != "follow-up-turn" {
						return nil, fmt.Errorf("APML hook effect.kind must be follow-up-turn")
					}
				case "prompt-text":
					if err := requirePublicChatAPMLAttrs(item, "prompt-text"); err != nil {
						return nil, err
					}
					captureKind = "hook:prompt-text"
					captureDepth = 1
					capture.Reset()
				case "event-user-idle":
					if hook.triggerFamily != "event" {
						return nil, fmt.Errorf("APML time-hook does not admit event-user-idle")
					}
					if err := requirePublicChatAPMLAttrs(item, "event-user-idle", "idle-for", "idle-for-ms"); err != nil {
						return nil, err
					}
					if err := hook.setEventUserIdle(xmlAttr(item, "idle-for"), xmlAttr(item, "idle-for-ms")); err != nil {
						return nil, err
					}
				case "event-chat-ended":
					if hook.triggerFamily != "event" {
						return nil, fmt.Errorf("APML time-hook does not admit event-chat-ended")
					}
					if err := requirePublicChatAPMLAttrs(item, "event-chat-ended"); err != nil {
						return nil, err
					}
					if err := hook.setEventChatEnded(); err != nil {
						return nil, err
					}
				default:
					return nil, fmt.Errorf("unsupported APML hook tag <%s>", name)
				}
			default:
				return nil, fmt.Errorf("unsupported APML top-level tag <%s>", name)
			}
		case xml.CharData:
			text := string([]byte(item))
			if captureKind != "" {
				capture.WriteString(text)
			} else if messageDepth > 0 && suppressMessageTextDepth == 0 {
				messageText.WriteString(text)
			} else if strings.TrimSpace(text) != "" {
				return nil, fmt.Errorf("APML text must be inside message")
			}
		case xml.EndElement:
			name := item.Name.Local
			if name == "apml" {
				continue
			}
			if captureKind != "" {
				captureDepth--
				if captureDepth == 0 {
					finishedCaptureKind := captureKind
					if err := applyPublicChatAPMLCapture(&envelope, action, hook, captureKind, strings.TrimSpace(capture.String())); err != nil {
						return nil, err
					}
					captureKind = ""
					if strings.HasPrefix(finishedCaptureKind, "message:") {
						if suppressMessageTextDepth > 0 {
							suppressMessageTextDepth--
						}
						if messageDepth > 0 {
							messageDepth--
						}
					}
					if strings.HasPrefix(finishedCaptureKind, "hook:") && hook != nil {
						// Captured hook children close normally; the enclosing
						// hook remains active until </time-hook>.
					}
					if strings.HasPrefix(finishedCaptureKind, "action:") && action != nil {
						// Captured action children close normally; the enclosing
						// action remains active until </action>.
					}
				}
				continue
			}
			if messageDepth > 0 {
				if name != "message" && suppressMessageTextDepth > 0 {
					suppressMessageTextDepth--
				}
				messageDepth--
				if messageDepth == 0 {
					envelope.Message.Text = normalizePublicChatAPMLText(messageText.String())
				}
				continue
			}
			if name == "action" && action != nil {
				next, err := publicChatStructuredActionFromAPMLDraft(*action, envelope.Message.MessageID, len(envelope.Actions))
				if err != nil {
					return nil, err
				}
				envelope.Actions = append(envelope.Actions, next)
				action = nil
				continue
			}
			if (name == "time-hook" || name == "event-hook") && hook != nil {
				next, err := publicChatStructuredFollowUpActionFromAPMLHook(*hook, envelope.Message.MessageID, len(envelope.Actions))
				if err != nil {
					return nil, err
				}
				envelope.Actions = append(envelope.Actions, next)
				hook = nil
			}
		case xml.Comment:
			return nil, fmt.Errorf("APML output must not contain comments")
		case xml.ProcInst, xml.Directive:
			return nil, fmt.Errorf("APML output must not contain processing instructions or directives")
		}
	}
	for index := range envelope.Actions {
		envelope.Actions[index].ActionIndex = index
		envelope.Actions[index].ActionCount = len(envelope.Actions)
	}
	if err := validatePublicChatStructuredEnvelope(&envelope); err != nil {
		return nil, err
	}
	return &envelope, nil
}

func errorsIsEOF(err error) bool {
	return err == io.EOF
}

func rejectPublicChatAPMLNamespace(element xml.StartElement) error {
	if element.Name.Space != "" {
		return fmt.Errorf("APML <%s> namespace is not admitted", element.Name.Local)
	}
	for _, attr := range element.Attr {
		if attr.Name.Space != "" {
			return fmt.Errorf("APML %s.%s namespace is not admitted", element.Name.Local, attr.Name.Local)
		}
	}
	return nil
}

func requirePublicChatAPMLAttrs(element xml.StartElement, label string, allowed ...string) error {
	allowedSet := make(map[string]struct{}, len(allowed))
	for _, name := range allowed {
		allowedSet[name] = struct{}{}
	}
	seen := make(map[string]struct{}, len(element.Attr))
	for _, attr := range element.Attr {
		name := attr.Name.Local
		if _, exists := seen[name]; exists {
			return fmt.Errorf("APML %s.%s is duplicated", label, name)
		}
		seen[name] = struct{}{}
		if _, ok := allowedSet[name]; !ok {
			return fmt.Errorf("APML %s.%s is not admitted", label, name)
		}
	}
	return nil
}

func xmlAttr(element xml.StartElement, name string) string {
	for _, attr := range element.Attr {
		if attr.Name.Local == name {
			return attr.Value
		}
	}
	return ""
}

func publicChatDefaultAPMLOperation(kind string) string {
	switch kind {
	case "image":
		return "image.generate"
	case "voice":
		return "audio.synthesize"
	default:
		return ""
	}
}

func applyPublicChatAPMLCapture(envelope *publicChatStructuredEnvelope, action *publicChatAPMLActionDraft, hook *publicChatAPMLHookDraft, kind string, value string) error {
	switch kind {
	case "message:emotion":
		if value == "" {
			return nil
		}
		if envelope.StatusCue == nil {
			envelope.StatusCue = &publicChatStructuredStatusCue{SourceMessageID: envelope.Message.MessageID}
		}
		if publicChatStatusCueMoodAdmitted(value) {
			envelope.StatusCue.Mood = value
		} else {
			envelope.StatusCue.Label = value
		}
	case "message:activity":
		if value == "" {
			return nil
		}
		if envelope.StatusCue == nil {
			envelope.StatusCue = &publicChatStructuredStatusCue{SourceMessageID: envelope.Message.MessageID}
		}
		envelope.StatusCue.ActionCue = value
	case "action:prompt-text":
		if action == nil {
			return fmt.Errorf("APML prompt-text outside action")
		}
		action.promptText.WriteString(value)
	case "hook:delay-ms":
		if hook == nil {
			return fmt.Errorf("APML delay-ms outside time-hook")
		}
		delay, err := strconv.Atoi(strings.TrimSpace(value))
		if err != nil || delay <= 0 {
			return fmt.Errorf("APML time-hook delay-ms must be positive")
		}
		hook.delayMs = delay
	case "hook:prompt-text":
		if hook == nil {
			return fmt.Errorf("APML prompt-text outside time-hook")
		}
		hook.prompt.WriteString(value)
	}
	return nil
}

func publicChatStatusCueMoodAdmitted(value string) bool {
	switch strings.TrimSpace(value) {
	case "neutral", "joy", "focus", "calm", "playful", "concerned", "surprised":
		return true
	default:
		return false
	}
}

func normalizePublicChatAPMLText(value string) string {
	return strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
}

func publicChatStructuredActionFromAPMLDraft(action publicChatAPMLActionDraft, messageID string, index int) (publicChatStructuredAction, error) {
	sourceMessageID := firstNonEmpty(action.sourceMessageID, messageID)
	promptKind := action.promptKind + "-prompt"
	if strings.HasSuffix(action.promptKind, "-prompt") {
		promptKind = action.promptKind
	}
	return publicChatStructuredAction{
		ActionID:         action.actionID,
		ActionIndex:      index,
		ActionCount:      index + 1,
		Modality:         action.modality,
		Operation:        action.operation,
		SourceMessageID:  sourceMessageID,
		DeliveryCoupling: action.deliveryCoupling,
		PromptPayload: publicChatStructuredPromptPayload{
			Kind:       promptKind,
			PromptText: strings.TrimSpace(action.promptText.String()),
		},
	}, nil
}

func publicChatStructuredFollowUpActionFromAPMLHook(hook publicChatAPMLHookDraft, messageID string, index int) (publicChatStructuredAction, error) {
	if hook.triggerFamily == "" {
		return publicChatStructuredAction{}, fmt.Errorf("APML hook trigger family is required")
	}
	if hook.triggerFamily == "time" && hook.delayMs <= 0 {
		return publicChatStructuredAction{}, fmt.Errorf("APML time-hook delay-ms must be positive")
	}
	if hook.triggerFamily == "event" {
		switch hook.triggerEvent {
		case "user-idle":
			if hook.idleMs <= 0 {
				return publicChatStructuredAction{}, fmt.Errorf("APML event-hook event-user-idle idle-for must be positive")
			}
		case "chat-ended":
		default:
			return publicChatStructuredAction{}, fmt.Errorf("APML event-hook must include event-user-idle or event-chat-ended")
		}
	}
	return publicChatStructuredAction{
		ActionID:         hook.intentID,
		ActionIndex:      index,
		ActionCount:      index + 1,
		Modality:         "follow-up-turn",
		Operation:        publicChatAPMLHookOperation(hook),
		SourceMessageID:  messageID,
		DeliveryCoupling: "after-message",
		PromptPayload: publicChatStructuredPromptPayload{
			Kind:          "follow-up-turn",
			PromptText:    strings.TrimSpace(hook.prompt.String()),
			DelayMs:       hook.delayMs,
			TriggerFamily: hook.triggerFamily,
			TriggerEvent:  hook.triggerEvent,
			IdleMs:        hook.idleMs,
		},
	}, nil
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
