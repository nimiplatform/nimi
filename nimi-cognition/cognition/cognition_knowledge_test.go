package cognition

import (
	"database/sql"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/artifactref"
	"github.com/nimiplatform/nimi/nimi-cognition/internal/storage"
	"github.com/nimiplatform/nimi/nimi-cognition/kernel"
	"github.com/nimiplatform/nimi/nimi-cognition/knowledge"
	"github.com/nimiplatform/nimi/nimi-cognition/memory"
	"github.com/nimiplatform/nimi/nimi-cognition/routine"
	"github.com/nimiplatform/nimi/nimi-cognition/routine/digest"
	"github.com/nimiplatform/nimi/nimi-cognition/skill"
	_ "modernc.org/sqlite"
)

func TestKnowledgeRelationTraverseAndHistory(t *testing.T) {
	c := newTestCognition(t)
	pages := []knowledge.Page{
		{PageID: "p1", ScopeID: "a1", Kind: knowledge.ProjectionKindExplainer, Version: 1, Title: "Root", Body: []byte(`"root page"`), Lifecycle: knowledge.ProjectionLifecycleActive, CreatedAt: ts, UpdatedAt: ts},
		{PageID: "p2", ScopeID: "a1", Kind: knowledge.ProjectionKindGuide, Version: 1, Title: "Child", Body: []byte(`"child page"`), Lifecycle: knowledge.ProjectionLifecycleActive, CreatedAt: ts, UpdatedAt: ts},
		{PageID: "p3", ScopeID: "a1", Kind: knowledge.ProjectionKindNote, Version: 1, Title: "Grandchild", Body: []byte(`"grandchild page"`), Lifecycle: knowledge.ProjectionLifecycleActive, CreatedAt: ts, UpdatedAt: ts},
	}
	for _, page := range pages {
		if err := c.KnowledgeService().Save(page); err != nil {
			t.Fatalf("save page %s: %v", page.PageID, err)
		}
	}
	if err := c.KnowledgeService().PutRelation(knowledge.Relation{ScopeID: "a1", FromPageID: "p1", ToPageID: "p2", RelationType: "supports", Strength: artifactref.StrengthStrong, CreatedAt: ts, UpdatedAt: ts}); err != nil {
		t.Fatalf("put relation p1->p2: %v", err)
	}
	if err := c.KnowledgeService().PutRelation(knowledge.Relation{ScopeID: "a1", FromPageID: "p2", ToPageID: "p3", RelationType: "extends", Strength: artifactref.StrengthWeak, CreatedAt: ts, UpdatedAt: ts}); err != nil {
		t.Fatalf("put relation p2->p3: %v", err)
	}
	outgoing, err := c.KnowledgeService().ListRelations("a1", "p1")
	if err != nil || len(outgoing) != 1 || outgoing[0].ToPageID != "p2" || outgoing[0].RelationType != "supports" {
		t.Fatalf("unexpected outgoing relations: %+v err=%v", outgoing, err)
	}
	backlinks, err := c.KnowledgeService().ListBacklinks("a1", "p2")
	if err != nil || len(backlinks) != 1 || backlinks[0].FromPageID != "p1" {
		t.Fatalf("unexpected backlinks: %+v err=%v", backlinks, err)
	}
	traversal, err := c.KnowledgeService().Traverse("a1", "p1", 2)
	if err != nil || len(traversal) != 2 || traversal[0].PageID != "p2" || traversal[1].PageID != "p3" {
		t.Fatalf("unexpected traversal: %+v err=%v", traversal, err)
	}
	history, err := c.KnowledgeService().History("a1", "p1")
	if err != nil || len(history) == 0 || history[0].Action == "" {
		t.Fatalf("expected knowledge history, got %+v err=%v", history, err)
	}
	if err := c.KnowledgeService().DeleteRelation("a1", "p2", "p3", "extends"); err != nil {
		t.Fatalf("delete relation p2->p3: %v", err)
	}
	if err := c.KnowledgeService().Delete("a1", "p3"); err != nil {
		t.Fatalf("delete knowledge page: %v", err)
	}
	if _, err := c.KnowledgeService().Load("a1", "p3"); err == nil || !strings.Contains(err.Error(), "does not exist") {
		t.Fatalf("expected deleted knowledge load to fail closed, got %v", err)
	}
	history, err = c.KnowledgeService().History("a1", "p3")
	if err != nil || len(history) < 2 || history[0].Action != knowledge.HistoryActionDeleted {
		t.Fatalf("expected delete history entry, got %+v err=%v", history, err)
	}
}

func TestKnowledgeDeleteRejectsActiveRelationBlocker(t *testing.T) {
	c := newTestCognition(t)
	if err := c.InitScope("a1"); err != nil {
		t.Fatalf("init scope: %v", err)
	}
	for _, page := range []knowledge.Page{
		{PageID: "p1", ScopeID: "a1", Kind: knowledge.ProjectionKindExplainer, Version: 1, Title: "Parent", Body: []byte(`"parent"`), Lifecycle: knowledge.ProjectionLifecycleActive, CreatedAt: ts, UpdatedAt: ts},
		{PageID: "p2", ScopeID: "a1", Kind: knowledge.ProjectionKindGuide, Version: 1, Title: "Child", Body: []byte(`"child"`), Lifecycle: knowledge.ProjectionLifecycleActive, CreatedAt: ts, UpdatedAt: ts},
	} {
		if err := c.KnowledgeService().Save(page); err != nil {
			t.Fatalf("save page %s: %v", page.PageID, err)
		}
	}
	if err := c.KnowledgeService().PutRelation(knowledge.Relation{ScopeID: "a1", FromPageID: "p1", ToPageID: "p2", RelationType: "supports", Strength: artifactref.StrengthStrong, CreatedAt: ts, UpdatedAt: ts}); err != nil {
		t.Fatalf("put relation: %v", err)
	}
	err := c.KnowledgeService().Delete("a1", "p2")
	if err == nil || !strings.Contains(err.Error(), "blocked by") {
		t.Fatalf("expected relation blocker error, got %v", err)
	}
}

func TestKnowledgeDelete_IgnoresArchivedWeakArtifactBlocker(t *testing.T) {
	c := newTestCognition(t)
	if err := c.InitScope("a1"); err != nil {
		t.Fatalf("init scope: %v", err)
	}
	page := knowledge.Page{PageID: "p1", ScopeID: "a1", Kind: knowledge.ProjectionKindExplainer, Version: 1, Title: "Target", Body: []byte(`"body"`), Lifecycle: knowledge.ProjectionLifecycleActive, CreatedAt: ts, UpdatedAt: ts}
	if err := c.KnowledgeService().Save(page); err != nil {
		t.Fatalf("save page: %v", err)
	}
	if err := c.SkillService().Save(skill.Bundle{
		BundleID: "s1", ScopeID: "a1", Version: 1, Status: skill.BundleStatusActive, Name: "Archived skill", Steps: []skill.Step{{StepID: "st1", Instruction: "Inspect", Order: 1}},
		ArtifactRefs: []artifactref.Ref{{FromKind: artifactref.KindSkillBundle, FromID: "s1", ToKind: artifactref.KindKnowledgePage, ToID: "p1", Strength: artifactref.StrengthWeak, Role: "support", CreatedAt: ts, UpdatedAt: ts}},
		CreatedAt:    ts, UpdatedAt: ts,
	}); err != nil {
		t.Fatalf("save archived weak skill: %v", err)
	}
	ctx, err := c.NewRoutineContext("a1")
	if err != nil {
		t.Fatalf("new routine context: %v", err)
	}
	if err := ctx.Storage.ArchiveSkill("a1", "s1", ts.Add(time.Minute)); err != nil {
		t.Fatalf("archive weak skill: %v", err)
	}
	if err := c.KnowledgeService().Delete("a1", "p1"); err != nil {
		t.Fatalf("delete knowledge with archived weak source: %v", err)
	}
}

