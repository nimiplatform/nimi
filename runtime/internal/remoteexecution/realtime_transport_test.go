package remoteexecution

import (
	"bufio"
	"context"
	"crypto/sha1"
	"encoding/base64"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"golang.org/x/net/websocket"
)

func stalledRealtimeTransport(t *testing.T) *providerRealtimeSession {
	t.Helper()
	client, peer := net.Pipe()
	t.Cleanup(func() { _ = client.Close(); _ = peer.Close() })
	ready := make(chan error, 1)
	go func() {
		req, err := http.ReadRequest(bufio.NewReader(peer))
		if err != nil {
			ready <- err
			return
		}
		digest := sha1.Sum([]byte(req.Header.Get("Sec-WebSocket-Key") + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
		_, err = fmt.Fprintf(peer, "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: %s\r\n\r\n", base64.StdEncoding.EncodeToString(digest[:]))
		ready <- err
	}()
	config, _ := websocket.NewConfig("ws://fixture.invalid/realtime", "http://runtime.nimi.local")
	conn, err := websocket.NewClient(config, client)
	if err != nil {
		t.Fatal(err)
	}
	if err := <-ready; err != nil {
		t.Fatal(err)
	}
	return &providerRealtimeSession{conn: conn, transport: client, events: make(chan []byte, 1), errors: make(chan error, 1), done: make(chan struct{})}
}

func TestRealtimeUsesCapturedConnectionOriginAndProxyPrefix(t *testing.T) {
	transport := capabilitydriver.CloudRealtimeTransport{BasePath: "/v1", Path: "/v1/realtime", ModelQuery: true}
	for _, base := range []string{"https://api.openai.com/v1", "https://proxy.example/gateway/v1", "https://proxy.example/gateway"} {
		got, err := materializeRealtimeEndpoint(base, transport, "captured-model")
		u, _ := url.Parse(got)
		original, _ := url.Parse(base)
		if err != nil || u.Host != original.Host || u.Scheme != "wss" || u.Query().Get("model") != "captured-model" {
			t.Fatalf("materialize: %s %v", got, err)
		}
		if original.Host == "proxy.example" && u.Path != "/gateway/v1/realtime" {
			t.Fatalf("proxy prefix lost: %s", got)
		}
	}
	if _, err := materializeRealtimeEndpoint("", transport, "model"); err == nil {
		t.Fatal("empty capture used an ambient endpoint")
	}
	dash := capabilitydriver.CloudRealtimeTransport{BasePath: "/compatible-mode/v1", Path: "/api-ws/v1/realtime", ModelQuery: true}
	got, err := materializeRealtimeEndpoint("https://ws-example.cn-beijing.maas.aliyuncs.com/compatible-mode/v1", dash, "captured")
	if err != nil || !strings.HasPrefix(got, "wss://ws-example.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime?") {
		t.Fatalf("workspace changed: %s %v", got, err)
	}
}

func TestRealtimePreservesEscapedProxyPrefix(t *testing.T) {
	transport := capabilitydriver.CloudRealtimeTransport{BasePath: "/v1", Path: "/v1/realtime", ModelQuery: true}
	for _, path := range []string{"/gateway%2Ftenant", "/gateway%2ftenant", "/percent%25tenant", "/ordinary"} {
		for _, suffix := range []string{"/v1", "/v1/", ""} {
			got, err := materializeRealtimeEndpoint("https://proxy.example"+path+suffix+"?scope=a%2Fb", transport, "model")
			if err != nil {
				t.Fatal(err)
			}
			u, err := url.Parse(got)
			if err != nil || u.RequestURI() != path+"/v1/realtime?model=model&scope=a%2Fb" {
				t.Fatalf("proxy request-target changed: %s (%v)", got, err)
			}
		}
	}
}

func TestRealtimeStalledWriterIsReleasedByCancelOrClose(t *testing.T) {
	for _, action := range []string{"cancel", "close"} {
		t.Run(action, func(t *testing.T) {
			session := stalledRealtimeTransport(t)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			sent := make(chan error, 1)
			go func() { sent <- session.Send(ctx, []byte(`{"type":"input_audio_buffer.append","audio":"AAAA"}`)) }()
			select {
			case err := <-sent:
				t.Fatalf("peer did not stall: %v", err)
			case <-time.After(30 * time.Millisecond):
			}
			closed := make(chan struct{})
			if action == "cancel" {
				cancel()
			} else {
				go func() { _ = session.Close(); close(closed) }()
			}
			select {
			case err := <-sent:
				if err == nil || action == "cancel" && !errors.Is(err, context.Canceled) {
					t.Fatalf("send outcome: %v", err)
				}
			case <-time.After(time.Second):
				t.Fatal("stalled Send did not terminate")
			}
			if action == "cancel" {
				go func() { _ = session.Close(); close(closed) }()
			}
			select {
			case <-closed:
			case <-time.After(time.Second):
				t.Fatal("Close waited for stalled writer")
			}
			if err := session.Send(context.Background(), []byte("late")); err == nil {
				t.Fatal("closed session accepted late send")
			}
		})
	}
}

func TestRealtimeTransportKeepsGeminiModelOutOfURL(t *testing.T) {
	endpoint := "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent"
	got, err := realtimeProviderURL(endpoint, "gemini-3.8-live", false)
	if err != nil || got != endpoint {
		t.Fatalf("native endpoint=%q err=%v", got, err)
	}
	got, err = realtimeProviderURL("wss://api.openai.com/v1/realtime", "gpt-realtime-2.1", true)
	u, _ := url.Parse(got)
	if err != nil || u.Query().Get("model") != "gpt-realtime-2.1" {
		t.Fatalf("existing endpoint=%q err=%v", got, err)
	}
	for _, bad := range []string{"http://host/ws", "wss://secret@host/ws", "wss://host/ws#fragment"} {
		if _, err := realtimeProviderURL(bad, "model", false); err == nil {
			t.Fatalf("unsafe endpoint accepted: %s", bad)
		}
	}
}
