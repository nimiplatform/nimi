//go:build windows && nimi_windows_source_local_development

package protectedlocal

import (
	"context"
	"errors"
	"fmt"
	"net"
	"sync"
	"unsafe"

	"github.com/Microsoft/go-winio"
	"golang.org/x/sys/windows"
)

const windowsSourcePipeBufferBytes = 16 * 1024

type windowsSourcePipeHandle interface {
	Fd() uintptr
}

func OpenWindowsVerifiedDesktopListener(ctx context.Context, state *WindowsRuntimeSecurityState, _ WindowsExecutableTrustVerifier) (net.Listener, error) {
	if ctx == nil || state == nil || !state.sourceLocalDevelopment || state.ownerProcess == nil ||
		state.desktopSessions == nil || !state.desktopSessions.Direct() || state.ownerIdentity.pid == 0 || state.expectedDesktopPath == "" {
		return nil, verifiedWindowsSourceListenerFailure("open current-user Desktop listener", fmt.Errorf("complete source Runtime authority is required"))
	}
	raw, err := openWindowsSourcePipe(state.principal.tokenUserSID, windowsSourceDesktopPipeRole)
	if err != nil {
		return nil, err
	}
	listenerCtx, cancel := context.WithCancel(ctx)
	listener := &windowsSourceDesktopListener{ctx: listenerCtx, cancel: cancel, raw: raw, state: state}
	state.transportMu.Lock()
	defer state.transportMu.Unlock()
	if state.closed || state.desktopTransport != nil {
		cancel()
		_ = raw.Close()
		return nil, verifiedWindowsSourceListenerFailure("open current-user Desktop listener", fmt.Errorf("listener is closed or already claimed"))
	}
	state.desktopTransport = listener
	return listener, nil
}

func OpenWindowsVerifiedLocalAppListener(ctx context.Context, state *WindowsRuntimeSecurityState) (net.Listener, error) {
	if ctx == nil || state == nil || !state.sourceLocalDevelopment || state.directLocalAppLaunches == nil {
		return nil, verifiedWindowsSourceListenerFailure("open current-user local-app listener", fmt.Errorf("complete source local-app authority is required"))
	}
	raw, err := openWindowsSourcePipe(state.principal.tokenUserSID, windowsSourceLocalAppPipeRole)
	if err != nil {
		return nil, err
	}
	listenerCtx, cancel := context.WithCancel(ctx)
	listener := &windowsSourceLocalAppListener{ctx: listenerCtx, cancel: cancel, raw: raw, state: state}
	state.transportMu.Lock()
	defer state.transportMu.Unlock()
	if state.closed || state.localAppTransport != nil {
		cancel()
		_ = raw.Close()
		return nil, verifiedWindowsSourceListenerFailure("open current-user local-app listener", fmt.Errorf("listener is closed or already claimed"))
	}
	state.localAppTransport = listener
	return listener, nil
}

func openWindowsSourcePipe(userSID string, role windowsSourcePipeRole) (net.Listener, error) {
	name, err := windowsSourceLocalDevelopmentPipeName(userSID, role)
	if err != nil {
		return nil, verifiedWindowsSourceListenerFailure("resolve current-user named pipe", err)
	}
	sddl, err := windowsSourceOwnerOnlyPipeSDDL(userSID)
	if err != nil {
		return nil, verifiedWindowsSourceListenerFailure("resolve current-user named-pipe ACL", err)
	}
	listener, err := winio.ListenPipe(name, &winio.PipeConfig{
		SecurityDescriptor: sddl,
		InputBufferSize:    windowsSourcePipeBufferBytes, OutputBufferSize: windowsSourcePipeBufferBytes,
	})
	if err != nil {
		return nil, verifiedWindowsSourceListenerFailure("open current-user named pipe", err)
	}
	return listener, nil
}

type windowsSourceDesktopListener struct {
	ctx    context.Context
	cancel context.CancelFunc
	raw    net.Listener
	state  *WindowsRuntimeSecurityState

	mu         sync.Mutex
	active     *windowsSourceDesktopNetConn
	activeDone chan struct{}
	closed     bool
	closeOnce  sync.Once
	closeErr   error
}

