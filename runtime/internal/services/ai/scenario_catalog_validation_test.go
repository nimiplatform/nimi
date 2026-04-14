package ai

import (
	"context"
	"io"
	"log/slog"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func TestValidateVideoGenerateAgainstCatalogAllowsDeclaredOptions(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))

	err := svc.validateVideoGenerateAgainstCatalog(context.Background(), "openai", "sora-2", &runtimev1.VideoGenerateScenarioSpec{
		Mode: runtimev1.VideoMode_VIDEO_MODE_T2V,
		Content: []*runtimev1.VideoContentItem{
			{
				Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT,
				Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT,
				Text: "A short cinematic sunrise.",
			},
		},
		Options: &runtimev1.VideoGenerationOptions{
			DurationSec: 1,
			Ratio:       "16:9",
		},
	})
	if err != nil {
		t.Fatalf("validateVideoGenerateAgainstCatalog: %v", err)
	}
}

func TestValidateVideoGenerateAgainstCatalogRejectsUndeclaredOption(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))

	err := svc.validateVideoGenerateAgainstCatalog(context.Background(), "openai", "sora-2", &runtimev1.VideoGenerateScenarioSpec{
		Mode: runtimev1.VideoMode_VIDEO_MODE_T2V,
		Content: []*runtimev1.VideoContentItem{
			{
				Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT,
				Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT,
				Text: "A short cinematic sunrise.",
			},
		},
		Options: &runtimev1.VideoGenerationOptions{
			DurationSec: 1,
			Fps:         24,
		},
	})
	if err == nil {
		t.Fatalf("expected undeclared option rejection")
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
		t.Fatalf("expected AI_MEDIA_OPTION_UNSUPPORTED, got reason=%v ok=%v err=%v", reason, ok, err)
	}
}

func TestValidateVideoGenerateAgainstCatalogRejectsUnavailableOutput(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))

	err := svc.validateVideoGenerateAgainstCatalog(context.Background(), "openai", "sora-2", &runtimev1.VideoGenerateScenarioSpec{
		Mode: runtimev1.VideoMode_VIDEO_MODE_T2V,
		Content: []*runtimev1.VideoContentItem{
			{
				Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT,
				Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT,
				Text: "A short cinematic sunrise.",
			},
		},
		Options: &runtimev1.VideoGenerationOptions{
			DurationSec:     1,
			ReturnLastFrame: true,
		},
	})
	if err == nil {
		t.Fatalf("expected unavailable output rejection")
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
		t.Fatalf("expected AI_MEDIA_OPTION_UNSUPPORTED, got reason=%v ok=%v err=%v", reason, ok, err)
	}
}

func TestValidateCatalogAwareScenarioSupportShortCircuitsOnNilInputs(t *testing.T) {
	var nilSvc *Service
	if err := nilSvc.validateCatalogAwareScenarioSupport(context.Background(), runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE, "openai", "sora-2", nil); err != nil {
		t.Fatalf("nil service should short-circuit, got %v", err)
	}

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err := svc.validateCatalogAwareScenarioSupport(context.Background(), runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE, "openai", "sora-2", nil); err != nil {
		t.Fatalf("nil spec should short-circuit, got %v", err)
	}
}

func TestValidateVideoGenerateAgainstCatalogRejectsInvalidShape(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))

	if err := svc.validateVideoGenerateAgainstCatalog(context.Background(), "openai", "sora-2", nil); err == nil {
		t.Fatalf("expected invalid spec rejection")
	}

	err := svc.validateVideoGenerateAgainstCatalog(context.Background(), "openai", "tts-1", &runtimev1.VideoGenerateScenarioSpec{
		Mode: runtimev1.VideoMode_VIDEO_MODE_T2V,
		Content: []*runtimev1.VideoContentItem{
			{
				Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT,
				Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT,
				Text: "not a video model",
			},
		},
		Options: &runtimev1.VideoGenerationOptions{DurationSec: 1},
	})
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
		t.Fatalf("expected AI_MEDIA_OPTION_UNSUPPORTED for non-video model, got reason=%v ok=%v err=%v", reason, ok, err)
	}
}

