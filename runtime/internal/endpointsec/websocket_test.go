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
	"testing"
	"time"

	"golang.org/x/net/websocket"
)

func TestWebSocketPinsValidatedAddressesAndPreservesTLSAndHost(t *testing.T) {
	type observation struct{ host, sni string }
	observed := make(chan observation, 1)
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		observed <- observation{r.Host, r.TLS.ServerName}
		websocket.Handler(func(conn *websocket.Conn) { _ = websocket.Message.Send(conn, "ready") }).ServeHTTP(w, r)
	}))
	defer server.Close()
	host := server.Certificate().DNSNames[0]
	config, err := websocket.NewConfig("wss://"+host+"/realtime", "https://runtime.nimi.local")
	if err != nil {
		t.Fatal(err)
	}
	roots := x509.NewCertPool()
	roots.AddCert(server.Certificate())
	config.TlsConfig = &tls.Config{RootCAs: roots, ServerName: "must-not-override-original-host.invalid"}
	lookups := 0
	resolver := testResolver{lookup: func(context.Context, string) ([]string, error) {
		lookups++
		if lookups > 1 {
			return []string{"169.254.1.1"}, nil
		}
		return []string{"169.254.1.1", "203.0.113.10", "203.0.113.11"}, nil
	}}
	var addresses []string
	dial := func(ctx context.Context, network, address string) (net.Conn, error) {
		addresses = append(addresses, address)
		if len(addresses) == 1 {
			return nil, errors.New("first safe address unavailable")
		}
		return (&net.Dialer{}).DialContext(ctx, network, server.Listener.Addr().String())
	}
	conn, raw, err := dialWebSocket(context.Background(), config, false, resolver, dial)
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	var ready string
	if err := websocket.Message.Receive(conn, &ready); err != nil || ready != "ready" {
		t.Fatalf("frame: %q %v", ready, err)
	}
	if lookups != 1 || !reflect.DeepEqual(addresses, []string{"203.0.113.10:443", "203.0.113.11:443"}) {
		t.Fatalf("lookups=%d dial=%v", lookups, addresses)
	}
	if got := <-observed; got.host != host || got.sni != host {
		t.Fatalf("host/SNI changed: %+v", got)
	}
}

func TestWebSocketRejectsUnsafeAddressesBeforeDial(t *testing.T) {
	config, _ := websocket.NewConfig("wss://blocked.invalid/", "https://runtime.nimi.local")
	_, _, err := dialWebSocket(context.Background(), config, false, testResolver{lookup: func(context.Context, string) ([]string, error) {
		return []string{"169.254.1.1", "::", "fc00::1"}, nil
	}}, func(context.Context, string, string) (net.Conn, error) { t.Fatal("unsafe dial"); return nil, nil })
	if err == nil {
		t.Fatal("unsafe endpoint accepted")
	}
}

func TestWebSocketCancellationInterruptsHandshake(t *testing.T) {
	client, peer := net.Pipe()
	defer peer.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	started := make(chan struct{})
	config, _ := websocket.NewConfig("ws://127.0.0.1/", "http://localhost")
	done := make(chan error, 1)
	go func() {
		_, _, err := dialWebSocket(ctx, config, true, testResolver{lookup: func(context.Context, string) ([]string, error) { return []string{"127.0.0.1"}, nil }}, func(context.Context, string, string) (net.Conn, error) {
			close(started)
			return client, nil
		})
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
		t.Fatal("handshake did not cancel")
	}
}
