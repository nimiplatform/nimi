package ai

import (
	"context"
	"math"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"github.com/nimiplatform/nimi/runtime/internal/texttarget"
	"google.golang.org/grpc/codes"
)

const (
	maxLocalAppTextCandidateMessages    = 8
	maxLocalAppTextCandidateMessageSize = 32 * 1024
	maxLocalAppTextCandidatePromptSize  = 64 * 1024
	maxLocalAppTextCandidateTokens      = 4096
)

// GenerateLocalAppTextCandidate is the sole third-party Local App AI method.
// The protected interceptor supplies the current App/account permission
// decision; this handler supplies the managed local model and generic Scenario
// fields that are deliberately absent from the public Local App request.
func (s *Service) GenerateLocalAppTextCandidate(ctx context.Context, req *runtimev1.GenerateLocalAppTextCandidateRequest) (*runtimev1.GenerateLocalAppTextCandidateResponse, error) {
	decision, ok := accountservice.AuthorizedLocalAppDecisionFromContext(ctx)
	if !ok || decision.Operation != accountservice.LocalAppOperationTextCandidateGenerate ||
		decision.AuthorityClass != localappop.AuthorityClassUserPermission ||
		decision.OperationCapability != "ai.text.generate" {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
	}
	systemPrompt, messages, err := validateLocalAppTextCandidateRequest(req)
	if err != nil {
		return nil, err
	}
	route, modelID, err := s.ResolvePublicChatTextBinding(
		ctx,
		runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		texttarget.InternalDefaultLocalTextModelAlias,
	)
	if err != nil {
		return nil, err
	}
	if route != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL || strings.TrimSpace(modelID) == "" {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}
	targetResolver, ok := s.localModel.(managedLlamaDurableTargetResolver)
	if !ok || targetResolver == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}
	logicalModelID, localTarget, found := targetResolver.ResolveManagedLlamaDurableTargetByCapabilities(
		modelID,
		"text.generate",
	)
	if !found || strings.TrimSpace(logicalModelID) == "" || localTarget == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}
	response, err := s.ExecuteScenario(ctx, buildLocalAppTextCandidateScenarioRequest(
		decision,
		logicalModelID,
		localTarget,
		systemPrompt,
		messages,
		req,
	))
	if err != nil {
		return nil, err
	}
	text := ""
	if response.GetOutput() != nil && response.GetOutput().GetTextGenerate() != nil {
		text = response.GetOutput().GetTextGenerate().GetText()
	}
	if strings.TrimSpace(text) == "" {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	return &runtimev1.GenerateLocalAppTextCandidateResponse{
		Text:         text,
		FinishReason: response.GetFinishReason(),
		TraceId:      response.GetTraceId(),
	}, nil
}

func buildLocalAppTextCandidateScenarioRequest(
	decision accountservice.LocalAppCallerDecision,
	modelID string,
	localTarget *runtimev1.RuntimeDurableLocalTargetRef,
	systemPrompt string,
	messages []*runtimev1.ChatMessage,
	req *runtimev1.GenerateLocalAppTextCandidateRequest,
) *runtimev1.ExecuteScenarioRequest {
	return &runtimev1.ExecuteScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         decision.AppID,
			SubjectUserId: decision.AccountID,
			ModelId:       strings.TrimSpace(modelID),
			TargetRef: &runtimev1.RuntimeDurableTargetRef{
				Target: &runtimev1.RuntimeDurableTargetRef_LocalRuntime{LocalRuntime: localTarget},
			},
			RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			Fallback:    runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_TextGenerate{
			TextGenerate: &runtimev1.TextGenerateScenarioSpec{
				Input:        messages,
				SystemPrompt: systemPrompt,
				Temperature:  req.GetTemperature(),
				TopP:         req.GetTopP(),
				MaxTokens:    req.GetMaxTokens(),
				ToolChoice:   runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE,
				ResponseFormat: &runtimev1.ResponseFormat{
					Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_TEXT,
				},
			},
		}},
	}
}

func validateLocalAppTextCandidateRequest(req *runtimev1.GenerateLocalAppTextCandidateRequest) (string, []*runtimev1.ChatMessage, error) {
	if req == nil || len(req.GetMessages()) == 0 || len(req.GetMessages()) > maxLocalAppTextCandidateMessages ||
		req.GetMaxTokens() < 1 || req.GetMaxTokens() > maxLocalAppTextCandidateTokens ||
		math.IsNaN(float64(req.GetTemperature())) || math.IsInf(float64(req.GetTemperature()), 0) ||
		req.GetTemperature() < 0 || req.GetTemperature() > 2 ||
		math.IsNaN(float64(req.GetTopP())) || math.IsInf(float64(req.GetTopP()), 0) ||
		req.GetTopP() < 0 || req.GetTopP() > 1 {
		return "", nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	var systemPrompt string
	messages := make([]*runtimev1.ChatMessage, 0, len(req.GetMessages()))
	totalBytes := 0
	seenUser := false
	for _, message := range req.GetMessages() {
		if message == nil {
			return "", nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		role := message.GetRole()
		text := message.GetText()
		textBytes := len([]byte(text))
		if strings.TrimSpace(role) != role || strings.TrimSpace(text) != text || textBytes == 0 ||
			textBytes > maxLocalAppTextCandidateMessageSize {
			return "", nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		totalBytes += len([]byte(role)) + textBytes
		if totalBytes > maxLocalAppTextCandidatePromptSize {
			return "", nil, grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		switch role {
		case "system":
			if systemPrompt != "" || seenUser {
				return "", nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
			}
			systemPrompt = text
		case "user":
			seenUser = true
			messages = append(messages, &runtimev1.ChatMessage{Role: role, Content: text})
		default:
			return "", nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
	}
	if !seenUser {
		return "", nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	return systemPrompt, messages, nil
}
