//go:build windows

package protectedlocal

import (
	"context"
	"errors"
	"fmt"
	"net"
	"sync"
)

func OpenWindowsVerifiedInstalledListener(ctx context.Context, state *WindowsRuntimeSecurityState, verifier WindowsExecutableTrustVerifier) (net.Listener, error) {
	profile := mustActiveWindowsRuntimeProfile()
	if ctx == nil || state == nil || verifier == nil || state.installedLaunches == nil {
		return nil, verifiedWindowsListenerFailure("open verified installed listener", fmt.Errorf("complete Windows installed transport authority is required"))
	}
	if state.principal.serviceSID != profile.serviceSID || state.process.validate() != nil || state.desktopIdentity.validate() != nil {
		return nil, verifiedWindowsListenerFailure("open verified installed listener", fmt.Errorf("verified Runtime and Desktop identity are required"))
	}
	state.transportMu.Lock()
	defer state.transportMu.Unlock()
	if state.closed || state.installedTransport != nil {
		return nil, verifiedWindowsListenerFailure("open verified installed listener", fmt.Errorf("installed listener is closed or already claimed"))
	}
	initial, err := createWindowsDesktopPipeInstance(ctx, profile.installedPipeName, state.principal, state.desktopIdentity, true)
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
	listener := &windowsVerifiedInstalledListener{ctx: listenerCtx, cancel: cancel, state: state, verifier: verifier, developmentVerifier: developmentVerifier, initial: initial}
	state.installedTransport = listener
	return listener, nil
}

type windowsVerifiedInstalledListener struct {
	ctx                 context.Context
	cancel              context.CancelFunc
	state               *WindowsRuntimeSecurityState
	verifier            WindowsExecutableTrustVerifier
	developmentVerifier LocalDevelopmentProcessVerifier

	mu      sync.Mutex
	initial *WindowsDesktopPipeInstance
	closed  bool
	active  map[*windowsVerifiedInstalledNetConn]struct{}

	closeOnce sync.Once
	closeErr  error
}

func (listener *windowsVerifiedInstalledListener) Accept() (net.Conn, error) {
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
		expected, policy, development, bound := listener.state.installedLaunches.BoundProcessPolicy(native.ClientProcessID())
		var peer ProcessTuple
		var pipeLiveness DesktopProcessLiveness
		if bound && development {
			developmentVerifier := listener.developmentVerifier
			if developmentVerifier == nil {
				developmentVerifier, err = NewWindowsLocalDevelopmentProcessVerifier(listener.state.desktopIdentity)
			}
			if err == nil {
				peer, pipeLiveness, err = native.verifyAndBindLocalDevelopmentClientProcess(listener.ctx, developmentVerifier, policy, expected)
			}
		} else {
			peer, pipeLiveness, err = native.verifyAndBindClientProcessForRole(listener.ctx, listener.verifier, WindowsExecutableRoleInstalled, WindowsInstalledReleaseTrustSetID)
		}
		if err != nil {
			_ = native.Close()
			continue
		}
		raw, err := native.NetConn()
		if err != nil {
			_ = pipeLiveness.Close()
			_ = native.Close()
			continue
		}
		promoted, err := listener.state.installedLaunches.Promote(peer, pipeLiveness)
		if err != nil {
			_ = raw.Close()
			continue
		}
		connection, err := EstablishInstalledLaunchConnection(listener.ctx, staticInstalledPeerVerifier{peer: promoted})
		if err != nil {
			_ = raw.Close()
			continue
		}
		verified := &windowsVerifiedInstalledNetConn{Conn: raw, connection: connection, listener: listener}
		if !listener.track(verified) {
			connection.Revoke()
			_ = raw.Close()
			return nil, net.ErrClosed
		}
		connection.OnRevoke(func() { _ = verified.closeTransport() })
		return verified, nil
	}
}

func (listener *windowsVerifiedInstalledListener) nextPipe() (*WindowsDesktopPipeInstance, error) {
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
	return createWindowsDesktopPipeInstance(listener.ctx, mustActiveWindowsRuntimeProfile().installedPipeName, listener.state.principal, listener.state.desktopIdentity, false)
}

func (listener *windowsVerifiedInstalledListener) track(connection *windowsVerifiedInstalledNetConn) bool {
	listener.mu.Lock()
	defer listener.mu.Unlock()
	if listener.closed {
		return false
	}
	if listener.active == nil {
		listener.active = make(map[*windowsVerifiedInstalledNetConn]struct{})
	}
	listener.active[connection] = struct{}{}
	return true
}

func (listener *windowsVerifiedInstalledListener) release(connection *windowsVerifiedInstalledNetConn) {
	listener.mu.Lock()
	delete(listener.active, connection)
	listener.mu.Unlock()
}

func (listener *windowsVerifiedInstalledListener) isClosed() bool {
	listener.mu.Lock()
	defer listener.mu.Unlock()
	return listener.closed
}

func (listener *windowsVerifiedInstalledListener) Close() error {
	if listener == nil {
		return nil
	}
	listener.closeOnce.Do(func() {
		listener.cancel()
		listener.mu.Lock()
		listener.closed = true
		initial := listener.initial
		listener.initial = nil
		active := make([]*windowsVerifiedInstalledNetConn, 0, len(listener.active))
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

func (*windowsVerifiedInstalledListener) Addr() net.Addr {
	return windowsDesktopPipeAddress(mustActiveWindowsRuntimeProfile().installedPipeName)
}

type staticInstalledPeerVerifier struct{ peer VerifiedInstalledLaunchPeer }

func (verifier staticInstalledPeerVerifier) VerifyInstalledLaunchPeer(context.Context) (VerifiedInstalledLaunchPeer, error) {
	return verifier.peer, nil
}

type windowsVerifiedInstalledNetConn struct {
	net.Conn
	connection *InstalledLaunchConnection
	listener   *windowsVerifiedInstalledListener
	closeOnce  sync.Once
	closeErr   error
}

func (connection *windowsVerifiedInstalledNetConn) nativeInstalledConnection() *InstalledLaunchConnection {
	if connection == nil {
		return nil
	}
	return connection.connection
}

func (connection *windowsVerifiedInstalledNetConn) Close() error {
	if connection != nil && connection.connection != nil {
		connection.connection.Revoke()
	}
	return connection.closeTransport()
}

func (connection *windowsVerifiedInstalledNetConn) closeTransport() error {
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

var _ net.Listener = (*windowsVerifiedInstalledListener)(nil)
