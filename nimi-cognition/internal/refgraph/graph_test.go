package refgraph

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/artifactref"
	"github.com/nimiplatform/nimi/nimi-cognition/internal/storage"
	"github.com/nimiplatform/nimi/nimi-cognition/knowledge"
	"github.com/nimiplatform/nimi/nimi-cognition/memory"
	"github.com/nimiplatform/nimi/nimi-cognition/routine"
)

var ts = time.Date(2026, 4, 16, 12, 0, 0, 0, time.UTC)

func TestService_RemoveBlockers_IgnoresRemovedSourceArtifacts(t *testing.T) {
	store, err := storage.NewSQLiteBackend(t.TempDir())
	if err != nil {
		t.Fatalf("new backend: %v", err)
	}

	target := memory.Record{
		RecordID:  "m1",
		ScopeID:   "a1",
		Kind:      memory.RecordKindExperience,
		Version:   1,
		Content:   []byte(`{"summary":"target"}`),
		Lifecycle: memory.RecordLifecycleArchived,
		CreatedAt: ts,
		UpdatedAt: ts,
	}
	targetRaw, _ := json.Marshal(target)
	if err := store.Save("a1", storage.KindMemory, "m1", targetRaw); err != nil {
		t.Fatalf("save target memory: %v", err)
	}

	source := knowledge.Page{
		PageID:    "p1",
		ScopeID:   "a1",
		Kind:      knowledge.ProjectionKindSummary,
		Version:   1,
		Title:     "Removed Source",
		Body:      []byte(`"body"`),
		Lifecycle: knowledge.ProjectionLifecycleRemoved,
		ArtifactRefs: []artifactref.Ref{{
			FromKind:  artifactref.KindKnowledgePage,
			FromID:    "p1",
			ToKind:    artifactref.KindMemoryRecord,
			ToID:      "m1",
			Strength:  artifactref.StrengthStrong,
			Role:      "support",
			CreatedAt: ts,
			UpdatedAt: ts,
		}},
		CreatedAt: ts,
		UpdatedAt: ts,
	}
	sourceRaw, _ := json.Marshal(source)
	if err := store.Save("a1", storage.KindKnowledge, "p1", sourceRaw); err != nil {
		t.Fatalf("save removed source page: %v", err)
	}

	service := New(store)
	blockers, err := service.RemoveBlockers("a1", artifactref.KindMemoryRecord, "m1")
	if err != nil {
		t.Fatalf("remove blockers: %v", err)
	}
	if len(blockers) != 0 {
		t.Fatalf("expected removed source not to block removal, got %+v", blockers)
	}

	summary, err := service.SupportSummary("a1", artifactref.KindMemoryRecord, "m1")
	if err != nil {
		t.Fatalf("support summary: %v", err)
	}
	if summary.Score != 0 || summary.Strong != 0 || summary.Weak != 0 {
		t.Fatalf("expected removed source not to contribute support, got %+v", summary)
	}
}

func TestService_BrokenTargets_TreatsRemovedTargetsAsBroken(t *testing.T) {
	store, err := storage.NewSQLiteBackend(t.TempDir())
	if err != nil {
		t.Fatalf("new backend: %v", err)
	}

	target := memory.Record{
		RecordID:  "m1",
		ScopeID:   "a1",
		Kind:      memory.RecordKindExperience,
		Version:   1,
		Content:   []byte(`{"summary":"removed"}`),
		Lifecycle: memory.RecordLifecycleRemoved,
		CreatedAt: ts,
		UpdatedAt: ts,
	}
	targetRaw, _ := json.Marshal(target)
	if err := store.Save("a1", storage.KindMemory, "m1", targetRaw); err != nil {
		t.Fatalf("save removed target memory: %v", err)
	}

	service := New(store)
	refs := []artifactref.Ref{{
		FromKind:  artifactref.KindKnowledgePage,
		FromID:    "p1",
		ToKind:    artifactref.KindMemoryRecord,
		ToID:      "m1",
		Strength:  artifactref.StrengthStrong,
		Role:      "support",
		CreatedAt: ts,
		UpdatedAt: ts,
	}}

	broken, err := service.BrokenTargets("a1", refs)
	if err != nil {
		t.Fatalf("broken targets: %v", err)
	}
	if len(broken) != 1 {
		t.Fatalf("expected removed target to count as broken, got %+v", broken)
	}

	outgoing, err := service.OutgoingSupport("a1", refs)
	if err != nil {
		t.Fatalf("outgoing support: %v", err)
	}
	if outgoing.Broken != 1 || outgoing.StrongLive != 0 || outgoing.WeakLive != 0 {
		t.Fatalf("expected removed target to count as broken outgoing dependency, got %+v", outgoing)
	}
}

