package capabilitydriver

import (
	"context"
	"encoding/json"
	"strings"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/grpc/codes"
)

const SparkMaaSResponsesProtocol = "spark-maas/responses/v1"

type SparkMaaSTextBehavior struct{ model string }

func SparkMaaSTextModels() []string {
	return []string{"spark-x2.6", "spark-x2.6-4b", "spark-x2.6-preview", "spark-x2.5", "spark-x2.5-4b", "spark-x2.5-1.7b"}
}
func NewSparkMaaSTextBehavior(model string) (SparkMaaSTextBehavior, error) {
	if !contains(SparkMaaSTextModels(), model) {
		return SparkMaaSTextBehavior{}, sparkUnsupported("unreviewed MaaS model")
	}
	return SparkMaaSTextBehavior{model: model}, nil
}
func sparkMaaSStructured(s *runtimev1.TextGenerateScenarioSpec) bool {
	return s.GetResponseFormat().GetKind() == runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT || s.GetResponseFormat().GetKind() == runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA
}

// @nimi-authority: rule.nimi.runtime.ai-provider.spark-maas-native-text
func (p SparkMaaSTextBehavior) Serialize(s *runtimev1.TextGenerateScenarioSpec, stream bool) (textbehavior.SerializedRequest, error) {
	if s == nil || s.GetIncludeRawChunks() || s.Temperature != nil && s.GetTemperature() != 1 || s.TopP != nil && s.GetTopP() != 0.95 || s.TopK != nil || s.PresencePenalty != nil || s.FrequencyPenalty != nil || s.Seed != nil || len(s.GetStop()) > 0 || s.MaxTokens != nil && s.GetMaxTokens() < 1 {
		return textbehavior.SerializedRequest{}, sparkUnsupported("MaaS fixed sampling or ignored generation control")
	}
	thinking, err := nativeSparkThinking(s.GetReasoning(), true)
	if err != nil {
		return textbehavior.SerializedRequest{}, err
	}
	messages, err := chatCompletionMessagesWithReplay(s, nil, "", false)
	if err != nil {
		return textbehavior.SerializedRequest{}, err
	}
	body := map[string]any{"stream": stream}
	protocol := ""
	f := s.GetResponseFormat()
	if sparkMaaSStructured(s) {
		if len(s.GetTools()) > 0 || thinking != "" || s.GetToolChoiceName() != "" || s.GetToolChoice() != runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_UNSPECIFIED && s.GetToolChoice() != runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE {
			return textbehavior.SerializedRequest{}, sparkUnsupported("MaaS structured output is an independent native request")
		}
		for _, m := range messages {
			if m["tool_calls"] != nil || m["tool_call_id"] != nil || m["role"] == "tool" {
				return textbehavior.SerializedRequest{}, sparkUnsupported("Responses tool replay")
			}
		}
		format := map[string]any{"type": "json_object"}
		if f.GetKind() == runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA {
			if !f.GetStrict() || f.GetJsonSchema() == nil || f.GetSchemaDescription() != "" {
				return textbehavior.SerializedRequest{}, sparkUnsupported("MaaS strict basic schema required")
			}
			if err := validateGroqStrictSchema(f.GetJsonSchema().AsMap()); err != nil {
				return textbehavior.SerializedRequest{}, sparkUnsupported("schema outside reviewed closed basic subset")
			}
			name := f.GetSchemaName()
			if name == "" {
				name = "response"
			}
			if !deepseekFunctionName(name) {
				return textbehavior.SerializedRequest{}, sparkUnsupported("schema name")
			}
			format = map[string]any{"type": "json_schema", "name": name, "schema": f.GetJsonSchema().AsMap(), "strict": true}
		} else if f.GetStrict() || f.GetJsonSchema() != nil || f.GetSchemaName() != "" || f.GetSchemaDescription() != "" {
			return textbehavior.SerializedRequest{}, sparkUnsupported("JSON object schema fields")
		}
		body["input"] = messages
		body["text"] = map[string]any{"format": format}
		protocol = SparkMaaSResponsesProtocol
		if s.MaxTokens != nil {
			body["max_output_tokens"] = s.GetMaxTokens()
		}
	} else {
		if f.GetKind() != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_UNSPECIFIED && f.GetKind() != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_TEXT || f.GetStrict() || f.GetJsonSchema() != nil || f.GetSchemaName() != "" || f.GetSchemaDescription() != "" {
			return textbehavior.SerializedRequest{}, sparkUnsupported("MaaS response format")
		}
		body["messages"] = messages
		if len(s.GetTools()) > 128 || s.GetToolChoice() == runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL || s.GetToolChoiceName() != "" {
			return textbehavior.SerializedRequest{}, sparkUnsupported("MaaS unreviewed named tool object or tool bound")
		}
		if len(s.GetTools()) > 0 {
			if err := deepseekChatTools(body, s); err != nil {
				return textbehavior.SerializedRequest{}, err
			}
		} else if s.GetToolChoice() != runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_UNSPECIFIED && s.GetToolChoice() != runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE {
			return textbehavior.SerializedRequest{}, sparkUnsupported("choice without tools")
		}
		if thinking != "" {
			body["thinking"] = map[string]any{"type": thinking}
		}
		if s.MaxTokens != nil {
			body["max_completion_tokens"] = s.GetMaxTokens()
		}
	}
	if s.Temperature != nil {
		body["temperature"] = s.GetTemperature()
	}
	if s.TopP != nil {
		body["top_p"] = s.GetTopP()
	}
	data, err := json.Marshal(body)
	if len(data) > 32<<20 {
		return textbehavior.SerializedRequest{}, sparkUnsupported("MaaS request exceeds32MiB")
	}
	return textbehavior.SerializedRequest{ContentType: "application/json", Protocol: protocol, Payload: data}, err
}
func (p SparkMaaSTextBehavior) PlanMaterialization(ctx context.Context, s *runtimev1.TextGenerateScenarioSpec, stream bool) (*runtimev1.TextGenerateScenarioSpec, *textbehavior.OwnedMediaInputBudget, error) {
	prepared := textbehavior.ApplyInternalOutputBudget(ctx, s, p.Serialize, stream)
	_, err := p.Serialize(prepared, stream)
	return prepared, nil, err
}

