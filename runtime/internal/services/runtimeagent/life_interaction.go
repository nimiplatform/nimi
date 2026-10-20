package runtimeagent

import (
	"fmt"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
)

func maxTime(a, b time.Time) time.Time {
	if a.After(b) {
		return a
	}
	return b
}

const lifeInteractionSilence = 120 * time.Second

// The interaction interval outlives an individual execution slot. The source
// identity fences a late release from an earlier turn; no timer owns state.
type lifeInteraction struct {
	ID             string    `json:"id"`
	SourceID       string    `json:"sourceId"`
	StartedAt      time.Time `json:"startedAt"`
	LastActivityAt time.Time `json:"lastActivityAt"`
}

// @nimi-authority: rule.nimi.runtime.agent-life.timeline
func (l *agentLifeState) beginInteraction(sourceID string, now time.Time, simulation, worldPaused bool) ([]string, error) {
	now = maxTime(now, l.SettledAt)
	var completed []string
	if l.Interaction == nil {
		if simulation {
			var err error
			completed, err = l.advance(now, worldPaused)
			if err != nil {
				return nil, err
			}
		}
		if l.Current != nil {
			l.NextCheckAt = now
		}
		l.interruptCurrent(now)
		l.Interaction = &lifeInteraction{ID: "interaction_" + ulid.Make().String(), StartedAt: now}
	}
	l.Interaction.SourceID = sourceID
	if now.After(l.Interaction.LastActivityAt) {
		l.Interaction.LastActivityAt = now
	}
	l.WaitReason = "interaction"
	return completed, l.changed()
}

func (l *agentLifeState) interruptCurrent(now time.Time) {
	if l.Current == nil {
		return
	}
	f := *l.Current
	if a := l.Activities[f.ActivityRef]; a != nil {
		f.EndProgress = a.Progress
		a.Phase = lifePaused
	}
	if now.After(f.StartsAt) {
		f.EndsAt = minTime(now, f.EndsAt)
		f.Phase, f.CompletesActivity = lifeInterrupted, false
		l.appendRecent(f)
	}
	l.Current = nil
}

func minTime(a, b time.Time) time.Time {
	if a.Before(b) {
		return a
	}
	return b
}

func (l *agentLifeState) finishInteraction(now time.Time) error {
	i := l.Interaction
	if i == nil {
		return nil
	}
	if now.After(i.StartedAt) {
		l.appendRecent(lifeFrame{ID: i.ID, Title: "Interaction", StartsAt: i.StartedAt, EndsAt: now, Phase: lifeCompleted, Interaction: true})
	}
	l.Interaction = nil
	l.reviewFuture(now)
	if now.After(l.SettledAt) {
		l.SettledAt = now
	}
	l.WaitReason = ""
	return l.changed()
}

// Invalid segments do not establish their advertised progress. The next
// segment records its required progress, so it cannot jump a missed step.
func (l *agentLifeState) reviewFuture(now time.Time) {
	previousCount := len(l.Future)
	kept := l.Future[:0]
	progress := map[string]int{}
	for ref, a := range l.Activities {
		progress[ref] = a.Progress
	}
	for _, f := range l.Future {
		a := l.Activities[f.ActivityRef]
		if f.Invalidated || f.StartsAt.Before(now) || a == nil || a.Phase == lifeCanceled || a.Phase == lifeCompleted || f.StartProgress > progress[f.ActivityRef] {
			if a != nil && a.Phase != lifeCanceled && a.Phase != lifeCompleted {
				a.Phase = lifePaused
			}
			continue
		}
		kept = append(kept, f)
		progress[f.ActivityRef] = f.EndProgress
	}
	l.Future = kept
	if len(kept) > 0 {
		l.NextCheckAt = maxTime(l.NextCheckAt, kept[0].StartsAt)
	} else if previousCount > 0 {
		l.NextCheckAt = now
	}
}

func (s *Service) recordLifeInteractionRelease(ref, sourceID string, now time.Time) {
	err := s.mutateAgent(ref, func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
		i := e.Life.Interaction
		if i == nil || i.SourceID != sourceID || !now.After(i.LastActivityAt) {
			return nil, nil, nil
		}
		i.LastActivityAt = now
		return nil, nil, e.Life.changed()
	})
	if err != nil && s.logger != nil {
		s.logger.Warn("record interaction release", "error", err)
	}
}

// Called with the Agent owner locked. Live participation and media generation
// are checked under the same admission mutex. Connection presence is not input.
func (s *Service) lifeInteractionBusy(ref string) bool {
	s.chatSurfaceMu.Lock()
	for _, turn := range s.chatTurns {
		if turn.AgentID == ref {
			s.chatSurfaceMu.Unlock()
			return true
		}
	}
	busy := s.localAppWorkActiveByAgent[ref] != ""
	s.chatSurfaceMu.Unlock()
	if busy {
		return true
	}
	s.agentRealtimeMu.RLock()
	sessions := make([]*localAppAgentRealtimeSession, 0, len(s.agentRealtimeSessions))
	for _, session := range s.agentRealtimeSessions {
		if session.agentID == ref {
			sessions = append(sessions, session)
		}
	}
	s.agentRealtimeMu.RUnlock()
	for _, session := range sessions {
		session.mu.Lock()
		active := (session.speechActive || session.inputFinalizing) && !session.closed
		session.mu.Unlock()
		if active {
			return true
		}
	}
	return false
}

func (s *Service) recordVoiceLife(session *localAppAgentRealtimeSession, utterance string, started bool) error {
	session.mu.Lock()
	prior := session.speechActive
	session.mu.Unlock()
	if prior == started {
		return nil
	}
	sourceID := "voice:" + session.realtimeSessionID + ":" + utterance
	now := time.Now().UTC()
	if !started {
		session.mu.Lock()
		sourceID = session.speechSourceID
		session.mu.Unlock()
		s.recordLifeInteractionRelease(session.agentID, sourceID, now)
		session.mu.Lock()
		session.speechActive = false
		session.mu.Unlock()
		return nil
	}
	source, found := s.turnSourceView(session.agentID)
	if !found {
		return fmt.Errorf("voice life source unavailable")
	}
	s.cognitionMemoryOwnerLifecycleMu.Lock()
	defer s.cognitionMemoryOwnerLifecycleMu.Unlock()
	err := s.mutateAgent(session.agentID, func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
		_, err := e.Life.beginInteraction(sourceID, now, lifeEnabled(e), source.LifeWorldPaused)
		if err != nil {
			return nil, nil, err
		}
		return nil, nil, nil
	})
	if err == nil {
		session.mu.Lock()
		session.speechActive = true
		session.speechSourceID = sourceID
		session.mu.Unlock()
	}
	return err
}
