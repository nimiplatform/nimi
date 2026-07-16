package account

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
)

var (
	ErrLocalAppCallerUnauthorized   = errors.New("local-app caller is not currently authorized")
	ErrLocalAppAccountChanged       = fmt.Errorf("%w: account generation changed", ErrLocalAppCallerUnauthorized)
	ErrLocalAppProcessMismatch      = fmt.Errorf("%w: process binding changed", ErrLocalAppCallerUnauthorized)
	ErrLocalAppOperationNotAdmitted = errors.New("local-app operation capability and grant are not admitted")
)

type LocalAppOperation string

const (
	LocalAppOperationReadArtifactBytes     LocalAppOperation = "artifacts.read_runtime_bytes"
	LocalAppOperationOpenConversation      LocalAppOperation = "runtime_agent.conversation.open"
	LocalAppOperationSendConversationTurn  LocalAppOperation = "runtime_agent.conversation.turn_send"
	LocalAppOperationSubscribeConversation LocalAppOperation = "runtime_agent.conversation.turn_subscribe"
	LocalAppOperationConversationSnapshot  LocalAppOperation = "runtime_agent.conversation.snapshot"
	LocalAppOperationStorageJSONRead       LocalAppOperation = "app_storage.json.read"
	LocalAppOperationStorageJSONWrite      LocalAppOperation = "app_storage.json.write"
	LocalAppOperationStorageJSONRemove     LocalAppOperation = "app_storage.json.remove"
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

// LocalAppCallerDecision is an immutable per-call origin/account decision.
// A later grant evaluation extends this Account-owned boundary; consumers must
// not add independent session caches.
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
	ExpiresAt               time.Time
	Operation               LocalAppOperation
	PermissionScope         string
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
	if strings.TrimSpace(binding.LocalOSUserAnchor) == "" || binding.LocalOSUserAnchor != strings.TrimSpace(binding.LocalOSUserAnchor) ||
		binding.SessionID == (protectedlocal.Identifier{}) || strings.TrimSpace(binding.AppID) == "" ||
		binding.HostExecutableDigest == (protectedlocal.Identifier{}) ||
		binding.RuntimeBootEpoch == (protectedlocal.Identifier{}) || binding.Process.PID == 0 || !s.now().UTC().Before(binding.ExpiresAt.UTC()) ||
		binding.TrustClass != LocalAppTrustClassDevelopment || binding.AuthorizationID == (protectedlocal.Identifier{}) ||
		binding.AuthorizationGeneration == 0 || strings.TrimSpace(binding.ProjectRoot) == "" ||
		binding.CapabilityFingerprint == (protectedlocal.Identifier{}) || len(binding.Capabilities) == 0 {
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

// LocalAppCallerAuthorizationReason maps the zero-grant caller revalidation
// boundary to the same closed Runtime reason vocabulary used by selected
// operations. Private resolver errors never cross the transport.
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
// revalidation in one Account-owned entrypoint. Capability presence is only an
// input posture; the final grant coordinator must still admit the operation.
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
		binding.CapabilityFingerprint != decision.CapabilityFingerprint {
		return LocalAppCallerDecision{}, ErrLocalAppCallerUnauthorized
	}
	if !containsLocalAppCapability(binding.Capabilities, required) {
		return LocalAppCallerDecision{}, ErrLocalAppOperationNotAdmitted
	}
	decision.Operation = operation
	decision.PermissionScope = required
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
	case LocalAppOperationOpenConversation, LocalAppOperationSendConversationTurn:
		return "runtime.agent.turn.write", true
	case LocalAppOperationSubscribeConversation, LocalAppOperationConversationSnapshot:
		return "runtime.agent.turn.read", true
	case LocalAppOperationStorageJSONRead:
		return "file.read.scoped#app-local-drafts", true
	case LocalAppOperationStorageJSONWrite, LocalAppOperationStorageJSONRemove:
		return "file.write.scoped#app-local-drafts", true
	case LocalAppOperationVoiceTranscribe:
		return "runtime.agent.voice.transcribe", true
	case LocalAppOperationVoiceStreamSubscribe:
		return "runtime.agent.voice.read", true
	default:
		return "", false
	}
}
