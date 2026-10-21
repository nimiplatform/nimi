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

func startsWithAPMLRoot(value, root string) bool {
	prefix := "<" + root
	if !strings.HasPrefix(value, prefix) || len(value) == len(prefix) {
		return false
	}
	switch value[len(prefix)] {
	case ' ', '\t', '\n', '\r', '>', '/':
		return true
	default:
		return false
	}
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
	ResponseKind string
	Err          error
}

func parsePublicChatAPMLOutput(raw string) (*publicChatStructuredEnvelope, error) {
	return publicChatAPMLReply(interpretPublicChatAPML(raw))
}

func publicChatAPMLReply(result *publicChatAPMLInterpretation) (*publicChatStructuredEnvelope, error) {
	if result.QuerySeen || strings.TrimSpace(result.Envelope.Message.Text) == "" {
		if result.Err != nil {
			return nil, result.Err
		}
		return nil, fmt.Errorf("APML public message is incomplete")
	}
	if !result.BodyComplete {
		// A normally finished generation can have malformed decoration after
		// readable public text. Keep that same streamed text, without effects.
		return &publicChatStructuredEnvelope{
			SchemaID: publicChatStructuredSchemaID,
			Message:  result.Envelope.Message,
		}, nil
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
	raw = publicChatCarrierContent(raw)
	if !startsWithAPMLRoot(raw, "message") {
		text, tail := publicChatPlainReplyPartsMode(raw, false)
		if startsWithAPMLRoot(tail, "message") {
			result := interpretPublicChatXML(prepareAPMLReplyBody(tail, false))
			if !result.QuerySeen && result.Envelope.Message.Text != "" {
				if text != "" {
					text += "\n\n"
				}
				text += result.Envelope.Message.Text
			}
		}
		return text, text != ""
	}
	result := interpretPublicChatXML(prepareAPMLReplyBody(raw, false))
	return result.Envelope.Message.Text, result.MessageSeen
}

func interpretPublicChatAPML(raw string) *publicChatAPMLInterpretation {
	return interpretPublicChatXML(prepareAPMLReplyBody(raw, true))
}

func interpretPublicChatXML(raw string) (result *publicChatAPMLInterpretation) {
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
	var messageClosed, hookSeen, intentionSeen, confirmationSeen bool
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
			if len(path) >= 2 && path[0] == "message" && (path[1] == "self-intention" || path[1] == "intention-confirmation") {
				path = append(path, name)
				continue
			}
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
				intentCount := 0
				for _, attr := range item.Attr {
					if attr.Name.Local == "intent" {
						intentCount++
					}
				}
				if intentCount != 1 {
					return fail(fmt.Errorf("APML message requires exactly one intent"))
				}
				result.ResponseKind = xmlAttr(item, "intent")
				if result.ResponseKind != "reply" && result.ResponseKind != "recall" {
					return fail(fmt.Errorf("APML message requires reply or recall intent"))
				}
			case !messageClosed:
				if parent != "message" {
					return fail(fmt.Errorf("APML private query must contain text only"))
				}
				switch {
				case isCue:
					if result.ResponseKind != "reply" {
						return fail(fmt.Errorf("private intent cannot carry presentation cues"))
					}
					result.CuePresent = true
					if result.QuerySeen {
						return fail(fmt.Errorf("APML query must be the only message child"))
					}
					cueCount[name]++
					if cueCount[name] > 1 || requirePublicChatAPMLAttrs(item, name) != nil {
						cueInvalid[name] = true
					}
					capture.Reset()
				case name == "self-intention" || name == "intention-confirmation":
					result.Envelope.IntentionSuggested = true
					result.Envelope.ControlError = "self-intention must follow the closed message"
				case name == "query":
					if result.ResponseKind != "recall" {
						result.QuerySeen = true
						return fail(fmt.Errorf("query requires recall intent"))
					}
					wasQuery := result.QuerySeen
					result.QuerySeen = true
					if wasQuery || len(cueCount) != 0 || strings.TrimSpace(text.String()) != "" || requirePublicChatAPMLAttrs(item, name) != nil {
						return fail(fmt.Errorf("APML query must be the only message content"))
					}
					capture.Reset()
				default:
					return fail(fmt.Errorf("unsupported APML message child: %s", name))
				}
			case result.QuerySeen:
				return fail(fmt.Errorf("APML private query must not have trailing controls"))
			case parent == "":
				switch name {
				case "self-intention", "intention-confirmation":
					result.Envelope.IntentionSuggested = true
					if requirePublicChatAPMLAttrs(item, name) != nil || name == "self-intention" && intentionSeen || name == "intention-confirmation" && confirmationSeen {
						return fail(fmt.Errorf("duplicate or malformed self-intention"))
					}
					if name == "self-intention" {
						intentionSeen = true
					} else {
						confirmationSeen = true
					}
					capture.Reset()
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
			default:
				return fail(fmt.Errorf("APML control is in an invalid position"))
			}
			path = append(path, name)
		case xml.CharData:
			value := string(item)
			if len(path) >= 2 && path[0] == "message" && (path[1] == "self-intention" || path[1] == "intention-confirmation") {
				continue
			}
			switch parent {
			case "message":
				if result.ResponseKind != "reply" && strings.TrimSpace(value) != "" {
					return fail(fmt.Errorf("APML query must not be mixed with public text"))
				}
				if result.ResponseKind == "reply" {
					text.WriteString(value)
				}
			case "message/emotion", "message/activity", "message/query",
				"action/prompt-payload/prompt-text", "time-hook/delay-ms", "self-intention", "intention-confirmation":
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
			case "self-intention":
				result.Envelope.SelfIntentionRaw = strings.TrimSpace(capture.String())
			case "intention-confirmation":
				result.Envelope.IntentionConfirmation = strings.TrimSpace(capture.String())
			case "message":
				messageClosed = true
				result.BodyComplete = result.ResponseKind == "reply"
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

// Normalize only the public reply body. The closing carrier and its effect
// tail remain byte-for-byte input to the strict interpreter. Markdown literal
// regions may contain angle brackets; they never define executable effects.
func prepareAPMLReplyBody(raw string, final bool) string {
	header := xml.NewDecoder(strings.NewReader(raw))
	token, err := header.Token()
	root, ok := token.(xml.StartElement)
	if err != nil || !ok || root.Name.Local != "message" || root.Name.Space != "" || xmlAttr(root, "intent") != "reply" {
		return raw
	}
	start := int(header.InputOffset())
	end := replyMessageBodyEnd(raw, start)
	bodyClosed := end < len(raw)
	// Body boundaries are structural. Never use an effect-tail delimiter to
	// close a Markdown span that began in the public message.
	if !final {
		if index, _, _, _, pending := nextReplyWireMarkerMode(raw[start:end], privateReplyWireNames, false); index >= 0 && pending {
			raw = raw[:start+index]
			end = len(raw)
		}
	}
	var out strings.Builder
	out.WriteString(raw[:start])
	for i := start; i < end; {
		if raw[i] == '\\' && i+1 < end {
			out.WriteString(raw[i : i+2])
			i += 2
			continue
		}
		if next, code := replyCodeEnd(raw[:end], i); code {
			out.WriteString(escapeReplyLiteralXML(raw[i:next]))
			i = next
			continue
		}
		if raw[i] == '<' {
			if next := replyAutolinkEnd(raw[:end], i); next > i {
				out.WriteString(escapeReplyLiteralXML(raw[i:next]))
				i = next
				continue
			}
			// A protocol element is interpreted as a whole. In particular, never
			// clean nested text inside a cue, query or private intention payload.
			decoder := xml.NewDecoder(strings.NewReader(raw[i:end]))
			token, err := decoder.Token()
			if err == nil {
				next := i + int(decoder.InputOffset())
				if tag, ok := token.(xml.StartElement); ok && !strings.HasSuffix(raw[i:next], "/>") {
					close := "</" + tag.Name.Local + ">"
					if last := strings.Index(raw[next:end], close); last >= 0 {
						next += last + len(close)
					} else {
						next = end
					}
					if tag.Name.Space == "" && strings.Contains(" "+invalidReplyWireNames+" ", " "+tag.Name.Local+" ") {
						i = next
						continue
					}
				}
				out.WriteString(raw[i:next])
				i = next
				continue
			}
		}
		// Bare ampersands in prose/code are literal; entity candidates keep the
		// interpreter's existing single-decoding and incomplete-prefix behavior.
		if raw[i] == '&' {
			j := i + 1
			for j < end && strings.ContainsRune("#ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", rune(raw[j])) {
				j++
			}
			if j == end && !final && !bodyClosed {
				out.WriteString(raw[i:end])
				break
			}
			if j == end || raw[j] != ';' {
				out.WriteString("&amp;")
				i++
				continue
			}
		}
		out.WriteByte(raw[i])
		i++
	}
	out.WriteString(raw[end:])
	return out.String()
}

// Partition the carrier before interpreting Markdown. Closing-tag literals may
// occur in the body, but the first protocol tail fixes the last message close
// before it. Neither Markdown nor malformed tail text can extend public code
// into that tail. Private payload bytes are never examined as public text.
func replyMessageBodyEnd(raw string, start int) int {
	last := -1
	names := "message apml:message " + privateReplyWireNames
	for at := start; at < len(raw); {
		next := strings.IndexByte(raw[at:], '<')
		if next < 0 {
			break
		}
		index := at + next
		at = index + 1
		found, end, name, closing, partial := replyWireMarkerAt(raw, names, index)
		if found < 0 {
			continue
		}
		if !partial && closing && name == "message" && raw[end-1] == '>' {
			last = index
		} else if last >= 0 {
			return last
		}
		at = end
	}
	if last >= 0 {
		return last
	}
	return len(raw)
}

func replyAutolinkEnd(raw string, start int) int {
	last := strings.IndexByte(raw[start:], '>')
	if last < 0 {
		return start
	}
	value := raw[start+1 : start+last]
	if strings.ContainsAny(value, "<> \t\r\n") {
		return start
	}
	if strings.IndexByte(value, ':') > 1 || strings.IndexByte(value, '@') > 0 {
		return start + last + 1
	}
	return start
}

func escapeReplyLiteralXML(raw string) string {
	var out strings.Builder
	for len(raw) > 0 {
		if raw[0] == '&' {
			if last := strings.IndexByte(raw, ';'); last >= 0 {
				token, err := xml.NewDecoder(strings.NewReader(raw[:last+1])).Token()
				if _, ok := token.(xml.CharData); err == nil && ok {
					out.WriteString(raw[:last+1])
					raw = raw[last+1:]
					continue
				}
			}
		}
		switch raw[0] {
		case '<':
			out.WriteString("&lt;")
		case '>':
			out.WriteString("&gt;")
		case '&':
			out.WriteString("&amp;")
		default:
			out.WriteByte(raw[0])
		}
		raw = raw[1:]
	}
	return out.String()
}

// Token can reject a whole CharData token for a bad/incomplete entity or
// character. Recover only the syntactically determined prefix of that exact
// direct-text region, never markup, a cue, query or control content.
func publicChatAPMLCharacterPrefix(raw string) string {
	var out strings.Builder
	for len(raw) > 0 {
		if raw[0] == '<' {
			// An unescaped ordinary comparison is readable public text. Do not
			// recover through a tag or a private effect when the carrier is bad.
			if len(raw) < 2 || !strings.ContainsRune(" \t\r\n0123456789=", rune(raw[1])) {
				break
			}
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
	if hook.delayMs > 3600000 {
		return publicChatStructuredAction{}, fmt.Errorf("autonomous continuation delay exceeds one hour; user task scheduling belongs to Personal Agent products")
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
			PromptText:    publicChatContinuationInstruction,
			DelayMs:       hook.delayMs,
			TriggerFamily: hook.triggerFamily,
			TriggerEvent:  hook.triggerEvent,
			IdleMs:        hook.idleMs,
		},
	}, nil
}
