package endpointsec

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sort"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestServerWebSocketOmitsOriginAndPinsOriginalTLSHost(t *testing.T) {
	type seen struct {
		host, sni string
		origin    bool
	}
	observed := make(chan seen, 1)
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, origin := r.Header["Origin"]
		observed <- seen{r.Host, r.TLS.ServerName, origin}
		if origin {
			http.Error(w, "browser Origin rejected", http.StatusForbidden)
			return
		}
		conn, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer func(cleanup func() error) { _ = cleanup() }(conn.Close)
		_ = conn.WriteMessage(websocket.TextMessage, []byte("ready"))
	}))
	defer server.Close()
	host := server.Certificate().DNSNames[0]
	roots := x509.NewCertPool()
	roots.AddCert(server.Certificate())
	lookups := 0
	addresses := []string{}
	resolver := testResolver{lookup: func(context.Context, string) ([]string, error) {
		lookups++
		if lookups > 1 {
			return []string{"169.254.1.1"}, nil
		}
		return []string{"169.254.1.1", "203.0.113.10", "203.0.113.11"}, nil
	}}
	dial := func(ctx context.Context, network, address string) (net.Conn, error) {
		addresses = append(addresses, address)
		if len(addresses) == 1 {
			return nil, errors.New("first safe address unavailable")
		}
		return (&net.Dialer{}).DialContext(ctx, network, server.Listener.Addr().String())
	}
	conn, raw, err := dialServerWebSocket(context.Background(), "wss://"+host+"/live/sessions", http.Header{"Authorization": []string{"Bearer test-key"}}, false, resolver, dial, &tls.Config{RootCAs: roots, ServerName: "must-not-override.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	defer func(cleanup func() error) { _ = cleanup() }(raw.Close)
	kind, payload, err := conn.ReadMessage()
	if err != nil || kind != websocket.TextMessage || string(payload) != "ready" {
		t.Fatalf("read: %d %q %v", kind, payload, err)
	}
	sort.Strings(addresses)
	if lookups != 1 || !reflect.DeepEqual(addresses, []string{"203.0.113.10:443", "203.0.113.11:443"}) {
		t.Fatalf("unpinned: %d %v", lookups, addresses)
	}
	if got := <-observed; got.host != host || got.sni != host || got.origin {
		t.Fatalf("HTTP/TLS identity: %+v", got)
	}
}

func TestServerWebSocketRejectsUnsafeAddressAndOriginOverrides(t *testing.T) {
	for _, headers := range []http.Header{nil, {"Origin": []string{"https://runtime.nimi.local"}}, {"Host": []string{"other.invalid"}}} {
		_, _, err := dialServerWebSocket(context.Background(), "wss://blocked.invalid/", headers, false, testResolver{lookup: func(context.Context, string) ([]string, error) { return []string{"169.254.1.1", "fc00::1"}, nil }}, func(context.Context, string, string) (net.Conn, error) { t.Fatal("unsafe dial"); return nil, nil }, nil)
		if !errors.Is(err, ErrWebSocketEndpoint) {
			t.Fatalf("unexpected error: %v", err)
		}
	}
}

func TestServerWebSocketCancellationInterruptsHandshake(t *testing.T) {
	client, peer := net.Pipe()
	defer func(cleanup func() error) { _ = cleanup() }(peer.Close)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	started := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		_, _, err := dialServerWebSocket(ctx, "ws://127.0.0.1/", nil, true, testResolver{lookup: func(context.Context, string) ([]string, error) { return []string{"127.0.0.1"}, nil }}, func(context.Context, string, string) (net.Conn, error) { close(started); return client, nil }, nil)
		done <- err
	}()
	<-started
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("cancel: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("stalled handshake ignored cancellation")
	}
}

func TestServerWebSocketRetainsSafeHTTPHandshakeStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "private provider detail", http.StatusForbidden)
	}))
	defer server.Close()
	_, _, err := DialServerWebSocket(context.Background(), "ws"+server.URL[4:]+"/live", nil, true)
	var status *WebSocketHandshakeError
	if !errors.As(err, &status) || status.StatusCode != 403 || err.Error() != "provider WebSocket handshake returned HTTP 403" {
		t.Fatalf("handshake: %v", err)
	}
}
