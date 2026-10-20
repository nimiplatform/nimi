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
	if len([]rune(d.Outcome)) > 160 || (d.Result == "key_result" && strings.TrimSpace(d.Outcome) == "") {
		return fmt.Errorf("key result requires a concrete bounded own outcome")
	}
	if !validLocalAppConversationText(d.Object, 80, false) {
		return fmt.Errorf("bounded own object required")
	}
	return nil
}
