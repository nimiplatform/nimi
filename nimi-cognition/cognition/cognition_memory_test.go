package cognition

import (
	"strings"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/artifactref"
	"github.com/nimiplatform/nimi/nimi-cognition/internal/storage"
	"github.com/nimiplatform/nimi/nimi-cognition/knowledge"
	"github.com/nimiplatform/nimi/nimi-cognition/memory"
	"github.com/nimiplatform/nimi/nimi-cognition/routine"
	"github.com/nimiplatform/nimi/nimi-cognition/routine/digest"
	"github.com/nimiplatform/nimi/nimi-cognition/skill"
)

func TestMemorySaveRejectsKindContentMismatch(t *testing.T) { /* moved unchanged */
	c := newTestCognition(t)
	err := c.MemoryService().Save(memory.Record{RecordID: "m1", ScopeID: "a1", Kind: memory.RecordKindObservation, Version: 1, Content: []byte(`{"summary":"not an observation"}`), Lifecycle: memory.RecordLifecycleActive, CreatedAt: ts, UpdatedAt: ts})
	if err == nil || !strings.Contains(err.Error(), "observation.subject is required") {
		t.Fatalf("expected fail-closed kind/content validation, got %v", err)
	}
}

func TestMemoryDeleteAndHistory(t *testing.T) { /* moved unchanged */
	c := newTestCognition(t)
	rec := memory.Record{RecordID: "m1", ScopeID: "a1", Kind: memory.RecordKindExperience, Version: 1, Content: []byte(`{"summary":"history test"}`), Lifecycle: memory.RecordLifecycleActive, CreatedAt: ts, UpdatedAt: ts}
	if err := c.MemoryService().Save(rec); err != nil {
		t.Fatalf("save memory: %v", err)
	}
	history, err := c.MemoryService().History("a1", "m1")
	if err != nil {
		t.Fatalf("history after create: %v", err)
	}
	if len(history) != 1 || history[0].Action != memory.HistoryActionCreated {
		t.Fatalf("expected created history entry, got %+v", history)
	}
	if err := c.MemoryService().Delete("a1", "m1"); err != nil {
		t.Fatalf("delete memory: %v", err)
	}
	loaded, err := c.MemoryService().Load("a1", "m1")
	if err == nil || !strings.Contains(err.Error(), "does not exist") {
		t.Fatalf("expected deleted memory load to fail closed, got loaded=%+v err=%v", loaded, err)
	}
	history, err = c.MemoryService().History("a1", "m1")
	if err != nil {
		t.Fatalf("history after delete: %v", err)
	}
	if len(history) != 2 || history[0].Action != memory.HistoryActionDeleted {
		t.Fatalf("expected delete history entry, got %+v", history)
	}
}

func TestMemoryDeleteRejectsActiveCleanupBlocker(t *testing.T) { /* moved unchanged */
	c := newTestCognition(t)
	if err := c.InitScope("a1"); err != nil {
		t.Fatalf("init scope: %v", err)
	}
	if err := c.MemoryService().Save(memory.Record{RecordID: "m1", ScopeID: "a1", Kind: memory.RecordKindExperience, Version: 1, Content: []byte(`{"summary":"protected memory"}`), Lifecycle: memory.RecordLifecycleActive, CreatedAt: ts, UpdatedAt: ts}); err != nil {
		t.Fatalf("save memory: %v", err)
	}
	if err := c.KnowledgeService().Save(knowledge.Page{
		PageID: "p1", ScopeID: "a1", Kind: knowledge.ProjectionKindExplainer, Version: 1, Title: "Uses memory", Body: []byte(`"body"`), Lifecycle: knowledge.ProjectionLifecycleActive,
		ArtifactRefs: []artifactref.Ref{{FromKind: artifactref.KindKnowledgePage, FromID: "p1", ToKind: artifactref.KindMemoryRecord, ToID: "m1", Strength: artifactref.StrengthStrong, Role: "support", CreatedAt: ts, UpdatedAt: ts}},
		CreatedAt:    ts, UpdatedAt: ts,
	}); err != nil {
		t.Fatalf("save page: %v", err)
	}
	err := c.MemoryService().Delete("a1", "m1")
	if err == nil || !strings.Contains(err.Error(), "blocked by") {
		t.Fatalf("expected cleanup blocker error, got %v", err)
	}
}

