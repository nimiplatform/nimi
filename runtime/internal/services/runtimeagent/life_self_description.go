package runtimeagent

import (
	"fmt"
	"strings"
)

type lifeSelfDescription struct {
	Outcome string `json:"outcome,omitempty"`
	Action  string `json:"action"`
	Object  string `json:"object"`
	Result  string `json:"result"`
}

// Normalize a detached value both at proposal admission and when an already
// accepted frame supplies a Memory fact. Established history is not rewritten.
func normalizeLifeSelfDescription(d *lifeSelfDescription) *lifeSelfDescription {
	if d == nil {
		return nil
	}
	out := *d
	out.Action = strings.TrimSpace(out.Action)
	out.Object = strings.TrimSpace(out.Object)
	out.Result = strings.TrimSpace(out.Result)
	out.Outcome = strings.TrimSpace(out.Outcome)
	return &out
}

func validateLifeSelfDescription(d *lifeSelfDescription) error {
	if d == nil {
		return nil
	}
	switch d.Action {
	case "create", "practice", "explore", "reflect":
	default:
		return fmt.Errorf("invalid own action")
	}
	switch d.Result {
	case "completed", "key_result", "direction_changed", "abandoned":
	default:
		return fmt.Errorf("invalid own result")
	}
	if len([]rune(d.Outcome)) > 160 || (d.Outcome != "" && !validLocalAppConversationText(d.Outcome, 160*4, false)) || (d.Result == "key_result" && d.Outcome == "") {
		return fmt.Errorf("key result requires a concrete bounded own outcome")
	}
	if len([]rune(d.Object)) > 80 || !validLocalAppConversationText(d.Object, 80*4, false) {
		return fmt.Errorf("bounded own object required")
	}
	return nil
}
