package protectedlocal

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
)

const (
	RoleVerifiedInstalledProcess OriginRole = "verified_installed_process"
	RoleInstalledHostSession     OriginRole = "installed_host_session"
)

type VerifiedInstalledLaunchPeer struct {
	LaunchID         Identifier
	Process          ProcessTuple
	RuntimeBootEpoch Identifier
	ProcessLiveness  DesktopProcessLiveness
}

// InstalledSessionHandle is the Runtime-private selector and proof attached to
// one verified native connection after launch consumption. Revocation,
// expiry, app/release identity and account generation remain owned by the
// durable installed-session store and must be revalidated for every use.
type InstalledSessionHandle struct {
	SessionID    Identifier
	SessionProof Identifier
}

type InstalledLaunchPeerVerifier interface {
	VerifyInstalledLaunchPeer(context.Context) (VerifiedInstalledLaunchPeer, error)
}

type InstalledLaunchConnection struct {
	launchID  Identifier
	process   ProcessTuple
	boot      Identifier
	liveness  DesktopProcessLiveness
	live      atomic.Bool
	done      chan struct{}
	revokeMu  sync.Mutex
	hooks     []func()
	sessionMu sync.RWMutex
	session   *InstalledSessionHandle
}

func EstablishInstalledLaunchConnection(ctx context.Context, verifier InstalledLaunchPeerVerifier) (*InstalledLaunchConnection, error) {
	if ctx == nil || verifier == nil {
		return nil, fail(ReasonDesktopProcessVerificationUnavailable, false, "relaunch_app", fmt.Errorf("installed launch verifier is required"))
	}
	peer, err := verifier.VerifyInstalledLaunchPeer(ctx)
	if err != nil {
		return nil, err
	}
	if peer.LaunchID == (Identifier{}) || peer.RuntimeBootEpoch == (Identifier{}) || peer.ProcessLiveness == nil {
		return nil, fail(ReasonDesktopProcessVerificationUnavailable, false, "relaunch_app", fmt.Errorf("installed launch peer is incomplete"))
	}
	livenessSignal := peer.ProcessLiveness.Revoked()
	if livenessSignal == nil {
		_ = peer.ProcessLiveness.Close()
		return nil, fail(ReasonDesktopProcessVerificationUnavailable, false, "relaunch_app", fmt.Errorf("installed launch peer liveness is unavailable"))
	}
	if err := peer.Process.validate(); err != nil {
		_ = peer.ProcessLiveness.Close()
		return nil, fail(ReasonDesktopExecutableTrustFailed, false, "reinstall_app", fmt.Errorf("validate installed process: %w", err))
	}
	connection := &InstalledLaunchConnection{launchID: peer.LaunchID, process: peer.Process, boot: peer.RuntimeBootEpoch, liveness: peer.ProcessLiveness, done: make(chan struct{})}
	connection.live.Store(true)
	go func() {
		select {
		case <-livenessSignal:
			connection.Revoke()
		case <-connection.done:
		}
	}()
	return connection, nil
}

func (connection *InstalledLaunchConnection) LaunchID() Identifier {
	if connection == nil {
		return Identifier{}
	}
	return connection.launchID
}

func (connection *InstalledLaunchConnection) Process() ProcessTuple {
	if connection == nil {
		return ProcessTuple{}
	}
	return connection.process
}

func (connection *InstalledLaunchConnection) RuntimeBootEpoch() Identifier {
	if connection == nil {
		return Identifier{}
	}
	return connection.boot
}

func (connection *InstalledLaunchConnection) Live() bool {
	return connection != nil && connection.live.Load()
}

// BindInstalledSession attaches the one installed session created from this
// connection's launch record. A connection can never be rebound or promoted
// by caller-provided metadata.
func (connection *InstalledLaunchConnection) BindInstalledSession(handle InstalledSessionHandle) error {
	if connection == nil || handle.SessionID == (Identifier{}) || handle.SessionProof == (Identifier{}) {
		return fmt.Errorf("installed session handle is incomplete")
	}
	connection.sessionMu.Lock()
	defer connection.sessionMu.Unlock()
	if !connection.live.Load() {
		return fmt.Errorf("installed launch connection is revoked")
	}
	if connection.session != nil {
		return fmt.Errorf("installed launch connection already has a session")
	}
	bound := handle
	connection.session = &bound
	return nil
}

func (connection *InstalledLaunchConnection) InstalledSession() (InstalledSessionHandle, bool) {
	if connection == nil || !connection.live.Load() {
		return InstalledSessionHandle{}, false
	}
	connection.sessionMu.RLock()
	defer connection.sessionMu.RUnlock()
	if connection.session == nil || !connection.live.Load() {
		return InstalledSessionHandle{}, false
	}
	return *connection.session, true
}

func (connection *InstalledLaunchConnection) Revoke() {
	if connection == nil || !connection.live.CompareAndSwap(true, false) {
		return
	}
	close(connection.done)
	_ = connection.liveness.Close()
	connection.sessionMu.Lock()
	connection.session = nil
	connection.sessionMu.Unlock()
	connection.revokeMu.Lock()
	hooks := append([]func(){}, connection.hooks...)
	connection.hooks = nil
	connection.revokeMu.Unlock()
	for _, hook := range hooks {
		hook()
	}
}

// OnRevoke binds Runtime-owned session revocation to the verified process
// lifetime. A hook registered after revocation runs synchronously.
func (connection *InstalledLaunchConnection) OnRevoke(hook func()) {
	if connection == nil || hook == nil {
		return
	}
	connection.revokeMu.Lock()
	if !connection.live.Load() {
		connection.revokeMu.Unlock()
		hook()
		return
	}
	connection.hooks = append(connection.hooks, hook)
	connection.revokeMu.Unlock()
}

type installedLaunchConnectionContextKey struct{}

func ContextWithInstalledLaunchConnection(ctx context.Context, connection *InstalledLaunchConnection) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	return context.WithValue(ctx, installedLaunchConnectionContextKey{}, connection)
}

func InstalledLaunchConnectionFromContext(ctx context.Context) (*InstalledLaunchConnection, bool) {
	if ctx == nil {
		return nil, false
	}
	connection, ok := ctx.Value(installedLaunchConnectionContextKey{}).(*InstalledLaunchConnection)
	return connection, ok && connection != nil && connection.Live()
}
