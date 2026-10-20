package cognitionmemory

import runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"

func validLifeActivityCarrier(f *runtimev1.CognitionMemoryActivityTerminal) bool {
	if !validSourceRef(f.GetChangeRef()) || f.GetChangeRef().GetKind() != "life_change" || !validCommittedContent(f.GetSelfObject()) || len([]rune(f.GetSelfObject())) > 80 {
		return false
	}
	if len([]rune(f.GetBoundedOutcome())) > 160 || f.GetChange() == runtimev1.CognitionMemoryActivityChange_COGNITION_MEMORY_ACTIVITY_CHANGE_KEY_RESULT && !validCommittedContent(f.GetBoundedOutcome()) {
		return false
	}
	switch f.GetActivityState() {
	case "active", "paused", "completed", "abandoned":
	default:
		return false
	}
	switch f.GetSelfAction() {
	case "create", "practice", "explore", "reflect":
		return true
	default:
		return false
	}
}
