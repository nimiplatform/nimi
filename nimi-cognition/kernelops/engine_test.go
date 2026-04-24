package kernelops

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/artifactref"
	"github.com/nimiplatform/nimi/nimi-cognition/internal/clock"
	"github.com/nimiplatform/nimi/nimi-cognition/internal/storage"
	"github.com/nimiplatform/nimi/nimi-cognition/kernel"
	"github.com/nimiplatform/nimi/nimi-cognition/knowledge"
)

var ts = time.Date(2026, 4, 16, 12, 0, 0, 0, time.UTC)

func newTestEngine(t *testing.T) (*Engine, *storage.SQLiteBackend) {
	t.Helper()
	store, err := storage.NewSQLiteBackend(t.TempDir())
	if err != nil {
		t.Fatalf("new backend: %v", err)
	}
	return NewEngine(store, clock.NewTestClock(ts)), store
}

func seedKernel(t *testing.T, store kernelRepository, scopeID string, kt kernel.KernelType, rules []kernel.Rule) {
	t.Helper()
	refs := make([]kernel.RuleID, 0, len(rules))
	for _, rule := range rules {
		refs = append(refs, rule.RuleID)
	}
	raw, err := json.Marshal(struct {
		Kernel kernel.Kernel `json:"kernel"`
		Rules  []kernel.Rule `json:"rules"`
	}{
		Kernel: kernel.Kernel{
			KernelID:   scopeID + "_" + string(kt),
			ScopeID:    scopeID,
			KernelType: kt,
			Version:    1,
			Status:     kernel.KernelStatusActive,
			RuleRefs:   refs,
			CreatedAt:  ts,
			UpdatedAt:  ts,
		},
		Rules: rules,
	})
	if err != nil {
		t.Fatalf("marshal seed kernel: %v", err)
	}
	if err := store.Save(scopeID, storage.KindKernel, string(kt), raw); err != nil {
		t.Fatalf("seed kernel: %v", err)
	}
}

func localRule(id kernel.RuleID, statement string) kernel.Rule {
	return kernel.Rule{
		RuleID:        id,
		Kind:          kernel.RuleKindSelfFacing,
		Version:       1,
		Statement:     statement,
		AnchorBinding: kernel.AnchorBindingLocalOnly,
		Lifecycle:     kernel.RuleLifecycleActive,
		CreatedAt:     ts,
		UpdatedAt:     ts,
	}
}

func makePatch(scopeID string, changes ...ProposedChange) IncomingPatch {
	return IncomingPatch{
		PatchID:         "patch_001",
		TargetKernel:    kernel.KernelTypeAgentModel,
		ScopeID:         scopeID,
		ProposedChanges: changes,
		SubmittedBy:     "test",
		SubmittedAt:     ts,
	}
}

func TestDiff_FieldAwareUpdate(t *testing.T) {
	engine, store := newTestEngine(t)
	seedKernel(t, store, "a1", kernel.KernelTypeAgentModel, []kernel.Rule{localRule("r1", "concise")})

	updated := localRule("r1", "verbose")
	updated.Version = 2
	updated.Value = []byte(`{"tone":"verbose"}`)
	diff, err := engine.Diff(makePatch("a1", ProposedChange{
		RuleID:      "r1",
		BaseVersion: 1,
		ChangeKind:  ChangeKindUpdate,
		NewRule:     &updated,
	}))
	if err != nil {
		t.Fatalf("diff: %v", err)
	}
	if diff.Entries[0].HasConflict {
		t.Fatalf("expected non-conflicting update, got %+v", diff.Entries[0])
	}
	got := strings.Join(diff.Entries[0].ChangedFields, ",")
	if !strings.Contains(got, "statement") || !strings.Contains(got, "value") {
		t.Fatalf("expected statement and value field diff, got %v", diff.Entries[0].ChangedFields)
	}
}

func TestDiff_RejectsStructurallyInvalidLocalOverridePatch(t *testing.T) {
	engine, store := newTestEngine(t)
	seedKernel(t, store, "a1", kernel.KernelTypeAgentModel, []kernel.Rule{localRule("r1", "concise")})

	updated := localRule("r1", "concise")
	updated.Version = 2
	updated.Alignment = kernel.AlignmentLocalOverride
	_, err := engine.Diff(makePatch("a1", ProposedChange{
		RuleID:      "r1",
		BaseVersion: 1,
		ChangeKind:  ChangeKindUpdate,
		NewRule:     &updated,
	}))
	if err == nil || !strings.Contains(err.Error(), "local_override requires anchor_binding anchored") {
		t.Fatalf("expected structural local_override rejection, got %v", err)
	}
}

