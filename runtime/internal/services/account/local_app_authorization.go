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
	LocalAppOperationOpenConversation               = localappop.OperationConversationOpen
	LocalAppOperationSendConversationTurn           = localappop.OperationConversationTurnSend
	LocalAppOperationInterruptConversation          = localappop.OperationConversationTurnInterrupt
	LocalAppOperationSubscribeConversation          = localappop.OperationConversationEventsSubscribe
	LocalAppOperationConversationSnapshot           = localappop.OperationConversationSnapshotGet
	LocalAppOperationConversationAttachmentUpload   = localappop.OperationConversationAttachmentUpload
	LocalAppOperationConversationArtifactRead       = localappop.OperationConversationArtifactRead
	LocalAppOperationConversationVoiceTranscribe    = localappop.OperationConversationVoiceTranscribe
	LocalAppOperationConversationVoiceRender        = localappop.OperationConversationVoiceRender
	LocalAppOperationEmbodimentSnapshot             = localappop.OperationAgentEmbodimentSnapshotGet
	LocalAppOperationEmbodimentEventsSubscribe      = localappop.OperationAgentEmbodimentEventsSubscribe
	LocalAppOperationReferenceList                  = localappop.OperationAgentReferenceList
	LocalAppOperationStorageJSONRead                = localappop.OperationStorageJSONRead
	LocalAppOperationStorageJSONWrite               = localappop.OperationStorageJSONWrite
	LocalAppOperationStorageJSONRemove              = localappop.OperationStorageJSONRemove
	LocalAppOperationStorageAssetStat               = localappop.OperationStorageAssetStat
	LocalAppOperationStorageAssetList               = localappop.OperationStorageAssetList
	LocalAppOperationStorageAssetWrite              = localappop.OperationStorageAssetWrite
	LocalAppOperationStorageAssetRead               = localappop.OperationStorageAssetRead
	LocalAppOperationStorageAssetRemove             = localappop.OperationStorageAssetRemove
	LocalAppOperationStorageAssetMove               = localappop.OperationStorageAssetMove
	LocalAppOperationStorageAssetReveal             = localappop.OperationStorageAssetReveal
	LocalAppOperationArtifactAdoptToStorage         = localappop.OperationArtifactAdoptToStorage
	LocalAppOperationRealmWorldCoreList             = localappop.OperationRealmWorldCoreList
	LocalAppOperationRealmWorldCoreCreate           = localappop.OperationRealmWorldCoreCreate
	LocalAppOperationPersonaListOwned               = localappop.OperationRealmPersonaCharacterListOwned
	LocalAppOperationPersonaGetOwned                = localappop.OperationRealmPersonaCharacterGetOwned
	LocalAppOperationPersonaCreate                  = localappop.OperationRealmPersonaCharacterCreate
	LocalAppOperationPersonaReplace                 = localappop.OperationRealmPersonaCharacterReplace
	LocalAppOperationPersonaDelete                  = localappop.OperationRealmPersonaCharacterDelete
	LocalAppOperationRealmChatList                  = localappop.OperationRealmChatList
	LocalAppOperationRealmRealtimeChannelOpen       = localappop.OperationRealmRealtimeChannelOpen
	LocalAppOperationRealmRealtimeEventsSubscribe   = localappop.OperationRealmRealtimeEventsSubscribe
	LocalAppOperationRealmRealtimeEventsAck         = localappop.OperationRealmRealtimeEventsAck
	LocalAppOperationRealmRealtimeSubscriptionClose = localappop.OperationRealmRealtimeSubscriptionClose
	LocalAppOperationRealmRealtimeChannelClose      = localappop.OperationRealmRealtimeChannelClose
	LocalAppOperationAppAIConfigRead                = localappop.OperationAppAIConfigGet
	LocalAppOperationAppAIConfigOverwrite           = localappop.OperationAppAIConfigOverwrite
	LocalAppOperationAppAIConfigOptionsList         = localappop.OperationAppAIConfigOptionsList
	LocalAppOperationTextCandidateGenerate          = localappop.OperationTextCandidateGenerate
	LocalAppOperationTextTurnStream                 = localappop.OperationTextTurnStream
	LocalAppOperationScenarioExecute                = localappop.OperationScenarioExecute
	LocalAppOperationScenarioJobSubmit              = localappop.OperationScenarioJobSubmit
	LocalAppOperationScenarioJobGet                 = localappop.OperationScenarioJobGet
	LocalAppOperationScenarioJobSubscribe           = localappop.OperationScenarioJobSubscribe
	LocalAppOperationScenarioJobCancel              = localappop.OperationScenarioJobCancel
	LocalAppOperationArtifactRead                   = localappop.OperationArtifactRead
	LocalAppOperationArtifactUpload                 = localappop.OperationArtifactUpload
	LocalAppOperationVoiceAssetsList                = localappop.OperationVoiceAssetsList
	LocalAppOperationAIRealtimeOpen                 = localappop.OperationAIRealtimeOpen
	LocalAppOperationAIRealtimeInputAppend          = localappop.OperationAIRealtimeInputAppend
	LocalAppOperationAIRealtimeOwnerControlSubmit   = localappop.OperationAIRealtimeOwnerControlSubmit
	LocalAppOperationAIRealtimeEventsRead           = localappop.OperationAIRealtimeEventsRead
	LocalAppOperationAIRealtimeOutputInterrupt      = localappop.OperationAIRealtimeOutputInterrupt
	LocalAppOperationAIRealtimeClose                = localappop.OperationAIRealtimeClose
	LocalAppOperationAgentRealtimeOpen              = localappop.OperationAgentRealtimeOpen
	LocalAppOperationAgentRealtimeInputAppend       = localappop.OperationAgentRealtimeInputAppend
	LocalAppOperationAgentRealtimeEventsSubscribe   = localappop.OperationAgentRealtimeEventsSubscribe
	LocalAppOperationAgentRealtimeStatusGet         = localappop.OperationAgentRealtimeStatusGet
	LocalAppOperationAgentRealtimeOutputInterrupt   = localappop.OperationAgentRealtimeOutputInterrupt
	LocalAppOperationAgentRealtimeClose             = localappop.OperationAgentRealtimeClose
	LocalAppOperationSharedAIConfigGet              = localappop.OperationAgentAIConfigGet
	LocalAppOperationSharedAIConfigOverwrite        = localappop.OperationAgentAIConfigOverwrite
	LocalAppOperationSharedAIConfigOptions          = localappop.OperationAgentAIConfigOptionsList
	LocalAppOperationManagerSnapshot                = localappop.OperationAgentManagerSnapshotGet
	LocalAppOperationAutonomySnapshot               = localappop.OperationAgentAutonomySnapshotGet
	LocalAppOperationUpdateAutonomy                 = localappop.OperationAgentAutonomyUpdate
	LocalAppOperationPresentationSnapshot           = localappop.OperationAgentPresentationSnapshotGet
	LocalAppOperationCommitPresentation             = localappop.OperationAgentPresentationCommit
	LocalAppOperationMemoryInspect                  = localappop.OperationAgentMemoryInspect
	LocalAppOperationMemoryCorrect                  = localappop.OperationAgentMemoryCorrect
	LocalAppOperationMemoryForget                   = localappop.OperationAgentMemoryForget
	LocalAppOperationMemorySwitch                   = localappop.OperationAgentMemorySwitch
	LocalAppOperationMemoryDelete                   = localappop.OperationAgentMemoryDelete
)

type LocalAppTrustClass string

const (
	LocalAppTrustClassDevelopment  LocalAppTrustClass = "local_development"
	LocalAppTrustClassBuiltIn      LocalAppTrustClass = "built_in"
	LocalAppTrustClassVerified     LocalAppTrustClass = "verified"
	LocalAppTrustClassUserImported LocalAppTrustClass = "user_imported"
)

// LocalAppCallerBinding is the Runtime-derived protected-session handoff
// projection admitted local App operations resolve from; caller-supplied
// identity or authority facts never enter it.
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
	SessionInvalidated    <-chan struct{}
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
