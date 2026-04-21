package runtimeagent

import (
	"context"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

const (
	canonicalReviewSchedulingSweepInterval = time.Hour
	canonicalReviewEligibilityWindow       = 24 * time.Hour
)

type scheduledCanonicalReviewTarget struct {
	agentID string
	locator *runtimev1.MemoryBankLocator
}

func (s *Service) runCanonicalReviewSchedulingSweep(ctx context.Context, now time.Time) error {
	return s.reviewRuntime().runSchedulingSweep(ctx, now)
}

func (s *Service) canonicalReviewSchedulingTargets() []scheduledCanonicalReviewTarget {
	return s.reviewRuntime().schedulingTargets()
}

func (s *Service) recoverableCanonicalReviewBanks(ctx context.Context) (map[string]struct{}, error) {
	return s.reviewRuntime().recoverableBanks(ctx)
}

func (s *Service) canonicalReviewBankEligible(ctx context.Context, locator *runtimev1.MemoryBankLocator, now time.Time) (bool, error) {
	return s.reviewRuntime().bankEligible(ctx, locator, now)
}

func shouldRunCanonicalReviewSchedulingSweep(lastSweep time.Time, now time.Time) bool {
	if lastSweep.IsZero() {
		return true
	}
	return !now.Before(lastSweep.Add(canonicalReviewSchedulingSweepInterval))
}