func TestKnowledgeArchiveRemoveLifecycle(t *testing.T) {
	c := newTestCognition(t)
	page := knowledge.Page{PageID: "p1", ScopeID: "a1", Kind: knowledge.ProjectionKindExplainer, Version: 1, Title: "Lifecycle page", Body: []byte(`"body"`), Lifecycle: knowledge.ProjectionLifecycleActive, CreatedAt: ts, UpdatedAt: ts}
	if err := c.KnowledgeService().Save(page); err != nil {
		t.Fatalf("save page: %v", err)
	}
	ctx, err := c.NewRoutineContext("a1")
	if err != nil {
		t.Fatalf("new routine context: %v", err)
	}
	if err := ctx.Storage.ArchiveKnowledge("a1", "p1", ts.Add(time.Minute)); err != nil {
		t.Fatalf("archive knowledge: %v", err)
	}
	if err := ctx.Storage.RemoveKnowledge("a1", "p1", ts.Add(2*time.Minute)); err != nil {
		t.Fatalf("remove knowledge: %v", err)
	}
	loaded, err := c.KnowledgeService().Load("a1", "p1")
	if err != nil || loaded.Lifecycle != knowledge.ProjectionLifecycleRemoved {
		t.Fatalf("expected removed page lifecycle, got %+v err=%v", loaded, err)
	}
	listed, err := c.KnowledgeService().List("a1")
	if err != nil || len(listed) != 0 {
		t.Fatalf("expected removed page excluded from list, got %+v err=%v", listed, err)
	}
	history, err := c.KnowledgeService().History("a1", "p1")
	if err != nil || len(history) < 3 || history[0].Action != knowledge.HistoryActionRemoved || history[1].Action != knowledge.HistoryActionArchived {
		t.Fatalf("expected archive/remove history, got %+v err=%v", history, err)
	}
}

func TestKnowledgeLifecycleRetrievalAndIngestPersistAcrossReopen(t *testing.T) {
	root := t.TempDir()
	c := newTestCognitionAt(t, root)
	for _, page := range []knowledge.Page{
		{PageID: "root", ScopeID: "a1", Kind: knowledge.ProjectionKindExplainer, Version: 1, Title: "Go interfaces", Body: []byte(`"Interfaces are implicit."`), Lifecycle: knowledge.ProjectionLifecycleActive, CreatedAt: ts, UpdatedAt: ts},
		{PageID: "child", ScopeID: "a1", Kind: knowledge.ProjectionKindGuide, Version: 1, Title: "Method sets", Body: []byte(`"Method sets explain interface satisfaction."`), Lifecycle: knowledge.ProjectionLifecycleActive, CreatedAt: ts, UpdatedAt: ts},
		{PageID: "p_removed", ScopeID: "a1", Kind: knowledge.ProjectionKindSummary, Version: 1, Title: "Removed page", Body: []byte(`"removed page body"`), Lifecycle: knowledge.ProjectionLifecycleActive, CreatedAt: ts, UpdatedAt: ts},
		{PageID: "p_deleted", ScopeID: "a1", Kind: knowledge.ProjectionKindSummary, Version: 1, Title: "Deleted page", Body: []byte(`"deleted page body"`), Lifecycle: knowledge.ProjectionLifecycleActive, CreatedAt: ts, UpdatedAt: ts},
	} {
		if err := c.KnowledgeService().Save(page); err != nil {
			t.Fatalf("save page %s: %v", page.PageID, err)
		}
	}
	if err := c.KnowledgeService().PutRelation(knowledge.Relation{ScopeID: "a1", FromPageID: "root", ToPageID: "child", RelationType: "supports", Strength: artifactref.StrengthStrong, CreatedAt: ts, UpdatedAt: ts}); err != nil {
		t.Fatalf("put relation: %v", err)
	}
	completedTask, err := c.KnowledgeService().IngestDocument("a1", knowledge.IngestEnvelope{PageID: "ingested", Kind: knowledge.ProjectionKindSummary, Title: "Ingested page", Body: []byte(`"ingested body"`)})
	if err != nil {
		t.Fatalf("ingest document: %v", err)
	}
	waitForIngestTaskStatus(t, c.KnowledgeService(), "a1", completedTask.TaskID, knowledge.IngestTaskStatusCompleted)
	interruptedTask := knowledge.IngestTask{TaskID: "interrupted_ingest", ScopeID: "a1", Status: knowledge.IngestTaskStatusRunning, ProgressPercent: 50, PageID: "broken", CreatedAt: ts, UpdatedAt: ts}
	if err := c.store.SaveKnowledgeIngestTask(interruptedTask); err != nil {
		t.Fatalf("seed interrupted ingest task: %v", err)
	}
	ctx, err := c.NewRoutineContext("a1")
	if err != nil {
		t.Fatalf("new routine context: %v", err)
	}
	if err := ctx.Storage.ArchiveKnowledge("a1", "p_removed", ts.Add(time.Minute)); err != nil {
		t.Fatalf("archive knowledge: %v", err)
	}
	if err := ctx.Storage.RemoveKnowledge("a1", "p_removed", ts.Add(2*time.Minute)); err != nil {
		t.Fatalf("remove knowledge: %v", err)
	}
	if err := c.KnowledgeService().Delete("a1", "p_deleted"); err != nil {
		t.Fatalf("delete knowledge: %v", err)
	}
	if err := c.Close(); err != nil {
		t.Fatalf("close cognition: %v", err)
	}
	reopened := newTestCognitionAt(t, root)
	defer reopened.Close()
	if relations, err := reopened.KnowledgeService().ListRelations("a1", "root"); err != nil || len(relations) != 1 || relations[0].ToPageID != "child" {
		t.Fatalf("unexpected relations after reopen: %+v err=%v", relations, err)
	}
	if backlinks, err := reopened.KnowledgeService().ListBacklinks("a1", "child"); err != nil || len(backlinks) != 1 || backlinks[0].FromPageID != "root" {
		t.Fatalf("unexpected backlinks after reopen: %+v err=%v", backlinks, err)
	}
	if results, err := reopened.KnowledgeService().SearchHybrid("a1", "interfaces", 10); err != nil || len(results) < 2 || results[0].PageID != "root" {
		t.Fatalf("unexpected hybrid results after reopen: %+v err=%v", results, err)
	}
	if task, err := reopened.KnowledgeService().GetIngestTask("a1", completedTask.TaskID); err != nil || task == nil || task.Status != knowledge.IngestTaskStatusCompleted {
		t.Fatalf("unexpected completed ingest task after reopen: %+v err=%v", task, err)
	}
	if task, err := reopened.KnowledgeService().GetIngestTask("a1", interruptedTask.TaskID); err != nil || task == nil || task.Status != knowledge.IngestTaskStatusFailed {
		t.Fatalf("unexpected failed ingest task after reopen: %+v err=%v", task, err)
	}
	if removed, err := reopened.KnowledgeService().Load("a1", "p_removed"); err != nil || removed.Lifecycle != knowledge.ProjectionLifecycleRemoved {
		t.Fatalf("expected removed page after reopen, got %+v err=%v", removed, err)
	}
	if results, err := reopened.KnowledgeService().SearchLexical("a1", "removed page", 10); err != nil || len(results) != 0 {
		t.Fatalf("expected removed page excluded from lexical search after reopen, got %+v err=%v", results, err)
	}
	if history, err := reopened.KnowledgeService().History("a1", "p_removed"); err != nil || len(history) < 3 || history[0].Action != knowledge.HistoryActionRemoved || history[1].Action != knowledge.HistoryActionArchived {
		t.Fatalf("expected removed page history after reopen, got %+v err=%v", history, err)
	}
	if _, err := reopened.KnowledgeService().Load("a1", "p_deleted"); err == nil || !strings.Contains(err.Error(), "does not exist") {
		t.Fatalf("expected deleted page load failure after reopen, got %v", err)
	}
	if history, err := reopened.KnowledgeService().History("a1", "p_deleted"); err != nil || len(history) < 2 || history[0].Action != knowledge.HistoryActionDeleted {
		t.Fatalf("expected deleted page history after reopen, got %+v err=%v", history, err)
	}
}

