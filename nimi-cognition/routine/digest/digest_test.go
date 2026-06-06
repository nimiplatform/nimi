package digest

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/artifactref"
	"github.com/nimiplatform/nimi/nimi-cognition/cognition"
	"github.com/nimiplatform/nimi/nimi-cognition/internal/clock"
	"github.com/nimiplatform/nimi/nimi-cognition/internal/storage"
	"github.com/nimiplatform/nimi/nimi-cognition/knowledge"
	"github.com/nimiplatform/nimi/nimi-cognition/memory"
	"github.com/nimiplatform/nimi/nimi-cognition/routine"
	"github.com/nimiplatform/nimi/nimi-cognition/skill"
)

var ts = time.Date(2026, 4, 16, 12, 0, 0, 0, time.UTC)

func newDigestStore(t *testing.T) *storage.SQLiteBackend {
	t.Helper()
	store, err := storage.NewSQLiteBackend(t.TempDir())
	if err != nil {
		t.Fatalf("new store: %v", err)
	}
	t.Cleanup(func() {
		_ = store.Close()
	})
	return store
}

func saveTestMemory(t *testing.T, store *storage.SQLiteBackend, rec memory.Record) {
	t.Helper()
	raw, _ := json.Marshal(rec)
	if err := store.Save(rec.ScopeID, storage.KindMemory, string(rec.RecordID), raw); err != nil {
		t.Fatalf("save memory: %v", err)
	}
}

func saveTestKnowledge(t *testing.T, store *storage.SQLiteBackend, page knowledge.Page) {
	t.Helper()
	raw, _ := json.Marshal(page)
	if err := store.Save(page.ScopeID, storage.KindKnowledge, string(page.PageID), raw); err != nil {
		t.Fatalf("save knowledge: %v", err)
	}
}

func saveTestSkill(t *testing.T, store *storage.SQLiteBackend, bundle skill.Bundle) {
	t.Helper()
	raw, _ := json.Marshal(bundle)
	if err := store.Save(bundle.ScopeID, storage.KindSkill, string(bundle.BundleID), raw); err != nil {
		t.Fatalf("save skill: %v", err)
	}
}

func loadSkillStatus(t *testing.T, store *storage.SQLiteBackend, scopeID, bundleID string) skill.BundleStatus {
	t.Helper()
	raw, err := store.Load(scopeID, storage.KindSkill, bundleID)
	if err != nil {
		t.Fatalf("load skill: %v", err)
	}
	var bundle skill.Bundle
	if err := json.Unmarshal(raw, &bundle); err != nil {
		t.Fatalf("decode skill: %v", err)
	}
	return bundle.Status
}

func loadMemoryLifecycle(t *testing.T, store *storage.SQLiteBackend, scopeID, recordID string) memory.RecordLifecycle {
	t.Helper()
	raw, err := store.Load(scopeID, storage.KindMemory, recordID)
	if err != nil {
		t.Fatalf("load memory: %v", err)
	}
	var record memory.Record
	if err := json.Unmarshal(raw, &record); err != nil {
		t.Fatalf("decode memory: %v", err)
	}
	return record.Lifecycle
}

func TestAnalyze_UsesBaselineStyleTrigger(t *testing.T) {
	store := newDigestStore(t)
	d := New(Config{})

	saveTestMemory(t, store, memory.Record{
		RecordID:  "m1",
		ScopeID:   "a1",
		Kind:      memory.RecordKindExperience,
		Version:   1,
		Content:   []byte(`{"summary":"hello"}`),
		Lifecycle: memory.RecordLifecycleActive,
		CreatedAt: ts,
		UpdatedAt: ts,
	})
	saveTestKnowledge(t, store, knowledge.Page{
		PageID:    "p1",
		ScopeID:   "a1",
		Kind:      knowledge.ProjectionKindSummary,
		Version:   1,
		Title:     "Summary",
		Body:      []byte(`"body"`),
		Lifecycle: knowledge.ProjectionLifecycleActive,
		CreatedAt: ts,
		UpdatedAt: ts,
	})
	saveTestMemory(t, store, memory.Record{
		RecordID:  "m2",
		ScopeID:   "a1",
		Kind:      memory.RecordKindExperience,
		Version:   1,
		Content:   []byte(`{"summary":"support page"}`),
		Lifecycle: memory.RecordLifecycleActive,
		ArtifactRefs: []artifactref.Ref{{
			FromKind:  artifactref.KindMemoryRecord,
			FromID:    "m2",
			ToKind:    artifactref.KindKnowledgePage,
			ToID:      "p1",
			Strength:  artifactref.StrengthStrong,
			Role:      "support",
			CreatedAt: ts,
			UpdatedAt: ts,
		}},
		CreatedAt: ts,
		UpdatedAt: ts,
	})

	analysis, err := d.analyze("a1", ts, store, nil)
	if err != nil {
		t.Fatalf("analyze: %v", err)
	}
	if analysis.Trigger.ContentVolume.Current != 3 || analysis.Trigger.ContentVolume.Delta != 3 {
		t.Fatalf("expected current/initial content volume trigger, got %+v", analysis.Trigger)
	}
	if analysis.Trigger.SupportChange.Current == 0 {
		t.Fatalf("expected support-change trigger, got %+v", analysis.Trigger)
	}
	if len(analysis.Candidates) < 2 {
		t.Fatalf("expected multiple cleanup candidates, got %+v", analysis.Candidates)
	}
	for _, candidate := range analysis.Candidates {
		if len(candidate.Detail.BrokenDependencies) != 0 {
			t.Fatalf("valid persisted refs must not produce broken dependency detail, got %+v", candidate)
		}
	}
}

