package cognitionmemory

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

type CognitionOwner interface {
	EnsureBank(context.Context, memoryv1.EnsureBankRequest) (memoryv1.EnsureBankResult, error)
	ReceiveCommittedEvent(context.Context, memoryv1.CommitRequest) (memoryv1.CommitResult, error)
}

type DrainAuthorizer func(context.Context, Binding) error

type Bridge struct {
	store     *Store
	owner     CognitionOwner
	authorize DrainAuthorizer
}

type DrainResult struct {
	Drained          bool
	BindingRef       string
	EventRef         string
	OperationID      string
	DeliverySequence uint64
	Outcome          memoryv1.Outcome
}

func NewBridge(store *Store, owner CognitionOwner, authorize DrainAuthorizer) *Bridge {
	return &Bridge{store: store, owner: owner, authorize: authorize}
}

// @nimi-authority: rule.nimi.cognition.runtime-bridge.r005
// @nimi-authority: rule.nimi.cognition.runtime-bridge.r019
func (b *Bridge) DrainOne(ctx context.Context, localAgentRef string) (DrainResult, error) {
	if b == nil || b.store == nil || b.owner == nil || b.authorize == nil {
		return DrainResult{Outcome: memoryv1.OutcomeUnavailable}, fmt.Errorf("drain cognition memory outbox: bridge unavailable")
	}
	binding, err := b.store.BindingForAgent(ctx, localAgentRef)
	if err != nil {
		return DrainResult{Outcome: memoryv1.OutcomeUnavailable}, fmt.Errorf("drain cognition memory outbox: load binding: %w", err)
	}
	if !binding.Enabled || binding.AdoptionRequired {
		return DrainResult{BindingRef: binding.BindingRef, Outcome: memoryv1.OutcomeNoEffect}, ErrMemoryDisabled
	}
	if err := b.authorize(ctx, binding); err != nil {
		return DrainResult{BindingRef: binding.BindingRef, Outcome: memoryv1.OutcomeInvalid}, fmt.Errorf("drain cognition memory outbox: authorize current lifecycle: %w", err)
	}
	if binding.BankRef == "" || binding.LifecycleRef == "" {
		ensured, err := b.owner.EnsureBank(ctx, memoryv1.EnsureBankRequest{ContractVersion: memoryv1.ContractVersion, BindingRef: binding.BindingRef, OperationID: binding.BindingOperationID})
		if err != nil {
			return DrainResult{BindingRef: binding.BindingRef, Outcome: errorOutcome(err)}, fmt.Errorf("drain cognition memory outbox: ensure bank: %w", err)
		}
		if ensured.Outcome != memoryv1.OutcomeCommitted || ensured.BindingRef != binding.BindingRef || ensured.BankRef == "" || ensured.LifecycleRef == "" {
			return DrainResult{BindingRef: binding.BindingRef, Outcome: ensured.Outcome}, fmt.Errorf("drain cognition memory outbox: invalid ensure owner result")
		}
		if err := b.store.BindEnsuredBank(ctx, binding.BindingRef, ensured.BankRef, ensured.LifecycleRef); err != nil {
			return DrainResult{BindingRef: binding.BindingRef, Outcome: memoryv1.OutcomeUnavailable}, err
		}
		binding.BankRef = ensured.BankRef
		binding.LifecycleRef = ensured.LifecycleRef
	}
	item, err := b.store.NextPending(ctx, binding.BindingRef)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return DrainResult{BindingRef: binding.BindingRef}, nil
		}
		return DrainResult{BindingRef: binding.BindingRef, Outcome: memoryv1.OutcomeUnavailable}, err
	}
	request, err := memoryCommitRequest(item)
	if err != nil {
		return DrainResult{BindingRef: binding.BindingRef, EventRef: item.EventRef, OperationID: item.OperationID, DeliverySequence: item.DeliverySequence, Outcome: memoryv1.OutcomeInvalid}, err
	}
	received, err := b.owner.ReceiveCommittedEvent(ctx, request)
	if err != nil {
		return DrainResult{BindingRef: binding.BindingRef, EventRef: item.EventRef, OperationID: item.OperationID, DeliverySequence: item.DeliverySequence, Outcome: errorOutcome(err)}, fmt.Errorf("drain cognition memory outbox: transfer custody: %w", err)
	}
	if received.Outcome != memoryv1.OutcomeReceived || received.EventRef != item.EventRef || received.OperationID != item.OperationID || received.DeliverySequence != item.DeliverySequence {
		return DrainResult{BindingRef: binding.BindingRef, EventRef: item.EventRef, OperationID: item.OperationID, DeliverySequence: item.DeliverySequence, Outcome: received.Outcome}, fmt.Errorf("drain cognition memory outbox: invalid custody owner result")
	}
	response := &runtimev1.CognitionMemoryCommitResponse{
		Outcome:          runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_RECEIVED,
		Bank:             &runtimev1.CognitionMemoryBankRef{Value: received.BankRef},
		Event:            &runtimev1.CognitionMemoryEventRef{Value: received.EventRef},
		Operation:        &runtimev1.CognitionMemoryOperationRef{Value: received.OperationID},
		DeliverySequence: received.DeliverySequence,
		ReceivedFrontier: received.ReceivedFrontier,
	}
	if err := b.store.AcknowledgeReceived(ctx, response); err != nil {
		return DrainResult{BindingRef: binding.BindingRef, EventRef: item.EventRef, OperationID: item.OperationID, DeliverySequence: item.DeliverySequence, Outcome: memoryv1.OutcomeUnavailable}, fmt.Errorf("drain cognition memory outbox: persist custody acknowledgement: %w", err)
	}
	return DrainResult{Drained: true, BindingRef: binding.BindingRef, EventRef: item.EventRef, OperationID: item.OperationID, DeliverySequence: item.DeliverySequence, Outcome: received.Outcome}, nil
}

