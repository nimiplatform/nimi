package ai

import (
	"context"
	"io"
	"log/slog"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func TestValidateScenarioCapabilitySupportedModelPasses(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))

	err := svc.validateScenarioCapability(
		context.Background(),
		runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		"anthropic/claude-sonnet-4-6",
		nil,
		nil,
	)
	if err != nil {
		t.Fatalf("expected supported scenario capability, got error: %v", err)
	}
}

func TestValidateScenarioCapabilityFailCloseReasonCodes(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))

	testCases := []struct {
		name       string
		scenario   runtimev1.ScenarioType
		model      string
		expectedRC runtimev1.ReasonCode
	}{
		{
			name:       "text embed unsupported",
			scenario:   runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_EMBED,
			model:      "anthropic/claude-sonnet-4-6",
			expectedRC: runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED,
		},
		{
			name:       "image generate unsupported",
			scenario:   runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
			model:      "anthropic/claude-sonnet-4-6",
			expectedRC: runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED,
		},
		{
			name:       "voice clone unsupported",
			scenario:   runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE,
			model:      "openai/tts-1",
			expectedRC: runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			err := svc.validateScenarioCapability(context.Background(), tc.scenario, tc.model, nil, nil)
			if err == nil {
				t.Fatalf("expected capability guard error")
			}
			reasonCode, ok := grpcerr.ExtractReasonCode(err)
			if !ok {
				t.Fatalf("expected grpc reason code, got error: %v", err)
			}
			if reasonCode != tc.expectedRC {
				t.Fatalf("reason code mismatch: got=%s want=%s", reasonCode.String(), tc.expectedRC.String())
			}
		})
	}
}

func TestValidateScenarioCapabilityCatalogUnavailableFailsClosedForCloudProvider(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	svc.speechCatalog = nil

	err := svc.validateScenarioCapability(
		context.Background(),
		runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		"anthropic/claude-sonnet-4-6",
		nil,
		nil,
	)
	if err == nil {
		t.Fatal("expected capability guard error")
	}
	reasonCode, ok := grpcerr.ExtractReasonCode(err)
	if !ok {
		t.Fatalf("expected grpc reason code, got error: %v", err)
	}
	if reasonCode != runtimev1.ReasonCode_AI_PROVIDER_INTERNAL {
		t.Fatalf("reason code mismatch: got=%s want=%s", reasonCode.String(), runtimev1.ReasonCode_AI_PROVIDER_INTERNAL.String())
	}
}

func TestValidateScenarioCapabilityCatalogUnavailableAllowsLocalProvider(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	svc.speechCatalog = nil

	err := svc.validateScenarioCapability(
		context.Background(),
		runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		"media/local-import/z_image_turbo-Q4_K",
		nil,
		nil,
	)
	if err != nil {
		t.Fatalf("expected local provider capability guard bypass, got error: %v", err)
	}
}

func TestValidateScenarioCapabilityRejectsUnsupportedLocalLlamaVideo(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))

	err := svc.validateScenarioCapability(
		context.Background(),
		runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE,
		"llama/wan2.2",
		nil,
		&localProvider{},
	)
	if err == nil {
		t.Fatal("expected capability guard error")
	}
	reasonCode, ok := grpcerr.ExtractReasonCode(err)
	if !ok {
		t.Fatalf("expected grpc reason code, got error: %v", err)
	}
	if reasonCode != runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED {
		t.Fatalf("reason code mismatch: got=%s want=%s", reasonCode.String(), runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED.String())
	}
}

func TestValidateScenarioCapabilityLocalVoiceWorkflowBoundedFamilyOnly(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))

	if err := svc.validateScenarioCapability(
		context.Background(),
		runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE,
		"speech/qwen3tts",
		nil,
		nil,
	); err != nil {
		t.Fatalf("expected local qwen3 voice clone to stay admitted, got %v", err)
	}

	err := svc.validateScenarioCapability(
		context.Background(),
		runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN,
		"kokoro-local",
		nil,
		nil,
	)
	if err == nil {
		t.Fatal("expected generic local voice workflow family to fail-close")
	}
	reasonCode, ok := grpcerr.ExtractReasonCode(err)
	if !ok {
		t.Fatalf("expected grpc reason code, got error: %v", err)
	}
	if reasonCode != runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED {
		t.Fatalf("reason code mismatch: got=%s want=%s", reasonCode.String(), runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED.String())
	}
}

func TestRequiredTextGenerateCapabilitiesEmpty(t *testing.T) {
	if caps := requiredTextGenerateCapabilities(nil); len(caps) != 0 {
		t.Fatalf("expected no required capabilities, got %#v", caps)
	}
	if caps := requiredTextGenerateCapabilities([]*runtimev1.ChatMessage{}); len(caps) != 0 {
		t.Fatalf("expected no required capabilities, got %#v", caps)
	}
	if caps := requiredTextGenerateCapabilities([]*runtimev1.ChatMessage{{Role: "user", Content: "hello"}}); len(caps) != 0 {
		t.Fatalf("expected no required capabilities, got %#v", caps)
	}
}

func TestRequiredTextGenerateCapabilitiesTextOnly(t *testing.T) {
	input := []*runtimev1.ChatMessage{
		{
			Role: "user",
			Parts: []*runtimev1.ChatContentPart{
				textPart("just text"),
			},
		},
	}
	if caps := requiredTextGenerateCapabilities(input); len(caps) != 0 {
		t.Fatalf("expected no required capabilities, got %#v", caps)
	}
}

