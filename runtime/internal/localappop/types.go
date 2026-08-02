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
	OperationConversationInterrupt Operation = "runtime_agent.conversation.turn_interrupt"
	OperationConversationSubscribe Operation = "runtime_agent.conversation.turn_subscribe"
	OperationConversationSnapshot  Operation = "runtime_agent.conversation.snapshot"
	OperationConfigurationSnapshot Operation = "runtime_agent.configuration.snapshot"
	OperationUpdateConfiguration   Operation = "runtime_agent.configuration.update"
	OperationReadinessSnapshot     Operation = "runtime_agent.readiness.snapshot"
	OperationAIProfilePreview      Operation = "runtime_agent.ai_profile.preview"
	OperationAIProfileApply        Operation = "runtime_agent.ai_profile.apply"
	OperationAutonomySnapshot      Operation = "runtime_agent.autonomy.snapshot"
	OperationUpdateAutonomy        Operation = "runtime_agent.autonomy.update"
	OperationPresentationSnapshot  Operation = "runtime_agent.presentation.snapshot"
	OperationCommitPresentation    Operation = "runtime_agent.presentation.commit"
	OperationStorageJSONRead       Operation = "app_storage.json.read"
	OperationStorageJSONWrite      Operation = "app_storage.json.write"
	OperationStorageJSONRemove     Operation = "app_storage.json.remove"
	OperationRealmWorldCoreList    Operation = "realm.world_core.list"
	OperationRealmWorldCoreCreate  Operation = "realm.world_core.create"
	OperationTextCandidateGenerate Operation = "runtime.ai.text_candidate.generate"
	OperationVoiceTranscribe       Operation = "runtime_agent.voice.transcribe"
	OperationVoiceStreamSubscribe  Operation = "runtime_agent.voice.stream_subscribe"
)

// AuthorityClass records which mutually exclusive authority path owns an
// operation decision. It is derived from the closed operation catalog and is
// never accepted from an app request.
type AuthorityClass string

const (
	AuthorityClassBaseEntitlement AuthorityClass = "base_entitlement"
	AuthorityClassUserPermission  AuthorityClass = "user_permission"
)

// Selector carries only domain-owned resource selectors. It contains no
// principal, account, permission, process, provenance, endpoint, or credential.
type Selector struct {
	ArtifactID           string
	AgentID              string
	ConversationAnchorID string
	TurnID               string
	VoiceStreamID        string
	StorageRelativePath  string
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
// contains no permission decision, account ownership, session proof, or policy result.
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

// Session is an identity session. It is valid with zero user permissions and
// therefore contains no permission decision or capability claim.
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

type OwnerPolicyStatus string

const (
	OwnerPolicyAllowed     OwnerPolicyStatus = "allowed"
	OwnerPolicyDenied      OwnerPolicyStatus = "denied"
	OwnerPolicyUnavailable OwnerPolicyStatus = "unavailable"
)

// OwnerPolicyDecision is supplied by the canonical operation owner. The
// coordinator does not infer Agent/conversation ownership or artifact
// audience from app identity or provenance.
type OwnerPolicyDecision struct {
	Status               OwnerPolicyStatus
	Operation            Operation
	Selector             Selector
	OwnerSelectorDigest  string
	PolicyRevision       uint64
	ResourceImpactDigest string
	Reason               Reason
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
	OwnerPolicy       OwnerPolicyDecision
}

// SnapshotResolver joins the independently owned principal, record, session,
// account and operation-policy truths for the current native
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
	ReasonActionExecuted                Reason = "ACTION_EXECUTED"
	ReasonProtocolEnvelopeInvalid       Reason = "PROTOCOL_ENVELOPE_INVALID"
	ReasonLocalAppPrincipalRequired     Reason = "LOCAL_APP_PRINCIPAL_REQUIRED"
	ReasonLocalAppRecordNotFound        Reason = "LOCAL_APP_RECORD_NOT_FOUND"
	ReasonLocalAppRecordTombstoned      Reason = "LOCAL_APP_RECORD_TOMBSTONED"
	ReasonLocalAppProvenanceUnavailable Reason = "LOCAL_APP_PROVENANCE_UNAVAILABLE"
	ReasonLocalAppProcessMismatch       Reason = "LOCAL_APP_PROCESS_MISMATCH"
	ReasonLocalAppSessionRevoked        Reason = "LOCAL_APP_SESSION_REVOKED"
	ReasonLocalAppPermissionRequired    Reason = "LOCAL_APP_PERMISSION_REQUIRED"
	ReasonLocalAppPermissionDenied      Reason = "LOCAL_APP_PERMISSION_DENIED"
	ReasonLocalAppPermissionRevoked     Reason = "LOCAL_APP_PERMISSION_REVOKED"
	ReasonLocalAppAccountChanged        Reason = "LOCAL_APP_ACCOUNT_CHANGED"
	ReasonLocalAppOperationUnavailable  Reason = "LOCAL_APP_OPERATION_UNAVAILABLE"
	ReasonLocalAppPresenceRequired      Reason = "LOCAL_APP_PRESENCE_REQUIRED"
	ReasonLocalAppPresenceExpired       Reason = "LOCAL_APP_PRESENCE_EXPIRED"
)

// AuthorizationContext is emitted only on a fully allowed private decision.
// It is sufficient for owner execution and audit correlation but contains no
// token, bearer, session proof, provider selection, or model selection.
type AuthorizationContext struct {
	AuthorityClass             AuthorityClass
	LocalOSUserAnchor          string
	PrincipalID                string
	PrincipalKind              PrincipalKind
	Lineage                    LineageBinding
	RecordID                   string
	ProvenanceRevision         uint64
	InstallOrProjectGeneration uint64
	SessionID                  string
	AccountID                  string
	AccountGeneration          uint64
	Process                    ProcessBinding
	BootEpoch                  string
	PolicyRevision             uint64
	OwnerSelectorDigest        string
	Operation                  Operation
	Selector                   Selector
}

type Decision struct {
	Outcome       Outcome
	Reason        Reason
	Authorization *AuthorizationContext
}
