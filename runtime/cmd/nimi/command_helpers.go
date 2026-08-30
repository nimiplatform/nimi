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
		delta := event.GetDelta()
		payloadDelta := map[string]any{}
		if item := delta.GetTextOutputItem(); item != nil {
			payloadDelta["item_index"] = item.GetItemIndex()
			payloadDelta["item_completed"] = item.GetItemCompleted()
			switch value := item.GetDelta().(type) {
			case *runtimev1.TextOutputItemDelta_Text:
				payloadDelta["text"] = value.Text.GetText()
			case *runtimev1.TextOutputItemDelta_ReasoningSummary:
				payloadDelta["reasoning_summary"] = value.ReasoningSummary.GetText()
			case *runtimev1.TextOutputItemDelta_ToolCall:
				payloadDelta["tool_call"] = map[string]any{
					"id": value.ToolCall.GetId(), "name": value.ToolCall.GetName(), "arguments_json": value.ToolCall.GetArgumentsJson(),
				}
			case *runtimev1.TextOutputItemDelta_ReasoningContinuity:
				payloadDelta["reasoning_continuity"] = map[string]any{
					"kind": value.ReasoningContinuity.GetKind(), "version": value.ReasoningContinuity.GetVersion(), "size_bytes": len(value.ReasoningContinuity.GetPayload()),
				}
			}
		}
		if value, ok := delta.GetDelta().(*runtimev1.ScenarioStreamDelta_Artifact); ok {
			payloadDelta["mime_type"] = value.Artifact.GetMimeType()
			payloadDelta["chunk_size"] = len(value.Artifact.GetChunk())
		}
		payload["delta"] = payloadDelta
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
		failed := map[string]any{
			"reason_code": event.GetFailed().GetReasonCode().String(),
			"action_hint": event.GetFailed().GetActionHint(),
		}
		if interruption := event.GetFailed().GetInterruption(); interruption != nil {
			failed["interruption"] = map[string]any{
				"cause": interruption.GetCause().String(), "resubmit_disposition": interruption.GetResubmitDisposition().String(),
			}
		}
		payload["failed"] = failed
	}
	return payload
}

func extractScenarioStreamTextDelta(delta *runtimev1.ScenarioStreamDelta) string {
	if item := delta.GetTextOutputItem(); item != nil {
		return item.GetText().GetText()
	}
	return ""
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
