package integration

import (
	"context"
	"encoding/json"
	"time"

	"github.com/oklog/ulid/v2"
)

type nativeConversation struct {
	Kind string `json:"kind"`
	ID   string `json:"id"`
}

// Private source material never enters the public normalized event or call input.
// Its lifetime and bound are exactly those of the associated buffered event.
type nativeSource struct {
	Conversation                                       nativeConversation
	MessageID, Context, MediaKind, FileName, MediaType string
	SizeBytes                                          int64
	Media                                              json.RawMessage
	QQReplies                                          *qqReplyState `json:"-"`
	ExpiresAt                                          time.Time
}
type nativeMessage struct {
	EventID      string             `json:"eventId"`
	Conversation nativeConversation `json:"conversation"`
	MessageID    string             `json:"messageId"`
	SenderID     string             `json:"senderId"`
	Segments     []map[string]any   `json:"segments"`
	ReplyRef     string             `json:"replyRef"`
	PlatformTime string             `json:"platformTime"`
	ReceivedAt   string             `json:"receivedAt"`
	References   []nativeReference  `json:"references,omitempty"`
}

// @nimi-authority: rule.nimi.runtime.integration.native-messaging
func (f *nativeFeed) acceptMessage(ctx context.Context, event nativeMessage, sources map[int]nativeSource, reply nativeSource, dedupKey string) error {
	mediaCount := 0
	for _, segment := range event.Segments {
		if kind := segment["kind"]; kind == "image" || kind == "file" || kind == "audio" || kind == "video" {
			mediaCount++
		}
	}
	for _, reference := range event.References {
		mediaCount += len(reference.Media)
	}
	if mediaCount > 64 {
		return adapterError("INTEGRATION_EVENT_BOUNDS")
	}
	refs := map[string]nativeSource{}
	event.ReplyRef = "isrc_" + ulid.Make().String()
	refs[event.ReplyRef] = reply
	for index, source := range sources {
		if index < 0 || index >= len(event.Segments) {
			return adapterError("INTEGRATION_EVENT_INVALID")
		}
		if source.MediaKind == "" || source.MediaKind != event.Segments[index]["kind"] || source.Conversation != event.Conversation {
			return adapterError("INTEGRATION_EVENT_INVALID")
		}
		id := "isrc_" + ulid.Make().String()
		event.Segments[index]["mediaRef"] = id
		refs[id] = source
	}
	for referenceIndex := range event.References {
		for mediaIndex := range event.References[referenceIndex].Media {
			media := &event.References[referenceIndex].Media[mediaIndex]
			if media.MediaRef != "" {
				return adapterError("INTEGRATION_EVENT_INVALID")
			}
			if media.Source == nil {
				continue
			}
			if media.Source.MediaKind != media.Kind || media.Source.Conversation != event.Conversation || media.UnavailableReason != "" {
				return adapterError("INTEGRATION_EVENT_INVALID")
			}
			media.MediaRef = "isrc_" + ulid.Make().String()
			refs[media.MediaRef] = *media.Source
			media.Source = nil
		}
	}
	private, err := json.Marshal(refs)
	if err != nil || len(private) > nativeEventLimit || len(refs) > 65 {
		return adapterError("INTEGRATION_EVENT_BOUNDS")
	}
	event.ReceivedAt = time.Now().UTC().Format(time.RFC3339Nano)
	data, err := json.Marshal(event)
	if err != nil {
		return err
	}
	value, err := decodeJSON(string(data), nativeEventLimit)
	if err != nil {
		return adapterError("INTEGRATION_EVENT_BOUNDS")
	}
	if err := validateSchema(schemaJSON(nativeEventSchema()), value); err != nil {
		return adapterError("INTEGRATION_EVENT_INVALID")
	}
	return f.accept(ctx, dedupKey, event.Conversation.Kind+":"+event.Conversation.ID, data, refs)
}

// @nimi-authority: rule.nimi.runtime.integration.media-handoff
// A source capability has exactly one purpose. Reference media does not carry
// a native original message ID, and cannot acquire the current reply context.
func (s *Service) nativeSourceFor(t target, id string, media bool) (nativeSource, error) {
	source, err := s.nativeSource(t, id)
	if err != nil {
		return nativeSource{}, err
	}
	if (source.MediaKind != "") != media {
		return nativeSource{}, adapterError("INTEGRATION_SOURCE_INVALID")
	}
	return source, nil
}

func (s *Service) nativeSource(t target, id string) (nativeSource, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r := s.nativeReceivers[t.Public.TargetRef]
	if r == nil || r.generation != t.CredentialGeneration || s.removing[t.Public.TargetRef] {
		return nativeSource{}, adapterError("INTEGRATION_SOURCE_EXPIRED")
	}
	r.feed.mu.Lock()
	defer r.feed.mu.Unlock()
	r.feed.pruneLocked(time.Now())
	for _, event := range r.feed.events {
		if source, ok := event.sources[id]; ok {
			return source, nil
		}
	}
	return nativeSource{}, adapterError("INTEGRATION_SOURCE_EXPIRED")
}

type nativeBody struct {
	Kind     string        `json:"kind"`
	Text     string        `json:"text"`
	CardJSON string        `json:"cardJson"`
	FileName string        `json:"fileName"`
	Asset    outboundAsset `json:"asset"`
}
type nativeMessageInput struct {
	Conversation nativeConversation `json:"conversation"`
	Body         nativeBody         `json:"body"`
	ReplyRef     string             `json:"replyRef"`
	ContextRef   string             `json:"contextRef"`
	MessageID    string             `json:"messageId"`
	MediaRef     string             `json:"mediaRef"`
	RelativePath string             `json:"relativePath"`
}
