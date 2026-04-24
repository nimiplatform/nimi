package promptfmt

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/kernel"
	"github.com/nimiplatform/nimi/nimi-cognition/knowledge"
	"github.com/nimiplatform/nimi/nimi-cognition/memory"
	"github.com/nimiplatform/nimi/nimi-cognition/skill"
)

var ts = time.Date(2026, 4, 16, 12, 0, 0, 0, time.UTC)

func selfRule(stmt string) kernel.Rule {
	return kernel.Rule{
		RuleID: "r1", Kind: kernel.RuleKindSelfFacing, Version: 1,
		Statement: stmt, AnchorBinding: kernel.AnchorBindingLocalOnly,
		Lifecycle: kernel.RuleLifecycleActive, CreatedAt: ts, UpdatedAt: ts,
	}
}

func worldRule(stmt string) kernel.Rule {
	return kernel.Rule{
		RuleID: "w1", Kind: kernel.RuleKindWorldFacing, Version: 1,
		Statement: stmt, AnchorBinding: kernel.AnchorBindingAnchored,
		Alignment: kernel.AlignmentAligned, Lifecycle: kernel.RuleLifecycleActive,
		CreatedAt: ts, UpdatedAt: ts,
	}
}

func memRecord(kind memory.RecordKind, content string) memory.Record {
	c, _ := json.Marshal(content)
	return memory.Record{
		RecordID: "m1", ScopeID: "a1", Kind: kind, Version: 1,
		Content: c, Lifecycle: memory.RecordLifecycleActive,
		CreatedAt: ts, UpdatedAt: ts,
	}
}

func memView(kind memory.RecordKind, content string, support float64) memory.View {
	return memory.View{
		Record:  memRecord(kind, content),
		Support: memory.SupportSummary{Score: support},
	}
}

func knowPage(title string) knowledge.Page {
	return knowledge.Page{
		PageID: "p1", ScopeID: "a1", Kind: knowledge.ProjectionKindExplainer,
		Version: 1, Title: title, Body: []byte(`"page body"`),
		Lifecycle: knowledge.ProjectionLifecycleActive, CreatedAt: ts, UpdatedAt: ts,
	}
}

func skillBundle(name string) skill.Bundle {
	return skill.Bundle{
		BundleID: "s1", ScopeID: "a1", Version: 1,
		Status: skill.BundleStatusActive, Name: name,
		Steps: []skill.Step{
			{StepID: "st1", Instruction: "Do step 1", Order: 1},
			{StepID: "st2", Instruction: "Do step 2", Order: 2},
		},
		CreatedAt: ts, UpdatedAt: ts,
	}
}

// --- Kernel ---

func TestFormatCoreContext_Empty(t *testing.T) {
	if out := FormatCoreContext(nil); out != "" {
		t.Errorf("expected empty, got %q", out)
	}
}

func TestFormatCoreContext_WrapsKernelContext(t *testing.T) {
	out := FormatCoreContext([]kernel.Rule{selfRule("Agent prefers concise responses")})
	if !strings.Contains(out, "[Core-Cognition]") {
		t.Errorf("missing core header in:\n%s", out)
	}
	if !strings.Contains(out, "[Self-Model]") {
		t.Errorf("missing self model section in:\n%s", out)
	}
}

func TestFormatKernelContext_Empty(t *testing.T) {
	if out := FormatKernelContext(nil); out != "" {
		t.Errorf("expected empty, got %q", out)
	}
}

func TestFormatKernelContext_SelfModel(t *testing.T) {
	out := FormatKernelContext([]kernel.Rule{selfRule("Agent prefers concise responses")})
	if !strings.Contains(out, "[Self-Model]") {
		t.Errorf("missing Self-Model header in:\n%s", out)
	}
	if !strings.Contains(out, "Agent prefers concise responses") {
		t.Errorf("missing statement in:\n%s", out)
	}
}

func TestFormatKernelContext_WorldModel(t *testing.T) {
	out := FormatKernelContext([]kernel.Rule{worldRule("Alice works in engineering")})
	if !strings.Contains(out, "[World-Model]") {
		t.Errorf("missing World-Model in:\n%s", out)
	}
}

