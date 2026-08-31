package realmrealtime

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func decodeStrictJSON(raw json.RawMessage, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return fmt.Errorf("unexpected trailing JSON content")
	}
	return nil
}

func parseWireTime(value string) (*timestamppb.Timestamp, error) {
	parsed, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(value))
	if err != nil {
		return nil, fmt.Errorf("invalid Realm timestamp")
	}
	return timestamppb.New(parsed.UTC()), nil
}

func convertWireChatEvent(input wireChatEvent) (*runtimev1.RealmChatDurableEvent, error) {
	occurredAt, err := parseWireTime(input.OccurredAt)
	if err != nil || strings.TrimSpace(input.StreamID) == "" || input.Seq == 0 || strings.TrimSpace(input.EventID) == "" || strings.TrimSpace(input.ChatID) == "" || strings.TrimSpace(input.ActorID) == "" {
		return nil, fmt.Errorf("invalid Realm Chat event identity")
	}
	result := &runtimev1.RealmChatDurableEvent{
		StreamId:   strings.TrimSpace(input.StreamID),
		Cursor:     input.Seq,
		EventId:    strings.TrimSpace(input.EventID),
		ChatId:     strings.TrimSpace(input.ChatID),
		ActorId:    strings.TrimSpace(input.ActorID),
		OccurredAt: occurredAt,
	}
	switch input.Kind {
	case "message.created", "message.edited":
		var payload wireMessageMutation
		if err := decodeStrictJSON(input.Payload, &payload); err != nil {
			return nil, fmt.Errorf("invalid Realm Chat message event")
		}
		message, err := convertWireMessage(payload.Message)
		if err != nil {
			return nil, err
		}
		mutation := &runtimev1.RealmChatMessageMutation{Message: message}
		if input.Kind == "message.created" {
			result.Event = &runtimev1.RealmChatDurableEvent_MessageCreated{MessageCreated: mutation}
		} else {
			result.Event = &runtimev1.RealmChatDurableEvent_MessageEdited{MessageEdited: mutation}
		}
	case "message.recalled":
		var payload wireMessageRecalled
		if err := decodeStrictJSON(input.Payload, &payload); err != nil {
			return nil, fmt.Errorf("invalid Realm Chat recall event")
		}
		recalledAt, err := parseWireTime(payload.RecalledAt)
		if err != nil || payload.ChatID != input.ChatID || strings.TrimSpace(payload.MessageID) == "" {
			return nil, fmt.Errorf("invalid Realm Chat recall payload")
		}
		result.Event = &runtimev1.RealmChatDurableEvent_MessageRecalled{MessageRecalled: &runtimev1.RealmChatMessageRecalled{
			ChatId: payload.ChatID, MessageId: strings.TrimSpace(payload.MessageID), RecalledAt: recalledAt,
		}}
	case "chat.read":
		var payload wireChatRead
		if err := decodeStrictJSON(input.Payload, &payload); err != nil {
			return nil, fmt.Errorf("invalid Realm Chat read event")
		}
		readAt, err := parseWireTime(payload.ReadAt)
		if err != nil || payload.ChatID != input.ChatID || strings.TrimSpace(payload.ReaderID) == "" {
			return nil, fmt.Errorf("invalid Realm Chat read payload")
		}
		readThrough := ""
		if payload.ReadThroughMessageID != nil {
			readThrough = strings.TrimSpace(*payload.ReadThroughMessageID)
		}
		result.Event = &runtimev1.RealmChatDurableEvent_ChatRead{ChatRead: &runtimev1.RealmChatRead{
			ChatId: payload.ChatID, ReaderId: strings.TrimSpace(payload.ReaderID), ReadThroughMessageId: readThrough, ReadAt: readAt,
		}}
	default:
		return nil, fmt.Errorf("unknown Realm Chat event kind")
	}
	return result, nil
}

