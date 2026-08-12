package runtimeagent

import (
	"context"
	"path/filepath"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/runtimeidentity"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/structpb"
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
	capabilityContracts []string,
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

	config, err := r.owner.requireSharedLocalAgentAIConfig(ctx, accountNamespace)
	if err != nil {
		return nil, err
	}
	intents := config.GetCapabilities()
	if len(capabilityContracts) > 0 {
		byContract := make(map[string]*runtimev1.AIConfigCapabilityIntent, len(intents))
		for _, intent := range intents {
			if capabilityContract := strings.TrimSpace(intent.GetCapabilityContract()); capabilityContract != "" {
				byContract[capabilityContract] = intent
			}
		}
		scoped := make([]*runtimev1.AIConfigCapabilityIntent, 0, len(capabilityContracts))
		seen := make(map[string]struct{}, len(capabilityContracts))
		for _, capabilityContract := range capabilityContracts {
			capabilityContract = strings.TrimSpace(capabilityContract)
			if capabilityContract == "" {
				return nil, machineExecutionProjectionError(runtimev1.ReasonCode_AI_CONFIG_INVALID, "machine execution capability scope is invalid", nil)
			}
			if _, duplicate := seen[capabilityContract]; duplicate {
				continue
			}
			seen[capabilityContract] = struct{}{}
			if intent := byContract[capabilityContract]; intent != nil {
				scoped = append(scoped, intent)
			}
		}
		intents = scoped
	}
	bindings := make(publicChatExecutionBindings, len(intents))
	for _, intent := range intents {
		capabilityContract := strings.TrimSpace(intent.GetCapabilityContract())
		if capabilityContract == "" {
			continue
		}
		if intent.GetCloud() != nil {
			binding, err := r.resolveCloudMachineExecutionBinding(accountNamespace, intent)
			if err != nil {
				return nil, err
			}
			bindings[capabilityContract] = binding
			continue
		}
		if intent.GetLocal() == nil {
			continue
		}
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
			BindingAlias:       configurationID,
			ModelID:            modelID,
			RoutePolicy:        runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			CapabilityContract: capabilityContract,
			RequiredFeatures:   append([]string(nil), intent.GetRequiredFeatures()...),
			ExecutionIntent: executionintent.Intent{
				CapabilityContract: capabilityContract, RequiredFeatures: append([]string(nil), intent.GetRequiredFeatures()...),
				Defaults: clonePublicChatSelectedParams(intent.GetDefaults()), Route: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			},
			LocalAIConfigIntent: true,
			LocalExecution:      localexecution.CloneSelectedLocalExecution(selected),
			SelectedParams:      clonePublicChatSelectedParams(intent.GetDefaults()),
		}
	}
	if len(bindings) == 0 && len(capabilityContracts) == 0 {
		return nil, machineExecutionProjectionError(
			runtimev1.ReasonCode_AI_LOCAL_CAPABILITY_MISMATCH,
			"shared LocalAgent AIConfig has no executable capability intent",
			nil,
		)
	}
	return bindings, nil
}

func (r *selectedLocalMachineExecutionBindingResolver) resolveCloudMachineExecutionBinding(
	accountNamespace string,
	capability *runtimev1.AIConfigCapabilityIntent,
) (publicChatExecutionBinding, error) {
	intent, err := executionintent.FromCapability(capability)
	if err != nil || !intent.IsAIConfigCloud() {
		return publicChatExecutionBinding{}, machineExecutionProjectionError(runtimev1.ReasonCode_AI_CONFIG_INVALID, "Cloud AIConfig execution intent is invalid", nil)
	}
	provider, providerOK := machineCloudTargetText(intent.ProviderModelTarget, "provider")
	providerModelID, providerModelPresent := machineCloudTargetText(intent.ProviderModelTarget, "providerModelId")
	legacyModelID, legacyModelPresent := machineCloudTargetText(intent.ProviderModelTarget, "model")
	if providerModelPresent && legacyModelPresent && providerModelID != legacyModelID {
		return publicChatExecutionBinding{}, machineExecutionProjectionError(runtimev1.ReasonCode_AI_CONFIG_INVALID, "Cloud AIConfig provider model identities conflict", nil)
	}
	modelOK := providerModelPresent || legacyModelPresent
	if !providerModelPresent {
		providerModelID = legacyModelID
	}
	remoteCatalogID, catalogOK := machineCloudTargetText(intent.ProviderModelTarget, "remoteModelCatalogId")
	if !providerOK || !modelOK || !catalogOK {
		return publicChatExecutionBinding{}, machineExecutionProjectionError(runtimev1.ReasonCode_AI_CONFIG_INVALID, "Cloud AIConfig target is incomplete", nil)
	}
	connectorRecord, binding, err := connector.ResolveCurrentAccountConnectorBinding(r.owner.connectorStore, r.owner.modelCatalog, accountNamespace, connector.RemoteModelCatalogRef{
		RemoteModelCatalogID: remoteCatalogID,
		ProviderModelID:      providerModelID,
		Provider:             provider,
	})
	if err != nil {
		reason := runtimev1.ReasonCode_AI_PROVIDER_INTERNAL
		if extracted, ok := grpcerr.ExtractReasonCode(err); ok {
			reason = extracted
		}
		return publicChatExecutionBinding{}, machineExecutionProjectionError(reason, "Cloud AIConfig current-account Connector is not executable", nil)
	}
	if binding == nil {
		return publicChatExecutionBinding{}, machineExecutionProjectionError(runtimev1.ReasonCode_AI_CONFIG_INVALID, "Cloud AIConfig catalog target is incomplete", nil)
	}
	target := &runtimeidentity.Target{Cloud: &runtimeidentity.CloudTarget{
		ConnectorID: connectorRecord.ConnectorID, RemoteModelCatalogID: binding.RemoteModelCatalogID,
		ProviderModelID: providerModelID, Provider: provider,
	}}
	if !target.Valid() {
		return publicChatExecutionBinding{}, machineExecutionProjectionError(runtimev1.ReasonCode_AI_CONFIG_INVALID, "Cloud AIConfig target is incomplete", nil)
	}
	return publicChatExecutionBinding{
		BindingAlias: strings.TrimSpace(intent.CloudImplementation.GetImplementationId()), ModelID: providerModelID,
		RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD, ConnectorID: connectorRecord.ConnectorID, TargetRef: target,
		ExecutionIntent: executionintent.Clone(intent), SelectedParams: clonePublicChatSelectedParams(intent.Defaults),
		CapabilityContract: intent.CapabilityContract, RequiredFeatures: append([]string(nil), intent.RequiredFeatures...),
	}, nil
}

func machineCloudTargetText(target *structpb.Struct, key string) (string, bool) {
	if target == nil {
		return "", false
	}
	value := target.GetFields()[key]
	if value == nil {
		return "", false
	}
	if _, ok := value.GetKind().(*structpb.Value_StringValue); !ok {
		return "", false
	}
	text := strings.TrimSpace(value.GetStringValue())
	return text, text != "" && text == value.GetStringValue()
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
