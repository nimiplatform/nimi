package localappop

import (
	"errors"
	"fmt"
)

var (
	ErrContractInvalid  = errors.New("canonical App operation contract is invalid")
	ErrOperationUnknown = errors.New("App operation ingress is unknown or unclassified")
)

type Operation uint8

type Ingress uint8

type AuthorityClass string

const (
	AuthorityClassUnknown   AuthorityClass = ""
	AuthorityClassBase      AuthorityClass = "base"
	AuthorityClassAppAccess AuthorityClass = "app_access"
)

type Domain string

// AppOperationIDTextCandidateGenerate is the canonical operation identifier
// carried into the exact text-candidate owner handoff. Keep the literal owned
// by the closed operation contract rather than minting a second capability
// vocabulary in an owner adapter.
const AppOperationIDTextCandidateGenerate = "runtime.ai.text-candidate.generate"

const (
	AppOperationIDStorageAssetStat               = "runtime.app-storage.asset.stat"
	AppOperationIDStorageAssetList               = "runtime.app-storage.asset.list"
	AppOperationIDStorageAssetWrite              = "runtime.app-storage.asset.write"
	AppOperationIDStorageAssetRead               = "runtime.app-storage.asset.read"
	AppOperationIDStorageAssetRemove             = "runtime.app-storage.asset.remove"
	AppOperationIDStorageAssetMove               = "runtime.app-storage.asset.move"
	AppOperationIDStorageAssetReveal             = "runtime.app-storage.asset.reveal"
	AppOperationIDArtifactAdopt                  = "runtime.ai.artifact.adopt-to-app-storage"
	AppOperationIDPersonaListOwned               = "realm.persona-character.list-owned"
	AppOperationIDPersonaGetOwned                = "realm.persona-character.get-owned"
	AppOperationIDPersonaCreate                  = "realm.persona-character.create"
	AppOperationIDPersonaReplace                 = "realm.persona-character.replace"
	AppOperationIDPersonaDelete                  = "realm.persona-character.delete"
	AppOperationIDRealmChatList                  = "realm.chat.list"
	AppOperationIDRealmRealtimeChannelOpen       = "realm.realtime.channel.open"
	AppOperationIDRealmRealtimeEventsSubscribe   = "realm.realtime.events.subscribe"
	AppOperationIDRealmRealtimeEventsAck         = "realm.realtime.events.ack"
	AppOperationIDRealmRealtimeSubscriptionClose = "realm.realtime.subscription.close"
	AppOperationIDRealmRealtimeChannelClose      = "realm.realtime.channel.close"
	AppOperationIDConversationAttachmentUpload   = "runtime.agent.conversation.attachment.upload"
	AppOperationIDConversationArtifactRead       = "runtime.agent.conversation.artifact.read"
	AppOperationIDConversationVoiceTranscribe    = "runtime.agent.conversation.voice.transcribe"
	AppOperationIDConversationVoiceRender        = "runtime.agent.conversation.voice.render"
	AppOperationIDAIRealtimeOpen                 = "runtime.ai.realtime.open"
	AppOperationIDAIRealtimeInputAppend          = "runtime.ai.realtime.input.append"
	AppOperationIDAIRealtimeOwnerControlSubmit   = "runtime.ai.realtime.owner-control.submit"
	AppOperationIDAIRealtimeEventsRead           = "runtime.ai.realtime.events.read"
	AppOperationIDAIRealtimeOutputInterrupt      = "runtime.ai.realtime.output.interrupt"
	AppOperationIDAIRealtimeClose                = "runtime.ai.realtime.close"
	AppOperationIDAgentRealtimeOpen              = "runtime.agent.realtime.open"
	AppOperationIDAgentRealtimeInputAppend       = "runtime.agent.realtime.input.append"
	AppOperationIDAgentRealtimeEventsSubscribe   = "runtime.agent.realtime.events.subscribe"
	AppOperationIDAgentRealtimeStatusGet         = "runtime.agent.realtime.status.get"
	AppOperationIDAgentRealtimeOutputInterrupt   = "runtime.agent.realtime.output.interrupt"
	AppOperationIDAgentRealtimeClose             = "runtime.agent.realtime.close"
)

