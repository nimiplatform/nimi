package protectedlocal

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"io"
	"strings"
	"sync"
	"sync/atomic"
)

const IdentifierBytes = 32

type Identifier [IdentifierBytes]byte

func NewBootEpoch(random io.Reader) (Identifier, error) {
	identifier, err := readIdentifier(random)
	if err != nil {
		return Identifier{}, fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "restart_runtime_service", fmt.Errorf("generate runtime boot epoch: %w", err))
	}
	return identifier, nil
}

func readIdentifier(random io.Reader) (Identifier, error) {
	if random == nil {
		random = rand.Reader
	}
	var identifier Identifier
	if _, err := io.ReadFull(random, identifier[:]); err != nil {
		return Identifier{}, fmt.Errorf("read 32-byte identifier: %w", err)
	}
	if identifier == (Identifier{}) {
		return Identifier{}, fmt.Errorf("read 32-byte identifier: all-zero value")
	}
	return identifier, nil
}

type TransportClass string

const (
	TransportPublicTCP       TransportClass = "public_tcp"
	TransportDesktopControl  TransportClass = "desktop_control"
	TransportLaunchBootstrap TransportClass = "launch_bootstrap"
	TransportInstalledHost   TransportClass = "installed_host"
)

type OriginRole string

const (
	RoleBindingOnly            OriginRole = "binding_only"
	RoleVerifiedDesktopProcess OriginRole = "verified_desktop_process"
	RoleDesktopAccountHost     OriginRole = "desktop_account_host"
	RoleDesktopLifecycleHost   OriginRole = "desktop_lifecycle_host"
)

type OperatingSystem string

const (
	OSWindows OperatingSystem = "windows"
	OSLinux   OperatingSystem = "linux"
	OSMacOS   OperatingSystem = "macos"
)

type ProcessTuple struct {
	OS                          OperatingSystem
	PID                         uint32
	CreationMarker              string
	OSLoginSession              string
	SecurityPrincipal           string
	CanonicalExecutableIdentity string
	ExecutableDigest            Identifier
	ExecutableTrustSetID        string
}

func (tuple ProcessTuple) validate() error {
	switch tuple.OS {
	case OSWindows, OSLinux, OSMacOS:
	default:
		return fmt.Errorf("process tuple operating system is not admitted")
	}
	if tuple.PID == 0 || !canonicalIdentityField(tuple.CreationMarker) ||
		!canonicalIdentityField(tuple.OSLoginSession) || !canonicalIdentityField(tuple.SecurityPrincipal) ||
		!canonicalIdentityField(tuple.CanonicalExecutableIdentity) || tuple.ExecutableDigest == (Identifier{}) ||
		!canonicalIdentityField(tuple.ExecutableTrustSetID) {
		return fmt.Errorf("process tuple is incomplete")
	}
	return nil
}

func canonicalIdentityField(value string) bool {
	return value != "" && value == strings.TrimSpace(value) && !strings.ContainsRune(value, '\x00')
}

func (tuple ProcessTuple) digest() Identifier {
	hash := sha256.New()
	writeCanonicalString(hash, string(tuple.OS))
	var pid [4]byte
	binary.BigEndian.PutUint32(pid[:], tuple.PID)
	_, _ = hash.Write(pid[:])
	writeCanonicalString(hash, tuple.CreationMarker)
	writeCanonicalString(hash, tuple.OSLoginSession)
	writeCanonicalString(hash, tuple.CanonicalExecutableIdentity)
	_, _ = hash.Write(tuple.ExecutableDigest[:])
	writeCanonicalString(hash, tuple.ExecutableTrustSetID)
	var result Identifier
	copy(result[:], hash.Sum(nil))
	return result
}

func writeCanonicalString(writer io.Writer, value string) {
	var length [4]byte
	binary.BigEndian.PutUint32(length[:], uint32(len(value)))
	_, _ = writer.Write(length[:])
	_, _ = io.WriteString(writer, value)
}

type VerifiedDesktopPeers struct {
	Client             ProcessTuple
	Server             ProcessTuple
	ClientLiveness     DesktopProcessLiveness
	RuntimeBootEpoch   Identifier
	EndpointInstanceID Identifier
	TranscriptNonce    Identifier
}

