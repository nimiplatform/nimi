package capabilitydriver

import (
	"bytes"
	"encoding/base64"
	"image"
	_ "image/gif"
	"net/url"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	_ "golang.org/x/image/bmp"
)

func mimoMessageContent(message *runtimev1.ChatMessage, planning bool) (any, error) {
	if len(message.Parts) == 0 {
		return message.Content, nil
	}
	if message.Content != "" {
		return nil, deepseekJSONInputError("conflicting MiMo content")
	}
	parts := []map[string]any{}
	var plain strings.Builder
	media := false
	for _, part := range message.Parts {
		if part == nil {
			return nil, deepseekJSONInputError("empty MiMo part")
		}
		if part.Type == runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT {
			parts = append(parts, map[string]any{"type": "text", "text": part.GetText()})
			plain.WriteString(part.GetText())
			continue
		}
		if message.Role != "user" {
			return nil, deepseekUnsupported()
		}
		value, err := mimoMediaPart(part, planning)
		if err != nil {
			return nil, err
		}
		media = true
		parts = append(parts, value)
	}
	if !media {
		return plain.String(), nil
	}
	return parts, nil
}

func mimoMediaKind(mime string) string {
	switch mime {
	case "image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp":
		return "image"
	case "audio/mpeg", "audio/wav", "audio/flac", "audio/mp4", "audio/ogg":
		return "audio"
	case "video/mp4", "video/quicktime", "video/x-msvideo", "video/x-ms-wmv":
		return "video"
	default:
		return ""
	}
}

func mimoMediaPart(part *runtimev1.ChatContentPart, planning bool) (map[string]any, error) {
	kind, location := "", ""
	placeholder := planning && part.Type == runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_ARTIFACT_REF
	if placeholder {
		mime := part.GetArtifactRef().GetMimeType()
		kind, location = mimoMediaKind(mime), "data:"+mime+";base64,"
	} else {
		switch part.Type {
		case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL:
			if part.GetImageUrl().GetDetail() != "" && part.GetImageUrl().GetDetail() != "auto" {
				return nil, deepseekUnsupported()
			}
			kind, location = "image", part.GetImageUrl().GetUrl()
		case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_AUDIO_URL:
			kind, location = "audio", part.GetAudioUrl()
		case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_VIDEO_URL:
			kind, location = "video", part.GetVideoUrl()
		default:
			return nil, deepseekUnsupported()
		}
	}
	if kind == "" {
		return nil, deepseekUnsupported()
	}
	if strings.HasPrefix(location, "data:") {
		header, data, ok := strings.Cut(location, ",")
		mime := strings.TrimSuffix(strings.TrimPrefix(header, "data:"), ";base64")
		if !ok || !strings.HasSuffix(header, ";base64") || mimoMediaKind(mime) != kind {
			return nil, deepseekUnsupported()
		}
		if !placeholder {
			if data == "" || len(data) > 50_000_000 {
				return nil, deepseekJSONInputError("MiMo inline media exceeds 50 MB encoded limit")
			}
			decoded, err := base64.StdEncoding.Strict().DecodeString(data)
			if err != nil {
				return nil, deepseekJSONInputError("invalid MiMo inline media")
			}
			if kind == "image" {
				config, format, err := image.DecodeConfig(bytes.NewReader(decoded))
				if err != nil || mime != "image/"+format || config.Width <= 0 || config.Height <= 0 {
					return nil, deepseekJSONInputError("MiMo image content does not match its MIME type")
				}
			}
		}
	} else {
		u, err := url.Parse(location)
		if err != nil || len(location) > 8192 || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Fragment != "" {
			return nil, deepseekJSONInputError("MiMo media requires a public HTTPS URL")
		}
	}
	switch kind {
	case "image":
		return map[string]any{"type": "image_url", "image_url": map[string]string{"url": location}}, nil
	case "audio":
		return map[string]any{"type": "input_audio", "input_audio": map[string]string{"data": location}}, nil
	default:
		return map[string]any{"type": "video_url", "video_url": map[string]string{"url": location}}, nil
	}
}
