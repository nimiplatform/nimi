package capabilitydriver

import (
	"bytes"
	"image"
	"net/url"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

const Seedance25VideoModel = "doubao-seedance-2-5-260628"
const Seedance20VideoModel = "doubao-seedance-2-0-260128"
const Seedance20FastVideoModel = "doubao-seedance-2-0-fast-260128"
const Seedance20MiniVideoModel = "doubao-seedance-2-0-mini-260615"

func isSeedance20VideoModel(model string) bool {
	return model == Seedance20VideoModel || model == Seedance20FastVideoModel || model == Seedance20MiniVideoModel
}

func IsCurrentSeedanceVideoModel(model string) bool {
	return model == Seedance25VideoModel || isSeedance20VideoModel(model)
}

func SeedanceVideoReferenceLimits(model string) (images, videos, audios int) {
	if model == Seedance25VideoModel {
		return 30, 10, 10
	}
	if isSeedance20VideoModel(model) {
		return 9, 3, 3
	}
	return 0, 0, 0
}

// @nimi-authority: rule.nimi.runtime.ai-provider.seedance-current-video
func ValidateCurrentSeedanceVideoRequest(req *runtimev1.SubmitScenarioJobRequest, model string) error {
	unsupported := func() error {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	if !IsCurrentSeedanceVideoModel(model) || req == nil || req.GetSpec().GetVideoGenerate() == nil || len(req.GetExtensions()) != 0 {
		return unsupported()
	}
	s := req.GetSpec().GetVideoGenerate()
	if strings.TrimSpace(s.GetNegativePrompt()) != "" {
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
			// Owned video requires a separate reviewed upload/storage workflow.
			if role == runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_VIDEO {
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
	maxImages, maxVideos, maxAudios := SeedanceVideoReferenceLimits(model)
	if images > maxImages || videos > maxVideos || audios > maxAudios {
		return unsupported()
	}
	switch s.GetMode() {
	case runtimev1.VideoMode_VIDEO_MODE_T2V:
		if strings.TrimSpace(VideoPrompt(s)) == "" || first+last+images+videos+audios != 0 {
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
		if first+last != 0 || images+videos+audios == 0 || (isSeedance20VideoModel(model) && images+videos == 0) {
			return unsupported()
		}
	default:
		return unsupported()
	}
	o := s.GetOptions()
	if o == nil {
		return nil
	}
	// These controls are documented for Seedance 1.0 only, or are not mapped.
	if o.Seed != nil || o.CameraFixed != nil || o.Frames != nil || o.Fps != nil || o.GetServiceTier() != "" {
		return unsupported()
	}
	if o.GetExecutionExpiresAfterSec() != 0 && (o.GetExecutionExpiresAfterSec() < 3600 || o.GetExecutionExpiresAfterSec() > 259200) {
		return unsupported()
	}
	maxDuration := int32(15)
	if model == Seedance25VideoModel {
		maxDuration = 30
	}
	if o.DurationSec != nil && o.GetDurationSec() != -1 && (o.GetDurationSec() < 4 || o.GetDurationSec() > maxDuration) {
		return unsupported()
	}
	if o.GetResolution() != "" && o.GetResolution() != "480p" && o.GetResolution() != "720p" && !((model == Seedance25VideoModel || model == Seedance20VideoModel) && o.GetResolution() == "1080p") && !(model == Seedance20VideoModel && o.GetResolution() == "4k") {
		return unsupported()
	}
	switch o.GetRatio() {
	case "", "adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16":
	default:
		return unsupported()
	}
	if model == Seedance25VideoModel && (first > 0 || last > 0) && o.GetRatio() != "" && o.GetRatio() != "adaptive" {
		return unsupported()
	}
	if o.Draft != nil && model != Seedance25VideoModel {
		return unsupported()
	}
	if o.GetDraft() && o.GetResolution() != "480p" {
		return unsupported()
	}
	return nil
}

func publicVideoMediaURL(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && (u.Scheme == "https" || u.Scheme == "http") && u.Host != "" && u.User == nil
}

func ValidateSeedanceVideoImage(model string, data []byte, mime string) error {
	invalid := grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_ARTIFACT_MIME_MISMATCH)
	if len(data) >= 30_000_000 {
		return grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_ARTIFACT_TOO_LARGE)
	}
	if !IsCurrentSeedanceVideoModel(model) || len(data) == 0 {
		return invalid
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || (format != "png" && format != "jpeg" && format != "webp") || mime != "image/"+format || config.Width < 300 || config.Height < 300 || config.Width > 6000 || config.Height > 6000 || int64(config.Width)*int64(config.Height) > 16<<20 || config.Width*2 > config.Height*5 || config.Height*2 > config.Width*5 {
		return invalid
	}
	if _, _, err = image.Decode(bytes.NewReader(data)); err != nil {
		return invalid
	}
	return nil
}
