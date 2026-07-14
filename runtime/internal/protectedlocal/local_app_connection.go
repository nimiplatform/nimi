package protectedlocal

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
)

type LocalAppTrustClass string

const (
	LocalAppTrustLocalDevelopment LocalAppTrustClass = "local_development"
)

type VerifiedLocalAppLaunchPeer struct {
	LaunchID         Identifier
	Process          ProcessTuple
	RuntimeBootEpoch Identifier
	ProcessLiveness  DesktopProcessLiveness
	TrustClass       LocalAppTrustClass
}

// LocalAppSessionHandle is Runtime-private technical session material for an
// admitted mutable local project. It is never serialized
// to Desktop, CLI, terminal, renderer, or app code.
type LocalAppSessionHandle struct {
	SessionID    Identifier
	SessionProof Identifier
}

type LocalAppLaunchPeerVerifier interface {
	VerifyLocalAppLaunchPeer(context.Context) (VerifiedLocalAppLaunchPeer, error)
}

type LocalAppConnection struct {
	launchID   Identifier
	process    ProcessTuple
	boot       Identifier
	liveness   DesktopProcessLiveness
	trustClass LocalAppTrustClass
	live       atomic.Bool
	done       chan struct{}
	revokeMu   sync.Mutex
	hooks      []func()
	sessionMu  sync.RWMutex
	session    *LocalAppSessionHandle
}

func EstablishLocalAppConnection(ctx context.Context, verifier LocalAppLaunchPeerVerifier) (*LocalAppConnection, error) {
	if ctx == nil || verifier == nil {
		return nil, fail(ReasonDesktopProcessVerificationUnavailable, false, "relaunch_app", fmt.Errorf("local-app launch verifier is required"))
	}
	peer, err := verifier.VerifyLocalAppLaunchPeer(ctx)
	if err != nil {
		return nil, err
	}
	if peer.LaunchID == (Identifier{}) || peer.RuntimeBootEpoch == (Identifier{}) || peer.ProcessLiveness == nil || !peer.TrustClass.valid() {
		return nil, fail(ReasonDesktopProcessVerificationUnavailable, false, "relaunch_app", fmt.Errorf("local-app launch peer is incomplete"))
	}
	livenessSignal := peer.ProcessLiveness.Revoked()
	if livenessSignal == nil {
		_ = peer.ProcessLiveness.Close()
		return nil, fail(ReasonDesktopProcessVerificationUnavailable, false, "relaunch_app", fmt.Errorf("local-app launch peer liveness is unavailable"))
	}
	if err := peer.Process.validate(); err != nil {
		_ = peer.ProcessLiveness.Close()
		return nil, fail(ReasonDesktopExecutableTrustFailed, false, "relaunch_app", fmt.Errorf("validate local-app process: %w", err))
	}
	connection := &LocalAppConnection{launchID: peer.LaunchID, process: peer.Process, boot: peer.RuntimeBootEpoch, liveness: peer.ProcessLiveness, trustClass: peer.TrustClass, done: make(chan struct{})}
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

func (connection *LocalAppConnection) LaunchID() Identifier {
	if connection == nil {
		return Identifier{}
	}
	return connection.launchID
}

func (connection *LocalAppConnection) Process() ProcessTuple {
	if connection == nil {
		return ProcessTuple{}
	}
	return connection.process
}

func (connection *LocalAppConnection) RuntimeBootEpoch() Identifier {
	if connection == nil {
		return Identifier{}
	}
	return connection.boot
}

func (connection *LocalAppConnection) Live() bool {
	return connection != nil && connection.live.Load()
}

func (trustClass LocalAppTrustClass) valid() bool {
	return trustClass == LocalAppTrustLocalDevelopment
}

func (connection *LocalAppConnection) TrustClass() LocalAppTrustClass {
	if connection == nil {
		return ""
	}
	return connection.trustClass
}

func (connection *LocalAppConnection) Origin() OriginContext {
	if connection == nil || !connection.live.Load() || !connection.trustClass.valid() {
		return OriginContext{}
	}
	roles := make(map[OriginRole]struct{}, 1)
	connection.sessionMu.RLock()
	if !connection.live.Load() {
		connection.sessionMu.RUnlock()
		return OriginContext{}
	}
	transport := TransportLocalAppBootstrap
	roles[RoleLocalAppProcess] = struct{}{}
	if connection.session != nil {
		transport = TransportLocalAppHost
		delete(roles, RoleLocalAppProcess)
		roles[RoleLocalAppSession] = struct{}{}
	}
	connection.sessionMu.RUnlock()
	return OriginContext{TransportClass: transport, roles: roles}
}

func (connection *LocalAppConnection) BindSession(handle LocalAppSessionHandle) error {
	if connection == nil || handle.SessionID == (Identifier{}) || handle.SessionProof == (Identifier{}) {
		return fmt.Errorf("local-app session handle is incomplete")
	}
	connection.sessionMu.Lock()
	defer connection.sessionMu.Unlock()
	if !connection.live.Load() {
		return fmt.Errorf("local-app connection is revoked")
	}
	if connection.trustClass != LocalAppTrustLocalDevelopment {
		return fmt.Errorf("local-app connection trust class is unavailable")
	}
	if connection.session != nil {
		return fmt.Errorf("local-app connection already has a session")
	}
	bound := handle
	connection.session = &bound
	return nil
}

func (connection *LocalAppConnection) Session() (LocalAppSessionHandle, bool) {
	if connection == nil || !connection.live.Load() || connection.trustClass != LocalAppTrustLocalDevelopment {
		return LocalAppSessionHandle{}, false
	}
	connection.sessionMu.RLock()
	defer connection.sessionMu.RUnlock()
	if connection.session == nil || !connection.live.Load() {
		return LocalAppSessionHandle{}, false
	}
	return *connection.session, true
}

func (connection *LocalAppConnection) RotateSession(previous LocalAppSessionHandle, next LocalAppSessionHandle) error {
	if connection == nil || previous.SessionID == (Identifier{}) || previous.SessionProof == (Identifier{}) || next.SessionID == (Identifier{}) || next.SessionProof == (Identifier{}) {
		return fmt.Errorf("local-app session rotation handles are incomplete")
	}
	connection.sessionMu.Lock()
	defer connection.sessionMu.Unlock()
	if !connection.live.Load() || connection.trustClass != LocalAppTrustLocalDevelopment || connection.session == nil || *connection.session != previous {
		return fmt.Errorf("local-app session rotation lost its exact connection binding")
	}
	rotated := next
	connection.session = &rotated
	return nil
}

func (connection *LocalAppConnection) Revoke() {
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
func (connection *LocalAppConnection) OnRevoke(hook func()) {
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

type localAppConnectionContextKey struct{}

func ContextWithLocalAppConnection(ctx context.Context, connection *LocalAppConnection) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	return context.WithValue(ctx, localAppConnectionContextKey{}, connection)
}

func LocalAppConnectionFromContext(ctx context.Context) (*LocalAppConnection, bool) {
	if ctx == nil {
		return nil, false
	}
	connection, ok := ctx.Value(localAppConnectionContextKey{}).(*LocalAppConnection)
	return connection, ok && connection != nil && connection.Live()
}
