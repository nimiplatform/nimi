package memoryv1

import (
	"context"
	"fmt"
	"testing"
	"time"
)

func TestEmptyLifeOutcomeIsNotAdmitted(t *testing.T) {
	for i, change := range []ActivityChange{ActivityChangeProjectCompleted, ActivityChangeDirectionChanged, ActivityChangeProjectCompleted} {
		t.Run(fmt.Sprintf("change-%d", i), func(t *testing.T) {
			ctx := context.Background()
			core := openTestCore(t, t.TempDir())
			bank := ensureTestBank(t, core, fmt.Sprintf("audit-round6-%d", i))
			r := testCommit(bank, 1, "audit-event", "audit-operation", "")
			now := time.Date(2026, 10, 21, 0, 0, 0, 0, time.UTC)
			r.CommittedAt = now
			state := "completed"
			outcome := ""
			if change == ActivityChangeDirectionChanged {
				state = "active"
			}
			if i == 2 {
				outcome = "Completed the actual cloud postcard"
			}
			fact := &ActivityTerminalFact{Activity: TypedRef{Kind: "life_activity", Value: "cloud-postcard"}, ActivityKind: "life_frame", ActivityState: state, ChangeRef: TypedRef{Kind: "life_change", Value: "change-cloud-postcard"}, SelfAction: "create", SelfObject: "Cloud postcard", BoundedOutcome: outcome, Change: change, OccurredStart: now.Add(-time.Hour), OccurredEnd: now}
			r.Fact = CommittedFact{Kind: EventKindActivity, Activity: fact}
			r.Sources = []TypedRef{fact.Activity, fact.ChangeRef}
			if _, err := core.ReceiveCommittedEvent(ctx, r); err != nil {
				t.Fatal(err)
			}
			result, err := core.ExecuteRemember(ctx, r.OperationID)
			if err != nil {
				t.Fatal(err)
			}
			if i < 2 && result.Outcome != OutcomeNoEffect {
				t.Fatalf("empty outcome did not terminate without a Memory effect: %+v", result)
			}
			if i == 2 && result.Outcome != OutcomeAdmitted {
				t.Fatalf("positive control was not admitted: %+v", result)
			}
		})
	}
}
