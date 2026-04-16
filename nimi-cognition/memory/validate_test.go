package memory

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/artifactref"
)

var ts = time.Date(2026, 4, 16, 12, 0, 0, 0, time.UTC)

func validRecord() Record {
	content, _ := json.Marshal(Experience{Summary: "Had a conversation about Go"})
	return Record{
		RecordID:  "mem_001",
		ScopeID:   "agent_001",
		Kind:      RecordKindExperience,
		Version:   1,
		Content:   content,
		Lifecycle: RecordLifecycleActive,
		CreatedAt: ts,
		UpdatedAt: ts,
	}
}

func TestValidateRecord_Valid(t *testing.T) {
	if err := ValidateRecord(validRecord()); err != nil {
		t.Fatalf("expected valid: %v", err)
	}
}

func TestValidateRecord_AllKinds(t *testing.T) {
	tests := []struct {
		kind    RecordKind
		content any
	}{
		{RecordKindExperience, Experience{Summary: "Had a conversation about Go"}},
		{RecordKindObservation, Observation{Subject: "user", Predicate: "likes", Object: "Go"}},
		{RecordKindEvent, Event{EventType: "meeting", Summary: "Team sync"}},
		{RecordKindEvidence, EvidenceRow{Claim: "Go supports interfaces", Support: "language spec"}},
		{RecordKindNarrative, NarrativeProjection{Title: "Week summary", Body: "The week was productive."}},
	}
	for _, tt := range tests {
		r := validRecord()
		r.Kind = tt.kind
		r.Content, _ = json.Marshal(tt.content)
		if err := ValidateRecord(r); err != nil {
			t.Errorf("kind %q should be valid: %v", tt.kind, err)
		}
	}
}

func TestValidateRecord_AllLifecycles(t *testing.T) {
	for _, l := range []RecordLifecycle{
		RecordLifecycleActive, RecordLifecycleArchived, RecordLifecycleRemoved,
	} {
		r := validRecord()
		r.Lifecycle = l
		if err := ValidateRecord(r); err != nil {
			t.Errorf("lifecycle %q should be valid: %v", l, err)
		}
	}
}

func TestValidateRecord_MissingFields(t *testing.T) {
	tests := []struct {
		name   string
		modify func(*Record)
		expect string
	}{
		{"missing record_id", func(r *Record) { r.RecordID = "" }, "record_id is required"},
		{"missing scope_id", func(r *Record) { r.ScopeID = "" }, "scope_id is required"},
		{"missing kind", func(r *Record) { r.Kind = "" }, "kind is required"},
		{"invalid kind", func(r *Record) { r.Kind = "bogus" }, "invalid kind"},
		{"bad version", func(r *Record) { r.Version = 0 }, "version must be >= 1"},
		{"missing content", func(r *Record) { r.Content = nil }, "content is required"},
		{"wrong content shape", func(r *Record) { r.Content = []byte(`{"summary":""}`) }, "experience.summary is required"},
		{"missing lifecycle", func(r *Record) { r.Lifecycle = "" }, "lifecycle is required"},
		{"invalid lifecycle", func(r *Record) { r.Lifecycle = "bogus" }, "invalid lifecycle"},
		{"missing created_at", func(r *Record) { r.CreatedAt = time.Time{} }, "created_at is required"},
		{"missing updated_at", func(r *Record) { r.UpdatedAt = time.Time{} }, "updated_at is required"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := validRecord()
			tt.modify(&r)
			err := ValidateRecord(r)
			if err == nil {
				t.Fatal("expected error")
			}
			if !strings.Contains(err.Error(), tt.expect) {
				t.Errorf("expected %q, got: %v", tt.expect, err)
			}
		})
	}
}

func TestValidateRecord_RejectsIllegalArtifactRefOwnership(t *testing.T) {
	r := validRecord()
	r.ArtifactRefs = []artifactref.Ref{{
		FromKind:  artifactref.KindKnowledgePage,
		FromID:    "p1",
		ToKind:    artifactref.KindSkillBundle,
		ToID:      "s1",
		Strength:  artifactref.StrengthStrong,
		Role:      "support",
		CreatedAt: ts,
		UpdatedAt: ts,
	}}
	err := ValidateRecord(r)
	if err == nil || !strings.Contains(err.Error(), "ownership must stay on the record") {
		t.Fatalf("expected artifact ownership failure, got %v", err)
	}
}
