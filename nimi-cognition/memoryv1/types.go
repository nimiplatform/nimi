// Package memoryv1 owns the unregistered Cognition V1 LocalAgent Memory core.
// It is composed directly by owner tests until the single active cutover.
package memoryv1

import (
	"errors"
	"time"
)

const ContractVersion uint32 = 1

type Outcome string

const (
	OutcomeUnsupported   Outcome = "unsupported"
	OutcomeInvalid       Outcome = "invalid"
	OutcomeUnconfigured  Outcome = "unconfigured"
	OutcomePending       Outcome = "pending"
	OutcomeBuilding      Outcome = "building"
	OutcomeUnavailable   Outcome = "unavailable"
	OutcomeFailed        Outcome = "failed"
	OutcomeReceived      Outcome = "received"
	OutcomeProcessing    Outcome = "processing"
	OutcomeNoEffect      Outcome = "no_effect"
	OutcomeRejected      Outcome = "rejected"
	OutcomeAdmitted      Outcome = "admitted"
	OutcomeForgotten     Outcome = "forgotten"
	OutcomeDeleted       Outcome = "deleted"
	OutcomeAlreadyAbsent Outcome = "already_absent"
	OutcomeCommitted     Outcome = "committed"
	OutcomeConflict      Outcome = "conflict"
	OutcomeDuplicate     Outcome = "duplicate"
	OutcomeNoHits        Outcome = "no_hits"
	OutcomeReady         Outcome = "ready"
)

func (o Outcome) TerminalRemember() bool {
	switch o {
	case OutcomeAdmitted, OutcomeRejected, OutcomeNoEffect:
		return true
	default:
		return false
	}
}

type EpistemicStatus string

const (
	EpistemicExplicit     EpistemicStatus = "explicit"
	EpistemicInferred     EpistemicStatus = "inferred"
	EpistemicConsolidated EpistemicStatus = "consolidated"
)

type Lifecycle string

const (
	LifecycleCurrent    Lifecycle = "current"
	LifecycleSuperseded Lifecycle = "superseded"
	LifecycleConflicted Lifecycle = "conflicted"
	LifecycleForgotten  Lifecycle = "forgotten"
)

type EventKind string

const (
	EventKindMessage      EventKind = "message_committed"
	EventKindTurnTerminal EventKind = "turn_terminal"
	EventKindActivity     EventKind = "activity_terminal"
	EventKindCorrection   EventKind = "correction_committed"
	EventKindRelationship EventKind = "relationship_committed"
)

type ActorRole string

const (
	ActorUser      ActorRole = "user"
	ActorAssistant ActorRole = "assistant"
	ActorTool      ActorRole = "tool"
)

type TerminalState string

const (
	TerminalCompleted   TerminalState = "completed"
	TerminalFailed      TerminalState = "failed"
	TerminalInterrupted TerminalState = "interrupted"
	TerminalCanceled    TerminalState = "canceled"
)

type TypedRef struct {
	Kind  string `json:"kind"`
	Value string `json:"value"`
}

type MessagePart struct {
	PartRef       TypedRef `json:"part_ref"`
	Kind          string   `json:"kind"`
	Text          string   `json:"text,omitempty"`
	ArtifactRef   TypedRef `json:"artifact_ref,omitempty"`
	Transcription TypedRef `json:"transcription_ref,omitempty"`
}

type MessageFact struct {
	Actor        ActorRole     `json:"actor"`
	Conversation TypedRef      `json:"conversation"`
	Message      TypedRef      `json:"message"`
	Parts        []MessagePart `json:"parts"`
}

type TurnTerminalFact struct {
	Conversation TypedRef      `json:"conversation"`
	Turn         TypedRef      `json:"turn"`
	State        TerminalState `json:"state"`
}

type ActivityTerminalFact struct {
	Activity       TypedRef      `json:"activity"`
	ActivityKind   string        `json:"activity_kind"`
	State          TerminalState `json:"state"`
	BoundedOutcome string        `json:"bounded_outcome,omitempty"`
}

type CorrectionFact struct {
	TargetMemoryRef  string `json:"target_memory_ref"`
	CorrectedContent string `json:"corrected_content"`
}

