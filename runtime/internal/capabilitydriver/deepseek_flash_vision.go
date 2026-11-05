package capabilitydriver

import (
	"bytes"
	"encoding/base64"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"net/url"
	"strings"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	_ "golang.org/x/image/webp"
)

const DeepseekFlashMaxRequestBytes = 48 << 20

// The exact DeepSeek adapter validates controls before projecting owned media.
func deepseekFlashMessages(spec *runtimev1.TextGenerateScenarioSpec, planning bool, replayKind string) ([]map[string]any, error) {
	count := 0
	for _, m := range spec.GetInput() {
		for _, p := range m.GetParts() {
			if p.GetType() == runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL || p.GetType() == runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_ARTIFACT_REF {
				count++
			}
		}
	}
	if count > 600 {
		return nil, deepseekJSONInputError("too many images")
	}
	side := 8192
	if count >= 15 {
		side = 4096
	}
	var inlineBytes int64
	project := func(m *runtimev1.ChatMessage) (any, error) {
		if len(m.GetParts()) == 0 {
			return m.GetContent(), nil
		}
		if m.GetContent() != "" {
			return nil, deepseekJSONInputError("conflicting content")
		}
		parts := make([]map[string]any, 0, len(m.GetParts()))
		var plain strings.Builder
		hasImage := false
		for _, part := range m.GetParts() {
			if part == nil {
				return nil, deepseekJSONInputError("empty content part")
			}
			if part.GetType() == runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT {
				parts = append(parts, map[string]any{"type": "text", "text": part.GetText()})
				plain.WriteString(part.GetText())
				continue
			}
			if m.GetRole() != "user" {
				return nil, deepseekUnsupported()
			}
			hasImage = true
			location, detail := "", ""
			if planning && part.GetType() == runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_ARTIFACT_REF {
				mime := part.GetArtifactRef().GetMimeType()
				if !deepseekImageMIME(mime) {
					return nil, deepseekUnsupported()
				}
				// This empty data string accounts only for native JSON overhead. It is
				// never dispatched; the owner materializes the authorized artifact next.
				location = "data:" + mime + ";base64,"
			} else {
				if part.GetType() != runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL {
					return nil, deepseekUnsupported()
				}
				location, detail = part.GetImageUrl().GetUrl(), part.GetImageUrl().GetDetail()
				size, err := validateDeepseekImageURL(location, side)
				if err != nil {
					return nil, err
				}
				inlineBytes += int64(size)
				if inlineBytes > 64<<20 {
					return nil, deepseekJSONInputError("image byte limit")
				}
			}
			if detail != "" && detail != "auto" && detail != "low" && detail != "high" && detail != "original" {
				return nil, deepseekUnsupported()
			}
			ref := map[string]any{"url": location}
			if detail != "" {
				ref["detail"] = detail
			}
			parts = append(parts, map[string]any{"type": "image_url", "image_url": ref})
		}
		if !hasImage {
			return plain.String(), nil
		}
		return parts, nil
	}
	return chatCompletionMessages(spec, project, replayKind)
}

func deepseekImageMIME(value string) bool {
	return value == "image/jpeg" || value == "image/png" || value == "image/gif" || value == "image/webp"
}

func validateDeepseekImageURL(location string, maxSide int) (int, error) {
	invalid := func() (int, error) { return 0, deepseekJSONInputError("unsupported image input") }
	if strings.HasPrefix(location, "data:") {
		fields := strings.SplitN(location, ",", 2)
		if len(fields) != 2 || !strings.HasSuffix(fields[0], ";base64") {
			return invalid()
		}
		mime := strings.TrimSuffix(strings.TrimPrefix(fields[0], "data:"), ";base64")
		if !deepseekImageMIME(mime) || len(fields[1]) > base64.StdEncoding.EncodedLen(32<<20) {
			return invalid()
		}
		decoded, err := base64.StdEncoding.DecodeString(fields[1])
		if err != nil || len(decoded) == 0 || len(decoded) > 32<<20 {
			return invalid()
		}
		// Header inspection bounds per-image geometry; preserve original image
		// bytes, including supported GIF/WebP content, for the native decoder.
		config, format, err := image.DecodeConfig(bytes.NewReader(decoded))
		if err != nil || "image/"+format != mime || config.Width <= 0 || config.Height <= 0 || config.Width > maxSide || config.Height > maxSide {
			return invalid()
		}
		return len(decoded), nil
	}
	parsed, err := url.Parse(location)
	if err != nil || !utf8.ValidString(location) || utf8.RuneCountInString(location) > 8192 || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil || parsed.Fragment != "" {
		return invalid()
	}
	// The provider fetches public URLs and enforces their decoded byte/dimension
	// limits. Runtime neither fetches these URLs nor upgrades to provider Files.
	return 0, nil
}
