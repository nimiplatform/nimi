//go:build darwin && cgo

package protectedlocal

import (
	"context"
	"errors"
	"fmt"
	"net"
	"sync"
)

type MacOSVerifiedDesktopListener struct {
	ctx    context.Context
	cancel context.CancelFunc
	raw    *net.UnixListener
	state  *MacOSRuntimeSecurityState

	mu         sync.Mutex
	primed     net.Conn
	active     *macOSVerifiedDesktopNetConn
	activeDone chan struct{}
	closed     bool
	closeOnce  sync.Once
	closeErr   error
}

func OpenMacOSVerifiedDesktopListener(ctx context.Context, state *MacOSRuntimeSecurityState) (*MacOSVerifiedDesktopListener, error) {
	if ctx == nil || state == nil || state.serviceUID == 0 {
		return nil, fail(ReasonProtectedLocalTransportUnsupported, false, "repair_runtime_service", fmt.Errorf("verified macOS Runtime security state is required"))
	}
	raw, err := openMacOSRuntimeSocket(MacOSDesktopSocketActivationName, MacOSDesktopSocketPath, state.serviceUID)
	if err != nil {
		return nil, err
	}
	listenerContext, cancel := context.WithCancel(ctx)
	listener := &MacOSVerifiedDesktopListener{ctx: listenerContext, cancel: cancel, raw: raw, state: state}
	state.transportMu.Lock()
	defer state.transportMu.Unlock()
	if state.closed || state.desktopTransport != nil {
		cancel()
		_ = raw.Close()
		return nil, fail(ReasonProtectedLocalTransportUnsupported, false, "repair_runtime_service", fmt.Errorf("macOS Desktop listener is closed or already claimed"))
	}
	state.desktopTransport = listener
	return listener, nil
}

// Prime verifies the first queued Desktop connection before protected service
// construction, allowing the system daemon to derive one exact interactive
// user/audit-session partition without consulting a user-controlled source.
func (listener *MacOSVerifiedDesktopListener) Prime(ctx context.Context) error {
	if listener == nil {
		return net.ErrClosed
	}
	connection, err := listener.acceptVerified(ctx)
	if err != nil {
		return err
	}
	listener.mu.Lock()
	defer listener.mu.Unlock()
	if listener.closed || listener.primed != nil {
		_ = connection.Close()
		return fail(ReasonDesktopProcessVerificationUnavailable, false, "restart_runtime_service", fmt.Errorf("macOS Desktop listener cannot be primed twice"))
	}
	listener.primed = connection
	return nil
}

func (listener *MacOSVerifiedDesktopListener) Accept() (net.Conn, error) {
	if listener == nil {
		return nil, net.ErrClosed
	}
	listener.mu.Lock()
	if listener.primed != nil {
		connection := listener.primed
		listener.primed = nil
		listener.mu.Unlock()
		return connection, nil
	}
	listener.mu.Unlock()
	return listener.acceptVerified(listener.ctx)
}

func (listener *MacOSVerifiedDesktopListener) acceptVerified(ctx context.Context) (net.Conn, error) {
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if listener.isClosed() {
			return nil, net.ErrClosed
		}
		raw, err := listener.raw.AcceptUnix()
		if err != nil {
			if listener.isClosed() {
				return nil, net.ErrClosed
			}
			continue
		}
		audit, err := macOSPeerIdentityFromUnixConn(raw)
		if err != nil {
			reportMacOSDesktopPeerRejection("peer-identity", err)
			_ = raw.Close()
			continue
		}
		client, process, err := verifyConnectedMacOSDesktop(audit, listener.state.expectedDesktopExecutable)
		if err != nil {
			reportMacOSDesktopPeerRejection("desktop-process", err)
			_ = raw.Close()
			continue
		}
		if err := listener.state.BindInteractiveIdentity(audit); err != nil {
			reportMacOSDesktopPeerRejection("interactive-identity", err)
			_ = raw.Close()
			_ = listener.Close()
			return nil, err
		}
		desktopConnection, err := newDirectDesktopConnectionWithClient(client, process, nil)
		if err != nil {
			reportMacOSDesktopPeerRejection("desktop-connection", err)
			_ = raw.Close()
			continue
		}
		verified := &macOSVerifiedDesktopNetConn{Conn: raw, connection: desktopConnection, listener: listener}
		replaced, activated := listener.activate(verified)
		if !activated {
			desktopConnection.Revoke()
			_ = raw.Close()
			continue
		}
		if replaced != nil {
			replaced.connection.Revoke()
			_ = replaced.closeTransport()
		}
		desktopConnection.onRevoke(func() { _ = verified.closeTransport() })
		return verified, nil
	}
}