type RelationshipFact struct {
	RelationshipKind string `json:"relationship_kind"`
	BoundedFact      string `json:"bounded_fact"`
}

type CommittedFact struct {
	Kind         EventKind             `json:"kind"`
	Message      *MessageFact          `json:"message,omitempty"`
	Turn         *TurnTerminalFact     `json:"turn,omitempty"`
	Activity     *ActivityTerminalFact `json:"activity,omitempty"`
	Correction   *CorrectionFact       `json:"correction,omitempty"`
	Relationship *RelationshipFact     `json:"relationship,omitempty"`
}

type EnsureBankRequest struct {
	ContractVersion uint32
	BindingRef      string
	OperationID     string
}

type EnsureBankResult struct {
	Outcome      Outcome
	BindingRef   string
	BankRef      string
	LifecycleRef string
}

type CommitRequest struct {
	ContractVersion  uint32
	BindingRef       string
	BankRef          string
	EventRef         string
	DeliverySequence uint64
	OperationID      string
	LifecycleRef     string
	Subjects         []TypedRef
	Sources          []TypedRef
	CommittedAt      time.Time
	Fact             CommittedFact
}

type CommitResult struct {
	Outcome          Outcome
	BankRef          string
	EventRef         string
	OperationID      string
	DeliverySequence uint64
	ReceivedFrontier uint64
}

type MutationKind string

const (
	MutationRemember   MutationKind = "remember"
	MutationCorrection MutationKind = "correction"
	MutationConflict   MutationKind = "conflict"
)

// MemoryMutation is an algorithm plan item. It is never active until Core
// validates it and commits the terminal decision and complete effect.
type MemoryMutation struct {
	Kind              MutationKind
	TargetMemoryRef   string
	Content           string
	EpistemicStatus   EpistemicStatus
	OccurredAt        time.Time
	SourceExplanation string
}

type MutationPlan struct {
	Outcome   Outcome
	Mutations []MemoryMutation
}

type DecisionResult struct {
	Outcome            Outcome
	OperationID        string
	AffectedMemoryRefs []string
}

type Memory struct {
	MemoryRef         string
	BankRef           string
	Content           string
	EpistemicStatus   EpistemicStatus
	Lifecycle         Lifecycle
	OccurredAt        time.Time
	UpdatedAt         time.Time
	SourceExplanation string
	EventRef          string
	Subjects          []TypedRef
	Sources           []TypedRef
}

type Frontiers struct {
	Received uint64
	Ready    uint64
}

type EventStatus struct {
	EventRef          string
	OperationID       string
	DeliverySequence  uint64
	Outcome           Outcome
	PayloadPresent    bool
	CompletionPending bool
}

type Status struct {
	BankRef    string
	Frontiers  Frontiers
	Events     []EventStatus
	Current    int
	Superseded int
	Forgotten  int
}

type CutoffRequest struct {
	ContractVersion       uint32
	BindingRef            string
	BankRef               string
	OperationID           string
	CurrentLifecycleRef   string
	NewLifecycleRef       string
	ReplacementBindingRef string
	DeleteAll             bool
}

type CutoffResult struct {
	Outcome               Outcome
	LifecycleRef          string
	ReplacementBindingRef string
}

type DeleteReason string

const (
	DeleteReasonAgentTermination   DeleteReason = "agent_termination"
	DeleteReasonAccountTermination DeleteReason = "account_termination"
)

type DeleteBankRequest struct {
	OperationID  string
	BindingRef   string
	BankRef      string
	LifecycleRef string
	Reason       DeleteReason
}

type DeleteBankResult struct {
	Outcome Outcome
	BankRef string
}

type ContractError struct {
	Outcome Outcome
	Code    string
}

func (e *ContractError) Error() string {
	if e == nil {
		return "memory contract error"
	}
	return "memory contract: " + e.Code
}

func IsOutcome(err error, outcome Outcome) bool {
	var contractErr *ContractError
	return errors.As(err, &contractErr) && contractErr.Outcome == outcome
}

func contractError(outcome Outcome, code string) error {
	return &ContractError{Outcome: outcome, Code: code}
}
