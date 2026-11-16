package runtimeagent

import (
	"context"
	"database/sql"
)

// @nimi-authority: rule.nimi.runtime.agent-life.utopia-settings
// Caller holds the Agent/Conversation commit locks. The receipt is the habitat
// actually included in this turn, never a newly read habitat substituted for it.
func (s *Service) prepareHabitatObservationCommit(ctx context.Context, entry *agentEntry, read *lifeUtopiaRead) (*agentEntry, runtimeAgentStateTxHook, error) {
	if entry == nil || read == nil || entry.Life.LastObservedHabitatActivationID == read.ActivationID {
		return nil, nil, nil
	}
	settings, err := s.readLifeUtopiaSettings(ctx, entry.Agent.GetOwnerUserId())
	if err != nil || settings.HabitatActivationID != read.ActivationID {
		// Optional habitat availability never blocks an otherwise valid chat.
		// A late old turn must not consume the current relocation.
		return nil, nil, nil
	}
	next := cloneAgentEntry(entry)
	next.Life.LastObservedHabitatActivationID = read.ActivationID
	next.Life.LastObservedHabitatID = read.HabitatID
	next.Life.LastObservedHabitatTitle = read.HabitatTitle
	if err := next.Life.changed(); err != nil {
		return nil, nil, err
	}
	return next, func(tx *sql.Tx) error {
		return persistAgentLifeTx(tx, entry.Agent.GetLocalAgentRef(), next.Life)
	}, nil
}