func TestFormatKernelContext_Mixed(t *testing.T) {
	rules := []kernel.Rule{selfRule("self rule"), worldRule("world rule")}
	out := FormatKernelContext(rules)
	if !strings.Contains(out, "[Self-Model]") || !strings.Contains(out, "[World-Model]") {
		t.Errorf("missing sections in:\n%s", out)
	}
}

func TestFormatKernelContext_FiltersInactive(t *testing.T) {
	r := selfRule("inactive")
	r.Lifecycle = kernel.RuleLifecycleSuperseded
	r.SupersededBy = "r2"
	out := FormatKernelContext([]kernel.Rule{r})
	if out != "" {
		t.Errorf("expected empty for inactive, got:\n%s", out)
	}
}

func TestFormatKernelContext_ShowsStaleAlignment(t *testing.T) {
	r := worldRule("stale rule")
	r.Alignment = kernel.AlignmentStale
	out := FormatKernelContext([]kernel.Rule{r})
	if !strings.Contains(out, "(stale)") {
		t.Errorf("missing stale annotation in:\n%s", out)
	}
}

func TestFormatKernelContext_HidesAligned(t *testing.T) {
	out := FormatKernelContext([]kernel.Rule{worldRule("aligned rule")})
	if strings.Contains(out, "(aligned)") {
		t.Error("aligned state should be hidden")
	}
}

func TestFormatKernelContext_LocalOnlyNoAlignment(t *testing.T) {
	out := FormatKernelContext([]kernel.Rule{selfRule("local rule")})
	if strings.Contains(out, "(") {
		t.Errorf("local_only rules should not show alignment in:\n%s", out)
	}
}

// --- Memory ---

func TestFormatAdvisoryContext_Empty(t *testing.T) {
	if out := FormatAdvisoryContext(nil, nil, nil); out != "" {
		t.Errorf("expected empty, got %q", out)
	}
}

func TestFormatAdvisoryContext_WrapsSecondaryFamilies(t *testing.T) {
	out := FormatAdvisoryContext(
		[]memory.View{memView(memory.RecordKindExperience, "memory", 1)},
		[]knowledge.Page{knowPage("knowledge")},
		[]skill.Bundle{skillBundle("skill")},
	)
	if !strings.Contains(out, "[Advisory-Context]") {
		t.Errorf("missing advisory header in:\n%s", out)
	}
	for _, section := range []string{"[Memory]", "[Knowledge]", "[Skills]"} {
		if !strings.Contains(out, section) {
			t.Errorf("missing %s in:\n%s", section, out)
		}
	}
}

func TestFormatMemoryContext_Empty(t *testing.T) {
	if out := FormatMemoryContext(nil); out != "" {
		t.Errorf("expected empty, got %q", out)
	}
}

func TestFormatMemoryContext_WithRecords(t *testing.T) {
	records := []memory.View{
		memView(memory.RecordKindExperience, "Had a conversation", 1),
		memView(memory.RecordKindObservation, "User likes Go", 0),
	}
	out := FormatMemoryContext(records)
	if !strings.Contains(out, "[Memory]") {
		t.Errorf("missing Memory header in:\n%s", out)
	}
	if !strings.Contains(out, "experience:") {
		t.Errorf("missing kind group in:\n%s", out)
	}
	if !strings.Contains(out, "[support=1.00]") {
		t.Errorf("expected live support annotation in:\n%s", out)
	}
}

func TestFormatMemoryContext_FiltersArchived(t *testing.T) {
	r := memView(memory.RecordKindExperience, "archived", 0)
	r.Record.Lifecycle = memory.RecordLifecycleArchived
	if out := FormatMemoryContext([]memory.View{r}); out != "" {
		t.Errorf("expected empty for archived, got:\n%s", out)
	}
}

// --- Knowledge ---

func TestFormatKnowledgeContext_Empty(t *testing.T) {
	if out := FormatKnowledgeContext(nil); out != "" {
		t.Errorf("expected empty, got %q", out)
	}
}

