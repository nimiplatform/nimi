package storage

import (
	"database/sql"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/artifactref"
	"github.com/nimiplatform/nimi/nimi-cognition/knowledge"
	"github.com/nimiplatform/nimi/nimi-cognition/memory"
	"github.com/nimiplatform/nimi/nimi-cognition/skill"
)

func TestSQLiteBackend_MemorySchemaOmitsServiceMetadataColumns(t *testing.T) {
	b, err := NewSQLiteBackend(t.TempDir())
	if err != nil {
		t.Fatalf("new sqlite backend: %v", err)
	}
	defer closeInTest(t, b)

	rows, err := b.db.Query(`PRAGMA table_info(memory_record)`)
	if err != nil {
		t.Fatalf("pragma table_info: %v", err)
	}
	defer closeInTest(t, rows)

	columns := map[string]bool{}
	for rows.Next() {
		var cid int
		var name string
		var ctype string
		var notNull int
		var dflt sql.NullString
		var pk int
		if err := rows.Scan(&cid, &name, &ctype, &notNull, &dflt, &pk); err != nil {
			t.Fatalf("scan pragma row: %v", err)
		}
		columns[name] = true
	}
	if rows.Err() != nil {
		t.Fatalf("iterate pragma rows: %v", rows.Err())
	}
	if columns["support_score"] || columns["drift_status"] {
		t.Fatalf("memory_record schema still contains removed service metadata columns: %+v", columns)
	}
}

func TestSQLiteBackend_KernelCommitIDsAreScopeLocal(t *testing.T) {
	b, err := NewSQLiteBackend(t.TempDir())
	if err != nil {
		t.Fatalf("new sqlite backend: %v", err)
	}
	defer closeInTest(t, b)

	now := time.Date(2026, 4, 16, 12, 0, 0, 0, time.UTC)
	for _, scopeID := range []string{"a1", "a2"} {
		raw, err := json.Marshal(map[string]any{
			"commit_id":   "commit_same",
			"kernel_type": "agent_model",
			"scope_id":    scopeID,
			"created_at":  now.Format(time.RFC3339Nano),
		})
		if err != nil {
			t.Fatalf("marshal commit: %v", err)
		}
		if err := b.Save(scopeID, KindCommit, "commit_same", raw); err != nil {
			t.Fatalf("save commit %s: %v", scopeID, err)
		}
	}
	for _, scopeID := range []string{"a1", "a2"} {
		raw, err := b.Load(scopeID, KindCommit, "commit_same")
		if err != nil {
			t.Fatalf("load commit %s: %v", scopeID, err)
		}
		if !strings.Contains(string(raw), scopeID) {
			t.Fatalf("scope %s loaded mismatched commit payload %s", scopeID, string(raw))
		}
	}
}

