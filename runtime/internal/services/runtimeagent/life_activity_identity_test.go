package runtimeagent

import (
	"testing"
	"time"
)

func TestRepeatedCompletedRoutineIsASeparateOccurrence(t *testing.T) {
	now := time.Now().UTC()
	l := newAgentLifeState()
	l.Activities["old"] = &lifeActivity{Ref: "old", Title: "Evening walk", Kind: "routine", Phase: lifeCompleted, Progress: 100}
	if err := l.acceptFuture([]lifeFrameProposal{{Title: "Evening walk", Kind: "routine", DurationMinutes: 10, EndProgress: 100, CompletesActivity: true}}, now, 1, nil, false); err != nil {
		t.Fatal(err)
	}
	if l.Future[0].ActivityRef == "old" {
		t.Fatal("completed occurrence was reopened")
	}
}