func (listener *windowsSourceDesktopListener) Accept() (net.Conn, error) {
	if listener == nil {
		return nil, net.ErrClosed
	}
	for {
		listener.mu.Lock()
		if listener.closed {
			listener.mu.Unlock()
			return nil, net.ErrClosed
		}
		if listener.active != nil {
			done := listener.activeDone
			listener.mu.Unlock()
			select {
			case <-done:
				continue
			case <-listener.ctx.Done():
				return nil, net.ErrClosed
			}
		}
		listener.mu.Unlock()
		raw, err := listener.raw.Accept()
		if err != nil {
			if listener.isClosed() {
				return nil, net.ErrClosed
			}
			continue
		}
		clientPID, err := verifyWindowsSourcePipePeer(raw, listener.state.principal.tokenUserSID)
		if err != nil {
			_ = raw.Close()
			continue
		}
		observed, liveness, err := inspectWindowsSourceProcess(listener.ctx, clientPID, listener.state.desktopIdentity, listener.state.expectedDesktopPath)
		if err != nil {
			_ = raw.Close()
			continue
		}
		process, err := observed.processTuple()
		if err != nil {
			_ = liveness.Close()
			_ = raw.Close()
			continue
		}
		connection, err := newDirectDesktopConnectionWithClient(DesktopPeerIdentity{
			OS: OSWindows, PID: observed.pid, UID: observed.sessionID, AuditSession: observed.sessionID,
		}, process, liveness)
		if err != nil {
			_ = liveness.Close()
			_ = raw.Close()
			continue
		}
		verified := &windowsSourceDesktopNetConn{Conn: raw, connection: connection, listener: listener}
		if !listener.activate(verified) {
			connection.Revoke()
			_ = raw.Close()
			return nil, net.ErrClosed
		}
		connection.onRevoke(func() { _ = verified.closeTransport() })
		return verified, nil
	}
}

func (listener *windowsSourceDesktopListener) activate(connection *windowsSourceDesktopNetConn) bool {
	listener.mu.Lock()
	defer listener.mu.Unlock()
	if listener.closed || listener.active != nil {
		return false
	}
	listener.active = connection
	listener.activeDone = make(chan struct{})
	return true
}

func (listener *windowsSourceDesktopListener) release(connection *windowsSourceDesktopNetConn) {
	listener.mu.Lock()
	if listener.active == connection {
		listener.active = nil
		if listener.activeDone != nil {
			close(listener.activeDone)
		}
		listener.activeDone = nil
	}
	listener.mu.Unlock()
}

func (listener *windowsSourceDesktopListener) isClosed() bool {
	listener.mu.Lock()
	defer listener.mu.Unlock()
	return listener.closed
}

func (listener *windowsSourceDesktopListener) Close() error {
	if listener == nil {
		return nil
	}
	listener.closeOnce.Do(func() {
		listener.cancel()
		listener.mu.Lock()
		listener.closed = true
		active := listener.active
		listener.mu.Unlock()
		listener.closeErr = errors.Join(listener.raw.Close(), closeWindowsSourceConnection(active))
	})
	return listener.closeErr
}

func (listener *windowsSourceDesktopListener) Addr() net.Addr { return listener.raw.Addr() }

type windowsSourceDesktopNetConn struct {
	net.Conn
	connection *Connection
	listener   *windowsSourceDesktopListener
	closeOnce  sync.Once
	closeErr   error
}

func (connection *windowsSourceDesktopNetConn) nativeDesktopConnection() *Connection {
	if connection == nil {
		return nil
	}
	return connection.connection
}

func (connection *windowsSourceDesktopNetConn) Close() error {
	if connection != nil && connection.connection != nil {
		connection.connection.Revoke()
	}
	return connection.closeTransport()
}

