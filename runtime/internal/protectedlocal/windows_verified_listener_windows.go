//go:build windows && !nimi_windows_source_local_development

package protectedlocal

import (
	"context"
	cryptorand "crypto/rand"
	"errors"
	"fmt"
	"io"
	"net"
	"strings"
	"sync"
)

// OpenWindowsVerifiedDesktopListener turns the service-owned Windows pipe in
// a validated Runtime security state into the only native listener allowed to
// carry protected Desktop gRPC. Production callers cannot supply an endpoint,
// peer tuple, or trust-set identifier.
func OpenWindowsVerifiedDesktopListener(ctx context.Context, state *WindowsRuntimeSecurityState, verifier WindowsExecutableTrustVerifier) (net.Listener, error) {
	profile := mustActiveWindowsRuntimeProfile()
	if ctx == nil {
		return nil, verifiedWindowsListenerFailure("open verified Desktop listener", fmt.Errorf("context is required"))
	}
	if state == nil {
		return nil, verifiedWindowsListenerFailure("open verified Desktop listener", fmt.Errorf("Runtime security state is required"))
	}
	if verifier == nil {
		return nil, verifiedWindowsListenerFailure("open verified Desktop listener", fmt.Errorf("Desktop executable trust verifier is required"))
	}
	if state.principal.serviceSID != profile.serviceSID || state.process.principalSID != state.principal.serviceSID || state.root.serviceSID != state.principal.serviceSID {
		return nil, verifiedWindowsListenerFailure("open verified Desktop listener", fmt.Errorf("exact Runtime service principal and protected state root are required"))
	}
	if err := state.process.validate(); err != nil {
		return nil, verifiedWindowsListenerFailure("open verified Desktop listener", err)
	}
	if err := state.desktopIdentity.validate(); err != nil {
		return nil, verifiedWindowsListenerFailure("open verified Desktop listener", err)
	}
	if state.bootEpoch == (Identifier{}) {
		return nil, verifiedWindowsListenerFailure("open verified Desktop listener", fmt.Errorf("anchored Runtime boot epoch is required"))
	}

	state.transportMu.Lock()
	defer state.transportMu.Unlock()
	if state.closed {
		return nil, verifiedWindowsListenerFailure("open verified Desktop listener", fmt.Errorf("Runtime security state is closed"))
	}
	if state.desktopTransport != nil {
		return nil, verifiedWindowsListenerFailure("open verified Desktop listener", fmt.Errorf("verified Desktop listener is already claimed"))
	}
	if state.desktopPipe == nil {
		return nil, verifiedWindowsListenerFailure("open verified Desktop listener", fmt.Errorf("service-owned Desktop pipe is required"))
	}
	state.desktopPipe.mu.Lock()
	pipeName := state.desktopPipe.name
	pipeClosed := state.desktopPipe.closed
	state.desktopPipe.mu.Unlock()
	if pipeClosed || pipeName != profile.desktopPipeName {
		return nil, verifiedWindowsListenerFailure("open verified Desktop listener", fmt.Errorf("fixed protected Desktop pipe is required"))
	}

	listener, err := newWindowsVerifiedDesktopListener(ctx, windowsVerifiedDesktopListenerOptions{
		initialPipe:               state.desktopPipe,
		runtimeProcess:            state.process,
		bootEpoch:                 state.bootEpoch,
		verifier:                  verifier,
		expectedDesktopTrustSetID: profile.desktopTrustSetID,
		random:                    cryptorand.Reader,
		reopen: func(ctx context.Context) (*WindowsDesktopPipeInstance, error) {
			return createWindowsDesktopPipeInstance(ctx, profile.desktopPipeName, state.principal, state.desktopIdentity, false)
		},
	})
	if err != nil {
		return nil, err
	}
	state.desktopTransport = listener
	return listener, nil
}