func convertWireMessage(input wireChatMessage) (*runtimev1.RealmChatMessage, error) {
	createdAt, err := parseWireTime(input.CreatedAt)
	if err != nil || strings.TrimSpace(input.ID) == "" || strings.TrimSpace(input.ChatID) == "" || strings.TrimSpace(input.SenderID) == "" {
		return nil, fmt.Errorf("invalid Realm Chat message identity")
	}
	messageType, err := convertMessageType(input.Type)
	if err != nil {
		return nil, err
	}
	payload, err := convertMessagePayload(messageType, input.Payload)
	if err != nil {
		return nil, err
	}
	result := &runtimev1.RealmChatMessage{
		Id: input.ID, ChatId: input.ChatID, SenderId: input.SenderID,
		ClientMessageId: strings.TrimSpace(input.ClientMessageID), Type: messageType,
		Payload: payload, IsRead: input.IsRead, CreatedAt: createdAt,
	}
	if input.Text != nil {
		text := *input.Text
		result.Text = &text
	}
	if input.EditedAt != nil {
		editedAt, err := parseWireTime(*input.EditedAt)
		if err != nil {
			return nil, err
		}
		result.EditedAt = editedAt
	}
	if input.ReplyTo != nil {
		replyType, err := convertMessageType(input.ReplyTo.Type)
		if err != nil {
			return nil, err
		}
		replyPayload, err := convertMessagePayload(replyType, input.ReplyTo.Payload)
		if err != nil {
			return nil, err
		}
		result.ReplyTo = &runtimev1.RealmChatMessageReply{
			Id: input.ReplyTo.ID, SenderId: input.ReplyTo.SenderID, Type: replyType,
			Text: input.ReplyTo.Text, Payload: replyPayload,
		}
	}
	return result, nil
}

func convertMessageType(value string) (runtimev1.RealmChatMessageType, error) {
	switch value {
	case "TEXT":
		return runtimev1.RealmChatMessageType_REALM_CHAT_MESSAGE_TYPE_TEXT, nil
	case "ATTACHMENT":
		return runtimev1.RealmChatMessageType_REALM_CHAT_MESSAGE_TYPE_ATTACHMENT, nil
	case "POST_REF":
		return runtimev1.RealmChatMessageType_REALM_CHAT_MESSAGE_TYPE_POST_REF, nil
	case "USER_REF":
		return runtimev1.RealmChatMessageType_REALM_CHAT_MESSAGE_TYPE_USER_REF, nil
	case "LINK_REF":
		return runtimev1.RealmChatMessageType_REALM_CHAT_MESSAGE_TYPE_LINK_REF, nil
	case "FRIEND_REQUEST":
		return runtimev1.RealmChatMessageType_REALM_CHAT_MESSAGE_TYPE_FRIEND_REQUEST, nil
	case "SYSTEM":
		return runtimev1.RealmChatMessageType_REALM_CHAT_MESSAGE_TYPE_SYSTEM, nil
	case "RECALL":
		return runtimev1.RealmChatMessageType_REALM_CHAT_MESSAGE_TYPE_RECALL, nil
	default:
		return runtimev1.RealmChatMessageType_REALM_CHAT_MESSAGE_TYPE_UNSPECIFIED, fmt.Errorf("unknown Realm Chat message type")
	}
}