func TestSQLiteBackend_DigestRunIDsAreScopeLocal(t *testing.T) {
	b, err := NewSQLiteBackend(t.TempDir())
	if err != nil {
		t.Fatalf("new sqlite backend: %v", err)
	}
	defer closeInTest(t, b)

	now := time.Date(2026, 4, 16, 12, 0, 0, 0, time.UTC)
	for _, scopeID := range []string{"a1", "a2"} {
		if err := b.SaveDigestRun(scopeID, "run_same", map[string]string{"scope_id": scopeID}, []DigestCandidate{{
			RunID:        "run_same",
			Family:       "memory_substrate",
			ArtifactKind: "memory_record",
			ArtifactID:   "m1",
			Action:       "archive",
			Status:       "candidate",
			Reason:       "scope-local run evidence",
			Detail:       json.RawMessage(`{}`),
			CreatedAt:    now,
			UpdatedAt:    now,
		}}, now); err != nil {
			t.Fatalf("save digest run %s: %v", scopeID, err)
		}
	}
	if err := b.SaveDigestRun("a2", "run_same", map[string]string{"scope_id": "a2", "replacement": "true"}, []DigestCandidate{{
		RunID:        "run_same",
		Family:       "knowledge_projections",
		ArtifactKind: string(artifactref.KindKnowledgePage),
		ArtifactID:   "p2",
		Action:       "remove",
		Status:       "blocked",
		Reason:       "scope-local replacement evidence",
		Detail:       json.RawMessage(`{"blocked_by":["archive_first"]}`),
		CreatedAt:    now,
		UpdatedAt:    now,
	}}, now); err != nil {
		t.Fatalf("replace digest run a2: %v", err)
	}
	for _, scopeID := range []string{"a1", "a2"} {
		raw, err := b.LoadDigestRun(scopeID, "run_same")
		if err != nil {
			t.Fatalf("load digest run %s: %v", scopeID, err)
		}
		if !strings.Contains(string(raw), scopeID) {
			t.Fatalf("scope %s loaded mismatched digest payload %s", scopeID, string(raw))
		}
		candidates, err := b.LoadDigestCandidates(scopeID, "run_same")
		if err != nil {
			t.Fatalf("load digest candidates %s: %v", scopeID, err)
		}
		if len(candidates) != 1 || candidates[0].RunID != "run_same" {
			t.Fatalf("scope %s loaded mismatched candidates %+v", scopeID, candidates)
		}
		switch scopeID {
		case "a1":
			if candidates[0].ArtifactID != "m1" || candidates[0].Family != "memory_substrate" {
				t.Fatalf("scope a1 candidate was overwritten by cross-scope replacement: %+v", candidates)
			}
		case "a2":
			if candidates[0].ArtifactID != "p2" || candidates[0].Family != "knowledge_projections" {
				t.Fatalf("scope a2 candidate was not replaced in-scope: %+v", candidates)
			}
		}
	}
}

func TestSQLiteBackend_SaveDigestRunRejectsMalformedCandidateEvidence(t *testing.T) {
	b, err := NewSQLiteBackend(t.TempDir())
	if err != nil {
		t.Fatalf("new sqlite backend: %v", err)
	}
	defer closeInTest(t, b)

	now := time.Date(2026, 4, 16, 12, 0, 0, 0, time.UTC)
	valid := DigestCandidate{
		RunID:        "run_001",
		Family:       "memory_substrate",
		ArtifactKind: string(artifactref.KindMemoryRecord),
		ArtifactID:   "m1",
		Action:       "archive",
		Status:       "candidate",
		Reason:       "candidate evidence must be complete",
		Detail:       json.RawMessage(`{"support_score":0}`),
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	tests := []struct {
		name    string
		mutate  func(*DigestCandidate)
		wantErr string
	}{
		{
			name: "run id mismatch",
			mutate: func(candidate *DigestCandidate) {
				candidate.RunID = "run_other"
			},
			wantErr: "does not match digest run_id",
		},
		{
			name: "wrong artifact kind for family",
			mutate: func(candidate *DigestCandidate) {
				candidate.ArtifactKind = string(artifactref.KindKnowledgePage)
			},
			wantErr: "requires artifact_kind",
		},
		{
			name: "empty artifact id",
			mutate: func(candidate *DigestCandidate) {
				candidate.ArtifactID = ""
			},
			wantErr: "artifact_id",
		},
		{
			name: "unsupported status action",
			mutate: func(candidate *DigestCandidate) {
				candidate.Status = "applied"
				candidate.Action = "remove"
			},
			wantErr: `status "applied" does not admit action "remove"`,
		},
		{
			name: "blank reason",
			mutate: func(candidate *DigestCandidate) {
				candidate.Reason = " "
			},
			wantErr: "reason is required",
		},
		{
			name: "invalid detail json",
			mutate: func(candidate *DigestCandidate) {
				candidate.Detail = json.RawMessage(`{`)
			},
			wantErr: "detail_json must be valid JSON",
		},
		{
			name: "non-object detail json",
			mutate: func(candidate *DigestCandidate) {
				candidate.Detail = json.RawMessage(`[]`)
			},
			wantErr: "detail_json must be a JSON object",
		},
		{
			name: "zero created at",
			mutate: func(candidate *DigestCandidate) {
				candidate.CreatedAt = time.Time{}
			},
			wantErr: "created_at is required",
		},
		{
			name: "updated before created",
			mutate: func(candidate *DigestCandidate) {
				candidate.UpdatedAt = now.Add(-time.Second)
			},
			wantErr: "updated_at must not be before created_at",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			candidate := valid
			tt.mutate(&candidate)
			err := b.SaveDigestRun("a1", "run_001", map[string]string{"run_id": "run_001"}, []DigestCandidate{candidate}, now)
			if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("expected %q, got %v", tt.wantErr, err)
			}
			runIDs, listErr := b.ListDigestRunIDs("a1")
			if listErr != nil {
				t.Fatalf("list digest runs: %v", listErr)
			}
			if len(runIDs) != 0 {
				t.Fatalf("malformed candidate persisted digest run ids: %+v", runIDs)
			}
		})
	}
}

