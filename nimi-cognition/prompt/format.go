// Package prompt formats cognition artifacts into structured text
// suitable for injection into LLM system prompts or context windows.
//
// The formatting surface is intentionally split:
//   - core context: active kernel rules
//   - advisory context: memory / knowledge / skill artifacts, secondary aids
//
// This keeps kernel rules distinct from supporting context.
package prompt

import (
	"fmt"
	"sort"
	"strings"

	"github.com/nimiplatform/nimi/nimi-cognition/kernel"
	"github.com/nimiplatform/nimi/nimi-cognition/knowledge"
	"github.com/nimiplatform/nimi/nimi-cognition/memory"
	"github.com/nimiplatform/nimi/nimi-cognition/skill"
)

// FormatAll formats the core and advisory context into one text block while
// preserving their hierarchy.
func FormatAll(rules []kernel.Rule, records []memory.View, pages []knowledge.Page, bundles []skill.Bundle) string {
	var sections []string
	if s := FormatCoreContext(rules); s != "" {
		sections = append(sections, s)
	}
	if s := FormatAdvisoryContext(records, pages, bundles); s != "" {
		sections = append(sections, s)
	}
	return strings.Join(sections, "\n\n")
}

// FormatCoreContext formats only active kernel rules.
func FormatCoreContext(rules []kernel.Rule) string {
	body := FormatKernelContext(rules)
	if body == "" {
		return ""
	}
	return joinSections("[Core-Cognition]", body)
}

// FormatAdvisoryContext formats the supporting artifact families.
func FormatAdvisoryContext(records []memory.View, pages []knowledge.Page, bundles []skill.Bundle) string {
	var sections []string
	if s := FormatMemoryContext(records); s != "" {
		sections = append(sections, s)
	}
	if s := FormatKnowledgeContext(pages); s != "" {
		sections = append(sections, s)
	}
	if s := FormatSkillContext(bundles); s != "" {
		sections = append(sections, s)
	}
	if len(sections) == 0 {
		return ""
	}
	return joinSections("[Advisory-Context]", strings.Join(sections, "\n\n"))
}

// FormatKernelContext formats kernel rules grouped by kind and statement.
func FormatKernelContext(rules []kernel.Rule) string {
	active := filterActiveRules(rules)
	if len(active) == 0 {
		return ""
	}

	self, world := partitionRulesByKind(active)
	var sections []string
	if s := formatRuleSection("Self-Model", self); s != "" {
		sections = append(sections, s)
	}
	if s := formatRuleSection("World-Model", world); s != "" {
		sections = append(sections, s)
	}
	return strings.Join(sections, "\n\n")
}

// FormatMemoryContext formats active memory views as context.
func FormatMemoryContext(records []memory.View) string {
	active := filterActiveRecords(records)
	if len(active) == 0 {
		return ""
	}

	var b strings.Builder
	b.WriteString("[Memory]")
	groups := groupRecordsByKind(active)
	for _, kind := range sortedRecordKinds(groups) {
		fmt.Fprintf(&b, "\n%s:", kind)
		for _, view := range groups[kind] {
			fmt.Fprintf(&b, "\n- %s", truncate(string(view.Record.Content), 200))
			if view.Support.Score > 0 {
				fmt.Fprintf(&b, " [support=%.2f]", view.Support.Score)
			}
			if len(view.Record.SourceRefs) > 0 {
				fmt.Fprintf(&b, " [sources=%d]", len(view.Record.SourceRefs))
			}
			if len(view.CleanupSignals) > 0 {
				fmt.Fprintf(&b, " [cleanup=%s]", strings.Join(view.CleanupSignals, ","))
			}
		}
	}
	return b.String()
}

// FormatKnowledgeContext formats active knowledge pages as context.
func FormatKnowledgeContext(pages []knowledge.Page) string {
	active := filterActivePages(pages)
	if len(active) == 0 {
		return ""
	}

	var b strings.Builder
	b.WriteString("[Knowledge]")
	for _, p := range active {
		fmt.Fprintf(&b, "\n%s:", p.Title)
		body := truncate(string(p.Body), 300)
		fmt.Fprintf(&b, "\n  %s", body)
		if p.Lifecycle == knowledge.ProjectionLifecycleStale {
			b.WriteString(" (stale)")
		}
		if len(p.ArtifactRefs) > 0 {
			fmt.Fprintf(&b, " [refs=%d]", len(p.ArtifactRefs))
		}
		if len(p.SourceRefs) > 0 {
			fmt.Fprintf(&b, " [sources=%d]", len(p.SourceRefs))
		}
		if summary := formatCitationSummary(p.Citations); summary != "" {
			fmt.Fprintf(&b, " %s", summary)
		}
	}
	return b.String()
}