func TestFormatKnowledgeContext_WithPages(t *testing.T) {
	out := FormatKnowledgeContext([]knowledge.Page{knowPage("Go Interfaces")})
	if !strings.Contains(out, "[Knowledge]") || !strings.Contains(out, "Go Interfaces:") {
		t.Errorf("unexpected output:\n%s", out)
	}
}

func TestFormatKnowledgeContext_ShowsCitationSummary(t *testing.T) {
	p := knowPage("Cited page")
	p.Citations = []knowledge.Citation{
		{TargetKind: knowledge.CitationTargetKindKernelRule, TargetID: "r1", Strength: "strong_ref"},
		{TargetKind: knowledge.CitationTargetKindMemoryRecord, TargetID: "m1", Strength: "weak_ref"},
	}
	out := FormatKnowledgeContext([]knowledge.Page{p})
	if !strings.Contains(out, "[citations=2 kernel_rules=1 memory_records=1]") {
		t.Errorf("missing citation summary in:\n%s", out)
	}
}

func TestFormatKnowledgeContext_ShowsStale(t *testing.T) {
	p := knowPage("Old Info")
	p.Lifecycle = knowledge.ProjectionLifecycleStale
	out := FormatKnowledgeContext([]knowledge.Page{p})
	if !strings.Contains(out, "(stale)") {
		t.Errorf("missing stale marker in:\n%s", out)
	}
}

func TestFormatKnowledgeContext_FiltersArchived(t *testing.T) {
	p := knowPage("archived")
	p.Lifecycle = knowledge.ProjectionLifecycleArchived
	if out := FormatKnowledgeContext([]knowledge.Page{p}); out != "" {
		t.Errorf("expected empty for archived, got:\n%s", out)
	}
}

// --- Skill ---

func TestFormatSkillContext_Empty(t *testing.T) {
	if out := FormatSkillContext(nil); out != "" {
		t.Errorf("expected empty, got %q", out)
	}
}

func TestFormatSkillContext_WithBundle(t *testing.T) {
	out := FormatSkillContext([]skill.Bundle{skillBundle("Code Review")})
	if !strings.Contains(out, "[Skills]") || !strings.Contains(out, "Code Review:") {
		t.Errorf("unexpected output:\n%s", out)
	}
	if !strings.Contains(out, "1. Do step 1") || !strings.Contains(out, "2. Do step 2") {
		t.Errorf("missing steps in:\n%s", out)
	}
}

func TestFormatSkillContext_FiltersDraft(t *testing.T) {
	b := skillBundle("draft")
	b.Status = skill.BundleStatusDraft
	if out := FormatSkillContext([]skill.Bundle{b}); out != "" {
		t.Errorf("expected empty for draft, got:\n%s", out)
	}
}

func TestFormatAdvisoryContext_FiltersRemovedArtifacts(t *testing.T) {
	mv := memView(memory.RecordKindExperience, "removed memory", 1)
	mv.Record.Lifecycle = memory.RecordLifecycleRemoved
	kp := knowPage("Removed Page")
	kp.Lifecycle = knowledge.ProjectionLifecycleRemoved
	sb := skillBundle("Removed Skill")
	sb.Status = skill.BundleStatusRemoved

	if out := FormatAdvisoryContext([]memory.View{mv}, []knowledge.Page{kp}, []skill.Bundle{sb}); out != "" {
		t.Errorf("expected removed advisory artifacts to be excluded, got:\n%s", out)
	}
}

// --- FormatAll ---

func TestFormatAll_CombinesAll(t *testing.T) {
	out := FormatAll(
		[]kernel.Rule{selfRule("self rule")},
		[]memory.View{memView(memory.RecordKindExperience, "memory", 1)},
		[]knowledge.Page{knowPage("knowledge")},
		[]skill.Bundle{skillBundle("skill")},
	)
	for _, section := range []string{"[Core-Cognition]", "[Self-Model]", "[Advisory-Context]", "[Memory]", "[Knowledge]", "[Skills]"} {
		if !strings.Contains(out, section) {
			t.Errorf("missing %s in:\n%s", section, out)
		}
	}
}

func TestFormatAll_EmptyAll(t *testing.T) {
	if out := FormatAll(nil, nil, nil, nil); out != "" {
		t.Errorf("expected empty, got %q", out)
	}
}
