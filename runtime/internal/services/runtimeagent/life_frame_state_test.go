package runtimeagent

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestLifeStateMissingRowFailsClosedUntilExplicitInitialization(t *testing.T) {
	svc := newRuntimeAgentTestService(t)
	sourceRef := "pre-life-offline-initialization"
	if _, err := materializeRealmSourceTestAgent(t, svc, context.Background(), &realmSourceTestAgentInput{Context: testRuntimeAgentIdentityContext(sourceRef)}); err != nil {
		t.Fatal(err)
	}
	ref := testRuntimeAgentLocalRef(sourceRef)
	db := svc.stateRepo.backend.DB()
	var original string
	if err := db.QueryRow(`SELECT agent_json FROM runtime_local_agent WHERE local_agent_ref=?`, ref).Scan(&original); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`DELETE FROM runtime_local_agent_life WHERE local_agent_ref=?`, ref); err != nil {
		t.Fatal(err)
	}
	if err := svc.stateRepo.loadStateFromDB(svc); err == nil || !strings.Contains(err.Error(), "no life-frame state") {
		t.Fatalf("missing persisted state must fail closed: %v", err)
	}
	var rows int
	if err := db.QueryRow(`SELECT COUNT(*) FROM runtime_local_agent_life`).Scan(&rows); err != nil || rows != 0 {
		t.Fatalf("startup must not initialize missing life implicitly: count=%d error=%v", rows, err)
	}
	// Exact minimal row emitted by the explicit pre-release maintenance tool.
	if _, err := db.Exec(`INSERT INTO runtime_local_agent_life(local_agent_ref,life_json) VALUES(?,?)`, ref, `{"revision":1}`); err != nil {
		t.Fatal(err)
	}
	if err := svc.stateRepo.loadStateFromDB(svc); err != nil {
		t.Fatal(err)
	}
	entry, err := svc.agentByID(ref)
	if err != nil || !lifeStateEqual(entry.Life, newAgentLifeState()) {
		t.Fatalf("explicit initialization invented life history or failed: %v", err)
	}
	var retained string
	if err := db.QueryRow(`SELECT agent_json FROM runtime_local_agent WHERE local_agent_ref=?`, ref).Scan(&retained); err != nil || retained != original {
		t.Fatalf("Agent identity/presentation changed: %v", err)
	}
}

func TestLifeFramesAdvanceWithoutInferenceAndNeverRewind(t *testing.T) {
	start := time.Date(2026, 10, 19, 8, 0, 0, 0, time.UTC)
	l := newAgentLifeState()
	l.StartedAt = start
	l.SettledAt = start
	if err := l.acceptFuture([]lifeFrameProposal{{Title: "Paint the landscape", Description: &lifeSelfDescription{Action: "create", Object: "Paint the landscape", Result: "completed"}, Kind: "project", DurationMinutes: 60, EndProgress: 100, CompletesActivity: true}}, start, 2, nil, false); err != nil {
		t.Fatal(err)
	}
	ref := l.Future[0].ActivityRef
	if _, err := l.advance(start, false); err != nil {
		t.Fatal(err)
	}
	if l.Current == nil || l.Current.ActivityRef != ref || l.Activities[ref].Phase != lifeActive {
		t.Fatal("activity did not start")
	}
	if done, err := l.advance(start.Add(time.Hour), true); err != nil || len(done) != 0 || l.Current == nil {
		t.Fatal("paused world progressed")
	}
	done, err := l.advance(start.Add(30*time.Minute), false)
	if err != nil || len(done) != 1 || done[0] != l.Recent[0].ID || l.Current != nil || l.Activities[ref].Phase != lifeCompleted {
		t.Fatalf("completion: %v %v %+v", done, err, l)
	}
	rev := l.Revision
	if done, err := l.advance(start.Add(10*time.Minute), false); err != nil || len(done) != 0 || l.Revision != rev {
		t.Fatal("clock rollback replayed or mutated settled activity")
	}
	if err := l.acceptFuture([]lifeFrameProposal{{Title: "Rewrite", Kind: "routine", DurationMinutes: 10}}, start, 1, nil, false); err == nil {
		t.Fatal("settled past was replaced")
	}
}

func TestLifePausePreservesIntentionsAndIndependentContact(t *testing.T) {
	start := time.Now().UTC()
	l := newAgentLifeState()
	if err := l.acceptFuture([]lifeFrameProposal{{Title: "Painting", Kind: "project", DurationMinutes: 60, EndProgress: 80}}, start, 1, []string{"memory-blue"}, false); err != nil {
		t.Fatal(err)
	}
	ref := l.Future[0].ActivityRef
	l.Intents = []lifeProactiveIntent{{ID: "life", Source: "life"}, {ID: "contact", Source: "contact"}}
	if _, err := l.advance(start, false); err != nil {
		t.Fatal(err)
	}
	if err := l.pause(start.Add(10 * time.Minute)); err != nil {
		t.Fatal(err)
	}
	if l.Current != nil || len(l.Future) != 0 || len(l.Intents) != 2 || l.Activities[ref].Phase != lifePaused {
		t.Fatalf("pause lost source boundaries: %+v", l)
	}

	l.Explanation = &lifeExplanation{Text: "because blue is preferred", MemoryRefs: []string{"memory-blue"}}
	if !l.invalidateMemory(map[string]bool{"memory-blue": true}, false) || l.Explanation != nil || l.Activities[ref].Title != "Painting" || l.Activities[ref].Ref != ref {
		t.Fatal("Memory invalidation lost activity identity or retained explanation")
	}
}

func TestLifeStateSharesOwnerPersistenceRollbackAndRecovery(t *testing.T) {
	svc := newRuntimeAgentTestService(t)
	sourceRef := "life-state-persistence"
	if _, err := materializeRealmSourceTestAgent(t, svc, context.Background(), &realmSourceTestAgentInput{Context: testRuntimeAgentIdentityContext(sourceRef)}); err != nil {
		t.Fatal(err)
	}
	id := testRuntimeAgentLocalRef(sourceRef)
	start := time.Now().UTC().Add(time.Hour)
	if err := svc.mutateAgent(id, func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
		return nil, nil, e.Life.acceptFuture([]lifeFrameProposal{{Title: "Sketch", Description: &lifeSelfDescription{Action: "create", Object: "Sketch", Result: "completed"}, Kind: "project", DurationMinutes: 30, EndProgress: 100, CompletesActivity: true}}, start, 1, nil, false)
	}); err != nil {
		t.Fatal(err)
	}
	before, err := svc.agentByID(id)
	if err != nil {
		t.Fatal(err)
	}
	wantErr := errors.New("transaction unavailable")
	err = svc.mutateAgentWithPersistence(id, func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
		e.Life.Future = nil
		return nil, nil, e.Life.changed()
	}, func(*agentEntry, []*runtimev1.AgentEvent, uint64, runtimeAgentStateTxHook) error { return wantErr })
	if !errors.Is(err, wantErr) {
		t.Fatal(err)
	}
	after, err := svc.agentByID(id)
	if err != nil || !lifeStateEqual(before.Life, after.Life) {
		t.Fatal("failed transaction leaked life mutation")
	}
	if err := svc.stateRepo.loadAgentLifeState(svc); err != nil {
		t.Fatal(err)
	}
	after, err = svc.agentByID(id)
	if err != nil || len(after.Life.Future) != 1 || after.Life.Future[0].ID != before.Life.Future[0].ID || after.Life.Activities[before.Life.Future[0].ActivityRef].Progress != 0 {
		t.Fatalf("life state did not survive database reload: before=%+v after=%+v error=%v", before.Life, after.Life, err)
	}
}