func TestKnowledgeDigestWorkerRemove_BlocksActiveStrong(t *testing.T) {
	c := newTestCognition(t)
	if err := c.InitScope("a1"); err != nil {
		t.Fatalf("init scope: %v", err)
	}
	if err := c.MemoryService().Save(memory.Record{
		RecordID:  "ghost",
		ScopeID:   "a1",
		Kind:      memory.RecordKindExperience,
		Version:   1,
		Content:   []byte(`{"summary":"ghost"}`),
		Lifecycle: memory.RecordLifecycleActive,
		CreatedAt: ts,
		UpdatedAt: ts,
	}); err != nil {
		t.Fatalf("save ghost memory: %v", err)
	}
	if err := c.KnowledgeService().Save(knowledge.Page{
		PageID:    "p1",
		ScopeID:   "a1",
		Kind:      knowledge.ProjectionKindSummary,
		Version:   1,
		Title:     "Archived target",
		Body:      []byte(`"body"`),
		Lifecycle: knowledge.ProjectionLifecycleActive,
		CreatedAt: ts,
		UpdatedAt: ts,
		ArtifactRefs: []artifactref.Ref{{
			FromKind:  artifactref.KindKnowledgePage,
			FromID:    "p1",
			ToKind:    artifactref.KindMemoryRecord,
			ToID:      "ghost",
			Strength:  artifactref.StrengthStrong,
			Role:      "support",
			CreatedAt: ts,
			UpdatedAt: ts,
		}},
	}); err != nil {
		t.Fatalf("save target page: %v", err)
	}
	ctx, err := c.NewRoutineContext("a1")
	if err != nil {
		t.Fatalf("new routine context: %v", err)
	}
	if err := ctx.Storage.ArchiveKnowledge("a1", "p1", ts.Add(time.Minute)); err != nil {
		t.Fatalf("archive target page: %v", err)
	}
	if err := c.MemoryService().Save(memory.Record{
		RecordID:  "m2",
		ScopeID:   "a1",
		Kind:      memory.RecordKindExperience,
		Version:   1,
		Content:   []byte(`{"summary":"support peer"}`),
		Lifecycle: memory.RecordLifecycleActive,
		CreatedAt: ts,
		UpdatedAt: ts,
	}); err != nil {
		t.Fatalf("save support peer stub: %v", err)
	}
	if err := c.MemoryService().Save(memory.Record{
		RecordID:  "m1",
		ScopeID:   "a1",
		Kind:      memory.RecordKindExperience,
		Version:   1,
		Content:   []byte(`{"summary":"strong source"}`),
		Lifecycle: memory.RecordLifecycleActive,
		CreatedAt: ts,
		UpdatedAt: ts,
		ArtifactRefs: []artifactref.Ref{{
			FromKind:  artifactref.KindMemoryRecord,
			FromID:    "m1",
			ToKind:    artifactref.KindKnowledgePage,
			ToID:      "p1",
			Strength:  artifactref.StrengthStrong,
			Role:      "support",
			CreatedAt: ts,
			UpdatedAt: ts,
		}, {
			FromKind:  artifactref.KindMemoryRecord,
			FromID:    "m1",
			ToKind:    artifactref.KindMemoryRecord,
			ToID:      "m2",
			Strength:  artifactref.StrengthStrong,
			Role:      "support",
			CreatedAt: ts,
			UpdatedAt: ts,
		}},
	}); err != nil {
		t.Fatalf("save strong source: %v", err)
	}
	if err := c.MemoryService().Save(memory.Record{
		RecordID:  "m2",
		ScopeID:   "a1",
		Kind:      memory.RecordKindExperience,
		Version:   2,
		Content:   []byte(`{"summary":"support peer"}`),
		Lifecycle: memory.RecordLifecycleActive,
		CreatedAt: ts,
		UpdatedAt: ts,
		ArtifactRefs: []artifactref.Ref{{
			FromKind:  artifactref.KindMemoryRecord,
			FromID:    "m2",
			ToKind:    artifactref.KindMemoryRecord,
			ToID:      "m1",
			Strength:  artifactref.StrengthStrong,
			Role:      "support",
			CreatedAt: ts,
			UpdatedAt: ts,
		}},
	}); err != nil {
		t.Fatalf("save support peer relation: %v", err)
	}
	if err := c.store.Delete("a1", storage.KindMemory, "ghost"); err != nil {
		t.Fatalf("delete ghost memory fixture: %v", err)
	}
	if _, err := digest.NewWorker(digest.Config{}).Run(ctx); err != nil {
		t.Fatalf("worker first pass: %v", err)
	}
	if _, err := digest.NewWorker(digest.Config{}).Run(ctx); err != nil {
		t.Fatalf("worker second pass: %v", err)
	}
	page, err := c.KnowledgeService().Load("a1", "p1")
	if err != nil {
		t.Fatalf("load page after worker runs: %v", err)
	}
	if page.Lifecycle != knowledge.ProjectionLifecycleArchived {
		t.Fatalf("expected active strong blocker to keep page archived, got %+v", page)
	}
	candidates := latestDigestCandidates(t, c, "a1")
	found := false
	for _, candidate := range candidates {
		if candidate.ArtifactID != "p1" || candidate.Action != "remove" || candidate.Status != "blocked" {
			continue
		}
		detail := decodeBlockedDetail[digest.BlockedTransition](t, candidate.Detail)
		for _, blocker := range detail.Detail.Blockers {
			if blocker.Kind == routine.BlockerKindStrongRef && blocker.SourceID == "m1" {
				found = true
				break
			}
		}
	}
	if !found {
		t.Fatalf("expected structured strong-ref blocker in worker evidence, got %+v", candidates)
	}
}

