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
	ErrInvalidArgument     = errors.New("local-app kernel invalid argument")
	ErrNotFound            = errors.New("local-app kernel record not found")
	ErrPartitionMismatch   = errors.New("local-app kernel OS-user partition mismatch")
	ErrStateConflict       = errors.New("local-app kernel state conflict")
	ErrPrincipalTombstoned = errors.New("local-app principal tombstoned")
	ErrRevisionConflict    = errors.New("local-app provenance revision conflict")
	ErrRandomExhausted     = errors.New("local-app identifier allocation exhausted")
	ErrGrantTransition     = errors.New("local-app grant transition denied")
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

type GrantState string

const (
	GrantStatePending    GrantState = "pending"
	GrantStateGranted    GrantState = "granted"
	GrantStateDenied     GrantState = "denied"
	GrantStateExpired    GrantState = "expired"
	GrantStateRevoked    GrantState = "revoked"
	GrantStateSuperseded GrantState = "superseded"
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

type Grant struct {
	LocalOSUserAnchor             string
	AccountID                     string
	LocalAppPrincipalID           string
	CapabilityResourceFingerprint string
	GrantID                       string
	CapabilityScope               []string
	ResourceScope                 []string
	GrantGeneration               uint64
	GrantRevision                 uint64
	State                         GrantState
	IssuedAt                      time.Time
	ExpiresAt                     *time.Time
	SupersedesGrantID             string
	PresenceEvidenceRef           string
}

type CreatePendingGrantInput struct {
	AccountID                     string
	LocalAppPrincipalID           string
	CapabilityScope               []string
	ResourceScope                 []string
	CapabilityResourceFingerprint string
	GrantGeneration               uint64
	GrantRevision                 uint64
	ExpiresAt                     *time.Time
	SupersedesGrantID             string
	PresenceEvidenceRef           string
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
	GrantStateChanged       bool
	RecordedAt              time.Time
}

type SecurityKeys struct {
	StoragePartitionKey string
	AudienceKey         string
	AuditSubjectKey     string
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

func validateGrantInput(input CreatePendingGrantInput) error {
	for name, value := range map[string]string{
		"account_id":                      input.AccountID,
		"local_app_principal_id":          input.LocalAppPrincipalID,
		"capability_resource_fingerprint": input.CapabilityResourceFingerprint,
		"presence_evidence_ref":           input.PresenceEvidenceRef,
	} {
		if err := requireExactText(name, value); err != nil {
			return err
		}
	}
	if input.GrantGeneration == 0 || input.GrantRevision == 0 {
		return fmt.Errorf("%w: grant generation and revision must be positive", ErrInvalidArgument)
	}
	if err := validateExactTextList("capability_scope", input.CapabilityScope); err != nil {
		return err
	}
	if err := validateExactTextList("resource_scope", input.ResourceScope); err != nil {
		return err
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

func validGrantTransition(from GrantState, to GrantState) bool {
	switch from {
	case GrantStatePending:
		return to == GrantStateGranted || to == GrantStateDenied || to == GrantStateExpired
	case GrantStateGranted:
		return to == GrantStateRevoked || to == GrantStateExpired || to == GrantStateSuperseded
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
