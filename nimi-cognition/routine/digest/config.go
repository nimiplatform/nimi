// Package digest implements the digest cognition routine.
//
// Digest operates on memory_substrate, knowledge_projections, and
// skill_artifacts. It MUST NOT directly mutate model kernels.
//
// Phases:
//  1. Analysis — detection, grouping, scoring, ranking, candidate surfacing
//  2. Cleanup — active/archived/removed lifecycle transitions, gated by
//     ref graph integrity
//
// Baseline: deterministic/retrieval-driven. Optional LLM enhancement
// is additive, not baseline dependency.
//
// Per-family priority:
//   - memory_substrate: strongest digest target
//   - knowledge_projections: moderate, hygiene-oriented
//   - skill_artifacts: weakest, most conservative
package digest

// Config controls digest behavior.
type Config struct {
	// MemoryEnabled controls whether digest runs on memory_substrate.
	// Default: true.
	MemoryEnabled *bool

	// KnowledgeEnabled controls whether digest runs on knowledge_projections.
	// Default: true.
	KnowledgeEnabled *bool

	// SkillEnabled controls whether digest runs on skill_artifacts.
	// Default: true (but most conservative).
	SkillEnabled *bool
}

func (c Config) memoryEnabled() bool {
	if c.MemoryEnabled != nil {
		return *c.MemoryEnabled
	}
	return true
}

func (c Config) knowledgeEnabled() bool {
	if c.KnowledgeEnabled != nil {
		return *c.KnowledgeEnabled
	}
	return true
}

func (c Config) skillEnabled() bool {
	if c.SkillEnabled != nil {
		return *c.SkillEnabled
	}
	return true
}
