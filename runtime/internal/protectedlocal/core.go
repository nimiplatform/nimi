package protectedlocal

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
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
	TransportPublicTCP         TransportClass = "public_tcp"
	TransportDesktopControl    TransportClass = "desktop_control"
	TransportLocalAppBootstrap TransportClass = "local_app_bootstrap"
	TransportLocalAppHost      TransportClass = "local_app_host"
)

type OriginRole string

const (
	RoleBindingOnly            OriginRole = "binding_only"
	RoleVerifiedDesktopProcess OriginRole = "verified_desktop_process"
	RoleDesktopAccountHost     OriginRole = "desktop_account_host"
	RoleBundledAvatarHost      OriginRole = "bundled_avatar_host"
	RoleLocalAppControl        OriginRole = "local_app_control"
	RoleLocalAppProcess        OriginRole = "local_app_process"
	RoleLocalAppSession        OriginRole = "local_app_session"
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
	// CanonicalExecutablePath is populated for mutable local-development hosts
	// whose authorization is bound to a selected project root. Production
	// release callers remain bound by immutable file identity and digest.
	CanonicalExecutablePath string
	ExecutableDigest        Identifier
	ExecutableTrustSetID    string
}

func ValidateProcessTuple(tuple ProcessTuple) error { return tuple.validate() }

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
	if tuple.CanonicalExecutablePath != "" && !canonicalIdentityField(tuple.CanonicalExecutablePath) {
		return fmt.Errorf("process tuple executable path is not canonical")
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

// DesktopPeerIdentity is the minimal OS identity retained for a directly
// verified native Desktop socket. It is not a portable process proof.
type DesktopPeerIdentity struct {
	OS           OperatingSystem
	PID          uint32
	UID          uint32
	AuditSession uint32
}

type Connection struct {
	origin      OriginContext
	client      ProcessTuple
	directPeer  DesktopPeerIdentity
	live        atomic.Bool
	done        chan struct{}
	revokedDone chan struct{}

	clientLiveness DesktopProcessLiveness
	livenessSignal <-chan struct{}

	revokeMu         sync.Mutex
	revokeHooks      []func()
	boundRevokeHooks map[Identifier]func()

	desktopSessionMu sync.RWMutex
	desktopSession   *desktopSessionAuthority
}

func newDirectDesktopConnection(peer DesktopPeerIdentity, liveness DesktopProcessLiveness) (*Connection, error) {
	return newDirectDesktopConnectionWithClient(peer, ProcessTuple{}, liveness)
}

// newDirectDesktopConnectionWithClient retains a complete process tuple only
// when the native direct transport verified it from the connected process.
// A direct transport without that evidence remains unable to authorize a
// formal built-in App session.
func newDirectDesktopConnectionWithClient(peer DesktopPeerIdentity, client ProcessTuple, liveness DesktopProcessLiveness) (*Connection, error) {
	if (peer.OS != OSMacOS && peer.OS != OSWindows) || peer.PID == 0 || peer.UID == 0 || peer.AuditSession == 0 {
		return nil, fail(ReasonDesktopProcessVerificationUnavailable, false, "restart_desktop", fmt.Errorf("verified direct Desktop peer is incomplete"))
	}
	if client != (ProcessTuple{}) {
		if err := client.validate(); err != nil || client.OS != peer.OS || client.PID != peer.PID {
			return nil, fail(ReasonDesktopProcessVerificationUnavailable, false, "restart_desktop", fmt.Errorf("verified direct Desktop process is incomplete or does not match its peer"))
		}
	}
	var livenessSignal <-chan struct{}
	if liveness != nil {
		livenessSignal = liveness.Revoked()
		if livenessSignal == nil {
			return nil, fail(ReasonDesktopProcessVerificationUnavailable, false, "restart_desktop", fmt.Errorf("verified direct Desktop liveness witness is incomplete"))
		}
		select {
		case <-livenessSignal:
			return nil, fail(ReasonDesktopProcessVerificationUnavailable, true, "restart_desktop", fmt.Errorf("verified direct Desktop process already exited"))
		default:
		}
	}
	connectionID, err := readIdentifier(nil)
	if err != nil {
		return nil, fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "restart_runtime_service", fmt.Errorf("generate direct connection identifier: %w", err))
	}
	connection := &Connection{
		origin: OriginContext{
			TransportClass: TransportDesktopControl,
			connectionID:   connectionID,
		},
		client:         client,
		directPeer:     peer,
		done:           make(chan struct{}),
		revokedDone:    make(chan struct{}),
		clientLiveness: liveness,
		livenessSignal: livenessSignal,
	}
	connection.live.Store(true)
	if livenessSignal != nil {
		go connection.watchClientLiveness()
	}
	return connection, nil
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

// VerifiedDesktopConnectionIDFromContext returns the Runtime-minted opaque
// identity of one accepted protected Desktop transport. The identifier is for
// Runtime-internal ephemeral ownership only and is never reconstructed from
// request fields or gRPC metadata.
func VerifiedDesktopConnectionIDFromContext(ctx context.Context) (Identifier, bool) {
	connection, ok := DesktopConnectionFromContext(ctx)
	if !ok || !connection.live.Load() || connection.origin.TransportClass != TransportDesktopControl || connection.origin.connectionID == (Identifier{}) {
		return Identifier{}, false
	}
	return connection.origin.connectionID, true
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
				RoleBundledAvatarHost:      {},
				RoleLocalAppControl:        {},
			},
			connectionID: connectionID,
			processHash:  peers.Client.digest(),
			bootEpoch:    peers.RuntimeBootEpoch,
		},
		client:         peers.Client,
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

