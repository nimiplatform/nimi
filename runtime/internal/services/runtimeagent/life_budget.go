package runtimeagent

import (
	"fmt"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

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
		limit := e.Agent.GetAutonomy().GetConfig().GetDailyTokenBudget()
		if limit > 0 && (estimate > uint64(limit) || estimate > uint64(max(0, limit-e.Agent.GetAutonomy().GetUsedTokensInWindow()))) {
			return nil, nil, &lifeBudgetUnavailable{minimum: estimate > uint64(limit)}
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