type DesktopPeerVerifier interface {
	VerifyDesktopPeers(context.Context) (VerifiedDesktopPeers, error)
}

// DesktopProcessLiveness retains the OS process-liveness primitive selected by
// the platform verifier. Revoked closes on process exit, post-bind exec,
// creation-marker change, or executable-identity change. Close releases the
// retained handle/pidfd/kqueue witness.
type DesktopProcessLiveness interface {
	Revoked() <-chan struct{}
	Close() error
}

type OriginContext struct {
	TransportClass TransportClass
	roles          map[OriginRole]struct{}
	connectionID   Identifier
	processHash    Identifier
	bootEpoch      Identifier
}

func (origin OriginContext) HasRole(role OriginRole) bool {
	_, ok := origin.roles[role]
	return ok
}

type Connection struct {
	origin      OriginContext
	live        atomic.Bool
	done        chan struct{}
	revokedDone chan struct{}

	clientLiveness DesktopProcessLiveness
	livenessSignal <-chan struct{}

	revokeMu    sync.Mutex
	revokeHooks []func()

	desktopSessionMu sync.RWMutex
	desktopSession   *desktopSessionAuthority
}

type desktopConnectionContextKey struct{}

type desktopConnectionContextValue struct {
	connection *Connection
}

// ContextWithDesktopConnection attaches the already-verified protected-local
// connection to an in-process RPC context. The private key and wrapper prevent
// request fields or gRPC metadata from reconstructing this value.
func ContextWithDesktopConnection(ctx context.Context, connection *Connection) context.Context {
	return context.WithValue(ctx, desktopConnectionContextKey{}, desktopConnectionContextValue{connection: connection})
}

// DesktopConnectionFromContext returns only a connection attached through
// ContextWithDesktopConnection. Liveness and role authorization remain the
// responsibility of DesktopSessionManager.
func DesktopConnectionFromContext(ctx context.Context) (*Connection, bool) {
	if ctx == nil {
		return nil, false
	}
	value, ok := ctx.Value(desktopConnectionContextKey{}).(desktopConnectionContextValue)
	return value.connection, ok && value.connection != nil
}

func EstablishDesktopConnection(ctx context.Context, verifier DesktopPeerVerifier, random io.Reader) (*Connection, error) {
	if verifier == nil {
		return nil, fail(ReasonDesktopProcessVerificationUnavailable, false, "restart_desktop", fmt.Errorf("verify desktop peers: verifier is nil"))
	}
	peers, err := verifier.VerifyDesktopPeers(ctx)
	if err != nil {
		if peers.ClientLiveness != nil {
			_ = peers.ClientLiveness.Close()
		}
		return nil, fail(ReasonDesktopProcessVerificationUnavailable, true, "restart_desktop", fmt.Errorf("verify desktop peers: %w", err))
	}
	if peers.ClientLiveness == nil {
		return nil, fail(ReasonDesktopProcessVerificationUnavailable, false, "restart_desktop", fmt.Errorf("verify desktop peers: retained client liveness is required"))
	}
	livenessSignal := peers.ClientLiveness.Revoked()
	if livenessSignal == nil {
		if peers.ClientLiveness != nil {
			_ = peers.ClientLiveness.Close()
		}
		return nil, fail(ReasonDesktopProcessVerificationUnavailable, false, "restart_desktop", fmt.Errorf("verify desktop peers: retained client liveness is required"))
	}
	acceptedLiveness := false
	defer func() {
		if !acceptedLiveness {
			_ = peers.ClientLiveness.Close()
		}
	}()
	if err := peers.Client.validate(); err != nil {
		return nil, fail(ReasonDesktopExecutableTrustFailed, false, "reinstall_desktop", fmt.Errorf("validate desktop process: %w", err))
	}
	if err := peers.Server.validate(); err != nil {
		return nil, fail(ReasonProtectedLocalRuntimePrincipalRequired, false, "repair_runtime_service", fmt.Errorf("validate runtime process: %w", err))
	}
	if peers.Client.OS != peers.Server.OS || peers.Client.SecurityPrincipal == peers.Server.SecurityPrincipal {
		return nil, fail(ReasonProtectedLocalRuntimePrincipalRequired, false, "repair_runtime_service", fmt.Errorf("validate runtime principal: asymmetric principals required"))
	}
	if peers.RuntimeBootEpoch == (Identifier{}) || peers.EndpointInstanceID == (Identifier{}) || peers.TranscriptNonce == (Identifier{}) {
		return nil, fail(ReasonDesktopProcessVerificationUnavailable, false, "restart_desktop", fmt.Errorf("validate protected transcript: incomplete binding"))
	}
	select {
	case <-livenessSignal:
		return nil, fail(ReasonDesktopProcessVerificationUnavailable, true, "restart_desktop", fmt.Errorf("validate desktop process: liveness already revoked"))
	default:
	}
	connectionID, err := readIdentifier(random)
	if err != nil {
		return nil, fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "restart_runtime_service", fmt.Errorf("generate connection identifier: %w", err))
	}
	connection := &Connection{
		origin: OriginContext{
			TransportClass: TransportDesktopControl,
			roles: map[OriginRole]struct{}{
				RoleVerifiedDesktopProcess: {},
				RoleDesktopAccountHost:     {},
				RoleDesktopLifecycleHost:   {},
			},
			connectionID: connectionID,
			processHash:  peers.Client.digest(),
			bootEpoch:    peers.RuntimeBootEpoch,
		},
		done:           make(chan struct{}),
		revokedDone:    make(chan struct{}),
		clientLiveness: peers.ClientLiveness,
		livenessSignal: livenessSignal,
	}
	connection.live.Store(true)
	acceptedLiveness = true
	go connection.watchClientLiveness()
	return connection, nil
}