type sparkMaaSChatIdentity struct {
	id        string
	modelSeen bool
}

func (p SparkMaaSTextBehavior) chatEnvelope(data []byte, state *sparkMaaSChatIdentity, disabled bool) ([]byte, error) {
	var e sparkEnvelope
	if !utf8.Valid(data) || json.Unmarshal(data, &e) != nil {
		return nil, deepseekJSONOutputError()
	}
	if len(e.Error) > 0 && string(e.Error) != "null" {
		return nil, fireworksStreamError(e.Error)
	}
	if e.Code != nil && *e.Code != 0 {
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	if e.Model != "" {
		if e.Model != p.model {
			return nil, deepseekJSONOutputError()
		}
		state.modelSeen = true
	}
	if e.ID != "" {
		if state.id != "" && state.id != e.ID {
			return nil, deepseekJSONOutputError()
		}
		state.id = e.ID
	}
	if !state.modelSeen || state.id == "" {
		return nil, deepseekJSONOutputError()
	}
	for _, c := range e.Choices {
		for _, m := range []*sparkMessage{c.Message, c.Delta} {
			if m == nil {
				continue
			}
			if m.Role != "" && m.Role != "assistant" {
				return nil, deepseekJSONOutputError()
			}
			if m.Security != nil && m.Security.Action != "" {
				return nil, deepseekRefused()
			}
			if disabled && m.Reasoning != nil && *m.Reasoning != "" {
				return nil, deepseekJSONOutputError()
			}
			m.Reasoning = nil
			m.Security = nil
		}
	}
	return json.Marshal(e)
}
func (p SparkMaaSTextBehavior) Parse(data []byte, s *runtimev1.TextGenerateScenarioSpec) (textbehavior.NormalizedResult, error) {
	if sparkMaaSStructured(s) {
		return p.parseStructured(data, s)
	}
	thinking, err := nativeSparkThinking(s.GetReasoning(), true)
	if err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	clean, err := p.chatEnvelope(data, &sparkMaaSChatIdentity{}, thinking == "disabled")
	if err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	if len(s.GetTools()) > 0 {
		return parseDeepseekToolResponse(clean, s)
	}
	return parseChatTextResponse(clean, false)
}
func (p SparkMaaSTextBehavior) Stream(s *runtimev1.TextGenerateScenarioSpec) (textbehavior.StreamFragmentAssembler, error) {
	if sparkMaaSStructured(s) {
		return &sparkMaaSStructuredStream{profile: p, spec: s}, nil
	}
	thinking, err := nativeSparkThinking(s.GetReasoning(), true)
	if err != nil {
		return nil, err
	}
	var inner textbehavior.StreamFragmentAssembler = &deepseekJSONStream{plainText: true}
	if len(s.GetTools()) > 0 {
		inner = newDeepseekToolStream(s)
	}
	return &sparkMaaSChatStream{profile: p, inner: inner, disabled: thinking == "disabled"}, nil
}

type sparkMaaSChatStream struct {
	profile  SparkMaaSTextBehavior
	inner    textbehavior.StreamFragmentAssembler
	identity sparkMaaSChatIdentity
	disabled bool
}

func (s *sparkMaaSChatStream) Append(data []byte) ([]textbehavior.OrderedDelta, error) {
	if strings.TrimSpace(string(data)) != "[DONE]" {
		var err error
		data, err = s.profile.chatEnvelope(data, &s.identity, s.disabled)
		if err != nil {
			return nil, err
		}
	}
	return s.inner.Append(data)
}
func (s *sparkMaaSChatStream) Finish() (textbehavior.NormalizedResult, error) {
	return s.inner.Finish()
}

type sparkMaaSResponse struct {
	ID     string          `json:"id"`
	Model  string          `json:"model"`
	Status string          `json:"status"`
	Code   *int            `json:"code"`
	Error  json.RawMessage `json:"error"`
	Output []struct {
		ID      string `json:"id"`
		Type    string `json:"type"`
		Status  string `json:"status"`
		Role    string `json:"role"`
		Content []struct {
			Type string  `json:"type"`
			Text *string `json:"text"`
		} `json:"content"`
		Summary []struct {
			Type string  `json:"type"`
			Text *string `json:"text"`
		} `json:"summary"`
	} `json:"output"`
	Usage *struct {
		Input  *int64 `json:"input_tokens"`
		Output *int64 `json:"output_tokens"`
	} `json:"usage"`
}

func (p SparkMaaSTextBehavior) parseStructured(data []byte, s *runtimev1.TextGenerateScenarioSpec) (textbehavior.NormalizedResult, error) {
	var e sparkMaaSResponse
	if !utf8.Valid(data) || json.Unmarshal(data, &e) != nil {
		return textbehavior.NormalizedResult{}, deepseekJSONOutputError()
	}
	if e.Code != nil && *e.Code != 0 || e.Status == "failed" || e.Status == "cancelled" {
		return textbehavior.NormalizedResult{}, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	if len(e.Error) > 0 && string(e.Error) != "null" {
		return textbehavior.NormalizedResult{}, fireworksStreamError(e.Error)
	}
	if e.Status != "completed" {
		return textbehavior.NormalizedResult{}, deepseekIncomplete()
	}
	if e.Model != p.model || e.ID == "" || len(e.Output) == 0 {
		return textbehavior.NormalizedResult{}, deepseekJSONOutputError()
	}
	var answer strings.Builder
	ids := map[string]bool{}
	for _, item := range e.Output {
		if item.ID == "" || ids[item.ID] || item.Status != "" && item.Status != "completed" {
			return textbehavior.NormalizedResult{}, deepseekJSONOutputError()
		}
		ids[item.ID] = true
		switch item.Type {
		case "reasoning":
			for _, part := range item.Summary {
				if part.Type != "summary_text" || part.Text == nil {
					return textbehavior.NormalizedResult{}, deepseekJSONOutputError()
				}
			}
		case "message":
			if item.Role != "assistant" || len(item.Content) == 0 {
				return textbehavior.NormalizedResult{}, deepseekJSONOutputError()
			}
			for _, part := range item.Content {
				if part.Type != "output_text" || part.Text == nil {
					return textbehavior.NormalizedResult{}, deepseekJSONOutputError()
				}
				answer.WriteString(*part.Text)
			}
		default:
			return textbehavior.NormalizedResult{}, deepseekJSONOutputError()
		}
	}
	result := textbehavior.NormalizedResult{FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP, Items: []textbehavior.OrderedItem{{Kind: textbehavior.OrderedItemText, Text: answer.String()}}}
	if e.Usage != nil {
		u := e.Usage
		if u.Input != nil && *u.Input < 0 || u.Output != nil && *u.Output < 0 {
			return textbehavior.NormalizedResult{}, deepseekJSONOutputError()
		}
		if u.Input != nil && u.Output != nil {
			result.Usage = &runtimev1.UsageStats{InputTokens: *u.Input, OutputTokens: *u.Output}
		}
	}
	if s.GetResponseFormat().GetKind() == runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA {
		return validateStrictChatSchemaResult(result, s)
	}
	if err := deepseekJSONObject(answer.String()); err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	return result, nil
}

type sparkMaaSStructuredStream struct {
	profile  SparkMaaSTextBehavior
	spec     *runtimev1.TextGenerateScenarioSpec
	id       string
	terminal bool
	result   textbehavior.NormalizedResult
}

func (s *sparkMaaSStructuredStream) Append(data []byte) ([]textbehavior.OrderedDelta, error) {
	if strings.TrimSpace(string(data)) == "[DONE]" {
		if !s.terminal {
			return nil, deepseekIncomplete()
		}
		return nil, nil
	}
	if s.terminal {
		return nil, deepseekJSONOutputError()
	}
	var event struct {
		Type       string          `json:"type"`
		Code       *int            `json:"code"`
		ResponseID string          `json:"response_id"`
		Response   json.RawMessage `json:"response"`
		Error      json.RawMessage `json:"error"`
	}
	if !utf8.Valid(data) || json.Unmarshal(data, &event) != nil {
		return nil, deepseekJSONOutputError()
	}
	if event.Code != nil && *event.Code != 0 {
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	if len(event.Error) > 0 && string(event.Error) != "null" {
		return nil, fireworksStreamError(event.Error)
	}
	if event.ResponseID != "" {
		if s.id != "" && s.id != event.ResponseID {
			return nil, deepseekJSONOutputError()
		}
		s.id = event.ResponseID
	}
	if len(event.Response) > 0 {
		var response sparkMaaSResponse
		if json.Unmarshal(event.Response, &response) != nil || response.ID == "" || s.id != "" && s.id != response.ID || response.Model != "" && response.Model != s.profile.model {
			return nil, deepseekJSONOutputError()
		}
		s.id = response.ID
	}
	switch event.Type {
	case "response.completed":
		result, err := s.profile.parseStructured(event.Response, s.spec)
		if err != nil {
			return nil, err
		}
		s.terminal = true
		s.result = result
		return []textbehavior.OrderedDelta{{ItemIndex: 0, Kind: textbehavior.OrderedItemText, Text: result.Items[0].Text, ItemCompleted: true}}, nil
	case "response.failed", "response.cancelled":
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	case "response.incomplete":
		return nil, deepseekIncomplete()
	case "response.created", "response.in_progress", "response.output_item.added", "response.output_item.done", "response.content_part.added", "response.content_part.done", "response.output_text.delta", "response.output_text.done", "response.reasoning_summary_part.added", "response.reasoning_summary_part.done", "response.reasoning_summary_text.delta", "response.reasoning_summary_text.done":
		return nil, nil
	default:
		return nil, deepseekJSONOutputError()
	}
}
func (s *sparkMaaSStructuredStream) Finish() (textbehavior.NormalizedResult, error) {
	if !s.terminal {
		return textbehavior.NormalizedResult{}, deepseekIncomplete()
	}
	return s.result, nil
}
