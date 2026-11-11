package capabilitydriver

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"math"
	"net/url"
	"strings"
	"unicode"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.openai-image26
func ValidateImageControls(s *runtimev1.ImageGenerateScenarioSpec) error {
	invalid := grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	if s == nil {
		return invalid
	}
	if control := s.GetControlImage(); control != nil {
		id := control.GetImageArtifactId()
		if id == "" || len(id) > 128 || strings.TrimSpace(id) != id || strings.IndexFunc(id, unicode.IsControl) >= 0 || control.GetType() < runtimev1.ImageControlType_IMAGE_CONTROL_TYPE_OPENPOSE || control.GetType() > runtimev1.ImageControlType_IMAGE_CONTROL_TYPE_REPAINT || len(control.ProtoReflect().GetUnknown()) != 0 {
			return invalid
		}
		strength := float64(control.GetStrength())
		if math.IsNaN(strength) || math.IsInf(strength, 0) || strength < 0 || strength > 2 {
			return invalid
		}
	}
	switch s.GetComplexity() {
	case "", "low", "medium", "high":
	default:
		return invalid
	}
	switch s.GetOutputFormat() {
	case "", "png", "jpeg", "webp", "gif", "svg":
	default:
		return invalid
	}
	if s.FrameCount != nil && (s.GetFrameCount() < 2 || s.GetFrameCount() > 16) || s.FrameDurationMs != nil && (s.GetFrameDurationMs() < 20 || s.GetFrameDurationMs() > 2000) {
		return invalid
	}
	if (s.FrameCount != nil || s.FrameDurationMs != nil) && s.GetOutputFormat() != "gif" {
		return invalid
	}
	if value := s.GetMarkup(); value != "" {
		u, e := url.Parse(value)
		if e != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Fragment != "" || len(value) > 2048 || strings.TrimSpace(value) != value {
			return invalid
		}
	}
	if id := s.GetMarkupArtifactId(); id != "" {
		if len(id) > 128 || strings.TrimSpace(id) != id || strings.IndexFunc(id, unicode.IsControl) >= 0 {
			return invalid
		}
	}
	if s.GetMarkup() != "" && s.GetMarkupArtifactId() != "" {
		return invalid
	}
	if s.GetMarkup() != "" || s.GetMarkupArtifactId() != "" {
		if s.GetMask() != "" || s.GetMaskArtifactId() != "" || len(s.GetReferenceImages()) == 0 && s.GetReferenceImageArtifactId() == "" {
			return invalid
		}
	}
	return nil
}

func ImageHasExtendedControls(s *runtimev1.ImageGenerateScenarioSpec) bool {
	return s.GetControlImage() != nil || s.GetComplexity() != "" || s.GetOutputFormat() != "" || s.GetMarkup() != "" || s.GetMarkupArtifactId() != "" || s.FrameCount != nil || s.FrameDurationMs != nil
}

func IsOpenAIImage26(model string) bool {
	return model == "gpt-image-2.6-flare" || model == "gpt-image-2.6-sunburst"
}
