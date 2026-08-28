package memoryv1

import (
	"context"
	"testing"
)

func TestStatusSummaryAndPendingRecoveryDoNotMaterializeCompletedHistory(t *testing.T) {
	core := openTestCore(t, t.TempDir())
	ctx := context.Background()
	bank := ensureTestBank(t, core, "binding-bounded-status")
	rememberText(t, core, bank, 1, "I prefer jasmine tea")

	pending := testCommit(bank, 2, "event-pending", "operation-pending", "I prefer mountain hikes")
	if _, err := core.ReceiveCommittedEvent(ctx, pending); err != nil {
		t.Fatal(err)
	}
	terminal := testCommit(bank, 3, "event-terminal-pending", "operation-terminal-pending", "I prefer quiet mornings")
	if _, err := core.ReceiveCommittedEvent(ctx, terminal); err != nil {
		t.Fatal(err)
	}
	if _, err := core.CommitDecision(ctx, terminal.OperationID, MutationPlan{Outcome: OutcomeNoEffect}); err != nil {
		t.Fatal(err)
	}

	summary, err := core.InspectStatusSummary(ctx, bank.BindingRef, bank.BankRef)
	if err != nil || len(summary.Events) != 0 || summary.Frontiers.Ready != 1 || summary.Current != 1 {
		t.Fatalf("status summary materialized event history or lost counts: status=%+v err=%v", summary, err)
	}
	events, err := core.ListPendingEvents(ctx, bank.BindingRef, bank.BankRef)
	if err != nil || len(events) != 2 || events[0].OperationID != pending.OperationID || events[1].OperationID != terminal.OperationID {
		t.Fatalf("pending recovery query was not bounded to incomplete work: events=%+v err=%v", events, err)
	}
	full, err := core.InspectStatus(ctx, bank.BindingRef, bank.BankRef)
	if err != nil || len(full.Events) != 3 {
		t.Fatalf("explicit full owner status changed semantics: status=%+v err=%v", full, err)
	}
}
