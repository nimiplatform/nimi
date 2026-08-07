package ai

import (
	"context"
	"math"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
)

const (
	maxLocalAppTextCandidateMessages    = 8
	maxLocalAppTextCandidateMessageSize = 32 * 1024
	maxLocalAppTextCandidatePromptSize  = 64 * 1024
	maxLocalAppTextCandidateTokens      = 4096
)

// GenerateLocalAppTextCandidate preserves the third-party Local App unary
// contract while delegating route composition, spend disclosure, scheduling,
// Driver mapping, metering, and execution to the post-I5 Scenario owner. The
// App supplies no route, implementation, target, grant, model, tool, or stream.
func (s *Service) GenerateLocalAppTextCandidate(ctx context.Context, req *runtimev1.GenerateLocalAppTextCandidateRequest) (*runtimev1.GenerateLocalAppTextCandidateResponse, error) {
	decision, ok := accountservice.AuthorizedLocalAppDecisionFromContext(ctx)
	if !ok || decision.Operation != accountservice.LocalAppOperationTextCandidateGenerate ||
		decision.AuthorityClass != localappop.AuthorityClassAppAccess ||
		decision.OperationCapability != "ai.text.generate" {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
	}
	systemPrompt, messages, err := validateLocalAppTextCandidateRequest(req)
	if err != nil {
		return nil, err
	}
	result, err := s.ExecuteScenario(ctx, &runtimev1.ExecuteScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         decision.AppID,
			SubjectUserId: decision.AccountID,
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
			},
		}},
	})
	if err != nil {
		return nil, err
	}
	if result == nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	text := result.GetOutput().GetTextGenerate()
	if text == nil || strings.TrimSpace(text.GetText()) == "" ||
		len([]byte(text.GetText())) > 256*1024 || strings.TrimSpace(result.GetTraceId()) == "" ||
		result.GetTraceId() != strings.TrimSpace(result.GetTraceId()) ||
		len(text.GetToolCalls()) != 0 || len(text.GetToolResults()) != 0 ||
		len(text.GetToolApprovalRequests()) != 0 || len(text.GetSources()) != 0 || len(text.GetRawChunks()) != 0 ||
		!localAppTextCandidateFinishReason(result.GetFinishReason()) {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	return &runtimev1.GenerateLocalAppTextCandidateResponse{
		Text: text.GetText(), FinishReason: result.GetFinishReason(), TraceId: result.GetTraceId(),
	}, nil
}

func localAppTextCandidateFinishReason(reason runtimev1.FinishReason) bool {
	switch reason {
	case runtimev1.FinishReason_FINISH_REASON_STOP,
		runtimev1.FinishReason_FINISH_REASON_LENGTH,
		runtimev1.FinishReason_FINISH_REASON_CONTENT_FILTER:
		return true
	default:
		return false
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
