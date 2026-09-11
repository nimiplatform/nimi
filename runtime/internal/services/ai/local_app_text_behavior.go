package ai

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

const (
	maxLocalAppTextMessages     = 128
	maxLocalAppTextTools        = 64
	maxLocalAppTextRequestBytes = 1 << 20
)

func localAppTextInputInvalid() error {
	return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
}

// localAppTextGenerateSpec is the shared single-step input boundary. It has no
// route, credential or cross-request execution state.
// @nimi-authority: rule.nimi.runtime.ai-provider.local-app-text-behaviors
func localAppTextGenerateSpec(req *runtimev1.StreamLocalAppTextTurnRequest) (*runtimev1.TextGenerateScenarioSpec, error) {
	if req == nil || len(req.GetMessages()) == 0 || len(req.GetMessages()) > maxLocalAppTextMessages ||
		len(req.GetTools()) > maxLocalAppTextTools || proto.Size(req) > maxLocalAppTextRequestBytes {
		return nil, localAppTextInputInvalid()
	}
	if invalidLocalAppTextTurnScalar(req.Temperature, 0, 2) || invalidLocalAppTextTurnScalar(req.TopP, 0, 1) ||
		invalidLocalAppTextTurnScalar(req.PresencePenalty, -2, 2) || invalidLocalAppTextTurnScalar(req.FrequencyPenalty, -2, 2) ||
		(req.MaxTokens != nil && req.GetMaxTokens() < 0) || (req.TopK != nil && req.GetTopK() < 0) {
		return nil, localAppTextInputInvalid()
	}
	for _, stop := range req.GetStop() {
		if strings.TrimSpace(stop) == "" {
			return nil, localAppTextInputInvalid()
		}
	}
	spec := &runtimev1.TextGenerateScenarioSpec{
		Temperature: localAppOptionalFloat32(req.Temperature), TopP: localAppOptionalFloat32(req.TopP),
		MaxTokens: localAppOptionalInt32(req.MaxTokens), TopK: localAppOptionalInt32(req.TopK),
		PresencePenalty: localAppOptionalFloat32(req.PresencePenalty), FrequencyPenalty: localAppOptionalFloat32(req.FrequencyPenalty),
		Stop: append([]string(nil), req.GetStop()...), Seed: localAppOptionalInt64(req.Seed),
		ToolChoice: req.GetToolChoice(), ToolChoiceName: req.GetToolChoiceName(),
	}
	declared := make(map[string]*runtimev1.ToolSpec, len(req.GetTools()))
	for _, tool := range req.GetTools() {
		if tool == nil || tool.GetKind() != runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION ||
			!localAppBoundedIdentifier(tool.GetName()) || tool.GetInputSchema() == nil ||
			tool.GetProviderToolId() != "" || tool.GetProviderArgs() != nil || tool.GetProviderMetadata() != nil {
			return nil, localAppTextInputInvalid()
		}
		if _, duplicate := declared[tool.GetName()]; duplicate {
			return nil, localAppTextInputInvalid()
		}
		if _, err := textbehavior.CompileJSONSchema(tool.GetInputSchema().AsMap()); err != nil {
			return nil, localAppTextInputInvalid()
		}
		declared[tool.GetName()] = tool
		spec.Tools = append(spec.Tools, proto.Clone(tool).(*runtimev1.ToolSpec))
	}
	seenUser := false
	for index, message := range req.GetMessages() {
		if message == nil {
			return nil, localAppTextInputInvalid()
		}
		role := message.GetRole()
		items := message.GetTurnItems()
		if len(items) > 0 {
			if role != "assistant" || message.GetText() != "" {
				return nil, localAppTextInputInvalid()
			}
			for _, item := range items {
				if err := validateLocalAppTextTurnItem(item, declared); err != nil {
					return nil, err
				}
			}
		} else if strings.TrimSpace(message.GetText()) == "" {
			return nil, localAppTextInputInvalid()
		}
		switch role {
		case "system":
			if index != 0 || len(items) != 0 {
				return nil, localAppTextInputInvalid()
			}
			spec.SystemPrompt = message.GetText()
			continue
		case "user":
			seenUser = true
		case "assistant":
		default:
			return nil, localAppTextInputInvalid()
		}
		converted := &runtimev1.ChatMessage{Role: role, Content: message.GetText()}
		if role == "assistant" && len(items) == 0 {
			converted.Content = ""
			converted.TurnItems = []*runtimev1.TextTurnItem{{Item: &runtimev1.TextTurnItem_Output{
				Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_Text{Text: &runtimev1.TextOutputText{Text: message.GetText()}}},
			}}}
		}
		for _, item := range items {
			converted.TurnItems = append(converted.TurnItems, proto.Clone(item).(*runtimev1.TextTurnItem))
		}
		spec.Input = append(spec.Input, converted)
	}
	if !seenUser {
		return nil, localAppTextInputInvalid()
	}
	if format := req.GetResponseFormat(); format != nil {
		switch format.GetKind() {
		case runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_UNSPECIFIED, runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_TEXT,
			runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT:
			if format.GetJsonSchema() != nil || format.GetStrict() {
				return nil, localAppTextInputInvalid()
			}
		case runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA:
			if format.GetJsonSchema() == nil {
				return nil, localAppTextInputInvalid()
			}
			if _, err := textbehavior.CompileJSONSchema(format.GetJsonSchema().AsMap()); err != nil {
				return nil, localAppTextInputInvalid()
			}
		default:
			return nil, localAppTextInputInvalid()
		}
		spec.ResponseFormat = proto.Clone(format).(*runtimev1.ResponseFormat)
	}
	if err := validateTextBehaviorToolRequestShape(spec); err != nil {
		return nil, err
	}
	return spec, nil
}