func convertMessagePayload(messageType runtimev1.RealmChatMessageType, raw json.RawMessage) (*runtimev1.RealmChatMessagePayload, error) {
	if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) || len(bytes.TrimSpace(raw)) == 0 {
		if messageType == runtimev1.RealmChatMessageType_REALM_CHAT_MESSAGE_TYPE_RECALL {
			return nil, nil
		}
		return nil, fmt.Errorf("Realm Chat message payload is required")
	}
	switch messageType {
	case runtimev1.RealmChatMessageType_REALM_CHAT_MESSAGE_TYPE_TEXT:
		var payload struct {
			Content string `json:"content"`
		}
		if err := decodeStrictJSON(raw, &payload); err != nil || payload.Content == "" {
			return nil, fmt.Errorf("invalid Realm Chat text payload")
		}
		return &runtimev1.RealmChatMessagePayload{Payload: &runtimev1.RealmChatMessagePayload_Text{Text: &runtimev1.RealmChatTextPayload{Content: payload.Content}}}, nil
	case runtimev1.RealmChatMessageType_REALM_CHAT_MESSAGE_TYPE_ATTACHMENT:
		var payload struct {
			Attachment wireAttachment `json:"attachment"`
		}
		if err := decodeStrictJSON(raw, &payload); err != nil {
			return nil, fmt.Errorf("invalid Realm Chat attachment payload")
		}
		attachment, err := convertAttachment(payload.Attachment)
		if err != nil {
			return nil, err
		}
		return &runtimev1.RealmChatMessagePayload{Payload: &runtimev1.RealmChatMessagePayload_Attachment{Attachment: attachment}}, nil
	case runtimev1.RealmChatMessageType_REALM_CHAT_MESSAGE_TYPE_POST_REF:
		var payload struct {
			PostID string `json:"postId"`
		}
		if err := decodeStrictJSON(raw, &payload); err != nil || strings.TrimSpace(payload.PostID) == "" {
			return nil, fmt.Errorf("invalid Realm Chat post reference")
		}
		return &runtimev1.RealmChatMessagePayload{Payload: &runtimev1.RealmChatMessagePayload_PostRef{PostRef: &runtimev1.RealmChatPostRefPayload{PostId: payload.PostID}}}, nil
	case runtimev1.RealmChatMessageType_REALM_CHAT_MESSAGE_TYPE_USER_REF:
		var payload wireUserRef
		if err := decodeStrictJSON(raw, &payload); err != nil || strings.TrimSpace(payload.UserID) == "" {
			return nil, fmt.Errorf("invalid Realm Chat user reference")
		}
		result := &runtimev1.RealmChatUserRefPayload{UserId: payload.UserID}
		if payload.Snapshot != nil {
			result.Snapshot = &runtimev1.RealmChatUserSnapshot{Id: payload.Snapshot.ID, Handle: payload.Snapshot.Handle, DisplayName: payload.Snapshot.DisplayName}
			if payload.Snapshot.AvatarURL != nil {
				result.Snapshot.AvatarUrl = *payload.Snapshot.AvatarURL
			}
		}
		return &runtimev1.RealmChatMessagePayload{Payload: &runtimev1.RealmChatMessagePayload_UserRef{UserRef: result}}, nil
	case runtimev1.RealmChatMessageType_REALM_CHAT_MESSAGE_TYPE_LINK_REF:
		var payload struct {
			URL   string `json:"url"`
			Title string `json:"title,omitempty"`
		}
		if err := decodeStrictJSON(raw, &payload); err != nil || strings.TrimSpace(payload.URL) == "" {
			return nil, fmt.Errorf("invalid Realm Chat link reference")
		}
		return &runtimev1.RealmChatMessagePayload{Payload: &runtimev1.RealmChatMessagePayload_LinkRef{LinkRef: &runtimev1.RealmChatLinkRefPayload{Url: payload.URL, Title: payload.Title}}}, nil
	case runtimev1.RealmChatMessageType_REALM_CHAT_MESSAGE_TYPE_FRIEND_REQUEST:
		var payload struct {
			RequestID      string `json:"requestId"`
			Status         string `json:"status"`
			RequestMessage string `json:"requestMessage,omitempty"`
		}
		if err := decodeStrictJSON(raw, &payload); err != nil || strings.TrimSpace(payload.RequestID) == "" || strings.TrimSpace(payload.Status) == "" {
			return nil, fmt.Errorf("invalid Realm Chat friend request")
		}
		return &runtimev1.RealmChatMessagePayload{Payload: &runtimev1.RealmChatMessagePayload_FriendRequest{FriendRequest: &runtimev1.RealmChatFriendRequestPayload{RequestId: payload.RequestID, Status: payload.Status, RequestMessage: payload.RequestMessage}}}, nil
	case runtimev1.RealmChatMessageType_REALM_CHAT_MESSAGE_TYPE_SYSTEM:
		var payload struct {
			Code    string `json:"code,omitempty"`
			Message string `json:"message,omitempty"`
		}
		if err := decodeStrictJSON(raw, &payload); err != nil {
			return nil, fmt.Errorf("invalid Realm Chat system payload")
		}
		return &runtimev1.RealmChatMessagePayload{Payload: &runtimev1.RealmChatMessagePayload_System{System: &runtimev1.RealmChatSystemPayload{Code: payload.Code, Message: payload.Message}}}, nil
	case runtimev1.RealmChatMessageType_REALM_CHAT_MESSAGE_TYPE_RECALL:
		return nil, fmt.Errorf("Realm Chat recall message payload must be null")
	default:
		return nil, fmt.Errorf("unknown Realm Chat message payload")
	}
}

