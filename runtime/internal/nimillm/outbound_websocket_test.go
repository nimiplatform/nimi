package nimillm

import (
	"context"
	"errors"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"golang.org/x/net/websocket"
)

func TestWebSocketGateRejectsFreshConnectionAndAllowsHandedOffResponse(t *testing.T) {
	var accepted atomic.Int32
	respond := make(chan struct{})
	server := httptest.NewServer(websocket.Handler(func(conn *websocket.Conn) {
		accepted.Add(1)
		<-respond
		websocket.Message.Send(conn, "original-response")
	}))
	defer server.Close()
	config, err := websocket.NewConfig("ws"+strings.TrimPrefix(server.URL, "http"), server.URL)
	if err != nil {
		t.Fatal(err)
	}
	var mu sync.Mutex
	disabled := false
	denied := errors.New("original Connector disabled")
	ctx := WithOutboundGate(context.Background(), func(ctx context.Context, begin func() error) error {
		mu.Lock()
		defer mu.Unlock()
		if disabled {
			return denied
		}
		return begin()
	})
	first, err := dialProviderWebSocket(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	mutated := make(chan struct{})
	go func() { mu.Lock(); disabled = true; mu.Unlock(); close(mutated) }()
	select {
	case <-mutated:
	case <-time.After(time.Second):
		t.Fatal("WebSocket response wait held Connector guard")
	}
	if second, err := dialProviderWebSocket(ctx, config); !errors.Is(err, denied) {
		if second != nil {
			second.Close()
		}
		t.Fatalf("fresh connection passed disabled guard: %v", err)
	}
	close(respond)
	var message string
	if err := websocket.Message.Receive(first, &message); err != nil || message != "original-response" {
		t.Fatalf("already handed-off IO lost response: %q %v", message, err)
	}
	if accepted.Load() != 1 {
		t.Fatalf("fresh denied socket reached provider: %d", accepted.Load())
	}
}