// ClientProcess returns the immutable process tuple established from native
// peer evidence. It exists so platform verifiers can bind a supervised child
// to the exact Desktop parent; request fields cannot populate it.
func (connection *Connection) ClientProcess() (ProcessTuple, bool) {
	if connection == nil || !connection.live.Load() {
		return ProcessTuple{}, false
	}
	return connection.client, connection.client.validate() == nil
}

// DirectDesktopPeer returns only the minimal identity retained by a per-user
// native peer path. Production Windows continues to use ClientProcess.
func (connection *Connection) DirectDesktopPeer() (DesktopPeerIdentity, bool) {
	if connection == nil || !connection.live.Load() ||
		(connection.directPeer.OS != OSMacOS && connection.directPeer.OS != OSWindows) ||
		connection.directPeer.PID == 0 || connection.directPeer.UID == 0 ||
		connection.directPeer.AuditSession == 0 {
		return DesktopPeerIdentity{}, false
	}
	return connection.directPeer, true
}

// VerifiedDesktopTransport reports authority created by a native verified
// listener. Production Windows keeps its role-bearing session path; per-user
// adapters are authorized directly from the connected OS peer.
func (connection *Connection) VerifiedDesktopTransport() bool {
	if connection == nil || !connection.live.Load() ||
		connection.origin.TransportClass != TransportDesktopControl {
		return false
	}
	if _, ok := connection.DirectDesktopPeer(); ok {
		return true
	}
	return connection.origin.HasRole(RoleVerifiedDesktopProcess)
}

