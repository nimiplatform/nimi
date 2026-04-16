// Package routine provides the cognition routine framework.
//
// Cognition routines are external workers acting on top of
// nimi-cognition — they are NOT core cognition commands.
//
// Key constraints from settled baseline:
//   - routines operate on memory_substrate, knowledge_projections,
//     and skill_artifacts
//   - routines MUST NOT directly mutate agent_model_kernel or
//     world_model_kernel
//   - the first admitted routine is digest
//   - digest defaults to deterministic/retrieval-driven execution
package routine

import (
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/artifactref"
	"github.com/nimiplatform/nimi/nimi-cognition/knowledge"
	"github.com/nimiplatform/nimi/nimi-cognition/memory"
	"github.com/nimiplatform/nimi/nimi-cognition/skill"
)

// Routine is the interface for cognition routines.
type Routine interface {
	// Name returns the routine's identifier.
	Name() string

	// Run executes the routine for a given scope.
	Run(ctx Context) (*Result, error)
}

// Context provides scoped access to storage for routine execution.
// It deliberately provides NO write access to kernel types —
// enforcing the constraint that routines must not directly mutate
// model kernels.
type Context struct {
	ScopeID string
	Storage ArtifactAccess
	Graph   GraphAccess
	Clock   func() time.Time
}

// ArtifactAccess provides read/write access to non-kernel artifacts
// for routine execution. Kernel access is deliberately excluded.
type ArtifactAccess interface {
	// Memory substrate operations
	ListMemory(scopeID string) ([]memory.Record, error)
	LoadMemory(scopeID string, recordID memory.RecordID) (*memory.Record, error)
	SaveMemory(record memory.Record) error
	ArchiveMemory(scopeID string, recordID memory.RecordID, now time.Time) error
	RemoveMemory(scopeID string, recordID memory.RecordID, now time.Time) error

	// Knowledge projection operations
	ListKnowledge(scopeID string) ([]knowledge.Page, error)
	LoadKnowledge(scopeID string, pageID knowledge.PageID) (*knowledge.Page, error)
	SaveKnowledge(page knowledge.Page) error
	ArchiveKnowledge(scopeID string, pageID knowledge.PageID, now time.Time) error
	RemoveKnowledge(scopeID string, pageID knowledge.PageID, now time.Time) error

	// Skill artifact operations
	ListSkills(scopeID string) ([]skill.Bundle, error)
	LoadSkill(scopeID string, bundleID skill.BundleID) (*skill.Bundle, error)
	SaveSkill(bundle skill.Bundle) error
	ArchiveSkill(scopeID string, bundleID skill.BundleID, now time.Time) error
	RemoveSkill(scopeID string, bundleID skill.BundleID, now time.Time) error
}

// OutgoingSummary describes local dependency health for routine cleanup logic.
type OutgoingSummary struct {
	StrongLive int
	WeakLive   int
	Broken     int
}

// DependencyStatus describes the health of one outgoing dependency edge.
type DependencyStatus string

const (
	DependencyStatusLive         DependencyStatus = "live"
	DependencyStatusBrokenTarget DependencyStatus = "broken_target"
)

// DependencyEdge explains one owned dependency edge.
type DependencyEdge struct {
	ToKind   artifactref.Kind     `json:"to_kind"`
	ToID     string               `json:"to_id"`
	Strength artifactref.Strength `json:"strength"`
	Role     string               `json:"role"`
	Status   DependencyStatus     `json:"status"`
	Message  string               `json:"message,omitempty"`
}

// DependencyHealth is the structured explainability view for outgoing deps.
type DependencyHealth struct {
	StrongLive   int              `json:"strong_live"`
	WeakLive     int              `json:"weak_live"`
	Broken       int              `json:"broken"`
	Dependencies []DependencyEdge `json:"dependencies,omitempty"`
}

// BlockerKind describes why a cleanup transition is blocked or gated.
type BlockerKind string

const (
	BlockerKindStrongRef                BlockerKind = "strong_ref"
	BlockerKindWeakRef                  BlockerKind = "weak_ref"
	BlockerKindBrokenTarget             BlockerKind = "broken_target"
	BlockerKindArchiveFirst             BlockerKind = "archive_first"
	BlockerKindDownstreamLiveDependency BlockerKind = "downstream_live_dependency"
)

// Blocker explains one cleanup blocker or gating dependency.
type Blocker struct {
	Kind            BlockerKind          `json:"kind"`
	Strength        artifactref.Strength `json:"strength,omitempty"`
	SourceKind      artifactref.Kind     `json:"source_kind,omitempty"`
	SourceID        string               `json:"source_id,omitempty"`
	SourceLifecycle string               `json:"source_lifecycle,omitempty"`
	SourceActive    bool                 `json:"source_active,omitempty"`
	Role            string               `json:"role,omitempty"`
	Message         string               `json:"message,omitempty"`
}

// GraphAccess provides explainability queries for routine cleanup decisions.
type GraphAccess interface {
	SupportSummary(scopeID string, toKind artifactref.Kind, toID string) (memory.SupportSummary, error)
	BrokenTargets(scopeID string, refs []artifactref.Ref) ([]artifactref.Ref, error)
	OutgoingHealth(scopeID string, refs []artifactref.Ref) (DependencyHealth, error)
	RemoveBlockers(scopeID string, toKind artifactref.Kind, toID string) ([]Blocker, error)
	OutgoingSupport(scopeID string, refs []artifactref.Ref) (OutgoingSummary, error)
}

// Result reports what a routine changed.
type Result struct {
	RoutineName    string         `json:"routine_name"`
	ScopeID        string         `json:"scope_id"`
	StartedAt      time.Time      `json:"started_at"`
	CompletedAt    time.Time      `json:"completed_at"`
	FamilyResults  []FamilyResult `json:"family_results"`
	TotalProcessed int            `json:"total_processed"`
	TotalChanged   int            `json:"total_changed"`
}

// FamilyResult reports results for a single artifact family.
type FamilyResult struct {
	Family    string `json:"family"` // "memory", "knowledge", "skill"
	Processed int    `json:"processed"`
	Archived  int    `json:"archived"`
	Removed   int    `json:"removed"`
	Unchanged int    `json:"unchanged"`
}
