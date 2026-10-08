package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gorilla/websocket"
)

type qqFrame struct {
	Op       int             `json:"op"`
	Data     json.RawMessage `json:"d"`
	Sequence *int64          `json:"s"`
	Type     string          `json:"t"`
}

// Rejections expose only finite classifications, never provider values or
// decoder errors (which can contain values from the rejected frame).
func (s *Service) logQQFrameRejection(stage string, data []byte, decodeErr error, hello, ready, resumeRequested, awaitingACK bool) {
	var fields struct {
		Op       json.RawMessage `json:"op"`
		Sequence json.RawMessage `json:"s"`
		Type     json.RawMessage `json:"t"`
	}
	_ = json.Unmarshal(data, &fields)
	opcode := "other"
	var op int
	switch {
	case len(fields.Op) == 0:
		opcode = "absent"
	case bytes.Equal(bytes.TrimSpace(fields.Op), []byte("null")):
		opcode = "null"
	case json.Unmarshal(fields.Op, &op) != nil:
		opcode = "wrong_type"
	default:
		switch op {
		case 0:
			opcode = "dispatch"
		case 1:
			opcode = "heartbeat"
		case 2:
			opcode = "identify"
		case 6:
			opcode = "resume"
		case 7:
			opcode = "reconnect"
		case 9:
			opcode = "invalid_session"
		case 10:
			opcode = "hello"
		case 11:
			opcode = "heartbeat_ack"
		}
	}
	eventType := "other"
	var event string
	if json.Unmarshal(fields.Type, &event) == nil {
		switch event {
		case "READY", "RESUMED", "C2C_MESSAGE_CREATE", "GROUP_AT_MESSAGE_CREATE", "GROUP_MESSAGE_CREATE":
			eventType = event
		}
	}
	sequenceState := "absent"
	var sequence int64
	if len(fields.Sequence) > 0 {
		switch {
		case bytes.Equal(bytes.TrimSpace(fields.Sequence), []byte("null")):
			sequenceState = "null"
		case json.Unmarshal(fields.Sequence, &sequence) != nil:
			sequenceState = "wrong_type"
		case sequence < 0:
			sequenceState = "negative"
		default:
			sequenceState = "nonnegative"
		}
	}
	decodeClass := "none"
	if decodeErr != nil {
		var syntax *json.SyntaxError
		var mismatch *json.UnmarshalTypeError
		switch {
		case errors.As(decodeErr, &syntax):
			decodeClass = "syntax"
		case errors.As(decodeErr, &mismatch):
			decodeClass = "type"
		default:
			decodeClass = "other"
		}
	}
	s.logger.Info("QQ WebSocket frame rejected", "stage", stage, "opcode", opcode, "event_type", eventType,
		"sequence_state", sequenceState, "hello", hello, "ready", ready, "resume_requested", resumeRequested,
		"ack_pending", awaitingACK, "frame_bytes", len(data), "json_error", decodeClass)
}

type qqAttachment struct {
	Type string `json:"content_type"`
	URL  string `json:"url"`
	Name string `json:"filename"`
	Size int64  `json:"size"`
	ASR  string `json:"asr_refer_text"`
}

// @nimi-authority: rule.nimi.runtime.integration.media-handoff
// Inspect only the first supplied quote. URL policy acceptance is local parsing,
// not a download, a media capability or evidence that the source is still valid.
func (s *Service) logQQQuotedFileSources(eventType string, data []byte) {
	var quote struct {
		MessageType int `json:"message_type"`
		Elements    []struct {
			Attachments []qqAttachment `json:"attachments"`
		} `json:"msg_elements"`
	}
	if len(data) > 1024*1024 || json.Unmarshal(data, &quote) != nil || quote.MessageType != 103 || len(quote.Elements) == 0 || len(quote.Elements) > 64 || len(quote.Elements[0].Attachments) > 64 {
		return
	}
	eventClass := "other"
	switch eventType {
	case "C2C_MESSAGE_CREATE", "GROUP_AT_MESSAGE_CREATE", "GROUP_MESSAGE_CREATE":
		eventClass = eventType
	}
	attachments := quote.Elements[0].Attachments
	files, sources, accepted := 0, 0, 0
	for _, attachment := range attachments {
		if strings.HasPrefix(attachment.Type, "image/") || strings.HasPrefix(attachment.Type, "audio/") || strings.HasPrefix(attachment.Type, "video/") {
			continue
		}
		files++
		if strings.TrimSpace(attachment.URL) == "" {
			continue
		}
		sources++
		// Reuse the exact production location guard. Its rejection diagnostics
		// also expose only fixed classes; no provider value is logged.
		if _, err := s.nativeCDNURL(attachment.URL); err == nil {
			accepted++
		}
	}
	s.logger.Info("QQ quoted file sources classified", "stage", "first_reference", "event_type", eventClass,
		"attachment_count", len(attachments), "file_attachment_count", files,
		"file_source_count", sources, "file_source_policy_accepted_count", accepted,
		"has_file_source", sources > 0, "has_policy_accepted_file_source", accepted > 0)
}

