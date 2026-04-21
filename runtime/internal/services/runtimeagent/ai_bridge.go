package runtimeagent

type runtimePrivateAIBridgeAI interface {
	lifeTurnScenarioExecutor
	chatTrackSidecarScenarioExecutor
	canonicalReviewScenarioExecutor
	publicChatBindingResolverService
	publicChatScenarioStreamer
}

type RuntimePrivateAIBridge struct {
	lifeTrack         LifeTrackExecutor
	chatTrackSidecar  ChatTrackSidecarExecutor
	canonicalReview   CanonicalReviewExecutor
	publicChatBinding PublicChatBindingResolver
	publicChatTurn    PublicChatTurnExecutor
}

func newRuntimePrivateAIBridge() *RuntimePrivateAIBridge {
	return &RuntimePrivateAIBridge{
		lifeTrack:         rejectingLifeTrackExecutor{},
		chatTrackSidecar:  rejectingChatTrackSidecarExecutor{},
		canonicalReview:   rejectingCanonicalReviewExecutor{},
		publicChatBinding: rejectingPublicChatBindingResolver{},
		publicChatTurn:    rejectingPublicChatTurnExecutor{},
	}
}

func NewAIBackedRuntimePrivateAIBridge(ai runtimePrivateAIBridgeAI) *RuntimePrivateAIBridge {
	bridge := newRuntimePrivateAIBridge()
	if ai == nil {
		return bridge
	}
	bridge.lifeTrack = NewAIBackedLifeTrackExecutor(ai)
	bridge.chatTrackSidecar = NewAIBackedChatTrackSidecarExecutor(ai)
	bridge.canonicalReview = NewAIBackedCanonicalReviewExecutor(ai)
	bridge.publicChatBinding = NewAIBackedPublicChatBindingResolver(ai)
	bridge.publicChatTurn = NewAIBackedPublicChatTurnExecutor(ai)
	return bridge
}

func (b *RuntimePrivateAIBridge) lifeTrackExecutor() LifeTrackExecutor {
	if b == nil || b.lifeTrack == nil {
		return rejectingLifeTrackExecutor{}
	}
	return b.lifeTrack
}

func (b *RuntimePrivateAIBridge) chatTrackSidecarExecutor() ChatTrackSidecarExecutor {
	if b == nil || b.chatTrackSidecar == nil {
		return rejectingChatTrackSidecarExecutor{}
	}
	return b.chatTrackSidecar
}

func (b *RuntimePrivateAIBridge) canonicalReviewExecutor() CanonicalReviewExecutor {
	if b == nil || b.canonicalReview == nil {
		return rejectingCanonicalReviewExecutor{}
	}
	return b.canonicalReview
}

func (b *RuntimePrivateAIBridge) publicChatBindingResolver() PublicChatBindingResolver {
	if b == nil || b.publicChatBinding == nil {
		return rejectingPublicChatBindingResolver{}
	}
	return b.publicChatBinding
}

func (b *RuntimePrivateAIBridge) publicChatTurnExecutor() PublicChatTurnExecutor {
	if b == nil || b.publicChatTurn == nil {
		return rejectingPublicChatTurnExecutor{}
	}
	return b.publicChatTurn
}

func (s *Service) ensureRuntimePrivateAIBridgeLocked() *RuntimePrivateAIBridge {
	if s.aiBridge == nil {
		s.aiBridge = newRuntimePrivateAIBridge()
	}
	return s.aiBridge
}

func (s *Service) SetRuntimePrivateAIBridge(bridge *RuntimePrivateAIBridge) {
	if s == nil || s.isClosed() {
		return
	}
	s.aiBridgeMu.Lock()
	if bridge == nil {
		s.aiBridge = newRuntimePrivateAIBridge()
	} else {
		s.aiBridge = bridge
	}
	s.aiBridgeMu.Unlock()
	s.resumeRecoveredPublicChatFollowUps()
}