func TestValidateVideoGenerateAgainstCatalogRejectsInvalidModeAndRoles(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))

	err := svc.validateVideoGenerateAgainstCatalog(context.Background(), "openai", "sora-2", &runtimev1.VideoGenerateScenarioSpec{
		Mode: runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME,
		Content: []*runtimev1.VideoContentItem{
			{
				Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT,
				Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT,
				Text: "missing first frame",
			},
		},
		Options: &runtimev1.VideoGenerationOptions{DurationSec: 1},
	})
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
		t.Fatalf("expected AI_MEDIA_OPTION_UNSUPPORTED for invalid input roles, got reason=%v ok=%v err=%v", reason, ok, err)
	}

	err = svc.validateVideoGenerateAgainstCatalog(context.Background(), "openai", "sora-2", &runtimev1.VideoGenerateScenarioSpec{
		Mode: runtimev1.VideoMode_VIDEO_MODE_UNSPECIFIED,
		Content: []*runtimev1.VideoContentItem{
			{
				Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT,
				Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT,
				Text: "invalid mode",
			},
		},
		Options: &runtimev1.VideoGenerationOptions{DurationSec: 1},
	})
	reason, ok = grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
		t.Fatalf("expected AI_MEDIA_OPTION_UNSUPPORTED for invalid mode, got reason=%v ok=%v err=%v", reason, ok, err)
	}
}

func TestValidateVideoGenerateAgainstCatalogAllowsSeedancePromptOnlyT2V(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))

	err := svc.validateVideoGenerateAgainstCatalog(context.Background(), "volcengine", "doubao-seedance-2-0-260128", &runtimev1.VideoGenerateScenarioSpec{
		Mode: runtimev1.VideoMode_VIDEO_MODE_T2V,
		Content: []*runtimev1.VideoContentItem{
			{
				Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT,
				Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT,
				Text: "A short cinematic sunrise.",
			},
		},
		Options: &runtimev1.VideoGenerationOptions{
			DurationSec: 4,
			Ratio:       "16:9",
			Resolution:  "480p",
		},
	})
	if err != nil {
		t.Fatalf("validateVideoGenerateAgainstCatalog seedance prompt-only t2v: %v", err)
	}
}

func TestValidateVideoGenerateAgainstCatalogAllowsSeedanceReferenceVideoAndAudio(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))

	err := svc.validateVideoGenerateAgainstCatalog(context.Background(), "volcengine", "doubao-seedance-2-0-260128", &runtimev1.VideoGenerateScenarioSpec{
		Mode: runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE,
		Content: []*runtimev1.VideoContentItem{
			{
				Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT,
				Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT,
				Text: "fruit tea ad",
			},
			{
				Type:     runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_IMAGE_URL,
				Role:     runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_IMAGE,
				ImageUrl: &runtimev1.VideoContentImageURL{Url: "https://example.com/ref-1.png"},
			},
			{
				Type:     runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_VIDEO_URL,
				Role:     runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_VIDEO,
				VideoUrl: &runtimev1.VideoContentVideoURL{Url: "https://example.com/ref-1.mp4"},
			},
			{
				Type:     runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_AUDIO_URL,
				Role:     runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_AUDIO,
				AudioUrl: &runtimev1.VideoContentAudioURL{Url: "https://example.com/ref-1.mp3"},
			},
		},
		Options: &runtimev1.VideoGenerationOptions{
			DurationSec:     11,
			Ratio:           "16:9",
			Resolution:      "720p",
			GenerateAudio:   true,
			ReturnLastFrame: true,
		},
	})
	if err != nil {
		t.Fatalf("validateVideoGenerateAgainstCatalog seedance multimodal reference: %v", err)
	}
}

func TestValidateVideoGenerateAgainstCatalogRejectsSeedanceTooManyReferenceVideos(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))

	spec := &runtimev1.VideoGenerateScenarioSpec{
		Mode: runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE,
		Content: []*runtimev1.VideoContentItem{
			{
				Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT,
				Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT,
				Text: "fruit tea ad",
			},
			{
				Type:     runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_IMAGE_URL,
				Role:     runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_IMAGE,
				ImageUrl: &runtimev1.VideoContentImageURL{Url: "https://example.com/ref-1.png"},
			},
			{
				Type:     runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_VIDEO_URL,
				Role:     runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_VIDEO,
				VideoUrl: &runtimev1.VideoContentVideoURL{Url: "https://example.com/ref-1.mp4"},
			},
			{
				Type:     runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_VIDEO_URL,
				Role:     runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_VIDEO,
				VideoUrl: &runtimev1.VideoContentVideoURL{Url: "https://example.com/ref-2.mp4"},
			},
			{
				Type:     runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_VIDEO_URL,
				Role:     runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_VIDEO,
				VideoUrl: &runtimev1.VideoContentVideoURL{Url: "https://example.com/ref-3.mp4"},
			},
			{
				Type:     runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_VIDEO_URL,
				Role:     runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_VIDEO,
				VideoUrl: &runtimev1.VideoContentVideoURL{Url: "https://example.com/ref-4.mp4"},
			},
		},
		Options: &runtimev1.VideoGenerationOptions{
			DurationSec: 11,
			Ratio:       "16:9",
		},
	}
	err := svc.validateVideoGenerateAgainstCatalog(context.Background(), "volcengine", "doubao-seedance-2-0-260128", spec)
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
		t.Fatalf("expected AI_MEDIA_OPTION_UNSUPPORTED for too many reference videos, got reason=%v ok=%v err=%v", reason, ok, err)
	}
}

