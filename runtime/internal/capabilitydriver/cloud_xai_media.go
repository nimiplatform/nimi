package capabilitydriver

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

const XAIImage2Model = "grok-imagine-image-2.0"
const XAIImage1Model = "grok-imagine-image"
const XAIVideo15Model = "grok-imagine-video-1.5"
const XAIVideo15LiteModel = "grok-imagine-video-1.5-lite"
const XAIVideo1Model = "grok-imagine-video"
const CloudMediaAdapterXAIImage = "xai_image_adapter"
const CloudMediaAdapterXAIVideo = "xai_video_adapter"

func IsXAIImageModel(model string) bool { return model == XAIImage2Model || model == XAIImage1Model }
func IsXAIVideoModel(model string) bool {
	return model == XAIVideo15Model || model == XAIVideo15LiteModel || model == XAIVideo1Model
}
func XAIVideoReferenceLimit(model string) int {
	switch model {
	case XAIVideo15Model:
		return 14
	case XAIVideo1Model:
		return 7
	case XAIVideo15LiteModel:
		return 2
	default:
		return 0
	}
}
func xaiMediaUnsupported(message string) error {
	return grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED, grpcerr.ReasonOptions{Message: message})
}

func validateXAIImageRequest(request *runtimev1.SubmitScenarioJobRequest, model string) error {
	s := request.GetSpec().GetImageGenerate()
	if s == nil || !IsXAIImageModel(model) || len(request.GetExtensions()) != 0 || strings.TrimSpace(s.GetPrompt()) == "" || s.GetNegativePrompt() != "" || s.GetStyle() != "" || s.Seed != nil || s.Strength != nil || s.GetMask() != "" || s.GetMaskArtifactId() != "" || ImageHasExtendedControls(s) || s.GetN() < 0 || s.GetN() > 10 {
		return xaiMediaUnsupported("xAI images accept a prompt and image count; negative prompt, seed, style, mask, strength and output codec controls are unavailable")
	}
	if s.N == nil || s.GetN() == 0 {
		s.N = proto.Int32(1)
	}
	if s.GetResponseFormat() != "" && s.GetResponseFormat() != "b64_json" {
		return xaiMediaUnsupported("xAI images are received into Runtime-owned artifacts before publication")
	}
	s.ResponseFormat = "b64_json"
	if model == XAIImage1Model {
		if s.GetSize() != "" || s.GetQuality() != "" || s.GetAspectRatio() != "" || len(s.GetReferenceImages()) != 0 || s.GetReferenceImageArtifactId() != "" {
			return xaiMediaUnsupported("The reviewed Image 1.0 baseline admits prompt-only generation; use Image 2.0 for reviewed edit and generation controls")
		}
		return nil
	}
	if len(s.GetReferenceImages()) > 5 {
		return xaiMediaUnsupported("Image 2.0 accepts at most five source images")
	}
	for _, location := range s.GetReferenceImages() {
		if !publicVideoMediaURL(location) {
			return xaiMediaUnsupported("Use an owned image artifact or public HTTPS image references")
		}
	}
	switch strings.ToLower(s.GetSize()) {
	case "":
		s.Size = "1k"
	case "1k", "2k":
		s.Size = strings.ToLower(s.GetSize())
	default:
		return xaiMediaUnsupported("Image 2.0 size is a native 1k or 2k tier, not an exact pixel dimension")
	}
	switch s.GetQuality() {
	case "":
		s.Quality = "auto"
	case "auto", "low", "medium":
	default:
		return xaiMediaUnsupported("Image 2.0 quality must be auto, low or medium")
	}
	switch s.GetAspectRatio() {
	case "":
		s.AspectRatio = "auto"
	case "auto", "1:1", "3:4", "4:3", "9:16", "16:9", "2:3", "3:2", "9:19.5", "19.5:9", "9:20", "20:9", "1:2", "2:1", "21:9", "5:2":
	default:
		return xaiMediaUnsupported("Unsupported Image 2.0 aspect ratio")
	}
	return nil
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r108
func validateXAIVideoRequest(request *runtimev1.SubmitScenarioJobRequest, model string) error {
	s := request.GetSpec().GetVideoGenerate()
	if s == nil || !IsXAIVideoModel(model) || len(request.GetExtensions()) != 0 || s.GetNegativePrompt() != "" {
		return xaiMediaUnsupported("xAI video requires the selected native model and a prompt without extensions or negative prompt")
	}
	first, last, references := 0, 0, 0
	for _, item := range s.GetContent() {
		if item == nil {
			return xaiMediaUnsupported("Invalid video content")
		}
		if item.GetType() == runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT {
			if item.GetRole() != runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT || strings.TrimSpace(item.GetText()) == "" {
				return xaiMediaUnsupported("Invalid video prompt content")
			}
			continue
		}
		switch item.GetType() {
		case runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_ARTIFACT_REF:
			if item.GetArtifactRef().GetArtifactId() == "" {
				return xaiMediaUnsupported("Missing owned image reference")
			}
		case runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_IMAGE_URL:
			if !publicVideoMediaURL(item.GetImageUrl().GetUrl()) {
				return xaiMediaUnsupported("Use owned images or public HTTPS references")
			}
		default:
			return xaiMediaUnsupported("This xAI video Driver admits image conditions; public voice presets are not owned audio references")
		}
		switch item.GetRole() {
		case runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME:
			first++
		case runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_LAST_FRAME:
			last++
		case runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_IMAGE:
			references++
		default:
			return xaiMediaUnsupported("Unsupported xAI video reference role")
		}
	}
	switch s.GetMode() {
	case runtimev1.VideoMode_VIDEO_MODE_T2V:
		if first+last+references != 0 || VideoPrompt(s) == "" {
			return xaiMediaUnsupported("Text-to-video cannot carry image conditions")
		}
	case runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME:
		if first != 1 || last+references != 0 {
			return xaiMediaUnsupported("Image-to-video requires one first frame")
		}
	case runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_LAST:
		if model != XAIVideo15Model || first != 1 || last != 1 || references != 0 {
			return xaiMediaUnsupported("Paired first and last frames require Video 1.5")
		}
	case runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE:
		if model == XAIVideo15LiteModel || references < 1 || references > XAIVideoReferenceLimit(model) || first+last != 0 || VideoPrompt(s) == "" {
			return xaiMediaUnsupported("Reference video requires the reviewed model-specific image set")
		}
	default:
		return xaiMediaUnsupported("Unsupported xAI video mode")
	}
	if s.Options == nil {
		s.Options = &runtimev1.VideoGenerationOptions{}
	}
	o := s.Options
	if o.Seed != nil || o.Frames != nil || o.Fps != nil || o.CameraFixed != nil || o.Watermark != nil || o.Draft != nil || o.ReturnLastFrame != nil || o.GetServiceTier() != "" || o.GetExecutionExpiresAfterSec() != 0 {
		return xaiMediaUnsupported("xAI video does not admit these frame, seed, camera, watermark or execution controls")
	}
	if o.DurationSec == nil {
		o.DurationSec = proto.Int32(8)
	}
	maximum := int32(15)
	if model == XAIVideo1Model && s.GetMode() == runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE {
		maximum = 10
	}
	if o.GetDurationSec() < 1 || o.GetDurationSec() > maximum {
		return xaiMediaUnsupported("xAI video duration exceeds the exact mode's range")
	}
	if o.Resolution == "" {
		o.Resolution = "720p"
	}
	switch o.GetResolution() {
	case "480p", "720p":
	case "1080p":
		if model == XAIVideo1Model || s.GetMode() == runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE || s.GetMode() == runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_LAST {
			return xaiMediaUnsupported("1080p is only admitted for current text-to-video and single-image generation")
		}
	default:
		return xaiMediaUnsupported("Unsupported xAI video resolution")
	}
	if first > 0 {
		if o.GetRatio() != "" && o.GetRatio() != "adaptive" {
			return xaiMediaUnsupported("xAI image-to-video follows the source aspect ratio; an explicit ratio must not be silently ignored")
		}
		o.Ratio = ""
	} else {
		if o.Ratio == "" {
			o.Ratio = "16:9"
		}
		switch o.GetRatio() {
		case "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9", "5:2":
		default:
			return xaiMediaUnsupported("Unsupported xAI video aspect ratio")
		}
	}
	if o.GenerateAudio == nil {
		o.GenerateAudio = proto.Bool(true)
	}
	return nil
}
