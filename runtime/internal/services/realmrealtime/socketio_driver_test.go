package realmrealtime

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"golang.org/x/net/websocket"
)

func TestSocketIOWebsocketURLIsExact(t *testing.T) {
	target, origin, err := socketIOWebsocketURL("http://127.0.0.1:3003")
	if err != nil {
		t.Fatal(err)
	}
	if target != "ws://127.0.0.1:3003/socket.io/?EIO=4&transport=websocket" {
		t.Fatalf("target = %q", target)
	}
	if origin != "http://127.0.0.1:3003" {
		t.Fatalf("origin = %q", origin)
	}
}

func newSocketIOServer(t *testing.T, connected func(*websocket.Conn, string)) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(websocket.Handler(func(conn *websocket.Conn) {
		defer func() { _ = conn.Close() }()
		_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
		if err := websocket.Message.Send(conn, `0{"sid":"engine-1","upgrades":[],"pingInterval":25000,"pingTimeout":20000}`); err != nil {
			t.Error(err)
			return
		}
		var frame string
		if err := websocket.Message.Receive(conn, &frame); err != nil {
			t.Error(err)
			return
		}
		var auth struct {
			Token string `json:"token"`
		}
		if !strings.HasPrefix(frame, "40") || json.Unmarshal([]byte(frame[2:]), &auth) != nil {
			t.Error("invalid Socket.IO authentication frame")
			return
		}
		if err := websocket.Message.Send(conn, `40{"sid":"socket-1"}`); err != nil {
			t.Error(err)
			return
		}
		connected(conn, auth.Token)
	}))
	t.Cleanup(server.Close)
	return server
}

func TestSocketTerminalNotificationSurvivesImmediateDisconnect(t *testing.T) {
	for _, test := range []struct{ payload, reason string }{
		{`{"reasonCode":"token-expired"}`, "token-expired"},
		{`{"reasonCode":"denied"}`, "denied"},
		{`{"reasonCode":"unavailable"}`, "unavailable"},
		{`{"reasonCode":"unexpected"}`, "protocol-failure"},
		{`{"reasonCode":"denied","token":"must-not-project"}`, "protocol-failure"},
	} {
		t.Run(test.reason+test.payload, func(t *testing.T) {
			server := newSocketIOServer(t, func(conn *websocket.Conn, _ string) {
				_ = websocket.Message.Send(conn, `42["realtime:connection.closed",`+test.payload+`]`)
				_ = websocket.Message.Send(conn, "41")
			})
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			driver, err := dialSocketIO(ctx, server.URL, "current-token")
			if err != nil {
				t.Fatal(err)
			}
			defer driver.Close()
			select {
			case <-driver.closed:
			case <-ctx.Done():
				t.Fatal("terminal notification did not close driver")
			}
			if got := connectionCloseReason(driver.failure()); got != test.reason {
				t.Fatalf("reason = %s; want %s", got, test.reason)
			}
			if _, err := driver.EmitAck(ctx, "chat:inbox.open", map[string]any{}); connectionCloseReason(err) != test.reason {
				t.Fatalf("operation lost terminal reason: %v", err)
			}
		})
	}
}

func TestSocketIOPacketDecodingRejectsGenericShapes(t *testing.T) {
	event, err := decodeSocketEvent(`["chat:event",{"seq":2}]`)
	if err != nil || event.name != "chat:event" || string(event.payload) != `{"seq":2}` {
		t.Fatalf("event = %#v, %v", event, err)
	}
	ackID, payload, err := decodeSocketAck(`17[{"status":"ok"}]`)
	if err != nil || ackID != 17 || string(payload) != `{"status":"ok"}` {
		t.Fatalf("ack = %d %s, %v", ackID, payload, err)
	}
	if _, err := decodeSocketEvent(`{"event":"chat:event"}`); err == nil {
		t.Fatal("generic event object was accepted")
	}
}