func (listener *MacOSVerifiedDesktopListener) activate(connection *macOSVerifiedDesktopNetConn) (*macOSVerifiedDesktopNetConn, bool) {
	listener.mu.Lock()
	defer listener.mu.Unlock()
	if listener.closed || connection == nil || connection.connection == nil {
		return nil, false
	}
	previous := listener.active
	// A failed HTTP/2 channel can remain open at the Unix socket layer. Admit
	// replacement only after the new connection independently verifies as the
	// exact same OS process; a different Desktop process never displaces it.
	if previous != nil && !sameMacOSDesktopPeer(previous, connection) {
		return nil, false
	}
	if listener.activeDone != nil {
		close(listener.activeDone)
	}
	listener.active = connection
	listener.activeDone = make(chan struct{})
	return previous, true
}

func sameMacOSDesktopPeer(left, right *macOSVerifiedDesktopNetConn) bool {
	if left == nil || right == nil || left.connection == nil || right.connection == nil {
		return false
	}
	leftPeer, leftOK := left.connection.DirectDesktopPeer()
	rightPeer, rightOK := right.connection.DirectDesktopPeer()
	return leftOK && rightOK && leftPeer == rightPeer
}

func (listener *MacOSVerifiedDesktopListener) release(connection *macOSVerifiedDesktopNetConn) {
	listener.mu.Lock()
	if listener.active == connection {
		listener.active = nil
		close(listener.activeDone)
		listener.activeDone = nil
	}
	listener.mu.Unlock()
}

func (listener *MacOSVerifiedDesktopListener) isClosed() bool {
	listener.mu.Lock()
	defer listener.mu.Unlock()
	return listener.closed
}

func (listener *MacOSVerifiedDesktopListener) Close() error {
	if listener == nil {
		return nil
	}
	listener.closeOnce.Do(func() {
		listener.cancel()
		listener.mu.Lock()
		listener.closed = true
		primed := listener.primed
		active := listener.active
		listener.primed = nil
		listener.mu.Unlock()
		listener.closeErr = errors.Join(listener.raw.Close(), closeNetConn(primed), closeNetConn(active))
	})
	return listener.closeErr
}

func (listener *MacOSVerifiedDesktopListener) Addr() net.Addr {
	if listener == nil || listener.raw == nil {
		return &net.UnixAddr{Name: MacOSDesktopSocketPath, Net: "unix"}
	}
	return listener.raw.Addr()
}

type macOSVerifiedDesktopNetConn struct {
	net.Conn
	connection *Connection
	listener   *MacOSVerifiedDesktopListener
	closeOnce  sync.Once
	closeErr   error
}