func (b *Bridge) ReplayStartup(ctx context.Context) error {
	bindings, err := b.store.ActiveBindings(ctx)
	if err != nil {
		return fmt.Errorf("replay cognition memory startup: list bindings: %w", err)
	}
	for _, binding := range bindings {
		if !binding.Enabled || binding.AdoptionRequired {
			continue
		}
		for {
			result, err := b.DrainOne(ctx, binding.LocalAgentRef)
			if err != nil {
				return err
			}
			if !result.Drained {
				break
			}
		}
	}
	return nil
}

func memoryCommitRequest(item OutboxItem) (memoryv1.CommitRequest, error) {
	envelope := item.Envelope
	if envelope == nil || !validRef(item.BankRef) || !validRef(item.LifecycleRef) {
		return memoryv1.CommitRequest{}, fmt.Errorf("map cognition memory envelope: owner binding unresolved")
	}
	request := memoryv1.CommitRequest{
		ContractVersion:  memoryv1.ContractVersion,
		BindingRef:       item.BindingRef,
		BankRef:          item.BankRef,
		EventRef:         item.EventRef,
		DeliverySequence: item.DeliverySequence,
		OperationID:      item.OperationID,
		LifecycleRef:     item.LifecycleRef,
		CommittedAt:      envelope.GetCommittedAt().AsTime(),
	}
	for _, ref := range envelope.GetSubjects() {
		request.Subjects = append(request.Subjects, memoryv1.TypedRef{Kind: ref.GetKind(), Value: ref.GetValue()})
	}
	for _, ref := range envelope.GetSources() {
		request.Sources = append(request.Sources, memoryv1.TypedRef{Kind: ref.GetKind(), Value: ref.GetValue()})
	}
	switch {
	case envelope.GetMessageCommitted() != nil:
		message := envelope.GetMessageCommitted()
		fact := &memoryv1.MessageFact{Actor: memoryActorRole(message.GetActor()), Conversation: typedRef(message.GetConversation()), Message: typedRef(message.GetMessage())}
		for _, part := range message.GetParts() {
			mapped := memoryv1.MessagePart{PartRef: typedRef(part.GetPart())}
			switch {
			case part.GetText() != nil:
				mapped.Kind, mapped.Text = "text", part.GetText().GetText()
			case part.GetTranscription() != nil:
				mapped.Kind, mapped.Text, mapped.Transcription = "transcription", part.GetTranscription().GetText(), typedRef(part.GetTranscription().GetTranscription())
			case part.GetArtifact() != nil:
				mapped.Kind, mapped.ArtifactRef = "artifact", typedRef(part.GetArtifact().GetArtifact())
			default:
				return memoryv1.CommitRequest{}, fmt.Errorf("map cognition memory envelope: unsupported message part")
			}
			fact.Parts = append(fact.Parts, mapped)
		}
		request.Fact = memoryv1.CommittedFact{Kind: memoryv1.EventKindMessage, Message: fact}
	case envelope.GetTurnTerminal() != nil:
		fact := envelope.GetTurnTerminal()
		request.Fact = memoryv1.CommittedFact{Kind: memoryv1.EventKindTurnTerminal, Turn: &memoryv1.TurnTerminalFact{Conversation: typedRef(fact.GetConversation()), Turn: typedRef(fact.GetTurn()), State: terminalState(fact.GetState())}}
	case envelope.GetActivityTerminal() != nil:
		fact := envelope.GetActivityTerminal()
		request.Fact = memoryv1.CommittedFact{Kind: memoryv1.EventKindActivity, Activity: &memoryv1.ActivityTerminalFact{Activity: typedRef(fact.GetActivity()), ActivityKind: fact.GetActivityKind(), State: terminalState(fact.GetState()), BoundedOutcome: fact.GetBoundedOutcome()}}
	case envelope.GetCorrectionCommitted() != nil:
		fact := envelope.GetCorrectionCommitted()
		request.Fact = memoryv1.CommittedFact{Kind: memoryv1.EventKindCorrection, Correction: &memoryv1.CorrectionFact{TargetMemoryRef: fact.GetTargetMemory().GetValue(), CorrectedContent: fact.GetCorrectedContent()}}
	case envelope.GetRelationshipCommitted() != nil:
		fact := envelope.GetRelationshipCommitted()
		request.Fact = memoryv1.CommittedFact{Kind: memoryv1.EventKindRelationship, Relationship: &memoryv1.RelationshipFact{RelationshipKind: fact.GetRelationshipKind(), BoundedFact: fact.GetBoundedFact()}}
	default:
		return memoryv1.CommitRequest{}, fmt.Errorf("map cognition memory envelope: unsupported event fact")
	}
	return request, nil
}

