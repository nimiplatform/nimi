package capabilitydriver

import (
	"bytes"
	"encoding/base64"
	"image"
	"net/url"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func mistralMessageContent(message *runtimev1.ChatMessage, planning bool, count *int) (any, error) {
	if len(message.Parts) == 0 {
		return message.Content, nil
	}
	if message.Content != "" {
		return nil, deepseekJSONInputError("conflicting Mistral content")
	}
	var plain strings.Builder
	parts := []map[string]any{}
	media := false
	for _, part := range message.Parts {
		if part == nil {
			return nil, deepseekJSONInputError("empty Mistral part")
		}
		if part.Type == runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT {
			plain.WriteString(part.GetText())
			parts = append(parts, map[string]any{"type": "text", "text": part.GetText()})
			continue
		}
		if message.Role != "user" {
			return nil, deepseekUnsupported()
		}
		*count++
		if *count > 8 {
			return nil, deepseekJSONInputError("Mistral accepts at most eight images")
		}
		media = true
		location, detail := "", ""
		placeholder := planning && part.Type == runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_ARTIFACT_REF
		if placeholder {
			mime := part.GetArtifactRef().GetMimeType()
			if !mistralImageMIME(mime) {
				return nil, deepseekUnsupported()
			}
			location = "data:" + mime + ";base64,"
		} else {
			if part.Type != runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL {
				return nil, deepseekUnsupported()
			}
			location, detail = part.GetImageUrl().GetUrl(), part.GetImageUrl().GetDetail()
			if detail != "" && detail != "auto" && detail != "low" && detail != "high" {
				return nil, deepseekUnsupported()
			}
			if err := validateMistralImage(location); err != nil {
				return nil, err
			}
		}
		image := map[string]any{"url": location}
		if detail != "" {
			image["detail"] = detail
		}
		parts = append(parts, map[string]any{"type": "image_url", "image_url": image})
	}
	if !media {
		return plain.String(), nil
	}
	return parts, nil
}

func mistralImageMIME(mime string) bool {
	return mime == "image/png" || mime == "image/jpeg" || mime == "image/webp" || mime == "image/gif"
}

func validateMistralImage(location string) error {
	invalid := func() error { return deepseekJSONInputError("Mistral image format or 10 MB limit") }
	if !strings.HasPrefix(location, "data:") {
		u, err := url.Parse(location)
		if err != nil || len(location) > 8192 || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Fragment != "" {
			return invalid()
		}
		return nil
	}
	header, data, ok := strings.Cut(location, ",")
	mime := strings.TrimSuffix(strings.TrimPrefix(header, "data:"), ";base64")
	if !ok || !strings.HasSuffix(header, ";base64") || !mistralImageMIME(mime) || data == "" || len(data) > base64.StdEncoding.EncodedLen(10_000_000) {
		return invalid()
	}
	decoded, err := base64.StdEncoding.Strict().DecodeString(data)
	if err != nil || len(decoded) > 10_000_000 {
		return invalid()
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(decoded))
	if err != nil || config.Width <= 0 || config.Height <= 0 || mime != "image/"+format {
		return invalid()
	}
	if format == "gif" && !singleFrameGIF(decoded) {
		return invalid()
	}
	return nil
}
