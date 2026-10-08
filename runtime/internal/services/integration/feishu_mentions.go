package integration

import (
	"strings"
	"unicode/utf8"
)

type feishuMention struct {
	Key string `json:"key"`
	ID  struct {
		OpenID string `json:"open_id"`
	} `json:"id"`
	Name string `json:"name"`
}

// Keys identify positions in the supplied message, never new public identities.
// The bounded index also resolves a rich-text at by its actual open_id.
func feishuMentionIndex(values []feishuMention) (map[string]feishuMention, error) {
	if len(values) > 63 {
		return nil, adapterError("INTEGRATION_EVENT_BOUNDS")
	}
	index := map[string]feishuMention{}
	for _, value := range values {
		if !validExternalIdentifier(value.ID.OpenID) || len(value.Name) > 256 || len(value.Key) > 256 || !utf8.ValidString(value.Key) || strings.ContainsAny(value.Key, "\x00\r\n") {
			return nil, adapterError("INTEGRATION_FEISHU_EVENT_INVALID")
		}
		for _, key := range []string{value.Key, value.ID.OpenID} {
			if key == "" {
				continue
			}
			if previous, ok := index[key]; ok && (previous.ID.OpenID != value.ID.OpenID || previous.Name != value.Name) {
				return nil, adapterError("INTEGRATION_FEISHU_EVENT_INVALID")
			}
			index[key] = value
		}
	}
	return index, nil
}

func feishuTextSegments(text string, mentions map[string]feishuMention) ([]map[string]any, error) {
	if utf8.RuneCountInString(text) > 32768 {
		return nil, adapterError("INTEGRATION_EVENT_BOUNDS")
	}
	segments := []map[string]any{}
	for text != "" {
		position, key := -1, ""
		for candidate, mention := range mentions {
			if candidate != mention.Key || candidate == "" {
				continue
			}
			for offset := 0; offset < len(text); {
				i := strings.Index(text[offset:], candidate)
				if i < 0 {
					break
				}
				i += offset
				end := i + len(candidate)
				// @_user_1 must not consume an unmapped @_user_10.
				if end < len(text) && candidate[len(candidate)-1] >= '0' && candidate[len(candidate)-1] <= '9' && text[end] >= '0' && text[end] <= '9' {
					offset = i + 1
					continue
				}
				if position < 0 || i < position || (i == position && len(candidate) > len(key)) {
					position, key = i, candidate
				}
				break
			}
		}
		if position < 0 {
			segments = append(segments, map[string]any{"kind": "text", "text": text})
			break
		}
		if position > 0 {
			segments = append(segments, map[string]any{"kind": "text", "text": text[:position]})
		}
		mention := mentions[key]
		segments = append(segments, map[string]any{"kind": "mention", "id": mention.ID.OpenID, "displayName": mention.Name})
		if len(segments) > 64 {
			return nil, adapterError("INTEGRATION_EVENT_BOUNDS")
		}
		text = text[position+len(key):]
	}
	if len(segments) > 64 {
		return nil, adapterError("INTEGRATION_EVENT_BOUNDS")
	}
	if len(segments) == 0 {
		segments = append(segments, map[string]any{"kind": "text", "text": ""})
	}
	return segments, nil
}
