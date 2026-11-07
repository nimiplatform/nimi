package capabilitydriver

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

func IsRunwayVideoModel(model string) bool { return model == "gen4.5" || model == "gen4_turbo" }
func runwayVideoUnsupported() error {
	return nativeCloudSpeechUnsupported("The selected Runway model does not support this exact video request")
}
func runwayUTF16Length(text string) int {
	n := 0
	for _, r := range text {
		n++
		if r > 0xffff {
			n++
		}
	}
	return n
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r108
func validateRunwayVideo(req *runtimev1.SubmitScenarioJobRequest, model string, mode CloudMediaStreamMode) error {
	s := req.GetSpec().GetVideoGenerate()
	if s == nil || !IsRunwayVideoModel(model) || len(req.GetExtensions()) != 0 || mode != CloudMediaStreamNone || s.GetNegativePrompt() != "" {
		return runwayVideoUnsupported()
	}
	prompt := VideoPrompt(s)
	if model == "gen4.5" && strings.TrimSpace(prompt) == "" || runwayUTF16Length(prompt) > 1000 {
		return runwayVideoUnsupported()
	}
	frames := 0
	for _, item := range s.GetContent() {
		switch item.GetType() {
		case runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT:
			if item.GetRole() != runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT {
				return runwayVideoUnsupported()
			}
		case runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_IMAGE_URL, runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_ARTIFACT_REF:
			if item.GetRole() != runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME {
				return runwayVideoUnsupported()
			}
			frames++
			if item.GetType() == runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_IMAGE_URL && (!publicVideoMediaURL(item.GetImageUrl().GetUrl()) || runwayUTF16Length(item.GetImageUrl().GetUrl()) > 2048) {
				return runwayVideoUnsupported()
			}
		default:
			return runwayVideoUnsupported()
		}
	}
	switch s.GetMode() {
	case runtimev1.VideoMode_VIDEO_MODE_T2V:
		if model != "gen4.5" || frames != 0 {
			return runwayVideoUnsupported()
		}
	case runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME:
		if frames != 1 {
			return runwayVideoUnsupported()
		}
	default:
		return runwayVideoUnsupported()
	}
	if s.Options == nil {
		s.Options = &runtimev1.VideoGenerationOptions{}
	}
	o := s.Options
	if o.DurationSec == nil && model == "gen4.5" {
		o.DurationSec = proto.Int32(5)
	}
	if o.DurationSec != nil && (o.GetDurationSec() < 2 || o.GetDurationSec() > 10) {
		return runwayVideoUnsupported()
	}
	if o.GetRatio() == "" {
		o.Ratio = "1280:720"
	}
	ratios := strings.Fields("1280:720 720:1280")
	if s.GetMode() == runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME {
		ratios = strings.Fields("1280:720 720:1280 1104:832 960:960 832:1104 1584:672")
	}
	if !contains(ratios, o.GetRatio()) || o.GetResolution() != "" {
		return runwayVideoUnsupported()
	}
	if o.Seed != nil && (o.GetSeed() < 0 || o.GetSeed() > 4294967295) || o.Frames != nil || o.Fps != nil || o.CameraFixed != nil || o.Watermark != nil || o.Draft != nil || o.ReturnLastFrame != nil || o.GenerateAudio != nil || o.GetServiceTier() != "" || o.GetExecutionExpiresAfterSec() != 0 {
		return runwayVideoUnsupported()
	}
	return nil
}
