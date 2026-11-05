package capabilitydriver

import (
	"strings"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

func IsLumaUniImageModel(model string) bool { return model == "uni-1" || model == "uni-1-max" }

// @nimi-authority: rule.nimi.runtime.ai-provider.luma-uni-image
func normalizeLumaUniImageRequest(req *runtimev1.SubmitScenarioJobRequest) error {
	s := req.GetSpec().GetImageGenerate()
	invalid := grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	if s == nil || len(req.GetExtensions()) != 0 || strings.TrimSpace(s.GetPrompt()) == "" || utf8.RuneCountInString(s.GetPrompt()) > 6000 ||
		s.GetNegativePrompt() != "" || s.GetN() > 1 || s.GetSize() != "" || s.GetQuality() != "" || s.Seed != nil || s.Strength != nil ||
		s.GetMask() != "" || s.GetMaskArtifactId() != "" || s.GetComplexity() != "" || s.GetMarkup() != "" || s.GetMarkupArtifactId() != "" || s.FrameCount != nil || s.FrameDurationMs != nil {
		return invalid
	}
	if len(s.GetReferenceImages()) > 9 || s.GetReferenceImageArtifactId() != "" && len(s.GetReferenceImages()) != 0 {
		return invalid
	}
	for _, u := range s.GetReferenceImages() {
		if !publicVideoMediaURL(u) || !strings.HasPrefix(u, "https://") {
			return invalid
		}
	}
	edit := s.GetReferenceImageArtifactId() != "" || len(s.GetReferenceImages()) != 0
	if edit && s.GetAspectRatio() != "" {
		return invalid
	}
	switch s.GetAspectRatio() {
	case "", "3:1", "2:1", "16:9", "3:2", "1:1", "2:3", "9:16", "1:2", "1:3":
	default:
		return invalid
	}
	switch s.GetStyle() {
	case "", "auto":
	case "manga":
		if !edit {
			switch s.GetAspectRatio() {
			case "", "2:3", "9:16", "1:2", "1:3":
			default:
				return invalid
			}
		}
	default:
		return invalid
	}
	switch s.GetResponseFormat() {
	case "", "base64", "b64_json":
	default:
		return invalid
	}
	switch s.GetOutputFormat() {
	case "":
		s.OutputFormat = "png"
	case "png", "jpeg":
	default:
		return invalid
	}
	return nil
}
