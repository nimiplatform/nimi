package main

import (
	"fmt"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/entrypoint"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
	"os"
	"strings"
	"time"
)

type multiStringFlag []string

func (f *multiStringFlag) String() string {
	if f == nil || len(*f) == 0 {
		return ""
	}
	return strings.Join(*f, ",")
}

func (f *multiStringFlag) Set(value string) error {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return fmt.Errorf("input value cannot be empty")
	}
	*f = append(*f, trimmed)
	return nil
}

func (f *multiStringFlag) Values() []string {
	if f == nil || len(*f) == 0 {
		return []string{}
	}
	out := make([]string, 0, len(*f))
	for _, item := range *f {
		trimmed := strings.TrimSpace(item)
		if trimmed == "" {
			continue
		}
		out = append(out, trimmed)
	}
	return out
}

func parseRoutePolicy(raw string) (runtimev1.RoutePolicy, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "local":
		return runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL, nil
	case "cloud":
		return runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD, nil
	default:
		return runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED, fmt.Errorf("invalid route %q (expected local|cloud)", raw)
	}
}

func parseFallbackPolicy(raw string) (runtimev1.FallbackPolicy, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "deny":
		return runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY, nil
	case "allow":
		return runtimev1.FallbackPolicy_FALLBACK_POLICY_ALLOW, nil
	default:
		return runtimev1.FallbackPolicy_FALLBACK_POLICY_UNSPECIFIED, fmt.Errorf("invalid fallback %q (expected deny|allow)", raw)
	}
}

func parseExternalPrincipalType(raw string) (runtimev1.ExternalPrincipalType, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "agent":
		return runtimev1.ExternalPrincipalType_EXTERNAL_PRINCIPAL_TYPE_AGENT, nil
	case "app":
		return runtimev1.ExternalPrincipalType_EXTERNAL_PRINCIPAL_TYPE_APP, nil
	case "service":
		return runtimev1.ExternalPrincipalType_EXTERNAL_PRINCIPAL_TYPE_SERVICE, nil
	default:
		return runtimev1.ExternalPrincipalType_EXTERNAL_PRINCIPAL_TYPE_UNSPECIFIED, fmt.Errorf("invalid external-type %q (expected agent|app|service)", raw)
	}
}

func parseExternalProofType(raw string) (runtimev1.ExternalProofType, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "jwt":
		return runtimev1.ExternalProofType_EXTERNAL_PROOF_TYPE_JWT, nil
	default:
		return runtimev1.ExternalProofType_EXTERNAL_PROOF_TYPE_UNSPECIFIED, fmt.Errorf("invalid proof-type %q (expected jwt)", raw)
	}
}

func parseReasonCode(raw string) (runtimev1.ReasonCode, error) {
	normalized := strings.TrimSpace(raw)
	if normalized == "" {
		return runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, nil
	}
	upper := strings.ToUpper(strings.ReplaceAll(normalized, "-", "_"))
	upper = strings.TrimSpace(upper)
	if value, ok := runtimev1.ReasonCode_value[upper]; ok {
		return runtimev1.ReasonCode(value), nil
	}
	if !strings.HasPrefix(upper, "REASON_CODE_") {
		if value, ok := runtimev1.ReasonCode_value["REASON_CODE_"+upper]; ok {
			return runtimev1.ReasonCode(value), nil
		}
	}
	return runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, fmt.Errorf("invalid reason-code %q", raw)
}