func TestService_RemoveBlockers_ExposeActiveStrongActiveWeakAndArchivedWeakContext(t *testing.T) {
	store, err := storage.NewSQLiteBackend(t.TempDir())
	if err != nil {
		t.Fatalf("new backend: %v", err)
	}

	target := memory.Record{
		RecordID:  "m1",
		ScopeID:   "a1",
		Kind:      memory.RecordKindExperience,
		Version:   1,
		Content:   []byte(`{"summary":"target"}`),
		Lifecycle: memory.RecordLifecycleArchived,
		CreatedAt: ts,
		UpdatedAt: ts,
	}
	targetRaw, _ := json.Marshal(target)
	if err := store.Save("a1", storage.KindMemory, "m1", targetRaw); err != nil {
		t.Fatalf("save target memory: %v", err)
	}

	strongSource := knowledge.Page{
		PageID:    "p1",
		ScopeID:   "a1",
		Kind:      knowledge.ProjectionKindSummary,
		Version:   1,
		Title:     "Strong Source",
		Body:      []byte(`"body"`),
		Lifecycle: knowledge.ProjectionLifecycleActive,
		ArtifactRefs: []artifactref.Ref{{
			FromKind:  artifactref.KindKnowledgePage,
			FromID:    "p1",
			ToKind:    artifactref.KindMemoryRecord,
			ToID:      "m1",
			Strength:  artifactref.StrengthStrong,
			Role:      "support",
			CreatedAt: ts,
			UpdatedAt: ts,
		}},
		CreatedAt: ts,
		UpdatedAt: ts,
	}
	strongRaw, _ := json.Marshal(strongSource)
	if err := store.Save("a1", storage.KindKnowledge, "p1", strongRaw); err != nil {
		t.Fatalf("save strong source: %v", err)
	}

	activeWeakSource := knowledge.Page{
		PageID:    "p2",
		ScopeID:   "a1",
		Kind:      knowledge.ProjectionKindSummary,
		Version:   1,
		Title:     "Weak Source",
		Body:      []byte(`"body"`),
		Lifecycle: knowledge.ProjectionLifecycleActive,
		ArtifactRefs: []artifactref.Ref{{
			FromKind:  artifactref.KindKnowledgePage,
			FromID:    "p2",
			ToKind:    artifactref.KindMemoryRecord,
			ToID:      "m1",
			Strength:  artifactref.StrengthWeak,
			Role:      "support",
			CreatedAt: ts,
			UpdatedAt: ts,
		}},
		CreatedAt: ts,
		UpdatedAt: ts,
	}
	activeWeakRaw, _ := json.Marshal(activeWeakSource)
	if err := store.Save("a1", storage.KindKnowledge, "p2", activeWeakRaw); err != nil {
		t.Fatalf("save active weak source: %v", err)
	}

	archivedWeakSource := knowledge.Page{
		PageID:    "p3",
		ScopeID:   "a1",
		Kind:      knowledge.ProjectionKindSummary,
		Version:   1,
		Title:     "Archived Weak Source",
		Body:      []byte(`"body"`),
		Lifecycle: knowledge.ProjectionLifecycleArchived,
		ArtifactRefs: []artifactref.Ref{{
			FromKind:  artifactref.KindKnowledgePage,
			FromID:    "p3",
			ToKind:    artifactref.KindMemoryRecord,
			ToID:      "m1",
			Strength:  artifactref.StrengthWeak,
			Role:      "support",
			CreatedAt: ts,
			UpdatedAt: ts,
		}},
		CreatedAt: ts,
		UpdatedAt: ts,
	}
	archivedWeakRaw, _ := json.Marshal(archivedWeakSource)
	if err := store.Save("a1", storage.KindKnowledge, "p3", archivedWeakRaw); err != nil {
		t.Fatalf("save archived weak source: %v", err)
	}

	service := New(store)
	blockers, err := service.RemoveBlockers("a1", artifactref.KindMemoryRecord, "m1")
	if err != nil {
		t.Fatalf("remove blockers: %v", err)
	}
	if len(blockers) != 3 {
		t.Fatalf("expected strong, active weak, and archived weak blockers, got %+v", blockers)
	}
	var sawStrongActive bool
	var sawWeakActive bool
	var sawWeakArchived bool
	for _, blocker := range blockers {
		if blocker.Kind == routine.BlockerKindStrongRef && blocker.SourceID == "p1" && blocker.SourceActive {
			sawStrongActive = true
		}
		if blocker.Kind == routine.BlockerKindWeakRef && blocker.SourceID == "p2" && blocker.SourceActive {
			sawWeakActive = true
		}
		if blocker.Kind == routine.BlockerKindWeakRef && blocker.SourceID == "p3" && !blocker.SourceActive {
			sawWeakArchived = true
		}
	}
	if !sawStrongActive || !sawWeakActive || !sawWeakArchived {
		t.Fatalf("expected active strong, active weak, and archived weak blocker context, got %+v", blockers)
	}
}

func TestService_OutgoingHealth_ExplainsBrokenDependency(t *testing.T) {
	store, err := storage.NewSQLiteBackend(t.TempDir())
	if err != nil {
		t.Fatalf("new backend: %v", err)
	}

	service := New(store)
	health, err := service.OutgoingHealth("a1", []artifactref.Ref{{
		FromKind:  artifactref.KindMemoryRecord,
		FromID:    "m1",
		ToKind:    artifactref.KindKnowledgePage,
		ToID:      "ghost",
		Strength:  artifactref.StrengthStrong,
		Role:      "support",
		CreatedAt: ts,
		UpdatedAt: ts,
	}})
	if err != nil {
		t.Fatalf("outgoing health: %v", err)
	}
	if health.Broken != 1 || len(health.Dependencies) != 1 {
		t.Fatalf("expected one broken dependency, got %+v", health)
	}
	if health.Dependencies[0].Status != routine.DependencyStatusBrokenTarget {
		t.Fatalf("expected broken target status, got %+v", health.Dependencies[0])
	}
}
