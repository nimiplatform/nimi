// Package kernel provides per-agent local cognition kernel types
// and structural validation. Zero I/O, zero external dependencies.
package kernel

// RuleKind classifies a rule into the self-facing or world-facing
// kernel. Self-facing rules belong to AgentModelKernel; world-facing
// rules belong to WorldModelKernel.
type RuleKind string

const (
	RuleKindSelfFacing  RuleKind = "self_facing"
	RuleKindWorldFacing RuleKind = "world_facing"
)

// AnchorBinding describes whether a rule is expected to track an
// external anchor. Only anchored rules require AlignmentState.
//
// This is axis 1 of 3 independent rule state axes.
type AnchorBinding string

const (
	// AnchorBindingAnchored means the rule tracks an external source.
	// AlignmentState is required.
	AnchorBindingAnchored AnchorBinding = "anchored"
	// AnchorBindingLocalOnly means the rule is purely local.
	// AlignmentState is not applicable.
	AnchorBindingLocalOnly AnchorBinding = "local_only"
)

// AlignmentState describes the relationship between an anchored local
// rule and the external anchor it references. Only meaningful when
// AnchorBinding is "anchored".
//
// This is axis 2 of 3 independent rule state axes.
type AlignmentState string

const (
	AlignmentAligned       AlignmentState = "aligned"
	AlignmentStale         AlignmentState = "stale"
	AlignmentConflicted    AlignmentState = "conflicted"
	AlignmentLocalOverride AlignmentState = "local_override"
)

// RuleLifecycleState describes whether the rule itself remains active
// for local use. Must not be collapsed into AlignmentState.
//
// This is axis 3 of 3 independent rule state axes.
type RuleLifecycleState string

const (
	// RuleLifecycleActive means the rule is current and participable
	// in reasoning.
	RuleLifecycleActive RuleLifecycleState = "active"
	// RuleLifecycleSuperseded means another rule has replaced this one.
	RuleLifecycleSuperseded RuleLifecycleState = "superseded"
	// RuleLifecycleInvalidated means the rule has been explicitly
	// invalidated (e.g., upstream anchor was removed or contradicted).
	RuleLifecycleInvalidated RuleLifecycleState = "invalidated"
)

// RefStrength classifies the strength of a source reference.
// Owned by the referencing artifact, not by the referenced source.
type RefStrength string

const (
	// RefStrong blocks removal of the referenced source but does not
	// block archival.
	RefStrong RefStrength = "strong_ref"
	// RefWeak may allow removal evaluation but never guarantees
	// removal by itself.
	RefWeak RefStrength = "weak_ref"
)

// KernelStatus describes the operational status of a kernel.
type KernelStatus string

const (
	KernelStatusActive    KernelStatus = "active"
	KernelStatusSuspended KernelStatus = "suspended"
)

// KernelType identifies which kernel an instance is.
type KernelType string

const (
	KernelTypeAgentModel KernelType = "agent_model"
	KernelTypeWorldModel KernelType = "world_model"
)
