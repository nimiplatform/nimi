//go:build windows && !nimi_windows_source_local_development

package protectedlocal

import (
	"context"
	"errors"
	"fmt"
	"net"
	"sync"
)

func OpenWindowsVerifiedLocalAppListener(ctx context.Context, state *WindowsRuntimeSecurityState) (net.Listener, error) {
	profile := mustActiveWindowsRuntimeProfile()
	if ctx == nil || state == nil || state.localAppLaunches == nil {
		return nil, verifiedWindowsListenerFailure("open verified local-app listener", fmt.Errorf("complete Windows local-app transport authority is required"))
	}
	if state.principal.serviceSID != profile.serviceSID || state.process.validate() != nil || state.desktopIdentity.validate() != nil {
		return nil, verifiedWindowsListenerFailure("open verified local-app listener", fmt.Errorf("verified Runtime and Desktop identity are required"))
	}
	state.transportMu.Lock()
	defer state.transportMu.Unlock()
	if state.closed || state.localAppTransport != nil {
		return nil, verifiedWindowsListenerFailure("open verified local-app listener", fmt.Errorf("local-app listener is closed or already claimed"))
	}
	initial, err := createWindowsLocalAppPipeInstance(ctx, profile.localAppPipeName, state.principal, state.desktopIdentity, true)
	if err != nil {
		return nil, err
	}
	listenerCtx, cancel := context.WithCancel(ctx)
	developmentVerifier, err := NewWindowsLocalDevelopmentProcessVerifier(state.desktopIdentity)
	if err != nil {
		_ = initial.Close()
		cancel()
		return nil, err
	}
	listener := &windowsVerifiedLocalAppListener{ctx: listenerCtx, cancel: cancel, state: state, developmentVerifier: developmentVerifier, initial: initial}
	state.localAppTransport = listener
	return listener, nil
}

type windowsVerifiedLocalAppListener struct {
	ctx                 context.Context
	cancel              context.CancelFunc
	state               *WindowsRuntimeSecurityState
	developmentVerifier LocalDevelopmentProcessVerifier

	mu      sync.Mutex
	initial *WindowsDesktopPipeInstance
	closed  bool
	active  map[*windowsVerifiedLocalAppNetConn]struct{}

	closeOnce sync.Once
	closeErr  error
}

func (listener *windowsVerifiedLocalAppListener) Accept() (net.Conn, error) {
	if listener == nil {
		return nil, net.ErrClosed
	}
	for {
		pipe, err := listener.nextPipe()
		if err != nil {
			return nil, err
		}
		native, err := pipe.Accept(listener.ctx)
		if err != nil {
			_ = pipe.Close()
			if listener.isClosed() {
				return nil, net.ErrClosed
			}
			continue
		}
		expected, policy, bound := listener.state.localAppLaunches.BoundProcessPolicy(native.ClientProcessID())
		var peer ProcessTuple
		var pipeLiveness DesktopProcessLiveness
		if bound {
			developmentVerifier := listener.developmentVerifier
			if developmentVerifier == nil {
				developmentVerifier, err = NewWindowsLocalDevelopmentProcessVerifier(listener.state.desktopIdentity)
			}
			if err == nil {
				peer, pipeLiveness, err = native.verifyAndBindLocalDevelopmentClientProcess(listener.ctx, developmentVerifier, policy, expected)
			}
		} else {
			err = fmt.Errorf("local-app pipe peer has no supervised launch binding")
		}
		if err != nil {
			reportWindowsPeerRejection(err)
			_ = native.Close()
			continue
		}
		raw, err := native.NetConn()
		if err != nil {
			reportWindowsPeerRejection(err)
			_ = pipeLiveness.Close()
			_ = native.Close()
			continue
		}
		promoted, err := listener.state.localAppLaunches.Promote(peer, pipeLiveness)
		if err != nil {
			_ = raw.Close()
			continue
		}
		connection, err := EstablishLocalAppConnection(listener.ctx, staticLocalAppPeerVerifier{peer: promoted})
		if err != nil {
			_ = raw.Close()
			continue
		}
		verified := &windowsVerifiedLocalAppNetConn{Conn: raw, connection: connection, listener: listener}
		if !listener.track(verified) {
			connection.Revoke()
			_ = raw.Close()
			return nil, net.ErrClosed
		}
		connection.OnRevoke(func() { _ = verified.closeTransport() })
		return verified, nil
	}
}

