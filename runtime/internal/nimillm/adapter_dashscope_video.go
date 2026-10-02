package nimillm

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.r075
// Wan 2.7 image-to-video uses input.media, unlike the older img_url protocol.
// https://help.aliyun.com/zh/model-studio/image-to-video-general-api-reference
func buildWan27ImageVideoPayload(model string, spec *runtimev1.VideoGenerateScenarioSpec) (map[string]any, error) {
	invalid := func() (map[string]any, error) {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
	}
	if model != "wan2.7-i2v" || spec == nil || (spec.GetMode() != runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME && spec.GetMode() != runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_LAST) {
		return invalid()
	}
	input := map[string]any{}
	if prompt := VideoPrompt(spec); prompt != "" {
		input["prompt"] = prompt
	}
	if negative := VideoNegativePrompt(spec); negative != "" {
		input["negative_prompt"] = negative
	}
	media := []map[string]any{}
	seen := map[string]bool{}
	for _, item := range VideoContentWithPrompt(spec) {
		if item == nil {
			return invalid()
		}
		kind, location := "", ""
		switch item.GetType() {
		case runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT:
			if item.GetRole() != runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT {
				return invalid()
			}
			continue
		case runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_IMAGE_URL:
			switch item.GetRole() {
			case runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME:
				kind = "first_frame"
			case runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_LAST_FRAME:
				kind = "last_frame"
			default:
				return invalid()
			}
			location = item.GetImageUrl().GetUrl()
		case runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_AUDIO_URL:
			if item.GetRole() != runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_AUDIO {
				return invalid()
			}
			kind, location = "driving_audio", item.GetAudioUrl().GetUrl()
		default:
			return invalid()
		}
		if seen[kind] || strings.TrimSpace(location) == "" || strings.TrimSpace(location) != location {
			return invalid()
		}
		seen[kind] = true
		media = append(media, map[string]any{"type": kind, "url": location})
	}
	if !seen["first_frame"] || (spec.GetMode() == runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_LAST) != seen["last_frame"] {
		return invalid()
	}
	input["media"] = media
	parameters := map[string]any{}
	if options := spec.GetOptions(); options != nil {
		unsupported := func() (map[string]any, error) {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
		}
		if options.GetRatio() != "" || options.Frames != nil || options.Fps != nil || options.CameraFixed != nil || options.GenerateAudio != nil || options.Draft != nil || options.GetServiceTier() != "" || options.GetExecutionExpiresAfterSec() != 0 || options.ReturnLastFrame != nil {
			return unsupported()
		}
		if resolution := strings.ToUpper(strings.TrimSpace(options.GetResolution())); resolution != "" {
			if resolution != "720P" && resolution != "1080P" {
				return unsupported()
			}
			parameters["resolution"] = resolution
		}
		if options.DurationSec != nil {
			if options.GetDurationSec() < 2 || options.GetDurationSec() > 15 {
				return unsupported()
			}
			parameters["duration"] = options.GetDurationSec()
		}
		if options.Seed != nil {
			if options.GetSeed() < 0 || options.GetSeed() > 2147483647 {
				return unsupported()
			}
			parameters["seed"] = options.GetSeed()
		}
		if options.Watermark != nil {
			parameters["watermark"] = options.GetWatermark()
		}
	}
	return map[string]any{"model": model, "input": input, "parameters": parameters}, nil
}
