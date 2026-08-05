package localservice

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

func (s *Service) SelectLocalCapabilityConfiguration(
	_ context.Context,
	request *runtimev1.SelectLocalCapabilityConfigurationRequest,
) (*runtimev1.SelectLocalCapabilityConfigurationResponse, error) {
	capabilityContract := strings.TrimSpace(request.GetCapabilityContract())
	configurationID := strings.TrimSpace(request.GetConfigurationId())
	if capabilityContract == "" || configurationID == "" {
		return nil, machineLocalSelectionError(
			codes.InvalidArgument,
			runtimev1.ReasonCode_AI_LOCAL_SELECTION_INVALID,
			"capability_contract and configuration_id are required",
			map[string]string{"capability_contract": capabilityContract, "configuration_id": configurationID},
		)
	}

	s.machineLocalConfigurationMutationMu.Lock()
	defer s.machineLocalConfigurationMutationMu.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	configuration := s.machineLocalConfigurations[configurationID]
	if configuration == nil || configuration.Configuration == nil {
		return nil, machineLocalSelectionError(
			codes.NotFound,
			runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_NOT_FOUND,
			"local capability configuration was not found",
			map[string]string{"capability_contract": capabilityContract, "configuration_id": configurationID},
		)
	}
	if configuration.Configuration.GetCapabilityContract() != capabilityContract {
		return nil, machineLocalSelectionError(
			codes.InvalidArgument,
			runtimev1.ReasonCode_AI_LOCAL_SELECTION_INVALID,
			"selection capability_contract does not match the local capability configuration",
			map[string]string{"capability_contract": capabilityContract, "configuration_id": configurationID},
		)
	}

	selection := &runtimev1.LocalCapabilitySelection{
		CapabilityContract: capabilityContract,
		ConfigurationId:    configurationID,
	}
	nextSelections := s.machineLocalSelectionsReplacingLocked(selection)
	if err := s.machineLocalConfigurationStore.Save(s.machineLocalConfigurationRowsExcludingLocked(""), nextSelections); err != nil {
		return nil, machineLocalConfigurationPersistenceError(err, map[string]string{
			"capability_contract": capabilityContract,
			"configuration_id":    configurationID,
		})
	}
	s.machineLocalSelections[capabilityContract] = cloneLocalCapabilitySelection(selection)
	return &runtimev1.SelectLocalCapabilityConfigurationResponse{Selection: cloneLocalCapabilitySelection(selection)}, nil
}

func (s *Service) ClearLocalCapabilitySelection(
	_ context.Context,
	request *runtimev1.ClearLocalCapabilitySelectionRequest,
) (*runtimev1.ClearLocalCapabilitySelectionResponse, error) {
	capabilityContract := strings.TrimSpace(request.GetCapabilityContract())
	if capabilityContract == "" {
		return nil, machineLocalSelectionError(
			codes.InvalidArgument,
			runtimev1.ReasonCode_AI_LOCAL_SELECTION_INVALID,
			"capability_contract is required",
			nil,
		)
	}

	s.machineLocalConfigurationMutationMu.Lock()
	defer s.machineLocalConfigurationMutationMu.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.machineLocalSelections[capabilityContract] == nil {
		return &runtimev1.ClearLocalCapabilitySelectionResponse{}, nil
	}
	nextSelections := s.machineLocalSelectionsExcludingLocked(capabilityContract, "")
	if err := s.machineLocalConfigurationStore.Save(s.machineLocalConfigurationRowsExcludingLocked(""), nextSelections); err != nil {
		return nil, machineLocalConfigurationPersistenceError(err, map[string]string{"capability_contract": capabilityContract})
	}
	delete(s.machineLocalSelections, capabilityContract)
	return &runtimev1.ClearLocalCapabilitySelectionResponse{}, nil
}

func (s *Service) DeleteLocalCapabilityConfiguration(
	_ context.Context,
	request *runtimev1.DeleteLocalCapabilityConfigurationRequest,
) (*runtimev1.DeleteLocalCapabilityConfigurationResponse, error) {
	configurationID := strings.TrimSpace(request.GetConfigurationId())
	if configurationID == "" {
		return nil, machineLocalSelectionError(
			codes.InvalidArgument,
			runtimev1.ReasonCode_AI_LOCAL_SELECTION_INVALID,
			"configuration_id is required",
			nil,
		)
	}

	s.machineLocalConfigurationMutationMu.Lock()
	defer s.machineLocalConfigurationMutationMu.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.machineLocalConfigurations[configurationID] == nil {
		return nil, machineLocalSelectionError(
			codes.NotFound,
			runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_NOT_FOUND,
			"local capability configuration was not found",
			map[string]string{"configuration_id": configurationID},
		)
	}

	nextRows := s.machineLocalConfigurationRowsExcludingLocked(configurationID)
	nextSelections := s.machineLocalSelectionsExcludingLocked("", configurationID)
	if err := s.machineLocalConfigurationStore.Save(nextRows, nextSelections); err != nil {
		return nil, machineLocalConfigurationPersistenceError(err, map[string]string{"configuration_id": configurationID})
	}
	delete(s.machineLocalConfigurations, configurationID)
	for capabilityContract, selection := range s.machineLocalSelections {
		if selection.GetConfigurationId() == configurationID {
			delete(s.machineLocalSelections, capabilityContract)
		}
	}
	return &runtimev1.DeleteLocalCapabilityConfigurationResponse{}, nil
}

func (s *Service) machineLocalConfigurationRowsExcludingLocked(configurationID string) []*storedLocalCapabilityConfiguration {
	rows := make([]*storedLocalCapabilityConfiguration, 0, len(s.machineLocalConfigurations))
	for id, current := range s.machineLocalConfigurations {
		if id == configurationID {
			continue
		}
		rows = append(rows, cloneStoredLocalCapabilityConfiguration(current))
	}
	return rows
}

func (s *Service) machineLocalSelectionsReplacingLocked(replacement *runtimev1.LocalCapabilitySelection) []*runtimev1.LocalCapabilitySelection {
	selections := s.machineLocalSelectionsExcludingLocked(replacement.GetCapabilityContract(), "")
	selections = append(selections, cloneLocalCapabilitySelection(replacement))
	return selections
}

func (s *Service) machineLocalSelectionsExcludingLocked(capabilityContract, configurationID string) []*runtimev1.LocalCapabilitySelection {
	selections := make([]*runtimev1.LocalCapabilitySelection, 0, len(s.machineLocalSelections))
	for currentCapability, current := range s.machineLocalSelections {
		if currentCapability == capabilityContract || current.GetConfigurationId() == configurationID {
			continue
		}
		selections = append(selections, cloneLocalCapabilitySelection(current))
	}
	return selections
}

func machineLocalConfigurationPersistenceError(cause error, metadata map[string]string) error {
	return grpcerr.WrapWithReasonCode(
		codes.Internal,
		runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_PERSISTENCE_UNAVAILABLE,
		cause,
		grpcerr.ReasonOptions{Message: "Machine Local AI Configuration could not be persisted", Metadata: metadata},
	)
}

func machineLocalSelectionError(code codes.Code, reason runtimev1.ReasonCode, message string, metadata map[string]string) error {
	return grpcerr.WithReasonCodeOptions(code, reason, grpcerr.ReasonOptions{Message: message, Metadata: metadata})
}
