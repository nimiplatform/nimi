package runtimeagent

import (
	"encoding/xml"
	"fmt"
	"io"
	"math"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
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

// @nimi-authority: rule.nimi.runtime.agent-participation.r012
type publicChatAPMLInterpretation struct {
	Envelope     *publicChatStructuredEnvelope
	MessageRoot  xml.StartElement
	CuePresent   bool
	MessageSeen  bool
	BodyComplete bool
	QuerySeen    bool
	Query        string
	Err          error
}

func parsePublicChatAPMLOutput(raw string) (*publicChatStructuredEnvelope, error) {
	result := interpretPublicChatAPML(raw)
	if !result.BodyComplete || result.QuerySeen || strings.TrimSpace(result.Envelope.Message.Text) == "" {
		if result.Err != nil {
			return nil, result.Err
		}
		return nil, fmt.Errorf("APML public message is incomplete")
	}
	envelope := result.Envelope
	if result.Err != nil {
		envelope.Actions = nil
		envelope.ControlError = result.Err.Error()
	}
	if err := validatePublicChatStructuredEnvelope(envelope); err != nil {
		// The independently interpreted body and cues are already valid. A
		// rejected control batch never executes an otherwise parsed prefix.
		envelope.Actions = nil
		envelope.ControlError = err.Error()
	}
	return envelope, nil
}

// Streaming and final interpretation use the same lexical prefix, including
// when a malformed entity and readable text arrive in one network fragment.
func publicChatStreamingMessageText(raw string) (string, bool) {
	result := interpretPublicChatAPML(raw)
	return result.Envelope.Message.Text, result.MessageSeen
}

func interpretPublicChatAPML(raw string) (result *publicChatAPMLInterpretation) {
	result = &publicChatAPMLInterpretation{Envelope: &publicChatStructuredEnvelope{
		SchemaID: publicChatStructuredSchemaID,
		Message:  publicChatStructuredMessage{MessageID: "message"},
		Actions:  []publicChatStructuredAction{},
	}}
	decoder := xml.NewDecoder(strings.NewReader(raw))
	decoder.Strict = true
	var path []string
	var text, capture strings.Builder
	cueCount := map[string]int{}
	cueInvalid := map[string]bool{}
	cueValue := map[string]string{}
	var messageClosed, hookSeen bool
	var action *publicChatAPMLActionDraft
	var hook *publicChatAPMLHookDraft
	defer func() {
		envelope := result.Envelope
		envelope.Message.Text = normalizePublicChatAPMLText(text.String())
		mood, activity := cueValue["emotion"], cueValue["activity"]
		if cueInvalid["emotion"] || !publicChatStatusCueMoodAdmitted(mood) {
			mood = ""
		}
		if _, _, err := normalizePublicChatActivityProjection(activity, nil); cueInvalid["activity"] || err != nil {
			activity = ""
		}
		if mood != "" || activity != "" {
			envelope.StatusCue = &publicChatStructuredStatusCue{
				SourceMessageID: envelope.Message.MessageID, Mood: mood, ActionCue: activity,
			}
		}
		for index := range envelope.Actions {
			envelope.Actions[index].ActionIndex = index
			envelope.Actions[index].ActionCount = len(envelope.Actions)
		}
	}()
	fail := func(err error) *publicChatAPMLInterpretation {
		result.Err = err
		return result
	}
	for {
		offset := decoder.InputOffset()
		token, err := decoder.Token()
		if err == io.EOF {
			if !messageClosed || len(path) != 0 {
				return fail(fmt.Errorf("APML message is incomplete"))
			}
			return result
		}
		if err != nil {
			if len(path) == 1 && path[0] == "message" && !result.QuerySeen {
				text.WriteString(publicChatAPMLCharacterPrefix(raw[offset:]))
			}
			return fail(fmt.Errorf("APML output invalid: %w", err))
		}
		parent := strings.Join(path, "/")
		switch item := token.(type) {
		case xml.StartElement:
			name := item.Name.Local
			inCue := len(path) >= 2 && path[0] == "message" && (path[1] == "emotion" || path[1] == "activity")
			if inCue {
				cueInvalid[path[1]] = true
				path = append(path, name)
				continue
			}
			isCue := parent == "message" && item.Name.Space == "" && (name == "emotion" || name == "activity")
			if err := rejectPublicChatAPMLNamespace(item); err != nil && !isCue {
				return fail(err)
			}
			switch {
			case !result.MessageSeen:
				if parent != "" || name != "message" {
					return fail(fmt.Errorf("APML output must begin with message"))
				}
				// No model-provided message attribute is identity or authority.
				result.MessageSeen = true
				result.MessageRoot = item
			case !messageClosed:
				if parent != "message" {
					return fail(fmt.Errorf("APML private query must contain text only"))
				}
				switch {
				case isCue:
					result.CuePresent = true
					if result.QuerySeen {
						return fail(fmt.Errorf("APML query must be the only message child"))
					}
					cueCount[name]++
					if cueCount[name] > 1 || requirePublicChatAPMLAttrs(item, name) != nil {
						cueInvalid[name] = true
					}
					capture.Reset()
				case name == "query":
					wasQuery := result.QuerySeen
					result.QuerySeen = true
					if wasQuery || len(cueCount) != 0 || strings.TrimSpace(text.String()) != "" || requirePublicChatAPMLAttrs(item, name) != nil {
						return fail(fmt.Errorf("APML query must be the only message content"))
					}
					capture.Reset()
				default:
					return fail(fmt.Errorf("unsupported APML message child"))
				}
			case result.QuerySeen:
				return fail(fmt.Errorf("APML private query must not have trailing controls"))
			case parent == "":
				switch name {
				case "action":
					if requirePublicChatAPMLAttrs(item, name, "id", "kind") != nil || xmlAttr(item, "kind") != "image" {
						return fail(fmt.Errorf("APML action must be an admitted image action"))
					}
					action = &publicChatAPMLActionDraft{
						actionID: fmt.Sprintf("action-%d", len(result.Envelope.Actions)),
						modality: "image", operation: "image.generate",
						sourceMessageID:  result.Envelope.Message.MessageID,
						deliveryCoupling: "after-message", promptKind: "image",
					}
				case "time-hook":
					if hookSeen || requirePublicChatAPMLAttrs(item, name, "id") != nil {
						return fail(fmt.Errorf("APML admits at most one valid time-hook"))
					}
					hookSeen = true
					hook = &publicChatAPMLHookDraft{
						intentID: fmt.Sprintf("action-%d", len(result.Envelope.Actions)), triggerFamily: "time",
					}
				default:
					return fail(fmt.Errorf("unsupported APML control"))
				}
			case parent == "action" && name == "prompt-payload":
				if action.promptPayloadSeen || requirePublicChatAPMLAttrs(item, name, "kind") != nil {
					return fail(fmt.Errorf("APML image action requires one prompt-payload"))
				}
				action.promptPayloadSeen = true
				action.promptKind = xmlAttr(item, "kind")
			case parent == "action/prompt-payload" && name == "prompt-text":
				if action.promptTextSeen || requirePublicChatAPMLAttrs(item, name) != nil {
					return fail(fmt.Errorf("APML image action requires one prompt-text"))
				}
				action.promptTextSeen = true
				capture.Reset()
			case parent == "time-hook" && name == "delay-ms":
				if hook.delaySeen || requirePublicChatAPMLAttrs(item, name) != nil {
					return fail(fmt.Errorf("APML time-hook requires one delay"))
				}
				hook.delaySeen = true
				capture.Reset()
			case parent == "time-hook" && name == "effect":
				if hook.effectSeen || requirePublicChatAPMLAttrs(item, name, "kind") != nil || xmlAttr(item, "kind") != "follow-up-turn" {
					return fail(fmt.Errorf("APML time-hook requires one follow-up effect"))
				}
				hook.effectSeen = true
			case parent == "time-hook/effect" && name == "prompt-text":
				if hook.promptSeen || requirePublicChatAPMLAttrs(item, name) != nil {
					return fail(fmt.Errorf("APML time-hook requires one prompt-text"))
				}
				hook.promptSeen = true
				capture.Reset()
			default:
				return fail(fmt.Errorf("APML control is in an invalid position"))
			}
			path = append(path, name)
		case xml.CharData:
			value := string(item)
			switch parent {
			case "message":
				if result.QuerySeen && strings.TrimSpace(value) != "" {
					return fail(fmt.Errorf("APML query must not be mixed with public text"))
				}
				if !result.QuerySeen {
					text.WriteString(value)
				}
			case "message/emotion", "message/activity", "message/query",
				"action/prompt-payload/prompt-text", "time-hook/delay-ms", "time-hook/effect/prompt-text":
				capture.WriteString(value)
			default:
				if len(path) >= 2 && path[0] == "message" && (path[1] == "emotion" || path[1] == "activity") {
					continue
				}
				if strings.TrimSpace(value) != "" {
					return fail(fmt.Errorf("APML text is outside an admitted text region"))
				}
			}
		case xml.EndElement:
			switch parent {
			case "message":
				messageClosed = true
				result.BodyComplete = !result.QuerySeen
			case "message/emotion", "message/activity":
				cueValue[item.Name.Local] = strings.TrimSpace(capture.String())
			case "message/query":
				result.Query = strings.TrimSpace(capture.String())
			case "action/prompt-payload/prompt-text":
				action.promptText.WriteString(capture.String())
			case "time-hook/delay-ms":
				delay, err := strconv.Atoi(strings.TrimSpace(capture.String()))
				if err != nil || delay <= 0 {
					return fail(fmt.Errorf("APML time-hook delay must be positive"))
				}
				hook.delayMs = delay
			case "time-hook/effect/prompt-text":
				hook.prompt.WriteString(capture.String())
			case "action":
				next, err := publicChatStructuredActionFromAPMLDraft(*action, result.Envelope.Message.MessageID, len(result.Envelope.Actions))
				if err != nil {
					return fail(err)
				}
				result.Envelope.Actions = append(result.Envelope.Actions, next)
				action = nil
			case "time-hook":
				next, err := publicChatStructuredFollowUpActionFromAPMLHook(*hook, result.Envelope.Message.MessageID, len(result.Envelope.Actions))
				if err != nil {
					return fail(err)
				}
				result.Envelope.Actions = append(result.Envelope.Actions, next)
				hook = nil
			}
			path = path[:len(path)-1]
		case xml.Comment, xml.Directive, xml.ProcInst:
			return fail(fmt.Errorf("APML comments and directives are not admitted"))
		}
	}
}

// Token can reject a whole CharData token for a bad/incomplete entity or
// character. Recover only the syntactically determined prefix of that exact
// direct-text region, never markup, a cue, query or control content.
func publicChatAPMLCharacterPrefix(raw string) string {
	var out strings.Builder
	for len(raw) > 0 {
		if raw[0] == '<' {
			break
		}
		if raw[0] == '&' {
			end := strings.IndexByte(raw, ';')
			if end < 0 {
				break
			}
			decoder := xml.NewDecoder(strings.NewReader(raw[:end+1]))
			token, err := decoder.Token()
			text, ok := token.(xml.CharData)
			if err != nil || !ok {
				break
			}
			out.Write([]byte(text))
			raw = raw[end+1:]
			continue
		}
		char, size := utf8.DecodeRuneInString(raw)
		if (char == utf8.RuneError && size == 1) || !(char == '\t' || char == '\n' || char == '\r' ||
			(char >= 0x20 && char <= 0xD7FF) || (char >= 0xE000 && char <= 0xFFFD) || (char >= 0x10000 && char <= 0x10FFFF)) {
			break
		}
		if char == '>' && strings.HasSuffix(out.String(), "]]") {
			break
		}
		out.WriteRune(char)
		raw = raw[size:]
	}
	return out.String()
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

// @nimi-authority: definition.nimi.runtime.agent-participation.output-wire-plane
func normalizePublicChatAPMLText(value string) string {
	// Message text is user-visible content. Paragraphs, list indentation and code
	// spacing must survive the APML carrier; only surrounding whitespace is framing.
	value = strings.ReplaceAll(value, "\r\n", "\n")
	value = strings.ReplaceAll(value, "\r", "\n")
	return strings.TrimSpace(value)
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
	if hook.triggerFamily == "time" && (hook.delayMs <= 0 || int64(hook.delayMs) > math.MaxInt64/int64(time.Millisecond)) {
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
