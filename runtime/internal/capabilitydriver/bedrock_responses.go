package capabilitydriver

import (
	"encoding/json"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/grpc/codes"
)

const BedrockResponsesProtocol = "bedrock/responses-v1"

type BedrockResponsesBehavior struct {
	model   string
	profile responsesProfile
}

func NewBedrockResponsesBehavior(model string) (BedrockResponsesBehavior, error) {
	switch model {
	case "openai.gpt-6-astra", "openai.gpt-6-luna", "openai.gpt-6.1-sol", "openai.gpt-6.1-terra":
	default:
		return BedrockResponsesBehavior{}, deepseekUnsupported()
	}
	return BedrockResponsesBehavior{model: model, profile: responsesProfile{label: "Bedrock Responses", continuityKind: "bedrock.responses.encrypted-reasoning." + model, outputLimit: true, namedToolChoice: true, parallelToolCalls: true, reasoningControls: true, reasoningDisabled: model == "openai.gpt-6-luna" || model == "openai.gpt-6.1-terra", failure: OpenAIResponsesFailure}}, nil
}
func (p BedrockResponsesBehavior) ContinuityKind() string { return p.profile.continuityKind }

// @nimi-authority: rule.nimi.runtime.ai-provider.bedrock-native-routing
// @nimi-authority: rule.nimi.runtime.ai-provider.bedrock-current-text
func (p BedrockResponsesBehavior) Serialize(spec *runtimev1.TextGenerateScenarioSpec, stream bool) (textbehavior.SerializedRequest, error) {
	limit := int32(128000)
	if p.model == "openai.gpt-6.1-sol" {
		limit = 131072
	}
	if p.model == "" || spec.GetMaxTokens() > limit {
		return textbehavior.SerializedRequest{}, p.profile.unsupported("model or output limit")
	}
	if stream && spec.GetResponseFormat().GetKind() == runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA && p.model != "openai.gpt-6.1-sol" {
		return textbehavior.SerializedRequest{}, p.profile.unsupported("this Bedrock model documents JSON Schema only for non-streaming requests")
	}
	value, err := serializeResponsesRequest(&p.profile, spec)
	if err != nil {
		return value, err
	}
	var body map[string]any
	if err = json.Unmarshal(value.Payload, &body); err != nil {
		return value, err
	}
	body["stream"] = stream
	value.Payload, err = json.Marshal(body)
	if len(value.Payload) > 25_000_000 {
		return textbehavior.SerializedRequest{}, p.profile.inputError("request size")
	}
	value.Protocol = BedrockResponsesProtocol
	return value, err
}

func (p BedrockResponsesBehavior) Stream(spec *runtimev1.TextGenerateScenarioSpec) (textbehavior.StreamFragmentAssembler, error) {
	return newResponsesStreamAssembler(&p.profile, spec), nil
}

// Parse consumes an actual non-streaming Responses object. It shares final
// item validation with SSE without fabricating provider stream events.
func (p BedrockResponsesBehavior) Parse(payload []byte, spec *runtimev1.TextGenerateScenarioSpec) (textbehavior.NormalizedResult, error) {
	var response responsesBehaviorResponse
	if !utf8.Valid(payload) || json.Unmarshal(payload, &response) != nil {
		return textbehavior.NormalizedResult{}, p.profile.outputError("response JSON")
	}
	if response.Error != nil {
		return textbehavior.NormalizedResult{}, p.profile.failure(0, response.Error.Code)
	}
	if response.Status == "incomplete" {
		return textbehavior.NormalizedResult{}, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_TEXT_OUTPUT_INCOMPLETE)
	}
	if response.Status != "completed" {
		return textbehavior.NormalizedResult{}, p.profile.outputError("response status")
	}
	stream := newResponsesStreamAssembler(&p.profile, spec)
	ids := map[string]bool{}
	for _, item := range response.Output {
		if item.ID == "" || ids[item.ID] {
			return textbehavior.NormalizedResult{}, p.profile.outputError("response item identity")
		}
		ids[item.ID] = true
		block := &responsesBehaviorBlock{item: item, done: true}
		switch item.Type {
		case "message":
			for _, part := range item.Content {
				if part.Type != "output_text" {
					return textbehavior.NormalizedResult{}, p.profile.outputError("message content")
				}
				block.text.WriteString(part.Text)
			}
		case "function_call":
			if item.CallID == "" || item.Name == "" || !p.profile.namespaceAdmitted(item.Namespace) {
				return textbehavior.NormalizedResult{}, p.profile.outputError("function identity")
			}
		case "reasoning":
		default:
			return textbehavior.NormalizedResult{}, p.profile.outputError("response item kind")
		}
		stream.bufferedBytes += block.text.Len() + len(item.Arguments)
		if stream.bufferedBytes > responsesItemTextLimit {
			return textbehavior.NormalizedResult{}, p.profile.outputError("output size")
		}
		stream.blocks = append(stream.blocks, block)
	}
	if _, err := stream.flush(); err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	stream.completed, stream.response = true, response
	return stream.Finish()
}
