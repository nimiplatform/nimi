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
	_ "modernc.org/sqlite"
)

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
