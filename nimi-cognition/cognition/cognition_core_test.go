package cognition

import (
	"strings"
	"testing"

	"github.com/nimiplatform/nimi/nimi-cognition/artifactref"
	"github.com/nimiplatform/nimi/nimi-cognition/internal/clock"
	"github.com/nimiplatform/nimi/nimi-cognition/kernel"
	"github.com/nimiplatform/nimi/nimi-cognition/kernelops"
	"github.com/nimiplatform/nimi/nimi-cognition/knowledge"
	"github.com/nimiplatform/nimi/nimi-cognition/memory"
	"github.com/nimiplatform/nimi/nimi-cognition/skill"
	"github.com/nimiplatform/nimi/nimi-cognition/working"
)

func TestInitScopeAndKernelService(t *testing.T) {
	c := newTestCognition(t)
	if err := c.InitScope("agent_001"); err != nil {
		t.Fatalf("init scope: %v", err)
	}
	k, rules, err := c.KernelService().Load("agent_001", kernel.KernelTypeAgentModel)
	if err != nil {
		t.Fatalf("load kernel: %v", err)
	}
	if k == nil || k.Version != 1 || len(rules) != 0 {
		t.Fatalf("unexpected kernel state: kernel=%+v rules=%d", k, len(rules))
	}
}

func TestMemoryKnowledgeSkillServicesAndPrompt(t *testing.T) {
	c := newTestCognition(t)
	if err := c.InitScope("a1"); err != nil {
		t.Fatalf("init scope: %v", err)
	}

	mem := memory.Record{RecordID: "m1", ScopeID: "a1", Kind: memory.RecordKindExperience, Version: 1, Content: []byte(`{"summary":"talked about Go interfaces"}`), Lifecycle: memory.RecordLifecycleActive, CreatedAt: ts, UpdatedAt: ts}
	if err := c.MemoryService().Save(mem); err != nil {
		t.Fatalf("save memory: %v", err)
	}

	page := knowledge.Page{
		PageID:    "p1",
		ScopeID:   "a1",
		Kind:      knowledge.ProjectionKindExplainer,
		Version:   1,
		Title:     "Interfaces",
		Body:      []byte(`"Interfaces are satisfied implicitly."`),
		Lifecycle: knowledge.ProjectionLifecycleActive,
		ArtifactRefs: []artifactref.Ref{{
			FromKind: artifactref.KindKnowledgePage, FromID: "p1", ToKind: artifactref.KindMemoryRecord, ToID: "m1", Strength: artifactref.StrengthStrong, Role: "support", CreatedAt: ts, UpdatedAt: ts,
		}},
		CreatedAt: ts,
		UpdatedAt: ts,
	}
	if err := c.KnowledgeService().Save(page); err != nil {
		t.Fatalf("save page: %v", err)
	}

	bundle := skill.Bundle{
		BundleID: "s1", ScopeID: "a1", Version: 1, Status: skill.BundleStatusActive, Name: "Review",
		Steps:     []skill.Step{{StepID: "st1", Instruction: "Read the diff", Order: 1}},
		Trigger:   &skill.Trigger{TriggerKind: "keyword", Condition: "review"},
		CreatedAt: ts, UpdatedAt: ts,
	}
	if err := c.SkillService().Save(bundle); err != nil {
		t.Fatalf("save bundle: %v", err)
	}

	results, err := c.MemoryService().SearchViews("a1", "interfaces", 10)
	if err != nil {
		t.Fatalf("search memory views: %v", err)
	}
	if len(results) != 1 || results[0].Support.Score != 1 {
		t.Fatalf("expected live support-decorated search result, got %+v", results)
	}

	advisory, err := c.PromptService().FormatAdvisory("a1")
	if err != nil {
		t.Fatalf("format advisory: %v", err)
	}
	if !strings.Contains(advisory, "[Advisory-Context]") || !strings.Contains(advisory, "[support=1.00]") {
		t.Fatalf("expected advisory formatting with live support markers, got:\n%s", advisory)
	}
	if !strings.Contains(advisory, "[advisory]") {
		t.Fatalf("expected skill advisory marker, got:\n%s", advisory)
	}
}

func TestWorkingServiceIsTransient(t *testing.T) {
	c := newTestCognition(t)
	state := working.State{
		StateID: "w1", ScopeID: "a1",
		ActiveTurn: &working.ActiveTurn{TurnID: "t1", Phase: "reasoning", StartedAt: ts},
		CreatedAt:  ts, UpdatedAt: ts,
	}
	if err := c.WorkingService().Save(state); err != nil {
		t.Fatalf("save working state: %v", err)
	}
	loaded, err := c.WorkingService().Load("a1")
	if err != nil {
		t.Fatalf("load working state: %v", err)
	}
	if loaded == nil || loaded.StateID != "w1" {
		t.Fatalf("unexpected working state: %+v", loaded)
	}
	if err := c.WorkingService().Clear("a1"); err != nil {
		t.Fatalf("clear working state: %v", err)
	}
	loaded, err = c.WorkingService().Load("a1")
	if err != nil {
		t.Fatalf("load cleared working state: %v", err)
	}
	if loaded != nil {
		t.Fatalf("expected cleared working state, got %+v", loaded)
	}
}

