// Package localappop contains the Runtime-private local-app operation
// coordinator. It is deliberately transport- and store-agnostic: callers may
// provide only an already verified native connection reference and an
// operation selector, while Runtime-owned resolvers provide every authority
// fact used by the decision.
package localappop

import (
	"context"
	"time"
)

// Operation is a closed local-app operation identity. Only the operations in
// operationSpecs are admitted by the 0K checkpoint.
type Operation string

const (
	OperationArtifactRead          Operation = "artifacts.read_runtime_bytes"
	OperationConversationOpen      Operation = "runtime_agent.conversation.open"
	OperationConversationTurnSend  Operation = "runtime_agent.conversation.turn_send"
	OperationConversationSubscribe Operation = "runtime_agent.conversation.turn_subscribe"
	OperationConversationSnapshot  Operation = "runtime_agent.conversation.snapshot"
)

// Selector carries only domain-owned resource selectors. It contains no
// principal, account, grant, process, provenance, endpoint, or credential.
type Selector struct {
	ArtifactID           string
	AgentID              string
	ConversationAnchorID string
	TurnID               string
}

// Request is the only input accepted by Coordinator. NativeConnectionRef is
// an opaque Runtime-private lookup key established by protected transport; it
// is not a portable session proof.
type Request struct {
	NativeConnectionRef string
	Operation           Operation
	Selector            Selector
}

type PrincipalKind string

const (
	PrincipalKindImmutable   PrincipalKind = "immutable"
	PrincipalKindDevelopment PrincipalKind = "development"
)

type PrincipalState string

const (
	PrincipalStateActive     PrincipalState = "active"
	PrincipalStateTombstoned PrincipalState = "tombstoned"
)

// LineageBinding is the exact opaque principal-lineage branch. The evaluator
// validates the closed union but never interprets package, signer, publisher,
// or trust strength from it.
type LineageBinding struct {
	ImmutableLineageID         string
	DevelopmentAuthorizationID string
	CanonicalProjectFileID     string
}

type Principal struct {
	LocalOSUserAnchor string
	ID                string
	Kind              PrincipalKind
	AppID             string // display/routing metadata only
	Lineage           LineageBinding
	State             PrincipalState
}

type TrustClass string

const (
	TrustClassVerified         TrustClass = "verified"
	TrustClassUserImported     TrustClass = "user_imported"
	TrustClassLocalDevelopment TrustClass = "local_development"
)

type RecordState string

const (
	RecordStateActive          RecordState = "active"
	RecordStateDormant         RecordState = "dormant"
	RecordStateRevoked         RecordState = "revoked"
	RecordStateSecurityRevoked RecordState = "security_revoked"
	RecordStateRemoved         RecordState = "removed"
)

// Record is the current K-APP lifecycle record projection. It intentionally
// contains no grant, account ownership, session proof, or policy result.
type Record struct {
	LocalOSUserAnchor          string
	ID                         string
	PrincipalID                string
	TrustClass                 TrustClass
	ProvenanceRevision         uint64
	InstallOrProjectGeneration uint64
	ExecutionProfileRef        string
	HostExecutableDigest       string
	PayloadRootDigest          string
	State                      RecordState
}

type ProcessBinding struct {
	NativeConnectionRef  string
	ProcessID            uint32
	ProcessStartRef      string
	ExecutableObjectRef  string
	HostExecutableDigest string
}

type SessionState string

const (
	SessionStateActive  SessionState = "active"
	SessionStateRevoked SessionState = "revoked"
)

// Session is an identity session. It is valid with zero grant and therefore
// contains no grant id, grant revision, or capability claim.
type Session struct {
	ID                         string
	State                      SessionState
	LocalOSUserAnchor          string
	PrincipalID                string
	RecordID                   string
	ProvenanceRevision         uint64
	InstallOrProjectGeneration uint64
	HostExecutableDigest       string
	PayloadRootDigest          string
	AccountID                  string
	AccountGeneration          uint64
	BootEpoch                  string
	Process                    ProcessBinding
}

type AccountState string

const (
	AccountStateAuthenticated AccountState = "authenticated"
	AccountStateUnavailable   AccountState = "unavailable"
)

type Account struct {
	ID         string
	Generation uint64
	State      AccountState
}

type GrantState string

const (
	GrantStatePending    GrantState = "pending"
	GrantStateGranted    GrantState = "granted"
	GrantStateDenied     GrantState = "denied"
	GrantStateExpired    GrantState = "expired"
	GrantStateRevoked    GrantState = "revoked"
	GrantStateSuperseded GrantState = "superseded"
)

// Grant is the exact current K-GRANT record. There is no app-id-only lookup
// key and no portable credential material.
type Grant struct {
	ID                            string
	State                         GrantState
	LocalOSUserAnchor             string
	AccountID                     string
	PrincipalID                   string
	CapabilityResourceFingerprint string
	Generation                    uint64
	Revision                      uint64
}

type OwnerPolicyStatus string

const (
	OwnerPolicyAllowed     OwnerPolicyStatus = "allowed"
	OwnerPolicyDenied      OwnerPolicyStatus = "denied"
	OwnerPolicyUnavailable OwnerPolicyStatus = "unavailable"
)