func TestScenarioCatalogValidationHelpers(t *testing.T) {
	if got := videoModeCatalogToken(runtimev1.VideoMode_VIDEO_MODE_T2V); got != "t2v" {
		t.Fatalf("unexpected t2v token: %q", got)
	}
	if got := videoModeCatalogToken(runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE); got != "i2v_reference" {
		t.Fatalf("unexpected i2v_reference token: %q", got)
	}
	if got := videoModeCatalogToken(runtimev1.VideoMode_VIDEO_MODE_UNSPECIFIED); got != "" {
		t.Fatalf("expected empty token for unspecified mode, got %q", got)
	}
	if videoGenerationSupportsMode(nil, "t2v") {
		t.Fatalf("nil capability must not advertise mode support")
	}

	spec := &runtimev1.VideoGenerateScenarioSpec{
		Content: []*runtimev1.VideoContentItem{
			{
				Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT,
				Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT,
				Text: "prompt",
			},
			{
				Type:     runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_IMAGE_URL,
				Role:     runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME,
				ImageUrl: &runtimev1.VideoContentImageURL{Url: "https://example.com/first.png"},
			},
			{
				Type:     runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_IMAGE_URL,
				Role:     runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_IMAGE,
				ImageUrl: &runtimev1.VideoContentImageURL{Url: "https://example.com/ref-1.png"},
			},
			{
				Type:     runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_IMAGE_URL,
				Role:     runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_IMAGE,
				ImageUrl: &runtimev1.VideoContentImageURL{Url: "https://example.com/ref-2.png"},
			},
		},
	}
	roles := videoScenarioInputRoles(spec)
	if !sameStringSet(roles, []string{"prompt", "first_frame", "reference_image"}) {
		t.Fatalf("unexpected role set: %#v", roles)
	}
	if got := videoReferenceImageCount(spec); got != 2 {
		t.Fatalf("expected 2 reference images, got %d", got)
	}
	if !sameStringSet([]string{"prompt", "first_frame"}, []string{"first_frame", "prompt"}) {
		t.Fatalf("expected set equivalence")
	}
	if !sameStringSet(requiredVideoRolesForMode(runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_LAST), []string{"first_frame", "last_frame"}) {
		t.Fatalf("unexpected required role set for first/last mode")
	}
	if !videoScenarioUsesOnlyAllowedRoles([]string{"prompt"}, []string{"prompt", "reference_video"}) {
		t.Fatalf("prompt should be allowed when optional reference roles exist")
	}
	if videoScenarioUsesOnlyAllowedRoles([]string{"prompt", "reference_image"}, []string{"prompt", "reference_video"}) {
		t.Fatalf("unexpected role should be rejected")
	}
	if got := filterVideoRoles([]string{"prompt", "reference_video"}, []string{"prompt"}); !sameStringSet(got, []string{"prompt"}) {
		t.Fatalf("unexpected filtered roles: %#v", got)
	}

	if err := ensureStringLimitContains([]any{"720p", 1080}, "720p"); err != nil {
		t.Fatalf("ensureStringLimitContains []any should accept matching value: %v", err)
	}
	if err := ensureStringLimitContains([]string{"16:9"}, "4:3"); err == nil {
		t.Fatalf("expected string limit rejection")
	}
	if err := ensureNumericRange(map[string]any{"min": int32(1), "max": uint64(3)}, 2); err != nil {
		t.Fatalf("ensureNumericRange should accept in-range value: %v", err)
	}
	if err := ensureNumericRange(map[string]any{"min": float64(1), "max": float64(3)}, 4); err == nil {
		t.Fatalf("expected numeric range rejection")
	}
	if err := ensureVideoOptionSupported(&catalog.VideoGenerationCapability{
		Options: catalog.VideoGenerationOptions{Supports: []string{"resolution", "ratio"}},
	}, "ratio"); err != nil {
		t.Fatalf("expected declared video option to be accepted: %v", err)
	}
	if err := ensureVideoOptionSupported(&catalog.VideoGenerationCapability{
		Options: catalog.VideoGenerationOptions{Supports: []string{"resolution"}},
	}, "fps"); err == nil {
		t.Fatalf("expected undeclared video option rejection")
	}
	if got := anyToString(12); got != "12" {
		t.Fatalf("unexpected anyToString result: %q", got)
	}
	if got, ok := anyToInt64(uint32(7)); !ok || got != 7 {
		t.Fatalf("unexpected anyToInt64 result: got=%d ok=%v", got, ok)
	}
}