func TestMemoryDelete_ActiveWeakBlocks_ArchivedWeakAllows(t *testing.T) { /* moved unchanged */
	c := newTestCognition(t)
	if err := c.InitScope("a1"); err != nil {
		t.Fatalf("init scope: %v", err)
	}
	if err := c.MemoryService().Save(memory.Record{RecordID: "m1", ScopeID: "a1", Kind: memory.RecordKindExperience, Version: 1, Content: []byte(`{"summary":"target"}`), Lifecycle: memory.RecordLifecycleActive, CreatedAt: ts, UpdatedAt: ts}); err != nil {
		t.Fatalf("save memory: %v", err)
	}
	page := knowledge.Page{
		PageID: "p1", ScopeID: "a1", Kind: knowledge.ProjectionKindExplainer, Version: 1, Title: "Weak source", Body: []byte(`"body"`), Lifecycle: knowledge.ProjectionLifecycleActive,
		ArtifactRefs: []artifactref.Ref{{FromKind: artifactref.KindKnowledgePage, FromID: "p1", ToKind: artifactref.KindMemoryRecord, ToID: "m1", Strength: artifactref.StrengthWeak, Role: "support", CreatedAt: ts, UpdatedAt: ts}},
		CreatedAt:    ts, UpdatedAt: ts,
	}
	if err := c.KnowledgeService().Save(page); err != nil {
		t.Fatalf("save active weak source: %v", err)
	}
	if err := c.MemoryService().Delete("a1", "m1"); err == nil || !strings.Contains(err.Error(), "weak_ref:knowledge_page/p1(active)") {
		t.Fatalf("expected active weak blocker, got %v", err)
	}
	ctx, err := c.NewRoutineContext("a1")
	if err != nil {
		t.Fatalf("new routine context: %v", err)
	}
	if err := ctx.Storage.ArchiveKnowledge("a1", "p1", ts.Add(time.Minute)); err != nil {
		t.Fatalf("archive weak source: %v", err)
	}
	if err := c.MemoryService().Delete("a1", "m1"); err != nil {
		t.Fatalf("delete memory with archived weak source: %v", err)
	}
}

func TestMemoryDeleteAndRemoveRejectKnowledgeCitationTargets(t *testing.T) {
	c := newTestCognition(t)
	if err := c.MemoryService().Save(memory.Record{
		RecordID:  "m1",
		ScopeID:   "a1",
		Kind:      memory.RecordKindExperience,
		Version:   1,
		Content:   []byte(`{"summary":"cited memory"}`),
		Lifecycle: memory.RecordLifecycleActive,
		CreatedAt: ts,
		UpdatedAt: ts,
	}); err != nil {
		t.Fatalf("save memory: %v", err)
	}
	page := knowledge.Page{
		PageID:    "p1",
		ScopeID:   "a1",
		Kind:      knowledge.ProjectionKindGuide,
		Version:   1,
		Title:     "Pinned page",
		Body:      []byte(`"body"`),
		Lifecycle: knowledge.ProjectionLifecycleActive,
		CreatedAt: ts,
		UpdatedAt: ts,
		Citations: []knowledge.Citation{{
			TargetKind: knowledge.CitationTargetKindMemoryRecord,
			TargetID:   "m1",
			Strength:   "strong_ref",
		}},
	}
	if err := c.KnowledgeService().Save(page); err != nil {
		t.Fatalf("save citing page: %v", err)
	}
	if err := c.MemoryService().Delete("a1", "m1"); err == nil || !strings.Contains(err.Error(), "knowledge_citation:knowledge_page/p1(active)") {
		t.Fatalf("expected knowledge citation delete blocker, got %v", err)
	}
	ctx, err := c.NewRoutineContext("a1")
	if err != nil {
		t.Fatalf("new routine context: %v", err)
	}
	if err := ctx.Storage.ArchiveMemory("a1", "m1", ts.Add(time.Minute)); err != nil {
		t.Fatalf("archive memory: %v", err)
	}
	if err := ctx.Storage.RemoveMemory("a1", "m1", ts.Add(2*time.Minute)); err == nil || !strings.Contains(err.Error(), "knowledge_citation:knowledge_page/p1(active)") {
		t.Fatalf("expected knowledge citation remove blocker, got %v", err)
	}
	if loaded, err := c.KnowledgeService().Load("a1", "p1"); err != nil || len(loaded.Citations) != 1 {
		t.Fatalf("expected cited page to remain loadable, got %+v err=%v", loaded, err)
	}
	if listed, err := c.KnowledgeService().List("a1"); err != nil || len(listed) != 1 {
		t.Fatalf("expected cited page to remain listable, got %+v err=%v", listed, err)
	}
	if results, err := c.KnowledgeService().SearchLexical("a1", "Pinned", 10); err != nil || len(results) != 1 {
		t.Fatalf("expected cited page to remain searchable, got %+v err=%v", results, err)
	}
	advisory, err := c.PromptService().FormatAdvisory("a1")
	if err != nil {
		t.Fatalf("format advisory: %v", err)
	}
	if !strings.Contains(advisory, "[citations=1 memory_records=1]") {
		t.Fatalf("expected citation summary after blocked target mutation, got %s", advisory)
	}
}