type windowsVerifiedDesktopListenerOptions struct {
	initialPipe               *WindowsDesktopPipeInstance
	runtimeProcess            WindowsRuntimeProcess
	bootEpoch                 Identifier
	verifier                  WindowsExecutableTrustVerifier
	expectedDesktopTrustSetID string
	random                    io.Reader
	reopen                    func(context.Context) (*WindowsDesktopPipeInstance, error)
}

type windowsVerifiedDesktopListener struct {
	ctx    context.Context
	cancel context.CancelFunc

	name                      string
	runtimeProcess            ProcessTuple
	bootEpoch                 Identifier
	verifier                  WindowsExecutableTrustVerifier
	expectedDesktopTrustSetID string
	random                    io.Reader
	reopen                    func(context.Context) (*WindowsDesktopPipeInstance, error)

	mu         sync.Mutex
	initial    *WindowsDesktopPipeInstance
	current    *WindowsDesktopPipeInstance
	active     *windowsVerifiedDesktopNetConn
	activeDone chan struct{}
	closed     bool

	closeOnce sync.Once
	closeErr  error
}

func newWindowsVerifiedDesktopListener(ctx context.Context, options windowsVerifiedDesktopListenerOptions) (net.Listener, error) {
	if ctx == nil {
		return nil, verifiedWindowsListenerFailure("create verified Desktop listener", fmt.Errorf("context is required"))
	}
	if options.initialPipe == nil {
		return nil, verifiedWindowsListenerFailure("create verified Desktop listener", fmt.Errorf("initial Windows Desktop pipe is required"))
	}
	if err := options.runtimeProcess.tuple.validate(); err != nil {
		return nil, verifiedWindowsListenerFailure("create verified Desktop listener", fmt.Errorf("verified Runtime process tuple: %w", err))
	}
	if options.bootEpoch == (Identifier{}) {
		return nil, verifiedWindowsListenerFailure("create verified Desktop listener", fmt.Errorf("Runtime boot epoch is required"))
	}
	if options.verifier == nil || strings.TrimSpace(options.expectedDesktopTrustSetID) == "" {
		return nil, verifiedWindowsListenerFailure("create verified Desktop listener", fmt.Errorf("Desktop executable verifier and trust set are required"))
	}
	if options.random == nil {
		return nil, verifiedWindowsListenerFailure("create verified Desktop listener", fmt.Errorf("cryptographic randomness is required"))
	}
	if options.reopen == nil {
		return nil, verifiedWindowsListenerFailure("create verified Desktop listener", fmt.Errorf("Desktop pipe re-open capability is required"))
	}
	options.initialPipe.mu.Lock()
	name := options.initialPipe.name
	closed := options.initialPipe.closed
	options.initialPipe.mu.Unlock()
	if closed || !strings.HasPrefix(name, `\\.\pipe\`) {
		return nil, verifiedWindowsListenerFailure("create verified Desktop listener", fmt.Errorf("open local Windows pipe is required"))
	}
	listenerCtx, cancel := context.WithCancel(ctx)
	return &windowsVerifiedDesktopListener{
		ctx:                       listenerCtx,
		cancel:                    cancel,
		name:                      name,
		runtimeProcess:            options.runtimeProcess.tuple,
		bootEpoch:                 options.bootEpoch,
		verifier:                  options.verifier,
		expectedDesktopTrustSetID: strings.TrimSpace(options.expectedDesktopTrustSetID),
		random:                    options.random,
		reopen:                    options.reopen,
		initial:                   options.initialPipe,
	}, nil
}

func (listener *windowsVerifiedDesktopListener) Accept() (net.Conn, error) {
	if listener == nil {
		return nil, net.ErrClosed
	}
	for {
		pipe, err := listener.nextPipe()
		if err != nil {
			return nil, err
		}
		nativeConnection, err := pipe.Accept(listener.ctx)
		if err != nil {
			listener.discardPipe(pipe)
			if listener.isClosed() {
				return nil, net.ErrClosed
			}
			continue
		}

		client, liveness, err := nativeConnection.verifyAndBindClientProcess(listener.ctx, listener.verifier, listener.expectedDesktopTrustSetID)
		if err != nil {
			reportWindowsPeerRejection(err)
			_ = nativeConnection.Close()
			listener.discardPipe(pipe)
			if listener.isClosed() {
				return nil, net.ErrClosed
			}
			continue
		}
		raw, err := nativeConnection.NetConn()
		if err != nil {
			reportWindowsPeerRejection(err)
			_ = liveness.Close()
			_ = nativeConnection.Close()
			listener.discardPipe(pipe)
			if listener.isClosed() {
				return nil, net.ErrClosed
			}
			continue
		}
		endpointID, err := readIdentifier(listener.random)
		if err != nil {
			_ = raw.Close()
			_ = liveness.Close()
			listener.discardPipe(pipe)
			return nil, verifiedWindowsListenerFailure("bind verified Desktop connection", fmt.Errorf("generate endpoint identity: %w", err))
		}
		transcriptNonce, err := readIdentifier(listener.random)
		if err != nil {
			_ = raw.Close()
			_ = liveness.Close()
			listener.discardPipe(pipe)
			return nil, verifiedWindowsListenerFailure("bind verified Desktop connection", fmt.Errorf("generate transcript nonce: %w", err))
		}
		desktopConnection, err := EstablishDesktopConnection(listener.ctx, windowsVerifiedDesktopPeerVerifier{peers: VerifiedDesktopPeers{
			Client:             client,
			Server:             listener.runtimeProcess,
			ClientLiveness:     liveness,
			RuntimeBootEpoch:   listener.bootEpoch,
			EndpointInstanceID: endpointID,
			TranscriptNonce:    transcriptNonce,
		}}, listener.random)
		if err != nil {
			_ = raw.Close()
			_ = nativeConnection.Close()
			listener.discardPipe(pipe)
			if listener.isClosed() {
				return nil, net.ErrClosed
			}
			continue
		}

		verified := &windowsVerifiedDesktopNetConn{
			Conn:              raw,
			desktopConnection: desktopConnection,
			listener:          listener,
		}
		if !listener.activate(pipe, verified) {
			desktopConnection.Revoke()
			_ = verified.closeTransport()
			return nil, net.ErrClosed
		}
		desktopConnection.onRevoke(func() { _ = verified.closeTransport() })
		return verified, nil
	}
}

func (listener *windowsVerifiedDesktopListener) Close() error {
	if listener == nil {
		return nil
	}
	listener.closeOnce.Do(func() {
		listener.cancel()
		listener.mu.Lock()
		listener.closed = true
		initial := listener.initial
		current := listener.current
		active := listener.active
		listener.initial = nil
		listener.current = nil
		listener.mu.Unlock()

		var failures []error
		if initial != nil {
			failures = append(failures, initial.Close())
		}
		if current != nil && current != initial {
			failures = append(failures, current.Close())
		}
		if active != nil {
			failures = append(failures, active.Close())
		}
		listener.closeErr = errors.Join(failures...)
	})
	return listener.closeErr
}

func (listener *windowsVerifiedDesktopListener) Addr() net.Addr {
	if listener == nil {
		return windowsDesktopPipeAddress("")
	}
	return windowsDesktopPipeAddress(listener.name)
}

func (listener *windowsVerifiedDesktopListener) nextPipe() (*WindowsDesktopPipeInstance, error) {
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
		if listener.current != nil {
			pipe := listener.current
			listener.mu.Unlock()
			return pipe, nil
		}
		if listener.initial != nil {
			pipe := listener.initial
			listener.initial = nil
			listener.current = pipe
			listener.mu.Unlock()
			return pipe, nil
		}
		listener.mu.Unlock()

		pipe, err := listener.reopen(listener.ctx)
		if err != nil {
			if listener.isClosed() {
				return nil, net.ErrClosed
			}
			return nil, verifiedWindowsListenerFailure("reopen verified Desktop pipe", err)
		}
		if pipe == nil {
			return nil, verifiedWindowsListenerFailure("reopen verified Desktop pipe", fmt.Errorf("pipe re-open capability returned no endpoint"))
		}
		pipe.mu.Lock()
		name := pipe.name
		closed := pipe.closed
		pipe.mu.Unlock()
		if closed || name != listener.name {
			_ = pipe.Close()
			return nil, verifiedWindowsListenerFailure("reopen verified Desktop pipe", fmt.Errorf("re-opened pipe does not retain the fixed endpoint"))
		}

		listener.mu.Lock()
		if listener.closed {
			listener.mu.Unlock()
			_ = pipe.Close()
			return nil, net.ErrClosed
		}
		if listener.active != nil || listener.current != nil {
			listener.mu.Unlock()
			_ = pipe.Close()
			continue
		}
		listener.current = pipe
		listener.mu.Unlock()
		return pipe, nil
	}
}

func (listener *windowsVerifiedDesktopListener) discardPipe(pipe *WindowsDesktopPipeInstance) {
	if pipe == nil {
		return
	}
	_ = pipe.Close()
	listener.mu.Lock()
	if listener.current == pipe {
		listener.current = nil
	}
	listener.mu.Unlock()
}

func (listener *windowsVerifiedDesktopListener) activate(pipe *WindowsDesktopPipeInstance, connection *windowsVerifiedDesktopNetConn) bool {
	listener.mu.Lock()
	defer listener.mu.Unlock()
	if listener.closed || listener.current != pipe {
		return false
	}
	listener.current = nil
	listener.active = connection
	listener.activeDone = make(chan struct{})
	return true
}

func (listener *windowsVerifiedDesktopListener) release(connection *windowsVerifiedDesktopNetConn) {
	listener.mu.Lock()
	if listener.active != connection {
		listener.mu.Unlock()
		return
	}
	done := listener.activeDone
	listener.active = nil
	listener.activeDone = nil
	listener.mu.Unlock()
	if done != nil {
		close(done)
	}
}

func (listener *windowsVerifiedDesktopListener) isClosed() bool {
	listener.mu.Lock()
	defer listener.mu.Unlock()
	return listener.closed
}

type windowsVerifiedDesktopPeerVerifier struct {
	peers VerifiedDesktopPeers
}

func (verifier windowsVerifiedDesktopPeerVerifier) VerifyDesktopPeers(ctx context.Context) (VerifiedDesktopPeers, error) {
	if err := ctx.Err(); err != nil {
		return verifier.peers, err
	}
	return verifier.peers, nil
}

type windowsVerifiedDesktopNetConn struct {
	net.Conn
	desktopConnection *Connection
	listener          *windowsVerifiedDesktopListener

	closeOnce sync.Once
	closeErr  error
}

func (connection *windowsVerifiedDesktopNetConn) nativeDesktopConnection() *Connection {
	if connection == nil {
		return nil
	}
	return connection.desktopConnection
}

func (connection *windowsVerifiedDesktopNetConn) Close() error {
	if connection == nil {
		return nil
	}
	if connection.desktopConnection != nil {
		connection.desktopConnection.Revoke()
	}
	return connection.closeTransport()
}

func (connection *windowsVerifiedDesktopNetConn) closeTransport() error {
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

func verifiedWindowsListenerFailure(operation string, cause error) error {
	if cause == nil {
		cause = fmt.Errorf("verified Windows Desktop listener is unavailable")
	}
	return fail(
		ReasonProtectedLocalTransportUnsupported,
		false,
		"repair_runtime_service",
		fmt.Errorf("%s: %w", operation, cause),
	)
}

var _ net.Listener = (*windowsVerifiedDesktopListener)(nil)
