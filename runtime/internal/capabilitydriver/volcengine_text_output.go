package capabilitydriver

import (
	"encoding/json"
	"strings"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
)

type volcengineReasoningState struct {
	summary        strings.Builder
	summaryPresent bool
	encrypted      bool
	boundary       bool
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r088
// On the six summary-capable Seed targets, reasoning_content is never replayed
// as original thoughts. The separate encrypted_content string is preserved.
func (p VolcengineTextBehavior) normalizeEnvelope(raw []byte, spec *runtimev1.TextGenerateScenarioSpec, state *volcengineReasoningState) ([]byte, error) {
	if !utf8.Valid(raw) {
		return nil, deepseekJSONOutputError()
	}
	var out map[string]json.RawMessage
	if json.Unmarshal(raw, &out) != nil || out == nil {
		return nil, deepseekJSONOutputError()
	}
	if errorData := out["error"]; len(errorData) > 0 && string(errorData) != "null" {
		return nil, fireworksStreamError(errorData)
	}
	if value := out["model"]; len(value) > 0 {
		var model string
		if json.Unmarshal(value, &model) != nil || model != p.model {
			return nil, deepseekJSONOutputError()
		}
	}
	var choices []map[string]json.RawMessage
	if json.Unmarshal(out["choices"], &choices) != nil || len(choices) > 1 {
		return nil, deepseekJSONOutputError()
	}
	for _, choice := range choices {
		var finish *string
		if rawFinish := choice["finish_reason"]; len(rawFinish) > 0 && json.Unmarshal(rawFinish, &finish) != nil {
			return nil, deepseekJSONOutputError()
		}
		if finish != nil && *finish == "length" {
			return nil, deepseekIncomplete()
		}
		for _, key := range []string{"message", "delta"} {
			value, exists := choice[key]
			if !exists || string(value) == "null" {
				continue
			}
			var message map[string]json.RawMessage
			if json.Unmarshal(value, &message) != nil || message == nil {
				return nil, deepseekJSONOutputError()
			}
			var reasoning, encrypted *string
			if v, ok := message["reasoning_content"]; ok && json.Unmarshal(v, &reasoning) != nil {
				return nil, deepseekJSONOutputError()
			}
			if v, ok := message["encrypted_content"]; ok && json.Unmarshal(v, &encrypted) != nil {
				return nil, deepseekJSONOutputError()
			}
			if spec.GetReasoning().GetActivation() == runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED && (reasoning != nil && *reasoning != "" || encrypted != nil && *encrypted != "") {
				return nil, deepseekJSONOutputError()
			}
			if p.EncryptedReasoning() {
				delete(message, "reasoning_content")
				delete(message, "encrypted_content")
				if reasoning != nil && *reasoning != "" {
					if state.encrypted || state.boundary {
						return nil, deepseekJSONOutputError()
					}
					state.summaryPresent = state.summaryPresent || strings.TrimSpace(*reasoning) != ""
					if spec.GetReasoning().GetPresentation() == runtimev1.ReasoningPresentation_REASONING_PRESENTATION_SUMMARY {
						if state.summary.Len()+len(*reasoning) > 1<<20 {
							return nil, deepseekJSONOutputError()
						}
						state.summary.WriteString(*reasoning)
					}
				}
				if encrypted != nil && *encrypted != "" {
					if state.encrypted || state.boundary {
						return nil, nativeReasoningReplayInvalid()
					}
					state.encrypted = true
					message["reasoning_content"], _ = json.Marshal(*encrypted)
				}
			} else if encrypted != nil && *encrypted != "" {
				return nil, nativeReasoningReplayInvalid()
			}
			var content *string
			if v, ok := message["content"]; ok && json.Unmarshal(v, &content) != nil {
				return nil, deepseekJSONOutputError()
			}
			var calls []json.RawMessage
			if v, ok := message["tool_calls"]; ok && json.Unmarshal(v, &calls) != nil {
				return nil, deepseekJSONOutputError()
			}
			if content != nil && *content != "" || len(calls) > 0 || finish != nil {
				if p.EncryptedReasoning() && state.summaryPresent && !state.encrypted {
					return nil, nativeReasoningReplayInvalid()
				}
				state.boundary = true
			}
			choice[key], _ = json.Marshal(message)
		}
	}
	out["choices"], _ = json.Marshal(choices)
	return json.Marshal(out)
}

func volcengineStructuredResult(r textbehavior.NormalizedResult, s *runtimev1.TextGenerateScenarioSpec) (textbehavior.NormalizedResult, error) {
	if s.GetResponseFormat().GetKind() == runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA && r.FinishReason == runtimev1.FinishReason_FINISH_REASON_STOP {
		return validateStrictChatSchemaResult(r, s)
	}
	return r, nil
}
func (p VolcengineTextBehavior) Parse(raw []byte, s *runtimev1.TextGenerateScenarioSpec) (textbehavior.NormalizedResult, error) {
	_, _, err := p.reasoning(s)
	if err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	state := &volcengineReasoningState{}
	clean, err := p.normalizeEnvelope(raw, s, state)
	if err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	r, err := parseReasoningChatResponseWithPolicy(clean, s, p.ContinuityKind(), false)
	if err != nil {
		return r, err
	}
	if state.summaryPresent && state.summary.Len() > 0 {
		r.Items = append([]textbehavior.OrderedItem{{Kind: textbehavior.OrderedItemReasoningSummary, Text: state.summary.String()}}, r.Items...)
	}
	return volcengineStructuredResult(r, s)
}

type volcengineTextStream struct {
	profile        VolcengineTextBehavior
	spec           *runtimev1.TextGenerateScenarioSpec
	inner          textbehavior.StreamFragmentAssembler
	state          volcengineReasoningState
	summaryEmitted bool
}

func (p VolcengineTextBehavior) Stream(s *runtimev1.TextGenerateScenarioSpec) (textbehavior.StreamFragmentAssembler, error) {
	_, _, err := p.reasoning(s)
	if err != nil {
		return nil, err
	}
	inner := newReasoningChatStream(s, p.ContinuityKind()).(*reasoningChatStream)
	inner.optional = true
	return &volcengineTextStream{profile: p, spec: s, inner: inner}, nil
}
func (s *volcengineTextStream) Append(raw []byte) ([]textbehavior.OrderedDelta, error) {
	clean := raw
	if strings.TrimSpace(string(raw)) != "[DONE]" {
		var err error
		clean, err = s.profile.normalizeEnvelope(raw, s.spec, &s.state)
		if err != nil {
			return nil, err
		}
	}
	var prefix []textbehavior.OrderedDelta
	if !s.summaryEmitted && s.state.summaryPresent && s.state.summary.Len() > 0 && (s.state.encrypted || s.state.boundary) {
		s.summaryEmitted = true
		prefix = append(prefix, textbehavior.OrderedDelta{ItemIndex: 0, Kind: textbehavior.OrderedItemReasoningSummary, Text: s.state.summary.String(), ItemCompleted: true})
	}
	deltas, err := s.inner.Append(clean)
	if err != nil {
		return nil, err
	}
	if s.summaryEmitted {
		for i := range deltas {
			deltas[i].ItemIndex++
		}
	}
	return append(prefix, deltas...), nil
}
func (s *volcengineTextStream) Finish() (textbehavior.NormalizedResult, error) {
	if s.profile.EncryptedReasoning() && s.state.summaryPresent && !s.state.encrypted {
		return textbehavior.NormalizedResult{}, nativeReasoningReplayInvalid()
	}
	r, err := s.inner.Finish()
	if err != nil {
		return r, err
	}
	if s.summaryEmitted {
		r.Items = append([]textbehavior.OrderedItem{{Kind: textbehavior.OrderedItemReasoningSummary, Text: s.state.summary.String()}}, r.Items...)
	}
	return volcengineStructuredResult(r, s.spec)
}
