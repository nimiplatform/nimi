package integration

import (
	"encoding/json"
	"strings"
	"unicode/utf8"
)

type feishuPost struct {
	Title   string `json:"title"`
	Content [][]struct {
		Tag      string `json:"tag"`
		Text     string `json:"text"`
		UserID   string `json:"user_id"`
		UserName string `json:"user_name"`
		ImageKey string `json:"image_key"`
	} `json:"content"`
}

// Rich-text messages normalize the declared text, mention and image segments;
// they do not introduce a new public operation or arbitrary message renderer.
func feishuPostSegments(content string, reply nativeSource, mentions map[string]feishuMention) ([]map[string]any, map[int]nativeSource, error) {
	var post feishuPost
	if json.Unmarshal([]byte(content), &post) != nil {
		return nil, nil, adapterError("INTEGRATION_FEISHU_EVENT_INVALID")
	}
	if post.Content == nil {
		var localized map[string]json.RawMessage
		if json.Unmarshal([]byte(content), &localized) != nil {
			return nil, nil, adapterError("INTEGRATION_FEISHU_EVENT_INVALID")
		}
		body := localized["zh_cn"]
		if body == nil {
			body = localized["en_us"]
		}
		if body == nil || json.Unmarshal(body, &post) != nil || post.Content == nil {
			return nil, nil, adapterError("INTEGRATION_FEISHU_EVENT_INVALID")
		}
	}
	segments := []map[string]any{}
	sources := map[int]nativeSource{}
	appendText := func(text string) error {
		if utf8.RuneCountInString(text) > 32768 {
			return adapterError("INTEGRATION_EVENT_BOUNDS")
		}
		if len(segments) > 0 && segments[len(segments)-1]["kind"] == "text" {
			joined := segments[len(segments)-1]["text"].(string) + text
			if utf8.RuneCountInString(joined) > 32768 {
				return adapterError("INTEGRATION_EVENT_BOUNDS")
			}
			segments[len(segments)-1]["text"] = joined
		} else {
			segments = append(segments, map[string]any{"kind": "text", "text": text})
		}
		return nil
	}
	if post.Title != "" {
		if err := appendText(post.Title + "\n"); err != nil {
			return nil, nil, err
		}
	}
	if len(post.Content) > 64 {
		return nil, nil, adapterError("INTEGRATION_EVENT_BOUNDS")
	}
	items := 0
	for rowIndex, row := range post.Content {
		if rowIndex > 0 {
			if err := appendText("\n"); err != nil {
				return nil, nil, err
			}
		}
		for _, item := range row {
			items++
			if items > 64 || len(segments) >= 64 {
				return nil, nil, adapterError("INTEGRATION_EVENT_BOUNDS")
			}
			switch item.Tag {
			case "text", "a":
				if err := appendText(item.Text); err != nil {
					return nil, nil, err
				}
			case "at":
				if mention, ok := mentions[item.UserID]; ok {
					item.UserID, item.UserName = mention.ID.OpenID, mention.Name
				} else if strings.HasPrefix(item.UserID, "@_user_") {
					return nil, nil, adapterError("INTEGRATION_FEISHU_EVENT_INVALID")
				}
				if !validExternalIdentifier(item.UserID) || len(item.UserName) > 256 {
					return nil, nil, adapterError("INTEGRATION_FEISHU_EVENT_INVALID")
				}
				segments = append(segments, map[string]any{"kind": "mention", "id": item.UserID, "displayName": item.UserName})
			case "img":
				if !validExternalIdentifier(item.ImageKey) {
					return nil, nil, adapterError("INTEGRATION_FEISHU_EVENT_INVALID")
				}
				source := reply
				source.MediaKind = "image"
				source.Media = json.RawMessage(schemaJSON(map[string]string{"key": item.ImageKey, "type": "image"}))
				sources[len(segments)] = source
				segments = append(segments, map[string]any{"kind": "image", "mediaRef": "", "fileName": "", "mediaType": "application/octet-stream", "sizeBytes": 0})
			default:
				return nil, nil, adapterError("INTEGRATION_FEISHU_MESSAGE_KIND_UNSUPPORTED")
			}
		}
	}
	return segments, sources, nil
}
