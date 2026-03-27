package ai

import (
	"context"
	"strings"
	"time"

	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
)

func (s *Service) recordRouteAutoSwitch(appID string, subjectUserID string, requestedModelID string, resolvedModelID string, decision nimillm.RouteDecisionInfo) {
	if !decision.HintAutoSwitch {
		return
	}
	s.persistModelRegistry()
	if s.audit == nil {
		return
	}
	payload, _ := structpb.NewStruct(map[string]any{
		"requestedModelId": strings.TrimSpace(requestedModelID),
		"resolvedModelId":  strings.TrimSpace(resolvedModelID),
		"backendName":      strings.TrimSpace(decision.BackendName),
		"hintFrom":         strings.TrimSpace(decision.HintFrom),
		"hintTo":           strings.TrimSpace(decision.HintTo),
	})
	s.audit.AppendEvent(&runtimev1.AuditEventRecord{
		AuditId:       ulid.Make().String(),
		AppId:         strings.TrimSpace(appID),
		SubjectUserId: strings.TrimSpace(subjectUserID),
		Domain:        "runtime.ai",
		Operation:     "route.auto_switch",
		ReasonCode:    runtimev1.ReasonCode_ACTION_EXECUTED,
		TraceId:       ulid.Make().String(),
		Timestamp:     timestamppb.New(time.Now().UTC()),
		Payload:       payload,
	})
}

func (s *Service) persistModelRegistry() {
	if s.registry == nil || s.registryPath == "" {
		return
	}
	if err := s.registry.SaveToFile(s.registryPath); err != nil && s.logger != nil {
		s.logger.Error("persist model registry from ai route switch failed", "path", s.registryPath, "error", err)
	}
}

func validatePromptRequest(appID string, subjectUserID string, modelID string, prompt string, route runtimev1.RoutePolicy) error {
	if err := validateBaseRequest(appID, subjectUserID, modelID, route); err != nil {
		return err
	}
	if strings.TrimSpace(prompt) == "" {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	return nil
}

func validateBaseRequest(appID string, subjectUserID string, modelID string, route runtimev1.RoutePolicy) error {
	return validateBaseRequestWithOptions(appID, subjectUserID, modelID, route, true)
}

func validateBaseRequestWithOptions(appID string, subjectUserID string, modelID string, route runtimev1.RoutePolicy, requireSubjectUserID bool) error {
	if strings.TrimSpace(appID) == "" {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_APP_ID_REQUIRED)
	}
	if strings.TrimSpace(modelID) == "" {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if requireSubjectUserID && strings.TrimSpace(subjectUserID) == "" {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if route == runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if isMultiModel(strings.TrimSpace(modelID)) {
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	return nil
}

func requireSubjectUserIDForScenario(
	route runtimev1.RoutePolicy,
	parsed ParsedKeySource,
	remoteTarget *nimillm.RemoteTarget,
) bool {
	if route != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL {
		return true
	}
	if remoteTarget != nil {
		return true
	}
	if strings.TrimSpace(parsed.KeySource) == keySourceInline {
		return true
	}
	if strings.TrimSpace(parsed.ProviderType) != "" || strings.TrimSpace(parsed.Endpoint) != "" || strings.TrimSpace(parsed.APIKey) != "" {
		return true
	}
	return false
}

func (s *Service) prepareScenarioRequest(ctx context.Context, head *runtimev1.ScenarioRequestHead, scenarioType runtimev1.ScenarioType) (*nimillm.RemoteTarget, error) {
	if head == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}

	parsed := parseKeySource(ctx, head.GetConnectorId())
	if err := validateKeySource(parsed, head.GetAppId()); err != nil {
		return nil, err
	}
	remoteTarget, err := resolveKeySourceToTarget(ctx, parsed, s.connStore, s.allowLoopback)
	if err != nil {
		return nil, err
	}
	if err := validateBaseRequestWithOptions(
		head.GetAppId(),
		head.GetSubjectUserId(),
		head.GetModelId(),
		head.GetRoutePolicy(),
		requireSubjectUserIDForScenario(head.GetRoutePolicy(), parsed, remoteTarget),
	); err != nil {
		return nil, err
	}
	if err := s.validateLocalModelRequest(ctx, head.GetModelId(), remoteTarget, scenarioModalFromType(scenarioType)); err != nil {
		return nil, err
	}
	return remoteTarget, nil
}

func composeInputText(systemPrompt string, input []*runtimev1.ChatMessage) string {
	textParts := make([]string, 0, len(input)+1)
	if trimmed := strings.TrimSpace(systemPrompt); trimmed != "" {
		textParts = append(textParts, trimmed)
	}
	for _, message := range input {
		if msgParts := message.GetParts(); len(msgParts) > 0 {
			for _, part := range msgParts {
				if part.GetType() == runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT {
					if text := strings.TrimSpace(part.GetText()); text != "" {
						textParts = append(textParts, text)
					}
				}
			}
			continue
		}
		content := strings.TrimSpace(message.GetContent())
		if content == "" {
			continue
		}
		textParts = append(textParts, content)
	}
	return strings.Join(textParts, "\n")
}

func estimateUsage(input string, output string) *runtimev1.UsageStats {
	inTokens := estimateTokens(input)
	outTokens := estimateTokens(output)
	return &runtimev1.UsageStats{
		InputTokens:  inTokens,
		OutputTokens: outTokens,
		ComputeMs:    maxInt64(5, outTokens*3),
	}
}

func estimateTokens(text string) int64 {
	count := len([]rune(strings.TrimSpace(text)))
	if count == 0 {
		return 0
	}
	tokens := count / 4
	if count%4 != 0 {
		tokens++
	}
	if tokens < 1 {
		tokens = 1
	}
	return int64(tokens)
}

func isMultiModel(modelID string) bool {
	return strings.Contains(modelID, ",") || strings.Contains(modelID, "->") || strings.Contains(modelID, "|")
}

func maxInt64(a int64, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
