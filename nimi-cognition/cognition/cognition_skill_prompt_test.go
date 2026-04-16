package cognition

import (
	"database/sql"
	"strings"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/artifactref"
	"github.com/nimiplatform/nimi/nimi-cognition/internal/storage"
	"github.com/nimiplatform/nimi/nimi-cognition/knowledge"
	"github.com/nimiplatform/nimi/nimi-cognition/memory"
	"github.com/nimiplatform/nimi/nimi-cognition/routine/digest"
	"github.com/nimiplatform/nimi/nimi-cognition/skill"
	_ "modernc.org/sqlite"
)

func TestSkillServiceLifecycleAndHistory(t *testing.T) {
	c := newTestCognition(t)
	bundle := skill.Bundle{BundleID: "s1", ScopeID: "a1", Version: 1, Status: skill.BundleStatusActive, Name: "Review", Steps: []skill.Step{{StepID: "st1", Instruction: "Read", Order: 1}}, CreatedAt: ts, UpdatedAt: ts}
	if err := c.SkillService().Save(bundle); err != nil {
		t.Fatalf("save bundle: %v", err)
	}
	ctx, err := c.NewRoutineContext("a1")
	if err != nil {
		t.Fatalf("new routine context: %v", err)
	}
	if err := ctx.Storage.ArchiveSkill("a1", "s1", ts.Add(time.Minute)); err != nil {
		t.Fatalf("archive skill: %v", err)
	}
	if err := ctx.Storage.RemoveSkill("a1", "s1", ts.Add(2*time.Minute)); err != nil {
		t.Fatalf("remove skill: %v", err)
	}
	loaded, err := c.SkillService().Load("a1", "s1")
	if err != nil || loaded.Status != skill.BundleStatusRemoved {
		t.Fatalf("expected removed skill status, got %+v err=%v", loaded, err)
	}
	listed, err := c.SkillService().List("a1")
	if err != nil || len(listed) != 0 {
		t.Fatalf("expected removed skill excluded from list, got %+v err=%v", listed, err)
	}
	history, err := c.SkillService().History("a1", "s1")
	if err != nil || len(history) < 3 || history[0].Action != skill.HistoryActionRemoved || history[1].Action != skill.HistoryActionArchived {
		t.Fatalf("expected archive/remove skill history, got %+v err=%v", history, err)
	}
	if err := c.SkillService().Delete("a1", "s1"); err != nil {
		t.Fatalf("delete skill: %v", err)
	}
	if _, err := c.SkillService().Load("a1", "s1"); err == nil || !strings.Contains(err.Error(), "does not exist") {
		t.Fatalf("expected deleted skill load failure, got %v", err)
	}
}

func TestSkillDelete_RemovedSourceIgnored_AfterActiveWeakBlock(t *testing.T) {
	c := newTestCognition(t)
	if err := c.InitScope("a1"); err != nil {
		t.Fatalf("init scope: %v", err)
	}
	if err := c.SkillService().Save(skill.Bundle{BundleID: "s1", ScopeID: "a1", Version: 1, Status: skill.BundleStatusActive, Name: "Target", Steps: []skill.Step{{StepID: "st1", Instruction: "Read", Order: 1}}, CreatedAt: ts, UpdatedAt: ts}); err != nil {
		t.Fatalf("save skill: %v", err)
	}
	if err := c.MemoryService().Save(memory.Record{
		RecordID: "m1", ScopeID: "a1", Kind: memory.RecordKindExperience, Version: 1, Content: []byte(`{"summary":"uses skill"}`), Lifecycle: memory.RecordLifecycleActive,
		ArtifactRefs: []artifactref.Ref{{FromKind: artifactref.KindMemoryRecord, FromID: "m1", ToKind: artifactref.KindSkillBundle, ToID: "s1", Strength: artifactref.StrengthWeak, Role: "support", CreatedAt: ts, UpdatedAt: ts}},
		CreatedAt:    ts, UpdatedAt: ts,
	}); err != nil {
		t.Fatalf("save memory: %v", err)
	}
	if err := c.SkillService().Delete("a1", "s1"); err == nil || !strings.Contains(err.Error(), "weak_ref:memory_record/m1(active)") {
		t.Fatalf("expected active weak blocker, got %v", err)
	}
	ctx, err := c.NewRoutineContext("a1")
	if err != nil {
		t.Fatalf("new routine context: %v", err)
	}
	if err := ctx.Storage.ArchiveMemory("a1", "m1", ts.Add(time.Minute)); err != nil {
		t.Fatalf("archive memory source: %v", err)
	}
	if err := ctx.Storage.RemoveMemory("a1", "m1", ts.Add(2*time.Minute)); err != nil {
		t.Fatalf("remove memory source: %v", err)
	}
	if err := c.SkillService().Delete("a1", "s1"); err != nil {
		t.Fatalf("delete skill after removed source: %v", err)
	}
}