func TestMemoryDigestWorkerRemove_BlocksKnowledgeCitationTarget(t *testing.T) {
	c := newTestCognition(t)
	if err := c.InitScope("a1"); err != nil {
		t.Fatalf("init scope: %v", err)
	}
	if err := c.MemoryService().Save(memory.Record{
		RecordID:  "m1",
		ScopeID:   "a1",
		Kind:      memory.RecordKindExperience,
		Version:   1,
		Content:   []byte(`{"summary":"cited memory"}`),
		Lifecycle: memory.RecordLifecycleActive,
		CreatedAt: ts,
		UpdatedAt: ts,
	}); err != nil {
		t.Fatalf("save memory: %v", err)
	}
	if err := c.SkillService().Save(skill.Bundle{
		BundleID:  "s-support",
		ScopeID:   "a1",
		Version:   1,
		Status:    skill.BundleStatusActive,
		Name:      "Support peer",
		Steps:     []skill.Step{{StepID: "st1", Instruction: "Observe", Order: 1}},
		CreatedAt: ts,
		UpdatedAt: ts,
	}); err != nil {
		t.Fatalf("save support skill: %v", err)
	}
	if err := c.KnowledgeService().Save(knowledge.Page{
		PageID:    "p1",
		ScopeID:   "a1",
		Kind:      knowledge.ProjectionKindGuide,
		Version:   1,
		Title:     "Pinned page",
		Body:      []byte(`"body"`),
		Lifecycle: knowledge.ProjectionLifecycleActive,
		CreatedAt: ts,
		UpdatedAt: ts,
		Citations: []knowledge.Citation{{
			TargetKind: knowledge.CitationTargetKindMemoryRecord,
			TargetID:   "m1",
			Strength:   "strong_ref",
		}},
		ArtifactRefs: []artifactref.Ref{{
			FromKind:  artifactref.KindKnowledgePage,
			FromID:    "p1",
			ToKind:    artifactref.KindSkillBundle,
			ToID:      "s-support",
			Strength:  artifactref.StrengthStrong,
			Role:      "support",
			CreatedAt: ts,
			UpdatedAt: ts,
		}},
	}); err != nil {
		t.Fatalf("save citing page: %v", err)
	}
	if err := c.SkillService().Save(skill.Bundle{
		BundleID:  "s-support",
		ScopeID:   "a1",
		Version:   2,
		Status:    skill.BundleStatusActive,
		Name:      "Support peer",
		Steps:     []skill.Step{{StepID: "st1", Instruction: "Observe", Order: 1}},
		CreatedAt: ts,
		UpdatedAt: ts,
		ArtifactRefs: []artifactref.Ref{{
			FromKind:  artifactref.KindSkillBundle,
			FromID:    "s-support",
			ToKind:    artifactref.KindKnowledgePage,
			ToID:      "p1",
			Strength:  artifactref.StrengthStrong,
			Role:      "support",
			CreatedAt: ts,
			UpdatedAt: ts,
		}},
	}); err != nil {
		t.Fatalf("save support relation: %v", err)
	}
	ctx, err := c.NewRoutineContext("a1")
	if err != nil {
		t.Fatalf("new routine context: %v", err)
	}
	if err := ctx.Storage.ArchiveMemory("a1", "m1", ts.Add(time.Minute)); err != nil {
		t.Fatalf("archive memory: %v", err)
	}
	if _, err := digest.NewWorker(digest.Config{}).Run(ctx); err != nil {
		t.Fatalf("worker first pass: %v", err)
	}
	if _, err := digest.NewWorker(digest.Config{}).Run(ctx); err != nil {
		t.Fatalf("worker second pass: %v", err)
	}
	loaded, err := c.MemoryService().Load("a1", "m1")
	if err != nil {
		t.Fatalf("load memory after worker runs: %v", err)
	}
	if loaded.Lifecycle != memory.RecordLifecycleArchived {
		t.Fatalf("expected cited memory to remain archived on worker path, got %+v", loaded)
	}
	candidates := latestDigestCandidates(t, c, "a1")
	found := false
	for _, candidate := range candidates {
		if candidate.Family != "memory" || candidate.ArtifactKind != string(artifactref.KindMemoryRecord) || candidate.ArtifactID != "m1" {
			continue
		}
		if candidate.Action != "remove" || candidate.Status != "blocked" || candidate.Reason != "memory removal is blocked" {
			continue
		}
		detail := decodeBlockedDetail[digest.BlockedTransition](t, candidate.Detail)
		for _, blockedBy := range detail.BlockedBy {
			if blockedBy == "knowledge_citation:knowledge_page/p1(active)" {
				found = true
				break
			}
		}
		if found {
			break
		}
	}
	if !found {
		t.Fatalf("expected blocked digest evidence for knowledge citation target, got %+v", candidates)
	}
}