func validateLocalAppTextTurnItem(item *runtimev1.TextTurnItem, tools map[string]*runtimev1.ToolSpec) error {
	if item == nil {
		return localAppTextInputInvalid()
	}
	if output := item.GetOutput(); output != nil {
		if text := output.GetText(); text != nil && text.GetText() != "" {
			return nil
		}
		if call := output.GetToolCall(); call != nil {
			return validateLocalAppTextToolCall(call, tools)
		}
		return localAppTextInputInvalid()
	}
	result := item.GetToolResult()
	if result == nil || result.GetPreliminary() || result.GetDynamic() || result.GetProviderMetadata() != nil || result.GetResult() == nil {
		return localAppTextInputInvalid()
	}
	return nil // The shared transcript validator checks prior call id and name.
}

func validateLocalAppTextToolCall(call *runtimev1.ToolCall, tools map[string]*runtimev1.ToolSpec) error {
	if call == nil || !localAppBoundedIdentifier(call.GetId()) || !localAppBoundedIdentifier(call.GetName()) ||
		call.GetDynamic() || call.GetProviderMetadata() != nil || tools[call.GetName()] == nil {
		return invalidTextBehaviorToolTranscriptError()
	}
	if err := textbehavior.ValidateToolArguments(tools[call.GetName()], call.GetArgumentsJson()); err != nil {
		return invalidTextBehaviorToolTranscriptError()
	}
	return nil
}

func localAppTextFinishReason(reason runtimev1.FinishReason) bool {
	return localAppTextCandidateFinishReason(reason) || reason == runtimev1.FinishReason_FINISH_REASON_TOOL_CALL
}

func localAppTextOutputToolInvalid() error {
	return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_TOOL_CALL_INVALID)
}

func localAppTextOutputChoiceValid(choice runtimev1.ToolChoiceMode, name string, call *runtimev1.ToolCall) bool {
	return choice != runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE &&
		(choice != runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL || call.GetName() == name)
}

func localAppTextRequiresTool(choice runtimev1.ToolChoiceMode) bool {
	return choice == runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED || choice == runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL
}

func projectLocalAppTextOutput(output *runtimev1.TextGenerateOutput, finish runtimev1.FinishReason, spec *runtimev1.TextGenerateScenarioSpec) (*runtimev1.LocalAppTextGenerateOutput, error) {
	invalid := func() (*runtimev1.LocalAppTextGenerateOutput, error) {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	if output == nil || len(output.GetItems()) == 0 || !localAppTextFinishReason(finish) {
		return invalid()
	}
	declared := make(map[string]*runtimev1.ToolSpec, len(spec.GetTools()))
	for _, tool := range spec.GetTools() {
		declared[tool.GetName()] = tool
	}
	result := &runtimev1.LocalAppTextGenerateOutput{FinishReason: finish}
	seenCalls := make(map[string]struct{})
	bytes := 0
	for _, item := range output.GetItems() {
		if item == nil {
			return invalid()
		}
		if text := item.GetText(); text != nil && text.GetText() != "" {
			bytes += len(text.GetText())
		} else if call := item.GetToolCall(); call != nil {
			if err := validateLocalAppTextToolCall(call, declared); err != nil ||
				!localAppTextOutputChoiceValid(spec.GetToolChoice(), spec.GetToolChoiceName(), call) {
				return nil, localAppTextOutputToolInvalid()
			}
			if _, duplicate := seenCalls[call.GetId()]; duplicate {
				return nil, localAppTextOutputToolInvalid()
			}
			seenCalls[call.GetId()] = struct{}{}
			bytes += proto.Size(call)
		} else {
			return invalid()
		}
		if bytes > maxLocalAppTextTurnTotalBytes {
			return invalid()
		}
		result.Items = append(result.Items, proto.Clone(item).(*runtimev1.TextOutputItem))
	}
	if finish == runtimev1.FinishReason_FINISH_REASON_TOOL_CALL && len(seenCalls) == 0 {
		return invalid()
	}
	if localAppTextRequiresTool(spec.GetToolChoice()) && len(seenCalls) == 0 {
		return nil, localAppTextOutputToolInvalid()
	}
	return result, nil
}
