package memoryv1

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"
)

func TestCoreEnsureBankIsDurableIdempotentAndAgentPrivate(t *testing.T) {
	core := openTestCore(t, t.TempDir())
	ctx := context.Background()
	first, err := core.EnsureBank(ctx, EnsureBankRequest{ContractVersion: ContractVersion, BindingRef: "binding-agent-a", OperationID: "ensure-a-1"})
	if err != nil {
		t.Fatalf("ensure first bank: %v", err)
	}
	retry, err := core.EnsureBank(ctx, EnsureBankRequest{ContractVersion: ContractVersion, BindingRef: "binding-agent-a", OperationID: "ensure-a-1"})
	if err != nil {
		t.Fatalf("retry ensure: %v", err)
	}
	if retry != first {
		t.Fatalf("retry returned a different bank: first=%+v retry=%+v", first, retry)
	}
	secondOperation, err := core.EnsureBank(ctx, EnsureBankRequest{ContractVersion: ContractVersion, BindingRef: "binding-agent-a", OperationID: "ensure-a-2"})
	if err != nil {
		t.Fatalf("ensure same binding with a new retry operation: %v", err)
	}
	if secondOperation.BankRef != first.BankRef || secondOperation.LifecycleRef != first.LifecycleRef {
		t.Fatalf("same binding created a different bank: first=%+v second=%+v", first, secondOperation)
	}
	if _, err := core.EnsureBank(ctx, EnsureBankRequest{ContractVersion: ContractVersion, BindingRef: "binding-agent-b", OperationID: "ensure-a-1"}); !IsOutcome(err, OutcomeConflict) {
		t.Fatalf("same operation with another binding must conflict, got %v", err)
	}
	agentB, err := core.EnsureBank(ctx, EnsureBankRequest{ContractVersion: ContractVersion, BindingRef: "binding-agent-b", OperationID: "ensure-b-1"})
	if err != nil {
		t.Fatalf("ensure second agent: %v", err)
	}
	if agentB.BankRef == first.BankRef || agentB.LifecycleRef == first.LifecycleRef {
		t.Fatal("two Agent bindings shared opaque owner identities")
	}
}

func TestCoreConcurrentEnsureReturnsOneLogicalBank(t *testing.T) {
	core := openTestCore(t, t.TempDir())
	ctx := context.Background()
	const attempts = 8
	results := make(chan EnsureBankResult, attempts)
	errorsOut := make(chan error, attempts)
	var group sync.WaitGroup
	for index := 0; index < attempts; index++ {
		group.Add(1)
		go func(index int) {
			defer group.Done()
			result, err := core.EnsureBank(ctx, EnsureBankRequest{ContractVersion: ContractVersion, BindingRef: "binding-concurrent", OperationID: fmt.Sprintf("ensure-concurrent-%d", index)})
			if err != nil {
				errorsOut <- err
				return
			}
			results <- result
		}(index)
	}
	group.Wait()
	close(results)
	close(errorsOut)
	for err := range errorsOut {
		t.Fatalf("concurrent ensure failed: %v", err)
	}
	var bankRef string
	for result := range results {
		if bankRef == "" {
			bankRef = result.BankRef
		}
		if result.BankRef != bankRef {
			t.Fatalf("concurrent ensure created multiple banks: %s and %s", bankRef, result.BankRef)
		}
	}
}

func TestCoreCustodyConflictsAndFrontiersAreTruthful(t *testing.T) {
	core := openTestCore(t, t.TempDir())
	ctx := context.Background()
	bank := ensureTestBank(t, core, "binding-a")
	second := testCommit(bank, 2, "event-2", "commit-2", "second durable preference")
	if result, err := core.ReceiveCommittedEvent(ctx, second); !IsOutcome(err, OutcomeInvalid) || result.Outcome != OutcomeInvalid {
		t.Fatalf("gap must have no custody, result=%+v err=%v", result, err)
	}
	first := testCommit(bank, 1, "event-1", "commit-1", "first durable preference")
	received, err := core.ReceiveCommittedEvent(ctx, first)
	if err != nil || received.Outcome != OutcomeReceived || received.ReceivedFrontier != 1 {
		t.Fatalf("receive first event: result=%+v err=%v", received, err)
	}
	retry, err := core.ReceiveCommittedEvent(ctx, first)
	if err != nil || retry != received {
		t.Fatalf("same operation retry changed receipt: result=%+v err=%v", retry, err)
	}
	conflictingSequence := testCommit(bank, 1, "event-other", "commit-other", "other")
	if result, err := core.ReceiveCommittedEvent(ctx, conflictingSequence); !IsOutcome(err, OutcomeConflict) || result.Outcome != OutcomeConflict {
		t.Fatalf("sequence alias must conflict, result=%+v err=%v", result, err)
	}
	duplicateEvent := testCommit(bank, 2, "event-1", "commit-new", "first durable preference")
	if result, err := core.ReceiveCommittedEvent(ctx, duplicateEvent); !IsOutcome(err, OutcomeDuplicate) || result.Outcome != OutcomeDuplicate {
		t.Fatalf("same event with new operation must be duplicate, result=%+v err=%v", result, err)
	}
	receivedSecond, err := core.ReceiveCommittedEvent(ctx, second)
	if err != nil || receivedSecond.ReceivedFrontier != 2 {
		t.Fatalf("receive second event: result=%+v err=%v", receivedSecond, err)
	}
	status, err := core.InspectStatus(ctx, bank.BindingRef, bank.BankRef)
	if err != nil {
		t.Fatalf("inspect status: %v", err)
	}
	if status.Frontiers.Received != 2 || status.Frontiers.Ready != 0 || len(status.Events) != 2 {
		t.Fatalf("unexpected frontiers after custody: %+v", status)
	}
}

