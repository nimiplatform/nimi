package capabilitydriver

import (
	"net/url"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

const (
	googleVeoFastTextVideoModel     = "veo-3.1-fast-generate-preview"
	googleVeoStandardTextVideoModel = "veo-3.1-generate-preview"
	googleVeoLiteTextVideoModel     = "veo-3.1-lite-generate-preview"
)

func admittedGoogleVeoTextVideoModel(model string) bool {
	switch model {
	case googleVeoFastTextVideoModel, googleVeoStandardTextVideoModel, googleVeoLiteTextVideoModel:
		return true
	default:
		return false
	}
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r051
// validateGoogleVeoVideoRequest admits only the three exact Veo 3.1 preview
// text-to-video cells and Fast first-frame cell that the native Host transport can execute. Every admitted option is sent to Google;
// there is no silent mode, media input, or option downgrade.
func validateGoogleVeoVideoRequest(request *runtimev1.SubmitScenarioJobRequest, model string) error {
	unsupported := func() error {
		return grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED, grpcerr.ReasonOptions{
			Message:    "This video setup supports four-second 720p 16:9 text video, or Fast video from one HTTPS first frame; other modes and controls are unavailable",
			ActionHint: "choose_supported_video_mode_and_input",
		})
	}
	if !admittedGoogleVeoTextVideoModel(model) || request == nil || request.GetSpec().GetVideoGenerate() == nil {
		return unsupported()
	}
	spec := request.GetSpec().GetVideoGenerate()
	if (spec.GetMode() != runtimev1.VideoMode_VIDEO_MODE_T2V && (model != googleVeoFastTextVideoModel || spec.GetMode() != runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME)) || strings.TrimSpace(spec.GetNegativePrompt()) != "" || len(request.GetExtensions()) > 0 {
		return unsupported()
	}
	prompt := strings.TrimSpace(spec.GetPrompt())
	firstFrames := 0
	for _, item := range spec.GetContent() {
		if item == nil {
			return unsupported()
		}
		switch item.GetType() {
		case runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT:
			if (item.GetRole() != runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT && item.GetRole() != runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_UNSPECIFIED) || strings.TrimSpace(item.GetText()) == "" {
				return unsupported()
			}
			prompt += strings.TrimSpace(item.GetText())
		case runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_IMAGE_URL:
			if spec.GetMode() != runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME || item.GetRole() != runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME || item.GetImageUrl() == nil {
				return unsupported()
			}
			parsed, err := url.Parse(item.GetImageUrl().GetUrl())
			if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil || parsed.Fragment != "" {
				return unsupported()
			}
			firstFrames++
		default:
			return unsupported()
		}
	}
	if (spec.GetMode() == runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME && firstFrames != 1) || firstFrames > 1 {
		return unsupported()
	}
	if prompt == "" {
		return unsupported()
	}
	options := spec.GetOptions()
	if options == nil {
		return nil
	}
	if (strings.TrimSpace(options.GetResolution()) != "" && strings.TrimSpace(options.GetResolution()) != "720p") ||
		(strings.TrimSpace(options.GetRatio()) != "" && strings.TrimSpace(options.GetRatio()) != "16:9") ||
		(options.DurationSec != nil && options.GetDurationSec() != 4) ||
		options.Frames != nil || options.Fps != nil || options.Seed != nil ||
		options.CameraFixed != nil || options.Watermark != nil || options.GenerateAudio != nil ||
		options.Draft != nil || strings.TrimSpace(options.GetServiceTier()) != "" ||
		options.GetExecutionExpiresAfterSec() != 0 || options.ReturnLastFrame != nil {
		return unsupported()
	}
	return nil
}