func TestApply_StrongIncomingRefBlocksRemoveAndRequiresLaterPass(t *testing.T) {
	store := newDigestStore(t)
	d := New(Config{})

	saveTestMemory(t, store, memory.Record{
		RecordID:  "m1",
		ScopeID:   "a1",
		Kind:      memory.RecordKindExperience,
		Version:   1,
		Content:   []byte(`{"summary":"hello"}`),
		Lifecycle: memory.RecordLifecycleArchived,
		CreatedAt: ts,
		UpdatedAt: ts,
	})
	saveTestKnowledge(t, store, knowledge.Page{
		PageID:    "p1",
		ScopeID:   "a1",
		Kind:      knowledge.ProjectionKindSummary,
		Version:   1,
		Title:     "Summary",
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
	})

	analysis := AnalysisReport{
		GeneratedAt: ts,
		Candidates: []Candidate{{
			Family:           routine.FamilyMemorySubstrate,
			ArtifactKind:     string(artifactref.KindMemoryRecord),
			ArtifactID:       "m1",
			CurrentLifecycle: "archived",
			ProposedAction:   "remove",
			Reason:           "test",
			Detail:           Detail{TriggerBasis: TriggerSummary{}},
		}},
	}
	_, blocked, err := d.apply("a1", analysis, ts, store, nil)
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if len(blocked) != 1 {
		t.Fatalf("expected blocked removal, got %+v", blocked)
	}
	if len(blocked[0].Detail.Blockers) < 2 {
		t.Fatalf("expected archive-first plus strong-ref blockers, got %+v", blocked[0].Detail.Blockers)
	}
	var sawArchiveFirst bool
	var sawStrong bool
	for _, blocker := range blocked[0].Detail.Blockers {
		if blocker.Kind == routine.BlockerKindArchiveFirst {
			sawArchiveFirst = true
		}
		if blocker.Kind == routine.BlockerKindStrongRef {
			sawStrong = true
		}
	}
	if !sawArchiveFirst || !sawStrong {
		t.Fatalf("expected archive-first and strong-ref blockers, got %+v", blocked[0].Detail.Blockers)
	}
}

func TestRun_FirstPassArchives_ThirdPassRemovesAfterSameBasisConfirmation(t *testing.T) {
	store := newDigestStore(t)
	d := New(Config{})

	saveTestMemory(t, store, memory.Record{
		RecordID:  "m1",
		ScopeID:   "a1",
		Kind:      memory.RecordKindExperience,
		Version:   1,
		Content:   []byte(`{"summary":"hello"}`),
		Lifecycle: memory.RecordLifecycleActive,
		CreatedAt: ts,
		UpdatedAt: ts,
	})

	first, err := d.run("a1", ts, store)
	if err != nil {
		t.Fatalf("first run: %v", err)
	}
	if len(first.Applied) != 1 || first.Applied[0].ToState != string(memory.RecordLifecycleArchived) {
		t.Fatalf("expected first pass to archive only, got %+v", first.Applied)
	}
	if got := loadMemoryLifecycle(t, store, "a1", "m1"); got != memory.RecordLifecycleArchived {
		t.Fatalf("expected archived memory after first pass, got %s", got)
	}

	second, err := d.run("a1", ts.Add(time.Minute), store)
	if err != nil {
		t.Fatalf("second run: %v", err)
	}
	if len(second.Applied) != 0 {
		t.Fatalf("expected second pass to withhold remove until same-basis confirmation, got %+v", second.Applied)
	}
	if len(second.Blocked) != 1 || !second.Blocked[0].Detail.PriorArchiveRequired || second.Blocked[0].Detail.LaterPassConfirmed {
		t.Fatalf("expected archive-first blocker on second pass, got %+v", second.Blocked)
	}
	if second.Analysis.Trigger.ContentVolume.Previous == 0 {
		t.Fatalf("expected second run to compare against previous digest report, got %+v", second.Analysis.Trigger)
	}
	if got := loadMemoryLifecycle(t, store, "a1", "m1"); got != memory.RecordLifecycleArchived {
		t.Fatalf("expected memory to remain archived after second pass, got %s", got)
	}

	third, err := d.run("a1", ts.Add(2*time.Minute), store)
	if err != nil {
		t.Fatalf("third run: %v", err)
	}
	if len(third.Applied) != 1 || third.Applied[0].ToState != string(memory.RecordLifecycleRemoved) || !third.Applied[0].Detail.LaterPassConfirmed {
		t.Fatalf("expected third pass to remove archived candidate after same-basis confirmation, got %+v", third.Applied)
	}
	if got := loadMemoryLifecycle(t, store, "a1", "m1"); got != memory.RecordLifecycleRemoved {
		t.Fatalf("expected removed memory after third pass, got %s", got)
	}
}

