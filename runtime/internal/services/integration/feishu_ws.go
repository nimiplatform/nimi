package integration

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode/utf8"

	"github.com/gorilla/websocket"
	larkws "github.com/larksuite/oapi-sdk-go/v3/ws"
	"google.golang.org/protobuf/encoding/protowire"
)

const feishuFrameLimit = 1024 * 1024
const feishuAssemblyLimit = 8 * 1024 * 1024
const feishuAssemblyCount = 8
const feishuFragmentCount = 64
const feishuTaskCount = 32

type feishuAssembly struct {
	started time.Time
	count   int
	bytes   int
	parts   map[int][]byte
	timer   *time.Timer
}
type feishuAssembler struct {
	mu            sync.Mutex
	groups        map[string]*feishuAssembly
	bytes         int
	err           error
	onExpire      func(error)
	closed        bool
	notifications sync.WaitGroup
}

// @nimi-authority: rule.nimi.runtime.integration.feishu-inbound-bounds
// Checks precede every peer-controlled allocation. Aggregate bytes include all
// incomplete groups; completing a group releases its reservation before dispatch.
func (a *feishuAssembler) add(frame *larkws.Frame, now time.Time) ([]byte, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.closed {
		return nil, context.Canceled
	}
	if a.err != nil {
		return nil, a.err
	}
	if a.groups == nil {
		a.groups = map[string]*feishuAssembly{}
	}
	for key, group := range a.groups {
		if now.Sub(group.started) >= 30*time.Second {
			group.timer.Stop()
			a.bytes -= group.bytes
			delete(a.groups, key)
			a.err = adapterError("INTEGRATION_FEISHU_FRAGMENT_EXPIRED")
		}
	}
	if a.err != nil {
		return nil, a.err
	}
	if len(frame.Payload) > feishuFrameLimit || len(frame.Headers) > 32 {
		return nil, adapterError("INTEGRATION_FEISHU_FRAME_BOUNDS")
	}
	get := func(key string) (string, bool) {
		value := ""
		found := false
		for _, header := range frame.Headers {
			if len(header.Key) > 64 || len(header.Value) > 512 {
				return "", false
			}
			if header.Key == key {
				if found {
					return "", false
				}
				found = true
				value = header.Value
			}
		}
		return value, found
	}
	id, ok := get(larkws.HeaderMessageID)
	sumRaw, sumOK := get(larkws.HeaderSum)
	seqRaw, seqOK := get(larkws.HeaderSeq)
	sum, sumErr := strconv.Atoi(sumRaw)
	seq, seqErr := strconv.Atoi(seqRaw)
	if !ok || !validExternalIdentifier(id) || !sumOK || !seqOK || sumErr != nil || seqErr != nil || sum < 1 || sum > feishuFragmentCount || seq < 0 || seq >= sum {
		return nil, adapterError("INTEGRATION_FEISHU_FRAME_INVALID")
	}
	if sum == 1 {
		return frame.Payload, nil
	}
	group := a.groups[id]
	if group == nil {
		if len(a.groups) >= feishuAssemblyCount || a.bytes+len(frame.Payload) > feishuAssemblyLimit {
			return nil, adapterError("INTEGRATION_FEISHU_ASSEMBLY_BOUNDS")
		}
		group = &feishuAssembly{started: now, count: sum, parts: make(map[int][]byte)}
		a.groups[id] = group
		group.timer = time.AfterFunc(30*time.Second, func() {
			a.mu.Lock()
			if a.groups[id] == group {
				if remaining := time.Until(group.started.Add(30 * time.Second)); remaining > 0 {
					group.timer.Reset(remaining)
					a.mu.Unlock()
					return
				}
				a.bytes -= group.bytes
				delete(a.groups, id)
				a.err = adapterError("INTEGRATION_FEISHU_FRAGMENT_EXPIRED")
				err, notify := a.err, a.onExpire
				if notify != nil {
					a.notifications.Add(1)
				}
				a.mu.Unlock()
				if notify != nil {
					defer a.notifications.Done()
					notify(err)
				}
				return
			}
			a.mu.Unlock()
		})
	}
	if group.count != sum {
		return nil, adapterError("INTEGRATION_FEISHU_FRAME_INVALID")
	}
	group.started = now
	group.timer.Reset(30 * time.Second)
	if previous, present := group.parts[seq]; present {
		if string(previous) != string(frame.Payload) {
			return nil, adapterError("INTEGRATION_FEISHU_FRAME_INVALID")
		}
		return nil, nil
	}
	if a.bytes+len(frame.Payload) > feishuAssemblyLimit {
		return nil, adapterError("INTEGRATION_FEISHU_ASSEMBLY_BOUNDS")
	}
	group.parts[seq] = append([]byte(nil), frame.Payload...)
	group.bytes += len(frame.Payload)
	a.bytes += len(frame.Payload)
	if len(group.parts) != sum {
		return nil, nil
	}
	result := make([]byte, 0, group.bytes)
	for index := 0; index < sum; index++ {
		result = append(result, group.parts[index]...)
	}
	a.bytes -= group.bytes
	group.timer.Stop()
	delete(a.groups, id)
	return result, nil
}