func TestKnowledgeDigestWorkerRemove_BasisChangeNeedsFreshConfirmation(t *testing.T) {
	c := newTestCognition(t)
	if err := c.InitScope("a1"); err != nil {
		t.Fatalf("init scope: %v", err)
	}
	if err := c.MemoryService().Save(memory.Record{
		RecordID:  "ghost",
		ScopeID:   "a1",
		Kind:      memory.RecordKindExperience,
		Version:   1,
		Content:   []byte(`{"summary":"ghost"}`),
		Lifecycle: memory.RecordLifecycleActive,
		CreatedAt: ts,
		UpdatedAt: ts,
	}); err != nil {
		t.Fatalf("save ghost memory: %v", err)
	}
	page := knowledge.Page{
		PageID:    "p1",
		ScopeID:   "a1",
		Kind:      knowledge.ProjectionKindSummary,
		Version:   1,
		Title:     "Basis shift",
		Body:      []byte(`"body"`),
		Lifecycle: knowledge.ProjectionLifecycleActive,
		CreatedAt: ts,
		UpdatedAt: ts,
		ArtifactRefs: []artifactref.Ref{{
			FromKind:  artifactref.KindKnowledgePage,
			FromID:    "p1",
			ToKind:    artifactref.KindMemoryRecord,
			ToID:      "ghost",
			Strength:  artifactref.StrengthStrong,
			Role:      "support",
			CreatedAt: ts,
			UpdatedAt: ts,
		}},
	}
	if err := c.KnowledgeService().Save(page); err != nil {
		t.Fatalf("save knowledge page: %v", err)
	}
	ctx, err := c.NewRoutineContext("a1")
	if err != nil {
		t.Fatalf("new routine context: %v", err)
	}
	if err := ctx.Storage.ArchiveKnowledge("a1", "p1", ts.Add(time.Minute)); err != nil {
		t.Fatalf("archive knowledge page: %v", err)
	}
	if err := c.store.Delete("a1", storage.KindMemory, "ghost"); err != nil {
		t.Fatalf("delete ghost memory fixture: %v", err)
	}
	if _, err := digest.NewWorker(digest.Config{}).Run(ctx); err != nil {
		t.Fatalf("worker first pass: %v", err)
	}
	page.Version = 2
	page.Lifecycle = knowledge.ProjectionLifecycleArchived
	page.ArtifactRefs = nil
	page.UpdatedAt = ts.Add(time.Minute)
	raw, err := json.Marshal(page)
	if err != nil {
		t.Fatalf("marshal zero-support page: %v", err)
	}
	if err := c.store.Save("a1", storage.KindKnowledge, "p1", raw); err != nil {
		t.Fatalf("save zero-support page fixture: %v", err)
	}
	if _, err := digest.NewWorker(digest.Config{}).Run(ctx); err != nil {
		t.Fatalf("worker second pass: %v", err)
	}
	loaded, err := c.KnowledgeService().Load("a1", "p1")
	if err != nil {
		t.Fatalf("load page after basis change: %v", err)
	}
	if loaded.Lifecycle != knowledge.ProjectionLifecycleArchived {
		t.Fatalf("expected basis-changed candidate to remain archived, got %+v", loaded)
	}
	candidates := latestDigestCandidates(t, c, "a1")
	found := false
	for _, candidate := range candidates {
		if candidate.ArtifactID != "p1" || candidate.Action != "remove" || candidate.Status != "blocked" {
			continue
		}
		found = true
		break
	}
	if !found {
		t.Fatalf("expected basis-changed candidate to remain blocked on the next pass, got %+v", candidates)
	}
	if _, err := digest.NewWorker(digest.Config{}).Run(ctx); err != nil {
		t.Fatalf("worker third pass: %v", err)
	}
	loaded, err = c.KnowledgeService().Load("a1", "p1")
	if err != nil {
		t.Fatalf("load page after third pass: %v", err)
	}
	if loaded.Lifecycle != knowledge.ProjectionLifecycleRemoved {
		t.Fatalf("expected third pass to remove after repeated zero-support basis, got %+v", loaded)
	}
}

func TestKnowledgeHybridSearchAndIngestTask(t *testing.T) {
	c := newTestCognition(t)
	root := knowledge.Page{PageID: "root", ScopeID: "a1", Kind: knowledge.ProjectionKindExplainer, Version: 1, Title: "Go interfaces", Body: []byte(`"Interfaces are implicit."`), Lifecycle: knowledge.ProjectionLifecycleActive, CreatedAt: ts, UpdatedAt: ts}
	child := knowledge.Page{PageID: "child", ScopeID: "a1", Kind: knowledge.ProjectionKindGuide, Version: 1, Title: "Method sets", Body: []byte(`"Method sets explain interface satisfaction."`), Lifecycle: knowledge.ProjectionLifecycleActive, CreatedAt: ts, UpdatedAt: ts}
	if err := c.KnowledgeService().Save(root); err != nil {
		t.Fatalf("save root page: %v", err)
	}
	if err := c.KnowledgeService().Save(child); err != nil {
		t.Fatalf("save child page: %v", err)
	}
	if err := c.KnowledgeService().PutRelation(knowledge.Relation{ScopeID: "a1", FromPageID: "root", ToPageID: "child", RelationType: "supports", Strength: artifactref.StrengthStrong, CreatedAt: ts, UpdatedAt: ts}); err != nil {
		t.Fatalf("put relation: %v", err)
	}
	results, err := c.KnowledgeService().SearchHybrid("a1", "interfaces", 10)
	if err != nil || len(results) < 2 || results[0].PageID != "root" {
		t.Fatalf("expected root-first hybrid results, got %+v err=%v", results, err)
	}
	foundChild := false
	for _, page := range results {
		if page.PageID == "child" {
			foundChild = true
			break
		}
	}
	if !foundChild {
		t.Fatalf("expected vector-backed child match in hybrid results, got %+v", results)
	}
	task, err := c.KnowledgeService().IngestDocument("a1", knowledge.IngestEnvelope{PageID: "ingested", Kind: knowledge.ProjectionKindSummary, Title: "Ingested page", Body: []byte(`"ingested body"`)})
	if err != nil {
		t.Fatalf("ingest document: %v", err)
	}
	if task == nil || task.Status != knowledge.IngestTaskStatusQueued || task.ProgressPercent != 0 {
		t.Fatalf("unexpected ingest task: %+v", task)
	}
	loadedTask := waitForIngestTaskStatus(t, c.KnowledgeService(), "a1", task.TaskID, knowledge.IngestTaskStatusCompleted)
	if loadedTask == nil || loadedTask.TaskID != task.TaskID || loadedTask.ProgressPercent != 100 {
		t.Fatalf("expected persisted completed ingest task, got %+v", loadedTask)
	}
	failedTask, err := c.KnowledgeService().IngestDocument("a1", knowledge.IngestEnvelope{PageID: "broken", Kind: knowledge.ProjectionKindSummary, Title: "", Body: []byte(`"missing title should fail"`)})
	if err == nil || failedTask != nil {
		t.Fatalf("expected failed ingest task plus error, got task=%+v err=%v", failedTask, err)
	}
}

func TestKnowledgeIngestFailsInsteadOfResurrectingArchivedOrRemovedPage(t *testing.T) {
	c := newTestCognition(t)
	page := knowledge.Page{PageID: "p1", ScopeID: "a1", Kind: knowledge.ProjectionKindSummary, Version: 1, Title: "Target", Body: []byte(`"body"`), Lifecycle: knowledge.ProjectionLifecycleActive, CreatedAt: ts, UpdatedAt: ts}
	if err := c.KnowledgeService().Save(page); err != nil {
		t.Fatalf("save page: %v", err)
	}
	ctx, err := c.NewRoutineContext("a1")
	if err != nil {
		t.Fatalf("new routine context: %v", err)
	}
	if err := ctx.Storage.ArchiveKnowledge("a1", "p1", ts.Add(time.Minute)); err != nil {
		t.Fatalf("archive page: %v", err)
	}
	task, err := c.KnowledgeService().IngestDocument("a1", knowledge.IngestEnvelope{PageID: "p1", Kind: knowledge.ProjectionKindSummary, Title: "Updated", Body: []byte(`"updated"`)})
	if err != nil {
		t.Fatalf("ingest archived page: %v", err)
	}
	archivedTask := waitForIngestTaskStatus(t, c.KnowledgeService(), "a1", task.TaskID, knowledge.IngestTaskStatusFailed)
	if !strings.Contains(archivedTask.Error, "cannot be updated from archived") {
		t.Fatalf("expected archived ingest failure reason, got %+v", archivedTask)
	}
	if err := ctx.Storage.RemoveKnowledge("a1", "p1", ts.Add(2*time.Minute)); err != nil {
		t.Fatalf("remove page: %v", err)
	}
	task, err = c.KnowledgeService().IngestDocument("a1", knowledge.IngestEnvelope{PageID: "p1", Kind: knowledge.ProjectionKindSummary, Title: "Updated again", Body: []byte(`"updated again"`)})
	if err != nil {
		t.Fatalf("ingest removed page: %v", err)
	}
	removedTask := waitForIngestTaskStatus(t, c.KnowledgeService(), "a1", task.TaskID, knowledge.IngestTaskStatusFailed)
	if !strings.Contains(removedTask.Error, "cannot be updated from removed") {
		t.Fatalf("expected removed ingest failure reason, got %+v", removedTask)
	}
}

