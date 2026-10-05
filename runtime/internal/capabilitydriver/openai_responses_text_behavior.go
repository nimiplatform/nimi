package capabilitydriver

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/grpc/codes"
)

const openAIResponsesContinuityKind = "openai.responses.encrypted-reasoning"
const OpenAIResponsesContinuityKind = openAIResponsesContinuityKind

// openAIResponses is the standard API-key OpenAI route: top-level function
// tools, named tool choice, parallel calls and an output token limit. It
// shares none of the ChatGPT-plan namespace, rejected fields or account
// inventory rules, and its continuity carriers are its own.
var openAIResponses = &responsesProfile{
	label:             "OpenAI Responses",
	continuityKind:    openAIResponsesContinuityKind,
	outputLimit:       true,
	namedToolChoice:   true,
	parallelToolCalls: true,
	reasoningControls: true,
	failure:           OpenAIResponsesFailure,
}

// @nimi-authority: rule.nimi.runtime.ai-provider.openai-responses-text-behaviors
// OpenAIResponsesTextBehaviorRequestSerializer maps one exact text step to a
// stateless store-false Responses request delivered over SSE in both modes.
func OpenAIResponsesTextBehaviorRequestSerializer(modelID string, spec *runtimev1.TextGenerateScenarioSpec, _ bool) (textbehavior.SerializedRequest, error) {
	profile := *openAIResponses
	profile.reasoningControls = true
	profile.reasoningDisabled = modelID == "gpt-6-luna"
	return serializeResponsesRequest(&profile, spec)
}

// OpenAIResponsesTextBehaviorStreamAssembler parses the Responses SSE stream.
// Only response.completed with every output item sealed succeeds.
func OpenAIResponsesTextBehaviorStreamAssembler(spec *runtimev1.TextGenerateScenarioSpec) (textbehavior.StreamFragmentAssembler, error) {
	return newResponsesStreamAssembler(openAIResponses, spec), nil
}

// OpenAIResponsesTextBehaviorNonStreamParser exists for the hook contract
// only: synchronous steps collect the same SSE stream.
func OpenAIResponsesTextBehaviorNonStreamParser(_ []byte, _ *runtimev1.TextGenerateScenarioSpec) (textbehavior.NormalizedResult, error) {
	return textbehavior.NormalizedResult{}, openAIResponses.outputError("non-stream response on a stream-only route")
}

// OpenAIResponsesFailure maps an error reported inside an accepted Responses
// stream. HTTP failures before the stream keep the common provider mapping.
func OpenAIResponsesFailure(_ int, code string) error {
	code = strings.TrimSpace(code)
	reason, grpcCode, hint := runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, codes.Unavailable, "retry_later"
	switch {
	case code == "rate_limit_exceeded" || code == "insufficient_quota":
		reason, grpcCode, hint = runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED, codes.ResourceExhausted, ""
	case code == "model_not_found":
		reason, grpcCode, hint = runtimev1.ReasonCode_AI_MODEL_NOT_FOUND, codes.NotFound, "select_available_model"
	case code == "invalid_prompt" || code == "context_length_exceeded" || strings.Contains(code, "image"):
		reason, grpcCode, hint = runtimev1.ReasonCode_AI_INPUT_INVALID, codes.InvalidArgument, ""
	}
	return grpcerr.WithReasonCodeOptions(grpcCode, reason, grpcerr.ReasonOptions{
		ActionHint: hint, Message: "OpenAI Responses request failed",
		Metadata: map[string]string{"provider_error_code": code},
	})
}