func (connection *Connection) watchClientLiveness() {
	select {
	case <-connection.livenessSignal:
		connection.Revoke()
	case <-connection.done:
	}
}

func (connection *Connection) Origin() OriginContext {
	if connection == nil {
		return OriginContext{}
	}
	roles := make(map[OriginRole]struct{}, len(connection.origin.roles))
	for role := range connection.origin.roles {
		roles[role] = struct{}{}
	}
	origin := connection.origin
	origin.roles = roles
	return origin
}

func (connection *Connection) Revoke() {
	if connection == nil {
		return
	}
	if !connection.live.CompareAndSwap(true, false) {
		if connection.revokedDone != nil {
			<-connection.revokedDone
		}
		return
	}
	close(connection.done)
	_ = connection.clientLiveness.Close()
	connection.revokeMu.Lock()
	hooks := append([]func(){}, connection.revokeHooks...)
	connection.revokeHooks = nil
	connection.revokeMu.Unlock()
	for _, hook := range hooks {
		hook()
	}
	if connection.revokedDone != nil {
		close(connection.revokedDone)
	}
}

func (connection *Connection) onRevoke(hook func()) {
	connection.revokeMu.Lock()
	if !connection.live.Load() {
		connection.revokeMu.Unlock()
		hook()
		return
	}
	connection.revokeHooks = append(connection.revokeHooks, hook)
	connection.revokeMu.Unlock()
}

type DesktopSessionProjection struct {
	DesktopSessionID []byte
	RuntimeBootEpoch []byte
}

type desktopSessionAuthority struct {
	managerID    Identifier
	sessionID    Identifier
	connection   *Connection
	connectionID Identifier
	processHash  Identifier
	bootEpoch    Identifier
	revoked      atomic.Bool
}

type DesktopSessionRecord struct {
	SessionID   Identifier
	BootEpoch   Identifier
	Connection  Identifier
	ProcessHash Identifier
}

type DesktopSessionManager struct {
	bootEpoch Identifier
	random    io.Reader
	managerID Identifier

	mu       sync.Mutex
	sessions map[Identifier]*desktopSessionAuthority
}

