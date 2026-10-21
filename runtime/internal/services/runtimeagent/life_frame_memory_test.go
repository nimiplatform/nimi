package runtimeagent

import (
	"context"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/services/cognitionmemory"
)

func TestLifeActivityCommitsIndependentFactAndOccurrenceWithOwnerState(t *testing.T) {
	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	sourceRef := "life-independent-memory"
	if _, err := materializeRealmSourceTestAgent(t, svc, ctx, &realmSourceTestAgentInput{Context: testRuntimeAgentIdentityContext(sourceRef)}); err != nil {
		t.Fatal(err)
	}
	ref := testRuntimeAgentLocalRef(sourceRef)
	now := time.Now().UTC()
	end := now.Add(-4 * 24 * time.Hour)
	start := end.Add(-time.Hour)
	err := svc.mutateAgent(ref, func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
		a := &lifeActivity{Ref: "activity-painting", Title: "Landscape painting", Kind: "project", Phase: lifeCompleted, Progress: 100, StartedAt: start, CompletedAt: end}
		e.Life.Activities[a.Ref] = a
		e.Life.Explanation = &lifeExplanation{Text: "The user likes blue", MemoryRefs: []string{"old-blue"}}
		f := lifeFrame{ID: "painting-complete", ActivityRef: a.Ref, Title: "Mixed external reason stays out", Phase: lifeCompleted, ActivityState: lifeCompleted, StartsAt: start, EndsAt: end, CompletesActivity: true, Description: &lifeSelfDescription{Action: "create", Object: "Landscape painting", Result: "completed"}, Retrospective: true}
		e.Life.Recent = append(e.Life.Recent, f)
		hook, err := svc.lifeActivityMemoryTxHook(e, []string{f.ID}, now)
		return nil, hook, err
	})
	if err != nil {
		t.Fatal(err)
	}
	svc.triggerCognitionMemory(ref)
	svc.cognitionMemoryWG.Wait()
	projection, err := svc.cognitionMemoryFacade.Inspect(ctx, cognitionmemory.InspectIntent{LocalAgentRef: ref, Limit: 100})
	if err != nil || projection.Outcome != memoryv1.OutcomeReady || len(projection.Items) != 1 {
		t.Fatalf("Memory handoff: %+v %v", projection, err)
	}
	m := projection.Items[0]
	if !strings.Contains(m.Content, "Landscape painting") || strings.Contains(m.Content, "blue") || !m.OccurredAt.Equal(end) || m.EpistemicStatus != memoryv1.EpistemicInferred || !strings.Contains(m.SourceExplanation, start.Format(time.RFC3339Nano)) {
		t.Fatalf("independent fact lost provenance/time: %+v", m)
	}
	recalled, err := svc.cognitionMemoryFacade.Recall(ctx, cognitionmemory.RecallIntent{LocalAgentRef: ref, Query: "unrelated future direction", Limit: 4, IncludeRecentLife: true})
	if err != nil || len(recalled.Hits) != 1 {
		t.Fatalf("actual life Recall: %+v %v", recalled, err)
	}
	memories, err := publicChatCognitionMemoryInputs(recalled.Hits)
	if err != nil {
		t.Fatal(err)
	}
	input := lifeExecutorTestInput(t, 1024)
	input.Memory = memories
	compiled, err := compileLifeFrameContext(input)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, message := range compiled.ProviderPrompt.Messages {
		if strings.Contains(message.Content, "Landscape painting") {
			found = true
		}
	}
	if !found {
		t.Fatal("admitted experience absent from actual next planning input")
	}
}

