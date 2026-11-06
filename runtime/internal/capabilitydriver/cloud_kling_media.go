package capabilitydriver

import (
	"strings"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

func IsKlingVideoModel(model string) bool { return model == "kling-4.0" || model == "kling-4.0-flash" }
func IsKlingImageModel(model string) bool { return model == "kling-v3" || model == "kling-v3-omni" }
func klingMediaUnsupported() error {
	return nativeCloudSpeechUnsupported("The selected Kling model does not support this exact media request")
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r108
func validateKlingMedia(req *runtimev1.SubmitScenarioJobRequest, model string, mode CloudMediaStreamMode) error {
	if len(req.GetExtensions()) != 0 || mode != CloudMediaStreamNone {
		return klingMediaUnsupported()
	}
	if s := req.GetSpec().GetImageGenerate(); s != nil {
		return validateKlingImage(s, model)
	}
	s := req.GetSpec().GetVideoGenerate()
	if s == nil || !IsKlingVideoModel(model) || s.GetNegativePrompt() != "" {
		return klingMediaUnsupported()
	}
	prompt := VideoPrompt(s)
	if strings.TrimSpace(prompt) == "" {
		return klingMediaUnsupported()
	}
	english, other := 0, 0
	for _, r := range prompt {
		if r <= 127 {
			english++
		} else {
			other++
		}
	}
	if int64(english)*11000+int64(other)*26000 > 26000*11000 {
		return klingMediaUnsupported()
	}
	first, last := 0, 0
	for _, item := range s.GetContent() {
		switch item.GetType() {
		case runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT:
		case runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_IMAGE_URL, runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_ARTIFACT_REF:
			if item.GetType() == runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_IMAGE_URL && !publicVideoMediaURL(item.GetImageUrl().GetUrl()) {
				return klingMediaUnsupported()
			}
			switch item.GetRole() {
			case runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME:
				first++
			case runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_LAST_FRAME:
				last++
			default:
				return klingMediaUnsupported()
			}
		default:
			return klingMediaUnsupported()
		}
	}
	switch s.GetMode() {
	case runtimev1.VideoMode_VIDEO_MODE_T2V:
		if first+last != 0 {
			return klingMediaUnsupported()
		}
	case runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME:
		if first != 1 || last != 0 {
			return klingMediaUnsupported()
		}
	case runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_LAST:
		if model != "kling-4.0" || first != 1 || last != 1 {
			return klingMediaUnsupported()
		}
	default:
		return klingMediaUnsupported()
	}
	if s.Options == nil {
		s.Options = &runtimev1.VideoGenerationOptions{}
	}
	o := s.Options
	maxDuration := int32(30)
	defaultResolution := "1080p"
	if model == "kling-4.0-flash" {
		maxDuration = 20
		defaultResolution = "720p"
	}
	if o.DurationSec == nil {
		o.DurationSec = proto.Int32(10)
	}
	if o.GetDurationSec() < 3 || o.GetDurationSec() > maxDuration {
		return klingMediaUnsupported()
	}
	if o.GetResolution() == "" {
		o.Resolution = defaultResolution
	}
	if o.GetResolution() != "720p" && (model != "kling-4.0" || o.GetResolution() != "1080p") {
		return klingMediaUnsupported()
	}
	if s.GetMode() == runtimev1.VideoMode_VIDEO_MODE_T2V {
		if o.GetRatio() == "" {
			o.Ratio = "16:9"
		}
		if !contains(strings.Fields("21:9 16:9 9:16 1:1"), o.GetRatio()) {
			return klingMediaUnsupported()
		}
	} else if o.GetRatio() != "" {
		return klingMediaUnsupported()
	}
	if o.Seed != nil || o.Frames != nil || o.Fps != nil || o.CameraFixed != nil || o.Watermark != nil || o.Draft != nil || o.ReturnLastFrame != nil || o.GetServiceTier() != "" || o.GetExecutionExpiresAfterSec() != 0 || o.GenerateAudio != nil && !o.GetGenerateAudio() {
		return klingMediaUnsupported()
	}
	o.GenerateAudio = proto.Bool(true)
	return nil
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r051
func validateKlingImage(s *runtimev1.ImageGenerateScenarioSpec, model string) error {
	if !IsKlingImageModel(model) || utf8.RuneCountInString(s.GetPrompt()) > 2500 || utf8.RuneCountInString(s.GetNegativePrompt()) > 2500 || s.Seed != nil || s.Strength != nil || s.GetMask() != "" || s.GetMaskArtifactId() != "" || s.GetQuality() != "" || s.GetStyle() != "" || ImageHasExtendedControls(s) {
		return klingMediaUnsupported()
	}
	if s.N == nil {
		s.N = proto.Int32(1)
	}
	if s.GetN() < 1 || s.GetN() > 9 || s.GetResponseFormat() != "" && s.GetResponseFormat() != "url" {
		return klingMediaUnsupported()
	}
	if s.GetSize() == "" {
		s.Size = "1k"
	}
	if s.GetSize() != "1k" && s.GetSize() != "2k" && (model != "kling-v3-omni" || s.GetSize() != "4k") {
		return klingMediaUnsupported()
	}
	refs := len(s.GetReferenceImages())
	if s.GetReferenceImageArtifactId() != "" {
		refs++
	}
	if refs > 10 || model == "kling-v3" && refs > 1 || s.GetReferenceImageArtifactId() != "" && len(s.GetReferenceImages()) != 0 {
		return klingMediaUnsupported()
	}
	if s.GetNegativePrompt() != "" && (model == "kling-v3-omni" || refs > 0) {
		return klingMediaUnsupported()
	}
	for _, uri := range s.GetReferenceImages() {
		if !publicVideoMediaURL(uri) {
			return klingMediaUnsupported()
		}
	}
	if s.GetAspectRatio() == "" {
		s.AspectRatio = "16:9"
	}
	if s.GetAspectRatio() == "auto" {
		if model != "kling-v3-omni" || refs == 0 {
			return klingMediaUnsupported()
		}
	} else if !contains(strings.Fields("16:9 9:16 1:1 4:3 3:4 3:2 2:3 21:9"), s.GetAspectRatio()) {
		return klingMediaUnsupported()
	}
	return nil
}