func parseCallerKindFilter(raw string) (runtimev1.CallerKind, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "":
		return runtimev1.CallerKind_CALLER_KIND_UNSPECIFIED, nil
	case "desktop-core", "desktop_core":
		return runtimev1.CallerKind_CALLER_KIND_DESKTOP_CORE, nil
	case "desktop-mod", "desktop_mod":
		return runtimev1.CallerKind_CALLER_KIND_DESKTOP_MOD, nil
	case "third-party-app", "third_party_app":
		return runtimev1.CallerKind_CALLER_KIND_THIRD_PARTY_APP, nil
	case "third-party-service", "third_party_service":
		return runtimev1.CallerKind_CALLER_KIND_THIRD_PARTY_SERVICE, nil
	default:
		upper := strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(raw), "-", "_"))
		if value, ok := runtimev1.CallerKind_value[upper]; ok {
			return runtimev1.CallerKind(value), nil
		}
		if !strings.HasPrefix(upper, "CALLER_KIND_") {
			if value, ok := runtimev1.CallerKind_value["CALLER_KIND_"+upper]; ok {
				return runtimev1.CallerKind(value), nil
			}
		}
		return runtimev1.CallerKind_CALLER_KIND_UNSPECIFIED, fmt.Errorf("invalid filter-caller-kind %q", raw)
	}
}

func parseUsageWindow(raw string) (runtimev1.UsageWindow, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "minute":
		return runtimev1.UsageWindow_USAGE_WINDOW_MINUTE, nil
	case "hour":
		return runtimev1.UsageWindow_USAGE_WINDOW_HOUR, nil
	case "day":
		return runtimev1.UsageWindow_USAGE_WINDOW_DAY, nil
	default:
		return runtimev1.UsageWindow_USAGE_WINDOW_UNSPECIFIED, fmt.Errorf("invalid window %q (expected minute|hour|day)", raw)
	}
}

func parseOptionalTimestamp(raw string) (*timestamppb.Timestamp, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	value, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		return nil, fmt.Errorf("parse time %q: %w", raw, err)
	}
	return timestamppb.New(value.UTC()), nil
}

func parsePolicyMode(raw string) (runtimev1.PolicyMode, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "preset":
		return runtimev1.PolicyMode_POLICY_MODE_PRESET, nil
	case "custom":
		return runtimev1.PolicyMode_POLICY_MODE_CUSTOM, nil
	default:
		return runtimev1.PolicyMode_POLICY_MODE_UNSPECIFIED, fmt.Errorf("invalid policy-mode %q (expected preset|custom)", raw)
	}
}

func parseAuthorizationPreset(raw string) (runtimev1.AuthorizationPreset, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "read-only", "readonly", "read_only":
		return runtimev1.AuthorizationPreset_AUTHORIZATION_PRESET_READ_ONLY, nil
	case "full":
		return runtimev1.AuthorizationPreset_AUTHORIZATION_PRESET_FULL, nil
	case "delegate":
		return runtimev1.AuthorizationPreset_AUTHORIZATION_PRESET_DELEGATE, nil
	default:
		return runtimev1.AuthorizationPreset_AUTHORIZATION_PRESET_UNSPECIFIED, fmt.Errorf("invalid preset %q (expected read-only|full|delegate)", raw)
	}
}

func parseAppMode(raw string) (runtimev1.AppMode, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "lite":
		return runtimev1.AppMode_APP_MODE_LITE, nil
	case "core-only", "core_only", "coreonly":
		return runtimev1.AppMode_APP_MODE_CORE_ONLY, nil
	case "full":
		return runtimev1.AppMode_APP_MODE_FULL, nil
	default:
		return runtimev1.AppMode_APP_MODE_UNSPECIFIED, fmt.Errorf("invalid app-mode %q (expected lite|core-only|full)", raw)
	}
}

func parseWorldRelation(raw string) (runtimev1.WorldRelation, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "none":
		return runtimev1.WorldRelation_WORLD_RELATION_NONE, nil
	case "render":
		return runtimev1.WorldRelation_WORLD_RELATION_RENDER, nil
	case "extension":
		return runtimev1.WorldRelation_WORLD_RELATION_EXTENSION, nil
	default:
		return runtimev1.WorldRelation_WORLD_RELATION_UNSPECIFIED, fmt.Errorf("invalid world-relation %q (expected none|render|extension)", raw)
	}
}

