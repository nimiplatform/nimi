package account

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
)

var (
	ErrLocalAppCallerUnauthorized   = errors.New("local-app caller is unavailable")
	ErrLocalAppAccountChanged       = fmt.Errorf("%w: account generation changed", ErrLocalAppCallerUnauthorized)
	ErrLocalAppProcessMismatch      = fmt.Errorf("%w: process binding changed", ErrLocalAppCallerUnauthorized)
	ErrLocalAppOperationNotAdmitted = errors.New("local-app protected operation is unavailable")
)

type LocalAppOperation = localappop.Operation

const (
	LocalAppOperationReadArtifactBytes       = localappop.OperationUnclassifiedArtifactRead
	LocalAppOperationOpenConversation        = localappop.OperationConversationOpen
	LocalAppOperationSendConversationTurn    = localappop.OperationConversationTurnSend
	LocalAppOperationInterruptConversation   = localappop.OperationConversationTurnInterrupt
	LocalAppOperationSubscribeConversation   = localappop.OperationConversationEventsSubscribe
	LocalAppOperationConversationSnapshot    = localappop.OperationConversationSnapshotGet
	LocalAppOperationReferenceList           = localappop.OperationAgentReferenceList
	LocalAppOperationSharedAIConfigGet       = localappop.OperationUnclassifiedSharedAIConfigGet
	LocalAppOperationSharedAIConfigOverwrite = localappop.OperationUnclassifiedSharedAIConfigOverwrite
	LocalAppOperationSharedAIProfilePreview  = localappop.OperationUnclassifiedSharedAIProfilePreview
	LocalAppOperationSharedAIProfileApply    = localappop.OperationUnclassifiedSharedAIProfileApply
	LocalAppOperationAutonomySnapshot        = localappop.OperationUnclassifiedAutonomySnapshot
	LocalAppOperationUpdateAutonomy          = localappop.OperationUnclassifiedAutonomyUpdate
	LocalAppOperationPresentationSnapshot    = localappop.OperationUnclassifiedPresentationSnapshot
	LocalAppOperationCommitPresentation      = localappop.OperationUnclassifiedPresentationCommit
	LocalAppOperationStorageJSONRead         = localappop.OperationStorageJSONRead
	LocalAppOperationStorageJSONWrite        = localappop.OperationStorageJSONWrite
	LocalAppOperationStorageJSONRemove       = localappop.OperationStorageJSONRemove
	LocalAppOperationRealmWorldCoreList      = localappop.OperationRealmWorldCoreList
	LocalAppOperationRealmWorldCoreCreate    = localappop.OperationRealmWorldCoreCreate
	LocalAppOperationAppAIConfigRead         = localappop.OperationAppAIConfigGet
	LocalAppOperationAppAIConfigOverwrite    = localappop.OperationAppAIConfigOverwrite
	LocalAppOperationTextCandidateGenerate   = localappop.OperationTextCandidateGenerate
	LocalAppOperationVoiceTranscribe         = localappop.OperationUnclassifiedVoiceTranscribe
	LocalAppOperationVoiceStreamSubscribe    = localappop.OperationUnclassifiedVoiceStreamSubscribe
)

type LocalAppTrustClass string

const LocalAppTrustClassDevelopment LocalAppTrustClass = "local_development"

// These internal handoff projections remain only so existing operation owners
// compile while protected App access is deliberately unavailable before IMP2.
type LocalAppCallerBinding struct {
	LocalOSUserAnchor     string
	SessionID             protectedlocal.Identifier
	AppID                 string
	HostExecutableDigest  protectedlocal.Identifier
	AccountGeneration     uint64
	RuntimeBootEpoch      protectedlocal.Identifier
	Process               protectedlocal.ProcessTuple
	DirectPeer            protectedlocal.DirectLocalAppPeer
	ExpiresAt             time.Time
	TrustClass            LocalAppTrustClass
	RegistrationHandle    protectedlocal.Identifier
	SourceGeneration      uint64
	DeclarationGeneration uint64
	ProjectRoot           string
	RegisteredAppSubject  string
}

type LocalAppSessionResolver interface {
	ResolveLocalAppSession(context.Context, uint64) (LocalAppCallerBinding, error)
}

