package working

import (
	"errors"
	"fmt"
)

// ValidateState performs structural validation on a working state.
func ValidateState(s State) error {
	if s.StateID == "" {
		return errors.New("validate state: state_id is required")
	}
	if s.ScopeID == "" {
		return fmt.Errorf("validate state %s: scope_id is required", s.StateID)
	}
	if s.CreatedAt.IsZero() {
		return fmt.Errorf("validate state %s: created_at is required", s.StateID)
	}
	if s.UpdatedAt.IsZero() {
		return fmt.Errorf("validate state %s: updated_at is required", s.StateID)
	}
	if s.UpdatedAt.Before(s.CreatedAt) {
		return fmt.Errorf("validate state %s: updated_at must not be before created_at", s.StateID)
	}
	if s.ActiveTurn != nil {
		if err := validateActiveTurn(*s.ActiveTurn); err != nil {
			return fmt.Errorf("validate state %s: active_turn: %w", s.StateID, err)
		}
	}
	seenSlots := make(map[string]struct{}, len(s.PlanningSlots))
	for i, slot := range s.PlanningSlots {
		if err := validatePlanningSlot(slot); err != nil {
			return fmt.Errorf("validate state %s: planning_slots[%d]: %w", s.StateID, i, err)
		}
		if _, exists := seenSlots[slot.SlotID]; exists {
			return fmt.Errorf("validate state %s: planning_slots[%d]: duplicate slot_id %s", s.StateID, i, slot.SlotID)
		}
		seenSlots[slot.SlotID] = struct{}{}
	}
	seenTools := make(map[string]struct{}, len(s.ToolScaffolds))
	for i, tool := range s.ToolScaffolds {
		if err := validateToolScaffold(tool); err != nil {
			return fmt.Errorf("validate state %s: tool_scaffolds[%d]: %w", s.StateID, i, err)
		}
		if _, exists := seenTools[tool.ToolID]; exists {
			return fmt.Errorf("validate state %s: tool_scaffolds[%d]: duplicate tool_id %s", s.StateID, i, tool.ToolID)
		}
		seenTools[tool.ToolID] = struct{}{}
	}
	return nil
}

func validateActiveTurn(t ActiveTurn) error {
	if t.TurnID == "" {
		return errors.New("turn_id is required")
	}
	if t.Phase == "" {
		return errors.New("phase is required")
	}
	if t.StartedAt.IsZero() {
		return errors.New("started_at is required")
	}
	return nil
}

func validatePlanningSlot(slot PlanningSlot) error {
	if slot.SlotID == "" {
		return errors.New("slot_id is required")
	}
	if slot.Purpose == "" {
		return errors.New("purpose is required")
	}
	return nil
}

func validateToolScaffold(tool ToolScaffold) error {
	if tool.ToolID == "" {
		return errors.New("tool_id is required")
	}
	if tool.ToolName == "" {
		return errors.New("tool_name is required")
	}
	if tool.InvokedAt.IsZero() {
		return errors.New("invoked_at is required")
	}
	switch tool.Status {
	case ToolStatusPending, ToolStatusRunning, ToolStatusCompleted, ToolStatusFailed:
		return nil
	case "":
		return errors.New("status is required")
	default:
		return fmt.Errorf("invalid status %q", tool.Status)
	}
}