// Canonical operation identifiers for the scenario-consumption operation
// family. Each literal is owned by the closed operation contract and carried
// into the exact owner handoff.
const (
	AppOperationIDTextTurnStream       = "runtime.ai.text-turn.stream"
	AppOperationIDScenarioExecute      = "runtime.ai.scenario.execute"
	AppOperationIDScenarioJobSubmit    = "runtime.ai.scenario-job.submit"
	AppOperationIDScenarioJobGet       = "runtime.ai.scenario-job.get"
	AppOperationIDScenarioJobSubscribe = "runtime.ai.scenario-job.subscribe"
	AppOperationIDScenarioJobCancel    = "runtime.ai.scenario-job.cancel"
	AppOperationIDArtifactRead         = "runtime.ai.artifact.read"
	AppOperationIDArtifactUpload       = "runtime.ai.artifact.upload"
	AppOperationIDVoiceAssetsList      = "runtime.ai.voice-assets.list"
)

const (
	IngressUnknown Ingress = iota
	IngressStorageJSONRead
	IngressStorageJSONWrite
	IngressStorageJSONRemove
	IngressStorageAssetStat
	IngressStorageAssetList
	IngressStorageAssetWrite
	IngressStorageAssetRead
	IngressStorageAssetRemove
	IngressStorageAssetMove
	IngressStorageAssetReveal
	IngressArtifactAdoptToStorage
	IngressAppAIConfigGet
	IngressAppAIConfigOverwrite
	IngressAppAIConfigOptionsList
	IngressRealmWorldCoreList
	IngressRealmWorldCoreCreate
	IngressRealmPersonaCharacterListOwned
	IngressRealmPersonaCharacterGetOwned
	IngressRealmPersonaCharacterCreate
	IngressRealmPersonaCharacterReplace
	IngressRealmPersonaCharacterDelete
	IngressRealmChatList
	IngressRealmRealtimeChannelOpen
	IngressRealmRealtimeEventsSubscribe
	IngressRealmRealtimeEventsAck
	IngressRealmRealtimeSubscriptionClose
	IngressRealmRealtimeChannelClose
	IngressTextCandidateGenerate
	IngressTextTurnStream
	IngressScenarioExecute
	IngressScenarioJobSubmit
	IngressScenarioJobGet
	IngressScenarioJobSubscribe
	IngressScenarioJobCancel
	IngressArtifactRead
	IngressArtifactUpload
	IngressVoiceAssetsList
	IngressAIRealtimeOpen
	IngressAIRealtimeInputAppend
	IngressAIRealtimeOwnerControlSubmit
	IngressAIRealtimeEventsRead
	IngressAIRealtimeOutputInterrupt
	IngressAIRealtimeClose
	IngressAgentRealtimeOpen
	IngressAgentRealtimeInputAppend
	IngressAgentRealtimeEventsSubscribe
	IngressAgentRealtimeStatusGet
	IngressAgentRealtimeOutputInterrupt
	IngressAgentRealtimeClose
	IngressAgentReferenceList
	IngressConversationOpen
	IngressConversationTurnSend
	IngressConversationTurnInterrupt
	IngressConversationEventsSubscribe
	IngressConversationSnapshotGet
	IngressConversationAttachmentUpload
	IngressConversationArtifactRead
	IngressConversationVoiceTranscribe
	IngressConversationVoiceRender
	IngressAgentManagerSnapshotGet
	IngressAgentAIConfigGet
	IngressAgentAIConfigOverwrite
	IngressAgentAIConfigOptionsList
	IngressAgentAutonomySnapshotGet
	IngressAgentAutonomyUpdate
	IngressAgentPresentationSnapshotGet
	IngressAgentPresentationCommit
	IngressAgentMemoryInspect
	IngressAgentMemoryCorrect
	IngressAgentMemoryForget
	IngressAgentMemorySwitch
	IngressAgentMemoryDelete
)

