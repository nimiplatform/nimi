package capabilitydriver

import (
	"bytes"
	"encoding/base64"
	"image"
	"net/url"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func (p StepFunTextBehavior) messageContent(m *runtimev1.ChatMessage, planning bool, images, videos *int) (any, error) {
	if len(m.Parts) == 0 {
		return m.Content, nil
	}
	if m.Content != "" {
		return nil, deepseekJSONInputError("conflicting StepFun content")
	}
	parts := []map[string]any{}
	var plain strings.Builder
	media := false
	for _, part := range m.Parts {
		if part == nil {
			return nil, deepseekJSONInputError("empty StepFun part")
		}
		if part.Type == runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT {
			plain.WriteString(part.GetText())
			parts = append(parts, map[string]any{"type": "text", "text": part.GetText()})
			continue
		}
		if !p.vision || m.Role != "user" {
			return nil, deepseekUnsupported()
		}
		kind, location, detail := "", "", ""
		placeholder := planning && part.Type == runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_ARTIFACT_REF
		if placeholder {
			mime := part.GetArtifactRef().GetMimeType()
			kind = stepfunMediaKind(mime)
			location = "data:" + mime + ";base64,"
		} else {
			switch part.Type {
			case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL:
				kind, location, detail = "image", part.GetImageUrl().GetUrl(), part.GetImageUrl().GetDetail()
			case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_VIDEO_URL:
				kind, location = "video", part.GetVideoUrl()
			default:
				return nil, deepseekUnsupported()
			}
		}
		if kind == "" || detail != "" && detail != "low" && detail != "high" {
			return nil, deepseekUnsupported()
		}
		if kind == "image" {
			*images++
			if *images > 60 {
				return nil, deepseekJSONInputError("StepFun accepts at most 60 images")
			}
		} else {
			*videos++
			if *videos > 1 {
				return nil, deepseekJSONInputError("StepFun accepts one video")
			}
		}
		if !placeholder {
			if err := validateStepfunMedia(location, kind); err != nil {
				return nil, err
			}
		}
		value := map[string]any{"url": location}
		if detail != "" {
			value["detail"] = detail
		}
		parts = append(parts, map[string]any{"type": kind + "_url", kind + "_url": value})
		media = true
	}
	if !media {
		return plain.String(), nil
	}
	return parts, nil
}

func stepfunMediaKind(mime string) string {
	switch mime {
	case "image/png", "image/jpeg", "image/webp", "image/gif":
		return "image"
	case "video/mp4", "video/quicktime", "video/x-matroska":
		return "video"
	}
	return ""
}

func validateStepfunMedia(location, kind string) error {
	invalid := func() error { return deepseekJSONInputError("StepFun media format or Runtime byte limit") }
	if !strings.HasPrefix(location, "data:") {
		u, err := url.Parse(location)
		if err != nil || len(location) > 8192 || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Fragment != "" {
			return invalid()
		}
		return nil
	}
	header, data, ok := strings.Cut(location, ",")
	mime := strings.TrimSuffix(strings.TrimPrefix(header, "data:"), ";base64")
	if !ok || !strings.HasSuffix(header, ";base64") || stepfunMediaKind(mime) != kind || data == "" || len(data) > base64.StdEncoding.EncodedLen(32<<20) {
		return invalid()
	}
	decoded, err := base64.StdEncoding.Strict().DecodeString(data)
	if err != nil || len(decoded) > 32<<20 {
		return invalid()
	}
	if kind == "image" {
		config, format, err := image.DecodeConfig(bytes.NewReader(decoded))
		if err != nil || config.Width <= 0 || config.Height <= 0 || mime != "image/"+format {
			return invalid()
		}
		if format == "gif" && !singleFrameGIF(decoded) {
			return invalid()
		}
	}
	return nil
}
