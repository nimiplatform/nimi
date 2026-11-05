package capabilitydriver

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
	"strings"
	"unicode/utf8"
)

const LumaRay32Model = "ray-3.2"

// @nimi-authority: rule.nimi.runtime.ai-provider.luma-ray32-video
func normalizeLumaRay32Request(req *runtimev1.SubmitScenarioJobRequest) error {
	s := req.GetSpec().GetVideoGenerate()
	invalid := grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	if s == nil || len(req.GetExtensions()) > 0 || VideoPrompt(s) == "" || utf8.RuneCountInString(VideoPrompt(s)) > 6000 || s.GetNegativePrompt() != "" {
		return invalid
	}
	first, last := 0, 0
	for _, item := range s.GetContent() {
		if item == nil {
			return invalid
		}
		if item.GetType() == runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT {
			if item.GetRole() != runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT || strings.TrimSpace(item.GetText()) == "" {
				return invalid
			}
			continue
		}
		switch item.GetType() {
		case runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_ARTIFACT_REF:
			if item.GetArtifactRef().GetArtifactId() == "" {
				return invalid
			}
		case runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_IMAGE_URL:
			if !publicVideoMediaURL(item.GetImageUrl().GetUrl()) || !strings.HasPrefix(item.GetImageUrl().GetUrl(), "https://") {
				return invalid
			}
		default:
			return invalid
		}
		switch item.GetRole() {
		case runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME:
			first++
		case runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_LAST_FRAME:
			last++
		default:
			return invalid
		}
	}
	switch s.GetMode() {
	case runtimev1.VideoMode_VIDEO_MODE_T2V:
		if first+last != 0 {
			return invalid
		}
	case runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME:
		if first != 1 || last != 0 {
			return invalid
		}
	case runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_LAST:
		if first != 1 || last != 1 {
			return invalid
		}
	default:
		return invalid
	}
	if s.Options == nil {
		s.Options = &runtimev1.VideoGenerationOptions{}
	}
	o := s.Options
	if o.DurationSec == nil {
		o.DurationSec = proto.Int32(5)
	}
	if o.GetDurationSec() != 5 && o.GetDurationSec() != 10 {
		return invalid
	}
	if o.Seed != nil || o.Frames != nil || o.Fps != nil || o.CameraFixed != nil || o.GenerateAudio != nil || o.Watermark != nil || o.Draft != nil || o.ReturnLastFrame != nil || o.GetServiceTier() != "" || o.GetExecutionExpiresAfterSec() != 0 {
		return invalid
	}
	o.Resolution = strings.ToLower(o.GetResolution())
	switch o.GetResolution() {
	case "", "360p", "540p", "720p", "1080p":
	default:
		return invalid
	}
	switch o.GetRatio() {
	case "", "16:9", "4:3", "1:1", "3:4", "9:16", "21:9":
	default:
		return invalid
	}
	return nil
}
