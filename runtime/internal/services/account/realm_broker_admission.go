package account

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func (operation realmUnaryOperation) admitsCallerMode(mode runtimev1.AccountCallerMode) bool {
	_, ok := operation.allowedCallerModes[mode]
	return ok
}

func (s *Service) admitRealmBrokerCapabilities(caller *runtimev1.AccountCaller, operation realmUnaryOperation) bool {
	if caller == nil || s.registry == nil {
		return false
	}
	record, ok := s.registry.Get(caller.GetAppId())
	if !ok {
		return false
	}
	instance, ok := record.Instances[strings.TrimSpace(caller.GetAppInstanceId())]
	if !ok {
		return false
	}
	capabilities := make(map[string]struct{}, len(instance.Capabilities))
	for _, capability := range instance.Capabilities {
		if normalized := strings.TrimSpace(capability); normalized != "" {
			capabilities[normalized] = struct{}{}
		}
	}
	for _, required := range operation.requiredRuntimeScopes {
		if _, ok := capabilities[strings.TrimSpace(required)]; !ok {
			return false
		}
	}
	for _, alternative := range operation.requiredAppCapabilities {
		if _, ok := capabilities[strings.TrimSpace(alternative)]; ok {
			return true
		}
	}
	return false
}
