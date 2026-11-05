package capabilitydriver

import (
	"net/url"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

const GeminiOmniVideoModel = "gemini-omni-1.1-flash"

// @nimi-authority: rule.nimi.runtime.ai-provider.gemini-omni-video
func validateGeminiOmniVideoRequest(request *runtimev1.SubmitScenarioJobRequest, model string) error {
	unsupported := func() error {
		return grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED, grpcerr.ReasonOptions{
			Message:    "Gemini Omni supports text, first/last frames or up to six reference images, 3–10 seconds, 16:9 or 9:16 and 360p/720p/1080p/4k; other controls are unavailable",
			ActionHint: "use_supported_gemini_omni_video_options",
		})
	}
	if model != GeminiOmniVideoModel || request == nil || request.GetSpec().GetVideoGenerate() == nil || len(request.GetExtensions()) != 0 {
		return unsupported()
	}
	spec := request.GetSpec().GetVideoGenerate()
	if strings.TrimSpace(spec.GetNegativePrompt()) != "" {
		return unsupported()
	}
	prompt := strings.TrimSpace(spec.GetPrompt()) != ""
	first, last, refs := 0, 0, 0
	for _, item := range spec.GetContent() {
		if item == nil {
			return unsupported()
		}
		switch item.GetType() {
		case runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT:
			if (item.GetRole() != runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT && item.GetRole() != runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_UNSPECIFIED) || strings.TrimSpace(item.GetText()) == "" {
				return unsupported()
			}
			prompt = true
		case runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_IMAGE_URL, runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_ARTIFACT_REF:
			if item.GetType() == runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_ARTIFACT_REF {
				if strings.TrimSpace(item.GetArtifactRef().GetArtifactId()) == "" {
					return unsupported()
				}
			} else {
				location := item.GetImageUrl().GetUrl()
				if !strings.HasPrefix(location, "data:image/") {
					parsed, err := url.Parse(location)
					if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil || parsed.Fragment != "" {
						return unsupported()
					}
				}
			}
			switch item.GetRole() {
			case runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME:
				first++
			case runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_LAST_FRAME:
				last++
			case runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_IMAGE:
				refs++
			default:
				return unsupported()
			}
		default:
			return unsupported()
		}
	}
	if !prompt {
		return unsupported()
	}
	switch spec.GetMode() {
	case runtimev1.VideoMode_VIDEO_MODE_T2V:
		if first+last+refs != 0 {
			return unsupported()
		}
	case runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME:
		if first != 1 || last+refs != 0 {
			return unsupported()
		}
	case runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_LAST:
		if first != 1 || last != 1 || refs != 0 {
			return unsupported()
		}
	case runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE:
		if first+last != 0 || refs < 1 || refs > 6 {
			return unsupported()
		}
	default:
		return unsupported()
	}
	options := spec.GetOptions()
	if options == nil {
		return nil
	}
	if options.DurationSec != nil && (options.GetDurationSec() < 3 || options.GetDurationSec() > 10) {
		return unsupported()
	}
	switch options.GetResolution() {
	case "", "360p", "720p", "1080p", "4k":
	default:
		return unsupported()
	}
	switch options.GetRatio() {
	case "", "16:9", "9:16":
	default:
		return unsupported()
	}
	if options.Frames != nil || options.Fps != nil || options.Seed != nil || options.CameraFixed != nil || options.Watermark != nil || options.GenerateAudio != nil || options.Draft != nil || options.GetServiceTier() != "" || options.GetExecutionExpiresAfterSec() != 0 || options.ReturnLastFrame != nil {
		return unsupported()
	}
	return nil
}
