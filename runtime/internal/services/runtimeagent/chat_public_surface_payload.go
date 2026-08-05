package runtimeagent

import (
	"bytes"
	"encoding/json"
	"io"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/runtimeidentity"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func normalizePublicChatReasoning(input *publicChatReasoningPayload) *publicChatReasoningConfig {
	if input == nil {
		return nil
	}
	mode := parsePublicChatReasoningMode(input.Mode)
	traceMode := parsePublicChatReasoningTraceMode(input.TraceMode)
	if mode == runtimev1.ReasoningMode_REASONING_MODE_UNSPECIFIED &&
		traceMode == runtimev1.ReasoningTraceMode_REASONING_TRACE_MODE_UNSPECIFIED &&
		input.BudgetTokens <= 0 {
		return nil
	}
	return &publicChatReasoningConfig{
		Mode:         mode,
		TraceMode:    traceMode,
		BudgetTokens: input.BudgetTokens,
	}
}
func toProtoReasoningConfig(input *publicChatReasoningConfig) *runtimev1.ReasoningConfig {
	if input == nil {
		return nil
	}
	return &runtimev1.ReasoningConfig{
		Mode:         input.Mode,
		TraceMode:    input.TraceMode,
		BudgetTokens: input.BudgetTokens,
	}
}
func toProtoPublicChatMessages(input []publicChatMessagePayload) []*runtimev1.ChatMessage {
	out := make([]*runtimev1.ChatMessage, 0, len(input))
	for _, item := range input {
		role := strings.TrimSpace(item.Role)
		content := strings.TrimSpace(item.Content)
		if role == "" || content == "" {
			continue
		}
		out = append(out, &runtimev1.ChatMessage{
			Role:    role,
			Content: content,
			Name:    strings.TrimSpace(item.Name),
		})
	}
	return out
}
func decodePublicChatTurnRequestPayload(payload any) (publicChatTurnRequestPayload, error) {
	raw, err := decodePublicChatStructPayload(payload)
	if err != nil {
		return publicChatTurnRequestPayload{}, err
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var decoded publicChatTurnRequestPayload
	if err := decoder.Decode(&decoded); err != nil {
		return publicChatTurnRequestPayload{}, grpcerr.WrapWithReasonCode(
			codes.InvalidArgument,
			runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID,
			err,
			grpcerr.ReasonOptions{Message: "public chat turn payload invalid"},
		)
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return publicChatTurnRequestPayload{}, status.Error(codes.InvalidArgument, "public chat turn payload must contain one object")
		}
		return publicChatTurnRequestPayload{}, grpcerr.WrapWithReasonCode(
			codes.InvalidArgument,
			runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID,
			err,
			grpcerr.ReasonOptions{Message: "public chat turn payload invalid"},
		)
	}
	if strings.TrimSpace(decoded.AgentID) != "" {
		return publicChatTurnRequestPayload{}, status.Error(codes.InvalidArgument, "public chat turn payload must use local_agent_ref, not agent_id")
	}
	if strings.TrimSpace(decoded.SystemPrompt) != "" {
		return publicChatTurnRequestPayload{}, status.Error(codes.InvalidArgument, "public chat turn payload must not include system_prompt")
	}
	if len(decoded.ExecutionBindings) > 0 {
		// K-AGCORE-147: request-carried execution_bindings are rejected on
		// ingress; the committed Runtime Agent AI Config is the only binding truth.
		return publicChatTurnRequestPayload{}, errPublicChatRequestExecutionBindingsNotAdmitted
	}
	if len(decoded.ExecutionParams) > 0 {
		return publicChatTurnRequestPayload{}, status.Error(codes.InvalidArgument, "public chat execution_params are not admitted on LocalAgent turns")
	}
	if strings.TrimSpace(decoded.WorldID) != "" {
		return publicChatTurnRequestPayload{}, status.Error(codes.InvalidArgument, "public chat world_id override is not admitted")
	}
	if _, err := validateLocalAgentIdentity(decoded.OwnerUserID, decoded.RuntimeSourceRef, decoded.LocalAgentRef); err != nil {
		return publicChatTurnRequestPayload{}, err
	}
	if len(decoded.Messages) != 1 {
		return publicChatTurnRequestPayload{}, status.Error(codes.InvalidArgument, "public chat turn payload requires exactly one current user message")
	}
	for _, message := range decoded.Messages {
		if strings.TrimSpace(message.Role) != "user" {
			return publicChatTurnRequestPayload{}, status.Error(codes.InvalidArgument, "public chat current turn accepts only user role")
		}
		if len(message.Attachments) > 1 {
			return publicChatTurnRequestPayload{}, status.Error(codes.InvalidArgument, "public chat current turn accepts at most one attachment")
		}
		for _, attachment := range message.Attachments {
			if trimmed := strings.TrimSpace(attachment.ArtifactID); trimmed == "" || trimmed != attachment.ArtifactID {
				return publicChatTurnRequestPayload{}, status.Error(codes.InvalidArgument, "public chat attachment artifact_id is invalid")
			}
		}
		if strings.TrimSpace(message.Content) == "" && len(message.Attachments) == 0 {
			return publicChatTurnRequestPayload{}, status.Error(codes.InvalidArgument, "public chat current user message requires content or one attachment")
		}
		if strings.TrimSpace(message.Name) != "" {
			return publicChatTurnRequestPayload{}, status.Error(codes.InvalidArgument, "public chat caller message name is not admitted")
		}
	}
	if decoded.MaxOutputTokens < 0 {
		return publicChatTurnRequestPayload{}, status.Error(codes.InvalidArgument, "public chat max_output_tokens must be non-negative")
	}
	return decoded, nil
}
func decodePublicChatTurnInterruptPayload(payload any) (publicChatTurnInterruptPayload, error) {
	raw, err := decodePublicChatStructPayload(payload)
	if err != nil {
		return publicChatTurnInterruptPayload{}, err
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var decoded publicChatTurnInterruptPayload
	if err := decoder.Decode(&decoded); err != nil {
		return publicChatTurnInterruptPayload{}, grpcerr.WrapWithReasonCode(
			codes.InvalidArgument,
			runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID,
			err,
			grpcerr.ReasonOptions{Message: "public chat interrupt payload invalid"},
		)
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return publicChatTurnInterruptPayload{}, status.Error(codes.InvalidArgument, "public chat interrupt payload must contain one object")
		}
		return publicChatTurnInterruptPayload{}, grpcerr.WrapWithReasonCode(
			codes.InvalidArgument,
			runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID,
			err,
			grpcerr.ReasonOptions{Message: "public chat interrupt payload invalid"},
		)
	}
	if strings.TrimSpace(decoded.ConversationAnchorID) == "" {
		return publicChatTurnInterruptPayload{}, status.Error(codes.InvalidArgument, "public chat interrupt payload requires conversation_anchor_id")
	}
	return decoded, nil
}