const (
	OperationUnknown Operation = iota
	OperationStorageJSONRead
	OperationStorageJSONWrite
	OperationStorageJSONRemove
	OperationStorageAssetStat
	OperationStorageAssetList
	OperationStorageAssetWrite
	OperationStorageAssetRead
	OperationStorageAssetRemove
	OperationStorageAssetMove
	OperationStorageAssetReveal
	OperationArtifactAdoptToStorage
	OperationAppAIConfigGet
	OperationAppAIConfigOverwrite
	OperationAppAIConfigOptionsList
	OperationRealmWorldCoreList
	OperationRealmWorldCoreCreate
	OperationRealmPersonaCharacterListOwned
	OperationRealmPersonaCharacterGetOwned
	OperationRealmPersonaCharacterCreate
	OperationRealmPersonaCharacterReplace
	OperationRealmPersonaCharacterDelete
	OperationRealmChatList
	OperationRealmRealtimeChannelOpen
	OperationRealmRealtimeEventsSubscribe
	OperationRealmRealtimeEventsAck
	OperationRealmRealtimeSubscriptionClose
	OperationRealmRealtimeChannelClose
	OperationTextCandidateGenerate
	OperationTextTurnStream
	OperationScenarioExecute
	OperationScenarioJobSubmit
	OperationScenarioJobGet
	OperationScenarioJobSubscribe
	OperationScenarioJobCancel
	OperationArtifactRead
	OperationArtifactUpload
	OperationVoiceAssetsList
	OperationAIRealtimeOpen
	OperationAIRealtimeInputAppend
	OperationAIRealtimeOwnerControlSubmit
	OperationAIRealtimeEventsRead
	OperationAIRealtimeOutputInterrupt
	OperationAIRealtimeClose
	OperationAgentRealtimeOpen
	OperationAgentRealtimeInputAppend
	OperationAgentRealtimeEventsSubscribe
	OperationAgentRealtimeStatusGet
	OperationAgentRealtimeOutputInterrupt
	OperationAgentRealtimeClose
	OperationAgentReferenceList
	OperationConversationOpen
	OperationConversationTurnSend
	OperationConversationTurnInterrupt
	OperationConversationEventsSubscribe
	OperationConversationSnapshotGet
	OperationConversationAttachmentUpload
	OperationConversationArtifactRead
	OperationConversationVoiceTranscribe
	OperationConversationVoiceRender
	OperationAgentManagerSnapshotGet
	OperationAgentAIConfigGet
	OperationAgentAIConfigOverwrite
	OperationAgentAIConfigOptionsList
	OperationAgentAutonomySnapshotGet
	OperationAgentAutonomyUpdate
	OperationAgentPresentationSnapshotGet
	OperationAgentPresentationCommit
	OperationAgentMemoryInspect
	OperationAgentMemoryCorrect
	OperationAgentMemoryForget
	OperationAgentMemorySwitch
	OperationAgentMemoryDelete
)

type contractRow struct {
	ingress   Ingress
	operation Operation
	id        string
	class     AuthorityClass
	domain    Domain
}

