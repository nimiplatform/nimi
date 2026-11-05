package capabilitydriver

import (
	"bytes"
	"encoding/json"
	"io"
	"strings"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
)

// Native thinking blocks remain typed replay data, including signatures and
// closed flags. They are neither concatenated with answers nor called encrypted.
type mistralThinkingState struct {
	chunks []map[string]any
	sealed bool
}

func validMistralThinking(chunk map[string]any) bool {
	if chunk["type"] != "thinking" {
		return false
	}
	for key, value := range chunk {
		switch key {
		case "type", "thinking":
		case "signature":
			if value != nil {
				if _, ok := value.(string); !ok {
					return false
				}
			}
		case "closed":
			if _, ok := value.(bool); !ok {
				return false
			}
		default:
			return false
		}
	}
	parts, ok := chunk["thinking"].([]any)
	if !ok {
		return false
	}
	for _, raw := range parts {
		part, ok := raw.(map[string]any)
		if !ok {
			return false
		}
		switch part["type"] {
		case "text":
			if len(part) != 2 {
				return false
			}
			if _, ok := part["text"].(string); !ok {
				return false
			}
		case "reference":
			if len(part) != 2 {
				return false
			}
			ids, ok := part["reference_ids"].([]any)
			if !ok {
				return false
			}
			for _, id := range ids {
				switch v := id.(type) {
				case string:
				case json.Number:
					if _, err := v.Int64(); err != nil {
						return false
					}
				default:
					return false
				}
			}
		case "tool_reference":
			if _, ok := part["tool"].(string); !ok {
				return false
			}
			if _, ok := part["title"].(string); !ok {
				return false
			}
			for k, v := range part {
				switch k {
				case "type", "tool", "title":
				case "url", "favicon", "description":
					if v != nil {
						if _, ok := v.(string); !ok {
							return false
						}
					}
				default:
					return false
				}
			}
		default:
			return false
		}
	}
	return true
}

func readMistralThinking(payload []byte) ([]map[string]any, error) {
	if !utf8.Valid(payload) {
		return nil, nativeReasoningReplayInvalid()
	}
	var chunks []map[string]any
	d := json.NewDecoder(bytes.NewReader(payload))
	d.UseNumber()
	if d.Decode(&chunks) != nil || d.Decode(new(any)) != io.EOF || len(chunks) == 0 {
		return nil, nativeReasoningReplayInvalid()
	}
	for _, chunk := range chunks {
		if !validMistralThinking(chunk) || chunk["closed"] == false {
			return nil, nativeReasoningReplayInvalid()
		}
	}
	return chunks, nil
}

func (s *mistralThinkingState) append(chunk map[string]any, stream bool) error {
	if s.sealed || !validMistralThinking(chunk) {
		return deepseekJSONOutputError()
	}
	// An explicitly open block is continued by subsequent native thinking
	// fragments; only its own closing flag closes it, never an invented marker.
	if stream && len(s.chunks) > 0 && s.chunks[len(s.chunks)-1]["closed"] == false {
		last := s.chunks[len(s.chunks)-1]
		last["thinking"] = append(last["thinking"].([]any), chunk["thinking"].([]any)...)
		if signature, present := chunk["signature"]; present && signature != nil {
			if previous := last["signature"]; previous != nil && previous != signature {
				return deepseekJSONOutputError()
			}
			last["signature"] = signature
		}
		if closed, present := chunk["closed"]; present {
			last["closed"] = closed
		}
	} else {
		s.chunks = append(s.chunks, chunk)
	}
	encoded, err := json.Marshal(s.chunks)
	if err != nil || len(encoded) > textbehavior.MaxReasoningContinuityPayloadBytes {
		return nativeReasoningReplayInvalid()
	}
	return nil
}

func (s *mistralThinkingState) carrier(kind string) (*runtimev1.ReasoningContinuityCarrier, error) {
	if len(s.chunks) == 0 {
		return nil, nil
	}
	for _, chunk := range s.chunks {
		if chunk["closed"] == false {
			return nil, deepseekIncomplete()
		}
	}
	payload, err := json.Marshal(s.chunks)
	if err != nil {
		return nil, deepseekJSONOutputError()
	}
	return nativeReasoningReplay(kind, string(payload))
}

