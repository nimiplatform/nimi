package agentcore

import (
	"fmt"
	"strings"
	"time"
)

const (
	postureActionFamilyObserve = "observe"
	postureActionFamilyEngage  = "engage"
	postureActionFamilySupport = "support"
	postureActionFamilyAssist  = "assist"
	postureActionFamilyReflect = "reflect"
	postureActionFamilyRest    = "rest"

	postureInterruptWelcome  = "welcome"
	postureInterruptCautious = "cautious"
	postureInterruptFocused  = "focused"
)

var allowedBehavioralActionFamilies = map[string]struct{}{
	postureActionFamilyObserve: {},
	postureActionFamilyEngage:  {},
	postureActionFamilySupport: {},
	postureActionFamilyAssist:  {},
	postureActionFamilyReflect: {},
	postureActionFamilyRest:    {},
}

var allowedBehavioralInterruptModes = map[string]struct{}{
	postureInterruptWelcome:  {},
	postureInterruptCautious: {},
	postureInterruptFocused:  {},
}

type BehavioralPosturePatch struct {
	PostureClass     string   `json:"posture_class"`
	ActionFamily     string   `json:"action_family"`
	InterruptMode    string   `json:"interrupt_mode"`
	TransitionReason string   `json:"transition_reason"`
	TruthBasisIDs    []string `json:"truth_basis_ids"`
	StatusText       string   `json:"status_text"`
}

func normalizeBehavioralActionFamily(raw string) string {
	return strings.ToLower(strings.TrimSpace(raw))
}

func normalizeBehavioralInterruptMode(raw string) string {
	return strings.ToLower(strings.TrimSpace(raw))
}

func deriveBehavioralModeID(actionFamily string) string {
	return normalizeBehavioralActionFamily(actionFamily)
}

func normalizeBehavioralTruthBasisIDs(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		out = append(out, trimmed)
	}
	return out
}

func normalizeBehavioralPosture(agentID string, posture BehavioralPosture) (BehavioralPosture, error) {
	normalized := posture
	normalized.AgentID = strings.TrimSpace(agentID)
	if normalized.AgentID == "" {
		return BehavioralPosture{}, fmt.Errorf("behavioral posture agent_id is required")
	}
	normalized.PostureClass = strings.TrimSpace(normalized.PostureClass)
	if normalized.PostureClass == "" {
		return BehavioralPosture{}, fmt.Errorf("behavioral posture posture_class is required")
	}
	normalized.ActionFamily = normalizeBehavioralActionFamily(normalized.ActionFamily)
	if _, ok := allowedBehavioralActionFamilies[normalized.ActionFamily]; !ok {
		return BehavioralPosture{}, fmt.Errorf("behavioral posture action_family must be observe, engage, support, assist, reflect, or rest")
	}
	normalized.InterruptMode = normalizeBehavioralInterruptMode(normalized.InterruptMode)
	if _, ok := allowedBehavioralInterruptModes[normalized.InterruptMode]; !ok {
		return BehavioralPosture{}, fmt.Errorf("behavioral posture interrupt_mode must be welcome, cautious, or focused")
	}
	normalized.StatusText = strings.TrimSpace(normalized.StatusText)
	if normalized.StatusText == "" {
		return BehavioralPosture{}, fmt.Errorf("behavioral posture status_text is required")
	}
	normalized.TransitionReason = strings.TrimSpace(normalized.TransitionReason)
	normalized.TruthBasisIDs = normalizeBehavioralTruthBasisIDs(normalized.TruthBasisIDs)
	normalized.ModeID = deriveBehavioralModeID(normalized.ActionFamily)
	if strings.TrimSpace(normalized.UpdatedAt) == "" {
		normalized.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	}
	return normalized, nil
}

func normalizeBehavioralPosturePatch(agentID string, patch BehavioralPosturePatch) (BehavioralPosture, error) {
	return normalizeBehavioralPosture(agentID, BehavioralPosture{
		AgentID:          agentID,
		PostureClass:     patch.PostureClass,
		ActionFamily:     patch.ActionFamily,
		InterruptMode:    patch.InterruptMode,
		TransitionReason: patch.TransitionReason,
		TruthBasisIDs:    patch.TruthBasisIDs,
		StatusText:       patch.StatusText,
	})
}
