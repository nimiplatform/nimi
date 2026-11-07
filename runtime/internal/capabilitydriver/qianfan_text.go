package capabilitydriver

import (
	"context"
	"encoding/json"
	"strings"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
)

type QianfanTextBehavior struct{}

func qianfanUnsupported(detail string) error {
	return (&responsesProfile{label: "Qianfan ERNIE 5.1"}).unsupported(detail)
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r088
func (p QianfanTextBehavior) Serialize(s *runtimev1.TextGenerateScenarioSpec, stream bool) (textbehavior.SerializedRequest, error) {
	// ERNIE controls are not the open-source-model defaults documented by the
	// same platform. Preserve native defaults where exact semantics are absent.
	if s == nil || s.GetIncludeRawChunks() || s.Temperature != nil || s.TopP != nil || s.TopK != nil || s.FrequencyPenalty != nil || s.PresencePenalty != nil || s.GetReasoning() != nil {
		return textbehavior.SerializedRequest{}, qianfanUnsupported("unreviewed ERNIE sampling or reasoning control")
	}
	if s.MaxTokens != nil && (s.GetMaxTokens() < 1 || s.GetMaxTokens() > 65536) || s.Seed != nil && (s.GetSeed() < 1 || s.GetSeed() >= 2147483647) || len(s.GetStop()) > 4 {
		return textbehavior.SerializedRequest{}, qianfanUnsupported("native output, seed or stop bounds")
	}
	for _, stop := range s.GetStop() {
		if stop == "" || utf8.RuneCountInString(stop) > 20 {
			return textbehavior.SerializedRequest{}, qianfanUnsupported("stop sequence length")
		}
	}
	f := s.GetResponseFormat()
	if f.GetStrict() || f.GetJsonSchema() != nil || f.GetSchemaName() != "" || f.GetSchemaDescription() != "" || f.GetKind() != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_UNSPECIFIED && f.GetKind() != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_TEXT && f.GetKind() != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT {
		return textbehavior.SerializedRequest{}, qianfanUnsupported("ERNIE strict schema is not established by platform-wide support")
	}
	if f.GetKind() == runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT && len(s.GetTools()) > 0 {
		return textbehavior.SerializedRequest{}, qianfanUnsupported("combined tools and structured output")
	}
	messages, err := chatCompletionMessagesWithReplay(s, nil, "", false)
	if err != nil {
		return textbehavior.SerializedRequest{}, err
	}
	body := map[string]any{"messages": messages, "stream": stream}
	if len(s.GetTools()) > 0 {
		if err := deepseekChatTools(body, s); err != nil {
			return textbehavior.SerializedRequest{}, err
		}
	} else if s.GetToolChoiceName() != "" || s.GetToolChoice() != runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_UNSPECIFIED && s.GetToolChoice() != runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE {
		return textbehavior.SerializedRequest{}, qianfanUnsupported("tool choice without tools")
	}
	if stream {
		body["stream_options"] = map[string]any{"include_usage": true}
	}
	if s.MaxTokens != nil {
		body["max_tokens"] = s.GetMaxTokens()
	}
	if s.Seed != nil {
		body["seed"] = s.GetSeed()
	}
	if len(s.GetStop()) > 0 {
		body["stop"] = s.GetStop()
	}
	if f.GetKind() == runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT {
		body["response_format"] = map[string]any{"type": "json_object"}
	}
	data, err := json.Marshal(body)
	return textbehavior.SerializedRequest{ContentType: "application/json", Payload: data}, err
}

func (p QianfanTextBehavior) PlanMaterialization(ctx context.Context, s *runtimev1.TextGenerateScenarioSpec, stream bool) (*runtimev1.TextGenerateScenarioSpec, *textbehavior.OwnedMediaInputBudget, error) {
	prepared := textbehavior.ApplyInternalOutputBudget(ctx, s, p.Serialize, stream)
	_, err := p.Serialize(prepared, stream)
	return prepared, nil, err
}

// Raw native thoughts are neither a summary nor an established ERNIE replay
// carrier. Validate the actual response identity/error before hiding them.
func (QianfanTextBehavior) envelope(data []byte, seen bool) ([]byte, bool, error) {
	var e map[string]json.RawMessage
	if !utf8.Valid(data) || json.Unmarshal(data, &e) != nil || e == nil {
		return nil, seen, deepseekJSONOutputError()
	}
	if raw := e["error"]; len(raw) > 0 && string(raw) != "null" {
		return nil, seen, fireworksStreamError(raw)
	}
	if raw := e["code"]; len(raw) > 0 && string(raw) != "null" {
		return nil, seen, fireworksStreamError(data)
	}
	if raw := e["model"]; len(raw) > 0 {
		var model string
		if json.Unmarshal(raw, &model) != nil || model != "ernie-5.1" {
			return nil, seen, deepseekJSONOutputError()
		}
		seen = true
	}
	if !seen {
		return nil, false, deepseekJSONOutputError()
	}
	var choices []map[string]json.RawMessage
	if json.Unmarshal(e["choices"], &choices) != nil {
		return nil, seen, deepseekJSONOutputError()
	}
	for _, choice := range choices {
		for _, key := range []string{"message", "delta"} {
			raw, ok := choice[key]
			if !ok || string(raw) == "null" {
				continue
			}
			var m map[string]json.RawMessage
			if json.Unmarshal(raw, &m) != nil || m == nil {
				return nil, seen, deepseekJSONOutputError()
			}
			if thought, ok := m["reasoning_content"]; ok {
				var text *string
				if json.Unmarshal(thought, &text) != nil {
					return nil, seen, deepseekJSONOutputError()
				}
				delete(m, "reasoning_content")
			}
			choice[key], _ = json.Marshal(m)
		}
	}
	e["choices"], _ = json.Marshal(choices)
	clean, err := json.Marshal(e)
	return clean, seen, err
}

func (p QianfanTextBehavior) Parse(data []byte, s *runtimev1.TextGenerateScenarioSpec) (textbehavior.NormalizedResult, error) {
	clean, _, err := p.envelope(data, false)
	if err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	if len(s.GetTools()) > 0 {
		return parseDeepseekToolResponse(clean, s)
	}
	return parseChatTextResponse(clean, s.GetResponseFormat().GetKind() == runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT)
}
func (p QianfanTextBehavior) Stream(s *runtimev1.TextGenerateScenarioSpec) (textbehavior.StreamFragmentAssembler, error) {
	var inner textbehavior.StreamFragmentAssembler = &deepseekJSONStream{plainText: s.GetResponseFormat().GetKind() != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT}
	if len(s.GetTools()) > 0 {
		inner = newDeepseekToolStream(s)
	}
	return &qianfanTextStream{inner: inner}, nil
}

type qianfanTextStream struct {
	inner textbehavior.StreamFragmentAssembler
	seen  bool
}

func (s *qianfanTextStream) Append(data []byte) ([]textbehavior.OrderedDelta, error) {
	if strings.TrimSpace(string(data)) != "[DONE]" {
		var err error
		data, s.seen, err = (QianfanTextBehavior{}).envelope(data, s.seen)
		if err != nil {
			return nil, err
		}
	}
	return s.inner.Append(data)
}
func (s *qianfanTextStream) Finish() (textbehavior.NormalizedResult, error) { return s.inner.Finish() }
