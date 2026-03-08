package main

import (
	"encoding/json"
	"fmt"
	"strings"

	"google.golang.org/grpc/status"
)

func withReplayFailure(payload *aiReplayPayload, err error) *aiReplayPayload {
	out := *payload
	details := extractReplayErrorDetails(err)
	out.Status = "failed"
	out.ReasonCode = details.ReasonCode
	out.ActionHint = details.ActionHint
	out.Error = details.Message
	return &out
}

func extractReplayErrorDetails(err error) aiReplayErrorDetails {
	if err == nil {
		return aiReplayErrorDetails{}
	}
	message := strings.TrimSpace(err.Error())
	if grpcStatus, ok := status.FromError(err); ok {
		message = strings.TrimSpace(grpcStatus.Message())
	}
	payload := map[string]any{}
	if json.Unmarshal([]byte(message), &payload) == nil {
		reasonCode := strings.TrimSpace(replayAsString(payload["reasonCode"]))
		actionHint := strings.TrimSpace(replayAsString(payload["actionHint"]))
		if detail := strings.TrimSpace(replayAsString(payload["message"])); detail != "" {
			message = detail
		}
		if reasonCode != "" || actionHint != "" {
			return aiReplayErrorDetails{
				ReasonCode: reasonCode,
				ActionHint: actionHint,
				Message:    firstNonEmptyString(message, strings.TrimSpace(err.Error())),
			}
		}
	}
	reasonCode := extractReasonCodeFromText(message)
	actionHint := extractActionHintFromText(message)
	return aiReplayErrorDetails{
		ReasonCode: reasonCode,
		ActionHint: actionHint,
		Message:    firstNonEmptyString(message, strings.TrimSpace(err.Error())),
	}
}

func extractReasonCodeFromText(value string) string {
	text := strings.TrimSpace(value)
	if text == "" {
		return ""
	}
	parts := strings.FieldsFunc(text, func(r rune) bool {
		return !(r >= 'A' && r <= 'Z') && !(r >= '0' && r <= '9') && r != '_'
	})
	for _, part := range parts {
		if strings.HasPrefix(part, "AI_") || strings.HasPrefix(part, "RUNTIME_") || strings.HasPrefix(part, "VIDEOPLAY_") {
			return part
		}
	}
	return ""
}

func extractActionHintFromText(value string) string {
	text := strings.TrimSpace(value)
	if text == "" {
		return ""
	}
	if marker := "actionHint="; strings.Contains(text, marker) {
		segment := strings.SplitN(text, marker, 2)[1]
		return strings.Fields(segment)[0]
	}
	return ""
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func replayAsString(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	default:
		return fmt.Sprint(value)
	}
}

func printJSON(value any) error {
	raw, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	fmt.Println(string(raw))
	return nil
}