func TestMemoryArchiveRemoveDeleteLifecycle(t *testing.T) { /* moved unchanged */
	c := newTestCognition(t)
	if err := c.MemoryService().Save(memory.Record{RecordID: "m1", ScopeID: "a1", Kind: memory.RecordKindExperience, Version: 1, Content: []byte(`{"summary":"lifecycle memory"}`), Lifecycle: memory.RecordLifecycleActive, CreatedAt: ts, UpdatedAt: ts}); err != nil {
		t.Fatalf("save memory: %v", err)
	}
	ctx, err := c.NewRoutineContext("a1")
	if err != nil {
		t.Fatalf("new routine context: %v", err)
	}
	if err := ctx.Storage.ArchiveMemory("a1", "m1", ts.Add(time.Minute)); err != nil {
		t.Fatalf("archive memory: %v", err)
	}
	if err := ctx.Storage.RemoveMemory("a1", "m1", ts.Add(2*time.Minute)); err != nil {
		t.Fatalf("remove memory: %v", err)
	}
	loaded, err := c.MemoryService().Load("a1", "m1")
	if err != nil {
		t.Fatalf("load removed memory: %v", err)
	}
	if loaded.Lifecycle != memory.RecordLifecycleRemoved {
		t.Fatalf("expected removed lifecycle, got %+v", loaded)
	}
	listed, err := c.MemoryService().List("a1")
	if err != nil {
		t.Fatalf("list memory: %v", err)
	}
	if len(listed) != 0 {
		t.Fatalf("expected removed memory excluded from list, got %+v", listed)
	}
	if views, err := c.MemoryService().SearchViews("a1", "lifecycle", 10); err != nil {
		t.Fatalf("search views: %v", err)
	} else if len(views) != 0 {
		t.Fatalf("expected removed memory excluded from search views, got %+v", views)
	}
	history, err := c.MemoryService().History("a1", "m1")
	if err != nil {
		t.Fatalf("memory history: %v", err)
	}
	if len(history) < 3 || history[0].Action != memory.HistoryActionRemoved || history[1].Action != memory.HistoryActionArchived {
		t.Fatalf("expected archive/remove history, got %+v", history)
	}
	if err := c.MemoryService().Delete("a1", "m1"); err != nil {
		t.Fatalf("delete removed memory: %v", err)
	}
	if _, err := c.MemoryService().Load("a1", "m1"); err == nil || !strings.Contains(err.Error(), "does not exist") {
		t.Fatalf("expected deleted memory to disappear, got %v", err)
	}
}

