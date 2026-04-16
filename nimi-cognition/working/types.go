// Package working provides types for transient working state —
// in-flight scratch data for active execution.
//
// working_state is transient by default and must not absorb durable
// runtime control-plane state (hook lifecycle, posture truth,
// autonomy config, event-log truth, replication state).
//
// Zero I/O, zero external dependencies.
package working

import (
	"encoding/json"
	"time"
)

// StateID is a stable identifier for a working state snapshot.
type StateID string

// State is a transient container for active execution context.
// It does not persist across sessions by default.
type State struct {
	// Identity
	StateID StateID `json:"state_id"`
	ScopeID string  `json:"scope_id"`

	// Active turn context
	ActiveTurn *ActiveTurn `json:"active_turn,omitempty"`

	// In-flight planning
	PlanningSlots []PlanningSlot `json:"planning_slots,omitempty"`

	// Tool execution scaffolding
	ToolScaffolds []ToolScaffold `json:"tool_scaffolds,omitempty"`

	// Scratch data — arbitrary key-value pairs for transient use
	Scratch json.RawMessage `json:"scratch,omitempty"`

	// Timestamps
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// ActiveTurn tracks the current turn context.
type ActiveTurn struct {
	TurnID    string    `json:"turn_id"`
	Phase     string    `json:"phase"` // e.g., "reasoning", "acting", "reflecting"
	StartedAt time.Time `json:"started_at"`
}

// PlanningSlot holds an in-flight planning fragment.
type PlanningSlot struct {
	SlotID  string          `json:"slot_id"`
	Purpose string          `json:"purpose"`
	Content json.RawMessage `json:"content,omitempty"`
}

// ToolScaffold holds live tool execution scaffolding.
type ToolScaffold struct {
	ToolID     string          `json:"tool_id"`
	ToolName   string          `json:"tool_name"`
	InvokedAt  time.Time       `json:"invoked_at"`
	Parameters json.RawMessage `json:"parameters,omitempty"`
	Status     string          `json:"status"` // "pending", "running", "completed", "failed"
}

const (
	ToolStatusPending   = "pending"
	ToolStatusRunning   = "running"
	ToolStatusCompleted = "completed"
	ToolStatusFailed    = "failed"
)
