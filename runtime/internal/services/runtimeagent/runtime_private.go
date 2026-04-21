package runtimeagent

import (
	"context"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/memoryengine"
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
	return s.reviewRuntime().putBehavioralPosture(ctx, posture)
}

func (s *Service) GetBehavioralPosture(ctx context.Context, agentID string) (*BehavioralPosture, error) {
	return s.reviewRuntime().getBehavioralPosture(ctx, agentID)
}

func (s *Service) SavePreparedReviewRun(ctx context.Context, run ReviewRunRecord) error {
	return s.reviewRuntime().savePreparedReviewRun(ctx, run)
}

func (s *Service) updateReviewRunStatus(ctx context.Context, reviewRunID string, statusValue string, failureMessage string) error {
	return s.reviewRuntime().updateReviewRunStatus(ctx, reviewRunID, statusValue, failureMessage)
}

func (s *Service) recordReviewFollowUp(ctx context.Context, run ReviewRunRecord) error {
	return s.reviewRuntime().recordReviewFollowUp(ctx, run)
}

func (s *Service) GetReviewFollowUp(ctx context.Context, locator *runtimev1.MemoryBankLocator) (*ReviewFollowUpRecord, error) {
	return s.reviewRuntime().getReviewFollowUp(ctx, locator)
}

func (s *Service) RecordAgentMemoryRecallFeedback(ctx context.Context, feedback AgentMemoryRecallFeedback) error {
	return s.reviewRuntime().recordRecallFeedback(ctx, feedback)
}

func (s *Service) recoverReviewRuns(ctx context.Context) error {
	return s.reviewRuntime().recoverRuns(ctx)
}

func (s *Service) reviewRunLocator(run ReviewRunRecord) (*runtimev1.MemoryBankLocator, error) {
	return s.reviewRuntime().reviewRunLocator(run)
}
