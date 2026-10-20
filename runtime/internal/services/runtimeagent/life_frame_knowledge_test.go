package runtimeagent

import (
	"encoding/json"
	"testing"
	"time"
)

func TestRecoveryNeverSettlesMissedScheduleOrSkipsItsProgress(t *testing.T) {
	now := time.Now().UTC()
	l := newAgentLifeState()
	ref := "painting"
	l.Activities[ref] = &lifeActivity{Ref: ref, Title: "Painting", Kind: "project", Phase: lifePlanned}
	if err := l.acceptFuture([]lifeFrameProposal{{ActivityRef: ref, Title: "Outline", Kind: "project", DurationMinutes: 10, EndProgress: 50}, {ActivityRef: ref, Title: "Finish", Description: &lifeSelfDescription{Action: "create", Object: "Line study", Result: "completed"}, Kind: "project", DurationMinutes: 10, EndProgress: 100, CompletesActivity: true}}, now.Add(-time.Hour), 1, nil, false); err != nil {
		t.Fatal(err)
	}
	l.Future[1].StartsAt = now.Add(time.Hour)
	l.Future[1].EndsAt = now.Add(2 * time.Hour)
	if err := l.recoverAt(now); err != nil {
		t.Fatal(err)
	}
	if len(l.Future) != 0 || len(l.Recent) != 0 || l.Current != nil || l.Activities[ref].Progress != 0 {
		t.Fatal("missed schedule became progress or retained dependent completion")
	}
	if l.SettledAt.Before(now) {
		t.Fatal("missed arrangement could be relabeled as retrospective completion")
	}
	if changes, err := l.advance(now.Add(2*time.Hour), false); err != nil || len(changes) != 0 {
		t.Fatal("recovered missed work completed")
	}
}

func TestAdvanceDoesNotPromoteAfterInvalidatedPredecessor(t *testing.T) {
	now := time.Now().UTC()
	l := newAgentLifeState()
	ref := "painting"
	l.Activities[ref] = &lifeActivity{Ref: ref, Title: "Painting", Kind: "project", Phase: lifePlanned}
	if err := l.acceptFuture([]lifeFrameProposal{{ActivityRef: ref, Title: "Outline", Kind: "project", DurationMinutes: 1, EndProgress: 50}, {ActivityRef: ref, Title: "Finish", Description: &lifeSelfDescription{Action: "create", Object: "Line study", Result: "completed"}, Kind: "project", DurationMinutes: 1, EndProgress: 100, CompletesActivity: true}}, now, 1, nil, false); err != nil {
		t.Fatal(err)
	}
	l.Future[0].Invalidated = true
	if changes, err := l.advance(now.Add(3*time.Minute), false); err != nil || len(changes) != 0 || l.Activities[ref].Progress != 0 {
		t.Fatal("missing progress was skipped")
	}
}

func TestLifePastWindowUsesKnownTimeRatherThanOccurrenceTime(t *testing.T) {
	input := lifeExecutorTestInput(t, 1024)
	input.Entry.Life.SettledAt = input.Now.Add(-24 * time.Hour)
	input.Source.LifeFlowRatio = 1
	input.Source.KnownAt = input.Now.Add(-12 * time.Hour)
	input.Memory = []agentTurnMemoryInput{{MemoryID: "old-occurrence-new-knowledge", KnownAt: input.Now.Add(-time.Hour)}}
	input.Context = projectLifeContext(input.Entry.Life, true, false, nil, input.Now, 1)
	if err := constrainLifePastKnowledge(&input); err != nil {
		t.Fatal(err)
	}
	var core struct {
		Past *struct {
			Start time.Time `json:"start"`
		} `json:"past_window"`
	}
	if err := json.Unmarshal([]byte(input.Context.Core), &core); err != nil {
		t.Fatal(err)
	}
	if core.Past == nil || !core.Past.Start.Equal(input.Memory[0].KnownAt) || !input.PastFrom.Equal(core.Past.Start) {
		t.Fatal("new knowledge was backdated")
	}
	input.Memory[0].KnownAt = time.Time{}
	if err := constrainLifePastKnowledge(&input); err != nil {
		t.Fatal(err)
	}
	core.Past = nil
	if err := json.Unmarshal([]byte(input.Context.Core), &core); err != nil || core.Past != nil {
		t.Fatal("unknown knowledge time allowed retroactive claims")
	}
}