func NewDesktopSessionManager(bootEpoch Identifier, random io.Reader) (*DesktopSessionManager, error) {
	if bootEpoch == (Identifier{}) {
		return nil, fail(ReasonProtectedLocalBootEpochMismatch, false, "reconnect_desktop", fmt.Errorf("create desktop session manager: boot epoch is empty"))
	}
	managerID, err := readIdentifier(random)
	if err != nil {
		return nil, fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "restart_runtime_service", fmt.Errorf("generate session manager identifier: %w", err))
	}
	return &DesktopSessionManager{
		bootEpoch: bootEpoch,
		random:    random,
		managerID: managerID,
		sessions:  make(map[Identifier]*desktopSessionAuthority),
	}, nil
}

// ValidateBootScoped confirms that this manager owns a live boot-scoped
// session index. Normal Desktop sessions are not durable-anchor truth.
func (manager *DesktopSessionManager) ValidateBootScoped(ctx context.Context) error {
	if ctx == nil {
		return fail(ReasonProtectedLocalLedgerUnavailable, false, "restart_runtime_service", fmt.Errorf("validate desktop session manager: context is required"))
	}
	if manager == nil || manager.bootEpoch == (Identifier{}) || manager.managerID == (Identifier{}) {
		return fail(ReasonProtectedLocalLedgerUnavailable, false, "restart_runtime_service", fmt.Errorf("validate desktop session manager: boot-scoped authority is incomplete"))
	}
	manager.mu.Lock()
	sessionsReady := manager.sessions != nil
	manager.mu.Unlock()
	if !sessionsReady {
		return fail(ReasonProtectedLocalLedgerUnavailable, false, "restart_runtime_service", fmt.Errorf("validate desktop session manager: authoritative session index is unavailable"))
	}
	return nil
}

func (manager *DesktopSessionManager) Open(ctx context.Context) (DesktopSessionProjection, error) {
	connection, ok := DesktopConnectionFromContext(ctx)
	if !ok {
		return DesktopSessionProjection{}, fail(ReasonDesktopControlTransportRequired, false, "use_desktop_control", fmt.Errorf("open desktop session: protected connection context is required"))
	}
	if connection == nil || !connection.live.Load() {
		return DesktopSessionProjection{}, fail(ReasonDesktopProcessVerificationUnavailable, true, "reconnect_desktop", fmt.Errorf("open desktop session: connection is not live"))
	}
	origin := connection.origin
	if origin.TransportClass != TransportDesktopControl {
		return DesktopSessionProjection{}, fail(ReasonDesktopControlTransportRequired, false, "use_desktop_control", fmt.Errorf("open desktop session: transport mismatch"))
	}
	if !origin.HasRole(RoleVerifiedDesktopProcess) {
		return DesktopSessionProjection{}, fail(ReasonProtectedOriginRoleMismatch, false, "reconnect_desktop", fmt.Errorf("open desktop session: verified desktop role missing"))
	}
	if origin.bootEpoch != manager.bootEpoch {
		return DesktopSessionProjection{}, fail(ReasonProtectedLocalBootEpochMismatch, true, "reconnect_desktop", fmt.Errorf("open desktop session: boot epoch mismatch"))
	}

	manager.mu.Lock()
	if existing := manager.sessions[origin.processHash]; existing != nil && !existing.revoked.Load() {
		manager.mu.Unlock()
		return DesktopSessionProjection{}, fail(ReasonProtectedOriginRoleMismatch, false, "reuse_live_desktop_session", fmt.Errorf("open desktop session: process already owns a live session"))
	}
	sessionID, err := readIdentifier(manager.random)
	if err != nil {
		manager.mu.Unlock()
		return DesktopSessionProjection{}, fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "restart_runtime_service", fmt.Errorf("generate desktop session identifier: %w", err))
	}
	authority := &desktopSessionAuthority{
		managerID:    manager.managerID,
		sessionID:    sessionID,
		connection:   connection,
		connectionID: origin.connectionID,
		processHash:  origin.processHash,
		bootEpoch:    manager.bootEpoch,
	}
	if !connection.bindDesktopSession(authority) {
		manager.mu.Unlock()
		return DesktopSessionProjection{}, fail(ReasonProtectedOriginRoleMismatch, false, "reuse_live_desktop_session", fmt.Errorf("open desktop session: connection already owns a session authority"))
	}
	manager.sessions[origin.processHash] = authority
	manager.mu.Unlock()
	connection.onRevoke(func() { manager.revokeAuthority(authority) })
	if !connection.live.Load() || authority.revoked.Load() {
		return DesktopSessionProjection{}, fail(ReasonDesktopProcessVerificationUnavailable, true, "reconnect_desktop", fmt.Errorf("open desktop session: connection revoked during session establishment"))
	}
	return DesktopSessionProjection{
		DesktopSessionID: append([]byte(nil), sessionID[:]...),
		RuntimeBootEpoch: append([]byte(nil), manager.bootEpoch[:]...),
	}, nil
}

