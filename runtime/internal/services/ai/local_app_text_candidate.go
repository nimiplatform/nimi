package ai

import (
	"context"
	"math"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
)

const (
	maxLocalAppTextCandidateMessages    = 8
	maxLocalAppTextCandidateMessageSize = 32 * 1024
	maxLocalAppTextCandidatePromptSize  = 64 * 1024
	maxLocalAppTextCandidateTokens      = 4096
)

// GenerateLocalAppTextCandidate preserves the third-party Local App text
// contract while composing its App AIConfig Local intent with the machine's
// selected Local Capability Configuration. It never resolves an ambient
// model, request target, or fallback.
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
	head := &runtimev1.ScenarioRequestHead{
		AppId:         decision.AppID,
		SubjectUserId: decision.AccountID,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
	}
	effective, err := s.captureLocalTextEffectiveInputs(ctx, head, &runtimev1.TextGenerateScenarioSpec{
		Input:        messages,
		SystemPrompt: systemPrompt,
		Temperature:  req.GetTemperature(),
		TopP:         req.GetTopP(),
		MaxTokens:    req.GetMaxTokens(),
	}, false)
	if err != nil {
		return nil, err
	}
	defer effective.release()
	result, err := s.executeCapturedLocalText(ctx, effective, nil)
	if err != nil {
		return nil, err
	}
	return &runtimev1.GenerateLocalAppTextCandidateResponse{
		Text:         result.Text,
		FinishReason: result.FinishReason,
		TraceId:      ulid.Make().String(),
	}, nil
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
