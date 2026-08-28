package runtimeagent

type runtimePrivateAIBridgeAI interface {
	lifeTurnScenarioExecutor
	chatTrackSidecarScenarioExecutor
	publicChatBindingResolverService
	publicChatScenarioStreamer
	publicChatActionScenarioExecutor
}

type RuntimePrivateAIBridge struct {
	lifeTrack         LifeTrackExecutor
	chatTrackSidecar  ChatTrackSidecarExecutor
	publicChatBinding PublicChatBindingResolver
	publicChatTurn    PublicChatTurnExecutor
	publicChatAction  PublicChatActionExecutor
}

func newRuntimePrivateAIBridge() *RuntimePrivateAIBridge {
	return &RuntimePrivateAIBridge{
		lifeTrack:         rejectingLifeTrackExecutor{},
		chatTrackSidecar:  rejectingChatTrackSidecarExecutor{},
		publicChatBinding: rejectingPublicChatBindingResolver{},
		publicChatTurn:    rejectingPublicChatTurnExecutor{},
		publicChatAction:  rejectingPublicChatActionExecutor{},
	}
}

func NewAIBackedRuntimePrivateAIBridge(ai runtimePrivateAIBridgeAI) *RuntimePrivateAIBridge {
	bridge := newRuntimePrivateAIBridge()
	if ai == nil {
		return bridge
	}
	bridge.lifeTrack = NewAIBackedLifeTrackExecutor(ai)
	bridge.chatTrackSidecar = NewAIBackedChatTrackSidecarExecutor(ai)
	bridge.publicChatBinding = NewAIBackedPublicChatBindingResolver(ai)
	bridge.publicChatTurn = NewAIBackedPublicChatTurnExecutor(ai)
	bridge.publicChatAction = NewAIBackedPublicChatActionExecutor(ai)
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

func (b *RuntimePrivateAIBridge) publicChatActionExecutor() PublicChatActionExecutor {
	if b == nil || b.publicChatAction == nil {
		return rejectingPublicChatActionExecutor{}
	}
	return b.publicChatAction
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

func (s *Service) setPublicChatActionExecutor(executor PublicChatActionExecutor) {
	s.aiBridgeMu.Lock()
	defer s.aiBridgeMu.Unlock()
	bridge := s.ensureRuntimePrivateAIBridgeLocked()
	if executor == nil {
		bridge.publicChatAction = rejectingPublicChatActionExecutor{}
		return
	}
	bridge.publicChatAction = executor
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

func (s *Service) currentPublicChatActionExecutor() PublicChatActionExecutor {
	s.aiBridgeMu.RLock()
	defer s.aiBridgeMu.RUnlock()
	if s == nil || s.aiBridge == nil {
		return rejectingPublicChatActionExecutor{}
	}
	return s.aiBridge.publicChatActionExecutor()
}
