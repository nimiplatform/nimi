package working

import (
	"strings"
	"testing"
	"time"
)

var ts = time.Date(2026, 4, 16, 12, 0, 0, 0, time.UTC)

func validState() State {
	return State{
		StateID:   "ws_001",
		ScopeID:   "agent_001",
		CreatedAt: ts,
		UpdatedAt: ts,
	}
}

func TestValidateState_Valid(t *testing.T) {
	if err := ValidateState(validState()); err != nil {
		t.Fatalf("expected valid: %v", err)
	}
}

func TestValidateState_WithActiveTurn(t *testing.T) {
	s := validState()
	s.ActiveTurn = &ActiveTurn{TurnID: "t1", Phase: "reasoning", StartedAt: ts}
	if err := ValidateState(s); err != nil {
		t.Fatalf("state with active turn should be valid: %v", err)
	}
}

func TestValidateState_MissingFields(t *testing.T) {
	tests := []struct {
		name   string
		modify func(*State)
		expect string
	}{
		{"missing state_id", func(s *State) { s.StateID = "" }, "state_id is required"},
		{"missing scope_id", func(s *State) { s.ScopeID = "" }, "scope_id is required"},
		{"missing created_at", func(s *State) { s.CreatedAt = time.Time{} }, "created_at is required"},
		{"missing updated_at", func(s *State) { s.UpdatedAt = time.Time{} }, "updated_at is required"},
		{"updated before created", func(s *State) { s.UpdatedAt = s.CreatedAt.Add(-time.Second) }, "updated_at must not be before created_at"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := validState()
			tt.modify(&s)
			err := ValidateState(s)
			if err == nil {
				t.Fatal("expected error")
			}
			if !strings.Contains(err.Error(), tt.expect) {
				t.Errorf("expected %q, got: %v", tt.expect, err)
			}
		})
	}
}

func TestValidateState_BadActiveTurn(t *testing.T) {
	s := validState()
	s.ActiveTurn = &ActiveTurn{TurnID: "", Phase: "x", StartedAt: ts}
	err := ValidateState(s)
	if err == nil || !strings.Contains(err.Error(), "turn_id is required") {
		t.Fatalf("expected turn error, got: %v", err)
	}
}

func TestValidateState_BadPlanningSlot(t *testing.T) {
	s := validState()
	s.PlanningSlots = []PlanningSlot{{SlotID: ""}}
	err := ValidateState(s)
	if err == nil || !strings.Contains(err.Error(), "slot_id is required") {
		t.Fatalf("expected slot error, got: %v", err)
	}
}

func TestValidateState_PlanningSlotRequiresPurpose(t *testing.T) {
	s := validState()
	s.PlanningSlots = []PlanningSlot{{SlotID: "p1", Purpose: ""}}
	err := ValidateState(s)
	if err == nil || !strings.Contains(err.Error(), "purpose is required") {
		t.Fatalf("expected purpose error, got: %v", err)
	}
}

func TestValidateState_DuplicatePlanningSlotID(t *testing.T) {
	s := validState()
	s.PlanningSlots = []PlanningSlot{
		{SlotID: "p1", Purpose: "a"},
		{SlotID: "p1", Purpose: "b"},
	}
	err := ValidateState(s)
	if err == nil || !strings.Contains(err.Error(), "duplicate slot_id") {
		t.Fatalf("expected duplicate slot error, got: %v", err)
	}
}

func TestValidateState_BadToolScaffold(t *testing.T) {
	s := validState()
	s.ToolScaffolds = []ToolScaffold{{ToolID: ""}}
	err := ValidateState(s)
	if err == nil || !strings.Contains(err.Error(), "tool_id is required") {
		t.Fatalf("expected tool error, got: %v", err)
	}
}

func TestValidateState_ToolScaffoldRequiresNameAndTimeAndStatus(t *testing.T) {
	tests := []struct {
		name   string
		tool   ToolScaffold
		expect string
	}{
		{"missing tool_name", ToolScaffold{ToolID: "tool1", InvokedAt: ts, Status: ToolStatusRunning}, "tool_name is required"},
		{"missing invoked_at", ToolScaffold{ToolID: "tool1", ToolName: "grep", Status: ToolStatusRunning}, "invoked_at is required"},
		{"missing status", ToolScaffold{ToolID: "tool1", ToolName: "grep", InvokedAt: ts}, "status is required"},
		{"invalid status", ToolScaffold{ToolID: "tool1", ToolName: "grep", InvokedAt: ts, Status: "bogus"}, "invalid status"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := validState()
			s.ToolScaffolds = []ToolScaffold{tt.tool}
			err := ValidateState(s)
			if err == nil || !strings.Contains(err.Error(), tt.expect) {
				t.Fatalf("expected %q, got: %v", tt.expect, err)
			}
		})
	}
}

func TestValidateState_DuplicateToolID(t *testing.T) {
	s := validState()
	s.ToolScaffolds = []ToolScaffold{
		{ToolID: "tool1", ToolName: "grep", InvokedAt: ts, Status: ToolStatusRunning},
		{ToolID: "tool1", ToolName: "sed", InvokedAt: ts, Status: ToolStatusPending},
	}
	err := ValidateState(s)
	if err == nil || !strings.Contains(err.Error(), "duplicate tool_id") {
		t.Fatalf("expected duplicate tool error, got: %v", err)
	}
}

func TestValidateState_WithAll(t *testing.T) {
	s := validState()
	s.ActiveTurn = &ActiveTurn{TurnID: "t1", Phase: "acting", StartedAt: ts}
	s.PlanningSlots = []PlanningSlot{{SlotID: "p1", Purpose: "next step"}}
	s.ToolScaffolds = []ToolScaffold{{ToolID: "tool1", ToolName: "grep", InvokedAt: ts, Status: ToolStatusRunning}}
	s.Scratch = []byte(`{"key":"value"}`)
	if err := ValidateState(s); err != nil {
		t.Fatalf("full state should be valid: %v", err)
	}
}
