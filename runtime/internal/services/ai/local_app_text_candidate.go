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

// GenerateLocalAppTextCandidate preserves the third-party Local App text
// capability contract while canonical App AIConfig execution composition is
// unavailable. The protected interceptor still supplies the current
// App/account permission decision and valid requests fail closed without
// resolving an ambient model, route, target, or fallback.
func (s *Service) GenerateLocalAppTextCandidate(ctx context.Context, req *runtimev1.GenerateLocalAppTextCandidateRequest) (*runtimev1.GenerateLocalAppTextCandidateResponse, error) {
	decision, ok := accountservice.AuthorizedLocalAppDecisionFromContext(ctx)
	if !ok || decision.Operation != accountservice.LocalAppOperationTextCandidateGenerate ||
		decision.AuthorityClass != localappop.AuthorityClassUserPermission ||
		decision.OperationCapability != "ai.text.generate" {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
	}
	if _, _, err := validateLocalAppTextCandidateRequest(req); err != nil {
		return nil, err
	}
	return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
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
