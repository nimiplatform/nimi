package integration

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	larkws "github.com/larksuite/oapi-sdk-go/v3/ws"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func feishuSocketFixture(t *testing.T) (*websocket.Conn, *websocket.Conn) {
	t.Helper()
	accepted := make(chan *websocket.Conn, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		socket, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if err != nil {
			return
		}
		accepted <- socket
	}))
	t.Cleanup(server.Close)
	client, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	peer := <-accepted
	t.Cleanup(func() { client.Close(); peer.Close() })
	return client, peer
}
func feishuWireEvent(index int) *larkws.Frame {
	content := schemaJSON(map[string]any{"header": map[string]any{"app_id": "cli_selected", "event_type": "im.message.receive_v1", "event_id": fmt.Sprint(index)}, "event": map[string]any{"sender": map[string]any{"sender_id": map[string]string{"open_id": "specified"}}, "message": map[string]any{"message_id": fmt.Sprint(index), "chat_id": "chat", "chat_type": "p2p", "message_type": "text", "content": `{"text":"received"}`}}})
	return &larkws.Frame{Method: 1, Headers: []larkws.Header{{Key: "type", Value: "event"}, {Key: "message_id", Value: fmt.Sprint(index)}, {Key: "sum", Value: "1"}, {Key: "seq", Value: "0"}}, Payload: []byte(content)}
}
func feishuSocketTarget() target {
	return target{Account: "test-account", CredentialGeneration: 1, Public: &runtimev1.IntegrationTarget{TargetRef: "socket-fixture", Kind: "feishu"}, Config: &runtimev1.IntegrationConnectionConfig{Feishu: &runtimev1.IntegrationFeishuConfig{AppId: "cli_selected", SetupMode: "manual"}}}
}

func TestFeishuSocketReadLimitPrecedesFrameDecode(t *testing.T) {
	client, peer := feishuSocketFixture(t)
	feed := newNativeFeed()
	var handlers atomic.Int32
	feed.publish = func(func() error) error { handlers.Add(1); return nil }
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- consumeFeishuSocket(ctx, feishuSocketTarget(), feed, client, 7, 5*time.Second) }()
	if err := peer.WriteMessage(websocket.BinaryMessage, make([]byte, feishuFrameLimit+1)); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("oversized frame accepted")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("frame limit did not terminate")
	}
	if handlers.Load() != 0 {
		t.Fatal("oversized frame reached callback")
	}
}

func TestFeishuSocketStartsHeartbeatAndAppliesBoundedPongConfig(t *testing.T) {
	client, peer := feishuSocketFixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		done <- consumeFeishuSocket(ctx, feishuSocketTarget(), newNativeFeed(), client, 7, 30*time.Second)
	}()
	readPing := func(wait time.Duration) {
		t.Helper()
		peer.SetReadDeadline(time.Now().Add(wait))
		_, data, err := peer.ReadMessage()
		if err != nil {
			t.Fatal("heartbeat missing", err)
		}
		var frame larkws.Frame
		if frame.Unmarshal(data) != nil || frame.Method != int32(larkws.FrameTypeControl) || larkws.Headers(frame.Headers).GetString(larkws.HeaderType) != string(larkws.MessageTypePing) {
			t.Fatal("first frame not actual ping")
		}
	}
	readPing(2 * time.Second)
	pong := &larkws.Frame{Method: int32(larkws.FrameTypeControl), Headers: []larkws.Header{{Key: larkws.HeaderType, Value: string(larkws.MessageTypePong)}}, Payload: []byte(`{"PingInterval":5}`)}
	data, _ := pong.Marshal()
	if err := peer.WriteMessage(websocket.BinaryMessage, data); err != nil {
		t.Fatal(err)
	}
	readPing(6 * time.Second)
	pong.Payload = []byte(`{"PingInterval":4}`)
	data, _ = pong.Marshal()
	if err := peer.WriteMessage(websocket.BinaryMessage, data); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if err == nil || publicAdapterError(err) != "INTEGRATION_FEISHU_PING_INVALID" {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("invalid heartbeat configuration did not stop")
	}
}

