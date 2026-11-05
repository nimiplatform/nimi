package capabilitydriver

import (
	"regexp"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

var ideogramRatio = regexp.MustCompile(`^[1-9][0-9]?:[1-9][0-9]?$`)

// ValidateIdeogramGenerationRequest covers the existing prompt-only v3 and v2
// catalog targets. Native aspect/style enum membership remains provider-owned.
func ValidateIdeogramGenerationRequest(s *runtimev1.ImageGenerateScenarioSpec, model string) error {
	invalid := grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	if model != "ideogram-v3" && model != "ideogram-v2-turbo" || s == nil || strings.TrimSpace(s.GetPrompt()) == "" {
		return invalid
	}
	if s.GetN() > 1 || s.GetSize() != "" || s.GetQuality() != "" || s.Strength != nil ||
		len(s.GetReferenceImages()) != 0 || s.GetReferenceImageArtifactId() != "" || s.GetMask() != "" || s.GetMaskArtifactId() != "" || ImageHasExtendedControls(s) {
		return invalid
	}
	if s.Seed != nil && (s.GetSeed() < 0 || s.GetSeed() > 2147483647) || s.GetAspectRatio() != "" && !ideogramRatio.MatchString(s.GetAspectRatio()) {
		return invalid
	}
	switch s.GetResponseFormat() {
	case "", "base64", "b64_json":
	default:
		return invalid
	}
	return nil
}