func typedRef(ref *runtimev1.CognitionMemorySourceRef) memoryv1.TypedRef {
	if ref == nil {
		return memoryv1.TypedRef{}
	}
	return memoryv1.TypedRef{Kind: ref.GetKind(), Value: ref.GetValue()}
}

func memoryActorRole(role runtimev1.CognitionMemoryActorRole) memoryv1.ActorRole {
	switch role {
	case runtimev1.CognitionMemoryActorRole_COGNITION_MEMORY_ACTOR_ROLE_USER:
		return memoryv1.ActorUser
	case runtimev1.CognitionMemoryActorRole_COGNITION_MEMORY_ACTOR_ROLE_ASSISTANT:
		return memoryv1.ActorAssistant
	case runtimev1.CognitionMemoryActorRole_COGNITION_MEMORY_ACTOR_ROLE_TOOL:
		return memoryv1.ActorTool
	default:
		return ""
	}
}

func terminalState(state runtimev1.CognitionMemoryTerminalState) memoryv1.TerminalState {
	switch state {
	case runtimev1.CognitionMemoryTerminalState_COGNITION_MEMORY_TERMINAL_STATE_COMPLETED:
		return memoryv1.TerminalCompleted
	case runtimev1.CognitionMemoryTerminalState_COGNITION_MEMORY_TERMINAL_STATE_FAILED:
		return memoryv1.TerminalFailed
	case runtimev1.CognitionMemoryTerminalState_COGNITION_MEMORY_TERMINAL_STATE_INTERRUPTED:
		return memoryv1.TerminalInterrupted
	case runtimev1.CognitionMemoryTerminalState_COGNITION_MEMORY_TERMINAL_STATE_CANCELED:
		return memoryv1.TerminalCanceled
	default:
		return ""
	}
}

func errorOutcome(err error) memoryv1.Outcome {
	for _, outcome := range []memoryv1.Outcome{memoryv1.OutcomeUnsupported, memoryv1.OutcomeInvalid, memoryv1.OutcomeConflict, memoryv1.OutcomeDuplicate, memoryv1.OutcomeUnavailable, memoryv1.OutcomeRejected} {
		if memoryv1.IsOutcome(err, outcome) {
			return outcome
		}
	}
	return memoryv1.OutcomeFailed
}