type wireAttachment struct {
	TargetType  string          `json:"targetType"`
	TargetID    string          `json:"targetId"`
	DisplayKind string          `json:"displayKind,omitempty"`
	Title       string          `json:"title,omitempty"`
	Subtitle    string          `json:"subtitle,omitempty"`
	URL         string          `json:"url,omitempty"`
	Thumbnail   string          `json:"thumbnail,omitempty"`
	Width       int32           `json:"width,omitempty"`
	Height      int32           `json:"height,omitempty"`
	Duration    float64         `json:"duration,omitempty"`
	Preview     *wireAttachment `json:"preview,omitempty"`
}

type wireUserRef struct {
	UserID   string `json:"userId"`
	Snapshot *struct {
		ID          string  `json:"id,omitempty"`
		Handle      string  `json:"handle,omitempty"`
		DisplayName string  `json:"displayName,omitempty"`
		AvatarURL   *string `json:"avatarUrl,omitempty"`
	} `json:"snapshot,omitempty"`
}

func convertAttachment(input wireAttachment) (*runtimev1.RealmChatAttachmentPayload, error) {
	var targetType runtimev1.RealmAttachmentTargetType
	switch input.TargetType {
	case "RESOURCE":
		targetType = runtimev1.RealmAttachmentTargetType_REALM_ATTACHMENT_TARGET_TYPE_RESOURCE
	case "ASSET":
		targetType = runtimev1.RealmAttachmentTargetType_REALM_ATTACHMENT_TARGET_TYPE_ASSET
	case "BUNDLE":
		targetType = runtimev1.RealmAttachmentTargetType_REALM_ATTACHMENT_TARGET_TYPE_BUNDLE
	default:
		return nil, fmt.Errorf("unknown Realm attachment target type")
	}
	displayKind := runtimev1.RealmAttachmentDisplayKind_REALM_ATTACHMENT_DISPLAY_KIND_UNSPECIFIED
	switch input.DisplayKind {
	case "":
	case "IMAGE":
		displayKind = runtimev1.RealmAttachmentDisplayKind_REALM_ATTACHMENT_DISPLAY_KIND_IMAGE
	case "VIDEO":
		displayKind = runtimev1.RealmAttachmentDisplayKind_REALM_ATTACHMENT_DISPLAY_KIND_VIDEO
	case "AUDIO":
		displayKind = runtimev1.RealmAttachmentDisplayKind_REALM_ATTACHMENT_DISPLAY_KIND_AUDIO
	case "TEXT":
		displayKind = runtimev1.RealmAttachmentDisplayKind_REALM_ATTACHMENT_DISPLAY_KIND_TEXT
	case "CARD":
		displayKind = runtimev1.RealmAttachmentDisplayKind_REALM_ATTACHMENT_DISPLAY_KIND_CARD
	default:
		return nil, fmt.Errorf("unknown Realm attachment display kind")
	}
	if strings.TrimSpace(input.TargetID) == "" {
		return nil, fmt.Errorf("Realm attachment target is missing")
	}
	result := &runtimev1.RealmChatAttachmentPayload{
		TargetType: targetType, TargetId: input.TargetID, DisplayKind: displayKind,
		Title: input.Title, Subtitle: input.Subtitle, Url: input.URL, Thumbnail: input.Thumbnail,
		Width: input.Width, Height: input.Height, Duration: input.Duration,
	}
	if input.Preview != nil {
		preview, err := convertAttachment(*input.Preview)
		if err != nil {
			return nil, err
		}
		result.Preview = preview
	}
	return result, nil
}