func (connection *macOSVerifiedDesktopNetConn) nativeDesktopConnection() *Connection {
	if connection == nil {
		return nil
	}
	return connection.connection
}
func (connection *macOSVerifiedDesktopNetConn) Close() error {
	if connection != nil && connection.connection != nil {
		connection.connection.Revoke()
	}
	return connection.closeTransport()
}
func (connection *macOSVerifiedDesktopNetConn) closeTransport() error {
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

type MacOSVerifiedLocalAppListener struct {
	ctx       context.Context
	cancel    context.CancelFunc
	raw       *net.UnixListener
	state     *MacOSRuntimeSecurityState
	mu        sync.Mutex
	closed    bool
	active    map[*macOSVerifiedLocalAppNetConn]struct{}
	closeOnce sync.Once
	closeErr  error
}

func OpenMacOSVerifiedLocalAppListener(ctx context.Context, state *MacOSRuntimeSecurityState) (*MacOSVerifiedLocalAppListener, error) {
	if ctx == nil || state == nil || state.localAppLaunches == nil {
		return nil, fail(ReasonProtectedLocalTransportUnsupported, false, "repair_runtime_service", fmt.Errorf("verified macOS local-app authority is required"))
	}
	raw, err := openMacOSRuntimeSocket(MacOSLocalAppSocketActivationName, MacOSLocalAppSocketPath, state.serviceUID)
	if err != nil {
		return nil, err
	}
	listenerContext, cancel := context.WithCancel(ctx)
	listener := &MacOSVerifiedLocalAppListener{ctx: listenerContext, cancel: cancel, raw: raw, state: state}
	state.transportMu.Lock()
	defer state.transportMu.Unlock()
	if state.closed || state.localAppTransport != nil {
		cancel()
		_ = raw.Close()
		return nil, fail(ReasonProtectedLocalTransportUnsupported, false, "repair_runtime_service", fmt.Errorf("macOS local-app listener is closed or already claimed"))
	}
	state.localAppTransport = listener
	return listener, nil
}

func (listener *MacOSVerifiedLocalAppListener) Accept() (net.Conn, error) {
	if listener == nil {
		return nil, net.ErrClosed
	}
	for {
		raw, err := listener.raw.AcceptUnix()
		if err != nil {
			if listener.isClosed() {
				return nil, net.ErrClosed
			}
			continue
		}
		audit, err := macOSPeerIdentityFromUnixConn(raw)
		if err != nil {
			_ = raw.Close()
			continue
		}
		euid, session, _, boundIdentity := listener.state.InteractiveIdentity()
		if !boundIdentity || audit.euid != euid || audit.auditSession != session {
			_ = raw.Close()
			continue
		}
		launch, err := listener.state.localAppLaunches.Consume(audit.pid, audit.euid)
		if err != nil {
			_ = raw.Close()
			continue
		}
		peer, err := verifyConnectedMacOSLocalApp(audit, launch)
		if err != nil {
			_ = raw.Close()
			continue
		}
		connection, err := newDirectLocalAppConnection(peer, launch)
		if err != nil {
			_ = raw.Close()
			continue
		}
		verified := &macOSVerifiedLocalAppNetConn{Conn: raw, connection: connection, listener: listener}
		if !listener.track(verified) {
			connection.Revoke()
			_ = raw.Close()
			return nil, net.ErrClosed
		}
		connection.OnRevoke(func() { _ = verified.closeTransport() })
		return verified, nil
	}
}

func (listener *MacOSVerifiedLocalAppListener) track(connection *macOSVerifiedLocalAppNetConn) bool {
	listener.mu.Lock()
	defer listener.mu.Unlock()
	if listener.closed {
		return false
	}
	if listener.active == nil {
		listener.active = make(map[*macOSVerifiedLocalAppNetConn]struct{})
	}
	listener.active[connection] = struct{}{}
	return true
}
func (listener *MacOSVerifiedLocalAppListener) release(connection *macOSVerifiedLocalAppNetConn) {
	listener.mu.Lock()
	delete(listener.active, connection)
	listener.mu.Unlock()
}
func (listener *MacOSVerifiedLocalAppListener) isClosed() bool {
	listener.mu.Lock()
	defer listener.mu.Unlock()
	return listener.closed
}
func (listener *MacOSVerifiedLocalAppListener) Close() error {
	if listener == nil {
		return nil
	}
	listener.closeOnce.Do(func() {
		listener.cancel()
		listener.mu.Lock()
		listener.closed = true
		active := make([]*macOSVerifiedLocalAppNetConn, 0, len(listener.active))
		for connection := range listener.active {
			active = append(active, connection)
		}
		listener.mu.Unlock()
		failures := []error{listener.raw.Close()}
		for _, connection := range active {
			failures = append(failures, connection.Close())
		}
		listener.closeErr = errors.Join(failures...)
	})
	return listener.closeErr
}
func (listener *MacOSVerifiedLocalAppListener) Addr() net.Addr {
	if listener == nil || listener.raw == nil {
		return &net.UnixAddr{Name: MacOSLocalAppSocketPath, Net: "unix"}
	}
	return listener.raw.Addr()
}

type macOSVerifiedLocalAppNetConn struct {
	net.Conn
	connection *LocalAppConnection
	listener   *MacOSVerifiedLocalAppListener
	closeOnce  sync.Once
	closeErr   error
}

func (connection *macOSVerifiedLocalAppNetConn) nativeLocalAppConnection() *LocalAppConnection {
	if connection == nil {
		return nil
	}
	return connection.connection
}
func (connection *macOSVerifiedLocalAppNetConn) Close() error {
	if connection != nil && connection.connection != nil {
		connection.connection.Revoke()
	}
	return connection.closeTransport()
}
func (connection *macOSVerifiedLocalAppNetConn) closeTransport() error {
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

func macOSPeerIdentityFromUnixConn(connection *net.UnixConn) (macOSAuditIdentity, error) {
	if connection == nil {
		return macOSAuditIdentity{}, fmt.Errorf("connected Unix socket is required")
	}
	raw, err := connection.SyscallConn()
	if err != nil {
		return macOSAuditIdentity{}, err
	}
	var identity macOSAuditIdentity
	var identityErr error
	if err := raw.Control(func(fd uintptr) { identity, identityErr = macOSSocketPeerIdentity(fd) }); err != nil {
		return macOSAuditIdentity{}, err
	}
	return identity, identityErr
}

func closeNetConn(connection net.Conn) error {
	if connection == nil {
		return nil
	}
	return connection.Close()
}

var _ net.Listener = (*MacOSVerifiedDesktopListener)(nil)
var _ net.Listener = (*MacOSVerifiedLocalAppListener)(nil)
