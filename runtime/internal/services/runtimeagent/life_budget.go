package runtimeagent

import (
	"context"
	"fmt"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func backgroundAllowance(entry *agentEntry, estimate uint64, unaccounted int64) error {
	limit := entry.Agent.GetAutonomy().GetConfig().GetDailyTokenBudget()
	used := addNonNegativeUsage(entry.Agent.GetAutonomy().GetUsedTokensInWindow(), unaccounted)
	if limit > 0 && (estimate > uint64(limit) || estimate > uint64(max(0, limit-used))) {
		return &lifeBudgetUnavailable{minimum: estimate > uint64(limit)}
	}
	return nil
}

func (s *Service) admitProactiveCall(ctx context.Context, turn publicChatTurnState, compiled *agentTurnContextCompilation, priorUsage *runtimev1.UsageStats) error {
	if !isProactiveOrigin(turn.Origin) {
		return nil
	}
	estimate, err := lifeCallEstimate(compiled)
	if err != nil {
		return err
	}
	return s.mutateAgent(turn.AgentID, func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
		if err := ctx.Err(); err != nil {
			return nil, nil, err
		}
		advanceAutonomyWindow(e, time.Now().UTC())
		// Earlier responses in this turn are charged once on turn exit. They
		// already consume allowance before a possible Recall result response.
		return nil, nil, backgroundAllowance(e, estimate, addNonNegativeUsage(priorUsage.GetInputTokens(), priorUsage.GetOutputTokens()))
	})
}

type lifeBudgetUnavailable struct {
	minimum bool
}

func (e *lifeBudgetUnavailable) Error() string {
	if e.minimum {
		return "background window cannot fit one legal generation"
	}
	return "remaining background allowance cannot fit this generation"
}

func lifeCallEstimate(compiled *agentTurnContextCompilation) (uint64, error) {
	// Count the final emitted envelope, not only required lanes. The existing
	// UTF-8 upper bound includes non-ASCII context and no model-specific guess.
	total := compiled.Manifest.Budget.ReservedOutputTokens + compiled.Manifest.Budget.ReservedAdapterTokens
	for _, message := range compiled.ProviderPrompt.Messages {
		n, err := agentTurnContextUTF8ByteTokenUpperBound(message.Role, message.Content)
		if err != nil {
			return 0, err
		}
		var ok bool
		total, ok = addAgentTurnContextTokens(total, n, agentTurnContextMessageTokenOverheadUpperBound)
		if !ok {
			return 0, fmt.Errorf("background input estimate overflow")
		}
	}
	return total, nil
}

func (s *Service) admitLifeCall(input *lifeFrameExecutionInput, estimate uint64) error {
	return s.mutateAgent(input.Entry.Agent.GetLocalAgentRef(), func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
		now := time.Now().UTC()
		advanceAutonomyWindow(e, now)
		if err := backgroundAllowance(e, estimate, 0); err != nil {
			return nil, nil, err
		}
		if input.Work == nil || input.Work.ctx.Err() != nil {
			return nil, nil, fmt.Errorf("background call lost execution")
		}
		if input.ContactOnly {
			if !lifeContactAllowed(e, now) {
				return nil, nil, fmt.Errorf("contact is no longer permitted")
			}
			e.Life.ContactNextAt = now.Add(30 * time.Minute)
			e.Life.ContactBudgetWaiting = false
		} else {
			if !lifeEnabled(e) || e.Life.Interaction != nil {
				return nil, nil, fmt.Errorf("simulation is occupied")
			}
			e.Life.LastLifeAttempt = now
			e.Life.LifeBudgetWaiting = false
		}
		if !e.Life.LifeBudgetWaiting && !e.Life.ContactBudgetWaiting &&
			(e.Life.WaitReason == "budget_exhausted" || e.Life.WaitReason == "budget_insufficient") {
			e.Life.WaitReason = ""
		}
		return nil, nil, nil
	})
}
