package protectedlocal

import (
	"context"
	"fmt"
	"io"
	"sync"
	"sync/atomic"
)

type LocalAppTrustClass string

const (
	LocalAppTrustLocalDevelopment LocalAppTrustClass = "local_development"
	LocalAppTrustBuiltIn          LocalAppTrustClass = "built_in"
)

type VerifiedLocalAppLaunchPeer struct {
	LaunchID         Identifier
	Process          ProcessTuple
	RuntimeBootEpoch Identifier
	ProcessLiveness  DesktopProcessLiveness
	TrustClass       LocalAppTrustClass
}

// LocalAppSessionHandle is Runtime-private technical session material for an
// admitted formal protected App. It is never serialized
// to Desktop, CLI, terminal, renderer, or app code.
type LocalAppSessionHandle struct {
	SessionID    Identifier
	SessionProof Identifier
}

func NewLocalAppSessionHandle(random io.Reader) (LocalAppSessionHandle, error) {
	sessionID, err := readIdentifier(random)
	if err != nil {
		return LocalAppSessionHandle{}, fmt.Errorf("generate local-app session identifier: %w", err)
	}
	sessionProof, err := readIdentifier(random)
	if err != nil {
		return LocalAppSessionHandle{}, fmt.Errorf("generate local-app session proof: %w", err)
	}
	return LocalAppSessionHandle{SessionID: sessionID, SessionProof: sessionProof}, nil
}

type LocalAppLaunchPeerVerifier interface {
	VerifyLocalAppLaunchPeer(context.Context) (VerifiedLocalAppLaunchPeer, error)
}

type staticLocalAppPeerVerifier struct{ peer VerifiedLocalAppLaunchPeer }

func (verifier staticLocalAppPeerVerifier) VerifyLocalAppLaunchPeer(context.Context) (VerifiedLocalAppLaunchPeer, error) {
	return verifier.peer, nil
}

type LocalAppConnection struct {
	launchID                    Identifier
	process                     ProcessTuple
	boot                        Identifier
	liveness                    DesktopProcessLiveness
	directPeer                  *DirectLocalAppPeer
	directLaunch                *DirectLocalAppLaunch
	installedRegistrationHandle string
	trustClass                  LocalAppTrustClass
	live                        atomic.Bool
	done                        chan struct{}
	revokeMu                    sync.Mutex
	hooks                       []func()
	sessionMu                   sync.RWMutex
	session                     *LocalAppSessionHandle
	sessionInvalidated          *localAppSessionInvalidation
	sessionResources            map[string]func()
	directAuthorized            bool
}

type localAppSessionInvalidation struct {
	once sync.Once
	done chan struct{}
}

func newLocalAppSessionInvalidation() *localAppSessionInvalidation {
	return &localAppSessionInvalidation{done: make(chan struct{})}
}