type qqMention struct {
	ID       string `json:"id"`
	User     string `json:"user_openid"`
	Member   string `json:"member_openid"`
	Name     string `json:"nickname"`
	Username string `json:"username"`
}

func qqTextSegments(text string, mentions []qqMention) ([]map[string]any, error) {
	if len(mentions) > 64 || utf8.RuneCountInString(text) > 32768 {
		return nil, adapterError("INTEGRATION_EVENT_BOUNDS")
	}
	index := map[string]map[string]any{}
	for _, mention := range mentions {
		id := mention.Member
		if id == "" {
			id = mention.User
		}
		if id == "" {
			id = mention.ID
		}
		name := mention.Name
		if name == "" {
			name = mention.Username
		}
		if !validExternalIdentifier(id) || len(name) > 256 {
			return nil, adapterError("INTEGRATION_QQ_EVENT_INVALID")
		}
		for _, tokenID := range []string{mention.ID, mention.User, mention.Member} {
			if tokenID == "" {
				continue
			}
			for _, token := range []string{"<@" + tokenID + ">", "<@!" + tokenID + ">"} {
				if previous, ok := index[token]; ok && previous["id"] != id {
					return nil, adapterError("INTEGRATION_QQ_EVENT_INVALID")
				}
				index[token] = map[string]any{"kind": "mention", "id": id, "displayName": name}
			}
		}
	}
	result := []map[string]any{}
	for text != "" {
		position, key := -1, ""
		for candidate := range index {
			at := strings.Index(text, candidate)
			if at >= 0 && (position < 0 || at < position) {
				position, key = at, candidate
			}
		}
		if position < 0 {
			result = append(result, map[string]any{"kind": "text", "text": text})
			break
		}
		if position > 0 {
			result = append(result, map[string]any{"kind": "text", "text": text[:position]})
		}
		result = append(result, index[key])
		if len(result) > 64 {
			return nil, adapterError("INTEGRATION_EVENT_BOUNDS")
		}
		text = text[position+len(key):]
	}
	if len(result) > 64 {
		return nil, adapterError("INTEGRATION_EVENT_BOUNDS")
	}
	return result, nil
}