func TestSkillLifecyclePersistsAcrossReopen(t *testing.T) {
	root := t.TempDir()
	c := newTestCognitionAt(t, root)
	if err := c.SkillService().Save(skill.Bundle{BundleID: "s_removed", ScopeID: "a1", Version: 1, Status: skill.BundleStatusActive, Name: "Removed skill", Steps: []skill.Step{{StepID: "st1", Instruction: "Read", Order: 1}}, CreatedAt: ts, UpdatedAt: ts}); err != nil {
		t.Fatalf("save removed skill candidate: %v", err)
	}
	if err := c.SkillService().Save(skill.Bundle{BundleID: "s_deleted", ScopeID: "a1", Version: 1, Status: skill.BundleStatusActive, Name: "Deleted skill", Steps: []skill.Step{{StepID: "st1", Instruction: "Read", Order: 1}}, CreatedAt: ts, UpdatedAt: ts}); err != nil {
		t.Fatalf("save deleted skill candidate: %v", err)
	}
	ctx, err := c.NewRoutineContext("a1")
	if err != nil {
		t.Fatalf("new routine context: %v", err)
	}
	if err := ctx.Storage.ArchiveSkill("a1", "s_removed", ts.Add(time.Minute)); err != nil {
		t.Fatalf("archive skill: %v", err)
	}
	if err := ctx.Storage.RemoveSkill("a1", "s_removed", ts.Add(2*time.Minute)); err != nil {
		t.Fatalf("remove skill: %v", err)
	}
	if err := c.SkillService().Delete("a1", "s_deleted"); err != nil {
		t.Fatalf("delete skill: %v", err)
	}
	if err := c.Close(); err != nil {
		t.Fatalf("close cognition: %v", err)
	}
	reopened := newTestCognitionAt(t, root)
	defer reopened.Close()
	if removed, err := reopened.SkillService().Load("a1", "s_removed"); err != nil || removed.Status != skill.BundleStatusRemoved {
		t.Fatalf("expected removed skill after reopen, got %+v err=%v", removed, err)
	}
	if listed, err := reopened.SkillService().List("a1"); err != nil || len(listed) != 0 {
		t.Fatalf("expected removed skill excluded from list after reopen, got %+v err=%v", listed, err)
	}
	if results, err := reopened.SkillService().Search("a1", "Removed skill", 10); err != nil || len(results) != 0 {
		t.Fatalf("expected removed skill excluded from search after reopen, got %+v err=%v", results, err)
	}
	if history, err := reopened.SkillService().History("a1", "s_removed"); err != nil || len(history) < 3 || history[0].Action != skill.HistoryActionRemoved || history[1].Action != skill.HistoryActionArchived {
		t.Fatalf("expected removed skill history after reopen, got %+v err=%v", history, err)
	}
	if _, err := reopened.SkillService().Load("a1", "s_deleted"); err == nil || !strings.Contains(err.Error(), "does not exist") {
		t.Fatalf("expected deleted skill load failure after reopen, got %v", err)
	}
	if history, err := reopened.SkillService().History("a1", "s_deleted"); err != nil || len(history) < 2 || history[0].Action != skill.HistoryActionDeleted {
		t.Fatalf("expected deleted skill history after reopen, got %+v err=%v", history, err)
	}
}

