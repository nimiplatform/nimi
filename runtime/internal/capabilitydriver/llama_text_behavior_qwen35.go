package capabilitydriver

import (
	"encoding/json"
	"fmt"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/grpc/codes"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.r119
// @nimi-authority: rule.nimi.runtime.ai-provider.r123
func Qwen35TextBehaviorRequestSerializer(spec *runtimev1.TextGenerateScenarioSpec, stream bool) (textbehavior.SerializedRequest, error) {
	if spec == nil || stream || llamaBehaviorReasoningEnabled(spec) {
		return textbehavior.SerializedRequest{}, qwen35BehaviorUnsupported("Qwen3.5 advanced reasoning and streaming are unsupported")
	}
	toolMode := len(spec.GetTools()) == 1 && (spec.GetToolChoice() == runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO ||
		spec.GetToolChoice() == runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_UNSPECIFIED) &&
		(spec.GetResponseFormat() == nil || spec.GetResponseFormat().GetKind() == runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_UNSPECIFIED ||
			spec.GetResponseFormat().GetKind() == runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_TEXT)
	format := spec.GetResponseFormat()
	schemaMode := len(spec.GetTools()) == 0 && format != nil &&
		format.GetKind() == runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA && format.GetStrict()
	if !toolMode && !schemaMode {
		return textbehavior.SerializedRequest{}, qwen35BehaviorUnsupported("Qwen3.5 admits one auto function tool or a separate strict JSON Schema request")
	}
	serialized, err := Gemma4TextBehaviorRequestSerializer(spec, false)
	if err != nil {
		return textbehavior.SerializedRequest{}, err
	}
	var body map[string]any
	if err := json.Unmarshal(serialized.Payload, &body); err != nil {
		return textbehavior.SerializedRequest{}, fmt.Errorf("decode local Qwen3.5 behavior request: %w", err)
	}
	body["chat_template_kwargs"] = map[string]any{"enable_thinking": false}
	if toolMode {
		body["parallel_tool_calls"] = false
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return textbehavior.SerializedRequest{}, fmt.Errorf("encode local Qwen3.5 behavior request: %w", err)
	}
	return textbehavior.SerializedRequest{ContentType: "application/json", Payload: payload}, nil
}

func Qwen35TextBehaviorNonStreamParser(payload []byte, spec *runtimev1.TextGenerateScenarioSpec) (textbehavior.NormalizedResult, error) {
	var envelope struct {
		Choices []struct {
			Message struct {
				Content          string            `json:"content"`
				ReasoningContent string            `json:"reasoning_content"`
				ToolCalls        []json.RawMessage `json:"tool_calls"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(payload, &envelope); err != nil || len(envelope.Choices) != 1 {
		return textbehavior.NormalizedResult{}, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	message := envelope.Choices[0].Message
	if message.ReasoningContent != "" {
		return textbehavior.NormalizedResult{}, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	if len(message.ToolCalls) > 1 || len(message.ToolCalls) > 0 && message.Content != "" {
		return textbehavior.NormalizedResult{}, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_TOOL_CALL_INVALID)
	}
	return Gemma4TextBehaviorNonStreamParser(payload, spec)
}

func Qwen35TextBehaviorStreamAssembler(*runtimev1.TextGenerateScenarioSpec) (textbehavior.StreamFragmentAssembler, error) {
	return nil, qwen35BehaviorUnsupported("Qwen3.5 advanced text streaming is unavailable")
}

func qwen35BehaviorUnsupported(message string) error {
	return grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED,
		fmt.Errorf("%s", message), grpcerr.ReasonOptions{})
}