func (listener *windowsVerifiedLocalAppListener) nextPipe() (*WindowsDesktopPipeInstance, error) {
	listener.mu.Lock()
	if listener.closed {
		listener.mu.Unlock()
		return nil, net.ErrClosed
	}
	if listener.initial != nil {
		pipe := listener.initial
		listener.initial = nil
		listener.mu.Unlock()
		return pipe, nil
	}
	listener.mu.Unlock()
	return createWindowsLocalAppPipeInstance(listener.ctx, mustActiveWindowsRuntimeProfile().localAppPipeName, listener.state.principal, listener.state.desktopIdentity, false)
}

func (listener *windowsVerifiedLocalAppListener) track(connection *windowsVerifiedLocalAppNetConn) bool {
	listener.mu.Lock()
	defer listener.mu.Unlock()
	if listener.closed {
		return false
	}
	if listener.active == nil {
		listener.active = make(map[*windowsVerifiedLocalAppNetConn]struct{})
	}
	listener.active[connection] = struct{}{}
	return true
}

func (listener *windowsVerifiedLocalAppListener) release(connection *windowsVerifiedLocalAppNetConn) {
	listener.mu.Lock()
	delete(listener.active, connection)
	listener.mu.Unlock()
}

func (listener *windowsVerifiedLocalAppListener) isClosed() bool {
	listener.mu.Lock()
	defer listener.mu.Unlock()
	return listener.closed
}

func (listener *windowsVerifiedLocalAppListener) Close() error {
	if listener == nil {
		return nil
	}
	listener.closeOnce.Do(func() {
		listener.cancel()
		listener.mu.Lock()
		listener.closed = true
		initial := listener.initial
		listener.initial = nil
		active := make([]*windowsVerifiedLocalAppNetConn, 0, len(listener.active))
		for connection := range listener.active {
			active = append(active, connection)
		}
		listener.mu.Unlock()
		var failures []error
		if initial != nil {
			failures = append(failures, initial.Close())
		}
		for _, connection := range active {
			failures = append(failures, connection.Close())
		}
		listener.closeErr = errors.Join(failures...)
	})
	return listener.closeErr
}

func (*windowsVerifiedLocalAppListener) Addr() net.Addr {
	return windowsDesktopPipeAddress(mustActiveWindowsRuntimeProfile().localAppPipeName)
}

type windowsVerifiedLocalAppNetConn struct {
	net.Conn
	connection *LocalAppConnection
	listener   *windowsVerifiedLocalAppListener
	closeOnce  sync.Once
	closeErr   error
}

func (connection *windowsVerifiedLocalAppNetConn) nativeLocalAppConnection() *LocalAppConnection {
	if connection == nil {
		return nil
	}
	return connection.connection
}

func (connection *windowsVerifiedLocalAppNetConn) Close() error {
	if connection != nil && connection.connection != nil {
		connection.connection.Revoke()
	}
	return connection.closeTransport()
}

func (connection *windowsVerifiedLocalAppNetConn) closeTransport() error {
	if connection == nil {
		return nil
	}
	connection.closeOnce.Do(func() {
		if connection.Conn != nil {
			connection.closeErr = connection.Conn.Close()
		}
		if connection.listener != nil {
			connection.listener.release(connection)
		}
	})
	return connection.closeErr
}

var _ net.Listener = (*windowsVerifiedLocalAppListener)(nil)
