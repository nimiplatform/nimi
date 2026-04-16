package knowledge

import (
	"strings"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/artifactref"
	"github.com/nimiplatform/nimi/nimi-cognition/kernel"
)

var ts = time.Date(2026, 4, 16, 12, 0, 0, 0, time.UTC)

func validPage() Page {
	return Page{
		PageID:    "page_001",
		ScopeID:   "agent_001",
		Kind:      ProjectionKindExplainer,
		Version:   1,
		Title:     "How Go interfaces work",
		Body:      []byte(`"Go interfaces are satisfied implicitly."`),
		Lifecycle: ProjectionLifecycleActive,
		CreatedAt: ts,
		UpdatedAt: ts,
	}
}

func TestValidatePage_Valid(t *testing.T) {
	if err := ValidatePage(validPage()); err != nil {
		t.Fatalf("expected valid: %v", err)
	}
}

func TestValidatePage_AllKinds(t *testing.T) {
	for _, k := range []ProjectionKind{
		ProjectionKindExplainer, ProjectionKindSummary,
		ProjectionKindGuide, ProjectionKindNote,
	} {
		p := validPage()
		p.Kind = k
		if err := ValidatePage(p); err != nil {
			t.Errorf("kind %q should be valid: %v", k, err)
		}
	}
}

func TestValidatePage_AllLifecycles(t *testing.T) {
	for _, l := range []ProjectionLifecycle{
		ProjectionLifecycleActive, ProjectionLifecycleStale,
		ProjectionLifecycleArchived, ProjectionLifecycleRemoved,
	} {
		p := validPage()
		p.Lifecycle = l
		if err := ValidatePage(p); err != nil {
			t.Errorf("lifecycle %q should be valid: %v", l, err)
		}
	}
}

func TestValidatePage_MissingFields(t *testing.T) {
	tests := []struct {
		name   string
		modify func(*Page)
		expect string
	}{
		{"missing page_id", func(p *Page) { p.PageID = "" }, "page_id is required"},
		{"missing scope_id", func(p *Page) { p.ScopeID = "" }, "scope_id is required"},
		{"missing kind", func(p *Page) { p.Kind = "" }, "kind is required"},
		{"invalid kind", func(p *Page) { p.Kind = "bogus" }, "invalid kind"},
		{"bad version", func(p *Page) { p.Version = 0 }, "version must be >= 1"},
		{"missing title", func(p *Page) { p.Title = "" }, "title is required"},
		{"missing body", func(p *Page) { p.Body = nil }, "body is required"},
		{"missing lifecycle", func(p *Page) { p.Lifecycle = "" }, "lifecycle is required"},
		{"invalid lifecycle", func(p *Page) { p.Lifecycle = "bogus" }, "invalid lifecycle"},
		{"missing created_at", func(p *Page) { p.CreatedAt = time.Time{} }, "created_at is required"},
		{"missing updated_at", func(p *Page) { p.UpdatedAt = time.Time{} }, "updated_at is required"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p := validPage()
			tt.modify(&p)
			err := ValidatePage(p)
			if err == nil {
				t.Fatal("expected error")
			}
			if !strings.Contains(err.Error(), tt.expect) {
				t.Errorf("expected %q, got: %v", tt.expect, err)
			}
		})
	}
}

func TestValidatePage_WithCitations(t *testing.T) {
	p := validPage()
	p.Citations = []Citation{
		{TargetKind: "kernel_rule", TargetID: "rule_001", Strength: kernel.RefStrong},
		{TargetKind: "memory_record", TargetID: "mem_001", Strength: kernel.RefWeak},
	}
	if err := ValidatePage(p); err != nil {
		t.Fatalf("page with citations should be valid: %v", err)
	}
}

func TestValidatePage_BadCitation(t *testing.T) {
	p := validPage()
	p.Citations = []Citation{{TargetKind: "", TargetID: "x"}}
	err := ValidatePage(p)
	if err == nil || !strings.Contains(err.Error(), "target_kind is required") {
		t.Fatalf("expected citation error, got: %v", err)
	}
}

func TestValidatePage_BadCitationTargetKind(t *testing.T) {
	p := validPage()
	p.Citations = []Citation{{TargetKind: "fake_kind", TargetID: "x", Strength: kernel.RefStrong}}
	err := ValidatePage(p)
	if err == nil || !strings.Contains(err.Error(), "invalid citation target_kind") {
		t.Fatalf("expected invalid citation target_kind error, got: %v", err)
	}
}

func TestValidatePage_ArtifactRefOwnership(t *testing.T) {
	p := validPage()
	p.ArtifactRefs = []artifactref.Ref{{
		FromKind:  artifactref.KindKnowledgePage,
		FromID:    string(p.PageID),
		ToKind:    artifactref.KindMemoryRecord,
		ToID:      "mem_001",
		Strength:  artifactref.StrengthStrong,
		Role:      "support",
		CreatedAt: ts,
		UpdatedAt: ts,
	}}
	if err := ValidatePage(p); err != nil {
		t.Fatalf("page with artifact refs should be valid: %v", err)
	}
	p.ArtifactRefs[0].FromID = "other"
	err := ValidatePage(p)
	if err == nil || !strings.Contains(err.Error(), "ownership must stay on the page") {
		t.Fatalf("expected ownership error, got: %v", err)
	}
}

func TestValidateRelation_SelfLinkRejected(t *testing.T) {
	err := ValidateRelation(Relation{
		ScopeID:      "agent_001",
		FromPageID:   "page_001",
		ToPageID:     "page_001",
		RelationType: "supports",
		Strength:     artifactref.StrengthStrong,
		CreatedAt:    ts,
		UpdatedAt:    ts,
	})
	if err == nil || !strings.Contains(err.Error(), "self-links") {
		t.Fatalf("expected self-link validation error, got: %v", err)
	}
}

func TestValidateIngestEnvelope_MissingTitleRejected(t *testing.T) {
	err := ValidateIngestEnvelope(IngestEnvelope{
		PageID: "page_001",
		Kind:   ProjectionKindGuide,
		Body:   []byte(`"body"`),
	})
	if err == nil || !strings.Contains(err.Error(), "title is required") {
		t.Fatalf("expected missing title error, got: %v", err)
	}
}
