package ai

import (
	"context"
	"io"
	"log/slog"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
)

func TestValidateScenarioCapabilitySupportedModelPasses(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))

	err := svc.validateScenarioCapability(
		context.Background(),
		&runtimev1.ExecuteScenarioRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE},
		"claude-sonnet-4-6",
		&nimillm.RemoteTarget{ProviderType: "anthropic"},
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
			scenario:   runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE,
			model:      "openai/tts-1",
			expectedRC: runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			provider := strings.SplitN(tc.model, "/", 2)[0]
			model := strings.TrimPrefix(tc.model, provider+"/")
			err := svc.validateScenarioCapability(context.Background(), &runtimev1.ExecuteScenarioRequest{ScenarioType: tc.scenario}, model, &nimillm.RemoteTarget{ProviderType: provider}, nil)
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
		&runtimev1.ExecuteScenarioRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE},
		"claude-sonnet-4-6",
		&nimillm.RemoteTarget{ProviderType: "anthropic"},
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

func TestRequiredTextGenerateFeaturesEmpty(t *testing.T) {
	if features := requiredTextGenerateFeatures(nil); len(features) != 0 {
		t.Fatalf("expected no required features, got %#v", features)
	}
	if features := requiredTextGenerateFeatures([]*runtimev1.ChatMessage{}); len(features) != 0 {
		t.Fatalf("expected no required features, got %#v", features)
	}
	if features := requiredTextGenerateFeatures([]*runtimev1.ChatMessage{{Role: "user", Content: "hello"}}); len(features) != 0 {
		t.Fatalf("expected no required features, got %#v", features)
	}
}

func TestRequiredTextGenerateFeaturesTextOnly(t *testing.T) {
	input := []*runtimev1.ChatMessage{
		{
			Role: "user",
			Parts: []*runtimev1.ChatContentPart{
				textPart("just text"),
			},
		},
	}
	if features := requiredTextGenerateFeatures(input); len(features) != 0 {
		t.Fatalf("expected no required features, got %#v", features)
	}
}

func TestRequiredTextGenerateFeaturesWithImage(t *testing.T) {
	input := []*runtimev1.ChatMessage{
		{
			Role: "user",
			Parts: []*runtimev1.ChatContentPart{
				textPart("describe"),
				imagePart("https://example.com/img.png"),
			},
		},
	}
	features := requiredTextGenerateFeatures(input)
	if len(features) != 1 || features[0] != "input.image" {
		t.Fatalf("unexpected features: %#v", features)
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

func TestValidateTextGenerateInputPartsUnknownCatalogModelFailsClosed(t *testing.T) {
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
	err := svc.validateTextGenerateInputParts(context.Background(), "unknown-vision-model", &nimillm.RemoteTarget{ProviderType: "openai"}, nil, input)
	if err == nil {
		t.Fatal("expected unknown catalog model with image input to fail closed")
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok {
		t.Fatalf("expected grpc reason code, got error: %v", err)
	}
	if reason != runtimev1.ReasonCode_AI_MODEL_NOT_FOUND {
		t.Fatalf("reason code mismatch: got=%s want=%s", reason.String(), runtimev1.ReasonCode_AI_MODEL_NOT_FOUND.String())
	}
}

func TestValidateTextGenerateInputPartsUnknownProviderFailsClosed(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))

	input := []*runtimev1.ChatMessage{
		{
			Role: "user",
			Parts: []*runtimev1.ChatContentPart{
				imagePart("https://example.com/img.png"),
			},
		},
	}
	err := svc.validateTextGenerateInputParts(context.Background(), "vision-model", &nimillm.RemoteTarget{ProviderType: "custom"}, nil, input)
	if err == nil {
		t.Fatal("expected unknown provider with image input to fail closed")
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok {
		t.Fatalf("expected grpc reason code, got error: %v", err)
	}
	if reason != runtimev1.ReasonCode_AI_MODEL_NOT_FOUND {
		t.Fatalf("reason code mismatch: got=%s want=%s", reason.String(), runtimev1.ReasonCode_AI_MODEL_NOT_FOUND.String())
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
	err := svc.validateTextGenerateInputParts(context.Background(), "tts-1", &nimillm.RemoteTarget{ProviderType: "openai"}, nil, input)
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
	err := svc.validateTextGenerateInputParts(context.Background(), "tts-1", &nimillm.RemoteTarget{ProviderType: "openai"}, nil, input)
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

func TestValidateTextGenerateInputPartsDelegatesImageFeatureCheck(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))

	input := []*runtimev1.ChatMessage{
		{
			Role: "user",
			Parts: []*runtimev1.ChatContentPart{
				imagePart("https://example.com/img.png"),
			},
		},
	}
	err := svc.validateTextGenerateInputParts(context.Background(), "tts-1", &nimillm.RemoteTarget{ProviderType: "openai"}, nil, input)
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
