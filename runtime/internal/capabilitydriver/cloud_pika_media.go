package capabilitydriver

import (
	"strings"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

func IsPikaVideoModel(model string) bool {
	switch model {
	case "pika/pika-2.5/text-to-video", "pika/pika-2.5/image-to-video", "pika/pika-h3-flex/text-to-video", "pika/pika-h3-flex/image-to-video", "pika/pika-h3-flex/reference-to-video":
		return true
	default:
		return false
	}
}
func pikaUnsupported() error {
	return nativeCloudSpeechUnsupported("The selected Pika operation does not support this exact video request")
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r108
func validatePikaVideo(req *runtimev1.SubmitScenarioJobRequest, model string, mode CloudMediaStreamMode) error {
	s := req.GetSpec().GetVideoGenerate()
	if s == nil || !IsPikaVideoModel(model) || mode != CloudMediaStreamNone || len(req.GetExtensions()) != 0 {
		return pikaUnsupported()
	}
	flex := strings.HasPrefix(model, "pika/pika-h3-flex/")
	maxPrompt := 4000
	if flex {
		maxPrompt = 8000
	}
	if strings.TrimSpace(VideoPrompt(s)) == "" || utf8.RuneCountInString(VideoPrompt(s)) > maxPrompt || flex && s.GetNegativePrompt() != "" {
		return pikaUnsupported()
	}
	first, last, images, videos, audios := 0, 0, 0, 0, 0
	for _, item := range s.GetContent() {
		if item.GetType() == runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT {
			continue
		}
		switch item.GetType() {
		case runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_ARTIFACT_REF:
			return pikaUnsupported()
		case runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_IMAGE_URL:
			if !publicVideoMediaURL(item.GetImageUrl().GetUrl()) {
				return pikaUnsupported()
			}
		case runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_VIDEO_URL:
			if !publicVideoMediaURL(item.GetVideoUrl().GetUrl()) {
				return pikaUnsupported()
			}
		case runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_AUDIO_URL:
			if !publicVideoMediaURL(item.GetAudioUrl().GetUrl()) {
				return pikaUnsupported()
			}
		default:
			return pikaUnsupported()
		}
		switch item.GetRole() {
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
			return pikaUnsupported()
		}
		if item.GetType() != runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_ARTIFACT_REF {
			want := runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_IMAGE_URL
			if item.GetRole() == runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_VIDEO {
				want = runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_VIDEO_URL
			}
			if item.GetRole() == runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_AUDIO {
				want = runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_AUDIO_URL
			}
			if item.GetType() != want {
				return pikaUnsupported()
			}
		}
	}
	switch {
	case strings.HasSuffix(model, "/text-to-video"):
		if s.GetMode() != runtimev1.VideoMode_VIDEO_MODE_T2V || first+last+images+videos+audios != 0 {
			return pikaUnsupported()
		}
	case strings.HasSuffix(model, "/image-to-video"):
		if images+videos+audios != 0 || first != 1 {
			return pikaUnsupported()
		}
		if s.GetMode() == runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME {
			if last != 0 {
				return pikaUnsupported()
			}
		} else if s.GetMode() == runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_LAST {
			if !flex || last != 1 {
				return pikaUnsupported()
			}
		} else {
			return pikaUnsupported()
		}
	case strings.HasSuffix(model, "/reference-to-video"):
		if s.GetMode() != runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE || first+last != 0 || images+videos < 1 || images > 9 || videos > 3 || audios > 3 || images+videos+audios > 12 {
			return pikaUnsupported()
		}
	}
	if s.Options == nil {
		s.Options = &runtimev1.VideoGenerationOptions{}
	}
	o := s.Options
	if o.DurationSec == nil {
		o.DurationSec = proto.Int32(5)
	}
	if flex {
		if o.GetDurationSec() < 3 || o.GetDurationSec() > 15 {
			return pikaUnsupported()
		}
	} else if o.GetDurationSec() != 5 && o.GetDurationSec() != 10 {
		return pikaUnsupported()
	}
	if o.GetResolution() == "" {
		o.Resolution = "1080p"
		if flex {
			o.Resolution = "768p"
		}
	}
	resolutions := strings.Fields("480p 720p 1080p")
	if flex {
		resolutions = strings.Fields("480p 768p 1080p 2k 4k")
	}
	if !contains(resolutions, o.GetResolution()) {
		return pikaUnsupported()
	}
	if o.GetRatio() != "" {
		ratios := strings.Fields("5:2 16:9 4:3 1:1 4:5 9:16")
		if flex {
			ratios = strings.Fields("auto 21:9 16:9 3:2 4:3 5:4 1:1 4:5 3:4 2:3 9:16 9:21")
		} else if strings.HasSuffix(model, "/image-to-video") {
			return pikaUnsupported()
		}
		if !contains(ratios, o.GetRatio()) {
			return pikaUnsupported()
		}
	}
	if o.Frames != nil || o.Fps != nil || o.CameraFixed != nil || o.Watermark != nil || o.Draft != nil || o.ReturnLastFrame != nil || o.GetServiceTier() != "" || o.GetExecutionExpiresAfterSec() != 0 {
		return pikaUnsupported()
	}
	if flex {
		if o.Seed != nil && o.GetSeed() < 0 || o.GenerateAudio != nil && !o.GetGenerateAudio() {
			return pikaUnsupported()
		}
		o.GenerateAudio = proto.Bool(true)
	} else if o.GenerateAudio != nil {
		return pikaUnsupported()
	}
	return nil
}
