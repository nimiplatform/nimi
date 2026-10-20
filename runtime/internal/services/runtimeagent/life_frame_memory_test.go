package runtimeagent

import (
	"context"
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
