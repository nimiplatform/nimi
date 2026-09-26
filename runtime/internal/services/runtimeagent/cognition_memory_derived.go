package runtimeagent

// The same tracked lifecycle owns canonical drains and coalesced derived work.
// A slow model must not hold up new committed events for its own Agent.
type memoryDerivedWork struct{ pending bool }

// @nimi-authority: rule.nimi.runtime.memory-world.r015
func (s *Service) triggerCognitionMemoryDerived(ref string) {
	s.cognitionMemoryDrainMu.Lock()
	ctx := s.cognitionMemoryLifecycleCtx
	if s.isClosed() || ctx == nil || ctx.Err() != nil {
		s.cognitionMemoryDrainMu.Unlock()
		return
	}
	if s.cognitionMemoryDerived == nil {
		s.cognitionMemoryDerived = make(map[string]*memoryDerivedWork)
	}
	if work := s.cognitionMemoryDerived[ref]; work != nil {
		work.pending = true
		s.cognitionMemoryDrainMu.Unlock()
		return
	}
	work := &memoryDerivedWork{}
	s.cognitionMemoryDerived[ref] = work
	s.cognitionMemoryWG.Add(1)
	s.cognitionMemoryDrainMu.Unlock()
	go func() {
		defer s.cognitionMemoryWG.Done()
		for {
			if err := s.cognitionMemoryFacade.ResumeDerived(ctx, ref); err != nil && ctx.Err() == nil && s.logger != nil {
				s.logger.Warn("Cognition Memory derived work remains pending", "local_agent_ref", ref, "error", err)
			}
			s.cognitionMemoryDrainMu.Lock()
			if work.pending && ctx.Err() == nil {
				work.pending = false
				s.cognitionMemoryDrainMu.Unlock()
				continue
			}
			if s.cognitionMemoryDerived[ref] == work {
				delete(s.cognitionMemoryDerived, ref)
			}
			s.cognitionMemoryDrainMu.Unlock()
			return
		}
	}()
}
