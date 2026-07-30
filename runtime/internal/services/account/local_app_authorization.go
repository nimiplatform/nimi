package account

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appstorage"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
)

var (
	ErrLocalAppCallerUnauthorized   = errors.New("local-app caller is not currently authorized")
	ErrLocalAppAccountChanged       = fmt.Errorf("%w: account generation changed", ErrLocalAppCallerUnauthorized)
	ErrLocalAppProcessMismatch      = fmt.Errorf("%w: process binding changed", ErrLocalAppCallerUnauthorized)
	ErrLocalAppOperationNotAdmitted = errors.New("local-app operation authority is not admitted")
)

type LocalAppOperation string

const (
	LocalAppOperationReadArtifactBytes     LocalAppOperation = "artifacts.read_runtime_bytes"
	LocalAppOperationOpenConversation      LocalAppOperation = "runtime_agent.conversation.open"
	LocalAppOperationSendConversationTurn  LocalAppOperation = "runtime_agent.conversation.turn_send"
	LocalAppOperationInterruptConversation LocalAppOperation = "runtime_agent.conversation.turn_interrupt"
	LocalAppOperationSubscribeConversation LocalAppOperation = "runtime_agent.conversation.turn_subscribe"
	LocalAppOperationConversationSnapshot  LocalAppOperation = "runtime_agent.conversation.snapshot"
	LocalAppOperationConfigurationSnapshot LocalAppOperation = "runtime_agent.configuration.snapshot"
	LocalAppOperationUpdateConfiguration   LocalAppOperation = "runtime_agent.configuration.update"
	LocalAppOperationReadinessSnapshot     LocalAppOperation = "runtime_agent.readiness.snapshot"
	LocalAppOperationAutonomySnapshot      LocalAppOperation = "runtime_agent.autonomy.snapshot"
	LocalAppOperationUpdateAutonomy        LocalAppOperation = "runtime_agent.autonomy.update"
	LocalAppOperationPresentationSnapshot  LocalAppOperation = "runtime_agent.presentation.snapshot"
	LocalAppOperationCommitPresentation    LocalAppOperation = "runtime_agent.presentation.commit"
	LocalAppOperationStorageJSONRead       LocalAppOperation = "app_storage.json.read"
	LocalAppOperationStorageJSONWrite      LocalAppOperation = "app_storage.json.write"
	LocalAppOperationStorageJSONRemove     LocalAppOperation = "app_storage.json.remove"
	LocalAppOperationRealmWorldCoreList    LocalAppOperation = "realm.world_core.list"
	LocalAppOperationRealmWorldCoreCreate  LocalAppOperation = "realm.world_core.create"
	LocalAppOperationVoiceTranscribe       LocalAppOperation = "runtime_agent.voice.transcribe"
	LocalAppOperationVoiceStreamSubscribe  LocalAppOperation = "runtime_agent.voice.stream_subscribe"
)

type LocalAppTrustClass string

const LocalAppTrustClassDevelopment LocalAppTrustClass = "local_development"

// LocalAppCallerBinding is the session/process projection consumed by
// RuntimeAccountService. It carries no caller-selected capability or grant
// decision.
type LocalAppCallerBinding struct {
	LocalOSUserAnchor       string
	SessionID               protectedlocal.Identifier
	AppID                   string
	HostExecutableDigest    protectedlocal.Identifier
	AccountGeneration       uint64
	RuntimeBootEpoch        protectedlocal.Identifier
	Process                 protectedlocal.ProcessTuple
	DirectPeer              protectedlocal.DirectLocalAppPeer
	ExpiresAt               time.Time
	TrustClass              LocalAppTrustClass
	AuthorizationID         protectedlocal.Identifier
	AuthorizationGeneration uint64
	ProjectRoot             string
	CapabilityFingerprint   protectedlocal.Identifier
	Capabilities            []string
	LocalAppPrincipalID     string
	LocalAppRecordID        string
	ProvenanceRevision      uint64
	ProjectGeneration       uint64
	PayloadDigest           string
}

