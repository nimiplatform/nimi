package localexecution

import "strings"

// SupportsRequiredFeatures compares owner intent with the selected Loadout's
// projected feature set. Both lists are capability-contract-local values.
func SupportsRequiredFeatures(required []string, supported []string) bool {
	available := make(map[string]struct{}, len(supported))
	for _, feature := range supported {
		available[strings.TrimSpace(feature)] = struct{}{}
	}
	for _, feature := range required {
		if _, ok := available[strings.TrimSpace(feature)]; !ok {
			return false
		}
	}
	return true
}