func TestMemorySaveRejectsArchivedAndRemovedLifecycleMutation(t *testing.T) {
	c := newTestCognition(t)
	if err := c.MemoryService().Save(memory.Record{
		RecordID:  "m1",
		ScopeID:   "a1",
		Kind:      memory.RecordKindExperience,
		Version:   1,
		Content:   []byte(`{"summary":"live"}`),
		Lifecycle: memory.RecordLifecycleActive,
		CreatedAt: ts,
		UpdatedAt: ts,
	}); err != nil {
		t.Fatalf("save active memory: %v", err)
	}
	ctx, err := c.NewRoutineContext("a1")
	if err != nil {
		t.Fatalf("new routine context: %v", err)
	}
	if err := ctx.Storage.ArchiveMemory("a1", "m1", ts.Add(time.Minute)); err != nil {
		t.Fatalf("archive memory: %v", err)
	}
	err = c.MemoryService().Save(memory.Record{
		RecordID:  "m1",
		ScopeID:   "a1",
		Kind:      memory.RecordKindExperience,
		Version:   2,
		Content:   []byte(`{"summary":"resurrect"}`),
		Lifecycle: memory.RecordLifecycleActive,
		CreatedAt: ts,
		UpdatedAt: ts.Add(2 * time.Minute),
	})
	if err == nil || !strings.Contains(err.Error(), "illegal lifecycle mutation") {
		t.Fatalf("expected archived memory save rejection, got %v", err)
	}
	if err := ctx.Storage.RemoveMemory("a1", "m1", ts.Add(3*time.Minute)); err != nil {
		t.Fatalf("remove memory: %v", err)
	}
	err = c.MemoryService().Save(memory.Record{
		RecordID:  "m1",
		ScopeID:   "a1",
		Kind:      memory.RecordKindExperience,
		Version:   3,
		Content:   []byte(`{"summary":"resurrect removed"}`),
		Lifecycle: memory.RecordLifecycleActive,
		CreatedAt: ts,
		UpdatedAt: ts.Add(4 * time.Minute),
	})
	if err == nil || !strings.Contains(err.Error(), "illegal lifecycle mutation") {
		t.Fatalf("expected removed memory save rejection, got %v", err)
	}
}

