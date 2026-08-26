package realmrealtime

import "encoding/json"

type wireOperationResult struct {
	Status     string `json:"status"`
	SessionID  string `json:"sessionId,omitempty"`
	ReasonCode string `json:"reasonCode,omitempty"`
	ActionHint string `json:"actionHint,omitempty"`
	TraceID    string `json:"traceId,omitempty"`
}

type wireChatReady struct {
	ChatID               string `json:"chatId"`
	SessionID            string `json:"sessionId"`
	ResumeToken          string `json:"resumeToken"`
	LastAckSeq           uint64 `json:"lastAckSeq"`
	HighWatermarkSeq     uint64 `json:"highWatermarkSeq"`
	ReplayWindowStartSeq uint64 `json:"replayWindowStartSeq"`
}

type wireChatSyncRequired struct {
	ChatID               string `json:"chatId"`
	SessionID            string `json:"sessionId"`
	ResumeToken          string `json:"resumeToken"`
	RequestedAfterSeq    uint64 `json:"requestedAfterSeq"`
	ReplayWindowStartSeq uint64 `json:"replayWindowStartSeq"`
	ReasonCode           string `json:"reasonCode"`
	ActionHint           string `json:"actionHint"`
}

type wireChatEvent struct {
	StreamID       string          `json:"streamId"`
	SubscriptionID string          `json:"subscriptionId"`
	Seq            uint64          `json:"seq"`
	EventID        string          `json:"eventId"`
	ChatID         string          `json:"chatId"`
	Kind           string          `json:"kind"`
	OccurredAt     string          `json:"occurredAt"`
	ActorID        string          `json:"actorId"`
	Payload        json.RawMessage `json:"payload"`
}

type wireChatTyping struct {
	ChatID         string `json:"chatId"`
	SubscriptionID string `json:"subscriptionId"`
	UserID         string `json:"userId"`
	IsTyping       bool   `json:"isTyping"`
	ExpiresAt      string `json:"expiresAt"`
}

type wirePresence struct {
	UserID           string `json:"userId"`
	IsOnline         bool   `json:"isOnline"`
	PresenceRevision uint64 `json:"presenceRevision"`
	OccurredAt       string `json:"occurredAt"`
}

type wireChatInbox struct {
	SubscriptionID   string `json:"subscriptionId"`
	ChatID           string `json:"chatId"`
	HighWatermarkSeq uint64 `json:"highWatermarkSeq"`
	OccurredAt       string `json:"occurredAt"`
}

type wireChatMessage struct {
	ID              string          `json:"id"`
	ChatID          string          `json:"chatId"`
	SenderID        string          `json:"senderId"`
	ClientMessageID string          `json:"clientMessageId,omitempty"`
	Type            string          `json:"type"`
	Text            *string         `json:"text"`
	Payload         json.RawMessage `json:"payload"`
	IsRead          bool            `json:"isRead"`
	ReplyTo         *wireChatReply  `json:"replyTo,omitempty"`
	CreatedAt       string          `json:"createdAt"`
	EditedAt        *string         `json:"editedAt"`
}

type wireChatReply struct {
	ID       string          `json:"id"`
	SenderID string          `json:"senderId"`
	Type     string          `json:"type"`
	Text     string          `json:"text"`
	Payload  json.RawMessage `json:"payload"`
}

type wireChatUserSummary struct {
	ID              string          `json:"id"`
	Handle          string          `json:"handle"`
	DisplayName     string          `json:"displayName"`
	AvatarURL       *string         `json:"avatarUrl,omitempty"`
	Bio             *string         `json:"bio,omitempty"`
	Status          string          `json:"status,omitempty"`
	CreatedAt       string          `json:"createdAt"`
	FriendCount     *int            `json:"friendCount,omitempty"`
	IsOnline        *bool           `json:"isOnline,omitempty"`
	PresenceStatus  *string         `json:"presenceStatus,omitempty"`
	PresenceText    *string         `json:"presenceText,omitempty"`
	PresenceEmoji   *string         `json:"presenceEmoji,omitempty"`
	ProfileCoverURL *string         `json:"profileCoverUrl,omitempty"`
	Tiers           json.RawMessage `json:"tiers,omitempty"`
}

type wireChatListResult struct {
	Items []struct {
		ID            string              `json:"id"`
		CreatedAt     string              `json:"createdAt"`
		UpdatedAt     string              `json:"updatedAt"`
		LastMessageAt *string             `json:"lastMessageAt"`
		UnreadCount   uint32              `json:"unreadCount"`
		OtherUser     wireChatUserSummary `json:"otherUser"`
		LastMessage   *wireChatMessage    `json:"lastMessage"`
	} `json:"items"`
	NextCursor *string `json:"nextCursor"`
}

type wireMessageMutation struct {
	Message wireChatMessage `json:"message"`
}

type wireMessageRecalled struct {
	ChatID     string `json:"chatId"`
	MessageID  string `json:"messageId"`
	RecalledAt string `json:"recalledAt"`
}

type wireChatRead struct {
	ChatID               string  `json:"chatId"`
	ReaderID             string  `json:"readerId"`
	ReadThroughMessageID *string `json:"readThroughMessageId"`
	ReadAt               string  `json:"readAt"`
}

type wireChatSnapshotResult struct {
	Mode             string          `json:"mode"`
	HighWatermarkSeq uint64          `json:"highWatermarkSeq"`
	Events           []wireChatEvent `json:"events"`
	Snapshot         *struct {
		Chat struct {
			ID            string              `json:"id"`
			CreatedAt     string              `json:"createdAt"`
			UpdatedAt     string              `json:"updatedAt"`
			LastMessageAt *string             `json:"lastMessageAt"`
			UnreadCount   uint32              `json:"unreadCount"`
			LastMessage   *wireChatMessage    `json:"lastMessage"`
			OtherUser     wireChatUserSummary `json:"otherUser"`
		} `json:"chat"`
		Messages []wireChatMessage `json:"messages"`
	} `json:"snapshot,omitempty"`
}
