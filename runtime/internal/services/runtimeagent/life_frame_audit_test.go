package runtimeagent

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestLifePlanningFillsGapBeforeReservedFuture(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	ref := testRuntimeAgentLocalRef("agent-alpha")
	now := time.Now().UTC()
	reservedAt := now.Add(24 * time.Hour)
	ai := &fakeLifeTurnAI{response: &runtimev1.ExecuteScenarioResponse{FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP, Output: &runtimev1.ScenarioOutput{Output: &runtimev1.ScenarioOutput_TextGenerate{TextGenerate: &runtimev1.TextGenerateOutput{Text: `{"past":[],"future":[{"title":"Walk by the lake","kind":"routine","duration_minutes":10,"end_progress":100,"completes_activity":true}],"next_check_minutes":60}`}}}}}
	svc.aiBridge.lifeFrameAI = ai
	var reserved lifeFrame
	if err := svc.mutateAgent(ref, func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
		e.Agent.Autonomy.Enabled = true
		e.Agent.Autonomy.Config.Mode = runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_MEDIUM
		e.Life.StartedAt, e.Life.SettledAt = now.Add(-time.Hour), now.Add(-time.Hour)
		err := e.Life.acceptFuture([]lifeFrameProposal{{Title: "Tomorrow's painting", Description: &lifeSelfDescription{Action: "create", Object: "Tomorrow's painting", Result: "completed"}, Kind: "project", DurationMinutes: 60, EndProgress: 100, CompletesActivity: true}}, reservedAt, 1, nil, false)
		if err != nil {
			return nil, nil, err
		}
		reserved = e.Life.Future[0]
		return nil, nil, nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := svc.runLifeFrameSweep(context.Background(), now); err != nil {
		t.Fatal(err)
	}
	svc.lifeFrameWG.Wait()
	e, _ := svc.agentByID(ref)
	if len(ai.requests) != 1 || e.Life.Current == nil || e.Life.Current.Title != "Walk by the lake" || len(e.Life.Future) != 1 || e.Life.Future[0].ID != reserved.ID || !e.Life.Future[0].StartsAt.Equal(reservedAt) {
		t.Fatalf("gap planning moved or blocked the arrangement: %+v", e.Life)
	}
	if e.Life.canPlanAt(now, 1) {
		t.Fatal("accepted coverage caused another inference")
	}
	if err := svc.stateRepo.loadAgentLifeState(svc); err != nil {
		t.Fatal(err)
	}
	restored, _ := svc.agentByID(ref)
	if restored.Life.Current != nil || len(restored.Life.Future) != 1 || restored.Life.Future[0].ID != reserved.ID || restored.Life.Activities[e.Life.Current.ActivityRef].Progress != 0 {
		t.Fatal("recovery settled offline work or lost independent future")
	}
}

func TestLifeGapProposalCannotMoveOrCompleteReservedActivity(t *testing.T) {
	now := time.Now().UTC()
	l := newAgentLifeState()
	l.SettledAt = now
	if err := l.acceptFuture([]lifeFrameProposal{{Title: "Later painting", Description: &lifeSelfDescription{Action: "create", Object: "Later painting", Result: "completed"}, Kind: "project", DurationMinutes: 60, EndProgress: 100, CompletesActivity: true}}, now.Add(time.Hour), 1, nil, false); err != nil {
		t.Fatal(err)
	}
	before := cloneAgentLifeState(l)
	for _, p := range []lifeFrameProposal{
		{Title: "Overlapping walk", Kind: "routine", DurationMinutes: 61, EndProgress: 100, CompletesActivity: true},
		{ActivityRef: l.Future[0].ActivityRef, Title: "Finish early", Description: &lifeSelfDescription{Action: "create", Object: "Line study", Result: "completed"}, Kind: "project", DurationMinutes: 10, EndProgress: 100, CompletesActivity: true},
		{ActivityRef: l.Future[0].ActivityRef, Title: "Start early", Kind: "project", DurationMinutes: 10, EndProgress: 0},
	} {
		if err := l.acceptFuture([]lifeFrameProposal{p}, now, 1, nil, false); err == nil || !lifeStateEqual(l, before) {
			t.Fatal("reserved future was invalidated by a gap proposal")
		}
	}
}

func TestLifeCapacityAdmitsBoundedBatchBesideReservations(t *testing.T) {
	now := time.Now().UTC()
	l := newAgentLifeState()
	l.SettledAt = now
	reserved := []lifeFrameProposal{{Title: "Tomorrow's painting", Description: &lifeSelfDescription{Action: "create", Object: "Tomorrow's painting", Result: "completed"}, Kind: "project", DurationMinutes: 60, EndProgress: 100, CompletesActivity: true}, {Title: "Tomorrow's poem", Description: &lifeSelfDescription{Action: "create", Object: "Tomorrow's poem", Result: "completed"}, Kind: "project", DurationMinutes: 60, EndProgress: 100, CompletesActivity: true}}
	if err := l.acceptFuture(reserved, now.Add(24*time.Hour), 1, nil, false); err != nil {
		t.Fatal(err)
	}
	firstReserved := l.Future[0]
	var ordinary []lifeFrameProposal
	for i := 0; i < 3; i++ {
		ordinary = append(ordinary, lifeFrameProposal{Title: fmt.Sprintf("Routine %d", i), Kind: "routine", DurationMinutes: 10, EndProgress: 100, CompletesActivity: true})
	}
	if err := l.acceptFuture(ordinary, now, 1, nil, false); err != nil {
		t.Fatal(err)
	}
	if len(l.Future) != 5 || l.Future[3].ID != firstReserved.ID || !l.Future[3].StartsAt.Equal(firstReserved.StartsAt) {
		t.Fatal("ordinary planning consumed or moved reserved work")
	}
}

func TestLifePlanningOnlyOffersResumableActivityReferences(t *testing.T) {
	now := time.Now().UTC()
	l := newAgentLifeState()
	l.Activities["retired-ref"] = &lifeActivity{Ref: "retired-ref", Title: "Finished painting", Kind: "project", Phase: lifeCompleted, Progress: 100}
	l.Activities["paused-ref"] = &lifeActivity{Ref: "paused-ref", Title: "Paused poem", Kind: "project", Phase: lifePaused}
	l.Activities["continue-ref"] = &lifeActivity{Ref: "continue-ref", Title: "Ongoing sketch", Kind: "project", Phase: lifePaused}
	l.Activities["reserved-ref"] = &lifeActivity{Ref: "reserved-ref", Title: "Tomorrow", Kind: "project", Phase: lifePlanned}
	l.Future = []lifeFrame{{ID: "reserved", ActivityRef: "reserved-ref", Title: "Tomorrow", StartsAt: now.Add(time.Hour), EndsAt: now.Add(2 * time.Hour), Phase: lifePlanned}}
	l.Recent = []lifeFrame{{ID: "past", ActivityRef: "retired-ref", Title: "Finished painting", Phase: lifeCompleted, StartsAt: now.Add(-time.Hour), EndsAt: now.Add(-time.Minute)}}
	view := projectLifeContext(l, true, false, nil, now, 1)
	if strings.Contains(view.Core, "retired-ref") || !strings.Contains(view.Core, "paused-ref") || strings.Contains(view.Core, "reserved-ref") || !strings.Contains(view.Core, "continue-ref") || !strings.Contains(view.Core, "Finished painting") || !strings.Contains(view.Core, "Paused poem") {
		t.Fatalf("planning confused history with resumable handles: %s", view.Core)
	}
}

func TestLifePlanningWindowsExposeUsableWorldDuration(t *testing.T) {
	now := time.Now().UTC()
	l := newAgentLifeState()
	l.SettledAt = now.Add(-20 * time.Second)
	l.Activities["later"] = &lifeActivity{Ref: "later", Title: "Later walk", Kind: "routine", Phase: lifePlanned}
	l.Future = []lifeFrame{{ID: "later-frame", ActivityRef: "later", Title: "Later walk", StartsAt: now.Add(10 * time.Minute), EndsAt: now.Add(20 * time.Minute), Phase: lifePlanned}}
	view := projectLifeContext(l, true, false, nil, now, 1)
	if strings.Contains(view.Core, "past_window") || !strings.Contains(view.Core, `"world_minutes":10`) {
		t.Fatalf("unusable planning window: %s", view.Core)
	}
	view = projectLifeContext(l, true, false, nil, now, 4)
	if !strings.Contains(view.Core, "past_window") || !strings.Contains(view.Core, `"world_minutes":40`) {
		t.Fatalf("World flow missing from planning windows: %s", view.Core)
	}
}

func TestLifeSparseCatchUpSpansWholeGapAndSettlesOmittedTime(t *testing.T) {
	now := time.Now().UTC()
	from := now.Add(-7 * 24 * time.Hour)
	l := newAgentLifeState()
	l.StartedAt, l.SettledAt = from, from
	result, err := decodeLifeFrameResult(`{"past":[{"start_fraction":0.1,"end_fraction":0.2,"title":"A walk","kind":"routine","end_progress":100,"completes_activity":true},{"start_fraction":0.9,"end_fraction":1,"title":"Finish the landscape","kind":"project","description":{"action":"create","object":"Landscape painting","result":"completed"},"end_progress":100,"completes_activity":true}],"future":[],"next_check_minutes":60}`)
	if err != nil {
		t.Fatal(err)
	}
	done, err := l.acceptPast(result.Past, now, 1, nil, false)
	if err != nil || len(done) != 2 || len(l.Recent) != 2 || !l.Recent[1].StartsAt.After(from.Add(6*24*time.Hour)) || !l.SettledAt.Equal(now) {
		t.Fatalf("sparse catch-up: %v %+v", err, l)
	}
	for _, f := range l.Recent {
		if !f.Retrospective || f.EndsAt.After(now) {
			t.Fatal("incorrect retrospective interval")
		}
	}
	before := cloneAgentLifeState(l)
	if _, err := l.acceptPast(result.Past, now, 1, nil, false); err == nil || !lifeStateEqual(l, before) {
		t.Fatal("settled gap replayed")
	}
	view := projectLifeContext(l, true, false, nil, now, 1)
	if strings.Contains(view.Core, "past_window") {
		t.Fatal("omitted ordinary time remained a backlog")
	}
}

func TestLifeSparseCatchUpRejectsOverlapAndOutOfWindow(t *testing.T) {
	now := time.Now().UTC()
	for _, positions := range [][]float64{{1.1}, {0.5, 0.4}} {
		l := newAgentLifeState()
		l.SettledAt = now.Add(-time.Hour)
		before := cloneAgentLifeState(l)
		var past []lifePastProposal
		for _, position := range positions {
			past = append(past, lifePastProposal{StartFraction: position, EndFraction: position + 0.2, Title: "Walk", Kind: "routine", EndProgress: 100, CompletesActivity: true})
		}
		if _, err := l.acceptPast(past, now, 1, nil, false); err == nil || !lifeStateEqual(l, before) {
			t.Fatal("invalid catch-up partially committed")
		}
	}
}
