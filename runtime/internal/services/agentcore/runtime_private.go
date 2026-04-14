package agentcore

import (
	"context"
	"fmt"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/memoryengine"
	memoryservice "github.com/nimiplatform/nimi/runtime/internal/services/memory"
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

type ReviewRunRecord struct {
	ReviewRunID      string                      `json:"review_run_id"`
	AgentID          string                      `json:"agent_id"`
	BankLocatorKey   string                      `json:"bank_locator_key"`
	CheckpointBasis  string                      `json:"checkpoint_basis"`
	Status           string                      `json:"status"`
	PreparedOutcomes memoryengine.ReviewOutcomes `json:"prepared_outcomes"`
	FailureMessage   string                      `json:"failure_message,omitempty"`
	CreatedAt        string                      `json:"created_at"`
	UpdatedAt        string                      `json:"updated_at"`
}

type ReviewFollowUpRecord struct {
	BankLocatorKey  string `json:"bank_locator_key"`
	ReviewRunID     string `json:"review_run_id"`
	CheckpointBasis string `json:"checkpoint_basis"`
	CompletedAt     string `json:"completed_at"`
}

type AgentMemoryRecallFeedback struct {
	FeedbackID   string                       `json:"feedback_id"`
	AgentID      string                       `json:"agent_id"`
	Bank         *runtimev1.MemoryBankLocator `json:"bank"`
	TargetKind   string                       `json:"target_kind"`
	TargetID     string                       `json:"target_id"`
	Polarity     string                       `json:"polarity"`
	QueryText    string                       `json:"query_text,omitempty"`
	SourceSystem string                       `json:"source_system,omitempty"`
}

func (s *Service) PutBehavioralPosture(ctx context.Context, posture BehavioralPosture) error {
	if s.postures == nil {
		return fmt.Errorf("behavioral posture persistence is unavailable")
	}
	return s.postures.PutBehavioralPosture(ctx, posture)
}

func (s *Service) GetBehavioralPosture(ctx context.Context, agentID string) (*BehavioralPosture, error) {
	if s.postures == nil {
		return nil, fmt.Errorf("behavioral posture persistence is unavailable")
	}
	return s.postures.GetBehavioralPosture(ctx, agentID)
}

func (s *Service) SavePreparedReviewRun(ctx context.Context, run ReviewRunRecord) error {
	if s.reviews == nil {
		return fmt.Errorf("review persistence is unavailable")
	}
	return s.reviews.SavePreparedReviewRun(ctx, run)
}

func (s *Service) updateReviewRunStatus(ctx context.Context, reviewRunID string, statusValue string, failureMessage string) error {
	if s.reviews == nil {
		return fmt.Errorf("review persistence is unavailable")
	}
	return s.reviews.UpdateReviewRunStatus(ctx, reviewRunID, statusValue, failureMessage)
}

func (s *Service) recordReviewFollowUp(ctx context.Context, run ReviewRunRecord) error {
	if s.reviews == nil {
		return fmt.Errorf("review persistence is unavailable")
	}
	return s.reviews.RecordReviewFollowUp(ctx, run)
}

func (s *Service) GetReviewFollowUp(ctx context.Context, locator *runtimev1.MemoryBankLocator) (*ReviewFollowUpRecord, error) {
	if s.reviews == nil {
		return nil, fmt.Errorf("review persistence is unavailable")
	}
	return s.reviews.GetReviewFollowUp(ctx, locator)
}

func (s *Service) RecordAgentMemoryRecallFeedback(ctx context.Context, feedback AgentMemoryRecallFeedback) error {
	_, locator, err := s.resolveCanonicalReviewTarget(CanonicalReviewRequest{
		AgentID: feedback.AgentID,
		Bank:    feedback.Bank,
	})
	if err != nil {
		return err
	}
	return s.memorySvc.RecordRecallFeedback(ctx, memoryservice.RecallFeedback{
		FeedbackID:   feedback.FeedbackID,
		Bank:         locator,
		TargetKind:   feedback.TargetKind,
		TargetID:     feedback.TargetID,
		Polarity:     feedback.Polarity,
		QueryText:    feedback.QueryText,
		SourceSystem: feedback.SourceSystem,
	})
}

func (s *Service) recoverReviewRuns(ctx context.Context) error {
	if s.reviews == nil {
		return nil
	}
	runs, err := s.reviews.ListRecoverableReviewRuns(ctx)
	if err != nil {
		return err
	}
	for _, run := range runs {
		if err := s.finalizePreparedReviewRun(ctx, run); err != nil {
			_ = s.updateReviewRunStatus(ctx, run.ReviewRunID, "failed", err.Error())
			continue
		}
	}
	return nil
}

func (s *Service) reviewRunLocator(run ReviewRunRecord) (*runtimev1.MemoryBankLocator, error) {
	locator, err := memoryengine.LocatorKeyToMemoryBankLocator(run.BankLocatorKey)
	if err != nil {
		return nil, fmt.Errorf("resolve bank locator for review run %s: %w", run.ReviewRunID, err)
	}
	return locator, nil
}
