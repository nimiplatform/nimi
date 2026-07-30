// Package localappkernel contains the production-unwired persistence primitives
// for the shared local-app security kernel. Nothing outside this internal
// package registers an RPC, service, or production constructor for these stores.
package localappkernel

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

var (
	ErrInvalidArgument            = errors.New("local-app kernel invalid argument")
	ErrNotFound                   = errors.New("local-app kernel record not found")
	ErrPartitionMismatch          = errors.New("local-app kernel OS-user partition mismatch")
	ErrStateConflict              = errors.New("local-app kernel state conflict")
	ErrPrincipalTombstoned        = errors.New("local-app principal tombstoned")
	ErrRevisionConflict           = errors.New("local-app provenance revision conflict")
	ErrPermissionRevisionConflict = errors.New("local-app permission revision conflict")
	ErrRandomExhausted            = errors.New("local-app identifier allocation exhausted")
)

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

type TrustClass string

const (
	TrustClassVerified         TrustClass = "verified"
	TrustClassUserImported     TrustClass = "user_imported"
	TrustClassLocalDevelopment TrustClass = "local_development"
)

type LifecycleState string

const (
	LifecycleStateActive          LifecycleState = "active"
	LifecycleStateDormant         LifecycleState = "dormant"
	LifecycleStateRevoked         LifecycleState = "revoked"
	LifecycleStateSecurityRevoked LifecycleState = "security_revoked"
	LifecycleStateRemoved         LifecycleState = "removed"
)

type Principal struct {
	LocalOSUserAnchor          string
	LocalAppPrincipalID        string
	Kind                       PrincipalKind
	AppID                      string
	ImmutableLineageID         string
	DevelopmentAuthorizationID string
	CanonicalProjectFileID     string
	State                      PrincipalState
	CreatedAt                  time.Time
	TombstonedAt               *time.Time
}

type CreatePrincipalInput struct {
	Kind                       PrincipalKind
	AppID                      string
	ImmutableLineageID         string
	DevelopmentAuthorizationID string
	CanonicalProjectFileID     string
}

type Record struct {
	LocalOSUserAnchor                 string
	LocalAppRecordID                  string
	LocalAppPrincipalID               string
	TrustClass                        TrustClass
	ProvenanceAttestationRefs         []string
	ProvenanceRevision                uint64
	ActiveReleaseOrProjectIdentityRef string
	InstallOrProjectGeneration        uint64
	ActiveCapabilityFingerprint       string
	ExecutionProfileRef               string
	HostExecutableDigest              string
	PayloadRootDigest                 string
	LifecycleState                    LifecycleState
}

type CreateRecordInput struct {
	LocalAppPrincipalID               string
	TrustClass                        TrustClass
	ProvenanceAttestationRefs         []string
	ProvenanceRevision                uint64
	ActiveReleaseOrProjectIdentityRef string
	InstallOrProjectGeneration        uint64
	ActiveCapabilityFingerprint       string
	ExecutionProfileRef               string
	HostExecutableDigest              string
	PayloadRootDigest                 string
	LifecycleState                    LifecycleState
}

// UpdateDevelopmentRecordInput advances only the mutable-project generation
// and opaque execution observations of an already-admitted development record.
// It cannot change principal lineage, app identity, trust class, provenance
// revision, attestation refs, capability fingerprint, or execution profile.
type UpdateDevelopmentRecordInput struct {
	LocalAppPrincipalID       string
	LocalAppRecordID          string
	ExpectedProjectGeneration uint64
	HostExecutableDigest      string
	PayloadRootDigest         string
	LifecycleState            LifecycleState
}

type ProvenanceInvalidationFact struct {
	Sequence                uint64
	LocalOSUserAnchor       string
	LocalAppPrincipalID     string
	LocalAppRecordID        string
	PreviousRevision        uint64
	CurrentRevision         uint64
	LaunchLeasesInvalidated bool
	SessionsInvalidated     bool
	RecordedAt              time.Time
}

const (
	MaxPermissionRequestReasonBytes = 240
	MaxPermissionRequestIDBytes     = 240
)

type PermissionGrantState string

const (
	PermissionGrantStateGranted PermissionGrantState = "granted"
	PermissionGrantStateDenied  PermissionGrantState = "denied"
	PermissionGrantStateRevoked PermissionGrantState = "revoked"
)

// PermissionGrantKey is the complete owner-held identity required by R046.
// Display app ids, sessions, operations, and portable proofs are deliberately
// excluded from the durable key.
type PermissionGrantKey struct {
	LocalOSUserAnchor   string
	AccountID           string
	LocalAppPrincipalID string
	PermissionID        string
	OwnerSelectorDigest string
}

type PermissionGrant struct {
	Key       PermissionGrantKey
	RequestID string
	State     PermissionGrantState
	Revision  uint64
	ExpiresAt *time.Time
	CreatedAt time.Time
	UpdatedAt time.Time
}

// PermissionRequest is the selector-free durable app request that precedes an
// owner decision. Selector authority does not exist until owner approval.
type PermissionRequest struct {
	LocalOSUserAnchor   string
	AccountID           string
	LocalAppPrincipalID string
	PermissionID        string
	RequestID           string
	DisplayAppID        string
	Reason              string
	Revision            uint64
	RequestedAt         time.Time
	CreatedAt           time.Time
}

type CreatePermissionRequestInput struct {
	LocalOSUserAnchor   string
	AccountID           string
	LocalAppPrincipalID string
	PermissionID        string
	RequestID           string
	DisplayAppID        string
	Reason              string
}

