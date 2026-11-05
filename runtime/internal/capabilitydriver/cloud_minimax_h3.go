package capabilitydriver

import (
	"bytes"
	"image"
	"strings"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

func IsMiniMaxH3VideoModel(model string) bool {
	switch model {
	case "MiniMax-H3", "MiniMax-H3-Highspeed", "MiniMax-H3-Lite", "MiniMax-H3-Max":
		return true
	}
	return false
}

// @nimi-authority: rule.nimi.runtime.ai-provider.minimax-h3-video
// MapRequest supplies its own clone. Required native defaults are committed
// into that mapped request before the immutable execution snapshot is saved.
func normalizeMiniMaxH3VideoRequest(req *runtimev1.SubmitScenarioJobRequest, model string) error {
	unsupported := func() error {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	if !IsMiniMaxH3VideoModel(model) || req == nil || req.GetSpec().GetVideoGenerate() == nil || len(req.GetExtensions()) != 0 {
		return unsupported()
	}
	s := req.GetSpec().GetVideoGenerate()
	prompt := VideoPrompt(s)
	if prompt == "" || utf8.RuneCountInString(prompt) > 7000 || strings.TrimSpace(s.GetNegativePrompt()) != "" {
		return unsupported()
	}
	first, last, images, videos, audios := 0, 0, 0, 0, 0
	for _, item := range s.GetContent() {
		if item == nil {
			return unsupported()
		}
		role := item.GetRole()
		switch item.GetType() {
		case runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT:
			if role != runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT || strings.TrimSpace(item.GetText()) == "" {
				return unsupported()
			}
			continue
		case runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_ARTIFACT_REF:
			if item.GetArtifactRef().GetArtifactId() == "" {
				return unsupported()
			}
		case runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_IMAGE_URL:
			if !publicVideoMediaURL(item.GetImageUrl().GetUrl()) || (role != runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME && role != runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_LAST_FRAME && role != runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_IMAGE) {
				return unsupported()
			}
		case runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_VIDEO_URL:
			if !publicVideoMediaURL(item.GetVideoUrl().GetUrl()) || role != runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_VIDEO {
				return unsupported()
			}
		case runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_AUDIO_URL:
			if !publicVideoMediaURL(item.GetAudioUrl().GetUrl()) || role != runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_AUDIO {
				return unsupported()
			}
		default:
			return unsupported()
		}
		switch role {
		case runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME:
			first++
		case runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_LAST_FRAME:
			last++
		case runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_IMAGE:
			images++
		case runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_VIDEO:
			videos++
		case runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_AUDIO:
			audios++
		default:
			return unsupported()
		}
	}
	if images > 9 || videos > 3 || audios > 3 {
		return unsupported()
	}
	switch s.GetMode() {
	case runtimev1.VideoMode_VIDEO_MODE_T2V:
		if first+last+images+videos+audios != 0 {
			return unsupported()
		}
	case runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME:
		if first != 1 || last+images+videos+audios != 0 {
			return unsupported()
		}
	case runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_LAST:
		if first != 1 || last != 1 || images+videos+audios != 0 {
			return unsupported()
		}
	case runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE:
		if first+last != 0 || images+videos+audios == 0 {
			return unsupported()
		}
	default:
		return unsupported()
	}
	if s.Options == nil {
		s.Options = &runtimev1.VideoGenerationOptions{}
	}
	o := s.Options
	o.Resolution = strings.ToLower(strings.TrimSpace(o.Resolution))
	o.Ratio = strings.ToLower(strings.TrimSpace(o.Ratio))
	if o.GetResolution() == "" {
		o.Resolution = "768p"
	}
	if o.DurationSec == nil {
		o.DurationSec = proto.Int32(5)
	}
	concreteRatio := s.GetMode() == runtimev1.VideoMode_VIDEO_MODE_T2V || (model == "MiniMax-H3-Lite" && s.GetMode() == runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE)
	if concreteRatio && o.GetRatio() == "" {
		o.Ratio = "16:9"
	}
	if o.Seed != nil || o.Frames != nil || o.Fps != nil || o.GenerateAudio != nil || o.CameraFixed != nil || o.Draft != nil || o.ReturnLastFrame != nil || o.GetServiceTier() != "" || o.GetExecutionExpiresAfterSec() != 0 {
		return unsupported()
	}
	minDuration := int32(4)
	if model == "MiniMax-H3-Max" {
		minDuration = 5
	}
	if o.GetDurationSec() < minDuration || o.GetDurationSec() > 15 {
		return unsupported()
	}
	if model == "MiniMax-H3" {
		if o.GetResolution() != "768p" && o.GetResolution() != "2k" {
			return unsupported()
		}
	} else if o.GetResolution() != "480p" && o.GetResolution() != "768p" {
		return unsupported()
	}
	switch o.GetRatio() {
	case "", "adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16":
	default:
		return unsupported()
	}
	if (first+last > 0 && o.GetRatio() != "" && o.GetRatio() != "adaptive") || (concreteRatio && o.GetRatio() == "adaptive") {
		return unsupported()
	}
	return nil
}

func ValidateMiniMaxH3Image(data []byte, mime string) error {
	if len(data) > 30_000_000 {
		return grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_ARTIFACT_TOO_LARGE)
	}
	invalid := grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_ARTIFACT_MIME_MISMATCH)
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || (format != "png" && format != "jpeg" && format != "webp") || mime != "image/"+format {
		return invalid
	}
	if config.Width < 256 || config.Height < 256 || config.Width > 5760 || config.Height > 5760 || int64(config.Width)*int64(config.Height) > 16<<20 || config.Width*2 > config.Height*5 || config.Height*2 > config.Width*5 {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	if _, _, err = image.Decode(bytes.NewReader(data)); err != nil {
		return invalid
	}
	return nil
}
