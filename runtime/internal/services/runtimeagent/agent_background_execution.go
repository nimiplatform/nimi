package runtimeagent

import (
	"context"
	"sync"
	"time"
)

type agentBackgroundExecution struct {
	memoryRefs       []string // actual selected input; protected by chatSurfaceMu
	source           string
	conversationRead *lifeConversationRead
	ctx              context.Context
	cancel           context.CancelFunc
	done             chan struct{}
	invalidated      bool // protected by chatSurfaceMu
	transferred      bool // occupancy handed to a canonical background turn
}

// @nimi-authority: rule.nimi.runtime.agent-participation.shared-execution-admission
func (s *Service) claimAgentBackground(ctx context.Context, ref string) *agentBackgroundExecution {
	return s.claimAgentBackgroundFor(ctx, ref, "life_planning")
}

func (s *Service) claimAgentBackgroundFor(ctx context.Context, ref, source string) *agentBackgroundExecution {
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	if s.localAgentExecutionBusyLocked(ref) || s.foregroundWaitingByAgent[ref] > 0 || s.agentTerminationFencedLocked(ref) {
		return nil
	}
	if s.backgroundByAgent == nil {
		s.backgroundByAgent = map[string]*agentBackgroundExecution{}
	}
	execCtx, cancel := context.WithTimeout(ctx, 90*time.Second)
	work := &agentBackgroundExecution{source: source, ctx: execCtx, cancel: cancel, done: make(chan struct{})}
	s.backgroundByAgent[ref] = work
	return work
}

// Call only after all underlying inference has actually returned.
func (s *Service) releaseAgentBackground(ref string, work *agentBackgroundExecution) {
	s.chatSurfaceMu.Lock()
	if work.transferred {
		s.chatSurfaceMu.Unlock()
		return
	}
	work.cancel()
	if s.backgroundByAgent[ref] == work {
		delete(s.backgroundByAgent, ref)
	}
	close(work.done)
	s.chatSurfaceMu.Unlock()
}

func (s *Service) yieldAgentBackground(ctx context.Context, ref string) (func(), error) {
	s.chatSurfaceMu.Lock()
	if s.foregroundWaitingByAgent == nil {
		s.foregroundWaitingByAgent = map[string]int{}
	}
	s.foregroundWaitingByAgent[ref]++
	work := s.backgroundByAgent[ref]
	var cancel context.CancelFunc
	var done <-chan struct{}
	if work != nil {
		work.invalidated = true
		cancel, done = work.cancel, work.done
	} else if turn := s.chatTurns[s.chatActiveByAgent[ref]]; turn != nil && isProactiveOrigin(turn.Origin) && turn.BackgroundReleased != nil {
		turn.Interrupted = true
		turn.InterruptReason = "foreground_user_input"
		cancel, done = turn.Cancel, turn.BackgroundReleased
	}
	s.chatSurfaceMu.Unlock()
	var once sync.Once
	release := func() {
		once.Do(func() {
			s.chatSurfaceMu.Lock()
			s.foregroundWaitingByAgent[ref]--
			if s.foregroundWaitingByAgent[ref] == 0 {
				delete(s.foregroundWaitingByAgent, ref)
			}
			s.chatSurfaceMu.Unlock()
		})
	}
	if done == nil {
		return release, nil
	}
	if cancel != nil {
		cancel()
	}
	select {
	case <-done:
		return release, nil
	case <-ctx.Done():
		release()
		return nil, ctx.Err()
	}
}
