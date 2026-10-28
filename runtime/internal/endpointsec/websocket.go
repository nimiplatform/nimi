package endpointsec

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"strings"
	"time"

	"golang.org/x/net/websocket"
)

var ErrWebSocketEndpoint = errors.New("WebSocket endpoint is not permitted")

// DialWebSocket resolves once at dispatch and connects only to that validated
// address set. The returned transport belongs to the caller: closing it directly
// interrupts a blocked frame writer without waiting for a WebSocket close frame.
// @nimi-authority: rule.nimi.runtime.security-core.r034
func DialWebSocket(ctx context.Context, config *websocket.Config, allowLoopback bool) (*websocket.Conn, net.Conn, error) {
	return dialWebSocket(ctx, config, allowLoopback, net.DefaultResolver, nil)
}

func dialWebSocket(ctx context.Context, config *websocket.Config, allowLoopback bool, resolver hostResolver, dial dialContextFunc) (*websocket.Conn, net.Conn, error) {
	if config == nil || config.Location == nil || config.Origin == nil {
		return nil, nil, fmt.Errorf("%w: incomplete configuration", ErrWebSocketEndpoint)
	}
	endpoint := *config.Location
	switch strings.ToLower(endpoint.Scheme) {
	case "wss":
		endpoint.Scheme = "https"
	case "ws":
		endpoint.Scheme = "http"
	default:
		return nil, nil, fmt.Errorf("%w: unsupported scheme", ErrWebSocketEndpoint)
	}
	// Bound connection and handshake work even when the session lifetime has no
	// deadline. A successful connection is detached from this handshake context.
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	parsed, addresses, err := resolveValidatedEndpoint(ctx, resolver, endpoint.String(), allowLoopback)
	if err != nil {
		return nil, nil, fmt.Errorf("%w: %w", ErrWebSocketEndpoint, err)
	}
	if dial == nil {
		dialer := &net.Dialer{Timeout: 10 * time.Second}
		if config.Dialer != nil {
			copy := *config.Dialer
			dialer = &copy
		}
		dial = dialer.DialContext
	}
	port := parsed.Port()
	if port == "" {
		port = "443"
		if parsed.Scheme == "http" {
			port = "80"
		}
	}
	var transport net.Conn
	for _, address := range addresses {
		transport, err = dial(ctx, "tcp", net.JoinHostPort(address, port))
		if err == nil {
			break
		}
		if ctx.Err() != nil {
			return nil, nil, ctx.Err()
		}
	}
	if err != nil {
		return nil, nil, err
	}
	raw := transport
	interrupted := make(chan struct{})
	stop := context.AfterFunc(ctx, func() {
		_ = raw.Close()
		close(interrupted)
	})
	if parsed.Scheme == "https" {
		security := &tls.Config{MinVersion: tls.VersionTLS12}
		if config.TlsConfig != nil {
			security = config.TlsConfig.Clone()
			if security.MinVersion < tls.VersionTLS12 {
				security.MinVersion = tls.VersionTLS12
			}
		}
		security.ServerName = parsed.Hostname()
		transport = tls.Client(raw, security)
	}
	// NewClient retains config.Location for HTTP Host and protocol negotiation;
	// only the socket destination is replaced with a validated address.
	conn, handshakeErr := websocket.NewClient(config, transport)
	if !stop() {
		<-interrupted
	}
	if ctx.Err() != nil {
		_ = raw.Close()
		return nil, nil, ctx.Err()
	}
	if handshakeErr != nil {
		_ = raw.Close()
		return nil, nil, handshakeErr
	}
	return conn, raw, nil
}