func (a *feishuAssembler) failure() error {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.err
}

func (a *feishuAssembler) close() {
	a.mu.Lock()
	a.closed = true
	for _, group := range a.groups {
		group.timer.Stop()
	}
	a.groups = nil
	a.bytes = 0
	a.mu.Unlock()
	// Receiver drain includes a timer notification already admitted before
	// close, so it cannot poison a newly started receiver sharing this feed.
	a.notifications.Wait()
}

func domesticFeishuSocket(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "wss" || u.User != nil || u.Fragment != "" || u.Port() != "" || !(strings.HasSuffix(u.Hostname(), ".feishu.cn") || strings.HasSuffix(u.Hostname(), ".larkoffice.com")) {
		return nil, adapterError("INTEGRATION_FEISHU_ENDPOINT_INVALID")
	}
	// Domestic bootstrap is the authority for a signed endpoint. No Lark API,
	// credentials, user supplied hosts, redirect or proxy endpoint is accepted.
	return u, nil
}

func (s *Service) receiveFeishu(ctx context.Context, t target, secret string, feed *nativeFeed) error {
	bootstrapCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	data, status, _, err := s.platformJSON(bootstrapCtx, http.MethodPost, feishuAPIBase+larkws.GenEndpointUri, http.Header{}, &larkws.BootstrapRequest{AppID: t.Config.Feishu.AppId, AppSecret: secret}, maxOutput)
	cancel()
	if err != nil {
		return err
	}
	var bootstrap struct {
		Code *int             `json:"code"`
		Data *larkws.Endpoint `json:"data"`
	}
	if status != http.StatusOK || json.Unmarshal(data, &bootstrap) != nil || bootstrap.Code == nil || *bootstrap.Code != 0 || bootstrap.Data == nil || bootstrap.Data.ClientConfig == nil {
		return adapterError("INTEGRATION_FEISHU_BOOTSTRAP_REJECTED")
	}
	u, err := domesticFeishuSocket(bootstrap.Data.Url)
	if err != nil {
		return err
	}
	serviceID, err := strconv.ParseInt(u.Query().Get(larkws.ServiceID), 10, 32)
	if err != nil || serviceID <= 0 {
		return adapterError("INTEGRATION_FEISHU_ENDPOINT_INVALID")
	}
	dialer := *websocket.DefaultDialer
	dialer.HandshakeTimeout = 20 * time.Second
	socket, response, err := dialer.DialContext(ctx, u.String(), nil)
	if response != nil && response.Body != nil {
		response.Body.Close()
	}
	if err != nil {
		return adapterError("INTEGRATION_FEISHU_WEBSOCKET_FAILED")
	}
	defer socket.Close()
	// Gorilla rejects an over-limit message before ReadMessage allocates it.
	socket.SetReadLimit(feishuFrameLimit)
	pingSeconds := bootstrap.Data.ClientConfig.PingInterval
	if pingSeconds < 5 || pingSeconds > 300 {
		return adapterError("INTEGRATION_FEISHU_PING_INVALID")
	}
	pingInterval := time.Duration(pingSeconds) * time.Second
	return consumeFeishuSocket(ctx, t, feed, socket, int32(serviceID), pingInterval)
}