func (connection *windowsSourceDesktopNetConn) closeTransport() error {
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

type windowsSourceLocalAppListener struct {
	ctx    context.Context
	cancel context.CancelFunc
	raw    net.Listener
	state  *WindowsRuntimeSecurityState

	mu        sync.Mutex
	closed    bool
	active    map[*windowsSourceLocalAppNetConn]struct{}
	closeOnce sync.Once
	closeErr  error
}

func (listener *windowsSourceLocalAppListener) Accept() (net.Conn, error) {
	if listener == nil {
		return nil, net.ErrClosed
	}
	for {
		raw, err := listener.raw.Accept()
		if err != nil {
			if listener.isClosed() {
				return nil, net.ErrClosed
			}
			continue
		}
		clientPID, err := verifyWindowsSourcePipePeer(raw, listener.state.principal.tokenUserSID)
		if err != nil {
			_ = raw.Close()
			continue
		}
		launch, bound := listener.state.directLocalAppLaunches.Bound(clientPID, listener.state.desktopIdentity.sessionID)
		if !bound {
			_ = raw.Close()
			continue
		}
		process, liveness, err := inspectWindowsSourceProcess(listener.ctx, clientPID, listener.state.desktopIdentity, launch.HostExecutablePath)
		if err != nil {
			_ = raw.Close()
			continue
		}
		_ = liveness.Close()
		peer, err := verifyWindowsSourceDirectLocalAppPeer(launch, process)
		if err != nil {
			_ = raw.Close()
			continue
		}
		consumed, err := listener.state.directLocalAppLaunches.Consume(clientPID, process.sessionID)
		if err != nil || consumed != launch {
			_ = raw.Close()
			continue
		}
		connection, err := newDirectLocalAppConnection(
			peer,
			consumed,
			listener.state.desktopSessions.OperationSessionID(),
		)
		if err != nil {
			_ = raw.Close()
			continue
		}
		verified := &windowsSourceLocalAppNetConn{Conn: raw, connection: connection, listener: listener}
		if !listener.track(verified) {
			connection.Revoke()
			_ = raw.Close()
			return nil, net.ErrClosed
		}
		connection.OnRevoke(func() { _ = verified.closeTransport() })
		return verified, nil
	}
}

func (listener *windowsSourceLocalAppListener) track(connection *windowsSourceLocalAppNetConn) bool {
	listener.mu.Lock()
	defer listener.mu.Unlock()
	if listener.closed {
		return false
	}
	if listener.active == nil {
		listener.active = make(map[*windowsSourceLocalAppNetConn]struct{})
	}
	listener.active[connection] = struct{}{}
	return true
}

func (listener *windowsSourceLocalAppListener) release(connection *windowsSourceLocalAppNetConn) {
	listener.mu.Lock()
	delete(listener.active, connection)
	listener.mu.Unlock()
}

func (listener *windowsSourceLocalAppListener) isClosed() bool {
	listener.mu.Lock()
	defer listener.mu.Unlock()
	return listener.closed
}

func (listener *windowsSourceLocalAppListener) Close() error {
	if listener == nil {
		return nil
	}
	listener.closeOnce.Do(func() {
		listener.cancel()
		listener.mu.Lock()
		listener.closed = true
		active := make([]*windowsSourceLocalAppNetConn, 0, len(listener.active))
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

func (listener *windowsSourceLocalAppListener) Addr() net.Addr { return listener.raw.Addr() }

type windowsSourceLocalAppNetConn struct {
	net.Conn
	connection *LocalAppConnection
	listener   *windowsSourceLocalAppListener
	closeOnce  sync.Once
	closeErr   error
}

func (connection *windowsSourceLocalAppNetConn) nativeLocalAppConnection() *LocalAppConnection {
	if connection == nil {
		return nil
	}
	return connection.connection
}

func (connection *windowsSourceLocalAppNetConn) Close() error {
	if connection != nil && connection.connection != nil {
		connection.connection.Revoke()
	}
	return connection.closeTransport()
}

func (connection *windowsSourceLocalAppNetConn) closeTransport() error {
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

func verifyWindowsSourcePipePeer(connection net.Conn, userSID string) (uint32, error) {
	handleCarrier, ok := connection.(windowsSourcePipeHandle)
	if !ok || handleCarrier.Fd() == 0 {
		return 0, fmt.Errorf("connected named-pipe handle is unavailable")
	}
	handle := windows.Handle(handleCarrier.Fd())
	if err := validateWindowsSourcePipeACL(handle, userSID); err != nil {
		return 0, err
	}
	var clientPID uint32
	if err := windows.GetNamedPipeClientProcessId(handle, &clientPID); err != nil || clientPID == 0 {
		return 0, fmt.Errorf("read connected named-pipe peer process: %w", err)
	}
	return clientPID, nil
}

func validateWindowsSourcePipeACL(handle windows.Handle, userSID string) error {
	descriptor, err := windows.GetSecurityInfo(handle, windows.SE_KERNEL_OBJECT, windows.DACL_SECURITY_INFORMATION)
	if err != nil || descriptor == nil {
		return fmt.Errorf("read current-user named-pipe DACL: %w", err)
	}
	control, _, err := descriptor.Control()
	if err != nil || control&windows.SE_DACL_PROTECTED == 0 {
		return fmt.Errorf("current-user named-pipe DACL must be protected")
	}
	dacl, _, err := descriptor.DACL()
	if err != nil || dacl == nil || dacl.AceCount != 1 {
		return fmt.Errorf("current-user named pipe requires one ACL entry")
	}
	var ace *windows.ACCESS_ALLOWED_ACE
	if err := windows.GetAce(dacl, 0, &ace); err != nil || ace == nil {
		return fmt.Errorf("read current-user named-pipe ACL entry: %w", err)
	}
	principal := (*windows.SID)(unsafe.Pointer(&ace.SidStart)).String()
	policy := []windowsSourceACLPolicyEntry{{
		Principal:   principal,
		Allow:       ace.Header.AceType == windows.ACCESS_ALLOWED_ACE_TYPE,
		Inherited:   ace.Header.AceFlags&windows.INHERITED_ACE != 0,
		FullControl: uint32(ace.Mask) == windows.GENERIC_ALL || uint32(ace.Mask) == windowsFileAllAccess,
	}}
	return validateWindowsSourceOwnerOnlyACLPolicy(userSID, policy)
}

func verifiedWindowsSourceListenerFailure(operation string, cause error) error {
	return fail(ReasonProtectedLocalTransportUnsupported, false, "restart_runtime", fmt.Errorf("%s: %w", operation, cause))
}

func closeWindowsSourceConnection(connection net.Conn) error {
	if connection == nil {
		return nil
	}
	return connection.Close()
}

var _ net.Listener = (*windowsSourceDesktopListener)(nil)
var _ net.Listener = (*windowsSourceLocalAppListener)(nil)