type LocalAppSessionResolver interface {
	ResolveLocalAppSession(context.Context, uint64) (LocalAppCallerBinding, error)
}

type AccountAuthorityRevoker interface {
	RevokeAccountAuthority(context.Context, string) error
}

type LocalAgentOwnerProjection struct {
	LocalAgentID string
	DisplayName  string
}

type LocalAgentOwnershipResolver interface {
	OwnsActiveLocalAgent(context.Context, string, string) (bool, error)
	ListOwnedActiveLocalAgents(context.Context, string) ([]LocalAgentOwnerProjection, error)
}

// LocalAppCallerDecision is an immutable per-call origin/account decision.
// The operation coordinator extends this Account-owned boundary with exactly
// one Runtime-derived authority class; consumers must not add independent
// session caches.
type LocalAppCallerDecision struct {
	LocalOSUserAnchor       string
	SessionID               protectedlocal.Identifier
	AppID                   string
	HostExecutableDigest    protectedlocal.Identifier
	AccountID               string
	RealmEnvironmentID      string
	AccountGeneration       uint64
	RuntimeBootEpoch        protectedlocal.Identifier
	Process                 protectedlocal.ProcessTuple
	DirectPeer              protectedlocal.DirectLocalAppPeer
	ExpiresAt               time.Time
	Operation               LocalAppOperation
	AuthorityClass          localappop.AuthorityClass
	OperationCapability     string
	LocalAgentID            string
	TrustClass              LocalAppTrustClass
	AuthorizationID         protectedlocal.Identifier
	AuthorizationGeneration uint64
	ProjectRoot             string
	CapabilityFingerprint   protectedlocal.Identifier
	LocalAppPrincipalID     string
	LocalAppRecordID        string
	ProvenanceRevision      uint64
	ProjectGeneration       uint64
	PayloadDigest           string
}

func (s *Service) SetLocalAppSessionResolver(resolver LocalAppSessionResolver) {
	if s != nil {
		s.localAppSessions = resolver
	}
}

func (s *Service) SetAccountAuthorityRevoker(revoker AccountAuthorityRevoker) {
	if s != nil {
		s.accountAuthorityRevoker = revoker
	}
}

func (s *Service) SetLocalAgentOwnershipResolver(resolver LocalAgentOwnershipResolver) {
	if s != nil {
		s.localAgentOwnership = resolver
	}
}

