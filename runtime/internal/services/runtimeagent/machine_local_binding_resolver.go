package runtimeagent

import (
	"context"
	"path/filepath"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"google.golang.org/grpc/codes"
)

type selectedLocalMachineExecutionBindingResolver struct {
	owner  *Service
	source localexecution.Resolver
}

// SetMachineLocalExecutionResolver wires the machine-configuration owner into
// Runtime Agent's private execution-binding seam. It does not expose the
// selected configuration through a public RPC payload.
func (s *Service) SetMachineLocalExecutionResolver(source localexecution.Resolver) {
	if s == nil || s.isClosed() {
		return
	}
	if source == nil {
		s.setMachineExecutionBindingResolver(nil)
		return
	}
	s.setMachineExecutionBindingResolver(&selectedLocalMachineExecutionBindingResolver{owner: s, source: source})
}

func (s *Service) HasMachineExecutionBindingResolver() bool {
	if s == nil || s.isClosed() {
		return false
	}
	s.machineExecutionBindingMu.RLock()
	configured := s.machineExecutionBindingResolver != nil
	s.machineExecutionBindingMu.RUnlock()
	return configured
}

func (r *selectedLocalMachineExecutionBindingResolver) ResolveMachineExecutionBindings(
	ctx context.Context,
	accountNamespace string,
) (publicChatExecutionBindings, error) {
	if r == nil || r.owner == nil || r.source == nil {
		return nil, unresolvedSharedAIConfigExecutionBindingError()
	}
	accountNamespace = strings.TrimSpace(accountNamespace)
	if accountNamespace == "" {
		return nil, machineExecutionAccountError("machine execution binding requires an account namespace")
	}
	provider := r.owner.runtimeAccountProjection
	if provider == nil {
		return nil, machineExecutionAccountError("machine execution binding account namespace does not match the authenticated Runtime account")
	}
	projection, ok := provider.AuthenticatedRuntimeProjection(ctx)
	if !ok || projection == nil || strings.TrimSpace(projection.GetAccountId()) != accountNamespace {
		return nil, machineExecutionAccountError("machine execution binding account namespace does not match the authenticated Runtime account")
	}

	contracts := r.source.SelectedLocalCapabilityContracts()
	if len(contracts) == 0 {
		return nil, machineExecutionProjectionError(
			runtimev1.ReasonCode_AI_LOCAL_SELECTION_NOT_FOUND,
			"no local capability configuration is selected",
			nil,
		)
	}
	bindings := make(publicChatExecutionBindings, len(contracts))
	seen := make(map[string]struct{}, len(contracts))
	for _, capabilityContract := range contracts {
		capabilityContract = strings.TrimSpace(capabilityContract)
		if capabilityContract == "" {
			return nil, machineExecutionProjectionError(
				runtimev1.ReasonCode_AI_LOCAL_SELECTION_INVALID,
				"machine selection returned an invalid capability contract",
				nil,
			)
		}
		if _, exists := seen[capabilityContract]; exists {
			return nil, machineExecutionProjectionError(
				runtimev1.ReasonCode_AI_LOCAL_SELECTION_INVALID,
				"machine selection returned a duplicate capability contract",
				map[string]string{"capability_contract": capabilityContract},
			)
		}
		seen[capabilityContract] = struct{}{}

		selected, err := r.source.ResolveSelectedLocalExecution(capabilityContract)
		if err != nil {
			return nil, err
		}
		if !validSelectedLocalExecutionProjection(selected, capabilityContract) {
			return nil, machineExecutionProjectionError(
				runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_NOT_CONFIGURED,
				"selected local execution projection is incomplete",
				map[string]string{"capability_contract": capabilityContract},
			)
		}
		configurationID := strings.TrimSpace(selected.ConfigurationID)
		modelID := strings.TrimSpace(selected.DisplayName)
		if modelID == "" {
			modelID = configurationID
		}
		bindings[capabilityContract] = publicChatExecutionBinding{
			BindingAlias: configurationID,
			ModelID:      modelID,
			RoutePolicy:  runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			TargetRef: &runtimev1.RuntimeDurableTargetRef{
				Target: &runtimev1.RuntimeDurableTargetRef_LocalRuntime{
					LocalRuntime: &runtimev1.RuntimeDurableLocalTargetRef{
						Version: "v2",
						Ref: &runtimev1.RuntimeDurableLocalTargetRef_ProfileBindingId{
							ProfileBindingId: configurationID,
						},
					},
				},
			},
			SelectedParams: clonePublicChatSelectedParams(selected.PortableConfig),
		}
	}
	return bindings, nil
}

func validSelectedLocalExecutionProjection(selected *localexecution.SelectedLocalExecution, capabilityContract string) bool {
	if selected == nil || !selected.Configured ||
		selected.ConfigurationID == "" || selected.ConfigurationID != strings.TrimSpace(selected.ConfigurationID) ||
		selected.CapabilityContract != capabilityContract ||
		selected.DriverIdentity == nil ||
		selected.DriverIdentity.GetImplementationId() == "" || selected.DriverIdentity.GetImplementationId() != strings.TrimSpace(selected.DriverIdentity.GetImplementationId()) ||
		selected.DriverIdentity.GetDriverId() == "" || selected.DriverIdentity.GetDriverId() != strings.TrimSpace(selected.DriverIdentity.GetDriverId()) ||
		selected.DriverIdentity.GetDriverDialect() == "" || selected.DriverIdentity.GetDriverDialect() != strings.TrimSpace(selected.DriverIdentity.GetDriverDialect()) ||
		len(selected.Requirements) == 0 || len(selected.ExactBindings) != len(selected.Requirements) {
		return false
	}
	requirements := make(map[string]struct{}, len(selected.Requirements))
	for _, requirement := range selected.Requirements {
		requirementID := strings.TrimSpace(requirement.GetRequirementId())
		if requirementID == "" || requirement.GetRequirementId() != requirementID {
			return false
		}
		if _, exists := requirements[requirementID]; exists {
			return false
		}
		requirements[requirementID] = struct{}{}
	}
	bound := make(map[string]struct{}, len(selected.ExactBindings))
	for _, binding := range selected.ExactBindings {
		if binding.RequirementID == "" || binding.RequirementID != strings.TrimSpace(binding.RequirementID) {
			return false
		}
		if _, exists := requirements[binding.RequirementID]; !exists ||
			binding.LocalAssetID == "" || binding.LocalAssetID != strings.TrimSpace(binding.LocalAssetID) ||
			!filepath.IsAbs(binding.AbsolutePath) || binding.AbsolutePath != filepath.Clean(binding.AbsolutePath) ||
			binding.VerifiedContentID == "" || binding.VerifiedContentID != strings.TrimSpace(binding.VerifiedContentID) ||
			binding.EntrySHA256 == "" || binding.EntrySHA256 != strings.TrimSpace(binding.EntrySHA256) {
			return false
		}
		if _, exists := bound[binding.RequirementID]; exists {
			return false
		}
		bound[binding.RequirementID] = struct{}{}
	}
	return len(bound) == len(requirements)
}

func machineExecutionAccountError(message string) error {
	return grpcerr.WithReasonCodeOptions(
		codes.PermissionDenied,
		runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED,
		grpcerr.ReasonOptions{Message: message},
	)
}

func machineExecutionProjectionError(reason runtimev1.ReasonCode, message string, metadata map[string]string) error {
	return grpcerr.WithReasonCodeOptions(
		codes.FailedPrecondition,
		reason,
		grpcerr.ReasonOptions{Message: message, Metadata: metadata},
	)
}
