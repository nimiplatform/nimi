package memoryv1

import "strings"

func validLifeExperience(f *ActivityTerminalFact) bool {
	if f == nil || !validTypedRef(f.ChangeRef) || f.ChangeRef.Kind != "life_change" {
		return false
	}
	if len([]rune(f.BoundedOutcome)) > 160 || f.Change == ActivityChangeKeyResult && strings.TrimSpace(f.BoundedOutcome) == "" {
		return false
	}
	switch f.ActivityState {
	case "active", "paused", "completed", "abandoned":
	default:
		return false
	}
	switch f.SelfAction {
	case "create", "practice", "explore", "reflect":
	default:
		return false
	}
	if strings.TrimSpace(f.SelfObject) == "" || len([]rune(f.SelfObject)) > 80 {
		return false
	}
	return true
}

func lifeExperienceContent(f *ActivityTerminalFact) string {
	action := map[string]string{"create": "creating", "practice": "practicing", "explore": "exploring", "reflect": "reflecting on"}[f.SelfAction]
	prefix := "In my simulated life, I "
	var content string
	switch f.Change {
	case ActivityChangeProjectCompleted:
		content = prefix + "completed " + action + " " + f.SelfObject + "."
	case ActivityChangeDirectionChanged:
		if f.ActivityState == "abandoned" {
			content = prefix + "abandoned my direction of " + action + " " + f.SelfObject + "."
		} else {
			content = prefix + "changed my direction toward " + action + " " + f.SelfObject + "."
		}
	case ActivityChangeKeyResult:
		content = prefix + "reached a result while " + action + " " + f.SelfObject + "."
	}
	if f.BoundedOutcome != "" {
		content += " Result: " + strings.TrimSpace(f.BoundedOutcome)
	}
	return content
}