func TestMemoryLifecyclePersistsAcrossReopen(t *testing.T) { /* moved unchanged */
	root := t.TempDir()
	c := newTestCognitionAt(t, root)
	if err := c.MemoryService().Save(memory.Record{RecordID: "m_removed", ScopeID: "a1", Kind: memory.RecordKindExperience, Version: 1, Content: []byte(`{"summary":"removed lifecycle persists"}`), Lifecycle: memory.RecordLifecycleActive, CreatedAt: ts, UpdatedAt: ts}); err != nil {
		t.Fatalf("save removed-candidate memory: %v", err)
	}
	if err := c.MemoryService().Save(memory.Record{RecordID: "m_deleted", ScopeID: "a1", Kind: memory.RecordKindExperience, Version: 1, Content: []byte(`{"summary":"deleted lifecycle persists"}`), Lifecycle: memory.RecordLifecycleActive, CreatedAt: ts, UpdatedAt: ts}); err != nil {
		t.Fatalf("save deleted-candidate memory: %v", err)
	}
	ctx, err := c.NewRoutineContext("a1")
	if err != nil {
		t.Fatalf("new routine context: %v", err)
	}
	if err := ctx.Storage.ArchiveMemory("a1", "m_removed", ts.Add(time.Minute)); err != nil {
		t.Fatalf("archive memory: %v", err)
	}
	if err := ctx.Storage.RemoveMemory("a1", "m_removed", ts.Add(2*time.Minute)); err != nil {
		t.Fatalf("remove memory: %v", err)
	}
	if err := c.MemoryService().Delete("a1", "m_deleted"); err != nil {
		t.Fatalf("delete memory: %v", err)
	}
	if err := c.Close(); err != nil {
		t.Fatalf("close cognition: %v", err)
	}
	reopened := newTestCognitionAt(t, root)
	defer reopened.Close()
	removed, err := reopened.MemoryService().Load("a1", "m_removed")
	if err != nil {
		t.Fatalf("load removed memory after reopen: %v", err)
	}
	if removed.Lifecycle != memory.RecordLifecycleRemoved {
		t.Fatalf("expected removed lifecycle after reopen, got %+v", removed)
	}
	if records, err := reopened.MemoryService().List("a1"); err != nil {
		t.Fatalf("list memory after reopen: %v", err)
	} else if len(records) != 0 {
		t.Fatalf("expected removed memory excluded after reopen, got %+v", records)
	}
	if views, err := reopened.MemoryService().SearchViews("a1", "removed lifecycle", 10); err != nil {
		t.Fatalf("search views after reopen: %v", err)
	} else if len(views) != 0 {
		t.Fatalf("expected removed memory excluded from search views after reopen, got %+v", views)
	}
	if history, err := reopened.MemoryService().History("a1", "m_removed"); err != nil {
		t.Fatalf("removed memory history after reopen: %v", err)
	} else if len(history) < 3 || history[0].Action != memory.HistoryActionRemoved || history[1].Action != memory.HistoryActionArchived {
		t.Fatalf("expected removed memory history after reopen, got %+v", history)
	}
	if _, err := reopened.MemoryService().Load("a1", "m_deleted"); err == nil || !strings.Contains(err.Error(), "does not exist") {
		t.Fatalf("expected deleted memory load failure after reopen, got %v", err)
	}
	if history, err := reopened.MemoryService().History("a1", "m_deleted"); err != nil {
		t.Fatalf("deleted memory history after reopen: %v", err)
	} else if len(history) < 2 || history[0].Action != memory.HistoryActionDeleted {
		t.Fatalf("expected deleted memory history after reopen, got %+v", history)
	}
}