func TestKnowledgeIngestRunningPersistFailureFailsClosed(t *testing.T) {
	root := t.TempDir()
	c := newTestCognitionAt(t, root)
	task := knowledge.IngestTask{
		TaskID:          "ingest_running_fail",
		ScopeID:         "a1",
		Status:          knowledge.IngestTaskStatusQueued,
		ProgressPercent: 0,
		PageID:          "p_running_fail",
		CreatedAt:       ts,
		UpdatedAt:       ts,
	}
	if err := c.store.SaveKnowledgeIngestTask(task); err != nil {
		t.Fatalf("seed ingest task: %v", err)
	}
	db, err := sql.Open("sqlite", cognitionDBPath(root))
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	defer db.Close()
	if _, err := db.Exec(`CREATE TRIGGER fail_running_ingest_update
		BEFORE UPDATE ON knowledge_ingest_task
		WHEN instr(CAST(NEW.task_json AS TEXT), '"status":"running"') > 0
		BEGIN
			SELECT RAISE(FAIL, 'inject running ingest save failure');
		END;`); err != nil {
		t.Fatalf("create running failure trigger: %v", err)
	}
	c.KnowledgeService().runIngestTask(task, knowledge.IngestEnvelope{
		PageID: "p_running_fail",
		Kind:   knowledge.ProjectionKindSummary,
		Title:  "Running failure",
		Body:   []byte(`"body"`),
	})
	loaded, err := c.KnowledgeService().GetIngestTask("a1", task.TaskID)
	if err != nil {
		t.Fatalf("load failed ingest task: %v", err)
	}
	if loaded.Status != knowledge.IngestTaskStatusFailed {
		t.Fatalf("expected failed ingest task after running persist failure, got %+v", loaded)
	}
	if !strings.Contains(loaded.Error, "persist running task") || !strings.Contains(loaded.Error, "inject running ingest save failure") {
		t.Fatalf("expected running persist failure reason, got %+v", loaded)
	}
	if _, err := c.KnowledgeService().Load("a1", "p_running_fail"); err == nil || !strings.Contains(err.Error(), "does not exist") {
		t.Fatalf("expected page to remain absent after running persist failure, got %v", err)
	}
}

func TestKnowledgeIngestCompletedPersistFailureFailsClosed(t *testing.T) {
	root := t.TempDir()
	c := newTestCognitionAt(t, root)
	task := knowledge.IngestTask{
		TaskID:          "ingest_completed_fail",
		ScopeID:         "a1",
		Status:          knowledge.IngestTaskStatusQueued,
		ProgressPercent: 0,
		PageID:          "p_completed_fail",
		CreatedAt:       ts,
		UpdatedAt:       ts,
	}
	if err := c.store.SaveKnowledgeIngestTask(task); err != nil {
		t.Fatalf("seed ingest task: %v", err)
	}
	db, err := sql.Open("sqlite", cognitionDBPath(root))
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	defer db.Close()
	if _, err := db.Exec(`CREATE TRIGGER fail_completed_ingest_update
		BEFORE UPDATE ON knowledge_ingest_task
		WHEN instr(CAST(NEW.task_json AS TEXT), '"status":"completed"') > 0
		BEGIN
			SELECT RAISE(FAIL, 'inject completed ingest save failure');
		END;`); err != nil {
		t.Fatalf("create completed failure trigger: %v", err)
	}
	c.KnowledgeService().runIngestTask(task, knowledge.IngestEnvelope{
		PageID: "p_completed_fail",
		Kind:   knowledge.ProjectionKindSummary,
		Title:  "Completed failure",
		Body:   []byte(`"body"`),
	})
	loaded, err := c.KnowledgeService().GetIngestTask("a1", task.TaskID)
	if err != nil {
		t.Fatalf("load failed ingest task: %v", err)
	}
	if loaded.Status != knowledge.IngestTaskStatusFailed || loaded.ProgressPercent != 100 {
		t.Fatalf("expected failed ingest task after completed persist failure, got %+v", loaded)
	}
	if !strings.Contains(loaded.Error, "persist completed task") || !strings.Contains(loaded.Error, "inject completed ingest save failure") {
		t.Fatalf("expected completed persist failure reason, got %+v", loaded)
	}
	if _, err := c.KnowledgeService().Load("a1", "p_completed_fail"); err == nil || !strings.Contains(err.Error(), "does not exist") {
		t.Fatalf("expected page write rollback after completed persist failure, got %v", err)
	}
}

func TestKnowledgeIngestRunningAndFailedPersistFailure_ReopenReconcilesToFailed(t *testing.T) {
	root := t.TempDir()
	c := newTestCognitionAt(t, root)
	if err := c.InitScope("a1"); err != nil {
		t.Fatalf("init scope: %v", err)
	}
	task := knowledge.IngestTask{
		TaskID:          "ingest_running_reopen_fail",
		ScopeID:         "a1",
		Status:          knowledge.IngestTaskStatusQueued,
		ProgressPercent: 0,
		PageID:          "p_running_reopen_fail",
		CreatedAt:       ts,
		UpdatedAt:       ts,
	}
	if err := c.store.SaveKnowledgeIngestTask(task); err != nil {
		t.Fatalf("seed ingest task: %v", err)
	}
	db, err := sql.Open("sqlite", cognitionDBPath(root))
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	defer db.Close()
	if _, err := db.Exec(`CREATE TRIGGER fail_all_running_reopen_updates
		BEFORE UPDATE ON knowledge_ingest_task
		WHEN NEW.task_id = 'ingest_running_reopen_fail'
		BEGIN
			SELECT RAISE(FAIL, 'inject reopen running ingest save failure');
		END;`); err != nil {
		t.Fatalf("create running reopen trigger: %v", err)
	}
	c.KnowledgeService().runIngestTask(task, knowledge.IngestEnvelope{
		PageID: "p_running_reopen_fail",
		Kind:   knowledge.ProjectionKindSummary,
		Title:  "Running reopen failure",
		Body:   []byte(`"body"`),
	})
	loaded, err := c.KnowledgeService().GetIngestTask("a1", task.TaskID)
	if err != nil {
		t.Fatalf("load queued ingest task: %v", err)
	}
	if loaded.Status != knowledge.IngestTaskStatusQueued {
		t.Fatalf("expected task to remain queued when running+failed saves both fail, got %+v", loaded)
	}
	if _, err := c.KnowledgeService().Load("a1", "p_running_reopen_fail"); err == nil || !strings.Contains(err.Error(), "does not exist") {
		t.Fatalf("expected page to remain absent before reopen reconciliation, got %v", err)
	}
	if _, err := db.Exec(`DROP TRIGGER fail_all_running_reopen_updates`); err != nil {
		t.Fatalf("drop running reopen trigger: %v", err)
	}
	if err := c.Close(); err != nil {
		t.Fatalf("close cognition: %v", err)
	}
	reopened := newTestCognitionAt(t, root)
	defer reopened.Close()
	reconciled, err := reopened.KnowledgeService().GetIngestTask("a1", task.TaskID)
	if err != nil {
		t.Fatalf("load reconciled task after reopen: %v", err)
	}
	if reconciled.Status != knowledge.IngestTaskStatusFailed {
		t.Fatalf("expected reopen to reconcile queued task to failed, got %+v", reconciled)
	}
	if !strings.Contains(reconciled.Error, "interrupted before ingest task completion") {
		t.Fatalf("expected interrupted reconciliation error, got %+v", reconciled)
	}
	if _, err := reopened.KnowledgeService().Load("a1", "p_running_reopen_fail"); err == nil || !strings.Contains(err.Error(), "does not exist") {
		t.Fatalf("expected page to remain absent after reopen reconciliation, got %v", err)
	}
}

