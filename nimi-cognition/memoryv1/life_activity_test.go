package memoryv1

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"
)

func TestLifeActivityAdmissionOccurrenceAndStableResult(t *testing.T) {
	core := openTestCore(t, t.TempDir())
	ctx := context.Background()
	bank := ensureTestBank(t, core, "binding-life")
	start := time.Date(2026, 10, 14, 9, 0, 0, 0, time.UTC)
	end := start.Add(time.Hour)
	recorded := start.Add(4 * 24 * time.Hour)
	for index, change := range []ActivityChange{ActivityChangeRoutine, ActivityChangeProgress, ActivityChangeProjectCompleted, ActivityChangeProjectCompleted} {
		request := testCommit(bank, uint64(index+1), fmt.Sprintf("life-event-%d", index), fmt.Sprintf("life-op-%d", index), "unused")
		request.CommittedAt = recorded
		activity := TypedRef{Kind: "life_activity", Value: "painting-one"}
		changeRef := TypedRef{Kind: "life_change", Value: fmt.Sprintf("change-%d", min(index, 2))}
		request.Sources = []TypedRef{activity, changeRef}
		outcome := "Completed the landscape painting"
		if index == 3 {
			outcome = "The landscape project is now finished"
		}
		request.Fact = CommittedFact{Kind: EventKindActivity, Activity: &ActivityTerminalFact{
			Activity: activity, ActivityKind: "life_frame", ActivityState: "completed", ChangeRef: changeRef, SelfAction: "create", SelfObject: "Landscape painting",
			BoundedOutcome: outcome, Change: change, OccurredStart: start, OccurredEnd: end, Retrospective: true,
		}}
		if _, err := core.ReceiveCommittedEvent(ctx, request); err != nil {
			t.Fatal(err)
		}
		result, err := core.ExecuteRemember(ctx, request.OperationID)
		want := OutcomeNoEffect
		if index == 2 {
			want = OutcomeAdmitted
		}
		if err != nil || result.Outcome != want {
			t.Fatalf("%s: %+v, %v", change, result, err)
		}
	}
	memories, err := core.ListMemories(ctx, bank.BankRef, false)
	if err != nil || len(memories) != 1 {
		t.Fatalf("memories=%+v err=%v", memories, err)
	}
	m := memories[0]
	if !m.OccurredAt.Equal(end) || m.EpistemicStatus != EpistemicInferred || !strings.Contains(m.SourceExplanation, start.Format(time.RFC3339)) || !strings.Contains(m.SourceExplanation, "retrospective=true") {
		t.Fatalf("lost occurrence or epistemic boundary: %+v", m)
	}
}

func TestLifeActivityRejectsInvalidTimeAndCompletion(t *testing.T) {
	now := time.Date(2026, 10, 19, 0, 0, 0, 0, time.UTC)
	for _, scenario := range []string{"missing-start", "backwards", "future", "interrupted-completion", "unknown-change", "missing-source"} {
		t.Run(scenario, func(t *testing.T) {
			request := CommitRequest{ContractVersion: ContractVersion, BindingRef: "binding", BankRef: "bank", EventRef: "event", OperationID: "operation", LifecycleRef: "cut", DeliverySequence: 1, CommittedAt: now, Subjects: []TypedRef{{Kind: "account_subject", Value: "owner"}}}
			fact := &ActivityTerminalFact{Activity: TypedRef{Kind: "life_activity", Value: "activity"}, ActivityKind: "life_frame", ActivityState: "completed", ChangeRef: TypedRef{Kind: "life_change", Value: "change"}, SelfAction: "create", SelfObject: "Painting", Change: ActivityChangeProjectCompleted, BoundedOutcome: "Finished a painting", OccurredStart: now.Add(-time.Hour), OccurredEnd: now}
			request.Sources = []TypedRef{fact.Activity, fact.ChangeRef}
			request.Fact = CommittedFact{Kind: EventKindActivity, Activity: fact}
			switch scenario {
			case "missing-start":
				fact.OccurredStart = time.Time{}
			case "backwards":
				fact.OccurredEnd = fact.OccurredStart.Add(-time.Second)
			case "future":
				fact.OccurredEnd = now.Add(time.Second)
			case "interrupted-completion":
				fact.ActivityState = "paused"
			case "unknown-change":
				fact.Change = "important"
			case "missing-source":
				request.Sources = []TypedRef{{Kind: "conversation", Value: "other"}}
			}
			if err := validateCommitRequest(request); err == nil {
				t.Fatal("invalid activity accepted")
			}
		})
	}
}