func TestRun_ZeroSupportKnowledgeRemoveRequiresConfirmation(t *testing.T) {
	store := newDigestStore(t)
	d := New(Config{})

	saveTestKnowledge(t, store, knowledge.Page{
		PageID:    "p1",
		ScopeID:   "a1",
		Kind:      knowledge.ProjectionKindSummary,
		Version:   1,
		Title:     "Basis Shift",
		Body:      []byte(`"body"`),
		Lifecycle: knowledge.ProjectionLifecycleActive,
		CreatedAt: ts,
		UpdatedAt: ts,
	})

	first, err := d.run("a1", ts, store)
	if err != nil {
		t.Fatalf("first run: %v", err)
	}
	if len(first.Applied) != 1 || first.Applied[0].ToState != string(knowledge.ProjectionLifecycleArchived) {
		t.Fatalf("expected first run to archive knowledge page, got %+v", first.Applied)
	}

	second, err := d.run("a1", ts.Add(time.Minute), store)
	if err != nil {
		t.Fatalf("second run: %v", err)
	}
	if len(second.Blocked) != 1 || second.Blocked[0].Detail.LowValueBasis != lowValueBasisZeroSupport {
		t.Fatalf("expected zero-support remove candidate to remain blocked, got %+v", second.Blocked)
	}

	third, err := d.run("a1", ts.Add(2*time.Minute), store)
	if err != nil {
		t.Fatalf("third run: %v", err)
	}
	if len(third.Applied) != 1 || third.Applied[0].ToState != string(knowledge.ProjectionLifecycleRemoved) || !third.Applied[0].Detail.LaterPassConfirmed {
		t.Fatalf("expected third run to remove after repeated zero-support basis, got %+v", third.Applied)
	}
}

func TestAnalyze_RanksCandidatesWithGroupedEvidence(t *testing.T) {
	store := newDigestStore(t)
	d := New(Config{})

	saveTestKnowledge(t, store, knowledge.Page{
		PageID:    "p-later",
		ScopeID:   "a1",
		Kind:      knowledge.ProjectionKindSummary,
		Version:   1,
		Title:     "Later",
		Body:      []byte(`"body"`),
		Lifecycle: knowledge.ProjectionLifecycleActive,
		CreatedAt: ts,
		UpdatedAt: ts.Add(time.Minute),
	})
	saveTestKnowledge(t, store, knowledge.Page{
		PageID:    "p-zero",
		ScopeID:   "a1",
		Kind:      knowledge.ProjectionKindSummary,
		Version:   1,
		Title:     "Zero Support",
		Body:      []byte(`"body"`),
		Lifecycle: knowledge.ProjectionLifecycleActive,
		CreatedAt: ts,
		UpdatedAt: ts,
	})

	analysis, err := d.analyze("a1", ts.Add(2*time.Minute), store, nil)
	if err != nil {
		t.Fatalf("analyze: %v", err)
	}
	if len(analysis.Candidates) < 2 {
		t.Fatalf("expected multiple ranked candidates, got %+v", analysis.Candidates)
	}
	if analysis.Candidates[0].GroupKey == "" || analysis.Candidates[1].GroupKey == "" {
		t.Fatalf("expected grouped candidate evidence, got %+v", analysis.Candidates[:2])
	}
	for _, candidate := range analysis.Candidates[:2] {
		if candidate.LowValueBasis != lowValueBasisZeroSupport {
			t.Fatalf("expected zero-support candidates with valid persisted refs, got %+v", analysis.Candidates[:2])
		}
	}
}

