package ai

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

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

func scenarioTargetCapability(scenarioType runtimev1.ScenarioType) string {
	switch scenarioType {
	case runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE:
		return "text.generate"
	case runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_EMBED:
		return "text.embed"
	case runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE:
		return "image.generate"
	case runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE:
		return "video.generate"
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE:
		return "audio.synthesize"
	case runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE:
		return "voice_workflow.voice_clone"
	case runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN:
		return "voice_workflow.voice_design"
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE:
		return "audio.transcribe"
	case runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE:
		return "music.generate"
	case runtimev1.ScenarioType_SCENARIO_TYPE_WORLD_GENERATE:
		return "world.generate"
	default:
		return ""
	}
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
