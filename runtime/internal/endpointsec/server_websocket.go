package endpointsec

import (
	"context"
	"crypto/tls"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

type WebSocketHandshakeError struct{ StatusCode int }

func (e *WebSocketHandshakeError) Error() string {
	return fmt.Sprintf("provider WebSocket handshake returned HTTP %d", e.StatusCode)
}

// @nimi-authority: rule.nimi.runtime.security-core.r034
// DialServerWebSocket uses the same validated, pinned destination and original
// TLS name as HTTP. Server API-key clients do not invent a browser Origin.
func DialServerWebSocket(ctx context.Context, endpoint string, headers http.Header, allowLoopback bool) (*websocket.Conn, net.Conn, error) {
	return dialServerWebSocket(ctx, endpoint, headers, allowLoopback, net.DefaultResolver, nil, nil)
}

func dialServerWebSocket(ctx context.Context, endpoint string, headers http.Header, allowLoopback bool, resolver hostResolver, dial dialContextFunc, security *tls.Config) (*websocket.Conn, net.Conn, error) {
	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.Scheme != "wss" && parsed.Scheme != "ws" {
		return nil, nil, fmt.Errorf("%w: invalid server WebSocket URL", ErrWebSocketEndpoint)
	}
	for key := range headers {
		if strings.EqualFold(key, "Host") || strings.EqualFold(key, "Origin") {
			return nil, nil, fmt.Errorf("%w: server WebSocket Host or Origin override", ErrWebSocketEndpoint)
		}
	}
	validated := *parsed
	if parsed.Scheme == "wss" {
		validated.Scheme = "https"
	} else {
		validated.Scheme = "http"
	}
	bounded, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	validatedURL, addresses, err := resolveValidatedEndpoint(bounded, resolver, validated.String(), allowLoopback)
	if err != nil {
		return nil, nil, fmt.Errorf("%w: %w", ErrWebSocketEndpoint, err)
	}
	if dial == nil {
		dial = (&net.Dialer{Timeout: 10 * time.Second}).DialContext
	}
	pinned := newPinnedTransport(validatedURL, addresses, dial)
	if security != nil {
		pinned.TLSClientConfig = security.Clone()
		pinned.TLSClientConfig.ServerName = validatedURL.Hostname()
		if pinned.TLSClientConfig.MinVersion < tls.VersionTLS12 {
			pinned.TLSClientConfig.MinVersion = tls.VersionTLS12
		}
	}
	var raw net.Conn
	var stop func() bool
	interrupted := make(chan struct{})
	dialer := websocket.Dialer{NetDialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
		socket, dialErr := pinned.DialContext(ctx, network, address)
		if dialErr == nil {
			raw = socket
			stop = context.AfterFunc(bounded, func() { _ = socket.Close(); close(interrupted) })
		}
		return socket, dialErr
	}, TLSClientConfig: pinned.TLSClientConfig, HandshakeTimeout: 10 * time.Second}
	conn, response, err := dialer.DialContext(bounded, endpoint, headers)
	if stop != nil && !stop() {
		<-interrupted
	}
	if bounded.Err() != nil {
		if raw != nil {
			_ = raw.Close()
		}
		if response != nil && response.Body != nil {
			_ = response.Body.Close()
		}
		return nil, nil, bounded.Err()
	}
	if err != nil {
		if response != nil {
			if response.Body != nil {
				_ = response.Body.Close()
			}
			return nil, nil, &WebSocketHandshakeError{StatusCode: response.StatusCode}
		}
		if bounded.Err() != nil {
			return nil, nil, bounded.Err()
		}
		return nil, nil, err
	}
	conn.SetReadLimit(32 << 20)
	return conn, raw, nil
}
