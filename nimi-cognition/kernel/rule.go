package kernel

import (
	"encoding/json"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/artifactref"
)

// RuleID is a stable identifier for a kernel rule.
type RuleID string

// SourceRef is a reference from an artifact to a source, with
// strength classification owned by the referencing artifact.
type SourceRef struct {
	SourceType string      `json:"source_type"`
	SourceID   string      `json:"source_id"`
	Strength   RefStrength `json:"strength"`
	ObservedAt time.Time   `json:"observed_at"`
}

// Rule is a single kernel rule with structural metadata.
//
// Rules have three independent state axes:
//   - AnchorBinding: whether the rule tracks an external anchor
//   - Alignment: relationship to external anchor (only when anchored)
//   - Lifecycle: whether the rule is active for local use
//
// These axes must not be collapsed into each other.
type Rule struct {
	// Identity
	RuleID  RuleID   `json:"rule_id"`
	Kind    RuleKind `json:"rule_kind"`
	Version int      `json:"version"`

	// Content — the assertion this rule makes
	Statement string          `json:"statement"`
	Value     json.RawMessage `json:"value,omitempty"`

	// Source references — explicit separation from content
	SourceRefs []SourceRef `json:"source_refs,omitempty"`

	// ArtifactRefs are local support/provenance links to other cognition
	// artifacts. Ownership always lives on this rule, never on the referenced
	// artifact.
	ArtifactRefs []artifactref.Ref `json:"artifact_refs,omitempty"`

	// State axis 1: anchor binding
	AnchorBinding AnchorBinding `json:"anchor_binding"`

	// State axis 2: alignment to external anchor (only when anchored)
	Alignment AlignmentState `json:"alignment_state,omitempty"`

	// State axis 3: lifecycle validity
	Lifecycle RuleLifecycleState `json:"rule_lifecycle_state"`

	// Supersession
	SupersededBy RuleID `json:"superseded_by,omitempty"`

	// Timestamps
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}