func TestSkillDigestWorkerRemove_IgnoresRemovedSource(t *testing.T) {
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
	if err := c.SkillService().Save(skill.Bundle{
		BundleID:  "s1",
		ScopeID:   "a1",
		Version:   1,
		Status:    skill.BundleStatusArchived,
		Name:      "Archived target",
		Steps:     []skill.Step{{StepID: "st1", Instruction: "Read", Order: 1}},
		CreatedAt: ts,
		UpdatedAt: ts,
		ArtifactRefs: []artifactref.Ref{{
			FromKind:  artifactref.KindSkillBundle,
			FromID:    "s1",
			ToKind:    artifactref.KindKnowledgePage,
			ToID:      "ghost",
			Strength:  artifactref.StrengthStrong,
			Role:      "support",
			CreatedAt: ts,
			UpdatedAt: ts,
		}},
	}); err != nil {
		t.Fatalf("save target skill: %v", err)
	}
	if err := c.MemoryService().Save(memory.Record{
		RecordID:  "m1",
		ScopeID:   "a1",
		Kind:      memory.RecordKindExperience,
		Version:   1,
		Content:   []byte(`{"summary":"removed source"}`),
		Lifecycle: memory.RecordLifecycleArchived,
		CreatedAt: ts,
		UpdatedAt: ts,
		ArtifactRefs: []artifactref.Ref{{
			FromKind:  artifactref.KindMemoryRecord,
			FromID:    "m1",
			ToKind:    artifactref.KindSkillBundle,
			ToID:      "s1",
			Strength:  artifactref.StrengthWeak,
			Role:      "support",
			CreatedAt: ts,
			UpdatedAt: ts,
		}},
	}); err != nil {
		t.Fatalf("save archived source memory: %v", err)
	}
	ctx, err := c.NewRoutineContext("a1")
	if err != nil {
		t.Fatalf("new routine context: %v", err)
	}
	if err := c.store.Delete("a1", storage.KindKnowledge, "ghost"); err != nil {
		t.Fatalf("delete ghost page fixture: %v", err)
	}
	if err := ctx.Storage.RemoveMemory("a1", "m1", ts.Add(time.Minute)); err != nil {
		t.Fatalf("remove source memory: %v", err)
	}
	if _, err := digest.NewWorker(digest.Config{}).Run(ctx); err != nil {
		t.Fatalf("worker first pass: %v", err)
	}
	if _, err := digest.NewWorker(digest.Config{}).Run(ctx); err != nil {
		t.Fatalf("worker second pass: %v", err)
	}
	loaded, err := c.SkillService().Load("a1", "s1")
	if err != nil {
		t.Fatalf("load skill after worker runs: %v", err)
	}
	if loaded.Status != skill.BundleStatusRemoved {
		t.Fatalf("expected removed source to stop blocking worker remove, got %+v", loaded)
	}
}