func (connection *Connection) Done() <-chan struct{} {
	if connection == nil {
		return nil
	}
	return connection.done
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
	if connection.clientLiveness != nil {
		_ = connection.clientLiveness.Close()
	}
	connection.revokeMu.Lock()
	hooks := make([]func(), 0, len(connection.revokeHooks)+len(connection.boundRevokeHooks))
	hooks = append(hooks, connection.revokeHooks...)
	for _, hook := range connection.boundRevokeHooks {
		hooks = append(hooks, hook)
	}
	connection.revokeHooks = nil
	connection.boundRevokeHooks = nil
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

// BindRevocationHook keeps one replaceable hook for an exact Runtime-owned
// binding. Local-development uses the supervisor run identifier so repeated
// host restarts do not accumulate callbacks, while reapproval can replace the
// callback with the newly admitted authorization. A hook bound after the
// verified Desktop connection is already revoked runs synchronously.
func (connection *Connection) BindRevocationHook(binding Identifier, hook func()) error {
	if connection == nil || binding == (Identifier{}) || hook == nil {
		return fmt.Errorf("complete protected connection revocation binding is required")
	}
	connection.revokeMu.Lock()
	if !connection.live.Load() {
		connection.revokeMu.Unlock()
		hook()
		return nil
	}
	if connection.boundRevokeHooks == nil {
		connection.boundRevokeHooks = make(map[Identifier]func())
	}
	connection.boundRevokeHooks[binding] = hook
	connection.revokeMu.Unlock()
	return nil
}

// UnbindRevocationHook removes a completed Runtime-owned binding without
// changing the liveness or authority of the protected Desktop connection.
func (connection *Connection) UnbindRevocationHook(binding Identifier) {
	if connection == nil || binding == (Identifier{}) {
		return
	}
	connection.revokeMu.Lock()
	delete(connection.boundRevokeHooks, binding)
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
	direct    bool

	mu       sync.Mutex
	sessions map[Identifier]*desktopSessionAuthority
}

func (manager *DesktopSessionManager) BootEpoch() Identifier {
	if manager == nil {
		return Identifier{}
	}
	return manager.bootEpoch
}

// OperationSessionID is the Runtime-issued handle seed shared by canonical
// App operations on this exact Desktop session manager. Installed topology
// uses the boot epoch; direct source-local-development uses its independently
// generated manager identity because it intentionally has no fixed boot epoch.
func (manager *DesktopSessionManager) OperationSessionID() Identifier {
	if manager == nil {
		return Identifier{}
	}
	if manager.bootEpoch != (Identifier{}) {
		return manager.bootEpoch
	}
	return manager.managerID
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

func NewDirectDesktopSessionManager(random io.Reader) (*DesktopSessionManager, error) {
	managerID, err := readIdentifier(random)
	if err != nil {
		return nil, fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "restart_runtime_service", fmt.Errorf("generate direct session manager identifier: %w", err))
	}
	return &DesktopSessionManager{
		random: random, managerID: managerID, direct: true,
		sessions: make(map[Identifier]*desktopSessionAuthority),
	}, nil
}

func (manager *DesktopSessionManager) Direct() bool {
	return manager != nil && manager.direct
}

// Validate confirms that the manager is ready for either direct native peers
// or the Windows session-scoped transport.
func (manager *DesktopSessionManager) Validate(ctx context.Context) error {
	if ctx == nil {
		return fail(ReasonProtectedLocalLedgerUnavailable, false, "restart_runtime_service", fmt.Errorf("validate desktop session manager: context is required"))
	}
	if manager == nil || manager.managerID == (Identifier{}) ||
		(!manager.direct && manager.bootEpoch == (Identifier{})) ||
		(manager.direct && manager.bootEpoch != (Identifier{})) {
		return fail(ReasonProtectedLocalLedgerUnavailable, false, "restart_runtime_service", fmt.Errorf("validate desktop session manager: transport authority is incomplete"))
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
	if _, direct := connection.DirectDesktopPeer(); direct {
		return DesktopSessionProjection{}, fail(ReasonProtectedOriginRoleMismatch, false, "use_desktop_control", fmt.Errorf("macOS direct Desktop transport does not open a boot-scoped session"))
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
	if connection == nil || !connection.live.Load() {
		return fail(ReasonDesktopProcessVerificationUnavailable, true, "reconnect_desktop", fmt.Errorf("authorize desktop session: live connection required"))
	}
	if _, direct := connection.DirectDesktopPeer(); direct {
		return nil
	}
	authority := connection.desktopSessionAuthority()
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

// LocalAppControlSessionRef returns one opaque boot-scoped reference only for
// the exact live Desktop connection/session that currently owns
// local_app_control. It is never reconstructed from metadata or request data.
func (manager *DesktopSessionManager) LocalAppControlSessionRef(ctx context.Context) (string, error) {
	if err := manager.AuthorizeContext(ctx, RoleLocalAppControl); err != nil {
		return "", err
	}
	connection, ok := DesktopConnectionFromContext(ctx)
	if !ok || connection == nil {
		return "", fail(ReasonProtectedOriginRoleMismatch, false, "reconnect_desktop", fmt.Errorf("local-app control connection is unavailable"))
	}
	authority := connection.desktopSessionAuthority()
	if authority == nil || authority.sessionID == (Identifier{}) {
		return "", fail(ReasonProtectedOriginRoleMismatch, false, "reconnect_desktop", fmt.Errorf("local-app control session is unavailable"))
	}
	return "desktop-control-v1_" + base64.RawURLEncoding.EncodeToString(authority.sessionID[:]), nil
}

// SoleLocalAppControlSessionRef resolves the one authoritative live Desktop
// control session for host-private challenge delivery. Zero or multiple live
// sessions fail closed; no arbitrary "first" session is selected.
func (manager *DesktopSessionManager) SoleLocalAppControlSessionRef() (string, error) {
	if manager == nil {
		return "", fail(ReasonProtectedLocalLedgerUnavailable, false, "restart_runtime_service", fmt.Errorf("desktop session manager is unavailable"))
	}
	manager.mu.Lock()
	defer manager.mu.Unlock()
	var selected *desktopSessionAuthority
	for _, authority := range manager.sessions {
		if authority == nil || authority.revoked.Load() || authority.connection == nil || !authority.connection.live.Load() || !authority.connection.origin.HasRole(RoleLocalAppControl) {
			continue
		}
		if selected != nil && selected != authority {
			return "", fail(ReasonProtectedOriginRoleMismatch, false, "close_extra_desktop_sessions", fmt.Errorf("multiple live local-app control sessions"))
		}
		selected = authority
	}
	if selected == nil || selected.sessionID == (Identifier{}) {
		return "", fail(ReasonProtectedOriginRoleMismatch, true, "open_desktop_session", fmt.Errorf("no live local-app control session"))
	}
	return "desktop-control-v1_" + base64.RawURLEncoding.EncodeToString(selected.sessionID[:]), nil
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