func (invalidation *localAppSessionInvalidation) invalidate() {
	if invalidation != nil {
		invalidation.once.Do(func() { close(invalidation.done) })
	}
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

// EstablishInstalledAppConnection binds an installed formal App registration
// to the already verified Desktop process lifetime. It carries only the opaque
// registration handle and process witness; declaration, Effective App Access,
// account, and exact operation admission remain ordinary session-kernel work.
// @nimi-authority: rule.nimi.runtime.protected-session.r023
func EstablishInstalledAppConnection(registrationHandle string, launchID, runtimeBootEpoch Identifier, process ProcessTuple, ownerDone <-chan struct{}) (*LocalAppConnection, error) {
	if registrationHandle == "" || launchID == (Identifier{}) || runtimeBootEpoch == (Identifier{}) || ownerDone == nil {
		return nil, fmt.Errorf("installed local-app launch binding is incomplete")
	}
	if err := process.validate(); err != nil {
		return nil, fmt.Errorf("validate installed local-app process: %w", err)
	}
	connection := &LocalAppConnection{
		launchID: launchID, process: process, boot: runtimeBootEpoch,
		installedRegistrationHandle: registrationHandle, trustClass: LocalAppTrustBuiltIn,
		done: make(chan struct{}),
	}
	connection.live.Store(true)
	go func() {
		select {
		case <-ownerDone:
			connection.Revoke()
		case <-connection.done:
		}
	}()
	return connection, nil
}

func newDirectLocalAppConnection(peer DirectLocalAppPeer, launch DirectLocalAppLaunch) (*LocalAppConnection, error) {
	if !peer.valid() || !launch.valid() || launch.Process.PID == 0 || launch.BindDeadline.IsZero() ||
		peer.PID != launch.Process.PID || peer.UID != launch.ExpectedUID {
		return nil, fail(ReasonDesktopProcessVerificationUnavailable, false, "relaunch_app", fmt.Errorf("direct local-app peer or launch is incomplete"))
	}
	directPeer := peer
	directLaunch := launch
	connection := &LocalAppConnection{
		launchID: launch.LaunchID, directPeer: &directPeer, directLaunch: &directLaunch,
		trustClass: LocalAppTrustLocalDevelopment, done: make(chan struct{}),
	}
	connection.live.Store(true)
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

func (connection *LocalAppConnection) DirectPeer() (DirectLocalAppPeer, bool) {
	if connection == nil || connection.directPeer == nil || !connection.live.Load() {
		return DirectLocalAppPeer{}, false
	}
	return *connection.directPeer, true
}

func (connection *LocalAppConnection) DirectLaunch() (DirectLocalAppLaunch, bool) {
	if connection == nil || connection.directLaunch == nil || !connection.live.Load() {
		return DirectLocalAppLaunch{}, false
	}
	return *connection.directLaunch, true
}

func (connection *LocalAppConnection) InstalledRegistrationHandle() (string, bool) {
	if connection == nil || !connection.live.Load() || connection.trustClass != LocalAppTrustBuiltIn || connection.installedRegistrationHandle == "" {
		return "", false
	}
	return connection.installedRegistrationHandle, true
}

func (connection *LocalAppConnection) Live() bool {
	return connection != nil && connection.live.Load()
}

func (trustClass LocalAppTrustClass) valid() bool {
	return trustClass == LocalAppTrustLocalDevelopment || trustClass == LocalAppTrustBuiltIn
}

func (connection *LocalAppConnection) TrustClass() LocalAppTrustClass {
	if connection == nil {
		return ""
	}
	return connection.trustClass
}

func (connection *LocalAppConnection) Origin() OriginContext {
	if connection == nil || !connection.live.Load() || !connection.trustClass.valid() || connection.directPeer != nil {
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

func (connection *LocalAppConnection) BindDirectAuthorization() error {
	if connection == nil || connection.directPeer == nil || connection.directLaunch == nil {
		return fmt.Errorf("direct local-app connection is unavailable")
	}
	connection.sessionMu.Lock()
	defer connection.sessionMu.Unlock()
	if !connection.live.Load() {
		return fmt.Errorf("direct local-app connection is revoked")
	}
	if connection.directAuthorized {
		return fmt.Errorf("direct local-app connection is already authorized")
	}
	connection.directAuthorized = true
	return nil
}

func (connection *LocalAppConnection) DirectAuthorizationBound() bool {
	if connection == nil || connection.directPeer == nil || connection.directLaunch == nil {
		return false
	}
	connection.sessionMu.RLock()
	defer connection.sessionMu.RUnlock()
	return connection.live.Load() && connection.directAuthorized
}

func (connection *LocalAppConnection) BootstrapAllowed() bool {
	if connection == nil || !connection.live.Load() {
		return false
	}
	if connection.directPeer != nil {
		connection.sessionMu.RLock()
		defer connection.sessionMu.RUnlock()
		return connection.live.Load() && connection.session == nil && !connection.directAuthorized
	}
	origin := connection.Origin()
	return origin.TransportClass == TransportLocalAppBootstrap && origin.HasRole(RoleLocalAppProcess)
}

func (connection *LocalAppConnection) ProtectedOperationAllowed() bool {
	if connection == nil || !connection.live.Load() {
		return false
	}
	if connection.directPeer != nil {
		connection.sessionMu.RLock()
		defer connection.sessionMu.RUnlock()
		return connection.live.Load() && (connection.session != nil || connection.directAuthorized)
	}
	origin := connection.Origin()
	return origin.TransportClass == TransportLocalAppHost && origin.HasRole(RoleLocalAppSession)
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
	if !connection.trustClass.valid() {
		return fmt.Errorf("local-app connection trust class is unavailable")
	}
	if connection.session != nil {
		return fmt.Errorf("local-app connection already has a session")
	}
	bound := handle
	connection.session = &bound
	connection.sessionInvalidated = newLocalAppSessionInvalidation()
	connection.sessionResources = make(map[string]func())
	if connection.directPeer != nil {
		connection.directAuthorized = true
	}
	return nil
}

func (connection *LocalAppConnection) Session() (LocalAppSessionHandle, bool) {
	if connection == nil || !connection.live.Load() || !connection.trustClass.valid() {
		return LocalAppSessionHandle{}, false
	}
	connection.sessionMu.RLock()
	defer connection.sessionMu.RUnlock()
	if connection.session == nil || !connection.live.Load() {
		return LocalAppSessionHandle{}, false
	}
	return *connection.session, true
}

// SessionInvalidated returns the exact current technical-session fence. The
// signal closes on rotation, expiry invalidation, or protected connection
// loss; it is never serialized outside Runtime.
func (connection *LocalAppConnection) SessionInvalidated(handle LocalAppSessionHandle) (<-chan struct{}, bool) {
	if connection == nil || handle.SessionID == (Identifier{}) || handle.SessionProof == (Identifier{}) {
		return nil, false
	}
	connection.sessionMu.RLock()
	defer connection.sessionMu.RUnlock()
	if !connection.live.Load() || connection.session == nil || *connection.session != handle || connection.sessionInvalidated == nil {
		return nil, false
	}
	return connection.sessionInvalidated.done, true
}

// InvalidateSession closes the current technical-session fence without
// terminating the still-verified Host connection. Renewal may subsequently
// install a fresh session after complete revalidation.
func (connection *LocalAppConnection) InvalidateSession(handle LocalAppSessionHandle) bool {
	if connection == nil || handle.SessionID == (Identifier{}) || handle.SessionProof == (Identifier{}) {
		return false
	}
	connection.sessionMu.Lock()
	if !connection.live.Load() || connection.session == nil || *connection.session != handle {
		connection.sessionMu.Unlock()
		return false
	}
	invalidation := connection.sessionInvalidated
	resources := make([]func(), 0, len(connection.sessionResources))
	for _, cleanup := range connection.sessionResources {
		resources = append(resources, cleanup)
	}
	connection.sessionResources = make(map[string]func())
	connection.sessionMu.Unlock()
	invalidation.invalidate()
	for _, cleanup := range resources {
		cleanup()
	}
	return true
}

// BindSessionResource attaches one exact Runtime-owned realtime resource to
// the current technical session. Rotation/revocation fences later access and
// runs cleanup without affecting resources owned by another session.
func (connection *LocalAppConnection) BindSessionResource(handle LocalAppSessionHandle, key string, cleanup func()) bool {
	if connection == nil || handle.SessionID == (Identifier{}) || handle.SessionProof == (Identifier{}) || key == "" || cleanup == nil {
		return false
	}
	connection.sessionMu.Lock()
	defer connection.sessionMu.Unlock()
	if !connection.live.Load() || connection.session == nil || *connection.session != handle || connection.sessionInvalidated == nil {
		return false
	}
	select {
	case <-connection.sessionInvalidated.done:
		return false
	default:
	}
	if connection.sessionResources == nil {
		connection.sessionResources = make(map[string]func())
	}
	if _, exists := connection.sessionResources[key]; exists {
		return false
	}
	connection.sessionResources[key] = cleanup
	return true
}

func (connection *LocalAppConnection) SessionOwnsResource(handle LocalAppSessionHandle, key string) bool {
	if connection == nil || key == "" {
		return false
	}
	connection.sessionMu.RLock()
	defer connection.sessionMu.RUnlock()
	if !connection.live.Load() || connection.session == nil || *connection.session != handle || connection.sessionInvalidated == nil {
		return false
	}
	select {
	case <-connection.sessionInvalidated.done:
		return false
	default:
	}
	_, ok := connection.sessionResources[key]
	return ok
}

func (connection *LocalAppConnection) ReleaseSessionResource(handle LocalAppSessionHandle, key string) {
	if connection == nil || key == "" {
		return
	}
	connection.sessionMu.Lock()
	if connection.session != nil && *connection.session == handle {
		delete(connection.sessionResources, key)
	}
	connection.sessionMu.Unlock()
}

func (connection *LocalAppConnection) RotateSession(previous LocalAppSessionHandle, next LocalAppSessionHandle) error {
	if connection == nil || previous.SessionID == (Identifier{}) || previous.SessionProof == (Identifier{}) || next.SessionID == (Identifier{}) || next.SessionProof == (Identifier{}) {
		return fmt.Errorf("local-app session rotation handles are incomplete")
	}
	connection.sessionMu.Lock()
	if !connection.live.Load() || !connection.trustClass.valid() || connection.session == nil || *connection.session != previous {
		connection.sessionMu.Unlock()
		return fmt.Errorf("local-app session rotation lost its exact connection binding")
	}
	previousInvalidation := connection.sessionInvalidated
	resources := make([]func(), 0, len(connection.sessionResources))
	for _, cleanup := range connection.sessionResources {
		resources = append(resources, cleanup)
	}
	rotated := next
	connection.session = &rotated
	connection.sessionInvalidated = newLocalAppSessionInvalidation()
	connection.sessionResources = make(map[string]func())
	connection.sessionMu.Unlock()
	previousInvalidation.invalidate()
	for _, cleanup := range resources {
		cleanup()
	}
	return nil
}

func (connection *LocalAppConnection) Revoke() {
	if connection == nil || !connection.live.CompareAndSwap(true, false) {
		return
	}
	close(connection.done)
	if connection.liveness != nil {
		_ = connection.liveness.Close()
	}
	connection.sessionMu.Lock()
	sessionInvalidation := connection.sessionInvalidated
	resources := make([]func(), 0, len(connection.sessionResources))
	for _, cleanup := range connection.sessionResources {
		resources = append(resources, cleanup)
	}
	connection.session = nil
	connection.sessionInvalidated = nil
	connection.sessionResources = nil
	connection.directAuthorized = false
	connection.sessionMu.Unlock()
	sessionInvalidation.invalidate()
	connection.revokeMu.Lock()
	hooks := append([]func(){}, connection.hooks...)
	connection.hooks = nil
	connection.revokeMu.Unlock()
	for _, hook := range hooks {
		hook()
	}
	for _, cleanup := range resources {
		cleanup()
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
