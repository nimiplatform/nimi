package runtimeagent

import (
	"context"
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

const publicChatAPMLRepairMaxTokens int32 = 2048

func shouldAttemptPublicChatAPMLRepair(raw string, parseErr error) bool {
	if parseErr == nil {
		return false
	}
	trimmed := strings.TrimSpace(raw)
	if !startsWithAPMLRoot(trimmed, "message") {
		return false
	}
	errText := parseErr.Error()
	if !strings.Contains(errText, "APML output invalid") {
		return false
	}
	return strings.Contains(errText, "XML syntax error") ||
		strings.Contains(errText, "unclosed <") ||
		strings.Contains(errText, "unexpected closing </") ||
		strings.Contains(errText, "closing </")
}

func publicChatAPMLRepairSystemPrompt(parseErr error) string {
	return strings.Join([]string{
		"Runtime APML repair task:",
		"- Repair exactly one malformed public-chat APML packet so it passes Runtime validation.",
		"- Return APML only. Do not answer the user. Do not output Markdown, JSON, prose, or code fences.",
		"- Preserve assistant-visible message text, prompt text, hook text, and existing emotion/activity intent when present.",
		"- Fix XML well-formedness, missing closing tags, and top-level APML structure only.",
		"- Do not add new facts or new user-facing content.",
		"- If content cannot be preserved as valid APML, return the closest valid APML packet with the original visible message text.",
		"Validation error: " + strings.TrimSpace(parseErr.Error()),
	}, "\n")
}

func publicChatAPMLRepairUserPayload(raw string) string {
	return "Malformed APML packet:\n" + strings.TrimSpace(raw)
}

func (r publicChatRuntime) repairPublicChatStructuredEnvelope(
	ctx context.Context,
	session publicChatAnchorState,
	turn publicChatTurnState,
	req publicChatTurnRequestPayload,
	raw string,
	parseErr error,
) (*publicChatStructuredEnvelope, string, error) {
	if !shouldAttemptPublicChatAPMLRepair(raw, parseErr) {
		return nil, "", parseErr
	}
	accumulatedText := &strings.Builder{}
	var finish *runtimev1.ScenarioStreamCompleted
	err := r.svc.currentPublicChatTurnExecutor().StreamChatTurn(ctx, &PublicChatTurnExecutionRequest{
		AppID:         session.CallerAppID,
		SubjectUserID: session.SubjectUserID,
		Messages: []*runtimev1.ChatMessage{
			{
				Role:    "user",
				Content: publicChatAPMLRepairUserPayload(raw),
			},
		},
		SystemPrompt:     publicChatAPMLRepairSystemPrompt(parseErr),
		MaxTokens:        firstPositiveInt32(publicChatAPMLRepairMaxTokens, req.MaxOutputTokens),
		Binding:          session.Binding,
		AvailableActions: turn.AvailableActions,
		Reasoning:        nil,
	}, func(event *runtimev1.StreamScenarioEvent) error {
		if event == nil {
			return nil
		}
		switch event.GetEventType() {
		case runtimev1.StreamEventType_STREAM_EVENT_DELTA:
			delta := event.GetDelta()
			if delta == nil {
				return nil
			}
			if text := delta.GetText(); text != nil {
				accumulatedText.WriteString(text.GetText())
			}
		case runtimev1.StreamEventType_STREAM_EVENT_COMPLETED:
			if event.GetCompleted() != nil {
				finish = proto.Clone(event.GetCompleted()).(*runtimev1.ScenarioStreamCompleted)
			}
		}
		return nil
	})
	if err != nil {
		return nil, "", fmt.Errorf("%w; APML repair failed: %v", parseErr, err)
	}
	if finish == nil {
		return nil, "", fmt.Errorf("%w; APML repair ended without terminal completion", parseErr)
	}
	repairedRaw := accumulatedText.String()
	structured, repairedErr := parsePublicChatStructuredEnvelope(repairedRaw)
	if repairedErr != nil {
		return nil, repairedRaw, fmt.Errorf("%w; APML repair output invalid: %v", parseErr, repairedErr)
	}
	return structured, repairedRaw, nil
}

func firstPositiveInt32(values ...int32) int32 {
	for _, value := range values {
		if value > 0 {
			return value
		}
	}
	return 0
}