func convertWireSnapshot(input wireChatSnapshotResult) (*runtimev1.RealmChatSnapshot, error) {
	if input.Mode != "full" || input.Snapshot == nil || strings.TrimSpace(input.Snapshot.Chat.ID) == "" || input.HighWatermarkSeq == 0 {
		return nil, fmt.Errorf("Realm Chat authoritative snapshot is invalid")
	}
	messages := make([]*runtimev1.RealmChatMessage, 0, len(input.Snapshot.Messages))
	for _, raw := range input.Snapshot.Messages {
		message, err := convertWireMessage(raw)
		if err != nil {
			return nil, err
		}
		messages = append(messages, message)
	}
	otherUser, err := convertWireChatUserSummary(input.Snapshot.Chat.OtherUser)
	if err != nil {
		return nil, err
	}
	return &runtimev1.RealmChatSnapshot{
		ChatId:    input.Snapshot.Chat.ID,
		OtherUser: otherUser,
		Messages:  messages, ThroughCursor: input.HighWatermarkSeq,
		UnreadCount: input.Snapshot.Chat.UnreadCount, AppliedAt: timestamppb.Now(),
	}, nil
}

func convertWireChatList(input wireChatListResult) (*runtimev1.ListRealmChatsResponse, error) {
	items := make([]*runtimev1.RealmChatListItem, 0, len(input.Items))
	for _, raw := range input.Items {
		chatID := strings.TrimSpace(raw.ID)
		createdAt, createdErr := parseWireTime(raw.CreatedAt)
		updatedAt, updatedErr := parseWireTime(raw.UpdatedAt)
		if chatID == "" || createdErr != nil || updatedErr != nil {
			return nil, fmt.Errorf("Realm Chat list item is invalid")
		}
		otherUser, err := convertWireChatUserSummary(raw.OtherUser)
		if err != nil {
			return nil, err
		}
		item := &runtimev1.RealmChatListItem{
			ChatId: chatID, OtherUser: otherUser, UnreadCount: raw.UnreadCount,
			CreatedAt: createdAt, UpdatedAt: updatedAt,
		}
		if raw.LastMessageAt != nil {
			lastMessageAt, err := parseWireTime(*raw.LastMessageAt)
			if err != nil {
				return nil, err
			}
			item.LastMessageAt = lastMessageAt
		}
		if raw.LastMessage != nil {
			message, err := convertWireMessage(*raw.LastMessage)
			if err != nil || message.GetChatId() != chatID {
				return nil, fmt.Errorf("Realm Chat list last message is invalid")
			}
			item.LastMessage = message
		}
		items = append(items, item)
	}
	nextCursor := ""
	if input.NextCursor != nil {
		nextCursor = strings.TrimSpace(*input.NextCursor)
		if nextCursor != *input.NextCursor {
			return nil, fmt.Errorf("Realm Chat list cursor is invalid")
		}
	}
	return &runtimev1.ListRealmChatsResponse{Items: items, NextCursor: nextCursor}, nil
}

func convertWireChatUserSummary(other wireChatUserSummary) (*runtimev1.RealmChatUserSummary, error) {
	if strings.TrimSpace(other.ID) == "" || strings.TrimSpace(other.Handle) == "" || strings.TrimSpace(other.DisplayName) == "" {
		return nil, fmt.Errorf("Realm Chat user summary is invalid")
	}
	createdAt, err := parseWireTime(other.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("Realm Chat user summary createdAt is invalid")
	}
	avatarURL := ""
	if other.AvatarURL != nil {
		avatarURL = *other.AvatarURL
	}
	presenceStatus, presenceText, presenceEmoji := "", "", ""
	if other.PresenceStatus != nil {
		presenceStatus = *other.PresenceStatus
	}
	if other.PresenceText != nil {
		presenceText = *other.PresenceText
	}
	if other.PresenceEmoji != nil {
		presenceEmoji = *other.PresenceEmoji
	}
	return &runtimev1.RealmChatUserSummary{
		Id: other.ID, Handle: other.Handle, DisplayName: other.DisplayName,
		AvatarUrl: avatarURL, Status: other.Status, PresenceStatus: presenceStatus,
		PresenceText: presenceText, PresenceEmoji: presenceEmoji, CreatedAt: createdAt,
	}, nil
}