func TestFeishuSocketTaskAdmissionAndACKAfterBufferCommit(t *testing.T) {
	for _, stop := range []bool{false, true} {
		t.Run(fmt.Sprint("stop=", stop), func(t *testing.T) {
			client, peer := feishuSocketFixture(t)
			feed := newNativeFeed()
			feed.readers = 1
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			gate := make(chan struct{})
			var active, peak, started atomic.Int32
			feed.publish = func(commit func() error) error {
				n := active.Add(1)
				defer active.Add(-1)
				started.Add(1)
				for old := peak.Load(); n > old; old = peak.Load() {
					if peak.CompareAndSwap(old, n) {
						break
					}
				}
				select {
				case <-gate:
				case <-ctx.Done():
					return ctx.Err()
				}
				feed.mu.Lock()
				defer feed.mu.Unlock()
				return commit()
			}
			done := make(chan error, 1)
			go func() { done <- consumeFeishuSocket(ctx, feishuSocketTarget(), feed, client, 7, 5*time.Second) }()
			acks := make(chan int, 64)
			go func() {
				defer close(acks)
				for {
					_, data, err := peer.ReadMessage()
					if err != nil {
						return
					}
					frame := &larkws.Frame{}
					if frame.Unmarshal(data) != nil {
						continue
					}
					var response larkws.Response
					if json.Unmarshal(frame.Payload, &response) == nil {
						acks <- response.StatusCode
					}
				}
			}()
			for index := 0; index < 33; index++ {
				data, err := feishuWireEvent(index).Marshal()
				if err != nil {
					t.Fatal(err)
				}
				if err = peer.WriteMessage(websocket.BinaryMessage, data); err != nil {
					t.Fatal(err)
				}
			}
			deadline := time.Now().Add(3 * time.Second)
			for started.Load() < 32 && time.Now().Before(deadline) {
				time.Sleep(time.Millisecond)
			}
			if started.Load() != 32 || peak.Load() > 32 {
				t.Fatal("task admission exceeded bound", started.Load(), peak.Load())
			}
			select {
			case code := <-acks:
				t.Fatal("ACK preceded buffer commit", code)
			case <-time.After(50 * time.Millisecond):
			}
			if stop {
				cancel()
			} else {
				close(gate)
				for index := 0; index < 33; index++ {
					select {
					case code, ok := <-acks:
						if !ok || code != http.StatusOK {
							t.Fatal("wrong ACK", code)
						}
					case <-time.After(3 * time.Second):
						t.Fatal("ACK did not follow commit")
					}
				}
				feed.mu.Lock()
				retained := len(feed.events)
				feed.mu.Unlock()
				if retained != 33 {
					t.Fatal("ACK without normalized buffer", retained)
				}
				cancel()
			}
			select {
			case <-done:
			case <-time.After(3 * time.Second):
				t.Fatal("stop did not drain bounded tasks")
			}
			if stop && len(feed.events) != 0 {
				t.Fatal("interrupted handler committed")
			}
			if peak.Load() > 32 {
				t.Fatal("task bound exceeded")
			}
		})
	}
}

func TestFeishuAssemblyExpiresWhileSocketIdle(t *testing.T) {
	client, peer := feishuSocketFixture(t)
	feed := newNativeFeed()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- consumeFeishuSocket(ctx, feishuSocketTarget(), feed, client, 7, 5*time.Second) }()
	frame := feishuWireEvent(1)
	frame.Headers[2].Value = "2"
	payload, err := frame.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	if err := peer.WriteMessage(websocket.BinaryMessage, payload); err != nil {
		t.Fatal(err)
	}
	var acknowledgments atomic.Int32
	peerDone := make(chan struct{})
	go func() {
		defer close(peerDone)
		for {
			_, payload, err := peer.ReadMessage()
			if err != nil {
				return
			}
			frame := &larkws.Frame{}
			if frame.Unmarshal(payload) != nil {
				return
			}
			if frame.Method == int32(larkws.FrameTypeData) {
				acknowledgments.Add(1)
				continue
			}
			if larkws.Headers(frame.Headers).GetString(larkws.HeaderType) == string(larkws.MessageTypePing) {
				frame.Headers = []larkws.Header{{Key: larkws.HeaderType, Value: string(larkws.MessageTypePong)}}
				payload, _ = frame.Marshal()
				if peer.WriteMessage(websocket.BinaryMessage, payload) != nil {
					return
				}
			}
		}
	}()
	// Keep a real bounded feed reader alive across expiry, after earlier normal
	// heartbeats demonstrate that the socket itself is still usable.
	time.Sleep(7 * time.Second)
	_, readErr := feed.read(ctx, testDecision("consumer", 1), feishuSocketTarget(), []string{"user:specified"}, "", 25*time.Second)
	if publicAdapterError(readErr) != "INTEGRATION_FEISHU_FRAGMENT_EXPIRED" {
		t.Fatal("consumer lost expiry failure", readErr)
	}
	select {
	case err := <-done:
		if publicAdapterError(err) != "INTEGRATION_FEISHU_FRAGMENT_EXPIRED" {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("expired socket retained")
	}
	<-peerDone
	feed.mu.Lock()
	count, gap := len(feed.events), feed.gap
	feed.mu.Unlock()
	if acknowledgments.Load() != 0 || count != 0 || gap != "reconnect" {
		t.Fatal("incomplete message acknowledged or loss hidden", acknowledgments.Load(), count, gap)
	}
}
