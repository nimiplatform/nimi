package runtimeagent

import (
	"bytes"
	"encoding/json"
	"io"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
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
		return publicChatTurnRequestPayload{}, status.Error(codes.InvalidArgument, "public chat turn payload invalid")
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return publicChatTurnRequestPayload{}, status.Error(codes.InvalidArgument, "public chat turn payload must contain one object")
		}
		return publicChatTurnRequestPayload{}, status.Error(codes.InvalidArgument, "public chat turn payload invalid")
	}
	if strings.TrimSpace(decoded.AgentID) != "" {
		return publicChatTurnRequestPayload{}, status.Error(codes.InvalidArgument, "public chat turn payload must use local_agent_ref, not agent_id")
	}
	if _, err := validateLocalAgentIdentity(decoded.OwnerUserID, decoded.RealmAgentID, decoded.LocalAgentRef); err != nil {
		return publicChatTurnRequestPayload{}, err
	}
	if len(toProtoPublicChatMessages(decoded.Messages)) == 0 {
		return publicChatTurnRequestPayload{}, status.Error(codes.InvalidArgument, "public chat turn payload requires messages")
	}
	if decoded.MaxOutputTokens < 0 {
		return publicChatTurnRequestPayload{}, status.Error(codes.InvalidArgument, "public chat max_output_tokens must be non-negative")
	}
	if decoded.ExecutionBinding != nil {
		if strings.TrimSpace(decoded.ExecutionBinding.ModelID) == "" {
			return publicChatTurnRequestPayload{}, status.Error(codes.InvalidArgument, "public chat execution_binding.model_id is required")
		}
		if _, err := parseOptionalPublicChatRoutePolicy(decoded.ExecutionBinding.Route); err != nil {
			return publicChatTurnRequestPayload{}, err
		}
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
		return publicChatTurnInterruptPayload{}, status.Error(codes.InvalidArgument, "public chat interrupt payload invalid")
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return publicChatTurnInterruptPayload{}, status.Error(codes.InvalidArgument, "public chat interrupt payload must contain one object")
		}
		return publicChatTurnInterruptPayload{}, status.Error(codes.InvalidArgument, "public chat interrupt payload invalid")
	}
	if strings.TrimSpace(decoded.ConversationAnchorID) == "" {
		return publicChatTurnInterruptPayload{}, status.Error(codes.InvalidArgument, "public chat interrupt payload requires conversation_anchor_id")
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
		return nil, status.Error(codes.InvalidArgument, "public chat payload invalid")
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
		return runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED, status.Error(codes.InvalidArgument, "public chat execution_binding.route must be local or cloud")
	}
}
func parseOptionalPublicChatRoutePolicy(value string) (runtimev1.RoutePolicy, error) {
	if strings.TrimSpace(value) == "" {
		return runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED, nil
	}
	return parsePublicChatRoutePolicy(value)
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
func publicChatExecutionBindingMismatch(left publicChatExecutionBinding, right publicChatExecutionBinding) bool {
	return strings.TrimSpace(left.ModelID) != strings.TrimSpace(right.ModelID) ||
		left.RoutePolicy != right.RoutePolicy ||
		strings.TrimSpace(left.ConnectorID) != strings.TrimSpace(right.ConnectorID)
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