func TestPromptServiceAfterReopenExcludesRemovedArtifacts(t *testing.T) {
	root := t.TempDir()
	c := newTestCognitionAt(t, root)
	if err := c.MemoryService().Save(memory.Record{RecordID: "m_active", ScopeID: "a1", Kind: memory.RecordKindExperience, Version: 1, Content: []byte(`{"summary":"active memory"}`), Lifecycle: memory.RecordLifecycleActive, CreatedAt: ts, UpdatedAt: ts}); err != nil {
		t.Fatalf("save active memory: %v", err)
	}
	if err := c.MemoryService().Save(memory.Record{RecordID: "m_removed", ScopeID: "a1", Kind: memory.RecordKindExperience, Version: 1, Content: []byte(`{"summary":"removed memory"}`), Lifecycle: memory.RecordLifecycleActive, CreatedAt: ts, UpdatedAt: ts}); err != nil {
		t.Fatalf("save removed memory candidate: %v", err)
	}
	if err := c.KnowledgeService().Save(knowledge.Page{PageID: "p_active", ScopeID: "a1", Kind: knowledge.ProjectionKindExplainer, Version: 1, Title: "Active page", Body: []byte(`"active page body"`), Lifecycle: knowledge.ProjectionLifecycleActive, CreatedAt: ts, UpdatedAt: ts}); err != nil {
		t.Fatalf("save active page: %v", err)
	}
	if err := c.KnowledgeService().Save(knowledge.Page{PageID: "p_removed", ScopeID: "a1", Kind: knowledge.ProjectionKindExplainer, Version: 1, Title: "Removed page", Body: []byte(`"removed page body"`), Lifecycle: knowledge.ProjectionLifecycleActive, CreatedAt: ts, UpdatedAt: ts}); err != nil {
		t.Fatalf("save removed page candidate: %v", err)
	}
	if err := c.SkillService().Save(skill.Bundle{BundleID: "s_active", ScopeID: "a1", Version: 1, Status: skill.BundleStatusActive, Name: "Active skill", Steps: []skill.Step{{StepID: "st1", Instruction: "Read", Order: 1}}, CreatedAt: ts, UpdatedAt: ts}); err != nil {
		t.Fatalf("save active skill: %v", err)
	}
	if err := c.SkillService().Save(skill.Bundle{BundleID: "s_removed", ScopeID: "a1", Version: 1, Status: skill.BundleStatusActive, Name: "Removed skill", Steps: []skill.Step{{StepID: "st1", Instruction: "Read", Order: 1}}, CreatedAt: ts, UpdatedAt: ts}); err != nil {
		t.Fatalf("save removed skill candidate: %v", err)
	}
	ctx, err := c.NewRoutineContext("a1")
	if err != nil {
		t.Fatalf("new routine context: %v", err)
	}
	if err := ctx.Storage.ArchiveMemory("a1", "m_removed", ts.Add(time.Minute)); err != nil {
		t.Fatalf("archive removed memory candidate: %v", err)
	}
	if err := ctx.Storage.RemoveMemory("a1", "m_removed", ts.Add(2*time.Minute)); err != nil {
		t.Fatalf("remove memory: %v", err)
	}
	if err := ctx.Storage.ArchiveKnowledge("a1", "p_removed", ts.Add(time.Minute)); err != nil {
		t.Fatalf("archive removed page candidate: %v", err)
	}
	if err := ctx.Storage.RemoveKnowledge("a1", "p_removed", ts.Add(2*time.Minute)); err != nil {
		t.Fatalf("remove page: %v", err)
	}
	if err := ctx.Storage.ArchiveSkill("a1", "s_removed", ts.Add(time.Minute)); err != nil {
		t.Fatalf("archive removed skill candidate: %v", err)
	}
	if err := ctx.Storage.RemoveSkill("a1", "s_removed", ts.Add(2*time.Minute)); err != nil {
		t.Fatalf("remove skill: %v", err)
	}
	if err := c.Close(); err != nil {
		t.Fatalf("close cognition: %v", err)
	}
	reopened := newTestCognitionAt(t, root)
	defer reopened.Close()
	advisory, err := reopened.PromptService().FormatAdvisory("a1")
	if err != nil {
		t.Fatalf("format advisory after reopen: %v", err)
	}
	for _, expected := range []string{"active memory", "Active page", "Active skill"} {
		if !strings.Contains(advisory, expected) {
			t.Fatalf("expected advisory after reopen to contain %q, got:\n%s", expected, advisory)
		}
	}
	for _, forbidden := range []string{"removed memory", "Removed page", "Removed skill"} {
		if strings.Contains(advisory, forbidden) {
			t.Fatalf("expected advisory after reopen to exclude %q, got:\n%s", forbidden, advisory)
		}
	}
}

