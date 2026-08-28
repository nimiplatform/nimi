package runtimeagent

import (
	"context"
	"fmt"
	"strings"
)

type BehavioralPosture struct {
	AgentID          string   `json:"agent_id"`
	PostureClass     string   `json:"posture_class,omitempty"`
	ActionFamily     string   `json:"action_family,omitempty"`
	StatusText       string   `json:"status_text"`
	TruthBasisIDs    []string `json:"truth_basis_ids"`
	InterruptMode    string   `json:"interrupt_mode"`
	TransitionReason string   `json:"transition_reason,omitempty"`
	ModeID           string   `json:"mode_id,omitempty"`
	UpdatedAt        string   `json:"updated_at"`
}

func (s *Service) PutBehavioralPosture(ctx context.Context, posture BehavioralPosture) error {
	if s == nil || s.postures == nil {
		return fmt.Errorf("behavioral posture persistence is unavailable")
	}
	return s.postures.PutBehavioralPosture(ctx, posture)
}

func (s *Service) GetBehavioralPosture(ctx context.Context, agentID string) (*BehavioralPosture, error) {
	if s == nil || s.postures == nil {
		return nil, fmt.Errorf("behavioral posture persistence is unavailable")
	}
	return s.postures.GetBehavioralPosture(ctx, agentID)
}

func uniqueNonEmptyStrings(values []string) []string {
	result := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if _, exists := seen[trimmed]; exists {
			continue
		}
		seen[trimmed] = struct{}{}
		result = append(result, trimmed)
	}
	return result
}
