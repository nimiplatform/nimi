package capabilitydriver

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"strconv"
	"strings"
	"unicode/utf8"
)

const Ideogram45Model = "ideogram-4-5"

// @nimi-authority: rule.nimi.runtime.ai-provider.ideogram45-image
func ValidateIdeogram45Request(s *runtimev1.ImageGenerateScenarioSpec) error {
	invalid := grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	if s == nil || strings.TrimSpace(s.GetPrompt()) == "" || utf8.RuneCountInString(s.GetPrompt()) > 10000 || s.GetNegativePrompt() != "" || s.GetAspectRatio() != "" || s.GetStyle() != "" || s.Strength != nil || s.GetN() > 4 || len(s.GetReferenceImages()) > 5 {
		return invalid
	}
	source := s.GetReferenceImageArtifactId() != "" || len(s.GetReferenceImages()) > 0
	mask := s.GetMaskArtifactId() != "" || s.GetMask() != ""
	if s.GetReferenceImageArtifactId() != "" && len(s.GetReferenceImages()) > 0 || mask && !source || s.GetMaskArtifactId() != "" && (s.GetReferenceImageArtifactId() == "" || s.GetMask() != "") || mask && (s.GetSize() != "" || len(s.GetReferenceImages()) > 4) {
		return invalid
	}
	if s.Seed != nil && (s.GetSeed() < 0 || s.GetSeed() > 2147483647) {
		return invalid
	}
	switch s.GetResponseFormat() {
	case "", "base64", "b64_json":
	default:
		return invalid
	}
	switch s.GetQuality() {
	case "", "low", "medium", "high":
	case "very_low":
		if !source {
			return invalid
		}
	default:
		return invalid
	}
	for _, u := range s.GetReferenceImages() {
		if !publicVideoMediaURL(u) {
			return invalid
		}
	}
	if s.GetMask() != "" && !publicVideoMediaURL(s.GetMask()) {
		return invalid
	}
	switch s.GetSize() {
	case "", "auto":
		return nil
	case "source":
		if source {
			return nil
		}
		return invalid
	}
	parts := strings.Split(s.GetSize(), "x")
	if len(parts) != 2 {
		return invalid
	}
	w, e1 := strconv.Atoi(parts[0])
	h, e2 := strconv.Atoi(parts[1])
	if e1 != nil || e2 != nil || w < 256 || h < 256 || w > 16384 || h > 16384 || w%32 != 0 || h%32 != 0 || int64(w)*int64(h) > 4194304 || w > h*6 || h > w*6 {
		return invalid
	}
	// Native T2I preset membership remains provider-validated; no invented preset list.
	return nil
}