func TestKnowledgeIngestCompletedAndFailedPersistFailure_ReopenReconcilesToFailed(t *testing.T) {
	root := t.TempDir()
	c := newTestCognitionAt(t, root)
	if err := c.InitScope("a1"); err != nil {
		t.Fatalf("init scope: %v", err)
	}
	task := knowledge.IngestTask{
		TaskID:          "ingest_completed_reopen_fail",
		ScopeID:         "a1",
		Status:          knowledge.IngestTaskStatusQueued,
		ProgressPercent: 0,
		PageID:          "p_completed_reopen_fail",
		CreatedAt:       ts,
		UpdatedAt:       ts,
	}
	if err := c.store.SaveKnowledgeIngestTask(task); err != nil {
		t.Fatalf("seed ingest task: %v", err)
	}
	db, err := sql.Open("sqlite", cognitionDBPath(root))
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	defer db.Close()
	if _, err := db.Exec(`CREATE TRIGGER fail_completed_and_failed_reopen_updates
		BEFORE UPDATE ON knowledge_ingest_task
		WHEN NEW.task_id = 'ingest_completed_reopen_fail'
		  AND (
			instr(CAST(NEW.task_json AS TEXT), '"status":"completed"') > 0
			OR instr(CAST(NEW.task_json AS TEXT), '"status":"failed"') > 0
		  )
		BEGIN
			SELECT RAISE(FAIL, 'inject reopen completed ingest save failure');
		END;`); err != nil {
		t.Fatalf("create completed reopen trigger: %v", err)
	}
	c.KnowledgeService().runIngestTask(task, knowledge.IngestEnvelope{
		PageID: "p_completed_reopen_fail",
		Kind:   knowledge.ProjectionKindSummary,
		Title:  "Completed reopen failure",
		Body:   []byte(`"body"`),
	})
	loaded, err := c.KnowledgeService().GetIngestTask("a1", task.TaskID)
	if err != nil {
		t.Fatalf("load running ingest task: %v", err)
	}
	if loaded.Status != knowledge.IngestTaskStatusRunning {
		t.Fatalf("expected task to remain running when completed+failed saves both fail, got %+v", loaded)
	}
	if _, err := c.KnowledgeService().Load("a1", "p_completed_reopen_fail"); err == nil || !strings.Contains(err.Error(), "does not exist") {
		t.Fatalf("expected page rollback before reopen reconciliation, got %v", err)
	}
	if _, err := db.Exec(`DROP TRIGGER fail_completed_and_failed_reopen_updates`); err != nil {
		t.Fatalf("drop completed reopen trigger: %v", err)
	}
	if err := c.Close(); err != nil {
		t.Fatalf("close cognition: %v", err)
	}
	reopened := newTestCognitionAt(t, root)
	defer reopened.Close()
	reconciled, err := reopened.KnowledgeService().GetIngestTask("a1", task.TaskID)
	if err != nil {
		t.Fatalf("load reconciled task after reopen: %v", err)
	}
	if reconciled.Status != knowledge.IngestTaskStatusFailed {
		t.Fatalf("expected reopen to reconcile running task to failed, got %+v", reconciled)
	}
	if !strings.Contains(reconciled.Error, "interrupted before ingest task completion") {
		t.Fatalf("expected interrupted reconciliation error, got %+v", reconciled)
	}
	if _, err := reopened.KnowledgeService().Load("a1", "p_completed_reopen_fail"); err == nil || !strings.Contains(err.Error(), "does not exist") {
		t.Fatalf("expected page to remain absent after reopen reconciliation, got %v", err)
	}
}

func TestKnowledgeHybridFailsClosedWhenEmbeddingMissingOrCorrupt(t *testing.T) {
	root := t.TempDir()
	c := newTestCognitionAt(t, root)
	if err := c.InitScope("a1"); err != nil {
		t.Fatalf("init scope: %v", err)
	}
	page := knowledge.Page{PageID: "p1", ScopeID: "a1", Kind: knowledge.ProjectionKindSummary, Version: 1, Title: "Hybrid target", Body: []byte(`"interfaces and contracts"`), Lifecycle: knowledge.ProjectionLifecycleActive, CreatedAt: ts, UpdatedAt: ts}
	if err := c.KnowledgeService().Save(page); err != nil {
		t.Fatalf("save page: %v", err)
	}
	db, err := sql.Open("sqlite", cognitionDBPath(root))
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	defer db.Close()
	if _, err := db.Exec(`DELETE FROM knowledge_page_embedding WHERE scope_id = ? AND page_id = ?`, "a1", "p1"); err != nil {
		t.Fatalf("delete embedding row: %v", err)
	}
	if _, err := c.KnowledgeService().SearchHybrid("a1", "interfaces", 10); err == nil || !strings.Contains(err.Error(), "embedding missing") {
		t.Fatalf("expected missing embedding failure, got %v", err)
	}
	if err := c.KnowledgeService().Save(page); err != nil {
		t.Fatalf("resave page: %v", err)
	}
	if _, err := db.Exec(`UPDATE knowledge_page_embedding SET embedding_json = ? WHERE scope_id = ? AND page_id = ?`, `[1,2]`, "a1", "p1"); err != nil {
		t.Fatalf("corrupt embedding row: %v", err)
	}
	if _, err := c.KnowledgeService().SearchHybrid("a1", "interfaces", 10); err == nil || !strings.Contains(err.Error(), "embedding corrupt") {
		t.Fatalf("expected corrupt embedding failure, got %v", err)
	}
}

func TestKnowledgeLexicalSearchFailsClosedWhenFTSUnavailable(t *testing.T) {
	root := t.TempDir()
	c := newTestCognitionAt(t, root)
	if err := c.InitScope("a1"); err != nil {
		t.Fatalf("init scope: %v", err)
	}
	page := knowledge.Page{
		PageID:    "p1",
		ScopeID:   "a1",
		Kind:      knowledge.ProjectionKindSummary,
		Version:   1,
		Title:     "Lexical target",
		Body:      []byte(`"fts target"`),
		Lifecycle: knowledge.ProjectionLifecycleActive,
		CreatedAt: ts,
		UpdatedAt: ts,
	}
	if err := c.KnowledgeService().Save(page); err != nil {
		t.Fatalf("save page: %v", err)
	}
	db, err := sql.Open("sqlite", cognitionDBPath(root))
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	defer db.Close()
	if _, err := db.Exec(`DROP TABLE knowledge_page_fts`); err != nil {
		t.Fatalf("drop knowledge fts table: %v", err)
	}
	if _, err := c.KnowledgeService().SearchLexical("a1", "fts", 10); err == nil || !strings.Contains(err.Error(), "lexical substrate unavailable") {
		t.Fatalf("expected knowledge lexical substrate failure, got %v", err)
	}
}

