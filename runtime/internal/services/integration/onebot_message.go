package integration

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"
	"time"
)

type onebotSegment struct {
	Type string                     `json:"type"`
	Data map[string]json.RawMessage `json:"data"`
}

func onebotValue(raw json.RawMessage) string {
	var text string
	if json.Unmarshal(raw, &text) == nil {
		return text
	}
	var number json.Number
	if json.Unmarshal(raw, &number) == nil {
		return number.String()
	}
	return ""
}
func onebotUnescape(raw string, parameter bool) string {
	if parameter {
		raw = strings.ReplaceAll(raw, "&#44;", ",")
	}
	raw = strings.ReplaceAll(raw, "&#91;", "[")
	raw = strings.ReplaceAll(raw, "&#93;", "]")
	return strings.ReplaceAll(raw, "&amp;", "&")
}
func onebotSegments(raw json.RawMessage) ([]onebotSegment, error) {
	if len(raw) > nativeEventLimit {
		return nil, adapterError("INTEGRATION_EVENT_BOUNDS")
	}
	var result []onebotSegment
	if len(raw) > 0 && raw[0] == '[' {
		if json.Unmarshal(raw, &result) != nil || len(result) > 64 {
			return nil, adapterError("INTEGRATION_ONEBOT_EVENT_INVALID")
		}
		return result, nil
	}
	var text string
	if json.Unmarshal(raw, &text) != nil {
		return nil, adapterError("INTEGRATION_ONEBOT_EVENT_INVALID")
	}
	appendText := func(text string) {
		if text != "" {
			result = append(result, onebotSegment{Type: "text", Data: map[string]json.RawMessage{"text": json.RawMessage(schemaJSON(onebotUnescape(text, false)))}})
		}
	}
	for text != "" {
		index := strings.Index(text, "[CQ:")
		if index < 0 {
			appendText(text)
			break
		}
		appendText(text[:index])
		text = text[index+4:]
		end := strings.IndexByte(text, ']')
		if end < 0 || end > 8192 {
			return nil, adapterError("INTEGRATION_ONEBOT_EVENT_INVALID")
		}
		parts := strings.Split(text[:end], ",")
		segment := onebotSegment{Type: parts[0], Data: map[string]json.RawMessage{}}
		for _, part := range parts[1:] {
			key, value, ok := strings.Cut(part, "=")
			if !ok || key == "" || len(key) > 128 {
				return nil, adapterError("INTEGRATION_ONEBOT_EVENT_INVALID")
			}
			if _, present := segment.Data[key]; present {
				return nil, adapterError("INTEGRATION_ONEBOT_EVENT_INVALID")
			}
			segment.Data[key] = json.RawMessage(schemaJSON(onebotUnescape(value, true)))
		}
		result = append(result, segment)
		if len(result) > 64 {
			return nil, adapterError("INTEGRATION_EVENT_BOUNDS")
		}
		text = text[end+1:]
	}
	return result, nil
}

// @nimi-authority: definition.nimi.runtime.integration.native-operation-contract
func acceptOnebotMessage(ctx context.Context, f *nativeFeed, self string, data []byte) error {
	var value struct {
		Post    string          `json:"post_type"`
		Self    json.Number     `json:"self_id"`
		Type    string          `json:"message_type"`
		ID      json.Number     `json:"message_id"`
		User    json.Number     `json:"user_id"`
		Group   json.Number     `json:"group_id"`
		Time    json.Number     `json:"time"`
		Message json.RawMessage `json:"message"`
		Sender  struct {
			Nickname string `json:"nickname"`
			Card     string `json:"card"`
		} `json:"sender"`
	}
	if len(data) > 1024*1024 || json.Unmarshal(data, &value) != nil {
		return adapterError("INTEGRATION_ONEBOT_EVENT_INVALID")
	}
	if value.Self.String() != self {
		return adapterError("INTEGRATION_ONEBOT_IDENTITY_INVALID")
	}
	if value.Post != "message" {
		return nil
	}
	messageID := value.ID.String()
	if _, err := strconv.ParseInt(messageID, 10, 32); err != nil {
		return adapterError("INTEGRATION_ONEBOT_EVENT_INVALID")
	}
	user := value.User.String()
	if _, err := onebotNumericID(user); err != nil {
		return err
	}
	conversation := nativeConversation{Kind: value.Type, ID: user}
	if value.Type == "group" {
		conversation.ID = value.Group.String()
		if _, err := onebotNumericID(conversation.ID); err != nil {
			return err
		}
	} else if value.Type != "private" {
		return adapterError("INTEGRATION_ONEBOT_EVENT_INVALID")
	}
	segments, err := onebotSegments(value.Message)
	if err != nil {
		return err
	}
	event := nativeMessage{EventID: messageID, MessageID: messageID, SenderID: user, Conversation: conversation, Segments: []map[string]any{}}
	if seconds, err := strconv.ParseInt(value.Time.String(), 10, 64); err == nil && seconds > 0 && seconds < 253402300800 {
		event.PlatformTime = time.Unix(seconds, 0).UTC().Format(time.RFC3339)
	}
	sources := map[int]nativeSource{}
	for _, segment := range segments {
		switch segment.Type {
		case "text":
			text := onebotValue(segment.Data["text"])
			event.Segments = append(event.Segments, map[string]any{"kind": "text", "text": text})
		case "at":
			id := onebotValue(segment.Data["qq"])
			if id != "all" {
				if _, err := onebotNumericID(id); err != nil {
					return err
				}
			}
			event.Segments = append(event.Segments, map[string]any{"kind": "mention", "id": id, "displayName": ""})
		case "reply":
			id := onebotValue(segment.Data["id"])
			if _, err := strconv.ParseInt(id, 10, 32); err != nil {
				return adapterError("INTEGRATION_ONEBOT_EVENT_INVALID")
			}
			event.References = append(event.References, nativeReference{MessageID: id, ContentStatus: "not-provided"})
		case "file":
			return adapterError("INTEGRATION_ONEBOT_FILE_IMPLEMENTATION_REQUIRED")
		case "image", "record", "video":
			kind := segment.Type
			if kind == "record" {
				kind = "audio"
			}
			remote := onebotValue(segment.Data["url"])
			file := onebotValue(segment.Data["file"])
			if len(remote) > 8192 || len(file) > 8192 {
				return adapterError("INTEGRATION_EVENT_BOUNDS")
			}
			index := len(event.Segments)
			event.Segments = append(event.Segments, map[string]any{"kind": kind, "mediaRef": "", "fileName": "", "mediaType": "", "sizeBytes": 0})
			sources[index] = nativeSource{Conversation: conversation, MessageID: messageID, Context: remote, MediaKind: kind, Media: json.RawMessage(schemaJSON(map[string]string{"file": file}))}
		default:
			return adapterError("INTEGRATION_ONEBOT_SEGMENT_UNAVAILABLE")
		}
	}
	if len(event.Segments) > 64 || len(event.References) > 64 {
		return adapterError("INTEGRATION_EVENT_BOUNDS")
	}
	return f.acceptMessage(ctx, event, sources, nativeSource{Conversation: conversation, MessageID: messageID}, event.EventID)
}
