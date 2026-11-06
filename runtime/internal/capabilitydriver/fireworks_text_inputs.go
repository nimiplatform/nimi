package capabilitydriver

import (
	"bytes"
	"encoding/base64"
	"image"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func (p FireworksTextBehavior) content(m *runtimev1.ChatMessage, planning bool, images, encodedBytes *int) (any, error) {
	if len(m.GetParts()) == 0 {
		return m.GetContent(), nil
	}
	if m.GetContent() != "" {
		return nil, fireworksUnsupported("conflicting text representations")
	}
	parts := []map[string]any{}
	for _, part := range m.GetParts() {
		if part == nil {
			return nil, fireworksUnsupported("empty content part")
		}
		if part.GetType() == runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT {
			parts = append(parts, map[string]any{"type": "text", "text": part.GetText()})
			continue
		}
		*images++
		if !p.Vision() || m.GetRole() != "user" || *images > 120 {
			return nil, fireworksUnsupported("image model, role or count")
		}
		location := ""
		if planning && part.GetType() == runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_ARTIFACT_REF {
			ref := part.GetArtifactRef()
			if ref.GetArtifactId() == "" || ref.GetMimeType() != "image/png" && ref.GetMimeType() != "image/jpeg" {
				return nil, fireworksUnsupported("owned PNG/JPEG image required")
			}
			location = "data:" + ref.GetMimeType() + ";base64,"
		} else {
			if part.GetType() != runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL || part.GetImageUrl().GetDetail() != "" {
				return nil, fireworksUnsupported("image type or detail")
			}
			location = part.GetImageUrl().GetUrl()
			header, encoded, ok := strings.Cut(location, ",")
			if !ok || header != "data:image/png;base64" && header != "data:image/jpeg;base64" {
				return nil, fireworksUnsupported("complete owned PNG/JPEG bytes required")
			}
			*encodedBytes += len(encoded)
			if *encodedBytes >= fireworksEncodedImageBytes {
				return nil, fireworksUnsupported("aggregate base64 images must be below 10 MB")
			}
			data, err := base64.StdEncoding.Strict().DecodeString(encoded)
			if err != nil || len(data) == 0 {
				return nil, fireworksUnsupported("image base64")
			}
			g, format, err := image.DecodeConfig(bytes.NewReader(data))
			if err != nil || g.Width <= 0 || g.Height <= 0 || header != "data:image/"+format+";base64" {
				return nil, fireworksUnsupported("image encoding")
			}
		}
		parts = append(parts, map[string]any{"type": "image_url", "image_url": map[string]string{"url": location}})
	}
	return parts, nil
}

// Fireworks closes objects implicitly and may ignore regexes. Admit only an
// explicit closed-object subset, without changing the caller's schema. Nested
// definitions are excluded because the native shorthand lifts them globally.
func validateFireworksSchema(schema map[string]any, root bool) error {
	for key, value := range schema {
		switch key {
		case "$schema", "title", "description", "type", "enum", "required", "minLength", "maxLength", "minItems", "maxItems":
		case "$ref":
			ref, ok := value.(string)
			if !ok || !strings.HasPrefix(ref, "#/") {
				return fireworksUnsupported("external or non-pointer schema reference")
			}
		case "additionalProperties":
			if value != false {
				return fireworksUnsupported("open structured object")
			}
		case "properties", "$defs":
			if key == "$defs" && !root {
				return fireworksUnsupported("nested schema definitions")
			}
			children, ok := value.(map[string]any)
			if !ok {
				return fireworksUnsupported("schema children")
			}
			for _, child := range children {
				node, ok := child.(map[string]any)
				if !ok {
					return fireworksUnsupported("boolean schema")
				}
				if err := validateFireworksSchema(node, false); err != nil {
					return err
				}
			}
		case "items":
			node, ok := value.(map[string]any)
			if !ok {
				return fireworksUnsupported("tuple schema")
			}
			if err := validateFireworksSchema(node, false); err != nil {
				return err
			}
		case "anyOf", "allOf", "oneOf":
			children, ok := value.([]any)
			if !ok {
				return fireworksUnsupported("schema alternatives")
			}
			for _, child := range children {
				node, ok := child.(map[string]any)
				if !ok {
					return fireworksUnsupported("schema alternative")
				}
				if err := validateFireworksSchema(node, false); err != nil {
					return err
				}
			}
		default:
			return fireworksUnsupported("unreviewed or best-effort schema keyword " + key)
		}
	}
	if _, ok := schema["properties"]; ok && schema["additionalProperties"] != false {
		return fireworksUnsupported("implicit native object closure")
	}
	return nil
}
