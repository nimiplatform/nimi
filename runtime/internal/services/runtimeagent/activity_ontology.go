package runtimeagent

import (
	"fmt"
	"strings"
)

var admittedActivityCategories = map[string]string{
	"happy":       "emotion",
	"sad":         "emotion",
	"shy":         "emotion",
	"angry":       "emotion",
	"surprised":   "emotion",
	"confused":    "emotion",
	"excited":     "emotion",
	"worried":     "emotion",
	"embarrassed": "emotion",
	"neutral":     "emotion",

	"greet":     "interaction",
	"farewell":  "interaction",
	"agree":     "interaction",
	"disagree":  "interaction",
	"listening": "interaction",
	"thinking":  "interaction",

	"idle":        "state",
	"celebrating": "state",
	"sleeping":    "state",
	"focused":     "state",

	"ext:apologetic":    "emotion",
	"ext:proud":         "emotion",
	"ext:lonely":        "emotion",
	"ext:grateful":      "emotion",
	"ext:acknowledging": "interaction",
	"ext:encouraging":   "interaction",
	"ext:teasing":       "interaction",
	"ext:resting":       "state",
	"ext:playing":       "state",
	"ext:eating":        "state",
}

func admittedActivityCategory(activityName string) (string, bool) {
	category, ok := admittedActivityCategories[strings.TrimSpace(activityName)]
	return category, ok
}

func normalizeActivityIntensity(category string, activityName string, raw *float64) string {
	if raw == nil || category != "emotion" || strings.TrimSpace(activityName) == "neutral" {
		return ""
	}
	switch {
	case *raw < 0.34:
		return "weak"
	case *raw < 0.67:
		return "moderate"
	default:
		return "strong"
	}
}

func normalizePublicChatActivityProjection(activityName string, rawIntensity *float64) (string, string, error) {
	trimmed := strings.TrimSpace(activityName)
	category, ok := admittedActivityCategory(trimmed)
	if !ok {
		return "", "", fmt.Errorf("APML activity %q is not admitted by runtime activity ontology", trimmed)
	}
	return category, normalizeActivityIntensity(category, trimmed, rawIntensity), nil
}

func validateActivityProjectionFields(activityName string, category string, intensity string, source string) error {
	trimmedName := strings.TrimSpace(activityName)
	expectedCategory, ok := admittedActivityCategory(trimmedName)
	if !ok {
		return fmt.Errorf("runtime.agent.presentation.activity_requested activity_name is not admitted: %s", trimmedName)
	}
	if strings.TrimSpace(category) != expectedCategory {
		return fmt.Errorf("runtime.agent.presentation.activity_requested category must be %s for %s", expectedCategory, trimmedName)
	}
	if strings.TrimSpace(source) == "" {
		return fmt.Errorf("runtime.agent.presentation.activity_requested source is required")
	}
	trimmedIntensity := strings.TrimSpace(intensity)
	if trimmedIntensity == "" {
		return nil
	}
	if expectedCategory != "emotion" || trimmedName == "neutral" {
		return fmt.Errorf("runtime.agent.presentation.activity_requested intensity is not admitted for %s", trimmedName)
	}
	switch trimmedIntensity {
	case "weak", "moderate", "strong":
		return nil
	default:
		return fmt.Errorf("runtime.agent.presentation.activity_requested intensity is invalid: %s", trimmedIntensity)
	}
}
