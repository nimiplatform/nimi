package capabilitydriver

import (
	"bytes"
	"encoding/base64"
	"image"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func ownedChatRasterContent(m *runtimev1.ChatMessage, planning, vision bool, byteLimit int, unsupported func(string) error) (any, error) {
	if len(m.GetParts()) == 0 {
		return m.GetContent(), nil
	}
	if m.GetContent() != "" {
		return nil, unsupported("conflicting text representations")
	}
	parts := []map[string]any{}
	for _, part := range m.GetParts() {
		if part == nil {
			return nil, unsupported("empty content part")
		}
		if part.GetType() == runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT {
			parts = append(parts, map[string]any{"type": "text", "text": part.GetText()})
			continue
		}
		if !vision || m.GetRole() != "user" {
			return nil, unsupported("image model or role")
		}
		location := ""
		if planning && part.GetType() == runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_ARTIFACT_REF {
			r := part.GetArtifactRef()
			if r.GetArtifactId() == "" || r.GetMimeType() != "image/png" && r.GetMimeType() != "image/jpeg" {
				return nil, unsupported("owned PNG/JPEG required")
			}
			location = "data:" + r.GetMimeType() + ";base64,"
		} else {
			if part.GetType() != runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL || part.GetImageUrl().GetDetail() != "" {
				return nil, unsupported("input modality or image detail")
			}
			location = part.GetImageUrl().GetUrl()
			header, encoded, ok := strings.Cut(location, ",")
			if !ok || header != "data:image/png;base64" && header != "data:image/jpeg;base64" || len(encoded) > byteLimit {
				return nil, unsupported("complete owned PNG/JPEG required")
			}
			data, err := base64.StdEncoding.Strict().DecodeString(encoded)
			if err != nil || len(data) == 0 {
				return nil, unsupported("image encoding")
			}
			g, format, err := image.DecodeConfig(bytes.NewReader(data))
			if err != nil || g.Width <= 0 || g.Height <= 0 || header != "data:image/"+format+";base64" {
				return nil, unsupported("image encoding")
			}
		}
		parts = append(parts, map[string]any{"type": "image_url", "image_url": map[string]string{"url": location}})
	}
	return parts, nil
}