func TestSQLiteBackend_SkillSearchDoesNotIndexUnadmittedMetadata(t *testing.T) {
	b, err := NewSQLiteBackend(t.TempDir())
	if err != nil {
		t.Fatalf("new sqlite backend: %v", err)
	}
	defer closeInTest(t, b)

	raw, err := json.Marshal(map[string]any{
		"bundle_id":   "skill_001",
		"scope_id":    "agent_001",
		"version":     1,
		"status":      string(skill.BundleStatusActive),
		"name":        "Code Review Procedure",
		"description": "Review code changes",
		"steps": []map[string]any{
			{"step_id": "s1", "instruction": "Read the diff", "order": 1},
		},
		"metadata": map[string]any{
			"runtime_provider": "forbiddenprovidertoken",
			"scheduler":        "forbiddenschedulertoken",
		},
		"created_at": time.Date(2026, 4, 16, 12, 0, 0, 0, time.UTC),
		"updated_at": time.Date(2026, 4, 16, 12, 0, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("marshal skill bundle: %v", err)
	}
	if err := b.Save("agent_001", KindSkill, "skill_001", raw); err != nil {
		t.Fatalf("save skill bundle: %v", err)
	}
	if got, err := b.SearchSkill("agent_001", "forbiddenprovidertoken", 10); err != nil {
		t.Fatalf("search skill metadata token: %v", err)
	} else if len(got) != 0 {
		t.Fatalf("metadata token must not be indexed, got %+v", got)
	}
	if got, err := b.SearchSkill("agent_001", "review", 10); err != nil {
		t.Fatalf("search skill admitted text: %v", err)
	} else if len(got) != 1 {
		t.Fatalf("expected admitted skill text to remain searchable, got %+v", got)
	}
}

func TestSQLiteBackend_SaveRejectsPayloadScopeMismatch(t *testing.T) {
	b, err := NewSQLiteBackend(t.TempDir())
	if err != nil {
		t.Fatalf("new sqlite backend: %v", err)
	}
	defer closeInTest(t, b)

	raw, err := json.Marshal(testMemoryRecord("m1", "agent_payload", nil))
	if err != nil {
		t.Fatalf("marshal memory: %v", err)
	}
	err = b.Save("agent_save", KindMemory, "m1", raw)
	if err == nil || !strings.Contains(err.Error(), "payload scope agent_payload does not match save scope agent_save") {
		t.Fatalf("expected scope mismatch error, got: %v", err)
	}
	if got, err := b.Load("agent_save", KindMemory, "m1"); err != nil {
		t.Fatalf("load memory after rejected save: %v", err)
	} else if got != nil {
		t.Fatalf("rejected mismatched-scope save must not commit durable row")
	}
}

func TestSQLiteBackend_SaveRejectsUnresolvedRefsBeforeCommit(t *testing.T) {
	b, err := NewSQLiteBackend(t.TempDir())
	if err != nil {
		t.Fatalf("new sqlite backend: %v", err)
	}
	defer closeInTest(t, b)

	ref := testArtifactRef(artifactref.KindMemoryRecord, "m1", artifactref.KindKnowledgePage, "missing_page")
	raw, err := json.Marshal(testMemoryRecord("m1", "agent_001", []artifactref.Ref{ref}))
	if err != nil {
		t.Fatalf("marshal memory: %v", err)
	}
	err = b.Save("agent_001", KindMemory, "m1", raw)
	if err == nil || !strings.Contains(err.Error(), "target knowledge_page/missing_page does not exist or is removed") {
		t.Fatalf("expected unresolved ref rejection, got: %v", err)
	}
	if got, err := b.Load("agent_001", KindMemory, "m1"); err != nil {
		t.Fatalf("load memory after rejected save: %v", err)
	} else if got != nil {
		t.Fatalf("rejected unresolved-ref save must not commit durable row")
	}
}

func TestSQLiteBackend_SaveRejectsForbiddenTargetFamily(t *testing.T) {
	b, err := NewSQLiteBackend(t.TempDir())
	if err != nil {
		t.Fatalf("new sqlite backend: %v", err)
	}
	defer closeInTest(t, b)

	ref := testArtifactRef(artifactref.KindMemoryRecord, "m1", artifactref.KindKernelRule, "rule_001")
	raw, err := json.Marshal(testMemoryRecord("m1", "agent_001", []artifactref.Ref{ref}))
	if err != nil {
		t.Fatalf("marshal memory: %v", err)
	}
	err = b.Save("agent_001", KindMemory, "m1", raw)
	if err == nil || !strings.Contains(err.Error(), "target family kernel_rule is not admitted") {
		t.Fatalf("expected forbidden target family rejection, got: %v", err)
	}
}

func TestSQLiteBackend_SaveAcceptsLiveAdmittedRefs(t *testing.T) {
	b, err := NewSQLiteBackend(t.TempDir())
	if err != nil {
		t.Fatalf("new sqlite backend: %v", err)
	}
	defer closeInTest(t, b)

	pageRaw, err := json.Marshal(testKnowledgePage("page_001", "agent_001", nil))
	if err != nil {
		t.Fatalf("marshal knowledge: %v", err)
	}
	if err := b.Save("agent_001", KindKnowledge, "page_001", pageRaw); err != nil {
		t.Fatalf("save target knowledge page: %v", err)
	}

	ref := testArtifactRef(artifactref.KindMemoryRecord, "m1", artifactref.KindKnowledgePage, "page_001")
	raw, err := json.Marshal(testMemoryRecord("m1", "agent_001", []artifactref.Ref{ref}))
	if err != nil {
		t.Fatalf("marshal memory: %v", err)
	}
	if err := b.Save("agent_001", KindMemory, "m1", raw); err != nil {
		t.Fatalf("save memory with live admitted ref: %v", err)
	}
}

func TestSQLiteBackend_DeleteRejectsIncomingRefs(t *testing.T) {
	b, err := NewSQLiteBackend(t.TempDir())
	if err != nil {
		t.Fatalf("new sqlite backend: %v", err)
	}
	defer closeInTest(t, b)

	memRaw, err := json.Marshal(testMemoryRecord("m1", "agent_001", nil))
	if err != nil {
		t.Fatalf("marshal memory: %v", err)
	}
	if err := b.Save("agent_001", KindMemory, "m1", memRaw); err != nil {
		t.Fatalf("save target memory: %v", err)
	}
	ref := testArtifactRef(artifactref.KindKnowledgePage, "page_001", artifactref.KindMemoryRecord, "m1")
	pageRaw, err := json.Marshal(testKnowledgePage("page_001", "agent_001", []artifactref.Ref{ref}))
	if err != nil {
		t.Fatalf("marshal knowledge: %v", err)
	}
	if err := b.Save("agent_001", KindKnowledge, "page_001", pageRaw); err != nil {
		t.Fatalf("save referring knowledge page: %v", err)
	}
	err = b.Delete("agent_001", KindMemory, "m1")
	if err == nil || !strings.Contains(err.Error(), "blocked by 1 incoming refs") {
		t.Fatalf("expected incoming-ref delete blocker, got: %v", err)
	}
}

func TestSQLiteBackend_SaveRemovedRejectsIncomingRefs(t *testing.T) {
	b, err := NewSQLiteBackend(t.TempDir())
	if err != nil {
		t.Fatalf("new sqlite backend: %v", err)
	}
	defer closeInTest(t, b)

	mem := testMemoryRecord("m1", "agent_001", nil)
	memRaw, err := json.Marshal(mem)
	if err != nil {
		t.Fatalf("marshal memory: %v", err)
	}
	if err := b.Save("agent_001", KindMemory, "m1", memRaw); err != nil {
		t.Fatalf("save target memory: %v", err)
	}
	ref := testArtifactRef(artifactref.KindKnowledgePage, "page_001", artifactref.KindMemoryRecord, "m1")
	pageRaw, err := json.Marshal(testKnowledgePage("page_001", "agent_001", []artifactref.Ref{ref}))
	if err != nil {
		t.Fatalf("marshal knowledge: %v", err)
	}
	if err := b.Save("agent_001", KindKnowledge, "page_001", pageRaw); err != nil {
		t.Fatalf("save referring knowledge page: %v", err)
	}
	mem.Lifecycle = memory.RecordLifecycleRemoved
	mem.UpdatedAt = mem.UpdatedAt.Add(time.Minute)
	removedRaw, err := json.Marshal(mem)
	if err != nil {
		t.Fatalf("marshal removed memory: %v", err)
	}
	err = b.Save("agent_001", KindMemory, "m1", removedRaw)
	if err == nil || !strings.Contains(err.Error(), "blocked by 1 incoming refs") {
		t.Fatalf("expected incoming-ref removed-save blocker, got: %v", err)
	}
}

func testMemoryRecord(recordID string, scopeID string, refs []artifactref.Ref) memory.Record {
	ts := time.Date(2026, 5, 7, 9, 0, 0, 0, time.UTC)
	return memory.Record{
		RecordID:     memory.RecordID(recordID),
		ScopeID:      scopeID,
		Kind:         memory.RecordKindExperience,
		Version:      1,
		Content:      []byte(`{"summary":"storage reference test"}`),
		ArtifactRefs: refs,
		Lifecycle:    memory.RecordLifecycleActive,
		CreatedAt:    ts,
		UpdatedAt:    ts,
	}
}

func testKnowledgePage(pageID string, scopeID string, refs []artifactref.Ref) knowledge.Page {
	ts := time.Date(2026, 5, 7, 9, 0, 0, 0, time.UTC)
	return knowledge.Page{
		PageID:       knowledge.PageID(pageID),
		ScopeID:      scopeID,
		Kind:         knowledge.ProjectionKindExplainer,
		Version:      1,
		Title:        "Storage Reference Test",
		Body:         []byte(`"storage reference test"`),
		ArtifactRefs: refs,
		Lifecycle:    knowledge.ProjectionLifecycleActive,
		CreatedAt:    ts,
		UpdatedAt:    ts,
	}
}

func testArtifactRef(fromKind artifactref.Kind, fromID string, toKind artifactref.Kind, toID string) artifactref.Ref {
	ts := time.Date(2026, 5, 7, 9, 0, 0, 0, time.UTC)
	return artifactref.Ref{
		FromKind:  fromKind,
		FromID:    fromID,
		ToKind:    toKind,
		ToID:      toID,
		Strength:  artifactref.StrengthStrong,
		Role:      "support",
		CreatedAt: ts,
		UpdatedAt: ts,
	}
}