func TestCommit_PersistsSnapshotsAndLog(t *testing.T) {
	engine, store := newTestEngine(t)
	base := localRule("r1", "concise")
	seedKernel(t, store, "a1", kernel.KernelTypeAgentModel, []kernel.Rule{base})

	updated := localRule("r1", "more verbose")
	updated.Version = 2
	updated.ArtifactRefs = []artifactref.Ref{{
		FromKind:  artifactref.KindKernelRule,
		FromID:    "r1",
		ToKind:    artifactref.KindMemoryRecord,
		ToID:      "mem_001",
		Strength:  artifactref.StrengthStrong,
		Role:      "support",
		CreatedAt: ts,
		UpdatedAt: ts,
	}}
	resolved := ResolvedPatch{
		ResolvedPatchID: "rp_001",
		TargetKernel:    kernel.KernelTypeAgentModel,
		ScopeID:         "a1",
		ResolvedBy:      "human",
		ResolvedAt:      ts,
		ResolvedChanges: []ResolvedChange{{
			RuleID:         "r1",
			BaseVersion:    1,
			ChangeKind:     ChangeKindUpdate,
			ResolutionKind: ResolutionKindManualMerge,
			FinalRule:      &updated,
		}},
	}

	commit, err := engine.Commit(resolved)
	if err == nil {
		t.Fatal("expected commit to reject dangling artifact ref target")
	}

	mem := validMemoryRecord("a1", "mem_001")
	memRaw, _ := json.Marshal(mem)
	if err := store.Save("a1", storage.KindMemory, "mem_001", memRaw); err != nil {
		t.Fatalf("seed memory: %v", err)
	}

	commit, err = engine.Commit(resolved)
	if err != nil {
		t.Fatalf("commit: %v", err)
	}
	if len(commit.BeforeSnapshot) != 1 || len(commit.AfterSnapshot) != 1 {
		t.Fatalf("expected before/after snapshots, got %+v", commit)
	}
	if commit.AfterSnapshot[0].Statement != "more verbose" {
		t.Fatalf("unexpected after snapshot: %+v", commit.AfterSnapshot[0])
	}

	log, err := engine.Log("a1", kernel.KernelTypeAgentModel)
	if err != nil {
		t.Fatalf("log: %v", err)
	}
	if len(log) != 1 {
		t.Fatalf("expected 1 commit log entry, got %d", len(log))
	}
}

func TestCommit_RejectsRemovedArtifactRefTarget(t *testing.T) {
	engine, store := newTestEngine(t)
	base := localRule("r1", "concise")
	seedKernel(t, store, "a1", kernel.KernelTypeAgentModel, []kernel.Rule{base})

	mem := validMemoryRecord("a1", "mem_removed")
	memRaw, _ := json.Marshal(mem)
	if err := store.Save("a1", storage.KindMemory, "mem_removed", memRaw); err != nil {
		t.Fatalf("seed memory: %v", err)
	}
	memRemoved := validMemoryRecord("a1", "mem_removed")
	memRemoved.Lifecycle = "removed"
	memRemoved.Version = 2
	memRemovedRaw, _ := json.Marshal(memRemoved)
	if err := store.Save("a1", storage.KindMemory, "mem_removed", memRemovedRaw); err != nil {
		t.Fatalf("seed removed memory: %v", err)
	}

	updated := localRule("r1", "more verbose")
	updated.Version = 2
	updated.ArtifactRefs = []artifactref.Ref{{
		FromKind:  artifactref.KindKernelRule,
		FromID:    "r1",
		ToKind:    artifactref.KindMemoryRecord,
		ToID:      "mem_removed",
		Strength:  artifactref.StrengthStrong,
		Role:      "support",
		CreatedAt: ts,
		UpdatedAt: ts,
	}}
	_, err := engine.Commit(ResolvedPatch{
		ResolvedPatchID: "rp_removed",
		TargetKernel:    kernel.KernelTypeAgentModel,
		ScopeID:         "a1",
		ResolvedBy:      "human",
		ResolvedAt:      ts,
		ResolvedChanges: []ResolvedChange{{
			RuleID:         "r1",
			BaseVersion:    1,
			ChangeKind:     ChangeKindUpdate,
			ResolutionKind: ResolutionKindManualMerge,
			FinalRule:      &updated,
		}},
	})
	if err == nil || !strings.Contains(err.Error(), "missing or removed") {
		t.Fatalf("expected removed target rejection, got %v", err)
	}
}

