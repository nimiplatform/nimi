package nimillm

import (
	"context"
	"net"
	"sync"
	"syscall"

	"golang.org/x/net/websocket"
)

// A finite WebSocket exchange is one admitted transport invocation, like a
// streamed HTTP request. Guard each socket handoff before connect; never hold
// account/Connector locks through its handshake, frames or response wait.
func dialProviderWebSocket(ctx context.Context, config *websocket.Config) (*websocket.Conn, error) {
	gate, ok := ctx.Value(outboundGateKey{}).(OutboundGate)
	if !ok || gate == nil {
		return config.DialContext(ctx)
	}
	copyConfig := *config
	dialer := net.Dialer{}
	if config.Dialer != nil {
		dialer = *config.Dialer
	}
	priorContext, prior := dialer.ControlContext, dialer.Control
	var admissionMu sync.Mutex
	var admissionErr error
	dialer.ControlContext = func(inner context.Context, network, address string, raw syscall.RawConn) error {
		err := gate(inner, func() error {
			if priorContext != nil {
				return priorContext(inner, network, address, raw)
			}
			if prior != nil {
				return prior(network, address, raw)
			}
			return nil
		})
		if err != nil {
			admissionMu.Lock()
			admissionErr = err
			admissionMu.Unlock()
		}
		return err
	}
	copyConfig.Dialer = &dialer
	conn, err := copyConfig.DialContext(ctx)
	admissionMu.Lock()
	defer admissionMu.Unlock()
	if err != nil && admissionErr != nil {
		return nil, admissionErr
	}
	return conn, err
}