func (s *mistralThinkingState) transform(payload []byte, stream bool) ([]byte, bool, error) {
	if !utf8.Valid(payload) {
		return nil, false, deepseekJSONOutputError()
	}
	var body map[string]any
	d := json.NewDecoder(bytes.NewReader(payload))
	d.UseNumber()
	if d.Decode(&body) != nil || d.Decode(new(any)) != io.EOF || body == nil {
		return nil, false, deepseekJSONOutputError()
	}
	choices, ok := body["choices"].([]any)
	if !ok || len(choices) > 1 {
		return nil, false, deepseekJSONOutputError()
	}
	for _, raw := range choices {
		choice, ok := raw.(map[string]any)
		if !ok {
			return nil, false, deepseekJSONOutputError()
		}
		key := "message"
		if stream {
			key = "delta"
		}
		if message, ok := choice[key].(map[string]any); ok {
			if message["reasoning_content"] != nil {
				return nil, false, deepseekJSONOutputError()
			}
			var answer strings.Builder
			switch content := message["content"].(type) {
			case nil:
			case string:
				answer.WriteString(content)
			case []any:
				for _, rawPart := range content {
					part, ok := rawPart.(map[string]any)
					if !ok {
						return nil, false, deepseekJSONOutputError()
					}
					switch part["type"] {
					case "thinking":
						if err := s.append(part, stream); err != nil {
							return nil, false, err
						}
					case "text":
						text, ok := part["text"].(string)
						if !ok || len(part) != 2 {
							return nil, false, deepseekJSONOutputError()
						}
						if text != "" {
							s.sealed = true
						}
						answer.WriteString(text)
					default:
						return nil, false, deepseekJSONOutputError()
					}
				}
			default:
				return nil, false, deepseekJSONOutputError()
			}
			message["content"] = answer.String()
			if answer.Len() > 0 {
				s.sealed = true
			}
			if calls, ok := message["tool_calls"].([]any); ok && len(calls) > 0 {
				s.sealed = true
			}
		}
		if choice["finish_reason"] != nil {
			s.sealed = true
			if choice["finish_reason"] == "model_length" {
				choice["finish_reason"] = "length"
			}
		}
	}
	clean, err := json.Marshal(body)
	return clean, s.sealed, err
}

type mistralTextStream struct {
	profile  MistralTextBehavior
	spec     *runtimev1.TextGenerateScenarioSpec
	inner    textbehavior.StreamFragmentAssembler
	thinking mistralThinkingState
	sealed   bool
	carrier  *runtimev1.ReasoningContinuityCarrier
}

func (s *mistralTextStream) Append(payload []byte) ([]textbehavior.OrderedDelta, error) {
	if mistralIsDONE(payload) {
		return s.inner.Append(payload)
	}
	clean, seal, err := s.thinking.transform(payload, true)
	if err != nil {
		return nil, err
	}
	if s.spec.GetReasoning().GetActivation() == runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED && len(s.thinking.chunks) > 0 {
		return nil, deepseekJSONOutputError()
	}
	var first []textbehavior.OrderedDelta
	if seal && !s.sealed {
		s.sealed = true
		s.carrier, err = s.thinking.carrier(s.profile.ContinuityKind())
		if err != nil {
			return nil, err
		}
		if s.carrier != nil {
			first = append(first, textbehavior.OrderedDelta{ItemIndex: 0, Kind: textbehavior.OrderedItemReasoningContinuity, ReasoningContinuity: s.carrier, ItemCompleted: true})
		}
	}
	deltas, err := s.inner.Append(clean)
	if err != nil {
		return nil, err
	}
	if s.carrier != nil {
		for i := range deltas {
			deltas[i].ItemIndex++
		}
	}
	return append(first, deltas...), nil
}

func (s *mistralTextStream) Finish() (textbehavior.NormalizedResult, error) {
	result, err := s.inner.Finish()
	if err != nil {
		return result, err
	}
	if s.spec.GetResponseFormat().GetKind() == runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA {
		if result.FinishReason != runtimev1.FinishReason_FINISH_REASON_STOP {
			return textbehavior.NormalizedResult{}, deepseekIncomplete()
		}
		var text strings.Builder
		for _, item := range result.Items {
			if item.Kind == textbehavior.OrderedItemText {
				text.WriteString(item.Text)
			}
		}
		var instance any
		d := json.NewDecoder(strings.NewReader(text.String()))
		d.UseNumber()
		if d.Decode(&instance) != nil || d.Decode(new(any)) != io.EOF {
			return textbehavior.NormalizedResult{}, deepseekJSONOutputError()
		}
		schema, err := textbehavior.CompileJSONSchema(s.spec.GetResponseFormat().GetJsonSchema().AsMap())
		if err != nil || schema.Validate(instance) != nil {
			return textbehavior.NormalizedResult{}, deepseekJSONOutputError()
		}
	}
	if s.carrier != nil {
		result.Items = append([]textbehavior.OrderedItem{{Kind: textbehavior.OrderedItemReasoningContinuity, ReasoningContinuity: s.carrier}}, result.Items...)
	}
	return result, nil
}
