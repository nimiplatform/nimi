package capabilitydriver

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"image"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func (p GroqTextBehavior) content(m *runtimev1.ChatMessage, planning bool, images *int) (any, error) {
	if len(m.GetParts()) == 0 {
		return m.GetContent(), nil
	}
	if m.GetContent() != "" {
		return nil, groqUnsupported("conflicting text representations")
	}
	parts := []map[string]any{}
	for _, part := range m.GetParts() {
		if part == nil {
			return nil, groqUnsupported("empty content part")
		}
		if part.GetType() == runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT {
			parts = append(parts, map[string]any{"type": "text", "text": part.GetText()})
			continue
		}
		*images++
		if m.GetRole() != "user" || *images > p.maxImages {
			return nil, groqUnsupported("image count or message role")
		}
		url := ""
		if planning && part.GetType() == runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_ARTIFACT_REF {
			ref := part.GetArtifactRef()
			if ref.GetArtifactId() == "" || (ref.GetMimeType() != "image/png" && ref.GetMimeType() != "image/jpeg") {
				return nil, groqUnsupported("owned PNG or JPEG image required")
			}
			url = "data:" + ref.GetMimeType() + ";base64,"
		} else {
			if part.GetType() != runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL || part.GetImageUrl().GetDetail() != "" {
				return nil, groqUnsupported("image type or detail control")
			}
			url = part.GetImageUrl().GetUrl()
			header, encoded, ok := strings.Cut(url, ",")
			mime := strings.TrimSuffix(strings.TrimPrefix(header, "data:"), ";base64")
			if !ok || !strings.HasPrefix(header, "data:") || !strings.HasSuffix(header, ";base64") || (mime != "image/png" && mime != "image/jpeg") || len(encoded) > groqTextBodyBytes {
				return nil, groqUnsupported("complete owned PNG or JPEG image required")
			}
			data, err := base64.StdEncoding.Strict().DecodeString(encoded)
			if err != nil || len(data) == 0 {
				return nil, groqUnsupported("invalid image encoding")
			}
			geometry, format, err := image.DecodeConfig(bytes.NewReader(data))
			if err != nil || geometry.Width <= 0 || geometry.Height <= 0 || mime != "image/"+format {
				return nil, groqUnsupported("invalid image header")
			}
		}
		parts = append(parts, map[string]any{"type": "image_url", "image_url": map[string]string{"url": url}})
	}
	return parts, nil
}