func TestWorkingServiceDoesNotPersistAcrossInstances(t *testing.T) {
	root := t.TempDir()
	c, err := New(root, WithClock(clock.NewTestClock(ts)))
	if err != nil {
		t.Fatalf("new cognition: %v", err)
	}
	if err := c.WorkingService().Save(working.State{StateID: "w1", ScopeID: "a1", CreatedAt: ts, UpdatedAt: ts}); err != nil {
		t.Fatalf("save working state: %v", err)
	}
	if err := c.Close(); err != nil {
		t.Fatalf("close cognition: %v", err)
	}
	reopened, err := New(root, WithClock(clock.NewTestClock(ts)))
	if err != nil {
		t.Fatalf("reopen cognition: %v", err)
	}
	defer reopened.Close()
	loaded, err := reopened.WorkingService().Load("a1")
	if err != nil {
		t.Fatalf("load reopened working state: %v", err)
	}
	if loaded != nil {
		t.Fatalf("expected transient working state to disappear across instances, got %+v", loaded)
	}
}

func TestDeleteScopeClearsWorkingState(t *testing.T) {
	c := newTestCognition(t)
	if err := c.InitScope("a1"); err != nil {
		t.Fatalf("init scope: %v", err)
	}
	if err := c.WorkingService().Save(working.State{StateID: "w1", ScopeID: "a1", CreatedAt: ts, UpdatedAt: ts}); err != nil {
		t.Fatalf("save working state: %v", err)
	}
	if err := c.DeleteScope("a1"); err != nil {
		t.Fatalf("delete scope: %v", err)
	}
	loaded, err := c.WorkingService().Load("a1")
	if err != nil {
		t.Fatalf("load working after delete scope: %v", err)
	}
	if loaded != nil {
		t.Fatalf("expected working state cleared with scope delete, got %+v", loaded)
	}
}

func TestNewRoutineContextProvidesTypedArtifactAccess(t *testing.T) {
	c := newTestCognition(t)
	if err := c.InitScope("a1"); err != nil {
		t.Fatalf("init scope: %v", err)
	}
	if err := c.MemoryService().Save(memory.Record{RecordID: "m1", ScopeID: "a1", Kind: memory.RecordKindExperience, Version: 1, Content: []byte(`{"summary":"hello"}`), Lifecycle: memory.RecordLifecycleActive, CreatedAt: ts, UpdatedAt: ts}); err != nil {
		t.Fatalf("save memory: %v", err)
	}
	ctx, err := c.NewRoutineContext("a1")
	if err != nil {
		t.Fatalf("new routine context: %v", err)
	}
	records, err := ctx.Storage.ListMemory("a1")
	if err != nil {
		t.Fatalf("list memory via routine context: %v", err)
	}
	if len(records) != 1 || records[0].RecordID != "m1" {
		t.Fatalf("unexpected routine memory records: %+v", records)
	}
}

func TestKernelMutationSurfaceStillWorks(t *testing.T) {
	c := newTestCognition(t)
	if err := c.InitScope("a1"); err != nil {
		t.Fatalf("init scope: %v", err)
	}
	rule := kernel.Rule{RuleID: "r1", Kind: kernel.RuleKindSelfFacing, Version: 1, Statement: "Prefer concise responses", AnchorBinding: kernel.AnchorBindingLocalOnly, Lifecycle: kernel.RuleLifecycleActive, CreatedAt: ts, UpdatedAt: ts}
	patch := kernelops.IncomingPatch{
		PatchID: "p1", TargetKernel: kernel.KernelTypeAgentModel, ScopeID: "a1", SubmittedBy: "test", SubmittedAt: ts,
		ProposedChanges: []kernelops.ProposedChange{{ChangeKind: kernelops.ChangeKindAdd, NewRule: &rule}},
	}
	resolved, conflicts, err := c.KernelEngine().Merge(patch)
	if err != nil {
		t.Fatalf("merge: %v", err)
	}
	if conflicts != nil {
		t.Fatalf("unexpected conflicts: %+v", conflicts)
	}
	commit, err := c.KernelEngine().Commit(*resolved)
	if err != nil {
		t.Fatalf("commit: %v", err)
	}
	if commit.NewVersion != 2 {
		t.Fatalf("expected kernel version 2, got %+v", commit)
	}
}