func TestCommit_RejectsForbiddenKernelArtifactRefTarget(t *testing.T) {
	engine, store := newTestEngine(t)
	base := localRule("r1", "concise")
	seedKernel(t, store, "a1", kernel.KernelTypeAgentModel, []kernel.Rule{base})

	updated := localRule("r1", "more verbose")
	updated.Version = 2
	updated.ArtifactRefs = []artifactref.Ref{{
		FromKind:  artifactref.KindKernelRule,
		FromID:    "r1",
		ToKind:    artifactref.KindKernelRule,
		ToID:      "r2",
		Strength:  artifactref.StrengthStrong,
		Role:      "support",
		CreatedAt: ts,
		UpdatedAt: ts,
	}}
	_, err := engine.Commit(ResolvedPatch{
		ResolvedPatchID: "rp_forbidden_target",
		TargetKernel:    kernel.KernelTypeAgentModel,
		ScopeID:         "a1",
		ResolvedBy:      "human",
		ResolvedAt:      ts,
		ResolvedChanges: []ResolvedChange{{
			RuleID:         "r1",
			BaseVersion:    1,
			ChangeKind:     ChangeKindUpdate,
			ResolutionKind: ResolutionKindManualMerge,
			FinalRule:      &updated,
		}},
	})
	if err == nil || !strings.Contains(err.Error(), "forbidden artifact target kind kernel_rule") {
		t.Fatalf("expected forbidden kernel target rejection, got %v", err)
	}
}

func TestCommit_RejectsRuleDeactivationWhenKnowledgeCitationExists(t *testing.T) {
	engine, store := newTestEngine(t)
	base := localRule("r1", "concise")
	seedKernel(t, store, "a1", kernel.KernelTypeAgentModel, []kernel.Rule{base})

	pageRaw, err := json.Marshal(knowledge.Page{
		PageID:    "p1",
		ScopeID:   "a1",
		Kind:      knowledge.ProjectionKindGuide,
		Version:   1,
		Title:     "Pinned page",
		Body:      []byte(`"body"`),
		Lifecycle: knowledge.ProjectionLifecycleActive,
		Citations: []knowledge.Citation{{
			TargetKind: knowledge.CitationTargetKindKernelRule,
			TargetID:   "r1",
			Strength:   kernel.RefStrong,
		}},
		CreatedAt: ts,
		UpdatedAt: ts,
	})
	if err != nil {
		t.Fatalf("marshal page: %v", err)
	}
	if err := store.Save("a1", storage.KindKnowledge, "p1", pageRaw); err != nil {
		t.Fatalf("seed knowledge page: %v", err)
	}

	updated := localRule("r1", "superseded")
	updated.Version = 2
	updated.Lifecycle = kernel.RuleLifecycleSuperseded
	updated.SupersededBy = "r2"
	r2 := localRule("r2", "replacement")

	_, err = engine.Commit(ResolvedPatch{
		ResolvedPatchID: "rp_cited_rule",
		TargetKernel:    kernel.KernelTypeAgentModel,
		ScopeID:         "a1",
		ResolvedBy:      "human",
		ResolvedAt:      ts,
		ResolvedChanges: []ResolvedChange{
			{
				RuleID:         "r2",
				ChangeKind:     ChangeKindAdd,
				ResolutionKind: ResolutionKindManualMerge,
				FinalRule:      &r2,
			},
			{
				RuleID:         "r1",
				BaseVersion:    1,
				ChangeKind:     ChangeKindUpdate,
				ResolutionKind: ResolutionKindManualMerge,
				FinalRule:      &updated,
			},
		},
	})
	if err == nil || !strings.Contains(err.Error(), "cannot transition out of active") {
		t.Fatalf("expected cited rule deactivation rejection, got %v", err)
	}
}

type memoryRecordSeed struct {
	RecordID  string          `json:"record_id"`
	ScopeID   string          `json:"scope_id"`
	Kind      string          `json:"kind"`
	Version   int             `json:"version"`
	Content   json.RawMessage `json:"content"`
	Lifecycle string          `json:"lifecycle"`
	CreatedAt time.Time       `json:"created_at"`
	UpdatedAt time.Time       `json:"updated_at"`
}

func validMemoryRecord(scopeID string, id string) memoryRecordSeed {
	return memoryRecordSeed{
		RecordID:  id,
		ScopeID:   scopeID,
		Kind:      "experience",
		Version:   1,
		Content:   []byte(`{"summary":"seed"}`),
		Lifecycle: "active",
		CreatedAt: ts,
		UpdatedAt: ts,
	}
}
