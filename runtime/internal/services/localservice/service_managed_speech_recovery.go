package localservice

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func (s *Service) managedSpeechEngineAlreadyRunning(model *runtimev1.LocalAssetRecord) bool {
	if model == nil {
		return false
	}
	endpoint := s.effectiveLocalModelEndpoint(model)
	port, err := parseManagedEndpointPort("speech", endpoint)
	if err != nil {
		return false
	}
	return managedEngineAlreadyBound(s.engineManagerOrNil(), "speech", port)
}

func managedSupervisedSpeechColdRecovery(reason string) bool {
	return strings.TrimSpace(reason) == "recovery_sweep"
}