func decodePublicChatTurnVoiceRenderPayload(payload any) (publicChatTurnVoiceRenderPayload, error) {
	raw, err := decodePublicChatStructPayload(payload)
	if err != nil {
		return publicChatTurnVoiceRenderPayload{}, err
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var decoded publicChatTurnVoiceRenderPayload
	if err := decoder.Decode(&decoded); err != nil {
		return publicChatTurnVoiceRenderPayload{}, grpcerr.WrapWithReasonCode(
			codes.InvalidArgument,
			runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID,
			err,
			grpcerr.ReasonOptions{Message: "public chat voice render payload invalid"},
		)
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return publicChatTurnVoiceRenderPayload{}, status.Error(codes.InvalidArgument, "public chat voice render payload must contain one object")
		}
		return publicChatTurnVoiceRenderPayload{}, grpcerr.WrapWithReasonCode(
			codes.InvalidArgument,
			runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID,
			err,
			grpcerr.ReasonOptions{Message: "public chat voice render payload invalid"},
		)
	}
	if strings.TrimSpace(decoded.ConversationAnchorID) == "" {
		return publicChatTurnVoiceRenderPayload{}, status.Error(codes.InvalidArgument, "public chat voice render payload requires conversation_anchor_id")
	}
	if strings.TrimSpace(decoded.TurnID) == "" {
		return publicChatTurnVoiceRenderPayload{}, status.Error(codes.InvalidArgument, "public chat voice render payload requires turn_id")
	}
	if strings.TrimSpace(decoded.MessageID) == "" {
		return publicChatTurnVoiceRenderPayload{}, status.Error(codes.InvalidArgument, "public chat voice render payload requires message_id")
	}
	switch strings.TrimSpace(decoded.PlaybackTarget) {
	case "", "desktop_manual", "replay":
	default:
		return publicChatTurnVoiceRenderPayload{}, status.Error(codes.InvalidArgument, "public chat voice render playback_target invalid")
	}
	return decoded, nil
}

