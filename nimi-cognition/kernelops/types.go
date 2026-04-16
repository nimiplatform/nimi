// Package kernelops provides a Git-like update surface for cognition
// model kernels.
//
// The update flow is:
//
//	incoming_patch → diff_report → conflict_report → resolved_patch → commit_record
//
// Operations: status, diff, merge, resolve, commit, log.
//
// force-overwrite is NOT admitted. fetch/source-observation belongs
// to upstream orchestration, not to nimi-cognition.
//
// Only resolved_patch objects may be applied and committed.
// nimi-cognition may compute diffs and surface conflicts, but it does
// not own the semantic decision of which side should win.
package kernelops

import (
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/kernel"
)

// PatchID identifies an incoming patch.
type PatchID string

// DiffID identifies a diff report.
type DiffID string

// ConflictID identifies a conflict report.
type ConflictID string

// ResolvedPatchID identifies a resolved patch.
type ResolvedPatchID string

// CommitID identifies a commit record.
type CommitID string

// ChangeKind describes what kind of change a patch proposes for a rule.
type ChangeKind string

const (
	ChangeKindAdd    ChangeKind = "add"
	ChangeKindUpdate ChangeKind = "update"
	ChangeKindRemove ChangeKind = "remove"
)

// ResolutionKind describes how a conflict was resolved.
type ResolutionKind string

const (
	ResolutionKindKeepLocal     ResolutionKind = "keep_local"
	ResolutionKindAcceptPatch   ResolutionKind = "accept_patch"
	ResolutionKindManualMerge   ResolutionKind = "manual_merge"
	ResolutionKindLocalOverride ResolutionKind = "local_override"
)

// --- Update Objects (§5.3 of settled baseline) ---

// IncomingPatch represents an upstream-submitted proposed change
// against a local kernel. How it was generated is an upstream concern.
type IncomingPatch struct {
	PatchID         PatchID            `json:"patch_id"`
	TargetKernel    kernel.KernelType  `json:"target_kernel"`
	ScopeID         string             `json:"scope_id"`
	ProposedChanges []ProposedChange   `json:"proposed_changes"`
	SourceRefs      []kernel.SourceRef `json:"source_refs,omitempty"`
	SubmittedBy     string             `json:"submitted_by"`
	Rationale       string             `json:"rationale,omitempty"`
	SubmittedAt     time.Time          `json:"submitted_at"`
}

// ProposedChange is a single rule-level change within an IncomingPatch.
type ProposedChange struct {
	RuleID      kernel.RuleID `json:"rule_id,omitempty"` // empty for add
	BaseVersion int           `json:"base_version,omitempty"`
	ChangeKind  ChangeKind    `json:"change_kind"`
	NewRule     *kernel.Rule  `json:"new_rule,omitempty"` // for add/update
}

// DiffReport represents the structured difference between the current
// local kernel state and an incoming patch. It is a computation result,
// not a resolution.
type DiffReport struct {
	DiffID           DiffID            `json:"diff_id"`
	TargetKernel     kernel.KernelType `json:"target_kernel"`
	ScopeID          string            `json:"scope_id"`
	IncomingPatchRef PatchID           `json:"incoming_patch_ref"`
	Entries          []DiffEntry       `json:"entries"`
	ComputedAt       time.Time         `json:"computed_at"`
}

// DiffEntry is a single rule-level diff within a DiffReport.
type DiffEntry struct {
	RuleID           kernel.RuleID `json:"rule_id"`
	ChangeKind       ChangeKind    `json:"change_kind"`
	BaseRule         *kernel.Rule  `json:"base_rule,omitempty"`     // current local state
	IncomingRule     *kernel.Rule  `json:"incoming_rule,omitempty"` // proposed state
	HasConflict      bool          `json:"has_conflict"`
	ChangedFields    []string      `json:"changed_fields,omitempty"`
	TransitionIssues []string      `json:"transition_issues,omitempty"`
}

// ConflictReport represents rule-level or field-level conflicts
// detected while trying to merge an incoming patch with current
// local state. It is a structured conflict surface for higher-level
// resolution, not a decision object.
type ConflictReport struct {
	ConflictID       ConflictID        `json:"conflict_id"`
	TargetKernel     kernel.KernelType `json:"target_kernel"`
	ScopeID          string            `json:"scope_id"`
	IncomingPatchRef PatchID           `json:"incoming_patch_ref"`
	Conflicts        []Conflict        `json:"conflicts"`
	DetectedAt       time.Time         `json:"detected_at"`
}

// Conflict is a single rule-level conflict.
type Conflict struct {
	RuleID           kernel.RuleID `json:"rule_id"`
	ConflictReason   string        `json:"conflict_reason"`
	Fields           []string      `json:"fields,omitempty"`
	BaseSnapshot     *kernel.Rule  `json:"base_snapshot,omitempty"`
	CurrentSnapshot  *kernel.Rule  `json:"current_snapshot,omitempty"`
	IncomingSnapshot *kernel.Rule  `json:"incoming_snapshot,omitempty"`
}

// ResolvedPatch represents a higher-level resolution result that
// nimi-cognition is allowed to apply. It is the smallest patch-shaped
// object that may cross into explicit local application.
type ResolvedPatch struct {
	ResolvedPatchID ResolvedPatchID   `json:"resolved_patch_id"`
	TargetKernel    kernel.KernelType `json:"target_kernel"`
	ScopeID         string            `json:"scope_id"`
	ResolvedChanges []ResolvedChange  `json:"resolved_changes"`
	Rationale       string            `json:"rationale,omitempty"`
	ResolvedBy      string            `json:"resolved_by"` // "auto", "human", "llm"
	ResolvedAt      time.Time         `json:"resolved_at"`
}

// ResolvedChange is a single rule-level resolution within a ResolvedPatch.
type ResolvedChange struct {
	RuleID         kernel.RuleID  `json:"rule_id"`
	BaseVersion    int            `json:"base_version,omitempty"`
	ChangeKind     ChangeKind     `json:"change_kind"`
	ResolutionKind ResolutionKind `json:"resolution_kind"`
	FinalRule      *kernel.Rule   `json:"final_rule,omitempty"` // for add/update
}

// CommitRecord represents an accepted local kernel update after a
// resolved patch has been applied. It is local update history, not
// external truth publication.
type CommitRecord struct {
	CommitID         CommitID           `json:"commit_id"`
	ScopeID          string             `json:"scope_id"`
	KernelID         string             `json:"kernel_id"`
	KernelType       kernel.KernelType  `json:"kernel_type"`
	AffectedRuleIDs  []kernel.RuleID    `json:"affected_rule_ids"`
	ResolvedPatchRef ResolvedPatchID    `json:"resolved_patch_ref"`
	SourceRefs       []kernel.SourceRef `json:"source_refs,omitempty"`
	Summary          string             `json:"summary"`
	PreviousVersion  int                `json:"previous_version"`
	NewVersion       int                `json:"new_version"`
	BeforeSnapshot   []kernel.Rule      `json:"before_snapshot,omitempty"`
	AfterSnapshot    []kernel.Rule      `json:"after_snapshot,omitempty"`
	CreatedBy        string             `json:"created_by"`
	CreatedAt        time.Time          `json:"created_at"`
}