func TestRun_RemovedWeakIncomingRefAllowsZeroSupportRemove(t *testing.T) {
	store := newDigestStore(t)
	d := New(Config{})

	saveTestMemory(t, store, memory.Record{
		RecordID:  "m1",
		ScopeID:   "a1",
		Kind:      memory.RecordKindExperience,
		Version:   1,
		Content:   []byte(`{"summary":"hello"}`),
		Lifecycle: memory.RecordLifecycleArchived,
		CreatedAt: ts,
		UpdatedAt: ts,
	})
	saveTestKnowledge(t, store, knowledge.Page{
		PageID:    "p1",
		ScopeID:   "a1",
		Kind:      knowledge.ProjectionKindSummary,
		Version:   1,
		Title:     "Summary",
		Body:      []byte(`"body"`),
		Lifecycle: knowledge.ProjectionLifecycleActive,
		ArtifactRefs: []artifactref.Ref{{
			FromKind:  artifactref.KindKnowledgePage,
			FromID:    "p1",
			ToKind:    artifactref.KindMemoryRecord,
			ToID:      "m1",
			Strength:  artifactref.StrengthWeak,
			Role:      "support",
			CreatedAt: ts,
			UpdatedAt: ts,
		}},
		CreatedAt: ts,
		UpdatedAt: ts,
	})
	if err := store.Delete("a1", storage.KindKnowledge, "p1"); err != nil {
		t.Fatalf("delete weak source: %v", err)
	}

	first, err := d.run("a1", ts, store)
	if err != nil {
		t.Fatalf("first run: %v", err)
	}
	if len(first.Blocked) != 1 {
		t.Fatalf("expected blocked remove on first pass, got %+v", first.Blocked)
	}

	second, err := d.run("a1", ts.Add(time.Minute), store)
	if err != nil {
		t.Fatalf("second run: %v", err)
	}
	foundRemoved := false
	for _, applied := range second.Applied {
		if applied.ArtifactID == "m1" && applied.ToState == string(memory.RecordLifecycleRemoved) {
			foundRemoved = true
			break
		}
	}
	if !foundRemoved {
		t.Fatalf("expected remove after weak source deletion cleared incoming ref, got %+v", second)
	}
	if got := loadMemoryLifecycle(t, store, "a1", "m1"); got != memory.RecordLifecycleRemoved {
		t.Fatalf("expected removed memory after weak source deletion, got %s", got)
	}
}

func TestWorker_PersistsStructuredDigestEvidenceAcrossReopen(t *testing.T) {
	root := t.TempDir()
	c, err := cognition.New(root, cognition.WithClock(clock.NewTestClock(ts)))
	if err != nil {
		t.Fatalf("new cognition: %v", err)
	}
	if err := c.InitScope("a1"); err != nil {
		t.Fatalf("init scope: %v", err)
	}
	if err := c.MemoryService().Save(memory.Record{
		RecordID:  "m1",
		ScopeID:   "a1",
		Kind:      memory.RecordKindExperience,
		Version:   1,
		Content:   []byte(`{"summary":"hello"}`),
		Lifecycle: memory.RecordLifecycleActive,
		CreatedAt: ts,
		UpdatedAt: ts,
	}); err != nil {
		t.Fatalf("save memory: %v", err)
	}
	ctx, err := c.NewRoutineContext("a1")
	if err != nil {
		t.Fatalf("new routine context: %v", err)
	}
	if _, err := NewWorker(Config{}).Run(ctx); err != nil {
		t.Fatalf("worker first run: %v", err)
	}
	if _, err := NewWorker(Config{}).Run(ctx); err != nil {
		t.Fatalf("worker second run: %v", err)
	}
	if err := c.Close(); err != nil {
		t.Fatalf("close cognition: %v", err)
	}

	store, err := storage.NewSQLiteBackend(root)
	if err != nil {
		t.Fatalf("reopen store: %v", err)
	}
	defer closeInTest(t, store)

	runIDs, err := store.ListDigestRunIDs("a1")
	if err != nil {
		t.Fatalf("list digest runs after reopen: %v", err)
	}
	if len(runIDs) != 2 {
		t.Fatalf("expected two persisted digest runs, got %+v", runIDs)
	}
	foundTriggerSummary := false
	var latest storage.DigestCandidate
	found := false
	for _, runID := range runIDs {
		reportRaw, err := store.LoadDigestRun("a1", runID)
		if err != nil {
			t.Fatalf("load digest run %s: %v", runID, err)
		}
		var report Report
		if err := json.Unmarshal(reportRaw, &report); err != nil {
			t.Fatalf("decode digest report %s: %v", runID, err)
		}
		if report.Analysis.Trigger.ContentVolume.Current > 0 {
			foundTriggerSummary = true
		}
		candidates, err := store.LoadDigestCandidates("a1", runID)
		if err != nil {
			t.Fatalf("load digest candidates %s: %v", runID, err)
		}
		for _, candidate := range candidates {
			if candidate.Status == "blocked" && candidate.Action == "remove" {
				latest = candidate
				found = true
				break
			}
		}
		if found {
			break
		}
	}
	if !foundTriggerSummary {
		t.Fatal("expected structured trigger summary in persisted digest report")
	}
	if !found {
		t.Fatal("expected blocked digest evidence across persisted digest runs")
	}
	var detail BlockedTransition
	if err := json.Unmarshal(latest.Detail, &detail); err != nil {
		t.Fatalf("decode blocked detail: %v", err)
	}
	if detail.Detail.TriggerBasis.ContentVolume.Current == 0 || detail.Detail.LowValueBasis == "" {
		t.Fatalf("expected structured blocked detail with trigger and basis, got %+v", detail)
	}
}

