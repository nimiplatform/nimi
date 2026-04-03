package nimillm

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func VideoPrompt(spec *runtimev1.VideoGenerateScenarioSpec) string {
	if spec == nil {
		return ""
	}
	prompt := strings.TrimSpace(spec.GetPrompt())
	if prompt != "" {
		return prompt
	}
	for _, item := range spec.GetContent() {
		if item == nil || item.GetType() != runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT {
			continue
		}
		if role := item.GetRole(); role != runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_UNSPECIFIED && role != runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT {
			continue
		}
		if text := strings.TrimSpace(item.GetText()); text != "" {
			return text
		}
	}
	return ""
}

func VideoNegativePrompt(spec *runtimev1.VideoGenerateScenarioSpec) string {
	if spec == nil {
		return ""
	}
	return strings.TrimSpace(spec.GetNegativePrompt())
}

func VideoModeValue(spec *runtimev1.VideoGenerateScenarioSpec) runtimev1.VideoMode {
	if spec == nil {
		return runtimev1.VideoMode_VIDEO_MODE_UNSPECIFIED
	}
	return spec.GetMode()
}

func VideoResolution(spec *runtimev1.VideoGenerateScenarioSpec) string {
	if spec == nil || spec.GetOptions() == nil {
		return ""
	}
	return strings.TrimSpace(spec.GetOptions().GetResolution())
}

func VideoRatio(spec *runtimev1.VideoGenerateScenarioSpec) string {
	if spec == nil || spec.GetOptions() == nil {
		return ""
	}
	return strings.TrimSpace(spec.GetOptions().GetRatio())
}

func VideoDurationSec(spec *runtimev1.VideoGenerateScenarioSpec) int32 {
	if spec == nil || spec.GetOptions() == nil {
		return 0
	}
	return spec.GetOptions().GetDurationSec()
}

func VideoFrames(spec *runtimev1.VideoGenerateScenarioSpec) int32 {
	if spec == nil || spec.GetOptions() == nil {
		return 0
	}
	return spec.GetOptions().GetFrames()
}

func VideoFPS(spec *runtimev1.VideoGenerateScenarioSpec) int32 {
	if spec == nil || spec.GetOptions() == nil {
		return 0
	}
	return spec.GetOptions().GetFps()
}

func VideoSeed(spec *runtimev1.VideoGenerateScenarioSpec) int64 {
	if spec == nil || spec.GetOptions() == nil {
		return 0
	}
	return spec.GetOptions().GetSeed()
}

func VideoCameraFixed(spec *runtimev1.VideoGenerateScenarioSpec) bool {
	if spec == nil || spec.GetOptions() == nil {
		return false
	}
	return spec.GetOptions().GetCameraFixed()
}

func VideoWatermark(spec *runtimev1.VideoGenerateScenarioSpec) bool {
	if spec == nil || spec.GetOptions() == nil {
		return false
	}
	return spec.GetOptions().GetWatermark()
}

func VideoGenerateAudio(spec *runtimev1.VideoGenerateScenarioSpec) bool {
	if spec == nil || spec.GetOptions() == nil {
		return false
	}
	return spec.GetOptions().GetGenerateAudio()
}

func VideoDraft(spec *runtimev1.VideoGenerateScenarioSpec) bool {
	if spec == nil || spec.GetOptions() == nil {
		return false
	}
	return spec.GetOptions().GetDraft()
}

func VideoServiceTier(spec *runtimev1.VideoGenerateScenarioSpec) string {
	if spec == nil || spec.GetOptions() == nil {
		return ""
	}
	return strings.TrimSpace(spec.GetOptions().GetServiceTier())
}

func VideoExecutionExpiresAfterSec(spec *runtimev1.VideoGenerateScenarioSpec) int32 {
	if spec == nil || spec.GetOptions() == nil {
		return 0
	}
	return spec.GetOptions().GetExecutionExpiresAfterSec()
}

func VideoReturnLastFrame(spec *runtimev1.VideoGenerateScenarioSpec) bool {
	if spec == nil || spec.GetOptions() == nil {
		return false
	}
	return spec.GetOptions().GetReturnLastFrame()
}

