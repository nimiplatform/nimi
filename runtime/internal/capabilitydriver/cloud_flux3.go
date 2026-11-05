package capabilitydriver

import (
	"strconv"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

func IsFlux3ImageModel(model string) bool {
	return model == "flux-3-image" || model == "flux-3-image-klein"
}

func flux3Unsupported() error {
	return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
}

// Flux3ImageSize returns either a native resolution tier or exact dimensions.
func Flux3ImageSize(s *runtimev1.ImageGenerateScenarioSpec, model string) (string, int, int, error) {
	size := strings.ToLower(strings.TrimSpace(s.GetSize()))
	switch size {
	case "", "768sq", "1k", "1.5k", "2k", "4k":
		return size, 0, 0, nil
	case "match_input":
		if model == "flux-3-image" && (len(s.GetReferenceImages()) > 0 || s.GetReferenceImageArtifactId() != "") {
			return size, 0, 0, nil
		}
	}
	parts := strings.Split(size, "x")
	if len(parts) != 2 || s.GetAspectRatio() != "" {
		return "", 0, 0, flux3Unsupported()
	}
	w, e1 := strconv.Atoi(parts[0])
	h, e2 := strconv.Atoi(parts[1])
	minSide, area := 256, int64(16822272)
	if model == "flux-3-image-klein" {
		minSide = 64
	} else if len(s.GetReferenceImages()) > 0 || s.GetReferenceImageArtifactId() != "" {
		area = 4194304
	}
	if e1 != nil || e2 != nil || w < minSide || h < minSide || w > 6256 || h > 6256 || int64(w)*int64(h) > area {
		return "", 0, 0, flux3Unsupported()
	}
	return "", w, h, nil
}

// @nimi-authority: rule.nimi.runtime.ai-provider.flux3-media
func ValidateFlux3ImageRequest(s *runtimev1.ImageGenerateScenarioSpec, model string) error {
	if !IsFlux3ImageModel(model) || s == nil || strings.TrimSpace(s.GetPrompt()) == "" || s.GetN() > 1 || s.GetNegativePrompt() != "" || s.GetQuality() != "" || s.GetStyle() != "" || s.GetMask() != "" || s.GetMaskArtifactId() != "" || s.Strength != nil || len(s.GetReferenceImages()) > 10 || len(s.GetReferenceImages()) > 0 && s.GetReferenceImageArtifactId() != "" {
		return flux3Unsupported()
	}
	if s.Seed != nil && (model != "flux-3-image-klein" || s.GetSeed() < 0 || s.GetSeed() > 4294967295) {
		return flux3Unsupported()
	}
	switch strings.ToLower(s.GetResponseFormat()) {
	case "", "b64_json", "base64":
	default:
		return flux3Unsupported()
	}
	switch s.GetAspectRatio() {
	case "", "auto", "21:9", "2:1", "16:9", "3:2", "7:5", "4:3", "5:4", "1:1", "4:5", "3:4", "5:7", "2:3", "9:16", "1:2", "9:21":
	default:
		return flux3Unsupported()
	}
	for _, uri := range s.GetReferenceImages() {
		if !publicVideoMediaURL(uri) {
			return flux3Unsupported()
		}
	}
	_, _, _, err := Flux3ImageSize(s, model)
	return err
}

// @nimi-authority: rule.nimi.runtime.ai-provider.flux3-media
func ValidateFlux3VideoRequest(req *runtimev1.SubmitScenarioJobRequest) error {
	s := req.GetSpec().GetVideoGenerate()
	if s == nil || len(req.GetExtensions()) > 0 || VideoPrompt(s) == "" || s.GetNegativePrompt() != "" {
		return flux3Unsupported()
	}
	first, last := 0, 0
	for _, item := range s.GetContent() {
		if item == nil {
			return flux3Unsupported()
		}
		if item.GetType() == runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT {
			if item.GetRole() != runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT || strings.TrimSpace(item.GetText()) == "" {
				return flux3Unsupported()
			}
			continue
		}
		switch item.GetType() {
		case runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_ARTIFACT_REF:
			if item.GetArtifactRef().GetArtifactId() == "" {
				return flux3Unsupported()
			}
		case runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_IMAGE_URL:
			if !publicVideoMediaURL(item.GetImageUrl().GetUrl()) {
				return flux3Unsupported()
			}
		default:
			return flux3Unsupported()
		}
		switch item.GetRole() {
		case runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME:
			first++
		case runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_LAST_FRAME:
			last++
		default:
			return flux3Unsupported()
		}
	}
	switch s.GetMode() {
	case runtimev1.VideoMode_VIDEO_MODE_T2V:
		if first+last != 0 {
			return flux3Unsupported()
		}
	case runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME:
		if first != 1 || last != 0 {
			return flux3Unsupported()
		}
	case runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_LAST:
		if first != 1 || last != 1 {
			return flux3Unsupported()
		}
	default:
		return flux3Unsupported()
	}
	o := s.GetOptions()
	if o == nil {
		return nil
	}
	if o.Seed != nil || o.Frames != nil || o.Fps != nil || o.CameraFixed != nil || o.Watermark != nil || o.ReturnLastFrame != nil || o.GetServiceTier() != "" || o.GetExecutionExpiresAfterSec() != 0 {
		return flux3Unsupported()
	}
	if o.DurationSec != nil && o.GetDurationSec() != -1 && (o.GetDurationSec() < 5 || o.GetDurationSec() > 20) {
		return flux3Unsupported()
	}
	switch strings.ToLower(o.GetResolution()) {
	case "", "720p", "1080p", "1440p", "4k":
	default:
		return flux3Unsupported()
	}
	if o.GetDraft() && o.GetResolution() != "" && strings.ToLower(o.GetResolution()) != "720p" {
		return flux3Unsupported()
	}
	switch o.GetRatio() {
	case "", "adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16", "9:21":
	default:
		return flux3Unsupported()
	}
	return nil
}