// AuthorizeLocalAppCaller revalidates the current account identity and exact
// Runtime-private session/process binding. Portable metadata and app IDs are
// deliberately absent from the evaluator input.
func (s *Service) AuthorizeLocalAppCaller(ctx context.Context) (LocalAppCallerDecision, error) {
	if s == nil || s.localAppSessions == nil {
		return LocalAppCallerDecision{}, ErrLocalAppCallerUnauthorized
	}
	projection, generation, authenticated := s.AuthenticatedRuntimeSecurityContext(ctx)
	if !authenticated || generation == 0 || projection == nil {
		return LocalAppCallerDecision{}, ErrLocalAppAccountChanged
	}
	accountID := strings.TrimSpace(projection.GetAccountId())
	realmEnvironmentID := strings.TrimSpace(projection.GetRealmEnvironmentId())
	if accountID == "" || realmEnvironmentID == "" {
		return LocalAppCallerDecision{}, ErrLocalAppCallerUnauthorized
	}
	binding, err := s.localAppSessions.ResolveLocalAppSession(ctx, generation)
	if err != nil {
		if errors.Is(err, ErrLocalAppAccountChanged) || errors.Is(err, ErrLocalAppProcessMismatch) {
			return LocalAppCallerDecision{}, err
		}
		return LocalAppCallerDecision{}, ErrLocalAppCallerUnauthorized
	}
	if binding.AccountGeneration != generation {
		return LocalAppCallerDecision{}, ErrLocalAppAccountChanged
	}
	directPeer := binding.DirectPeer.OS == protectedlocal.OSMacOS && binding.DirectPeer.PID != 0 && binding.DirectPeer.UID != 0 &&
		binding.SessionID != (protectedlocal.Identifier{}) &&
		binding.RuntimeBootEpoch == (protectedlocal.Identifier{}) &&
		binding.Process == (protectedlocal.ProcessTuple{}) &&
		binding.ExpiresAt.IsZero()
	sessionScoped := binding.DirectPeer == (protectedlocal.DirectLocalAppPeer{}) &&
		binding.SessionID != (protectedlocal.Identifier{}) &&
		binding.RuntimeBootEpoch != (protectedlocal.Identifier{}) &&
		binding.Process.PID != 0 &&
		s.now().UTC().Before(binding.ExpiresAt.UTC())
	if strings.TrimSpace(binding.LocalOSUserAnchor) == "" || binding.LocalOSUserAnchor != strings.TrimSpace(binding.LocalOSUserAnchor) ||
		(!directPeer && !sessionScoped) || strings.TrimSpace(binding.AppID) == "" ||
		binding.HostExecutableDigest == (protectedlocal.Identifier{}) ||
		binding.TrustClass != LocalAppTrustClassDevelopment || binding.AuthorizationID == (protectedlocal.Identifier{}) ||
		binding.AuthorizationGeneration == 0 || strings.TrimSpace(binding.ProjectRoot) == "" ||
		binding.CapabilityFingerprint == (protectedlocal.Identifier{}) {
		return LocalAppCallerDecision{}, ErrLocalAppCallerUnauthorized
	}
	if strings.TrimSpace(binding.LocalAppPrincipalID) == "" || binding.LocalAppPrincipalID != strings.TrimSpace(binding.LocalAppPrincipalID) ||
		strings.TrimSpace(binding.LocalAppRecordID) == "" || binding.LocalAppRecordID != strings.TrimSpace(binding.LocalAppRecordID) ||
		binding.ProvenanceRevision == 0 || binding.ProjectGeneration == 0 ||
		strings.TrimSpace(binding.PayloadDigest) == "" || binding.PayloadDigest != strings.TrimSpace(binding.PayloadDigest) {
		return LocalAppCallerDecision{}, ErrLocalAppCallerUnauthorized
	}
	return LocalAppCallerDecision{
		LocalOSUserAnchor:       binding.LocalOSUserAnchor,
		SessionID:               binding.SessionID,
		AppID:                   strings.TrimSpace(binding.AppID),
		HostExecutableDigest:    binding.HostExecutableDigest,
		AccountID:               accountID,
		RealmEnvironmentID:      realmEnvironmentID,
		AccountGeneration:       generation,
		RuntimeBootEpoch:        binding.RuntimeBootEpoch,
		Process:                 binding.Process,
		DirectPeer:              binding.DirectPeer,
		ExpiresAt:               binding.ExpiresAt.UTC(),
		TrustClass:              binding.TrustClass,
		AuthorizationID:         binding.AuthorizationID,
		AuthorizationGeneration: binding.AuthorizationGeneration,
		ProjectRoot:             binding.ProjectRoot,
		CapabilityFingerprint:   binding.CapabilityFingerprint,
		LocalAppPrincipalID:     binding.LocalAppPrincipalID,
		LocalAppRecordID:        binding.LocalAppRecordID,
		ProvenanceRevision:      binding.ProvenanceRevision,
		ProjectGeneration:       binding.ProjectGeneration,
		PayloadDigest:           binding.PayloadDigest,
	}, nil
}

// LocalAppCallerAuthorizationReason maps the process-bound session
// revalidation boundary to the same closed Runtime reason vocabulary used by
// protected operations. Private resolver errors never cross the transport.
func LocalAppCallerAuthorizationReason(err error) runtimev1.ReasonCode {
	switch {
	case err == nil:
		return runtimev1.ReasonCode_ACTION_EXECUTED
	case errors.Is(err, ErrLocalAppAccountChanged):
		return runtimev1.ReasonCode_LOCAL_APP_ACCOUNT_CHANGED
	case errors.Is(err, ErrLocalAppProcessMismatch):
		return runtimev1.ReasonCode_LOCAL_APP_PROCESS_MISMATCH
	default:
		return runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED
	}
}

