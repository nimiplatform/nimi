package runtimeagent

import (
	"database/sql"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// Caller holds the Agent mutex. There is one durable free-contact policy;
// anchor flags below are only transient snapshot projections of that policy.
func (s *Service) commitAutonomyAndConversationControls(current, next *agentEntry) ([]func(), error) {
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	ref := next.Agent.GetLocalAgentRef()
	enabled := next.Agent.GetAutonomy().GetConfig().GetFreeContactEnabled()
	before := map[string]publicChatAnchorState{}
	removed := map[string]*publicChatFollowUpState{}
	version := s.chatSurfaceVersion
	ids := []string{}
	for id, anchor := range s.chatAnchors {
		if anchor.LocalAgentRef != ref || anchor.EffectiveFreeContactEnabled == enabled && (enabled || anchor.PendingFollowUpID == "") {
			continue
		}
		before[id] = *anchor
		ids = append(ids, id)
		anchor.EffectiveFreeContactEnabled = enabled
		if !enabled {
			if pending := s.chatFollowUps[anchor.PendingFollowUpID]; pending != nil {
				removed[pending.FollowUpID] = pending
				delete(s.chatFollowUps, pending.FollowUpID)
			}
			anchor.PendingFollowUpID = ""
		}
		anchor.LocalAppSequence++
	}
	rollback := func() {
		for id, old := range before {
			*s.chatAnchors[id] = old
		}
		for id, pending := range removed {
			s.chatFollowUps[id] = pending
		}
		s.chatSurfaceVersion = version
	}
	var snapshot persistedPublicChatSurfaceState
	var hook runtimeAgentStateTxHook
	if len(ids) > 0 {
		var err error
		snapshot, err = s.capturePublicChatSurfaceSnapshotLocked(ids...)
		if err != nil {
			rollback()
			return nil, err
		}
		hook = func(tx *sql.Tx) error { return persistPublicChatSurfaceStateTx(tx, snapshot) }
	}
	if err := s.stateRepo.persistAgentDelta(next, nil, s.sequence, hook); err != nil {
		rollback()
		return nil, err
	}
	s.agents[ref] = next
	if len(ids) > 0 {
		s.markPersistedTranscriptLocked(snapshot)
	}
	var after []func()
	for _, pending := range removed {
		if pending.Cancel != nil {
			after = append(after, pending.Cancel)
		}
	}
	if !lifeEnabled(next) {
		if work := s.backgroundByAgent[ref]; work != nil && work.source == "life_planning" {
			work.invalidated = true
			after = append(after, work.cancel)
		}

	}
	if !enabled {
		if work := s.backgroundByAgent[ref]; work != nil && (work.source == "life" || work.source == "follow_up" || work.source == "contact" || work.source == "contact_judgment") {
			work.invalidated = true
			after = append(after, work.cancel)
		}
		if turn := s.chatTurns[s.chatActiveByAgent[ref]]; turn != nil && isProactiveOrigin(turn.Origin) {
			turn.Interrupted = true
			turn.InterruptReason = "free_contact_disabled"
			if turn.Cancel != nil {
				after = append(after, turn.Cancel)
			}
		}
	}
	for _, id := range ids {
		anchor := s.chatAnchors[id]
		accountID := anchor.SubjectUserID
		state := s.localAppConversationStateLocked(anchor)
		event := &runtimev1.LocalAppConversationEvent{ConversationAnchorId: id, Sequence: anchor.LocalAppSequence, Event: &runtimev1.LocalAppConversationEvent_StateChanged{StateChanged: state}}
		after = append(after, func() {
			s.broadcastLocalAppConversationEvents(accountID, id, []*runtimev1.LocalAppConversationEvent{event})
		})
	}
	return after, nil
}