func TestMemoryDigestWorkerRemove_ActiveWeakBlocks_ArchivedWeakAllows(t *testing.T) {
	c := newTestCognition(t)
	if err := c.InitScope("a1"); err != nil {
		t.Fatalf("init scope: %v", err)
	}
	if err := c.KnowledgeService().Save(knowledge.Page{
		PageID:    "ghost",
		ScopeID:   "a1",
		Kind:      knowledge.ProjectionKindExplainer,
		Version:   1,
		Title:     "Ghost",
		Body:      []byte(`"ghost"`),
		Lifecycle: knowledge.ProjectionLifecycleActive,
		CreatedAt: ts,
		UpdatedAt: ts,
	}); err != nil {
		t.Fatalf("save ghost page: %v", err)
	}
	if err := c.MemoryService().Save(memory.Record{
		RecordID:  "m1",
		ScopeID:   "a1",
		Kind:      memory.RecordKindExperience,
		Version:   1,
		Content:   []byte(`{"summary":"archived target"}`),
		Lifecycle: memory.RecordLifecycleActive,
		ArtifactRefs: []artifactref.Ref{{
			FromKind:  artifactref.KindMemoryRecord,
			FromID:    "m1",
			ToKind:    artifactref.KindKnowledgePage,
			ToID:      "ghost",
			Strength:  artifactref.StrengthStrong,
			Role:      "support",
			CreatedAt: ts,
			UpdatedAt: ts,
		}},
		CreatedAt: ts,
		UpdatedAt: ts,
	}); err != nil {
		t.Fatalf("save target memory: %v", err)
	}
	ctx, err := c.NewRoutineContext("a1")
	if err != nil {
		t.Fatalf("new routine context: %v", err)
	}
	if err := ctx.Storage.ArchiveMemory("a1", "m1", ts.Add(time.Minute)); err != nil {
		t.Fatalf("archive target memory: %v", err)
	}
	page := knowledge.Page{
		PageID:    "p1",
		ScopeID:   "a1",
		Kind:      knowledge.ProjectionKindExplainer,
		Version:   1,
		Title:     "Weak source",
		Body:      []byte(`"body"`),
		Lifecycle: knowledge.ProjectionLifecycleActive,
		CreatedAt: ts,
		UpdatedAt: ts,
		ArtifactRefs: []artifactref.Ref{{
			FromKind:  artifactref.KindKnowledgePage,
			FromID:    "p1",
			ToKind:    artifactref.KindMemoryRecord,
			ToID:      "m1",
			Strength:  artifactref.StrengthWeak,
			Role:      "support",
			CreatedAt: ts,
			UpdatedAt: ts,
		}, {
			FromKind:  artifactref.KindKnowledgePage,
			FromID:    "p1",
			ToKind:    artifactref.KindSkillBundle,
			ToID:      "s-support",
			Strength:  artifactref.StrengthStrong,
			Role:      "support",
			CreatedAt: ts,
			UpdatedAt: ts,
		}},
	}
	if err := c.SkillService().Save(skill.Bundle{
		BundleID:  "s-support",
		ScopeID:   "a1",
		Version:   1,
		Status:    skill.BundleStatusActive,
		Name:      "Support peer",
		Steps:     []skill.Step{{StepID: "st1", Instruction: "Observe", Order: 1}},
		CreatedAt: ts,
		UpdatedAt: ts,
	}); err != nil {
		t.Fatalf("save supporting skill stub: %v", err)
	}
	if err := c.KnowledgeService().Save(page); err != nil {
		t.Fatalf("save active weak source: %v", err)
	}
	if err := c.SkillService().Save(skill.Bundle{
		BundleID:  "s-support",
		ScopeID:   "a1",
		Version:   2,
		Status:    skill.BundleStatusActive,
		Name:      "Support peer",
		Steps:     []skill.Step{{StepID: "st1", Instruction: "Observe", Order: 1}},
		CreatedAt: ts,
		UpdatedAt: ts,
		ArtifactRefs: []artifactref.Ref{{
			FromKind:  artifactref.KindSkillBundle,
			FromID:    "s-support",
			ToKind:    artifactref.KindKnowledgePage,
			ToID:      "p1",
			Strength:  artifactref.StrengthStrong,
			Role:      "support",
			CreatedAt: ts,
			UpdatedAt: ts,
		}},
	}); err != nil {
		t.Fatalf("save supporting skill relation: %v", err)
	}
	if err := c.store.Delete("a1", storage.KindKnowledge, "ghost"); err != nil {
		t.Fatalf("delete ghost page fixture: %v", err)
	}
	if _, err := digest.NewWorker(digest.Config{}).Run(ctx); err != nil {
		t.Fatalf("worker first pass: %v", err)
	}
	if _, err := digest.NewWorker(digest.Config{}).Run(ctx); err != nil {
		t.Fatalf("worker second pass: %v", err)
	}
	loaded, err := c.MemoryService().Load("a1", "m1")
	if err != nil {
		t.Fatalf("load memory after blocked pass: %v", err)
	}
	if loaded.Lifecycle != memory.RecordLifecycleArchived {
		t.Fatalf("expected memory to remain archived while active weak source is live, got %+v", loaded)
	}
	candidates := latestDigestCandidates(t, c, "a1")
	found := false
	for _, candidate := range candidates {
		if candidate.ArtifactID != "m1" || candidate.Action != "remove" || candidate.Status != "blocked" {
			continue
		}
		detail := decodeBlockedDetail[digest.BlockedTransition](t, candidate.Detail)
		for _, blocker := range detail.Detail.Blockers {
			if blocker.Kind == routine.BlockerKindDownstreamLiveDependency && blocker.SourceID == "p1" {
				found = true
				break
			}
		}
	}
	if !found {
		t.Fatalf("expected blocked worker evidence with downstream_live_dependency, got %+v", candidates)
	}
	if err := ctx.Storage.ArchiveKnowledge("a1", "p1", ts.Add(time.Minute)); err != nil {
		t.Fatalf("archive weak source: %v", err)
	}
	if _, err := digest.NewWorker(digest.Config{}).Run(ctx); err != nil {
		t.Fatalf("worker third pass: %v", err)
	}
	loaded, err = c.MemoryService().Load("a1", "m1")
	if err != nil {
		t.Fatalf("load memory after archived weak source: %v", err)
	}
	if loaded.Lifecycle != memory.RecordLifecycleRemoved {
		t.Fatalf("expected archived weak source to allow remove on worker path, got %+v", loaded)
	}
}