// FormatSkillContext formats active skill bundles as context.
func FormatSkillContext(bundles []skill.Bundle) string {
	active := filterActiveBundles(bundles)
	if len(active) == 0 {
		return ""
	}

	var b strings.Builder
	b.WriteString("[Skills]")
	for _, s := range active {
		fmt.Fprintf(&b, "\n%s: [advisory]", s.Name)
		if s.Trigger != nil {
			fmt.Fprintf(&b, " [selector=%s:%s]", s.Trigger.TriggerKind, truncate(s.Trigger.Condition, 80))
		}
		for _, step := range s.Steps {
			fmt.Fprintf(&b, "\n  %d. %s", step.Order, step.Instruction)
		}
		if len(s.ArtifactRefs) > 0 {
			fmt.Fprintf(&b, "\n  refs=%d", len(s.ArtifactRefs))
		}
	}
	return b.String()
}

// --- Rule helpers ---

func filterActiveRules(rules []kernel.Rule) []kernel.Rule {
	var result []kernel.Rule
	for _, r := range rules {
		if r.Lifecycle == kernel.RuleLifecycleActive {
			result = append(result, r)
		}
	}
	return result
}

func partitionRulesByKind(rules []kernel.Rule) (self, world []kernel.Rule) {
	for _, r := range rules {
		switch r.Kind {
		case kernel.RuleKindSelfFacing:
			self = append(self, r)
		case kernel.RuleKindWorldFacing:
			world = append(world, r)
		}
	}
	return
}

func formatRuleSection(title string, rules []kernel.Rule) string {
	if len(rules) == 0 {
		return ""
	}
	sort.Slice(rules, func(i, j int) bool {
		return rules[i].UpdatedAt.After(rules[j].UpdatedAt)
	})

	var b strings.Builder
	fmt.Fprintf(&b, "[%s]", title)
	for _, r := range rules {
		fmt.Fprintf(&b, "\n- %s", r.Statement)
		if r.AnchorBinding == kernel.AnchorBindingAnchored && r.Alignment != kernel.AlignmentAligned {
			fmt.Fprintf(&b, " (%s)", r.Alignment)
		}
	}
	return b.String()
}

// --- Memory helpers ---

func filterActiveRecords(records []memory.View) []memory.View {
	var result []memory.View
	for _, r := range records {
		if r.Record.Lifecycle == memory.RecordLifecycleActive {
			result = append(result, r)
		}
	}
	return result
}

func groupRecordsByKind(records []memory.View) map[memory.RecordKind][]memory.View {
	groups := make(map[memory.RecordKind][]memory.View)
	for _, r := range records {
		groups[r.Record.Kind] = append(groups[r.Record.Kind], r)
	}
	return groups
}

func sortedRecordKinds(groups map[memory.RecordKind][]memory.View) []memory.RecordKind {
	keys := make([]memory.RecordKind, 0, len(groups))
	for k := range groups {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool { return keys[i] < keys[j] })
	return keys
}

// --- Knowledge helpers ---

func filterActivePages(pages []knowledge.Page) []knowledge.Page {
	var result []knowledge.Page
	for _, p := range pages {
		if p.Lifecycle == knowledge.ProjectionLifecycleActive ||
			p.Lifecycle == knowledge.ProjectionLifecycleStale {
			result = append(result, p)
		}
	}
	return result
}

func formatCitationSummary(citations []knowledge.Citation) string {
	if len(citations) == 0 {
		return ""
	}
	var kernelRuleCount int
	var memoryRecordCount int
	for _, citation := range citations {
		switch citation.TargetKind {
		case knowledge.CitationTargetKindKernelRule:
			kernelRuleCount++
		case knowledge.CitationTargetKindMemoryRecord:
			memoryRecordCount++
		}
	}
	parts := []string{fmt.Sprintf("citations=%d", len(citations))}
	if kernelRuleCount > 0 {
		parts = append(parts, fmt.Sprintf("kernel_rules=%d", kernelRuleCount))
	}
	if memoryRecordCount > 0 {
		parts = append(parts, fmt.Sprintf("memory_records=%d", memoryRecordCount))
	}
	return fmt.Sprintf("[%s]", strings.Join(parts, " "))
}

// --- Skill helpers ---

func filterActiveBundles(bundles []skill.Bundle) []skill.Bundle {
	var result []skill.Bundle
	for _, s := range bundles {
		if s.Status == skill.BundleStatusActive {
			result = append(result, s)
		}
	}
	return result
}

// --- Common ---

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max] + "..."
}

func joinSections(title string, body string) string {
	if strings.TrimSpace(body) == "" {
		return ""
	}
	return title + "\n" + body
}