func TestLifeMemoryBuilderSeparatesOwnDescriptionFromReadSet(t *testing.T) {
	now := time.Now().UTC()
	l := newAgentLifeState()
	l.Activities["a"] = &lifeActivity{Ref: "a", Kind: "project"}
	f := lifeFrame{ID: "change", ActivityRef: "a", Title: "Painting because the user prefers blue", Phase: lifeCompleted, ActivityState: lifeCompleted, StartsAt: now.Add(-time.Hour), EndsAt: now, CompletesActivity: true, MemoryRefs: []string{"old-blue"}}
	if independentLifeFrameFact(l, f, now) != nil {
		t.Fatal("mixed display title became Memory")
	}
	f.Description = &lifeSelfDescription{Action: "create", Object: "Cloud postcard", Result: "completed"}
	fact := independentLifeFrameFact(l, f, now)
	if fact == nil || fact.SelfObject != "Cloud postcard" {
		t.Fatal("eligible independent experience was rejected merely because Recall was read")
	}
	f.Description = &lifeSelfDescription{Action: "create", Object: "《我喜欢的云》：线条练习", Result: "completed"}
	if independentLifeFrameFact(l, f, now) == nil {
		t.Fatal("a keyword or punctuation rejected an own work description")
	}
	f.Description.Object = "在云影与风声之间，练习以更轻的线条保存留白的天空速写"
	if independentLifeFrameFact(l, f, now) == nil {
		t.Fatal("UTF-8 byte count rejected an object within the schema's character limit")
	}
	f.Description = &lifeSelfDescription{Action: "create", Object: "Cloud postcard", Result: "completed"}
	f.Phase = lifeInterrupted
	if independentLifeFrameFact(l, f, now) != nil {
		t.Fatal("interruption became completion")
	}
	f.Phase = lifeCompleted
	f.EndsAt = now.Add(time.Hour)
	if independentLifeFrameFact(l, f, now) != nil {
		t.Fatal("future became experience")
	}
	f.EndsAt = now
	f.Invalidated = true
	if independentLifeFrameFact(l, f, now) != nil {
		t.Fatal("invalidated description revived")
	}
}

func TestLifeKeyResultRequiresConcreteOwnOutcome(t *testing.T) {
	now := time.Now().UTC()
	l := newAgentLifeState()
	l.Activities["study"] = &lifeActivity{Ref: "study", Kind: "project", Phase: lifePaused}
	f := lifeFrame{ID: "study-result", ActivityRef: "study", Phase: lifeCompleted, ActivityState: lifePaused, StartsAt: now.Add(-time.Minute), EndsAt: now,
		Description: &lifeSelfDescription{Action: "create", Object: "Line-weight samples", Result: "key_result"}}
	for _, outcome := range []string{"", "  "} {
		f.Description.Outcome = outcome
		if independentLifeFrameFact(l, f, now) != nil {
			t.Fatalf("empty result admitted: %q", outcome)
		}
	}
	f.Description.Outcome = "Compared three stroke weights and selected the lightest line for the next sketch"
	fact := independentLifeFrameFact(l, f, now)
	if fact == nil || fact.BoundedOutcome != f.Description.Outcome {
		t.Fatal("concrete result lost at the Cognition handoff")
	}
}

func TestInvalidExperienceDoesNotDiscardAnOtherwiseValidLifeFrame(t *testing.T) {
	for _, description := range []*lifeSelfDescription{nil, {Action: "unrecognized", Object: "Line study", Result: "completed"}} {
		l := newAgentLifeState()
		p := lifeFrameProposal{Title: "Line study", Kind: "project", DurationMinutes: 1, EndProgress: 100, CompletesActivity: true, Description: description}
		if err := l.acceptFuture([]lifeFrameProposal{p}, time.Now().UTC(), 1, nil, false); err != nil {
			t.Fatal(err)
		}
		if len(l.Future) != 1 || l.Future[0].Description != nil {
			t.Fatal("invalid optional description affected the life frame or entered Memory input")
		}
	}
}