// @nimi-authority: definition.nimi.platform.core-protocol.app-operation-contract
// @nimi-authority: rule.nimi.platform.core-protocol.p-proto-021
// @nimi-authority: rule.nimi.runtime.security-core.r087
// canonicalAppOperationContract is the sole Runtime operation-ID and
// classification map. AppOperationIds intentionally occur nowhere else.
var canonicalAppOperationContract = [...]contractRow{
	{IngressStorageJSONRead, OperationStorageJSONRead, "runtime.app-storage.json.read", AuthorityClassBase, ""},
	{IngressStorageJSONWrite, OperationStorageJSONWrite, "runtime.app-storage.json.write", AuthorityClassBase, ""},
	{IngressStorageJSONRemove, OperationStorageJSONRemove, "runtime.app-storage.json.remove", AuthorityClassBase, ""},
	{IngressStorageAssetStat, OperationStorageAssetStat, AppOperationIDStorageAssetStat, AuthorityClassBase, ""},
	{IngressStorageAssetList, OperationStorageAssetList, AppOperationIDStorageAssetList, AuthorityClassBase, ""},
	{IngressStorageAssetWrite, OperationStorageAssetWrite, AppOperationIDStorageAssetWrite, AuthorityClassBase, ""},
	{IngressStorageAssetRead, OperationStorageAssetRead, AppOperationIDStorageAssetRead, AuthorityClassBase, ""},
	{IngressStorageAssetRemove, OperationStorageAssetRemove, AppOperationIDStorageAssetRemove, AuthorityClassBase, ""},
	{IngressStorageAssetMove, OperationStorageAssetMove, AppOperationIDStorageAssetMove, AuthorityClassBase, ""},
	{IngressStorageAssetReveal, OperationStorageAssetReveal, AppOperationIDStorageAssetReveal, AuthorityClassBase, ""},
	{IngressArtifactAdoptToStorage, OperationArtifactAdoptToStorage, AppOperationIDArtifactAdopt, AuthorityClassAppAccess, "runtime.consume"},
	{IngressAppAIConfigGet, OperationAppAIConfigGet, "runtime.ai.app-config.get", AuthorityClassAppAccess, "runtime.consume"},
	{IngressAppAIConfigOverwrite, OperationAppAIConfigOverwrite, "runtime.ai.app-config.overwrite", AuthorityClassAppAccess, "runtime.consume"},
	{IngressAppAIConfigOptionsList, OperationAppAIConfigOptionsList, "runtime.ai.app-config.options.list", AuthorityClassAppAccess, "runtime.consume"},
	{IngressRealmWorldCoreList, OperationRealmWorldCoreList, "realm.world-core.list", AuthorityClassAppAccess, "realm.data"},
	{IngressRealmWorldCoreCreate, OperationRealmWorldCoreCreate, "realm.world-core.create", AuthorityClassAppAccess, "realm.data"},
	{IngressRealmPersonaCharacterListOwned, OperationRealmPersonaCharacterListOwned, AppOperationIDPersonaListOwned, AuthorityClassAppAccess, "realm.data"},
	{IngressRealmPersonaCharacterGetOwned, OperationRealmPersonaCharacterGetOwned, AppOperationIDPersonaGetOwned, AuthorityClassAppAccess, "realm.data"},
	{IngressRealmPersonaCharacterCreate, OperationRealmPersonaCharacterCreate, AppOperationIDPersonaCreate, AuthorityClassAppAccess, "realm.data"},
	{IngressRealmPersonaCharacterReplace, OperationRealmPersonaCharacterReplace, AppOperationIDPersonaReplace, AuthorityClassAppAccess, "realm.data"},
	{IngressRealmPersonaCharacterDelete, OperationRealmPersonaCharacterDelete, AppOperationIDPersonaDelete, AuthorityClassAppAccess, "realm.data"},
	{IngressRealmChatList, OperationRealmChatList, AppOperationIDRealmChatList, AuthorityClassAppAccess, "realm.data"},
	{IngressRealmRealtimeChannelOpen, OperationRealmRealtimeChannelOpen, AppOperationIDRealmRealtimeChannelOpen, AuthorityClassAppAccess, "realm.data"},
	{IngressRealmRealtimeEventsSubscribe, OperationRealmRealtimeEventsSubscribe, AppOperationIDRealmRealtimeEventsSubscribe, AuthorityClassAppAccess, "realm.data"},
	{IngressRealmRealtimeEventsAck, OperationRealmRealtimeEventsAck, AppOperationIDRealmRealtimeEventsAck, AuthorityClassAppAccess, "realm.data"},
	{IngressRealmRealtimeSubscriptionClose, OperationRealmRealtimeSubscriptionClose, AppOperationIDRealmRealtimeSubscriptionClose, AuthorityClassAppAccess, "realm.data"},
	{IngressRealmRealtimeChannelClose, OperationRealmRealtimeChannelClose, AppOperationIDRealmRealtimeChannelClose, AuthorityClassAppAccess, "realm.data"},
	{IngressTextCandidateGenerate, OperationTextCandidateGenerate, AppOperationIDTextCandidateGenerate, AuthorityClassAppAccess, "runtime.consume"},
	{IngressTextTurnStream, OperationTextTurnStream, AppOperationIDTextTurnStream, AuthorityClassAppAccess, "runtime.consume"},
	{IngressScenarioExecute, OperationScenarioExecute, AppOperationIDScenarioExecute, AuthorityClassAppAccess, "runtime.consume"},
	{IngressScenarioJobSubmit, OperationScenarioJobSubmit, AppOperationIDScenarioJobSubmit, AuthorityClassAppAccess, "runtime.consume"},
	{IngressScenarioJobGet, OperationScenarioJobGet, AppOperationIDScenarioJobGet, AuthorityClassAppAccess, "runtime.consume"},
	{IngressScenarioJobSubscribe, OperationScenarioJobSubscribe, AppOperationIDScenarioJobSubscribe, AuthorityClassAppAccess, "runtime.consume"},
	{IngressScenarioJobCancel, OperationScenarioJobCancel, AppOperationIDScenarioJobCancel, AuthorityClassAppAccess, "runtime.consume"},
	{IngressArtifactRead, OperationArtifactRead, AppOperationIDArtifactRead, AuthorityClassAppAccess, "runtime.consume"},
	{IngressArtifactUpload, OperationArtifactUpload, AppOperationIDArtifactUpload, AuthorityClassAppAccess, "runtime.consume"},
	{IngressVoiceAssetsList, OperationVoiceAssetsList, AppOperationIDVoiceAssetsList, AuthorityClassAppAccess, "runtime.consume"},
	{IngressAIRealtimeOpen, OperationAIRealtimeOpen, AppOperationIDAIRealtimeOpen, AuthorityClassAppAccess, "runtime.consume"},
	{IngressAIRealtimeInputAppend, OperationAIRealtimeInputAppend, AppOperationIDAIRealtimeInputAppend, AuthorityClassAppAccess, "runtime.consume"},
	{IngressAIRealtimeOwnerControlSubmit, OperationAIRealtimeOwnerControlSubmit, AppOperationIDAIRealtimeOwnerControlSubmit, AuthorityClassAppAccess, "runtime.consume"},
	{IngressAIRealtimeEventsRead, OperationAIRealtimeEventsRead, AppOperationIDAIRealtimeEventsRead, AuthorityClassAppAccess, "runtime.consume"},
	{IngressAIRealtimeOutputInterrupt, OperationAIRealtimeOutputInterrupt, AppOperationIDAIRealtimeOutputInterrupt, AuthorityClassAppAccess, "runtime.consume"},
	{IngressAIRealtimeClose, OperationAIRealtimeClose, AppOperationIDAIRealtimeClose, AuthorityClassAppAccess, "runtime.consume"},
	{IngressAgentRealtimeOpen, OperationAgentRealtimeOpen, AppOperationIDAgentRealtimeOpen, AuthorityClassAppAccess, "agent.local"},
	{IngressAgentRealtimeInputAppend, OperationAgentRealtimeInputAppend, AppOperationIDAgentRealtimeInputAppend, AuthorityClassAppAccess, "agent.local"},
	{IngressAgentRealtimeEventsSubscribe, OperationAgentRealtimeEventsSubscribe, AppOperationIDAgentRealtimeEventsSubscribe, AuthorityClassAppAccess, "agent.local"},
	{IngressAgentRealtimeStatusGet, OperationAgentRealtimeStatusGet, AppOperationIDAgentRealtimeStatusGet, AuthorityClassAppAccess, "agent.local"},
	{IngressAgentRealtimeOutputInterrupt, OperationAgentRealtimeOutputInterrupt, AppOperationIDAgentRealtimeOutputInterrupt, AuthorityClassAppAccess, "agent.local"},
	{IngressAgentRealtimeClose, OperationAgentRealtimeClose, AppOperationIDAgentRealtimeClose, AuthorityClassAppAccess, "agent.local"},
	{IngressAgentReferenceList, OperationAgentReferenceList, "runtime.agent.reference.list", AuthorityClassAppAccess, "agent.local"},
	{IngressConversationOpen, OperationConversationOpen, "runtime.agent.conversation.open", AuthorityClassAppAccess, "agent.local"},
	{IngressConversationTurnSend, OperationConversationTurnSend, "runtime.agent.conversation.turn.send", AuthorityClassAppAccess, "agent.local"},
	{IngressConversationTurnInterrupt, OperationConversationTurnInterrupt, "runtime.agent.conversation.turn.interrupt", AuthorityClassAppAccess, "agent.local"},
	{IngressConversationEventsSubscribe, OperationConversationEventsSubscribe, "runtime.agent.conversation.events.subscribe", AuthorityClassAppAccess, "agent.local"},
	{IngressConversationSnapshotGet, OperationConversationSnapshotGet, "runtime.agent.conversation.snapshot.get", AuthorityClassAppAccess, "agent.local"},
	{IngressConversationAttachmentUpload, OperationConversationAttachmentUpload, AppOperationIDConversationAttachmentUpload, AuthorityClassAppAccess, "agent.local"},
	{IngressConversationArtifactRead, OperationConversationArtifactRead, AppOperationIDConversationArtifactRead, AuthorityClassAppAccess, "agent.local"},
	{IngressConversationVoiceTranscribe, OperationConversationVoiceTranscribe, AppOperationIDConversationVoiceTranscribe, AuthorityClassAppAccess, "agent.local"},
	{IngressConversationVoiceRender, OperationConversationVoiceRender, AppOperationIDConversationVoiceRender, AuthorityClassAppAccess, "agent.local"},
	{IngressAgentManagerSnapshotGet, OperationAgentManagerSnapshotGet, "runtime.agent.manager.snapshot.get", AuthorityClassAppAccess, "agent.configure"},
	{IngressAgentAIConfigGet, OperationAgentAIConfigGet, "runtime.agent.ai-config.get", AuthorityClassAppAccess, "agent.configure"},
	{IngressAgentAIConfigOverwrite, OperationAgentAIConfigOverwrite, "runtime.agent.ai-config.overwrite", AuthorityClassAppAccess, "agent.configure"},
	{IngressAgentAIConfigOptionsList, OperationAgentAIConfigOptionsList, "runtime.agent.ai-config.options.list", AuthorityClassAppAccess, "agent.configure"},
	{IngressAgentAutonomySnapshotGet, OperationAgentAutonomySnapshotGet, "runtime.agent.autonomy.snapshot.get", AuthorityClassAppAccess, "agent.configure"},
	{IngressAgentAutonomyUpdate, OperationAgentAutonomyUpdate, "runtime.agent.autonomy.update", AuthorityClassAppAccess, "agent.configure"},
	{IngressAgentPresentationSnapshotGet, OperationAgentPresentationSnapshotGet, "runtime.agent.presentation.snapshot.get", AuthorityClassAppAccess, "agent.configure"},
	{IngressAgentPresentationCommit, OperationAgentPresentationCommit, "runtime.agent.presentation.commit", AuthorityClassAppAccess, "agent.configure"},
	{IngressAgentMemoryInspect, OperationAgentMemoryInspect, "runtime.agent.memory.inspect", AuthorityClassAppAccess, "agent.configure"},
	{IngressAgentMemoryCorrect, OperationAgentMemoryCorrect, "runtime.agent.memory.correct", AuthorityClassAppAccess, "agent.configure"},
	{IngressAgentMemoryForget, OperationAgentMemoryForget, "runtime.agent.memory.forget", AuthorityClassAppAccess, "agent.configure"},
	{IngressAgentMemorySwitch, OperationAgentMemorySwitch, "runtime.agent.memory.switch", AuthorityClassAppAccess, "agent.configure"},
	{IngressAgentMemoryDelete, OperationAgentMemoryDelete, "runtime.agent.memory.delete", AuthorityClassAppAccess, "agent.configure"},
}