func consumeFeishuSocket(ctx context.Context, t target, feed *nativeFeed, socket *websocket.Conn, serviceID int32, pingInterval time.Duration) error {
	socket.SetReadLimit(feishuFrameLimit)
	var writeMu sync.Mutex
	write := func(frame *larkws.Frame) error {
		payload, e := frame.Marshal()
		if e != nil || len(payload) > feishuFrameLimit {
			return adapterError("INTEGRATION_FEISHU_ACK_INVALID")
		}
		writeMu.Lock()
		defer writeMu.Unlock()
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if e = socket.SetWriteDeadline(time.Now().Add(5 * time.Second)); e != nil {
			return e
		}
		return socket.WriteMessage(websocket.BinaryMessage, payload)
	}
	run, stop := context.WithCancel(ctx)
	defer stop()
	var currentPing atomic.Int64
	currentPing.Store(int64(pingInterval))
	pingChanges := make(chan time.Duration, 1)
	var workers sync.WaitGroup
	workers.Add(1)
	go func() {
		defer workers.Done()
		if write(larkws.NewPingFrame(serviceID)) != nil {
			stop()
			socket.Close()
			return
		}
		ticker := time.NewTicker(pingInterval)
		defer ticker.Stop()
		for {
			select {
			case <-run.Done():
				socket.Close()
				return
			case interval := <-pingChanges:
				ticker.Reset(interval)
			case <-ticker.C:
				if write(larkws.NewPingFrame(serviceID)) != nil {
					stop()
					socket.Close()
					return
				}
			}
		}
	}()
	defer func() { stop(); socket.Close(); workers.Wait() }()
	slots := make(chan struct{}, feishuTaskCount)
	assembler := &feishuAssembler{onExpire: func(err error) {
		feed.fail(err)
		stop()
		socket.Close()
	}}
	defer assembler.close()
	for {
		if err := socket.SetReadDeadline(time.Now().Add(2*time.Duration(currentPing.Load()) + 5*time.Second)); err != nil {
			return err
		}
		kind, payload, err := socket.ReadMessage()
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if expired := assembler.failure(); expired != nil {
				return expired
			}
			return adapterError("INTEGRATION_FEISHU_WEBSOCKET_ENDED")
		}
		if kind != websocket.BinaryMessage || len(payload) > feishuFrameLimit {
			return adapterError("INTEGRATION_FEISHU_FRAME_INVALID")
		}
		frame := &larkws.Frame{}
		if !boundedFeishuWireFrame(payload) || frame.Unmarshal(payload) != nil || len(frame.Headers) > 32 {
			return adapterError("INTEGRATION_FEISHU_FRAME_INVALID")
		}
		if frame.Method == int32(larkws.FrameTypeControl) {
			if larkws.Headers(frame.Headers).GetString(larkws.HeaderType) == string(larkws.MessageTypePong) && len(frame.Payload) > 0 {
				var config larkws.ClientConfig
				if json.Unmarshal(frame.Payload, &config) != nil {
					return adapterError("INTEGRATION_FEISHU_PING_INVALID")
				}
				if config.PingInterval != 0 {
					if config.PingInterval < 5 || config.PingInterval > 300 {
						return adapterError("INTEGRATION_FEISHU_PING_INVALID")
					}
					interval := time.Duration(config.PingInterval) * time.Second
					currentPing.Store(int64(interval))
					select {
					case <-pingChanges:
					default:
					}
					pingChanges <- interval
				}
			}
			continue
		}
		if frame.Method != int32(larkws.FrameTypeData) || larkws.Headers(frame.Headers).GetString(larkws.HeaderType) != string(larkws.MessageTypeEvent) {
			return adapterError("INTEGRATION_FEISHU_FRAME_INVALID")
		}
		body, err := assembler.add(frame, time.Now())
		if err != nil {
			feed.fail(err)
			return err
		}
		if body == nil {
			continue
		}
		// Admission happens before goroutine creation, and blocks network reads
		// under load rather than spawning a queue of unbounded handler tasks.
		select {
		case slots <- struct{}{}:
		case <-run.Done():
			if expired := assembler.failure(); expired != nil {
				return expired
			}
			return run.Err()
		}
		workers.Add(1)
		go func(frame *larkws.Frame, body []byte) {
			defer workers.Done()
			defer func() { <-slots }()
			started := time.Now()
			err := feed.acceptFeishu(run, t, body)
			if err != nil {
				feed.fail(err)
				stop()
				socket.Close()
				return
			}
			if run.Err() != nil {
				return
			}
			frame.Payload, _ = json.Marshal(larkws.NewResponseByCode(http.StatusOK))
			headers := larkws.Headers(frame.Headers)
			headers.Add(larkws.HeaderBizRt, strconv.FormatInt(time.Since(started).Milliseconds(), 10))
			frame.Headers = headers
			if write(frame) != nil {
				stop()
				socket.Close()
			}
		}(frame, body)
	}
}

// Protobuf's generated decoder allocates repeated headers while unmarshalling.
// Count their wire fields first, without allocating peer-controlled slices.
func boundedFeishuWireFrame(data []byte) bool {
	if len(data) > feishuFrameLimit {
		return false
	}
	headers := 0
	for len(data) > 0 {
		number, kind, n := protowire.ConsumeTag(data)
		if n < 0 {
			return false
		}
		data = data[n:]
		if number == 5 {
			headers++
			if headers > 32 {
				return false
			}
		}
		n = protowire.ConsumeFieldValue(number, kind, data)
		if n < 0 {
			return false
		}
		data = data[n:]
	}
	return true
}