func TestDigestFamilyIDs_AreCanonicalAuthorityValues(t *testing.T) {
	store := newDigestStore(t)
	d := New(Config{})

	saveTestMemory(t, store, memory.Record{
		RecordID:  "m1",
		ScopeID:   "a1",
		Kind:      memory.RecordKindExperience,
		Version:   1,
		Content:   []byte(`{"summary":"canonical family id"}`),
		Lifecycle: memory.RecordLifecycleActive,
		CreatedAt: ts,
		UpdatedAt: ts,
	})

	report, err := d.run("a1", ts, store)
	if err != nil {
		t.Fatalf("run digest: %v", err)
	}
	if len(report.Analysis.Candidates) == 0 {
		t.Fatalf("expected candidate evidence, got %+v", report)
	}
	for _, candidate := range report.Analysis.Candidates {
		if candidate.Family != routine.FamilyMemorySubstrate {
			t.Fatalf("expected canonical memory family_id, got %+v", candidate)
		}
	}
	result := reportToRoutineResult(report)
	foundMemory := false
	for _, family := range result.FamilyResults {
		switch family.Family {
		case routine.FamilyMemorySubstrate:
			foundMemory = true
		case routine.FamilyKnowledgeProjection, routine.FamilySkillArtifacts:
		default:
			t.Fatalf("unexpected noncanonical routine family result: %+v", family)
		}
	}
	if !foundMemory {
		t.Fatalf("expected memory_substrate routine result, got %+v", result.FamilyResults)
	}
}

func TestDigestApply_RejectsShortFamilyAlias(t *testing.T) {
	store := newDigestStore(t)
	d := New(Config{})

	analysis := AnalysisReport{
		GeneratedAt: ts,
		Candidates: []Candidate{{
			Family:           "memory",
			ArtifactKind:     string(artifactref.KindMemoryRecord),
			ArtifactID:       "m1",
			CurrentLifecycle: "archived",
			ProposedAction:   "remove",
			Reason:           "legacy alias must not be accepted",
			Detail:           Detail{TriggerBasis: TriggerSummary{}},
		}},
	}

	_, _, err := d.apply("a1", analysis, ts, store, nil)
	if err == nil || !strings.Contains(err.Error(), `unsupported canonical family_id "memory"`) {
		t.Fatalf("expected fail-closed short family alias rejection, got %v", err)
	}
}

func TestDigestPersistence_RejectsShortFamilyAlias(t *testing.T) {
	store := newDigestStore(t)

	err := store.SaveDigestRun("a1", "digest_alias_rejected", Report{RunID: "digest_alias_rejected", ScopeID: "a1"}, []storage.DigestCandidate{{
		RunID:        "digest_alias_rejected",
		Family:       "memory",
		ArtifactKind: string(artifactref.KindMemoryRecord),
		ArtifactID:   "m1",
		Action:       "remove",
		Status:       "candidate",
		Reason:       "legacy alias must not be accepted",
		Detail:       json.RawMessage(`{}`),
		CreatedAt:    ts,
		UpdatedAt:    ts,
	}}, ts)
	if err == nil || !strings.Contains(err.Error(), `unsupported canonical family_id "memory"`) {
		t.Fatalf("expected storage alias rejection, got %v", err)
	}
}