func decodePublicChatStructPayload(payload any) ([]byte, error) {
	structPayload, ok := payload.(interface{ AsMap() map[string]any })
	if !ok || structPayload == nil {
		return nil, status.Error(codes.InvalidArgument, "public chat payload is required")
	}
	raw, err := json.Marshal(structPayload.AsMap())
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(
			codes.InvalidArgument,
			runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID,
			err,
			grpcerr.ReasonOptions{Message: "public chat payload invalid"},
		)
	}
	return raw, nil
}
func parsePublicChatRoutePolicy(value string) (runtimev1.RoutePolicy, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "local", "route_policy_local":
		return runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL, nil
	case "cloud", "route_policy_cloud":
		return runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD, nil
	default:
		return runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED, status.Error(codes.InvalidArgument, "public chat execution binding route must be local or cloud")
	}
}
func parseOptionalPublicChatRoutePolicy(value string) (runtimev1.RoutePolicy, error) {
	if strings.TrimSpace(value) == "" {
		return runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED, nil
	}
	return parsePublicChatRoutePolicy(value)
}
func clonePublicChatTargetRef(input *runtimeidentity.Target) *runtimeidentity.Target {
	return input.Clone()
}
func parsePublicChatReasoningMode(value string) runtimev1.ReasoningMode {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "off", "reasoning_mode_off":
		return runtimev1.ReasoningMode_REASONING_MODE_OFF
	case "on", "reasoning_mode_on":
		return runtimev1.ReasoningMode_REASONING_MODE_ON
	default:
		return runtimev1.ReasoningMode_REASONING_MODE_UNSPECIFIED
	}
}
func parsePublicChatReasoningTraceMode(value string) runtimev1.ReasoningTraceMode {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "hide", "reasoning_trace_mode_hide":
		return runtimev1.ReasoningTraceMode_REASONING_TRACE_MODE_HIDE
	case "separate", "reasoning_trace_mode_separate":
		return runtimev1.ReasoningTraceMode_REASONING_TRACE_MODE_SEPARATE
	default:
		return runtimev1.ReasoningTraceMode_REASONING_TRACE_MODE_UNSPECIFIED
	}
}
func publicChatRouteLabel(route runtimev1.RoutePolicy) string {
	switch route {
	case runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD:
		return "cloud"
	case runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL:
		return "local"
	default:
		return "unspecified"
	}
}
func publicChatFinishReasonLabel(reason runtimev1.FinishReason) string {
	switch reason {
	case runtimev1.FinishReason_FINISH_REASON_STOP:
		return "stop"
	case runtimev1.FinishReason_FINISH_REASON_LENGTH:
		return "length"
	case runtimev1.FinishReason_FINISH_REASON_TOOL_CALL:
		return "tool_call"
	case runtimev1.FinishReason_FINISH_REASON_CONTENT_FILTER:
		return "content_filter"
	case runtimev1.FinishReason_FINISH_REASON_ERROR:
		return "error"
	default:
		return "unspecified"
	}
}
func publicChatReasonCodeLabel(code runtimev1.ReasonCode) string {
	if code == runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		return "REASON_CODE_UNSPECIFIED"
	}
	return code.String()
}
func usagePayload(usage *runtimev1.UsageStats) map[string]any {
	if usage == nil {
		return map[string]any{}
	}
	return map[string]any{
		"input_tokens":  usage.GetInputTokens(),
		"output_tokens": usage.GetOutputTokens(),
		"compute_ms":    usage.GetComputeMs(),
	}
}
func (o publicChatAssistantMemoryOutcome) payload() map[string]any {
	payload := map[string]any{
		"status":         o.Status,
		"accepted_count": o.AcceptedCount,
		"rejected_count": o.RejectedCount,
	}
	if o.ReasonCode != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		payload["reason_code"] = publicChatReasonCodeLabel(o.ReasonCode)
	}
	if strings.TrimSpace(o.Message) != "" {
		payload["message"] = strings.TrimSpace(o.Message)
	}
	return payload
}
func (o publicChatSidecarOutcome) payload() map[string]any {
	payload := map[string]any{
		"status":                o.Status,
		"accepted_memory_count": o.AcceptedMemoryCount,
		"canceled_hook_ids":     stringSlicePayload(o.CanceledHookIDs),
	}
	if strings.TrimSpace(o.ScheduledHookID) != "" {
		payload["scheduled_hook_id"] = o.ScheduledHookID
	}
	if strings.TrimSpace(o.StatusText) != "" {
		payload["status_text"] = o.StatusText
	}
	if o.ReasonCode != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		payload["reason_code"] = publicChatReasonCodeLabel(o.ReasonCode)
	}
	if strings.TrimSpace(o.Message) != "" {
		payload["message"] = strings.TrimSpace(o.Message)
	}
	return payload
}
func stringSlicePayload(values []string) []any {
	out := make([]any, 0, len(values))
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}
