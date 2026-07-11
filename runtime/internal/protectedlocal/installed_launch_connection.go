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

type InstalledLaunchPeerVerifier interface {
	VerifyInstalledLaunchPeer(context.Context) (VerifiedInstalledLaunchPeer, error)
}

type InstalledLaunchConnection struct {
	launchID Identifier
	process  ProcessTuple
	boot     Identifier
	liveness DesktopProcessLiveness
	live     atomic.Bool
	done     chan struct{}
	revokeMu sync.Mutex
	hooks    []func()
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

func (connection *InstalledLaunchConnection) Revoke() {
	if connection == nil || !connection.live.CompareAndSwap(true, false) {
		return
	}
	close(connection.done)
	_ = connection.liveness.Close()
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