// Groq's published strict subset is closed, required objects, basic typed
// values, enums, local definitions/references and unions. Unreviewed constraints
// are not weakened or silently discarded. The caller schema also checks output.
func validateGroqStrictSchema(schema map[string]any) error {
	for key, value := range schema {
		switch key {
		case "$schema", "title", "description", "type", "enum", "required", "$ref":
		case "additionalProperties":
			if value != false {
				return groqUnsupported("strict objects must be closed")
			}
		case "properties", "$defs":
			children, ok := value.(map[string]any)
			if !ok {
				return groqUnsupported("schema children")
			}
			for _, child := range children {
				node, ok := child.(map[string]any)
				if !ok {
					return groqUnsupported("boolean schema")
				}
				if err := validateGroqStrictSchema(node); err != nil {
					return err
				}
			}
		case "items":
			node, ok := value.(map[string]any)
			if !ok {
				return groqUnsupported("tuple or boolean schema")
			}
			if err := validateGroqStrictSchema(node); err != nil {
				return err
			}
		case "anyOf":
			nodes, ok := value.([]any)
			if !ok {
				return groqUnsupported("schema alternatives")
			}
			for _, child := range nodes {
				node, ok := child.(map[string]any)
				if !ok {
					return groqUnsupported("schema alternative")
				}
				if err := validateGroqStrictSchema(node); err != nil {
					return err
				}
			}
		default:
			return groqUnsupported("unreviewed strict schema keyword " + key)
		}
	}
	object := schema["type"] == "object"
	if types, ok := schema["type"].([]any); ok {
		for _, t := range types {
			object = object || t == "object"
		}
	}
	properties, hasProperties := schema["properties"].(map[string]any)
	if object || hasProperties {
		required, _ := schema["required"].([]any)
		names := map[string]bool{}
		for _, name := range required {
			if s, ok := name.(string); ok {
				names[s] = true
			}
		}
		if schema["additionalProperties"] != false || len(names) != len(properties) {
			return groqUnsupported("strict object properties must all be required")
		}
		for name := range properties {
			if !names[name] {
				return groqUnsupported("optional strict property")
			}
		}
	}
	return nil
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r088
// x_groq.usage is Groq's documented streaming usage carrier. The nonstream
// x_groq metadata has a different meaning and is never treated as token usage.
func (p GroqTextBehavior) nativeEnvelope(payload []byte, stream, seenModel bool) ([]byte, bool, error) {
	var wire map[string]json.RawMessage
	if json.Unmarshal(payload, &wire) != nil || wire == nil {
		return nil, seenModel, groqInvalid("JSON envelope")
	}
	var model string
	if value := wire["model"]; len(value) > 0 && string(value) != "null" {
		if json.Unmarshal(value, &model) != nil || model != p.model {
			return nil, seenModel, groqInvalid("unexpected model identity")
		}
		seenModel = true
	}
	if !seenModel {
		return nil, false, groqInvalid("missing model identity")
	}
	var choices []struct {
		FinishReason string `json:"finish_reason"`
		Message      *struct {
			ToolCalls []json.RawMessage `json:"tool_calls"`
		} `json:"message"`
		Delta *struct {
			ToolCalls []struct {
				Index *int `json:"index"`
			} `json:"tool_calls"`
		} `json:"delta"`
	}
	if json.Unmarshal(wire["choices"], &choices) != nil {
		return nil, seenModel, groqInvalid("choices")
	}
	for _, choice := range choices {
		if choice.FinishReason == "length" {
			return nil, seenModel, deepseekIncomplete()
		}
		if !p.ParallelTools() {
			if choice.Message != nil && len(choice.Message.ToolCalls) > 1 {
				return nil, seenModel, groqInvalid("GPT-OSS returned parallel calls")
			}
			if choice.Delta != nil {
				if len(choice.Delta.ToolCalls) > 1 {
					return nil, seenModel, groqInvalid("GPT-OSS returned parallel calls")
				}
				for _, call := range choice.Delta.ToolCalls {
					if call.Index != nil && *call.Index != 0 {
						return nil, seenModel, groqInvalid("GPT-OSS returned a second call")
					}
				}
			}
		}
	}
	if stream && len(wire["x_groq"]) > 0 && string(wire["x_groq"]) != "null" {
		var metadata struct {
			Error *string         `json:"error"`
			Usage json.RawMessage `json:"usage"`
		}
		if json.Unmarshal(wire["x_groq"], &metadata) != nil {
			return nil, seenModel, groqInvalid("stream metadata")
		}
		if metadata.Error != nil && *metadata.Error != "" {
			return nil, seenModel, groqInvalid("provider stopped the stream with an error")
		}
		if len(metadata.Usage) > 0 && string(metadata.Usage) != "null" {
			if value := wire["usage"]; len(value) > 0 && string(value) != "null" {
				type counts struct {
					Prompt     *int64 `json:"prompt_tokens"`
					Completion *int64 `json:"completion_tokens"`
				}
				var direct, native counts
				if json.Unmarshal(value, &direct) != nil || json.Unmarshal(metadata.Usage, &native) != nil {
					return nil, seenModel, groqInvalid("usage")
				}
				if direct.Prompt != nil && native.Prompt != nil && *direct.Prompt != *native.Prompt || direct.Completion != nil && native.Completion != nil && *direct.Completion != *native.Completion {
					return nil, seenModel, groqInvalid("conflicting usage reports")
				}
			} else {
				wire["usage"] = metadata.Usage
			}
		}
	}
	clean, err := json.Marshal(wire)
	return clean, seenModel, err
}