func TestCoreAtomicDecisionCompactionCorrectionAndReopen(t *testing.T) {
	root := t.TempDir()
	core := openTestCore(t, root)
	ctx := context.Background()
	bank := ensureTestBank(t, core, "binding-a")
	first := testCommit(bank, 1, "event-1", "commit-1", "I prefer tea")
	if _, err := core.ReceiveCommittedEvent(ctx, first); err != nil {
		t.Fatalf("receive first: %v", err)
	}
	if _, err := core.MarkProcessing(ctx, first.OperationID); err != nil {
		t.Fatalf("mark first processing: %v", err)
	}
	firstDecision, err := core.CommitDecision(ctx, first.OperationID, MutationPlan{Outcome: OutcomeAdmitted, Mutations: []MemoryMutation{{Kind: MutationRemember, Content: "The user prefers tea", EpistemicStatus: EpistemicExplicit, SourceExplanation: "Committed user message"}}})
	if err != nil || len(firstDecision.AffectedMemoryRefs) != 1 {
		t.Fatalf("commit first decision: result=%+v err=%v", firstDecision, err)
	}
	statusBeforeCompaction, err := core.InspectStatus(ctx, bank.BindingRef, bank.BankRef)
	if err != nil || !statusBeforeCompaction.Events[0].PayloadPresent || statusBeforeCompaction.Frontiers.Ready != 0 {
		t.Fatalf("decision must precede compaction/frontier projection: status=%+v err=%v", statusBeforeCompaction, err)
	}
	if err := core.FinalizeTerminal(ctx, first.OperationID); err != nil {
		t.Fatalf("finalize first: %v", err)
	}
	if retryReceipt, err := core.ReceiveCommittedEvent(ctx, first); err != nil || retryReceipt.Outcome != OutcomeReceived {
		t.Fatalf("terminal custody retry did not preserve received acknowledgement: result=%+v err=%v", retryReceipt, err)
	}

	correction := testCorrectionCommit(bank, 2, "event-2", "commit-2", firstDecision.AffectedMemoryRefs[0], "The user prefers coffee")
	if _, err := core.ReceiveCommittedEvent(ctx, correction); err != nil {
		t.Fatalf("receive correction: %v", err)
	}
	correctionDecision, err := core.CommitDecision(ctx, correction.OperationID, MutationPlan{Outcome: OutcomeAdmitted, Mutations: []MemoryMutation{{Kind: MutationCorrection, TargetMemoryRef: firstDecision.AffectedMemoryRefs[0], Content: "The user prefers coffee", EpistemicStatus: EpistemicExplicit, SourceExplanation: "Committed correction event"}}})
	if err != nil || len(correctionDecision.AffectedMemoryRefs) != 1 {
		t.Fatalf("commit correction: result=%+v err=%v", correctionDecision, err)
	}
	if err := core.FinalizeTerminal(ctx, correction.OperationID); err != nil {
		t.Fatalf("finalize correction: %v", err)
	}
	memories, err := core.ListMemories(ctx, bank.BankRef, true)
	if err != nil {
		t.Fatalf("list corrected memories: %v", err)
	}
	if len(memories) != 2 || countLifecycle(memories, LifecycleCurrent) != 1 || countLifecycle(memories, LifecycleSuperseded) != 1 {
		t.Fatalf("correction did not preserve one current and one superseded Memory: %+v", memories)
	}
	if err := core.Close(); err != nil {
		t.Fatalf("close core: %v", err)
	}
	reopened := openTestCore(t, root)
	memories, err = reopened.ListMemories(ctx, bank.BankRef, true)
	if err != nil || len(memories) != 2 || countLifecycle(memories, LifecycleCurrent) != 1 {
		t.Fatalf("reopen lost canonical lifecycle: memories=%+v err=%v", memories, err)
	}
	status, err := reopened.InspectStatus(ctx, bank.BindingRef, bank.BankRef)
	if err != nil || status.Frontiers.Received != 2 || status.Frontiers.Ready != 2 || status.Events[0].PayloadPresent || status.Events[1].PayloadPresent {
		t.Fatalf("reopen restored invalid custody state: status=%+v err=%v", status, err)
	}
}