type Classification struct {
	Operation Operation
	Class     AuthorityClass
	Domain    Domain
}

func ClassifyIngress(ingress Ingress) (Classification, error) {
	if err := validateContractRows(canonicalAppOperationContract[:]); err != nil {
		return Classification{}, err
	}
	for _, row := range canonicalAppOperationContract {
		if row.ingress == ingress {
			return Classification{Operation: row.operation, Class: row.class, Domain: row.domain}, nil
		}
	}
	return Classification{}, ErrOperationUnknown
}

func ClassifyOperation(operation Operation) (Classification, error) {
	if err := validateContractRows(canonicalAppOperationContract[:]); err != nil {
		return Classification{}, err
	}
	for _, row := range canonicalAppOperationContract {
		if row.operation == operation {
			return Classification{Operation: row.operation, Class: row.class, Domain: row.domain}, nil
		}
	}
	return Classification{}, ErrOperationUnknown
}

// IsSupportedDomain derives declaration support from the canonical operation
// map rather than maintaining a second domain allowlist.
func IsSupportedDomain(value string) bool {
	if validateContractRows(canonicalAppOperationContract[:]) != nil {
		return false
	}
	for _, row := range canonicalAppOperationContract {
		if row.class == AuthorityClassAppAccess && string(row.domain) == value {
			return true
		}
	}
	return false
}

