package agentcore

import (
	"context"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	memoryservice "github.com/nimiplatform/nimi/runtime/internal/services/memory"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
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
	if !s.HasCanonicalReviewExecutor() {
		return nil
	}
	recoverableBanks, err := s.recoverableCanonicalReviewBanks(ctx)
	if err != nil {
		return err
	}
	for _, target := range s.canonicalReviewSchedulingTargets() {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		if target.locator == nil {
			continue
		}
		if _, blocked := recoverableBanks[memoryservice.LocatorKey(target.locator)]; blocked {
			continue
		}
		eligible, err := s.canonicalReviewBankEligible(ctx, target.locator, now)
		if err != nil {
			return err
		}
		if !eligible {
			continue
		}
		if _, err := s.ExecuteCanonicalReview(ctx, CanonicalReviewRequest{
			AgentID: target.agentID,
			Bank:    cloneLocator(target.locator),
		}); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) canonicalReviewSchedulingTargets() []scheduledCanonicalReviewTarget {
	s.mu.RLock()
	entries := make([]*agentEntry, 0, len(s.agents))
	for _, entry := range s.agents {
		entries = append(entries, &agentEntry{
			Agent: cloneAgentRecord(entry.Agent),
			State: cloneAgentState(entry.State),
		})
	}
	s.mu.RUnlock()

	targets := make([]scheduledCanonicalReviewTarget, 0)
	for _, entry := range entries {
		if entry == nil || entry.Agent == nil || entry.State == nil {
			continue
		}
		if entry.Agent.GetLifecycleStatus() != runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE {
			continue
		}
		if entry.State.GetExecutionState() != runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_IDLE {
			continue
		}
		for _, locator := range s.queryLocatorsForAgent(entry, nil) {
			if locator == nil {
				continue
			}
			targets = append(targets, scheduledCanonicalReviewTarget{
				agentID: entry.Agent.GetAgentId(),
				locator: cloneLocator(locator),
			})
		}
	}
	return targets
}

func (s *Service) recoverableCanonicalReviewBanks(ctx context.Context) (map[string]struct{}, error) {
	if s.reviews == nil {
		return nil, nil
	}
	runs, err := s.reviews.ListRecoverableReviewRuns(ctx)
	if err != nil {
		return nil, err
	}
	out := make(map[string]struct{}, len(runs))
	for _, run := range runs {
		key := strings.TrimSpace(run.BankLocatorKey)
		if key == "" {
			continue
		}
		out[key] = struct{}{}
	}
	return out, nil
}

func (s *Service) canonicalReviewBankEligible(ctx context.Context, locator *runtimev1.MemoryBankLocator, now time.Time) (bool, error) {
	if locator == nil {
		return false, nil
	}
	if _, err := s.memorySvc.GetBank(ctx, &runtimev1.GetBankRequest{Locator: cloneLocator(locator)}); err != nil {
		if status.Code(err) == codes.NotFound {
			return false, nil
		}
		return false, err
	}
	followUp, err := s.GetReviewFollowUp(ctx, locator)
	if err != nil {
		return false, err
	}
	if followUp == nil {
		return true, nil
	}
	completedAt, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(followUp.CompletedAt))
	if err != nil {
		return false, err
	}
	return !completedAt.After(now.Add(-canonicalReviewEligibilityWindow)), nil
}

func shouldRunCanonicalReviewSchedulingSweep(lastSweep time.Time, now time.Time) bool {
	if lastSweep.IsZero() {
		return true
	}
	return !now.Before(lastSweep.Add(canonicalReviewSchedulingSweepInterval))
}