func TestCoreCutoffMakesPendingWorkNonEffectingAndDeleteAllStaysEmpty(t *testing.T) {
	core := openTestCore(t, t.TempDir())
	ctx := context.Background()
	bank := ensureTestBank(t, core, "binding-a")
	first := testCommit(bank, 1, "event-1", "commit-1", "pending preference")
	if _, err := core.ReceiveCommittedEvent(ctx, first); err != nil {
		t.Fatalf("receive pre-cut event: %v", err)
	}
	newCutoff := "cutoff-after-disable"
	cutoff, err := core.ApplyCutoff(ctx, CutoffRequest{ContractVersion: ContractVersion, BindingRef: bank.BindingRef, BankRef: bank.BankRef, OperationID: "cutoff-op-1", CurrentLifecycleRef: bank.LifecycleRef, NewLifecycleRef: newCutoff, ReplacementBindingRef: "binding-a-after-disable"})
	if err != nil || cutoff.Outcome != OutcomeCommitted {
		t.Fatalf("apply cutoff: result=%+v err=%v", cutoff, err)
	}
	late, err := core.CommitDecision(ctx, first.OperationID, MutationPlan{Outcome: OutcomeAdmitted, Mutations: []MemoryMutation{{Kind: MutationRemember, Content: "must not appear", EpistemicStatus: EpistemicExplicit, SourceExplanation: "late result"}}})
	if err != nil || late.Outcome != OutcomeNoEffect || len(late.AffectedMemoryRefs) != 0 {
		t.Fatalf("late result regained effect: result=%+v err=%v", late, err)
	}
	memories, err := core.ListMemories(ctx, bank.BankRef, true)
	if err != nil || len(memories) != 0 {
		t.Fatalf("cutoff created Memory: memories=%+v err=%v", memories, err)
	}
	postCut := testCommit(EnsureBankResult{BindingRef: cutoff.ReplacementBindingRef, BankRef: bank.BankRef, LifecycleRef: newCutoff}, 1, "event-2", "commit-2", "post-cut preference")
	if _, err := core.ReceiveCommittedEvent(ctx, postCut); err != nil {
		t.Fatalf("receive post-cut event: %v", err)
	}
	decision, err := core.CommitDecision(ctx, postCut.OperationID, MutationPlan{Outcome: OutcomeAdmitted, Mutations: []MemoryMutation{{Kind: MutationRemember, Content: "post-cut preference", EpistemicStatus: EpistemicExplicit, SourceExplanation: "post-cut user event"}}})
	if err != nil || len(decision.AffectedMemoryRefs) != 1 {
		t.Fatalf("commit post-cut event: result=%+v err=%v", decision, err)
	}
	deleteCutoff := "cutoff-after-delete-all"
	if _, err := core.ApplyCutoff(ctx, CutoffRequest{ContractVersion: ContractVersion, BindingRef: cutoff.ReplacementBindingRef, BankRef: bank.BankRef, OperationID: "cutoff-op-2", CurrentLifecycleRef: newCutoff, NewLifecycleRef: deleteCutoff, ReplacementBindingRef: "binding-a-after-delete", DeleteAll: true}); err != nil {
		t.Fatalf("delete all cutoff: %v", err)
	}
	memories, err = core.ListMemories(ctx, bank.BankRef, true)
	if err != nil || len(memories) != 0 {
		t.Fatalf("delete all did not leave empty bank: memories=%+v err=%v", memories, err)
	}
	retry, err := core.ReceiveCommittedEvent(ctx, postCut)
	if err != nil || retry.Outcome != OutcomeReceived {
		t.Fatalf("terminal custody retry must preserve its received acknowledgement: result=%+v err=%v", retry, err)
	}
	memories, err = core.ListMemories(ctx, bank.BankRef, true)
	if err != nil || len(memories) != 0 {
		t.Fatalf("terminal retry rebuilt deleted Memory: memories=%+v err=%v", memories, err)
	}
}

