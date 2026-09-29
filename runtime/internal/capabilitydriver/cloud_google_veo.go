package capabilitydriver

import (
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
// text-to-video cells that the native Host transport can execute. Every admitted option is sent to Google;
// there is no silent mode, media input, or option downgrade.
func validateGoogleVeoVideoRequest(request *runtimev1.SubmitScenarioJobRequest, model string) error {
	unsupported := func() error {
		return grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED, grpcerr.ReasonOptions{
			Message:    "Google Veo 3.1 text-to-video currently supports 720p, 16:9, and four seconds; image inputs, other modes, durations, and controls are unavailable",
			ActionHint: "select_veo_31_text_to_video_4s",
		})
	}
	if !admittedGoogleVeoTextVideoModel(model) || request == nil || request.GetSpec().GetVideoGenerate() == nil {
		return unsupported()
	}
	spec := request.GetSpec().GetVideoGenerate()
	if spec.GetMode() != runtimev1.VideoMode_VIDEO_MODE_T2V || strings.TrimSpace(spec.GetNegativePrompt()) != "" || len(request.GetExtensions()) > 0 {
		return unsupported()
	}
	prompt := strings.TrimSpace(spec.GetPrompt())
	for _, item := range spec.GetContent() {
		if item == nil || item.GetType() != runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT ||
			(item.GetRole() != runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT && item.GetRole() != runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_UNSPECIFIED) ||
			strings.TrimSpace(item.GetText()) == "" {
			return unsupported()
		}
		prompt += strings.TrimSpace(item.GetText())
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
