package capabilitydriver

import (
	"bytes"
	"encoding/base64"
	"image"
	"net/url"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func (p VolcengineTextBehavior) messageContent(message *runtimev1.ChatMessage, planning bool) (any, error) {
	if len(message.GetParts()) == 0 {
		return message.GetContent(), nil
	}
	if message.GetContent() != "" {
		return nil, volcengineTextUnsupported("conflicting content representations")
	}
	parts := []map[string]any{}
	var plain strings.Builder
	media := false
	for _, part := range message.GetParts() {
		if part == nil {
			return nil, volcengineTextUnsupported("empty content part")
		}
		if part.GetType() == runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT {
			parts = append(parts, map[string]any{"type": "text", "text": part.GetText()})
			plain.WriteString(part.GetText())
			continue
		}
		if message.GetRole() != "user" {
			return nil, volcengineTextUnsupported("media role")
		}
		value, err := p.mediaPart(part, planning)
		if err != nil {
			return nil, err
		}
		parts = append(parts, value)
		media = true
	}
	if !media {
		return plain.String(), nil
	}
	return parts, nil
}

func volcengineMediaKind(mime string) string {
	switch mime {
	case "image/png", "image/jpeg", "image/webp":
		return "image"
	case "video/mp4":
		return "video"
	case "audio/wav", "audio/mpeg":
		return "audio"
	default:
		return ""
	}
}
func (p VolcengineTextBehavior) mediaPart(part *runtimev1.ChatContentPart, planning bool) (map[string]any, error) {
	kind, location, detail := "", "", ""
	placeholder := planning && part.GetType() == runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_ARTIFACT_REF
	if placeholder {
		ref := part.GetArtifactRef()
		if ref.GetArtifactId() == "" {
			return nil, volcengineTextUnsupported("owned media identity")
		}
		kind = volcengineMediaKind(ref.GetMimeType())
		location = "data:" + ref.GetMimeType() + ";base64,"
	} else {
		switch part.GetType() {
		case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL:
			kind, location, detail = "image", part.GetImageUrl().GetUrl(), part.GetImageUrl().GetDetail()
		case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_VIDEO_URL:
			kind, location = "video", part.GetVideoUrl()
		case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_AUDIO_URL:
			kind, location = "audio", part.GetAudioUrl()
		default:
			return nil, volcengineTextUnsupported("input media variant")
		}
	}
	if kind == "" || kind == "audio" && !p.Audio() || kind != "audio" && !p.Vision() {
		return nil, volcengineTextUnsupported("input modality is unavailable on this exact model")
	}
	if detail != "" && (!contains([]string{"low", "high", "xhigh"}, detail) && !(p.deepseek41() && detail == "auto") || !p.deepseek41() && !strings.HasPrefix(p.model, "doubao-seed-2-") && p.model != "doubao-seed-evolving") {
		return nil, volcengineTextUnsupported("image detail")
	}
	mime, encoded := "", ""
	inline := strings.HasPrefix(location, "data:")
	if inline {
		header, data, ok := strings.Cut(location, ",")
		mime = strings.TrimSuffix(strings.TrimPrefix(header, "data:"), ";base64")
		encoded = data
		if !ok || !strings.HasSuffix(header, ";base64") || volcengineMediaKind(mime) != kind {
			return nil, volcengineTextUnsupported("media MIME and source disagree")
		}
		if !placeholder {
			if len(encoded) > volcengineTextBodyLimit {
				return nil, volcengineTextUnsupported("inline media envelope")
			}
			decoded, err := base64.StdEncoding.Strict().DecodeString(encoded)
			if err != nil || len(decoded) == 0 {
				return nil, volcengineTextUnsupported("inline media encoding")
			}
			limit := 50_000_000
			if kind == "audio" {
				limit = 25_000_000
			}
			if kind == "image" && !p.deepseek41() {
				limit = 10_000_000
			}
			if len(decoded) > limit || len(decoded) == limit && (kind == "video" || kind == "image" && !p.deepseek41()) {
				return nil, volcengineTextUnsupported("native media byte limit")
			}
			if kind == "image" {
				geometry, format, err := image.DecodeConfig(bytes.NewReader(decoded))
				if err != nil || geometry.Width <= 0 || geometry.Height <= 0 || mime != "image/"+format {
					return nil, volcengineTextUnsupported("image content and MIME disagree")
				}
				if !p.deepseek41() && (int64(geometry.Width)*int64(geometry.Height) < 196 || int64(geometry.Width)*int64(geometry.Height) > 36_000_000) {
					return nil, volcengineTextUnsupported("image pixel bounds")
				}
			}
		}
	} else {
		if p.model == "kimi-k3-1-pro-261024" {
			return nil, volcengineTextUnsupported("this Kimi target requires Base64 media")
		}
		u, err := url.Parse(location)
		if err != nil || len(location) > 8192 || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Fragment != "" {
			return nil, volcengineTextUnsupported("public HTTPS media URL required")
		}
	}
	switch kind {
	case "image":
		value := map[string]any{"url": location}
		if detail != "" {
			value["detail"] = detail
		}
		return map[string]any{"type": "image_url", "image_url": value}, nil
	case "video":
		return map[string]any{"type": "video_url", "video_url": map[string]string{"url": location}}, nil
	default:
		value := map[string]string{"url": location}
		if inline {
			value = map[string]string{"data": encoded, "format": map[string]string{"audio/wav": "wav", "audio/mpeg": "mp3"}[mime]}
		}
		return map[string]any{"type": "input_audio", "input_audio": value}, nil
	}
}