func TestCoreRejectsForbiddenAndEpistemicallyOverstatedPlan(t *testing.T) {
	core := openTestCore(t, t.TempDir())
	ctx := context.Background()
	bank := ensureTestBank(t, core, "binding-a")
	request := testCommit(bank, 1, "event-1", "commit-1", "The assistant guessed a preference")
	request.Fact.Message.Actor = ActorAssistant
	if _, err := core.ReceiveCommittedEvent(ctx, request); err != nil {
		t.Fatalf("receive assistant event: %v", err)
	}
	if _, err := core.CommitDecision(ctx, request.OperationID, MutationPlan{Outcome: OutcomeAdmitted, Mutations: []MemoryMutation{{Kind: MutationRemember, Content: "The user explicitly prefers tea", EpistemicStatus: EpistemicExplicit, SourceExplanation: "assistant assertion"}}}); !IsOutcome(err, OutcomeRejected) {
		t.Fatalf("assistant assertion was promoted as explicit: %v", err)
	}
	if _, err := core.CommitDecision(ctx, request.OperationID, MutationPlan{Outcome: OutcomeAdmitted, Mutations: []MemoryMutation{{Kind: MutationRemember, Content: "The password is secret-value", EpistemicStatus: EpistemicInferred, SourceExplanation: "assistant assertion"}}}); !IsOutcome(err, OutcomeRejected) {
		t.Fatalf("forbidden content was admitted: %v", err)
	}
	decision, err := core.CommitDecision(ctx, request.OperationID, MutationPlan{Outcome: OutcomeRejected})
	if err != nil || decision.Outcome != OutcomeRejected {
		t.Fatalf("safe rejection did not become terminal: result=%+v err=%v", decision, err)
	}
	if err := core.FinalizeTerminal(ctx, request.OperationID); err != nil {
		t.Fatalf("finalize rejection: %v", err)
	}
	status, err := core.InspectStatus(ctx, bank.BindingRef, bank.BankRef)
	if err != nil || status.Events[0].PayloadPresent || status.Current != 0 {
		t.Fatalf("rejected payload retained or Memory created: status=%+v err=%v", status, err)
	}
}

func openTestCore(t *testing.T, root string) *Core {
	t.Helper()
	core, err := Open(root, WithClock(func() time.Time { return time.Date(2026, 8, 27, 12, 0, 0, 0, time.UTC) }))
	if err != nil {
		t.Fatalf("open core: %v", err)
	}
	t.Cleanup(func() { _ = core.Close() })
	return core
}

func ensureTestBank(t *testing.T, core *Core, binding string) EnsureBankResult {
	t.Helper()
	result, err := core.EnsureBank(context.Background(), EnsureBankRequest{ContractVersion: ContractVersion, BindingRef: binding, OperationID: "ensure-" + binding})
	if err != nil {
		t.Fatalf("ensure test bank: %v", err)
	}
	return result
}

func testCommit(bank EnsureBankResult, sequence uint64, eventRef, operationID, text string) CommitRequest {
	return CommitRequest{
		ContractVersion:  ContractVersion,
		BindingRef:       bank.BindingRef,
		BankRef:          bank.BankRef,
		EventRef:         eventRef,
		DeliverySequence: sequence,
		OperationID:      operationID,
		LifecycleRef:     bank.LifecycleRef,
		Subjects:         []TypedRef{{Kind: "account_subject", Value: "subject-opaque"}},
		Sources:          []TypedRef{{Kind: "conversation", Value: "conversation-opaque"}, {Kind: "message", Value: eventRef}},
		CommittedAt:      time.Date(2026, 8, 27, 11, int(sequence), 0, 0, time.UTC),
		Fact:             CommittedFact{Kind: EventKindMessage, Message: &MessageFact{Actor: ActorUser, Conversation: TypedRef{Kind: "conversation", Value: "conversation-opaque"}, Message: TypedRef{Kind: "message", Value: eventRef}, Parts: []MessagePart{{PartRef: TypedRef{Kind: "message_part", Value: eventRef + "-part"}, Kind: "text", Text: text}}}},
	}
}

func testCorrectionCommit(bank EnsureBankResult, sequence uint64, eventRef, operationID, targetMemoryRef, content string) CommitRequest {
	request := testCommit(bank, sequence, eventRef, operationID, content)
	request.Fact = CommittedFact{Kind: EventKindCorrection, Correction: &CorrectionFact{TargetMemoryRef: targetMemoryRef, CorrectedContent: content}}
	return request
}

func countLifecycle(memories []Memory, lifecycle Lifecycle) int {
	count := 0
	for _, memory := range memories {
		if memory.Lifecycle == lifecycle {
			count++
		}
	}
	return count
}