func loadResourceSelectorsFile(path string) (*runtimev1.ResourceSelectors, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return nil, nil
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read resource selectors file %s: %w", path, err)
	}
	selectors := &runtimev1.ResourceSelectors{}
	if err := protojson.Unmarshal(raw, selectors); err != nil {
		return nil, fmt.Errorf("parse resource selectors file %s: %w", path, err)
	}
	return selectors, nil
}

func selectorsAsMap(selectors *runtimev1.ResourceSelectors) map[string]any {
	if selectors == nil {
		return map[string]any{}
	}
	labels := map[string]string{}
	for key, value := range selectors.GetLabels() {
		labels[key] = value
	}
	return map[string]any{
		"conversation_ids": selectors.GetConversationIds(),
		"message_ids":      selectors.GetMessageIds(),
		"document_ids":     selectors.GetDocumentIds(),
		"labels":           labels,
	}
}

func consentAsMap(consent *runtimev1.ConsentRef) map[string]any {
	if consent == nil {
		return map[string]any{}
	}
	return map[string]any{
		"subject_user_id": consent.GetSubjectUserId(),
		"consent_id":      consent.GetConsentId(),
		"consent_version": consent.GetConsentVersion(),
	}
}

func runtimeAICallerMetadataFromFlags(callerKind string, callerID string, surfaceID string, traceID string) *entrypoint.ClientMetadata {
	return &entrypoint.ClientMetadata{
		CallerKind: strings.TrimSpace(callerKind),
		CallerID:   strings.TrimSpace(callerID),
		SurfaceID:  strings.TrimSpace(surfaceID),
		TraceID:    strings.TrimSpace(traceID),
	}
}

func streamEventJSON(event *runtimev1.StreamScenarioEvent) map[string]any {
	payload := map[string]any{
		"event_type": event.GetEventType().String(),
		"sequence":   event.GetSequence(),
		"trace_id":   event.GetTraceId(),
		"timestamp":  "",
	}
	if ts := event.GetTimestamp(); ts != nil {
		payload["timestamp"] = ts.AsTime().UTC().Format(time.RFC3339Nano)
	}

	switch event.GetEventType() {
	case runtimev1.StreamEventType_STREAM_EVENT_STARTED:
		payload["started"] = map[string]any{
			"model_resolved": event.GetStarted().GetModelResolved(),
			"route_decision": event.GetStarted().GetRouteDecision().String(),
		}
	case runtimev1.StreamEventType_STREAM_EVENT_DELTA:
		payload["delta"] = map[string]any{
			"text":      event.GetDelta().GetText(),
			"mime_type": event.GetDelta().GetMimeType(),
		}
	case runtimev1.StreamEventType_STREAM_EVENT_USAGE:
		payload["usage"] = map[string]any{
			"input_tokens":  event.GetUsage().GetInputTokens(),
			"output_tokens": event.GetUsage().GetOutputTokens(),
			"compute_ms":    event.GetUsage().GetComputeMs(),
		}
	case runtimev1.StreamEventType_STREAM_EVENT_COMPLETED:
		payload["completed"] = map[string]any{
			"finish_reason": event.GetCompleted().GetFinishReason().String(),
		}
	case runtimev1.StreamEventType_STREAM_EVENT_FAILED:
		payload["failed"] = map[string]any{
			"reason_code": event.GetFailed().GetReasonCode().String(),
			"action_hint": event.GetFailed().GetActionHint(),
		}
	}
	return payload
}

func workflowEventJSON(event *runtimev1.WorkflowEvent) map[string]any {
	payload := map[string]any{
		"event_type": event.GetEventType().String(),
		"sequence":   event.GetSequence(),
		"task_id":    event.GetTaskId(),
		"trace_id":   event.GetTraceId(),
		"timestamp":  "",
		"node_id":    event.GetNodeId(),
		"progress":   event.GetProgressPercent(),
		"reason":     event.GetReasonCode().String(),
		"payload":    map[string]any{},
	}
	if ts := event.GetTimestamp(); ts != nil {
		payload["timestamp"] = ts.AsTime().UTC().Format(time.RFC3339Nano)
	}
	if data := event.GetPayload(); data != nil {
		payload["payload"] = data.AsMap()
	}
	return payload
}

