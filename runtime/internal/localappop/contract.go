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
	IngressUnknown Ingress = iota
	IngressStorageJSONRead
	IngressStorageJSONWrite
	IngressStorageJSONRemove
	IngressAppAIConfigGet
	IngressAppAIConfigOverwrite
	IngressRealmWorldCoreList
	IngressRealmWorldCoreCreate
	IngressTextCandidateGenerate
	IngressAgentReferenceList
	IngressConversationOpen
	IngressConversationTurnSend
	IngressConversationTurnInterrupt
	IngressConversationEventsSubscribe
	IngressConversationSnapshotGet
)

const (
	OperationUnknown Operation = iota
	OperationStorageJSONRead
	OperationStorageJSONWrite
	OperationStorageJSONRemove
	OperationAppAIConfigGet
	OperationAppAIConfigOverwrite
	OperationRealmWorldCoreList
	OperationRealmWorldCoreCreate
	OperationTextCandidateGenerate
	OperationAgentReferenceList
	OperationConversationOpen
	OperationConversationTurnSend
	OperationConversationTurnInterrupt
	OperationConversationEventsSubscribe
	OperationConversationSnapshotGet
)

type contractRow struct {
	ingress   Ingress
	operation Operation
	id        string
	class     AuthorityClass
	domain    Domain
}

// canonicalAppOperationContract is the sole Runtime operation-ID and
// classification map. AppOperationIds intentionally occur nowhere else.
var canonicalAppOperationContract = [...]contractRow{
	{IngressStorageJSONRead, OperationStorageJSONRead, "runtime.app-storage.json.read", AuthorityClassBase, ""},
	{IngressStorageJSONWrite, OperationStorageJSONWrite, "runtime.app-storage.json.write", AuthorityClassBase, ""},
	{IngressStorageJSONRemove, OperationStorageJSONRemove, "runtime.app-storage.json.remove", AuthorityClassBase, ""},
	{IngressAppAIConfigGet, OperationAppAIConfigGet, "runtime.ai.app-config.get", AuthorityClassBase, ""},
	{IngressAppAIConfigOverwrite, OperationAppAIConfigOverwrite, "runtime.ai.app-config.overwrite", AuthorityClassBase, ""},
	{IngressRealmWorldCoreList, OperationRealmWorldCoreList, "realm.world-core.list", AuthorityClassAppAccess, "realm.data"},
	{IngressRealmWorldCoreCreate, OperationRealmWorldCoreCreate, "realm.world-core.create", AuthorityClassAppAccess, "realm.data"},
	{IngressTextCandidateGenerate, OperationTextCandidateGenerate, AppOperationIDTextCandidateGenerate, AuthorityClassAppAccess, "runtime.consume"},
	{IngressAgentReferenceList, OperationAgentReferenceList, "runtime.agent.reference.list", AuthorityClassAppAccess, "agent.local"},
	{IngressConversationOpen, OperationConversationOpen, "runtime.agent.conversation.open", AuthorityClassAppAccess, "agent.local"},
	{IngressConversationTurnSend, OperationConversationTurnSend, "runtime.agent.conversation.turn.send", AuthorityClassAppAccess, "agent.local"},
	{IngressConversationTurnInterrupt, OperationConversationTurnInterrupt, "runtime.agent.conversation.turn.interrupt", AuthorityClassAppAccess, "agent.local"},
	{IngressConversationEventsSubscribe, OperationConversationEventsSubscribe, "runtime.agent.conversation.events.subscribe", AuthorityClassAppAccess, "agent.local"},
	{IngressConversationSnapshotGet, OperationConversationSnapshotGet, "runtime.agent.conversation.snapshot.get", AuthorityClassAppAccess, "agent.local"},
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
		return fmt.Errorf("%w: expected fourteen rows", ErrContractInvalid)
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
