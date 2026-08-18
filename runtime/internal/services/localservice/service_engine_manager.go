package localservice

// SetEngineManager injects the Runtime-private ExecutionHost manager used by
// local environment planning and dependency jobs. Process lifecycle and
// residency are not projected through RuntimeLocalService RPCs.
func (s *Service) SetEngineManager(mgr EngineManager) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.engineMgr = mgr
}