func workflowEventLine(event *runtimev1.WorkflowEvent) string {
	timestamp := ""
	if ts := event.GetTimestamp(); ts != nil {
		timestamp = ts.AsTime().UTC().Format(time.RFC3339Nano)
	}
	nodeID := strings.TrimSpace(event.GetNodeId())
	if nodeID == "" {
		nodeID = "-"
	}
	return fmt.Sprintf(
		"ts=%s seq=%d type=%s task=%s node=%s progress=%d reason=%s",
		timestamp,
		event.GetSequence(),
		event.GetEventType().String(),
		event.GetTaskId(),
		nodeID,
		event.GetProgressPercent(),
		event.GetReasonCode().String(),
	)
}

func appMessageEventJSON(event *runtimev1.AppMessageEvent) map[string]any {
	payload := map[string]any{
		"event_type":   event.GetEventType().String(),
		"sequence":     event.GetSequence(),
		"message_id":   event.GetMessageId(),
		"from_app_id":  event.GetFromAppId(),
		"to_app_id":    event.GetToAppId(),
		"subject_user": event.GetSubjectUserId(),
		"message_type": event.GetMessageType(),
		"reason_code":  event.GetReasonCode().String(),
		"trace_id":     event.GetTraceId(),
		"timestamp":    "",
		"payload":      structAsMap(event.GetPayload()),
	}
	if ts := event.GetTimestamp(); ts != nil {
		payload["timestamp"] = ts.AsTime().UTC().Format(time.RFC3339Nano)
	}
	return payload
}

func appMessageEventLine(event *runtimev1.AppMessageEvent) string {
	timestamp := ""
	if ts := event.GetTimestamp(); ts != nil {
		timestamp = ts.AsTime().UTC().Format(time.RFC3339Nano)
	}
	return fmt.Sprintf(
		"ts=%s seq=%d type=%s message=%s from=%s to=%s subject=%s message_type=%s reason=%s",
		timestamp,
		event.GetSequence(),
		event.GetEventType().String(),
		event.GetMessageId(),
		event.GetFromAppId(),
		event.GetToAppId(),
		event.GetSubjectUserId(),
		event.GetMessageType(),
		event.GetReasonCode().String(),
	)
}

func loadWorkflowDefinitionFile(path string) (*runtimev1.WorkflowDefinition, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return nil, fmt.Errorf("definition file path is required")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read workflow definition file %s: %w", path, err)
	}

	definition := &runtimev1.WorkflowDefinition{}
	if err := protojson.Unmarshal(raw, definition); err != nil {
		return nil, fmt.Errorf("parse workflow definition file %s: %w", path, err)
	}
	if strings.TrimSpace(definition.GetWorkflowType()) == "" {
		return nil, fmt.Errorf("workflow_type is required in definition file")
	}
	if len(definition.GetNodes()) == 0 {
		return nil, fmt.Errorf("nodes is required in definition file")
	}
	for index, node := range definition.GetNodes() {
		if strings.TrimSpace(node.GetNodeId()) == "" || node.GetNodeType() == runtimev1.WorkflowNodeType_WORKFLOW_NODE_TYPE_UNSPECIFIED {
			return nil, fmt.Errorf("nodes[%d] must include node_id and node_type", index)
		}
		if node.GetTypeConfig() == nil {
			return nil, fmt.Errorf("nodes[%d] must include typed config for node_type", index)
		}
	}
	return definition, nil
}

func loadStructFile(path string, label string) (*structpb.Struct, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return nil, nil
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read %s file %s: %w", label, path, err)
	}
	value := &structpb.Struct{}
	if err := protojson.Unmarshal(raw, value); err != nil {
		return nil, fmt.Errorf("parse %s file %s: %w", label, path, err)
	}
	return value, nil
}

func structAsMap(value *structpb.Struct) map[string]any {
	if value == nil {
		return map[string]any{}
	}
	return value.AsMap()
}