type LocalAgentOwnerProjection struct {
	LocalAgentID string
	DisplayName  string
	AvatarURL    *string
}

type LocalAgentOwnershipResolver interface {
	OwnsActiveLocalAgent(context.Context, string, string) (bool, error)
	ListOwnedActiveLocalAgents(context.Context, string) ([]LocalAgentOwnerProjection, error)
}

type LocalAppCallerDecision struct {
	LocalOSUserAnchor     string
	SessionID             protectedlocal.Identifier
	AppID                 string
	HostExecutableDigest  protectedlocal.Identifier
	AccountID             string
	RealmEnvironmentID    string
	AccountGeneration     uint64
	RuntimeBootEpoch      protectedlocal.Identifier
	Process               protectedlocal.ProcessTuple
	DirectPeer            protectedlocal.DirectLocalAppPeer
	ExpiresAt             time.Time
	Operation             LocalAppOperation
	AuthorityClass        localappop.AuthorityClass
	OperationCapability   string
	LocalAgentID          string
	TrustClass            LocalAppTrustClass
	RegistrationHandle    protectedlocal.Identifier
	SourceGeneration      uint64
	DeclarationGeneration uint64
	ProjectRoot           string
	RegisteredAppSubject  string
}

func (s *Service) SetLocalAppSessionResolver(resolver LocalAppSessionResolver) {
	if s != nil {
		s.localAppSessions = resolver
	}
}

func (s *Service) SetLocalAgentOwnershipResolver(resolver LocalAgentOwnershipResolver) {
	if s != nil {
		s.localAgentOwnership = resolver
	}
}

func (s *Service) AuthorizeLocalAppCaller(context.Context) (LocalAppCallerDecision, error) {
	return LocalAppCallerDecision{}, ErrLocalAppCallerUnauthorized
}

func (s *Service) AuthorizeLocalAppOperation(context.Context, LocalAppOperation) (LocalAppCallerDecision, error) {
	return LocalAppCallerDecision{}, localAppOperationDenied(runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
}

func (s *Service) AuthorizeLocalAppProtectedOperation(context.Context, LocalAppOperation, localappop.Selector) (LocalAppCallerDecision, error) {
	return LocalAppCallerDecision{}, localAppOperationDenied(runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
}

func LocalAppCallerAuthorizationReason(err error) runtimev1.ReasonCode {
	if err == nil {
		return runtimev1.ReasonCode_ACTION_EXECUTED
	}
	if errors.Is(err, ErrLocalAppAccountChanged) {
		return runtimev1.ReasonCode_LOCAL_APP_ACCOUNT_CHANGED
	}
	if errors.Is(err, ErrLocalAppProcessMismatch) {
		return runtimev1.ReasonCode_LOCAL_APP_PROCESS_MISMATCH
	}
	return runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE
}

type authorizedLocalAppDecisionContextKey struct{}

type localAppOperationReasonError struct{ reason runtimev1.ReasonCode }

func (failure localAppOperationReasonError) Error() string {
	return "local-app protected operation unavailable"
}
func (failure localAppOperationReasonError) Unwrap() error { return ErrLocalAppOperationNotAdmitted }
func (failure localAppOperationReasonError) LocalAppOperationReasonCode() runtimev1.ReasonCode {
	return failure.reason
}

func localAppOperationDenied(reason runtimev1.ReasonCode) error {
	return localAppOperationReasonError{reason: reason}
}

func LocalAppOperationAuthorizationReason(err error) runtimev1.ReasonCode {
	var source interface{ LocalAppOperationReasonCode() runtimev1.ReasonCode }
	if errors.As(err, &source) {
		return source.LocalAppOperationReasonCode()
	}
	return runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE
}

func ContextWithAuthorizedLocalAppDecision(ctx context.Context, decision LocalAppCallerDecision) context.Context {
	return context.WithValue(ctx, authorizedLocalAppDecisionContextKey{}, decision)
}

func AuthorizedLocalAppDecisionFromContext(ctx context.Context) (LocalAppCallerDecision, bool) {
	if ctx == nil {
		return LocalAppCallerDecision{}, false
	}
	decision, ok := ctx.Value(authorizedLocalAppDecisionContextKey{}).(LocalAppCallerDecision)
	return decision, ok && strings.TrimSpace(decision.RegisteredAppSubject) != ""
}
