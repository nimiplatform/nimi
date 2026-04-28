package runtimeagent

import (
	"encoding/xml"
	"fmt"
	"io"
	"strconv"
	"strings"
)

type publicChatAPMLActionDraft struct {
	actionID          string
	modality          string
	operation         string
	sourceMessageID   string
	deliveryCoupling  string
	promptKind        string
	promptText        strings.Builder
	promptPayloadOpen bool
	promptPayloadSeen bool
	promptTextSeen    bool
}

type publicChatAPMLHookDraft struct {
	intentID      string
	triggerFamily string
	triggerEvent  string
	delayMs       int
	idleMs        int
	prompt        strings.Builder
	delaySeen     bool
	effectOpen    bool
	effectSeen    bool
	promptSeen    bool
}

func parsePublicChatAPMLOutput(raw string) (*publicChatStructuredEnvelope, error) {
	const syntheticRoot = "nimi-public-chat-apml-packet"
	decoder := xml.NewDecoder(strings.NewReader("<" + syntheticRoot + ">" + raw + "</" + syntheticRoot + ">"))
	decoder.Strict = true
	var envelope publicChatStructuredEnvelope
	envelope.SchemaID = publicChatStructuredSchemaID
	envelope.Actions = []publicChatStructuredAction{}
	var messageSeen bool
	var messageDepth int
	var messageEmotionSeen bool
	var messageActivitySeen bool
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
			if name == syntheticRoot {
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
					if name == "emotion" {
						if messageEmotionSeen {
							return nil, fmt.Errorf("APML message admits at most one emotion")
						}
						messageEmotionSeen = true
					}
					if name == "activity" {
						if messageActivitySeen {
							return nil, fmt.Errorf("APML message admits at most one activity")
						}
						messageActivitySeen = true
					}
					captureKind = "message:" + name
					captureDepth = 1
					capture.Reset()
					suppressMessageTextDepth++
				default:
					return nil, fmt.Errorf("unsupported APML message tag <%s>", name)
				}
			case name == "action":
				if err := requirePublicChatAPMLAttrs(item, "action", "id", "kind"); err != nil {
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
					operation:        publicChatDefaultAPMLOperation(kind),
					sourceMessageID:  envelope.Message.MessageID,
					deliveryCoupling: "after-message",
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
					if action.promptPayloadSeen {
						return nil, fmt.Errorf("APML action admits exactly one prompt-payload")
					}
					kind := strings.TrimSpace(xmlAttr(item, "kind"))
					if kind == "" {
						return nil, fmt.Errorf("APML prompt-payload.kind is required")
					}
					action.promptKind = kind
					action.promptPayloadSeen = true
					action.promptPayloadOpen = true
				case "prompt-text":
					if err := requirePublicChatAPMLAttrs(item, "prompt-text"); err != nil {
						return nil, err
					}
					if !action.promptPayloadOpen {
						return nil, fmt.Errorf("APML prompt-text must be inside prompt-payload")
					}
					if action.promptTextSeen {
						return nil, fmt.Errorf("APML prompt-payload admits exactly one prompt-text")
					}
					action.promptTextSeen = true
					captureKind = "action:prompt-text"
					captureDepth = 1
					capture.Reset()
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
					if hook.effectOpen {
						return nil, fmt.Errorf("APML time-hook delay-ms must be outside effect")
					}
					if err := requirePublicChatAPMLAttrs(item, "delay-ms"); err != nil {
						return nil, err
					}
					if hook.delaySeen {
						return nil, fmt.Errorf("APML time-hook admits exactly one delay-ms")
					}
					hook.delaySeen = true
					captureKind = "hook:delay-ms"
					captureDepth = 1
					capture.Reset()
				case "effect":
					if err := requirePublicChatAPMLAttrs(item, "effect", "kind"); err != nil {
						return nil, err
					}
					if hook.effectSeen {
						return nil, fmt.Errorf("APML hook admits exactly one effect")
					}
					if strings.TrimSpace(xmlAttr(item, "kind")) != "follow-up-turn" {
						return nil, fmt.Errorf("APML hook effect.kind must be follow-up-turn")
					}
					hook.effectSeen = true
					hook.effectOpen = true
				case "prompt-text":
					if err := requirePublicChatAPMLAttrs(item, "prompt-text"); err != nil {
						return nil, err
					}
					if !hook.effectOpen {
						return nil, fmt.Errorf("APML hook prompt-text must be inside effect")
					}
					if hook.promptSeen {
						return nil, fmt.Errorf("APML hook effect admits exactly one prompt-text")
					}
					hook.promptSeen = true
					captureKind = "hook:prompt-text"
					captureDepth = 1
					capture.Reset()
				case "event-user-idle":
					if hook.triggerFamily != "event" {
						return nil, fmt.Errorf("APML time-hook does not admit event-user-idle")
					}
					if hook.effectOpen {
						return nil, fmt.Errorf("APML event-user-idle must be outside effect")
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
					if hook.effectOpen {
						return nil, fmt.Errorf("APML event-chat-ended must be outside effect")
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
			if name == syntheticRoot {
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
			if name == "prompt-payload" && action != nil {
				action.promptPayloadOpen = false
				continue
			}
			if (name == "time-hook" || name == "event-hook") && hook != nil {
				next, err := publicChatStructuredFollowUpActionFromAPMLHook(*hook, envelope.Message.MessageID, len(envelope.Actions))
				if err != nil {
					return nil, err
				}
				envelope.Actions = append(envelope.Actions, next)
				hook = nil
				continue
			}
			if name == "effect" && hook != nil {
				hook.effectOpen = false
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
		if !publicChatStatusCueMoodAdmitted(value) {
			return fmt.Errorf("APML emotion %q is not admitted by runtime current emotion ontology", value)
		}
		if envelope.StatusCue == nil {
			envelope.StatusCue = &publicChatStructuredStatusCue{SourceMessageID: envelope.Message.MessageID}
		}
		envelope.StatusCue.Mood = value
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

func normalizePublicChatAPMLText(value string) string {
	return strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
}

func publicChatStructuredActionFromAPMLDraft(action publicChatAPMLActionDraft, messageID string, index int) (publicChatStructuredAction, error) {
	sourceMessageID := firstNonEmpty(action.sourceMessageID, messageID)
	if !action.promptPayloadSeen {
		return publicChatStructuredAction{}, fmt.Errorf("APML action prompt-payload is required")
	}
	if !action.promptTextSeen {
		return publicChatStructuredAction{}, fmt.Errorf("APML action prompt-text is required")
	}
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
	if !hook.effectSeen {
		return publicChatStructuredAction{}, fmt.Errorf("APML hook effect is required")
	}
	if !hook.promptSeen {
		return publicChatStructuredAction{}, fmt.Errorf("APML hook prompt-text is required")
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