func TestKnowledgeServiceRejectsMissingArtifactRefTarget(t *testing.T) {
	c := newTestCognition(t)
	if err := c.InitScope("a1"); err != nil {
		t.Fatalf("init scope: %v", err)
	}
	page := knowledge.Page{
		PageID: "p1", ScopeID: "a1", Kind: knowledge.ProjectionKindExplainer, Version: 1, Title: "Broken", Body: json.RawMessage(`"body"`), Lifecycle: knowledge.ProjectionLifecycleActive,
		ArtifactRefs: []artifactref.Ref{{FromKind: artifactref.KindKnowledgePage, FromID: "p1", ToKind: artifactref.KindMemoryRecord, ToID: "ghost", Strength: artifactref.StrengthStrong, Role: "support", CreatedAt: ts, UpdatedAt: ts}},
		CreatedAt:    ts, UpdatedAt: ts,
	}
	err := c.KnowledgeService().Save(page)
	if err == nil || !strings.Contains(err.Error(), "does not exist") {
		t.Fatalf("expected missing target error, got %v", err)
	}
}

func TestKnowledgeSaveRejectsArchivedAndRemovedLifecycleMutation(t *testing.T) {
	c := newTestCognition(t)
	page := knowledge.Page{
		PageID:    "p1",
		ScopeID:   "a1",
		Kind:      knowledge.ProjectionKindExplainer,
		Version:   1,
		Title:     "Live page",
		Body:      []byte(`"body"`),
		Lifecycle: knowledge.ProjectionLifecycleActive,
		CreatedAt: ts,
		UpdatedAt: ts,
	}
	if err := c.KnowledgeService().Save(page); err != nil {
		t.Fatalf("save page: %v", err)
	}
	ctx, err := c.NewRoutineContext("a1")
	if err != nil {
		t.Fatalf("new routine context: %v", err)
	}
	if err := ctx.Storage.ArchiveKnowledge("a1", "p1", ts.Add(time.Minute)); err != nil {
		t.Fatalf("archive page: %v", err)
	}
	page.Version = 2
	page.UpdatedAt = ts.Add(2 * time.Minute)
	err = c.KnowledgeService().Save(page)
	if err == nil || !strings.Contains(err.Error(), "illegal lifecycle mutation") {
		t.Fatalf("expected archived page save rejection, got %v", err)
	}
	if err := ctx.Storage.RemoveKnowledge("a1", "p1", ts.Add(3*time.Minute)); err != nil {
		t.Fatalf("remove page: %v", err)
	}
	page.Version = 3
	page.UpdatedAt = ts.Add(4 * time.Minute)
	err = c.KnowledgeService().Save(page)
	if err == nil || !strings.Contains(err.Error(), "illegal lifecycle mutation") {
		t.Fatalf("expected removed page save rejection, got %v", err)
	}
}

func TestKnowledgeRelationRejectsNonLivePages(t *testing.T) {
	c := newTestCognition(t)
	live := knowledge.Page{PageID: "live", ScopeID: "a1", Kind: knowledge.ProjectionKindGuide, Version: 1, Title: "Live", Body: []byte(`"body"`), Lifecycle: knowledge.ProjectionLifecycleActive, CreatedAt: ts, UpdatedAt: ts}
	stale := knowledge.Page{PageID: "stale", ScopeID: "a1", Kind: knowledge.ProjectionKindGuide, Version: 1, Title: "Stale", Body: []byte(`"body"`), Lifecycle: knowledge.ProjectionLifecycleStale, CreatedAt: ts, UpdatedAt: ts}
	archived := knowledge.Page{PageID: "archived", ScopeID: "a1", Kind: knowledge.ProjectionKindGuide, Version: 1, Title: "Archived", Body: []byte(`"body"`), Lifecycle: knowledge.ProjectionLifecycleActive, CreatedAt: ts, UpdatedAt: ts}
	removed := knowledge.Page{PageID: "removed", ScopeID: "a1", Kind: knowledge.ProjectionKindGuide, Version: 1, Title: "Removed", Body: []byte(`"body"`), Lifecycle: knowledge.ProjectionLifecycleActive, CreatedAt: ts, UpdatedAt: ts}
	for _, page := range []knowledge.Page{live, stale, archived, removed} {
		if err := c.KnowledgeService().Save(page); err != nil {
			t.Fatalf("save page %s: %v", page.PageID, err)
		}
	}
	ctx, err := c.NewRoutineContext("a1")
	if err != nil {
		t.Fatalf("new routine context: %v", err)
	}
	if err := ctx.Storage.ArchiveKnowledge("a1", "archived", ts.Add(time.Minute)); err != nil {
		t.Fatalf("archive page: %v", err)
	}
	if err := ctx.Storage.ArchiveKnowledge("a1", "removed", ts.Add(time.Minute)); err != nil {
		t.Fatalf("archive page: %v", err)
	}
	if err := ctx.Storage.RemoveKnowledge("a1", "removed", ts.Add(2*time.Minute)); err != nil {
		t.Fatalf("remove page: %v", err)
	}
	if err := c.KnowledgeService().PutRelation(knowledge.Relation{ScopeID: "a1", FromPageID: "stale", ToPageID: "live", RelationType: "supports", Strength: artifactref.StrengthWeak, CreatedAt: ts, UpdatedAt: ts}); err != nil {
		t.Fatalf("stale live relation should be allowed: %v", err)
	}
	if err := c.KnowledgeService().PutRelation(knowledge.Relation{ScopeID: "a1", FromPageID: "archived", ToPageID: "live", RelationType: "supports", Strength: artifactref.StrengthStrong, CreatedAt: ts, UpdatedAt: ts}); err == nil || !strings.Contains(err.Error(), "source page archived is not live") {
		t.Fatalf("expected archived source rejection, got %v", err)
	}
	if err := c.KnowledgeService().PutRelation(knowledge.Relation{ScopeID: "a1", FromPageID: "live", ToPageID: "removed", RelationType: "supports", Strength: artifactref.StrengthStrong, CreatedAt: ts, UpdatedAt: ts}); err == nil || !strings.Contains(err.Error(), "target page removed is not live") {
		t.Fatalf("expected removed target rejection, got %v", err)
	}
}