func VideoFirstFrameURI(spec *runtimev1.VideoGenerateScenarioSpec) string {
	for _, item := range videoImageContentByRole(spec, runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME) {
		return item
	}
	return ""
}

func VideoLastFrameURI(spec *runtimev1.VideoGenerateScenarioSpec) string {
	for _, item := range videoImageContentByRole(spec, runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_LAST_FRAME) {
		return item
	}
	return ""
}

func VideoReferenceImageURIs(spec *runtimev1.VideoGenerateScenarioSpec) []string {
	return videoImageContentByRole(spec, runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_IMAGE)
}

func VideoReferenceVideoURIs(spec *runtimev1.VideoGenerateScenarioSpec) []string {
	return videoURLContentByRole(spec, runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_VIDEO_URL, runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_VIDEO)
}

func VideoReferenceAudioURIs(spec *runtimev1.VideoGenerateScenarioSpec) []string {
	return videoURLContentByRole(spec, runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_AUDIO_URL, runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_AUDIO)
}

func VideoContentPayload(spec *runtimev1.VideoGenerateScenarioSpec) []map[string]any {
	if spec == nil {
		return nil
	}
	items := spec.GetContent()
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		if item == nil {
			continue
		}
		payload := map[string]any{}
		switch item.GetType() {
		case runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT:
			text := strings.TrimSpace(item.GetText())
			if text == "" {
				continue
			}
			payload["type"] = "text"
			payload["text"] = text
		case runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_IMAGE_URL:
			url := strings.TrimSpace(item.GetImageUrl().GetUrl())
			if url == "" {
				continue
			}
			payload["type"] = "image_url"
			payload["image_url"] = map[string]any{"url": url}
		case runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_VIDEO_URL:
			url := strings.TrimSpace(item.GetVideoUrl().GetUrl())
			if url == "" {
				continue
			}
			payload["type"] = "video_url"
			payload["video_url"] = map[string]any{"url": url}
		case runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_AUDIO_URL:
			url := strings.TrimSpace(item.GetAudioUrl().GetUrl())
			if url == "" {
				continue
			}
			payload["type"] = "audio_url"
			payload["audio_url"] = map[string]any{"url": url}
		default:
			continue
		}
		if item.GetType() != runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT {
			if role := videoContentRoleName(item.GetRole()); role != "" {
				payload["role"] = role
			}
		}
		out = append(out, payload)
	}
	return out
}

func videoImageContentByRole(spec *runtimev1.VideoGenerateScenarioSpec, role runtimev1.VideoContentRole) []string {
	if spec == nil {
		return nil
	}
	out := make([]string, 0, 4)
	for _, item := range spec.GetContent() {
		if item == nil || item.GetType() != runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_IMAGE_URL {
			continue
		}
		if item.GetRole() != role {
			continue
		}
		url := strings.TrimSpace(item.GetImageUrl().GetUrl())
		if url == "" {
			continue
		}
		out = append(out, url)
	}
	return out
}

func videoURLContentByRole(spec *runtimev1.VideoGenerateScenarioSpec, contentType runtimev1.VideoContentType, role runtimev1.VideoContentRole) []string {
	if spec == nil {
		return nil
	}
	out := make([]string, 0, 4)
	for _, item := range spec.GetContent() {
		if item == nil || item.GetType() != contentType || item.GetRole() != role {
			continue
		}
		var url string
		switch contentType {
		case runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_VIDEO_URL:
			url = strings.TrimSpace(item.GetVideoUrl().GetUrl())
		case runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_AUDIO_URL:
			url = strings.TrimSpace(item.GetAudioUrl().GetUrl())
		default:
			continue
		}
		if url == "" {
			continue
		}
		out = append(out, url)
	}
	return out
}

func videoContentRoleName(role runtimev1.VideoContentRole) string {
	switch role {
	case runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT:
		return "prompt"
	case runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME:
		return "first_frame"
	case runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_LAST_FRAME:
		return "last_frame"
	case runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_IMAGE:
		return "reference_image"
	case runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_VIDEO:
		return "reference_video"
	case runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_AUDIO:
		return "reference_audio"
	default:
		return ""
	}
}