// AuthorizeLocalAppOperation keeps the closed operation map and exact session
// revalidation in one Account-owned entrypoint. Base entitlements do not
// require a manifest capability; user-permission operations still require the
// current internal capability posture before the grant coordinator runs.
func (s *Service) AuthorizeLocalAppOperation(ctx context.Context, operation LocalAppOperation) (LocalAppCallerDecision, error) {
	required, ok := localAppOperationCapability(operation)
	if !ok {
		if strings.TrimSpace(string(operation)) == "" {
			return LocalAppCallerDecision{}, ErrLocalAppCallerUnauthorized
		}
		return LocalAppCallerDecision{}, ErrLocalAppOperationNotAdmitted
	}
	decision, err := s.AuthorizeLocalAppCaller(ctx)
	if err != nil {
		return LocalAppCallerDecision{}, err
	}
	binding, resolveErr := s.localAppSessions.ResolveLocalAppSession(ctx, decision.AccountGeneration)
	if resolveErr != nil {
		if errors.Is(resolveErr, ErrLocalAppAccountChanged) || errors.Is(resolveErr, ErrLocalAppProcessMismatch) {
			return LocalAppCallerDecision{}, resolveErr
		}
		return LocalAppCallerDecision{}, ErrLocalAppCallerUnauthorized
	}
	if binding.TrustClass != LocalAppTrustClassDevelopment ||
		binding.AuthorizationID != decision.AuthorizationID || binding.AuthorizationGeneration != decision.AuthorizationGeneration ||
		binding.CapabilityFingerprint != decision.CapabilityFingerprint ||
		binding.DirectPeer != decision.DirectPeer {
		return LocalAppCallerDecision{}, ErrLocalAppCallerUnauthorized
	}
	authorityClass, admitted := localappop.AuthorityClassForOperation(localappop.Operation(operation))
	if !admitted {
		return LocalAppCallerDecision{}, ErrLocalAppOperationNotAdmitted
	}
	if authorityClass == localappop.AuthorityClassUserPermission && !containsLocalAppCapability(binding.Capabilities, required) {
		return LocalAppCallerDecision{}, ErrLocalAppOperationNotAdmitted
	}
	decision.Operation = operation
	decision.AuthorityClass = authorityClass
	decision.OperationCapability = required
	return decision, nil
}

func containsLocalAppCapability(capabilities []string, required string) bool {
	for _, capability := range capabilities {
		if capability == required {
			return true
		}
	}
	return false
}

func localAppOperationCapability(operation LocalAppOperation) (string, bool) {
	switch operation {
	case LocalAppOperationReadArtifactBytes:
		return "data.scope.read#runtime.artifacts", true
	case LocalAppOperationOpenConversation, LocalAppOperationSendConversationTurn,
		LocalAppOperationInterruptConversation, LocalAppOperationSubscribeConversation,
		LocalAppOperationConversationSnapshot:
		return localAppAgentPermissionID, true
	case LocalAppOperationConfigurationSnapshot, LocalAppOperationUpdateConfiguration,
		LocalAppOperationReadinessSnapshot, LocalAppOperationAutonomySnapshot,
		LocalAppOperationUpdateAutonomy, LocalAppOperationPresentationSnapshot,
		LocalAppOperationCommitPresentation:
		return "agents.configure", true
	case LocalAppOperationStorageJSONRead, LocalAppOperationStorageJSONWrite, LocalAppOperationStorageJSONRemove:
		return appstorage.LocalAppPrivateStorageEntitlement, true
	case LocalAppOperationRealmWorldCoreList:
		return "realm.world-core.list", true
	case LocalAppOperationRealmWorldCoreCreate:
		return "realm.world-core.create", true
	case LocalAppOperationVoiceTranscribe:
		return "runtime.agent.voice.transcribe", true
	case LocalAppOperationVoiceStreamSubscribe:
		return "runtime.agent.voice.read", true
	default:
		return "", false
	}
}