// OwnerPolicyDecision is supplied by the canonical operation owner. The
// coordinator does not infer Agent/conversation ownership or artifact
// audience from app identity, provenance, or grant state.
type OwnerPolicyDecision struct {
	Status                        OwnerPolicyStatus
	Operation                     Operation
	Selector                      Selector
	CapabilityResourceFingerprint string
	PolicyRevision                uint64
	ResourceImpactDigest          string
	PresenceRequired              bool
	Reason                        Reason
}

type PresenceState string

const (
	PresenceStateActive   PresenceState = "active"
	PresenceStateConsumed PresenceState = "consumed"
	PresenceStateCanceled PresenceState = "canceled"
)

// Presence is optional and is evaluated only when the owner policy requires
// operation presence. Ordinary exact-grant operations require no repeated
// presence.
type Presence struct {
	State                         PresenceState
	LocalOSUserAnchor             string
	AccountID                     string
	AccountGeneration             uint64
	PrincipalID                   string
	RecordID                      string
	ProvenanceRevision            uint64
	InstallOrProjectGeneration    uint64
	Operation                     Operation
	CapabilityResourceFingerprint string
	ResourceImpactDigest          string
	PolicyRevision                uint64
	ExpiresAt                     time.Time
}

// Snapshot is one immutable, Runtime-owned view of all current owner facts
// needed for one decision. Implementations must resolve it without caching an
// authorization result.
type Snapshot struct {
	ResolvedAt        time.Time
	LocalOSUserAnchor string
	BootEpoch         string
	CurrentProcess    ProcessBinding
	Principal         Principal
	Record            Record
	Session           Session
	Account           Account
	Grant             *Grant
	OwnerPolicy       OwnerPolicyDecision
	Presence          *Presence
}

// SnapshotResolver joins the independently owned principal, record, session,
// account, grant, presence, and operation-policy truths for the current native
// connection. The Request contains no caller-supplied authority fields.
type SnapshotResolver interface {
	ResolveLocalAppOperation(context.Context, Request) (Snapshot, error)
}

// SnapshotResolverFunc adapts a function for constructor-injected resolvers.
type SnapshotResolverFunc func(context.Context, Request) (Snapshot, error)

func (f SnapshotResolverFunc) ResolveLocalAppOperation(ctx context.Context, req Request) (Snapshot, error) {
	return f(ctx, req)
}

type Outcome string

const (
	OutcomeAllowed     Outcome = "allowed"
	OutcomeDenied      Outcome = "denied"
	OutcomeUnavailable Outcome = "unavailable"
)

// Reason uses the final Runtime reason-code vocabulary without importing
// generated public transport types into this private preparation package.
type Reason string

const (
	ReasonActionExecuted                   Reason = "ACTION_EXECUTED"
	ReasonProtocolEnvelopeInvalid          Reason = "PROTOCOL_ENVELOPE_INVALID"
	ReasonLocalAppPrincipalRequired        Reason = "LOCAL_APP_PRINCIPAL_REQUIRED"
	ReasonLocalAppRecordNotFound           Reason = "LOCAL_APP_RECORD_NOT_FOUND"
	ReasonLocalAppRecordTombstoned         Reason = "LOCAL_APP_RECORD_TOMBSTONED"
	ReasonLocalAppProvenanceUnavailable    Reason = "LOCAL_APP_PROVENANCE_UNAVAILABLE"
	ReasonLocalAppProcessMismatch          Reason = "LOCAL_APP_PROCESS_MISMATCH"
	ReasonLocalAppSessionRevoked           Reason = "LOCAL_APP_SESSION_REVOKED"
	ReasonLocalAppGrantRequired            Reason = "LOCAL_APP_GRANT_REQUIRED"
	ReasonLocalAppGrantRevoked             Reason = "LOCAL_APP_GRANT_REVOKED"
	ReasonLocalAppGrantSuperseded          Reason = "LOCAL_APP_GRANT_SUPERSEDED"
	ReasonLocalAppAccountChanged           Reason = "LOCAL_APP_ACCOUNT_CHANGED"
	ReasonLocalAppOperationUnavailable     Reason = "LOCAL_APP_OPERATION_UNAVAILABLE"
	ReasonLocalAppPresenceRequired         Reason = "LOCAL_APP_PRESENCE_REQUIRED"
	ReasonLocalAppPresenceExpired          Reason = "LOCAL_APP_PRESENCE_EXPIRED"
	ReasonLocalAppRememberedProjectDormant Reason = "LOCAL_APP_REMEMBERED_PROJECT_DORMANT"
)

// AuthorizationContext is emitted only on a fully allowed private decision.
// It is sufficient for owner execution and audit correlation but contains no
// token, bearer, session proof, provider selection, or model selection.
type AuthorizationContext struct {
	LocalOSUserAnchor             string
	PrincipalID                   string
	PrincipalKind                 PrincipalKind
	Lineage                       LineageBinding
	RecordID                      string
	ProvenanceRevision            uint64
	InstallOrProjectGeneration    uint64
	SessionID                     string
	AccountID                     string
	AccountGeneration             uint64
	Process                       ProcessBinding
	BootEpoch                     string
	GrantID                       string
	GrantRevision                 uint64
	PolicyRevision                uint64
	CapabilityResourceFingerprint string
	Operation                     Operation
	Selector                      Selector
}

type Decision struct {
	Outcome       Outcome
	Reason        Reason
	Authorization *AuthorizationContext
}
