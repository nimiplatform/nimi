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
	"google.golang.org/protobuf/proto"
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
// App supplies no route, implementation, target, model, tool, or stream.
func (s *Service) GenerateLocalAppTextCandidate(ctx context.Context, req *runtimev1.GenerateLocalAppTextCandidateRequest) (*runtimev1.GenerateLocalAppTextCandidateResponse, error) {
	decision, ok := accountservice.AuthorizedLocalAppDecisionFromContext(ctx)
	if !ok || decision.Operation != accountservice.LocalAppOperationTextCandidateGenerate ||
		decision.AuthorityClass != localappop.AuthorityClassAppAccess ||
		decision.OperationCapability != localappop.AppOperationIDTextCandidateGenerate {
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
			// Cold local model load is part of the Runtime-owned operation. Keep the
			// caller free of timeout authority while admitting the bounded Job timeout.
			TimeoutMs: int32(defaultTextGenerateJobTimeout.Milliseconds()),
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_TextGenerate{
			TextGenerate: &runtimev1.TextGenerateScenarioSpec{
				Input:            messages,
				SystemPrompt:     systemPrompt,
				Temperature:      localAppOptionalFloat32(req.Temperature),
				TopP:             localAppOptionalFloat32(req.TopP),
				MaxTokens:        localAppOptionalInt32(req.MaxTokens),
				TopK:             localAppOptionalInt32(req.TopK),
				PresencePenalty:  localAppOptionalFloat32(req.PresencePenalty),
				FrequencyPenalty: localAppOptionalFloat32(req.FrequencyPenalty),
				Stop:             append([]string(nil), req.GetStop()...),
				Seed:             localAppOptionalInt64(req.Seed),
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
	if req == nil {
		return "", nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	return validateLocalAppTextCandidateFields(
		req.GetMessages(), req.Temperature, req.TopP, req.MaxTokens, req.TopK,
		req.PresencePenalty, req.FrequencyPenalty, req.GetStop(),
	)
}

// validateLocalAppTextCandidateFields is the shared closed input boundary for
// the Local App unary text-candidate and streaming text-turn surfaces.
func validateLocalAppTextCandidateFields(
	messages []*runtimev1.LocalAppTextCandidateMessage,
	temperature *float32,
	topP *float32,
	maxTokens *int32,
	topK *int32,
	presencePenalty *float32,
	frequencyPenalty *float32,
	stop []string,
) (string, []*runtimev1.ChatMessage, error) {
	invalidScalar := func(value *float32, minValue float32, maxValue float32) bool {
		return value != nil && (math.IsNaN(float64(*value)) || math.IsInf(float64(*value), 0) || *value < minValue || *value > maxValue)
	}
	if len(messages) == 0 || len(messages) > maxLocalAppTextCandidateMessages ||
		(maxTokens != nil && (*maxTokens < 0 || *maxTokens > maxLocalAppTextCandidateTokens)) ||
		(topK != nil && *topK < 0) ||
		invalidScalar(temperature, 0, 2) || invalidScalar(topP, 0, 1) ||
		invalidScalar(presencePenalty, -2, 2) || invalidScalar(frequencyPenalty, -2, 2) {
		return "", nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	for _, value := range stop {
		if strings.TrimSpace(value) == "" {
			return "", nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
	}
	var systemPrompt string
	out := make([]*runtimev1.ChatMessage, 0, len(messages))
	totalBytes := 0
	seenUser := false
	for _, message := range messages {
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
			out = append(out, &runtimev1.ChatMessage{Role: role, Content: text})
		default:
			return "", nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
	}
	if !seenUser {
		return "", nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	return systemPrompt, out, nil
}

func localAppOptionalFloat32(value *float32) *float32 {
	if value == nil {
		return nil
	}
	return proto.Float32(*value)
}

func localAppOptionalInt32(value *int32) *int32 {
	if value == nil {
		return nil
	}
	return proto.Int32(*value)
}

func localAppOptionalInt64(value *int64) *int64 {
	if value == nil {
		return nil
	}
	return proto.Int64(*value)
}

func localAppOptionalBool(value *bool) *bool {
	if value == nil {
		return nil
	}
	return proto.Bool(*value)
}
