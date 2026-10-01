package capabilitydriver

import (
	"net/http"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/grpc/codes"
)

const (
	chatGPTPlanContinuityKind = "openai_chatgpt_plan.responses.encrypted-reasoning"
	// ChatGPTPlanToolNamespace groups caller function tools as the public
	// ChatGPT-plan Responses preview requires.
	ChatGPTPlanToolNamespace = "nimi_app_tools"
	// ChatGPTPlanManageUsageHint points the user at ChatGPT usage settings.
	ChatGPTPlanManageUsageHint = "manage_chatgpt_plan_usage"
)
const ChatGPTPlanContinuityKind = chatGPTPlanContinuityKind

// chatGPTPlanResponses is the ChatGPT-plan route: function tools grouped in a
// Runtime-owned namespace, one call at a time, no named tool choice and no
// generation controls, since the route rejects them.
var chatGPTPlanResponses = &responsesProfile{
	label:                    "ChatGPT plan",
	continuityKind:           chatGPTPlanContinuityKind,
	toolNamespace:            ChatGPTPlanToolNamespace,
	toolNamespaceDescription: "Functions executed by the requesting Nimi app after it receives the call.",
	failure:                  ChatGPTPlanFailure,
}

// @nimi-authority: rule.nimi.runtime.ai-provider.chatgpt-plan-text-behaviors
// ChatGPTPlanTextBehaviorRequestSerializer maps one exact text step to a
// stateless public Responses request with store false and SSE delivery.
func ChatGPTPlanTextBehaviorRequestSerializer(spec *runtimev1.TextGenerateScenarioSpec, _ bool) (textbehavior.SerializedRequest, error) {
	return serializeResponsesRequest(chatGPTPlanResponses, spec)
}

// ChatGPTPlanTextBehaviorStreamAssembler parses the public Responses SSE
// stream. Only response.completed with every output item sealed succeeds.
func ChatGPTPlanTextBehaviorStreamAssembler(spec *runtimev1.TextGenerateScenarioSpec) (textbehavior.StreamFragmentAssembler, error) {
	return newResponsesStreamAssembler(chatGPTPlanResponses, spec), nil
}

// ChatGPTPlanTextBehaviorNonStreamParser exists for the hook contract only:
// this route always streams, including synchronous collection.
func ChatGPTPlanTextBehaviorNonStreamParser(_ []byte, _ *runtimev1.TextGenerateScenarioSpec) (textbehavior.NormalizedResult, error) {
	return textbehavior.NormalizedResult{}, chatGPTPlanResponses.outputError("non-stream response on a stream-only route")
}

// ChatGPTPlanFailure maps a documented ChatGPT-plan admission or Responses
// error to its typed Runtime reason without retrying or switching route.
func ChatGPTPlanFailure(status int, code string) error {
	code = strings.TrimSpace(code)
	reason, grpcCode, hint := runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, codes.Unavailable, "retry_later"
	switch code {
	case "subscription_sharing_usage_limit_exceeded":
		reason, grpcCode, hint = runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED, codes.ResourceExhausted, ChatGPTPlanManageUsageHint
	case "subscription_sharing_usage_unavailable", "subscription_sharing_user_unavailable":
		reason, grpcCode, hint = runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, codes.Unavailable, "retry_later"
	case "subscription_sharing_user_not_eligible":
		reason, grpcCode, hint = runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED, codes.PermissionDenied, "chatgpt_plan_not_eligible"
	case "subscription_sharing_invalid_user":
		reason, grpcCode, hint = runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED, codes.Unauthenticated, "check_chatgpt_plan_account"
	case "chatpass_v2_scope_not_authorized", "chatpass_v2_invalid_authorization_context":
		reason, grpcCode, hint = runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED, codes.PermissionDenied, "check_chatgpt_plan_account"
	case "subscription_sharing_route_not_supported":
		reason, grpcCode, hint = runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED, codes.FailedPrecondition, ""
	case "subscription_sharing_unsupported_capability":
		reason, grpcCode, hint = runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED, codes.InvalidArgument, ""
	case "model_not_found":
		reason, grpcCode, hint = runtimev1.ReasonCode_AI_MODEL_NOT_FOUND, codes.NotFound, "select_available_model"
	default:
		switch {
		case status == http.StatusUnauthorized:
			reason, grpcCode, hint = runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED, codes.Unauthenticated, "check_chatgpt_plan_account"
		case status == http.StatusForbidden:
			reason, grpcCode, hint = runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED, codes.PermissionDenied, "check_chatgpt_plan_account"
		case status == http.StatusNotFound:
			reason, grpcCode, hint = runtimev1.ReasonCode_AI_MODEL_NOT_FOUND, codes.NotFound, "select_available_model"
		case status == http.StatusTooManyRequests:
			reason, grpcCode, hint = runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED, codes.ResourceExhausted, ChatGPTPlanManageUsageHint
		case status >= 300 && status < 400:
			reason, grpcCode, hint = runtimev1.ReasonCode_AI_PROVIDER_ENDPOINT_FORBIDDEN, codes.FailedPrecondition, ""
		case status == http.StatusBadRequest:
			reason, grpcCode, hint = runtimev1.ReasonCode_AI_INPUT_INVALID, codes.InvalidArgument, ""
		}
	}
	return grpcerr.WithReasonCodeOptions(grpcCode, reason, grpcerr.ReasonOptions{
		ActionHint: hint, Message: "ChatGPT plan request failed",
		Metadata: map[string]string{"provider_error_code": code},
	})
}
