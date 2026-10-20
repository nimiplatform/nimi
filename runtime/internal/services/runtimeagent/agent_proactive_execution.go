package runtimeagent

import (
	"database/sql"
	"fmt"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

func isProactiveOrigin(origin string) bool {
	return origin == publicChatTurnOriginFollowUp || origin == "life" || origin == "contact"
}

func (s *Service) accountProactiveUsage(turn publicChatTurnState, usage *runtimev1.UsageStats) {
	now := time.Now().UTC()
	err := s.mutateAgent(turn.AgentID, func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
		if !proto.Equal(e.Agent.GetCreatedAt(), turn.AgentCreatedAt) {
			return nil, nil, nil
		}
		before := snapshotAutonomy(e.Agent.GetAutonomy())
		applyTokenUsage(e, addNonNegativeUsage(usage.GetInputTokens(), usage.GetOutputTokens()), now)
		if turn.ProactiveIntent != nil {
			for i := range e.Life.Intents {
				if e.Life.Intents[i].ID == turn.ProactiveIntent.ID {
					e.Life.Intents[i].DueAt = now.Add(5 * time.Minute)
				}
			}
		}
		return optionalEvents(budgetEventForTransition(turn.AgentID, before, e.Agent.GetAutonomy(), now)), nil, nil
	})
	if err != nil && s.logger != nil {
		s.logger.Warn("background Conversation accounting failed", "error", err)
	}
}

func validLifeProactiveClaim(entry *agentEntry, claim *lifeProactiveIntent, now time.Time) bool {
	if entry == nil || entry.Life == nil || claim == nil || entry.Agent.GetLifecycleStatus() != runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE {
		return false
	}
	for _, intent := range entry.Life.Intents {
		if intent.ID != claim.ID || intent.Source != claim.Source || intent.DueAt.After(now) || !intent.ExpiresAt.IsZero() && now.After(intent.ExpiresAt) {
			continue
		}
		if intent.Source == "life" {
			a := entry.Life.Activities[intent.ActivityRef]
			if a == nil || a.Phase == lifeCanceled {
				return false
			}
		}
		if intent.Source == "contact" {
			return intent.Text != "" && lifeContactPermitted(entry, now)
		}
		return lifeContactAllowed(entry, now)
	}
	return false
}

// Caller holds Agent and Conversation commit locks. The returned state is
// published only after the same transaction persists the assistant message.
func (s *Service) prepareProactiveMessageCommit(entry *agentEntry, turn *publicChatTurnState, now time.Time) (*agentEntry, runtimeAgentStateTxHook, error) {
	if turn == nil || !isProactiveOrigin(turn.Origin) {
		return nil, nil, nil
	}
	if entry == nil {
		return nil, nil, fmt.Errorf("proactive Agent unavailable")
	}
	next := cloneAgentEntry(entry)
	if claim := turn.ProactiveIntent; claim != nil {
		if !validLifeProactiveClaim(next, claim, now) {
			return nil, nil, fmt.Errorf("proactive source changed before message commit")
		}
		out := next.Life.Intents[:0]
		for _, intent := range next.Life.Intents {
			if intent.ID != claim.ID {
				out = append(out, intent)
			}
		}
		next.Life.Intents = out

	}
	{
		if !lifeContactPermitted(next, now) {
			return nil, nil, fmt.Errorf("free contact is no longer permitted")
		}
		kept := next.Life.ContactTimes[:0]
		for _, at := range next.Life.ContactTimes {
			if at.After(now.Add(-24 * time.Hour)) {
				kept = append(kept, at)
			}
		}
		next.Life.ContactTimes = append(kept, now)
		next.Life.ContactSinceUser = true
	}
	return next, func(tx *sql.Tx) error { return persistAgentLifeTx(tx, entry.Agent.GetLocalAgentRef(), next.Life) }, nil
}