func validateContractRows(rows []contractRow) error {
	if len(rows) != len(canonicalAppOperationContract) {
		return fmt.Errorf("%w: expected %d rows", ErrContractInvalid, len(canonicalAppOperationContract))
	}
	seenIngress := make(map[Ingress]struct{}, len(rows))
	seenOperation := make(map[Operation]struct{}, len(rows))
	seenID := make(map[string]struct{}, len(rows))
	for index, row := range rows {
		if row.ingress == IngressUnknown || row.operation == OperationUnknown || row.id == "" {
			return fmt.Errorf("%w: row %d is unclassified", ErrContractInvalid, index)
		}
		if _, duplicate := seenIngress[row.ingress]; duplicate {
			return fmt.Errorf("%w: duplicate ingress", ErrContractInvalid)
		}
		if _, duplicate := seenOperation[row.operation]; duplicate {
			return fmt.Errorf("%w: duplicate operation", ErrContractInvalid)
		}
		if _, duplicate := seenID[row.id]; duplicate {
			return fmt.Errorf("%w: duplicate AppOperationId", ErrContractInvalid)
		}
		seenIngress[row.ingress] = struct{}{}
		seenOperation[row.operation] = struct{}{}
		seenID[row.id] = struct{}{}
		switch row.class {
		case AuthorityClassBase:
			if row.domain != "" {
				return fmt.Errorf("%w: Base row has a domain", ErrContractInvalid)
			}
		case AuthorityClassAppAccess:
			if row.domain == "" {
				return fmt.Errorf("%w: AppAccess row has no domain", ErrContractInvalid)
			}
		default:
			return fmt.Errorf("%w: row has no explicit classification", ErrContractInvalid)
		}
	}
	return nil
}
