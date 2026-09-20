package localservice

import "github.com/nimiplatform/nimi/runtime/internal/localexecution"

// Daemon injects the private process owners before they accept execution.
// Removal can then wait for actual Host exit, including resident mappings on
// platforms where an unlinked file would otherwise remain silently in use.
func (s *Service) SetModelAssetHostRetirers(hosts ...localexecution.ModelAssetHostRetirer) {
	s.modelAssetMutationMu.Lock()
	defer s.modelAssetMutationMu.Unlock()
	s.modelAssetHosts = append([]localexecution.ModelAssetHostRetirer(nil), hosts...)
	for _, host := range s.modelAssetHosts {
		host.SetModelAssetCleanupCallback(s.retryModelAssetCleanupObligations)
	}
}

// Called after a supervised process reports exit, outside its callback locks.
func (s *Service) RetryModelAssetCleanupAfterHostExit() { s.retryModelAssetCleanupObligations() }