func (f *nativeFeed) acceptFeishu(ctx context.Context, t target, payload []byte) error {
	if len(payload) > 2*nativeEventLimit {
		return adapterError("INTEGRATION_EVENT_BOUNDS")
	}
	var envelope struct {
		Header struct {
			EventID   string `json:"event_id"`
			EventType string `json:"event_type"`
			AppID     string `json:"app_id"`
		} `json:"header"`
		Event struct {
			Sender struct {
				SenderID struct {
					OpenID string `json:"open_id"`
				} `json:"sender_id"`
			} `json:"sender"`
			Message struct {
				MessageID string          `json:"message_id"`
				ParentID  string          `json:"parent_id"`
				RootID    string          `json:"root_id"`
				ChatID    string          `json:"chat_id"`
				ChatType  string          `json:"chat_type"`
				Type      string          `json:"message_type"`
				Content   string          `json:"content"`
				Created   string          `json:"create_time"`
				Mentions  []feishuMention `json:"mentions"`
			} `json:"message"`
		} `json:"event"`
	}
	if json.Unmarshal(payload, &envelope) != nil || envelope.Header.AppID != t.Config.Feishu.AppId || envelope.Header.EventType != "im.message.receive_v1" {
		return adapterError("INTEGRATION_FEISHU_EVENT_INVALID")
	}
	m := envelope.Event.Message
	if !validExternalIdentifier(envelope.Header.EventID) || !validExternalIdentifier(m.MessageID) || !validExternalIdentifier(m.ChatID) || !validExternalIdentifier(envelope.Event.Sender.SenderID.OpenID) || len(m.Content) > nativeEventLimit {
		return adapterError("INTEGRATION_FEISHU_EVENT_INVALID")
	}
	conversation := nativeConversation{Kind: "chat", ID: m.ChatID}
	if m.ChatType != "p2p" && m.ChatType != "group" {
		return adapterError("INTEGRATION_FEISHU_EVENT_INVALID")
	}
	event := nativeMessage{EventID: envelope.Header.EventID, MessageID: m.MessageID, Conversation: conversation, SenderID: envelope.Event.Sender.SenderID.OpenID, Segments: []map[string]any{}}
	mentions, err := feishuMentionIndex(m.Mentions)
	if err != nil {
		return err
	}
	for _, reference := range []struct{ id, relation string }{{m.ParentID, "parent"}, {m.RootID, "root"}} {
		if reference.id == "" {
			continue
		}
		if !validExternalIdentifier(reference.id) {
			return adapterError("INTEGRATION_FEISHU_EVENT_INVALID")
		}
		event.References = append(event.References, nativeReference{MessageID: reference.id, Relation: reference.relation, ContentStatus: "not-provided"})
	}
	if ms, err := strconv.ParseInt(m.Created, 10, 64); err == nil && ms > 0 {
		event.PlatformTime = time.UnixMilli(ms).UTC().Format(time.RFC3339Nano)
	}
	var content struct {
		Text     string `json:"text"`
		ImageKey string `json:"image_key"`
		FileKey  string `json:"file_key"`
		FileName string `json:"file_name"`
	}
	if json.Unmarshal([]byte(m.Content), &content) != nil {
		return adapterError("INTEGRATION_FEISHU_EVENT_INVALID")
	}
	sources := map[int]nativeSource{}
	reply := nativeSource{Conversation: conversation, MessageID: m.MessageID}
	switch m.Type {
	case "text":
		if utf8.RuneCountInString(content.Text) > 32768 {
			return adapterError("INTEGRATION_EVENT_BOUNDS")
		}
		event.Segments, err = feishuTextSegments(content.Text, mentions)
		if err != nil {
			return err
		}
	case "post":
		segments, mediaSources, err := feishuPostSegments(m.Content, reply, mentions)
		if err != nil {
			return err
		}
		event.Segments, sources = segments, mediaSources
	case "image", "file", "audio", "media":
		key, downloadType := content.FileKey, "file"
		if m.Type == "image" {
			key, downloadType = content.ImageKey, "image"
		}
		if !validExternalIdentifier(key) || (content.FileName != "" && !safeNativeFileName(content.FileName)) {
			return adapterError("INTEGRATION_FEISHU_EVENT_INVALID")
		}
		kind := m.Type
		if kind == "media" {
			kind = "video"
		}
		event.Segments = append(event.Segments, map[string]any{"kind": kind, "mediaRef": "", "fileName": content.FileName, "mediaType": "application/octet-stream", "sizeBytes": 0})
		source := reply
		source.MediaKind = kind
		source.FileName = content.FileName
		source.Media = json.RawMessage(schemaJSON(map[string]string{"key": key, "type": downloadType}))
		sources[0] = source
	default:
		return adapterError("INTEGRATION_FEISHU_MESSAGE_KIND_UNSUPPORTED")
	}
	return f.acceptMessage(ctx, event, sources, reply, m.MessageID)
}