func (s *Service) setLifeTrackExecutor(executor LifeTrackExecutor) {
	s.aiBridgeMu.Lock()
	defer s.aiBridgeMu.Unlock()
	bridge := s.ensureRuntimePrivateAIBridgeLocked()
	if executor == nil {
		bridge.lifeTrack = rejectingLifeTrackExecutor{}
		return
	}
	bridge.lifeTrack = executor
}

func (s *Service) setChatTrackSidecarExecutor(executor ChatTrackSidecarExecutor) {
	s.aiBridgeMu.Lock()
	defer s.aiBridgeMu.Unlock()
	bridge := s.ensureRuntimePrivateAIBridgeLocked()
	if executor == nil {
		bridge.chatTrackSidecar = rejectingChatTrackSidecarExecutor{}
		return
	}
	bridge.chatTrackSidecar = executor
}

func (s *Service) setCanonicalReviewExecutor(executor CanonicalReviewExecutor) {
	s.aiBridgeMu.Lock()
	defer s.aiBridgeMu.Unlock()
	bridge := s.ensureRuntimePrivateAIBridgeLocked()
	if executor == nil {
		bridge.canonicalReview = rejectingCanonicalReviewExecutor{}
		return
	}
	bridge.canonicalReview = executor
}

func (s *Service) setPublicChatBindingResolver(resolver PublicChatBindingResolver) {
	s.aiBridgeMu.Lock()
	defer s.aiBridgeMu.Unlock()
	bridge := s.ensureRuntimePrivateAIBridgeLocked()
	if resolver == nil {
		bridge.publicChatBinding = rejectingPublicChatBindingResolver{}
		return
	}
	bridge.publicChatBinding = resolver
}

func (s *Service) setPublicChatTurnExecutor(executor PublicChatTurnExecutor) {
	s.aiBridgeMu.Lock()
	defer s.aiBridgeMu.Unlock()
	bridge := s.ensureRuntimePrivateAIBridgeLocked()
	if executor == nil {
		bridge.publicChatTurn = rejectingPublicChatTurnExecutor{}
		return
	}
	bridge.publicChatTurn = executor
}

func (s *Service) currentLifeTrackExecutorFromBridge() LifeTrackExecutor {
	s.aiBridgeMu.RLock()
	defer s.aiBridgeMu.RUnlock()
	if s == nil || s.aiBridge == nil {
		return rejectingLifeTrackExecutor{}
	}
	return s.aiBridge.lifeTrackExecutor()
}

func (s *Service) currentChatTrackSidecarExecutor() ChatTrackSidecarExecutor {
	s.aiBridgeMu.RLock()
	defer s.aiBridgeMu.RUnlock()
	if s == nil || s.aiBridge == nil {
		return rejectingChatTrackSidecarExecutor{}
	}
	return s.aiBridge.chatTrackSidecarExecutor()
}

func (s *Service) currentCanonicalReviewExecutor() CanonicalReviewExecutor {
	s.aiBridgeMu.RLock()
	defer s.aiBridgeMu.RUnlock()
	if s == nil || s.aiBridge == nil {
		return rejectingCanonicalReviewExecutor{}
	}
	return s.aiBridge.canonicalReviewExecutor()
}

func (s *Service) currentPublicChatBindingResolver() PublicChatBindingResolver {
	s.aiBridgeMu.RLock()
	defer s.aiBridgeMu.RUnlock()
	if s == nil || s.aiBridge == nil {
		return rejectingPublicChatBindingResolver{}
	}
	return s.aiBridge.publicChatBindingResolver()
}

func (s *Service) currentPublicChatTurnExecutor() PublicChatTurnExecutor {
	s.aiBridgeMu.RLock()
	defer s.aiBridgeMu.RUnlock()
	if s == nil || s.aiBridge == nil {
		return rejectingPublicChatTurnExecutor{}
	}
	return s.aiBridge.publicChatTurnExecutor()
}
