package realmrealtime

import (
	"testing"
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
