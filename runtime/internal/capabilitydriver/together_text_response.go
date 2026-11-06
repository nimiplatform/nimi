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

// The field name is native replay state too. Together models use either field;
// never silently rename a provider's prior assistant turn on the way back out.
type togetherReplay struct {
	Field string `json:"field"`
	Text  string `json:"text"`
}

func (p TogetherTextBehavior) readReplay(c *runtimev1.ReasoningContinuityCarrier) (togetherReplay, error) {
	var v togetherReplay
	if !textbehavior.ValidContinuity(c) || c.GetKind() != p.ContinuityKind() || c.GetVersion() != 1 || !utf8.Valid(c.GetPayload()) {
		return v, nativeReasoningReplayInvalid()
	}
	d := json.NewDecoder(bytes.NewReader(c.Payload))
	d.DisallowUnknownFields()
	var wire struct {
		Field *string `json:"field"`
		Text  *string `json:"text"`
	}
	if d.Decode(&wire) != nil || d.Decode(new(any)) != io.EOF || wire.Field == nil || wire.Text == nil || *wire.Field != "reasoning" && *wire.Field != "reasoning_content" {
		return v, nativeReasoningReplayInvalid()
	}
	v.Field, v.Text = *wire.Field, *wire.Text
	return v, nil
}
func (p TogetherTextBehavior) repack(c *runtimev1.ReasoningContinuityCarrier, field string) error {
	value, err := readNativeReasoningReplay(c, p.ContinuityKind())
	if err != nil {
		return err
	}
	if field != "reasoning" && field != "reasoning_content" {
		return nativeReasoningReplayInvalid()
	}
	c.Payload, err = json.Marshal(togetherReplay{Field: field, Text: value})
	if err != nil || !textbehavior.ValidContinuity(c) {
		return nativeReasoningReplayInvalid()
	}
	return nil
}
func (p TogetherTextBehavior) envelope(payload []byte, seen bool) ([]byte, string, bool, error) {
	invalid := func() ([]byte, string, bool, error) { return nil, "", seen, deepseekJSONOutputError() }
	if !utf8.Valid(payload) {
		return invalid()
	}
	var raw map[string]json.RawMessage
	if json.Unmarshal(payload, &raw) != nil || raw == nil {
		return invalid()
	}
	if e := raw["error"]; len(e) > 0 && string(e) != "null" {
		return nil, "", seen, fireworksStreamError(e)
	}
	var model string
	if value, ok := raw["model"]; ok {
		if json.Unmarshal(value, &model) != nil || model != p.model {
			return invalid()
		}
		seen = true
	}
	if !seen {
		return invalid()
	}
	var choices []map[string]json.RawMessage
	if json.Unmarshal(raw["choices"], &choices) != nil || len(choices) > 1 {
		return invalid()
	}
	field := ""
	for _, choice := range choices {
		var finish string
		_ = json.Unmarshal(choice["finish_reason"], &finish)
		if finish == "length" {
			return nil, "", seen, deepseekIncomplete()
		}
		for _, slot := range []string{"message", "delta"} {
			if len(choice[slot]) == 0 || string(choice[slot]) == "null" {
				continue
			}
			var message map[string]json.RawMessage
			if json.Unmarshal(choice[slot], &message) != nil {
				return invalid()
			}
			for _, key := range []string{"reasoning", "reasoning_content"} {
				value, ok := message[key]
				if !ok || string(value) == "null" {
					continue
				}
				var text string
				if field != "" || json.Unmarshal(value, &text) != nil {
					return invalid()
				}
				field = key
			}
			if field == "reasoning" {
				message["reasoning_content"] = message["reasoning"]
				delete(message, "reasoning")
			}
			choice[slot], _ = json.Marshal(message)
		}
	}
	raw["choices"], _ = json.Marshal(choices)
	clean, err := json.Marshal(raw)
	return clean, field, seen, err
}
func (p TogetherTextBehavior) result(r textbehavior.NormalizedResult, s *runtimev1.TextGenerateScenarioSpec, field string) (textbehavior.NormalizedResult, error) {
	for i := range r.Items {
		if c := r.Items[i].ReasoningContinuity; c != nil {
			if err := p.repack(c, field); err != nil {
				return textbehavior.NormalizedResult{}, err
			}
		}
	}
	if s.GetResponseFormat().GetKind() == runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA && r.FinishReason == runtimev1.FinishReason_FINISH_REASON_STOP {
		return validateStrictChatSchemaResult(r, s)
	}
	return r, nil
}
func (p TogetherTextBehavior) Parse(data []byte, s *runtimev1.TextGenerateScenarioSpec) (textbehavior.NormalizedResult, error) {
	clean, field, _, err := p.envelope(data, false)
	if err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	_, required, err := p.reasoning(s)
	if err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	r, err := parseReasoningChatResponseWithPolicy(clean, s, p.ContinuityKind(), required)
	if err != nil {
		return r, err
	}
	return p.result(r, s, field)
}

type togetherTextStream struct {
	profile TogetherTextBehavior
	spec    *runtimev1.TextGenerateScenarioSpec
	inner   textbehavior.StreamFragmentAssembler
	seen    bool
	field   string
}

func (p TogetherTextBehavior) Stream(s *runtimev1.TextGenerateScenarioSpec) (textbehavior.StreamFragmentAssembler, error) {
	_, required, err := p.reasoning(s)
	if err != nil {
		return nil, err
	}
	inner := newReasoningChatStream(s, p.ContinuityKind()).(*reasoningChatStream)
	inner.optional = !required
	return &togetherTextStream{profile: p, spec: s, inner: inner}, nil
}
func (s *togetherTextStream) Append(data []byte) ([]textbehavior.OrderedDelta, error) {
	clean := data
	if strings.TrimSpace(string(data)) != "[DONE]" {
		var field string
		var err error
		clean, field, s.seen, err = s.profile.envelope(data, s.seen)
		if err != nil {
			return nil, err
		}
		if field != "" {
			if s.field != "" && s.field != field {
				return nil, deepseekJSONOutputError()
			}
			s.field = field
		}
	}
	deltas, err := s.inner.Append(clean)
	if err != nil {
		return nil, err
	}
	for i := range deltas {
		if c := deltas[i].ReasoningContinuity; c != nil {
			if err := s.profile.repack(c, s.field); err != nil {
				return nil, err
			}
		}
	}
	return deltas, nil
}
func (s *togetherTextStream) Finish() (textbehavior.NormalizedResult, error) {
	r, err := s.inner.Finish()
	if err != nil {
		return r, err
	}
	return s.profile.result(r, s.spec, s.field)
}