func TestLifeExperienceWhitespaceDoesNotPoisonSettlement(t *testing.T) {
	for _, persisted := range []bool{false, true} {
		name := "new-proposal"
		if persisted {
			name = "already-persisted-description"
		}
		t.Run(name, func(t *testing.T) {
			svc := newRuntimeAgentTestService(t)
			ctx := context.Background()
			source := "experience-whitespace"
			if _, err := materializeRealmSourceTestAgent(t, svc, ctx, &realmSourceTestAgentInput{Context: testRuntimeAgentIdentityContext(source)}); err != nil {
				t.Fatal(err)
			}
			ref := testRuntimeAgentLocalRef(source)
			now := time.Now().UTC()
			if err := svc.mutateAgent(ref, func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
				description := &lifeSelfDescription{Action: "create", Object: "Cloud postcard", Result: "completed", Outcome: "Finished the cloud postcard\n"}
				if err := e.Life.acceptFuture([]lifeFrameProposal{{Title: "Cloud postcard", Kind: "project", DurationMinutes: 1, EndProgress: 100, CompletesActivity: true, Description: description}}, now.Add(-2*time.Minute), 1, nil, false); err != nil {
					return nil, nil, err
				}
				if persisted {
					// Represent a frame accepted by the previous version. The
					// settlement must handle it without a database migration.
					e.Life.Future[0].Description = description
				}
				return nil, nil, nil
			}); err != nil {
				t.Fatal(err)
			}
			if err := svc.mutateAgent(ref, func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
				changes, err := e.Life.advance(now, false)
				if err != nil {
					return nil, nil, err
				}
				hook, err := svc.lifeActivityMemoryTxHook(e, changes, now)
				return nil, hook, err
			}); err != nil {
				t.Fatal(err)
			}
			svc.triggerCognitionMemory(ref)
			svc.cognitionMemoryWG.Wait()
			recalled, err := svc.cognitionMemoryFacade.Recall(ctx, cognitionmemory.RecallIntent{LocalAgentRef: ref, Query: "Cloud postcard", IncludeRecentLife: true, Limit: 4})
			if err != nil || len(recalled.Hits) != 1 || !strings.Contains(recalled.Hits[0].Content, "Finished the cloud postcard") {
				t.Fatalf("settled experience not admitted and recalled: %+v %v", recalled, err)
			}
		})
	}
}

func TestLifeSweepIsolatesOutboxFailureWithoutLosingAtomicity(t *testing.T) {
	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	var refs []string
	for _, source := range []string{"sweep-one", "sweep-two"} {
		if _, err := materializeRealmSourceTestAgent(t, svc, ctx, &realmSourceTestAgentInput{Context: testRuntimeAgentIdentityContext(source)}); err != nil {
			t.Fatal(err)
		}
		refs = append(refs, testRuntimeAgentLocalRef(source))
	}
	sort.Strings(refs)
	now := time.Now().UTC()
	var frames []string
	for _, ref := range refs {
		if err := svc.mutateAgent(ref, func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
			e.Agent.Autonomy.Enabled = true
			e.Agent.Autonomy.Config.Mode = runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_LOW
			e.Life.StartedAt, e.Life.SettledAt = now.Add(-2*time.Minute), now.Add(-2*time.Minute)
			e.Life.NextCheckAt = now.Add(time.Hour)
			if err := e.Life.acceptFuture([]lifeFrameProposal{{Title: "Cloud postcard", Kind: "project", DurationMinutes: 1, EndProgress: 100, CompletesActivity: true, Description: &lifeSelfDescription{Action: "create", Object: "Cloud postcard", Result: "completed"}}}, e.Life.StartedAt, 1, nil, false); err != nil {
				return nil, nil, err
			}
			frames = append(frames, e.Life.Future[0].ID)
			return nil, nil, nil
		}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := svc.backend.DB().Exec(`CREATE TRIGGER life_outbox_failure BEFORE INSERT ON runtime_cognition_memory_outbox WHEN NEW.event_ref='cmevt_life_` + frames[0] + `' BEGIN SELECT RAISE(FAIL, 'life outbox write failure'); END`); err != nil {
		t.Fatal(err)
	}
	err := svc.runLifeFrameSweep(ctx, now)
	if err == nil || !strings.Contains(err.Error(), "life outbox write failure") {
		t.Fatalf("outbox storage failure was swallowed: %v", err)
	}
	failed, _ := svc.agentByID(refs[0])
	other, _ := svc.agentByID(refs[1])
	if len(failed.Life.Future) != 1 || len(failed.Life.Recent) != 0 {
		t.Fatal("failed outbox transaction committed life without its experience")
	}
	if len(other.Life.Future) != 0 || len(other.Life.Recent) != 1 || other.Life.Recent[0].ID != frames[1] {
		t.Fatal("one Agent's failure blocked the following Agent")
	}
	if _, err := svc.backend.DB().Exec(`DROP TRIGGER life_outbox_failure`); err != nil {
		t.Fatal(err)
	}
	if err := svc.runLifeFrameSweep(ctx, now); err != nil {
		t.Fatal(err)
	}
	recovered, _ := svc.agentByID(refs[0])
	if len(recovered.Life.Future) != 0 || len(recovered.Life.Recent) != 1 || recovered.Life.Recent[0].ID != frames[0] {
		t.Fatal("original frame did not settle after storage recovered")
	}
}
