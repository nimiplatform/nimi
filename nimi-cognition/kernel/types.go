package kernel

import "time"

// Kernel is the shared container shape for both AgentModelKernel and
// WorldModelKernel. Each cognition scope has exactly one instance of
// each kernel type.
//
// Conceptual minimum attributes per baseline §5.1:
// kernel_id, scope_id, kernel_type, version, status, rule_refs,
// source_refs, updated_at.
type Kernel struct {
	KernelID   string       `json:"kernel_id"`
	ScopeID    string       `json:"scope_id"`
	KernelType KernelType   `json:"kernel_type"`
	Version    int          `json:"version"`
	Status     KernelStatus `json:"status"`
	RuleRefs   []RuleID     `json:"rule_refs"`
	SourceRefs []SourceRef  `json:"source_refs,omitempty"`
	CreatedAt  time.Time    `json:"created_at"`
	UpdatedAt  time.Time    `json:"updated_at"`
}

// AgentModelKernel is a scope-unique, rule-addressable local model
// describing the Agent's self-understanding.
//
// It describes: role, capability bounds, self-perceived stance,
// self-relevant relations, self-locating interpretation of external
// anchors.
//
// It is NOT canonical agent truth. It is NOT runtime behavioral
// posture truth. It is NOT autonomy/budget configuration.
type AgentModelKernel struct {
	Kernel Kernel `json:"kernel"`
	Rules  []Rule `json:"rules"`
}

// WorldModelKernel is a scope-unique, rule-addressable local model
// describing the Agent's internal representation of the external world.
//
// It describes: world rules, entities, relations, environment
// constraints, interpreted world-state.
//
// It may diverge from objective/shared world truth because it is an
// internal model, not a canonical publish surface.
type WorldModelKernel struct {
	Kernel Kernel `json:"kernel"`
	Rules  []Rule `json:"rules"`
}