func TestRequiredTextGenerateCapabilitiesWithImage(t *testing.T) {
	input := []*runtimev1.ChatMessage{
		{
			Role: "user",
			Parts: []*runtimev1.ChatContentPart{
				textPart("describe"),
				imagePart("https://example.com/img.png"),
			},
		},
	}
	caps := requiredTextGenerateCapabilities(input)
	if len(caps) != 1 || caps[0] != "text.generate.vision" {
		t.Fatalf("unexpected capabilities: %#v", caps)
	}
}

func TestUnsupportedTextGeneratePartTypeEmpty(t *testing.T) {
	if partType, unsupported := unsupportedTextGeneratePartType(nil); unsupported {
		t.Fatalf("expected no unsupported part type, got %s", partType.String())
	}
}

func TestUnsupportedTextGeneratePartTypeImageOnlySupported(t *testing.T) {
	input := []*runtimev1.ChatMessage{
		{
			Role: "user",
			Parts: []*runtimev1.ChatContentPart{
				textPart("describe"),
				imagePart("https://example.com/img.png"),
			},
		},
	}
	if partType, unsupported := unsupportedTextGeneratePartType(input); unsupported {
		t.Fatalf("expected image_url to stay supported, got %s", partType.String())
	}
}

func TestUnsupportedTextGeneratePartTypeVideoAccepted(t *testing.T) {
	input := []*runtimev1.ChatMessage{
		{
			Role: "user",
			Parts: []*runtimev1.ChatContentPart{
				videoPart("https://example.com/demo.mp4"),
			},
		},
	}
	partType, unsupported := unsupportedTextGeneratePartType(input)
	if unsupported {
		t.Fatal("expected video_url to remain allowed")
	}
	if partType != runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_UNSPECIFIED {
		t.Fatalf("part type mismatch: got=%s want=%s", partType.String(), runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_UNSPECIFIED.String())
	}
}

func TestValidateTextGenerateInputPartsNoMediaPassthrough(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))

	input := []*runtimev1.ChatMessage{
		{Role: "user", Content: "just text"},
	}
	err := svc.validateTextGenerateInputParts(context.Background(), "anthropic/claude-sonnet-4-6", nil, nil, input)
	if err != nil {
		t.Fatalf("expected nil error for input without media, got %v", err)
	}
}

func TestValidateTextGenerateInputPartsUnknownCatalogModelPasses(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))

	input := []*runtimev1.ChatMessage{
		{
			Role: "user",
			Parts: []*runtimev1.ChatContentPart{
				textPart("describe"),
				imagePart("https://example.com/img.png"),
			},
		},
	}
	err := svc.validateTextGenerateInputParts(context.Background(), "custom/vision-model", nil, nil, input)
	if err != nil {
		t.Fatalf("expected unknown catalog model to pass through, got %v", err)
	}
}

func TestValidateTextGenerateInputPartsNonVisionModelRejects(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))

	input := []*runtimev1.ChatMessage{
		{
			Role: "user",
			Parts: []*runtimev1.ChatContentPart{
				imagePart("https://example.com/img.png"),
			},
		},
	}
	err := svc.validateTextGenerateInputParts(context.Background(), "openai/tts-1", nil, nil, input)
	if err == nil {
		t.Fatal("expected non-vision model to reject image input")
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok {
		t.Fatalf("expected grpc reason code, got error: %v", err)
	}
	if reason != runtimev1.ReasonCode_AI_MODALITY_NOT_SUPPORTED {
		t.Fatalf("reason code mismatch: got=%s want=%s", reason.String(), runtimev1.ReasonCode_AI_MODALITY_NOT_SUPPORTED.String())
	}
}

func TestValidateTextGenerateInputPartsRejectsVideoForNonVideoModel(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))

	input := []*runtimev1.ChatMessage{
		{
			Role: "user",
			Parts: []*runtimev1.ChatContentPart{
				textPart("watch this"),
				videoPart("https://example.com/demo.mp4"),
			},
		},
	}
	err := svc.validateTextGenerateInputParts(context.Background(), "openai/tts-1", nil, nil, input)
	if err == nil {
		t.Fatal("expected non-video model to reject video input")
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok {
		t.Fatalf("expected grpc reason code, got error: %v", err)
	}
	if reason != runtimev1.ReasonCode_AI_MODALITY_NOT_SUPPORTED {
		t.Fatalf("reason code mismatch: got=%s want=%s", reason.String(), runtimev1.ReasonCode_AI_MODALITY_NOT_SUPPORTED.String())
	}
}

func TestValidateTextGenerateInputPartsDelegatesImageVisionCheck(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))

	input := []*runtimev1.ChatMessage{
		{
			Role: "user",
			Parts: []*runtimev1.ChatContentPart{
				imagePart("https://example.com/img.png"),
			},
		},
	}
	err := svc.validateTextGenerateInputParts(context.Background(), "openai/tts-1", nil, nil, input)
	if err == nil {
		t.Fatal("expected non-vision model to reject image input")
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok {
		t.Fatalf("expected grpc reason code, got error: %v", err)
	}
	if reason != runtimev1.ReasonCode_AI_MODALITY_NOT_SUPPORTED {
		t.Fatalf("reason code mismatch: got=%s want=%s", reason.String(), runtimev1.ReasonCode_AI_MODALITY_NOT_SUPPORTED.String())
	}
}
