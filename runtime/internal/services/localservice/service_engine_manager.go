package localservice

import (
	"fmt"
	"strings"
)

// SetLlamaEngineVersion binds Local Environment package identity to the exact
// version used by the llama ExecutionHost. It must be called before the
// manager is exposed to dependency planning.
func (s *Service) SetLlamaEngineVersion(version string) error {
	trimmed := strings.TrimSpace(version)
	if trimmed == "" {
		return fmt.Errorf("llama engine version is required")
	}
	s.mu.Lock()
	s.llamaEngineVersion = trimmed
	s.mu.Unlock()
	return nil
}

// SetEngineManager injects the Runtime-private ExecutionHost manager used by
// local environment planning and dependency jobs. Process lifecycle and
// residency are not projected through RuntimeLocalService RPCs.
func (s *Service) SetEngineManager(mgr EngineManager) {
	s.mu.Lock()
	s.engineMgr = mgr
	s.mu.Unlock()
}