// @nimi-authority: rule.nimi.runtime.integration.native-messaging
func (s *Service) receiveQQ(ctx context.Context, t target, secret string, f *nativeFeed) error {
	if err := s.admitNativeReception(f); err != nil {
		return err
	}
	token, err := s.qqToken(ctx, t.Config.QqOfficial.AppId, secret)
	if err != nil {
		return err
	}
	if err = s.admitNativeReception(f); err != nil {
		return err
	}
	endpoint, err := s.qqGateway(ctx, token)
	if err != nil {
		return err
	}
	if err = s.admitNativeReception(f); err != nil {
		return err
	}
	dialer := *websocket.DefaultDialer
	dialer.HandshakeTimeout = 10 * time.Second
	conn, response, err := dialer.DialContext(ctx, endpoint, http.Header{})
	if response != nil && response.Body != nil {
		response.Body.Close()
	}
	if err != nil {
		return adapterError("INTEGRATION_QQ_GATEWAY_FAILED")
	}
	defer conn.Close()
	return s.consumeQQ(ctx, conn, token, f)
}
func (s *Service) consumeQQ(ctx context.Context, conn *websocket.Conn, token string, f *nativeFeed) error {
	conn.SetReadLimit(1024 * 1024)
	conn.SetReadDeadline(time.Now().Add(15 * time.Second))
	readCtx, readCancel := context.WithCancel(ctx)
	type incoming struct {
		data    []byte
		err     error
		nonText bool
	}
	frames := make(chan incoming)
	readerDone := make(chan struct{})
	go func() {
		defer close(readerDone)
		for {
			kind, data, err := conn.ReadMessage()
			nonText := err == nil && kind != websocket.TextMessage
			if nonText {
				err = adapterError("INTEGRATION_QQ_FRAME_INVALID")
			}
			select {
			case frames <- incoming{data, err, nonText}:
			case <-readCtx.Done():
				return
			}
			if err != nil {
				return
			}
		}
	}()
	stopped := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			conn.Close()
		case <-stopped:
		}
	}()
	// Closing the socket and signaling the reader prevents a blocked delivery
	// goroutine surviving a protocol failure while its parent context is live.
	defer func() { readCancel(); close(stopped); conn.Close(); <-readerDone }()
	var ticker *time.Ticker
	var tick <-chan time.Time
	var heartbeatInterval time.Duration
	hello, ready, awaitingACK := false, false, false
	resumeRequested := false
	defer func() {
		if ticker != nil {
			ticker.Stop()
		}
	}()
	write := func(value any) error {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
		if conn.WriteJSON(value) != nil {
			return adapterError("INTEGRATION_QQ_GATEWAY_FAILED")
		}
		return nil
	}
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-tick:
			if awaitingACK {
				return adapterError("INTEGRATION_QQ_HEARTBEAT_ACK_MISSING")
			}
			f.mu.Lock()
			var seq any
			if f.qqHasSequence {
				seq = f.qqSequence
			}
			f.mu.Unlock()
			if err := write(map[string]any{"op": 1, "d": seq}); err != nil {
				return err
			}
			awaitingACK = true
		case incoming := <-frames:
			if incoming.nonText {
				s.logQQFrameRejection("non_text_frame", incoming.data, nil, hello, ready, resumeRequested, awaitingACK)
			}
			if incoming.err != nil {
				if errors.Is(incoming.err, websocket.ErrReadLimit) {
					return adapterError("INTEGRATION_QQ_FRAME_BOUNDS")
				}
				if websocket.IsCloseError(incoming.err, 4006, 4007, 4009) {
					f.mu.Lock()
					f.qqSession = ""
					f.qqHasSequence = false
					f.mu.Unlock()
				}
				return adapterError("INTEGRATION_QQ_GATEWAY_CLOSED")
			}
			var frame qqFrame
			reject := func(stage string, decodeErr error) error {
				s.logQQFrameRejection(stage, incoming.data, decodeErr, hello, ready, resumeRequested, awaitingACK)
				return adapterError("INTEGRATION_QQ_FRAME_INVALID")
			}
			if err := json.Unmarshal(incoming.data, &frame); err != nil {
				return reject("frame_decode", err)
			}
			switch frame.Op {
			case 10:
				if hello {
					return reject("duplicate_hello", nil)
				}
				var value struct {
					Interval int64 `json:"heartbeat_interval"`
				}
				if json.Unmarshal(frame.Data, &value) != nil || value.Interval < 1000 || value.Interval > 300000 {
					return adapterError("INTEGRATION_QQ_HELLO_INVALID")
				}
				hello = true
				f.mu.Lock()
				session, sequence, has := f.qqSession, f.qqSequence, f.qqHasSequence
				f.mu.Unlock()
				payload := map[string]any{"op": 2, "d": map[string]any{"token": "QQBot " + token, "intents": 1 << 25, "shard": []int{0, 1}}}
				if session != "" && has {
					resumeRequested = true
					payload = map[string]any{"op": 6, "d": map[string]any{"token": "QQBot " + token, "session_id": session, "seq": sequence}}
				}
				if err := s.admitNativeReception(f); err != nil {
					return err
				}
				if err := write(payload); err != nil {
					return err
				}
				interval := time.Duration(value.Interval) * time.Millisecond
				heartbeatInterval = interval
				conn.SetReadDeadline(time.Now().Add(interval*2 + 5*time.Second))
				ticker = time.NewTicker(interval)
				tick = ticker.C
			case 11:
				if !hello {
					return reject("ack_before_hello", nil)
				}
				awaitingACK = false
				conn.SetReadDeadline(time.Now().Add(heartbeatInterval*2 + 5*time.Second))
			case 7:
				return adapterError("INTEGRATION_QQ_RECONNECT_REQUIRED")
			case 9:
				var resumable bool
				if json.Unmarshal(frame.Data, &resumable) != nil || !resumable {
					f.mu.Lock()
					f.qqSession = ""
					f.qqHasSequence = false
					f.mu.Unlock()
				}
				return adapterError("INTEGRATION_QQ_SESSION_INVALID")
			case 0:
				if !hello {
					return reject("dispatch_before_hello", nil)
				}
				if frame.Sequence == nil || *frame.Sequence < 0 {
					return reject("dispatch_sequence_invalid", nil)
				}
				switch frame.Type {
				case "READY":
					var value struct {
						Session string `json:"session_id"`
						User    struct {
							ID string `json:"id"`
						} `json:"user"`
					}
					if json.Unmarshal(frame.Data, &value) != nil || !validExternalIdentifier(value.Session) || !validExternalIdentifier(value.User.ID) {
						return adapterError("INTEGRATION_QQ_IDENTITY_INVALID")
					}
					if err := s.admitNativeReception(f); err != nil {
						return err
					}
					f.mu.Lock()
					f.qqSession = value.Session
					f.mu.Unlock()
					ready = true
				case "RESUMED":
					if !resumeRequested {
						return reject("unexpected_resumed", nil)
					}
					// Resume notifications can repeat after this socket is ready.
					// They confirm readiness without publishing a message.
					ready = true
				case "C2C_MESSAGE_CREATE", "GROUP_AT_MESSAGE_CREATE", "GROUP_MESSAGE_CREATE":
					// A resumed session can replay messages before RESUMED. Keep
					// the initial Identify gate and let only RESUMED mark readiness.
					if !ready && !resumeRequested {
						return reject("message_before_ready", nil)
					}
					if err := s.acceptQQMessage(ctx, f, frame.Type, frame.Data); err != nil {
						return err
					}
					s.logQQQuotedFileSources(frame.Type, frame.Data)
				case "GROUP_ADD_ROBOT", "GROUP_DEL_ROBOT", "GROUP_MSG_REJECT", "GROUP_MSG_RECEIVE",
					"FRIEND_ADD", "FRIEND_DEL", "C2C_MSG_REJECT", "C2C_MSG_RECEIVE":
					// Subscribed Group/C2C lifecycle dispatches can also precede
					// RESUMED. They advance protocol sequence, never emit messages.
					if !ready {
						if !resumeRequested {
							return reject("other_dispatch_before_ready", nil)
						}
						if err := s.admitNativeReception(f); err != nil {
							return err
						}
					}
				default:
					if !ready {
						return reject("other_dispatch_before_ready", nil)
					}
				}
				// Message sequence advances only after actual fenced feed insertion.
				f.mu.Lock()
				f.qqSequence = *frame.Sequence
				f.qqHasSequence = true
				f.mu.Unlock()
			case 1:
				if !hello {
					return reject("heartbeat_before_hello", nil)
				}
				f.mu.Lock()
				var sequence any
				if f.qqHasSequence {
					sequence = f.qqSequence
				}
				f.mu.Unlock()
				if err := write(map[string]any{"op": 1, "d": sequence}); err != nil {
					return err
				}
			default:
				return reject("unsupported_opcode", nil)
			}
		}
	}
}
func (s *Service) acceptQQMessage(ctx context.Context, f *nativeFeed, eventType string, data []byte) error {
	var value struct {
		ID        string `json:"id"`
		Content   string `json:"content"`
		Timestamp string `json:"timestamp"`
		Group     string `json:"group_openid"`
		Author    struct {
			User   string `json:"user_openid"`
			Member string `json:"member_openid"`
		} `json:"author"`
		Attachments []qqAttachment `json:"attachments"`
		Mentions    []qqMention    `json:"mentions"`
		Elements    []struct {
			Index       string         `json:"msg_idx"`
			Content     string         `json:"content"`
			Attachments []qqAttachment `json:"attachments"`
		} `json:"msg_elements"`
		MessageType int `json:"message_type"`
	}
	if len(data) > 1024*1024 || json.Unmarshal(data, &value) != nil || !validExternalIdentifier(value.ID) || utf8.RuneCountInString(value.Content) > 32768 || len(value.Attachments) > 64 || len(value.Elements) > 64 {
		return adapterError("INTEGRATION_QQ_EVENT_INVALID")
	}
	conversation := nativeConversation{Kind: "c2c", ID: value.Author.User}
	sender := value.Author.User
	if eventType != "C2C_MESSAGE_CREATE" {
		conversation = nativeConversation{Kind: "group", ID: value.Group}
		sender = value.Author.Member
	}
	if !validExternalIdentifier(conversation.ID) || !validExternalIdentifier(sender) {
		return adapterError("INTEGRATION_QQ_EVENT_INVALID")
	}
	event := nativeMessage{EventID: value.ID, MessageID: value.ID, SenderID: sender, Conversation: conversation, PlatformTime: value.Timestamp, Segments: []map[string]any{}}
	var err error
	event.Segments, err = qqTextSegments(value.Content, value.Mentions)
	if err != nil {
		return err
	}
	sources := map[int]nativeSource{}
	for _, attachment := range value.Attachments {
		kind := "file"
		if strings.HasPrefix(attachment.Type, "image/") {
			kind = "image"
		} else if strings.HasPrefix(attachment.Type, "audio/") {
			kind = "audio"
		} else if strings.HasPrefix(attachment.Type, "video/") {
			kind = "video"
		}
		if len(attachment.URL) > 8192 || attachment.Size < 0 || attachment.Size > maxMediaBytes || len(attachment.Name) > 255 || len(attachment.Type) > 128 {
			return adapterError("INTEGRATION_EVENT_BOUNDS")
		}
		index := len(event.Segments)
		event.Segments = append(event.Segments, map[string]any{"kind": kind, "mediaRef": "", "fileName": attachment.Name, "mediaType": attachment.Type, "sizeBytes": attachment.Size})
		sources[index] = nativeSource{Conversation: conversation, MessageID: value.ID, Context: attachment.URL, MediaKind: kind, FileName: attachment.Name, MediaType: attachment.Type, SizeBytes: attachment.Size}
		if attachment.ASR != "" {
			event.Segments = append(event.Segments, map[string]any{"kind": "text", "text": attachment.ASR, "origin": "platform-transcription"})
		}
	}
	if value.MessageType == 103 && len(value.Elements) > 0 {
		for _, element := range value.Elements[:1] {
			if len(element.Attachments) > 64 || len(element.Content) > 32768 {
				return adapterError("INTEGRATION_EVENT_BOUNDS")
			}
			status := "not-provided"
			if element.Content != "" {
				status = "text-provided"
			} else if len(element.Attachments) > 0 {
				status = "media-metadata-only"
			}
			ref := nativeReference{MessageID: "", Title: "", Text: element.Content, MediaKind: "", FileName: "", ContentStatus: status}
			if len(element.Attachments) > 0 {
				ref.MediaKind = "file"
				if strings.HasPrefix(element.Attachments[0].Type, "image/") {
					ref.MediaKind = "image"
				} else if strings.HasPrefix(element.Attachments[0].Type, "audio/") {
					ref.MediaKind = "audio"
				} else if strings.HasPrefix(element.Attachments[0].Type, "video/") {
					ref.MediaKind = "video"
				}
				ref.FileName = element.Attachments[0].Name
			}
			// @nimi-authority: definition.nimi.runtime.integration.native-operation-contract
			// Only this actual first-level material becomes a media capability.
			// msg_idx is not an original message ID or a reply context.
			for _, attachment := range element.Attachments {
				if len(attachment.URL) > 8192 || attachment.Size < 0 || attachment.Size > maxMediaBytes || len(attachment.Name) > 255 || len(attachment.Type) > 128 {
					return adapterError("INTEGRATION_EVENT_BOUNDS")
				}
				kind := "file"
				for _, candidate := range []string{"image", "audio", "video"} {
					if strings.HasPrefix(attachment.Type, candidate+"/") {
						kind = candidate
						break
					}
				}
				media := nativeReferenceMedia{Kind: kind, FileName: attachment.Name, MediaType: attachment.Type, SizeBytes: attachment.Size}
				if strings.TrimSpace(attachment.URL) == "" {
					media.UnavailableReason = "source-not-provided"
				} else if location, err := s.nativeCDNURL(attachment.URL); err != nil {
					media.UnavailableReason = "source-rejected"
				} else {
					media.Source = &nativeSource{Conversation: conversation, Context: location, MediaKind: kind, FileName: attachment.Name, MediaType: attachment.Type, SizeBytes: attachment.Size}
					if ref.ContentStatus != "text-provided" {
						ref.ContentStatus = "media-provided"
					}
				}
				ref.Media = append(ref.Media, media)
			}
			event.References = append(event.References, ref)
		}
	}
	if len(event.Segments) > 64 {
		return adapterError("INTEGRATION_EVENT_BOUNDS")
	}
	window := 5 * time.Minute
	if conversation.Kind == "c2c" {
		window = 60 * time.Minute
	}
	var expires time.Time
	if timestamp, err := time.Parse(time.RFC3339Nano, value.Timestamp); err == nil {
		expires = timestamp.Add(window)
		if maximum := time.Now().Add(window); expires.After(maximum) {
			expires = maximum
		}
	}
	return f.acceptMessage(ctx, event, sources, nativeSource{Conversation: conversation, MessageID: value.ID, QQReplies: &qqReplyState{}, ExpiresAt: expires}, event.EventID)
}