// AuthorizeContext authorizes a role only for the live connection that owns
// the manager-internal desktop session authority. Correlation projections and
// metadata are never accepted as rebind proof.
func (manager *DesktopSessionManager) AuthorizeContext(ctx context.Context, role OriginRole) error {
	connection, ok := DesktopConnectionFromContext(ctx)
	if !ok {
		return fail(ReasonDesktopControlTransportRequired, false, "use_desktop_control", fmt.Errorf("authorize desktop session: protected connection context is required"))
	}
	authority := connection.desktopSessionAuthority()
	if connection == nil || !connection.live.Load() {
		return fail(ReasonDesktopProcessVerificationUnavailable, true, "reconnect_desktop", fmt.Errorf("authorize desktop session: live connection required"))
	}
	if authority == nil {
		return fail(ReasonProtectedOriginRoleMismatch, false, "reconnect_desktop", fmt.Errorf("authorize desktop session: connection has no session authority"))
	}
	if authority.revoked.Load() {
		return fail(ReasonDesktopProcessVerificationUnavailable, true, "reconnect_desktop", fmt.Errorf("authorize desktop session: session authority is revoked"))
	}
	if authority.managerID != manager.managerID || authority.connection != connection || authority.connectionID != connection.origin.connectionID || authority.processHash != connection.origin.processHash {
		return fail(ReasonProtectedOriginRoleMismatch, false, "reconnect_desktop", fmt.Errorf("authorize desktop session: connection binding mismatch"))
	}
	if authority.bootEpoch != manager.bootEpoch || connection.origin.bootEpoch != manager.bootEpoch {
		return fail(ReasonProtectedLocalBootEpochMismatch, true, "reconnect_desktop", fmt.Errorf("authorize desktop session: boot epoch mismatch"))
	}
	if !connection.origin.HasRole(role) {
		return fail(ReasonProtectedOriginRoleMismatch, false, "reconnect_desktop", fmt.Errorf("authorize desktop session: origin role mismatch"))
	}
	manager.mu.Lock()
	current := manager.sessions[authority.processHash]
	manager.mu.Unlock()
	if current != authority {
		return fail(ReasonProtectedOriginRoleMismatch, false, "reconnect_desktop", fmt.Errorf("authorize desktop session: session is not authoritative"))
	}
	return nil
}

func (connection *Connection) bindDesktopSession(authority *desktopSessionAuthority) bool {
	connection.desktopSessionMu.Lock()
	defer connection.desktopSessionMu.Unlock()
	if connection.desktopSession != nil {
		return false
	}
	connection.desktopSession = authority
	return true
}

func (connection *Connection) desktopSessionAuthority() *desktopSessionAuthority {
	if connection == nil {
		return nil
	}
	connection.desktopSessionMu.RLock()
	authority := connection.desktopSession
	connection.desktopSessionMu.RUnlock()
	return authority
}

func (connection *Connection) unbindDesktopSession(authority *desktopSessionAuthority) {
	if connection == nil {
		return
	}
	connection.desktopSessionMu.Lock()
	if connection.desktopSession == authority {
		connection.desktopSession = nil
	}
	connection.desktopSessionMu.Unlock()
}

func (manager *DesktopSessionManager) revokeAuthority(authority *desktopSessionAuthority) {
	if authority == nil || !authority.revoked.CompareAndSwap(false, true) {
		return
	}
	authority.connection.unbindDesktopSession(authority)
	manager.mu.Lock()
	if manager.sessions[authority.processHash] == authority {
		delete(manager.sessions, authority.processHash)
	}
	manager.mu.Unlock()
}