func TestKnowledgeSaveRejectsInvalidCitationsAndPromptShowsSummary(t *testing.T) {
	c := newTestCognition(t)
	raw, err := json.Marshal(struct {
		Kernel kernel.Kernel `json:"kernel"`
		Rules  []kernel.Rule `json:"rules"`
	}{
		Kernel: kernel.Kernel{
			KernelID:   "a1_agent_model",
			ScopeID:    "a1",
			KernelType: kernel.KernelTypeAgentModel,
			Version:    1,
			Status:     kernel.KernelStatusActive,
			RuleRefs:   []kernel.RuleID{"rule_1"},
			CreatedAt:  ts,
			UpdatedAt:  ts,
		},
		Rules: []kernel.Rule{
			{
				RuleID:        "rule_1",
				Kind:          kernel.RuleKindSelfFacing,
				Version:       1,
				Statement:     "Keep it factual",
				AnchorBinding: kernel.AnchorBindingLocalOnly,
				Lifecycle:     kernel.RuleLifecycleActive,
				CreatedAt:     ts,
				UpdatedAt:     ts,
			},
			{
				RuleID:        "rule_old",
				Kind:          kernel.RuleKindSelfFacing,
				Version:       1,
				Statement:     "Old guidance",
				AnchorBinding: kernel.AnchorBindingLocalOnly,
				Lifecycle:     kernel.RuleLifecycleSuperseded,
				SupersededBy:  "rule_1",
				CreatedAt:     ts,
				UpdatedAt:     ts,
			},
		},
	})
	if err != nil {
		t.Fatalf("marshal kernel seed: %v", err)
	}
	if err := c.store.Save("a1", storage.KindKernel, string(kernel.KernelTypeAgentModel), raw); err != nil {
		t.Fatalf("seed kernel rule: %v", err)
	}
	if err := c.MemoryService().Save(memory.Record{
		RecordID:  "m1",
		ScopeID:   "a1",
		Kind:      memory.RecordKindExperience,
		Version:   1,
		Content:   []byte(`{"summary":"live memory"}`),
		Lifecycle: memory.RecordLifecycleActive,
		CreatedAt: ts,
		UpdatedAt: ts,
	}); err != nil {
		t.Fatalf("save memory: %v", err)
	}
	invalidKind := knowledge.Page{PageID: "p_bad_kind", ScopeID: "a1", Kind: knowledge.ProjectionKindGuide, Version: 1, Title: "Bad", Body: []byte(`"body"`), Lifecycle: knowledge.ProjectionLifecycleActive, CreatedAt: ts, UpdatedAt: ts, Citations: []knowledge.Citation{{TargetKind: "fake", TargetID: "x", Strength: "strong_ref"}}}
	if err := c.KnowledgeService().Save(invalidKind); err == nil || !strings.Contains(err.Error(), "invalid citation target_kind") {
		t.Fatalf("expected invalid citation kind rejection, got %v", err)
	}
	missingTarget := knowledge.Page{PageID: "p_missing", ScopeID: "a1", Kind: knowledge.ProjectionKindGuide, Version: 1, Title: "Missing", Body: []byte(`"body"`), Lifecycle: knowledge.ProjectionLifecycleActive, CreatedAt: ts, UpdatedAt: ts, Citations: []knowledge.Citation{{TargetKind: knowledge.CitationTargetKindMemoryRecord, TargetID: "ghost", Strength: "strong_ref"}}}
	if err := c.KnowledgeService().Save(missingTarget); err == nil || !strings.Contains(err.Error(), "does not exist or is removed") {
		t.Fatalf("expected missing memory citation rejection, got %v", err)
	}
	inactiveKernelTarget := knowledge.Page{PageID: "p_inactive_rule", ScopeID: "a1", Kind: knowledge.ProjectionKindGuide, Version: 1, Title: "Inactive rule", Body: []byte(`"body"`), Lifecycle: knowledge.ProjectionLifecycleActive, CreatedAt: ts, UpdatedAt: ts, Citations: []knowledge.Citation{{TargetKind: knowledge.CitationTargetKindKernelRule, TargetID: "rule_old", Strength: "strong_ref"}}}
	if err := c.KnowledgeService().Save(inactiveKernelTarget); err == nil || !strings.Contains(err.Error(), "is not active") {
		t.Fatalf("expected inactive kernel rule citation rejection, got %v", err)
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
	removedTarget := knowledge.Page{PageID: "p_removed_target", ScopeID: "a1", Kind: knowledge.ProjectionKindGuide, Version: 1, Title: "Removed", Body: []byte(`"body"`), Lifecycle: knowledge.ProjectionLifecycleActive, CreatedAt: ts, UpdatedAt: ts, Citations: []knowledge.Citation{{TargetKind: knowledge.CitationTargetKindMemoryRecord, TargetID: "m1", Strength: "strong_ref"}}}
	if err := c.KnowledgeService().Save(removedTarget); err == nil || !strings.Contains(err.Error(), "does not exist or is removed") {
		t.Fatalf("expected removed memory citation rejection, got %v", err)
	}
	if err := c.MemoryService().Save(memory.Record{
		RecordID:  "m2",
		ScopeID:   "a1",
		Kind:      memory.RecordKindExperience,
		Version:   1,
		Content:   []byte(`{"summary":"new live memory"}`),
		Lifecycle: memory.RecordLifecycleActive,
		CreatedAt: ts,
		UpdatedAt: ts,
	}); err != nil {
		t.Fatalf("save second memory: %v", err)
	}
	valid := knowledge.Page{
		PageID:    "p_valid",
		ScopeID:   "a1",
		Kind:      knowledge.ProjectionKindGuide,
		Version:   1,
		Title:     "Valid citations",
		Body:      []byte(`"body"`),
		Lifecycle: knowledge.ProjectionLifecycleActive,
		CreatedAt: ts,
		UpdatedAt: ts,
		Citations: []knowledge.Citation{
			{TargetKind: knowledge.CitationTargetKindKernelRule, TargetID: "rule_1", Strength: "strong_ref"},
			{TargetKind: knowledge.CitationTargetKindMemoryRecord, TargetID: "m2", Strength: "weak_ref"},
		},
	}
	if err := c.KnowledgeService().Save(valid); err != nil {
		t.Fatalf("save valid citations page: %v", err)
	}
	advisory, err := c.PromptService().FormatAdvisory("a1")
	if err != nil {
		t.Fatalf("format advisory: %v", err)
	}
	if !strings.Contains(advisory, "[citations=2 kernel_rules=1 memory_records=1]") {
		t.Fatalf("expected citation summary in prompt, got %s", advisory)
	}
}

func TestKnowledgeStoredMalformedCitationFailsClosedAcrossReadPaths(t *testing.T) {
	root := t.TempDir()
	c := newTestCognitionAt(t, root)
	raw, err := json.Marshal(knowledge.Page{
		PageID:    "p_bad_citation",
		ScopeID:   "a1",
		Kind:      knowledge.ProjectionKindGuide,
		Version:   1,
		Title:     "Malformed citation page",
		Body:      []byte(`"body"`),
		Lifecycle: knowledge.ProjectionLifecycleActive,
		CreatedAt: ts,
		UpdatedAt: ts,
		Citations: []knowledge.Citation{{
			TargetKind: "fake",
			TargetID:   "ghost",
			Strength:   "strong_ref",
		}},
	})
	if err != nil {
		t.Fatalf("marshal malformed page: %v", err)
	}
	db, err := sql.Open("sqlite", cognitionDBPath(root))
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	defer db.Close()
	if _, err := db.Exec(`INSERT INTO knowledge_page
		(scope_id, page_id, kind, lifecycle, search_text, page_json, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		"a1", "p_bad_citation", "guide", "active", "Malformed citation page body", raw,
		"2026-04-16T12:00:00Z", "2026-04-16T12:00:00Z"); err != nil {
		t.Fatalf("seed malformed citation page: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO knowledge_page_fts (scope_id, page_id, search_text) VALUES (?, ?, ?)`,
		"a1", "p_bad_citation", "Malformed citation page body"); err != nil {
		t.Fatalf("seed malformed citation search row: %v", err)
	}
	if _, err := c.KnowledgeService().Load("a1", "p_bad_citation"); err == nil || !strings.Contains(err.Error(), "invalid citation target_kind") {
		t.Fatalf("expected knowledge load fail-close on malformed stored citation, got %v", err)
	}
	if _, err := c.KnowledgeService().List("a1"); err == nil || !strings.Contains(err.Error(), "invalid citation target_kind") {
		t.Fatalf("expected knowledge list fail-close on malformed stored citation, got %v", err)
	}
	if _, err := c.KnowledgeService().SearchLexical("a1", "Malformed citation", 10); err == nil || !strings.Contains(err.Error(), "invalid citation target_kind") {
		t.Fatalf("expected knowledge search fail-close on malformed stored citation, got %v", err)
	}
	if _, err := c.KnowledgeService().SearchHybrid("a1", "Malformed citation", 10); err == nil || !strings.Contains(err.Error(), "invalid citation target_kind") {
		t.Fatalf("expected knowledge hybrid fail-close on malformed stored citation, got %v", err)
	}
	if _, err := c.PromptService().FormatAdvisory("a1"); err == nil || !strings.Contains(err.Error(), "invalid citation target_kind") {
		t.Fatalf("expected prompt fail-close on malformed stored citation, got %v", err)
	}
}