type RefreshPermissionRequestInput struct {
	LocalOSUserAnchor   string
	AccountID           string
	LocalAppPrincipalID string
	PermissionID        string
	RequestID           string
	DisplayAppID        string
	Reason              string
	ExpectedRevision    uint64
}

type PermissionAuthorizationAction string

const (
	PermissionAuthorizationActionAccept PermissionAuthorizationAction = "accept"
	PermissionAuthorizationActionReject PermissionAuthorizationAction = "reject"
	PermissionAuthorizationActionRevoke PermissionAuthorizationAction = "revoke"
)

type PermissionRequestDecision struct {
	LocalOSUserAnchor   string
	AccountID           string
	LocalAppPrincipalID string
	PermissionID        string
	RequestID           string
	Action              PermissionAuthorizationAction
	State               PermissionGrantState
	OwnerSelectorDigest string
	Revision            uint64
	DecidedAt           time.Time
}

type DecidePermissionRequestInput struct {
	LocalOSUserAnchor   string
	AccountID           string
	LocalAppPrincipalID string
	PermissionID        string
	ExpectedRevision    uint64
	State               PermissionGrantState
	OwnerSelectorDigest string
}

type RevokePermissionGrantInput struct {
	Key              PermissionGrantKey
	ExpectedRevision uint64
}

type AgentHandle struct {
	Handle              string
	LocalOSUserAnchor   string
	AccountID           string
	LocalAppPrincipalID string
	PermissionID        string
	OwnerSelectorDigest string
	LocalAgentID        string
	IssuedAt            time.Time
}

type EnsureAccountScopeAgentHandleInput struct {
	AccountID           string
	LocalAppPrincipalID string
	PermissionID        string
	OwnerSelectorDigest string
	LocalAgentID        string
}

type ResolveAgentHandleInput struct {
	Handle              string
	AccountID           string
	LocalAppPrincipalID string
	PermissionID        string
}

type SecurityKeys struct {
	StoragePartitionKey string
	AudienceKey         string
	AuditSubjectKey     string
}

func validatePermissionGrantKey(key PermissionGrantKey) error {
	for name, value := range map[string]string{
		"local_os_user_anchor":   key.LocalOSUserAnchor,
		"account_id":             key.AccountID,
		"local_app_principal_id": key.LocalAppPrincipalID,
		"permission_id":          key.PermissionID,
		"owner_selector_digest":  key.OwnerSelectorDigest,
	} {
		if err := requireExactText(name, value); err != nil {
			return err
		}
	}
	return nil
}

func validatePrincipalInput(input CreatePrincipalInput) error {
	if err := requireExactText("app_id", input.AppID); err != nil {
		return err
	}
	switch input.Kind {
	case PrincipalKindImmutable:
		if err := requireExactText("immutable_lineage_id", input.ImmutableLineageID); err != nil {
			return err
		}
		if input.DevelopmentAuthorizationID != "" || input.CanonicalProjectFileID != "" {
			return fmt.Errorf("%w: immutable principal contains development lineage", ErrInvalidArgument)
		}
	case PrincipalKindDevelopment:
		if err := requireExactText("development_authorization_id", input.DevelopmentAuthorizationID); err != nil {
			return err
		}
		if err := requireExactText("canonical_project_file_id", input.CanonicalProjectFileID); err != nil {
			return err
		}
		if input.ImmutableLineageID != "" {
			return fmt.Errorf("%w: development principal contains immutable lineage", ErrInvalidArgument)
		}
	default:
		return fmt.Errorf("%w: principal_kind", ErrInvalidArgument)
	}
	return nil
}

func validateRecordInput(input CreateRecordInput) error {
	for name, value := range map[string]string{
		"local_app_principal_id":                 input.LocalAppPrincipalID,
		"active_release_or_project_identity_ref": input.ActiveReleaseOrProjectIdentityRef,
		"active_capability_fingerprint":          input.ActiveCapabilityFingerprint,
		"execution_profile_ref":                  input.ExecutionProfileRef,
		"host_executable_digest":                 input.HostExecutableDigest,
		"payload_root_digest":                    input.PayloadRootDigest,
	} {
		if err := requireExactText(name, value); err != nil {
			return err
		}
	}
	if input.ProvenanceRevision == 0 || input.InstallOrProjectGeneration == 0 {
		return fmt.Errorf("%w: revisions and generations must be positive", ErrInvalidArgument)
	}
	if err := validateExactTextList("provenance_attestation_refs", input.ProvenanceAttestationRefs); err != nil {
		return err
	}
	switch input.TrustClass {
	case TrustClassVerified, TrustClassUserImported, TrustClassLocalDevelopment:
	default:
		return fmt.Errorf("%w: trust_class", ErrInvalidArgument)
	}
	if !validLifecycleState(input.LifecycleState) {
		return fmt.Errorf("%w: lifecycle_state", ErrInvalidArgument)
	}
	return nil
}

func validLifecycleState(state LifecycleState) bool {
	switch state {
	case LifecycleStateActive, LifecycleStateDormant, LifecycleStateRevoked, LifecycleStateSecurityRevoked, LifecycleStateRemoved:
		return true
	default:
		return false
	}
}

func requireExactText(name string, value string) error {
	if value == "" || value != strings.TrimSpace(value) {
		return fmt.Errorf("%w: %s", ErrInvalidArgument, name)
	}
	return nil
}

func validateExactTextList(name string, values []string) error {
	if len(values) == 0 {
		return fmt.Errorf("%w: %s", ErrInvalidArgument, name)
	}
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		if err := requireExactText(name, value); err != nil {
			return err
		}
		if _, exists := seen[value]; exists {
			return fmt.Errorf("%w: duplicate %s", ErrInvalidArgument, name)
		}
		seen[value] = struct{}{}
	}
	return nil
}