func TestLifeChangesRecallThroughFTSAndDoNotReviveAfterForget(t *testing.T) {
	ctx := context.Background()
	core := openTestCore(t, t.TempDir())
	bank := ensureTestBank(t, core, "life-changes")
	now := time.Date(2026, 10, 20, 0, 0, 0, 0, time.UTC)
	var memories []string
	for i, state := range []string{"active", "active", "abandoned"} {
		r := testCommit(bank, uint64(i+1), fmt.Sprintf("change-event-%d", i), fmt.Sprintf("change-op-%d", i), "")
		r.CommittedAt = now.Add(time.Duration(i) * time.Minute)
		change := ActivityChangeDirectionChanged
		if i == 0 {
			change = ActivityChangeKeyResult
		}
		fact := &ActivityTerminalFact{Activity: TypedRef{Kind: "life_activity", Value: "painting"}, ChangeRef: TypedRef{Kind: "life_change", Value: fmt.Sprintf("change-%d", i)}, ActivityKind: "life_frame", ActivityState: state, SelfAction: "create", BoundedOutcome: "Compared three line-weight samples and selected the lightest stroke", SelfObject: []string{"Light study", "Watercolor study", "Watercolor study"}[i], OccurredStart: r.CommittedAt, OccurredEnd: r.CommittedAt, Change: change}
		r.Fact = CommittedFact{Kind: EventKindActivity, Activity: fact}
		r.Sources = []TypedRef{fact.Activity, fact.ChangeRef}
		if _, err := core.ReceiveCommittedEvent(ctx, r); err != nil {
			t.Fatal(err)
		}
		result, err := core.ExecuteRemember(ctx, r.OperationID)
		if err != nil || result.Outcome != OutcomeAdmitted {
			t.Fatalf("nonterminal real change rejected: %+v %v", result, err)
		}
	}
	items, err := core.ListMemories(ctx, bank.BankRef, false)
	if err != nil || len(items) != 3 {
		t.Fatalf("distinct changes collapsed: %+v %v", items, err)
	}
	for _, item := range items {
		memories = append(memories, item.MemoryRef)
	}
	foundOutcome := false
	for _, item := range items {
		if strings.Contains(item.Content, "Compared three line-weight samples") {
			foundOutcome = true
		}
	}
	if !foundOutcome {
		t.Fatal("concrete own result disappeared from admitted Memory")
	}
	req := testRecallRequest(bank, "life-recall", "unrelated topic", 6, CapabilitySnapshot{Available: []Capability{CapabilityFTSIndex}})
	req.IncludeRecentLife = true
	result, err := core.Recall(ctx, req, nil)
	if err != nil || len(result.Hits) != 2 {
		t.Fatalf("recent experiences missing from FTS recall: %+v %v", result, err)
	}
	if _, err := core.ForgetExact(ctx, ForgetRequest{OperationID: "forget-life", BindingRef: bank.BindingRef, BankRef: bank.BankRef, LifecycleRef: bank.LifecycleRef, TargetMemoryRefs: memories, Confirmed: true}); err != nil {
		t.Fatal(err)
	}
	req.OperationID = "life-recall-after-forget"
	result, err = core.Recall(ctx, req, nil)
	if err != nil || len(result.Hits) != 0 {
		t.Fatalf("forgotten experience recalled: %+v %v", result, err)
	}
	r := testCommit(bank, 4, "reworded-event", "reworded-operation", "")
	r.CommittedAt = now.Add(time.Hour)
	fact := &ActivityTerminalFact{Activity: TypedRef{Kind: "life_activity", Value: "painting"}, ChangeRef: TypedRef{Kind: "life_change", Value: "change-2"}, ActivityKind: "life_frame", ActivityState: "abandoned", SelfAction: "create", SelfObject: "Renamed watercolor study", OccurredStart: now, OccurredEnd: now, Change: ActivityChangeDirectionChanged}
	r.Fact = CommittedFact{Kind: EventKindActivity, Activity: fact}
	r.Sources = []TypedRef{fact.Activity, fact.ChangeRef}
	if _, err := core.ReceiveCommittedEvent(ctx, r); err != nil {
		t.Fatal(err)
	}
	again, err := core.ExecuteRemember(ctx, r.OperationID)
	if err != nil || again.Outcome != OutcomeNoEffect {
		t.Fatalf("rewording revived forgotten change: %+v %v", again, err)
	}
}