func TestPromptServiceFailsClosedOnMalformedKnowledgeProjection(t *testing.T) {
	root := t.TempDir()
	c := newTestCognitionAt(t, root)
	db, err := sql.Open("sqlite", cognitionDBPath(root))
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	defer db.Close()
	if _, err := db.Exec(`INSERT INTO knowledge_page
		(scope_id, page_id, kind, lifecycle, search_text, page_json, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		"a1", "bad", "explainer", "active", "bad body", []byte(`{
			"page_id":"bad","scope_id":"a1","kind":"explainer","version":1,"title":"bad","body":"body","lifecycle":"active",
			"artifact_refs":[{"from_kind":"knowledge_page","from_id":"bad","to_kind":"knowledge_page","to_id":"other","strength":"strong_ref","role":"support","created_at":"2026-04-16T12:00:00Z","updated_at":"2026-04-16T12:00:00Z"}],
			"created_at":"2026-04-16T12:00:00Z","updated_at":"2026-04-16T12:00:00Z"
		}`), "2026-04-16T12:00:00Z", "2026-04-16T12:00:00Z"); err != nil {
		t.Fatalf("seed malformed knowledge row: %v", err)
	}
	if _, err := c.PromptService().FormatAdvisory("a1"); err == nil || !strings.Contains(err.Error(), "knowledge_page relations must be first-class relation rows") {
		t.Fatalf("expected prompt fail-close on malformed knowledge projection, got %v", err)
	}
}

func TestSearchSurfacesRejectEmptyQuery(t *testing.T) {
	c := newTestCognition(t)
	if err := c.InitScope("a1"); err != nil {
		t.Fatalf("init scope: %v", err)
	}
	if _, err := c.MemoryService().SearchLexical("a1", "   ", 10); err == nil || !strings.Contains(err.Error(), "query is required") {
		t.Fatalf("expected memory search empty-query failure, got %v", err)
	}
	if _, err := c.MemoryService().SearchViews("a1", "", 10); err == nil || !strings.Contains(err.Error(), "query is required") {
		t.Fatalf("expected memory search views empty-query failure, got %v", err)
	}
	if _, err := c.KnowledgeService().SearchLexical("a1", "", 10); err == nil || !strings.Contains(err.Error(), "query is required") {
		t.Fatalf("expected knowledge lexical empty-query failure, got %v", err)
	}
	if _, err := c.KnowledgeService().SearchHybrid("a1", "", 10); err == nil || !strings.Contains(err.Error(), "query is required") {
		t.Fatalf("expected knowledge hybrid empty-query failure, got %v", err)
	}
	if _, err := c.SkillService().Search("a1", "", 10); err == nil || !strings.Contains(err.Error(), "query is required") {
		t.Fatalf("expected skill search empty-query failure, got %v", err)
	}
}

func TestLexicalSearchFailsClosedWhenFTSUnavailable(t *testing.T) {
	root := t.TempDir()
	c := newTestCognitionAt(t, root)
	if err := c.InitScope("a1"); err != nil {
		t.Fatalf("init scope: %v", err)
	}
	if err := c.MemoryService().Save(memory.Record{RecordID: "m1", ScopeID: "a1", Kind: memory.RecordKindExperience, Version: 1, Content: []byte(`{"summary":"fts target"}`), Lifecycle: memory.RecordLifecycleActive, CreatedAt: ts, UpdatedAt: ts}); err != nil {
		t.Fatalf("save memory: %v", err)
	}
	db, err := sql.Open("sqlite", cognitionDBPath(root))
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	defer db.Close()
	if _, err := db.Exec(`DROP TABLE memory_record_fts`); err != nil {
		t.Fatalf("drop memory fts table: %v", err)
	}
	if _, err := c.MemoryService().SearchLexical("a1", "fts", 10); err == nil || !strings.Contains(err.Error(), "lexical substrate unavailable") {
		t.Fatalf("expected lexical substrate failure, got %v", err)
	}
}

func TestSkillLexicalSearchFailsClosedWhenFTSUnavailable(t *testing.T) {
	root := t.TempDir()
	c := newTestCognitionAt(t, root)
	if err := c.InitScope("a1"); err != nil {
		t.Fatalf("init scope: %v", err)
	}
	if err := c.SkillService().Save(skill.Bundle{
		BundleID:  "s1",
		ScopeID:   "a1",
		Version:   1,
		Status:    skill.BundleStatusActive,
		Name:      "FTS target",
		Steps:     []skill.Step{{StepID: "st1", Instruction: "Read", Order: 1}},
		CreatedAt: ts,
		UpdatedAt: ts,
	}); err != nil {
		t.Fatalf("save skill: %v", err)
	}
	db, err := sql.Open("sqlite", cognitionDBPath(root))
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	defer db.Close()
	if _, err := db.Exec(`DROP TABLE skill_bundle_fts`); err != nil {
		t.Fatalf("drop skill fts table: %v", err)
	}
	if _, err := c.SkillService().Search("a1", "fts", 10); err == nil || !strings.Contains(err.Error(), "lexical substrate unavailable") {
		t.Fatalf("expected skill lexical substrate failure, got %v", err)
	}
}
