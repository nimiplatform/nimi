package ai

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

const appAIConfigOptionsLimit = 100

// @nimi-authority: rule.nimi.platform.core-protocol.p-caiex-006
func (s *Service) validateChangedAppAIConfigResourceReferences(
	ctx context.Context,
	accountNamespace string,
	owner *runtimev1.AIConfigOwner,
	candidate *runtimev1.AIConfig,
) error {
	current, _, found, err := s.aiConfigStore.Get(ctx, accountNamespace, owner)
	if err != nil {
		return appAIConfigPersistenceError(err)
	}
	currentByCapability := make(map[string]*runtimev1.AIConfigCapabilityIntent)
	if found {
		for _, capability := range current.GetCapabilities() {
			currentByCapability[capability.GetCapabilityContract()] = capability
		}
	}
	for _, capability := range candidate.GetCapabilities() {
		if proto.Equal(currentByCapability[capability.GetCapabilityContract()], capability) {
			continue
		}
		if capability.GetLocal() != nil {
			// Local intent is route-only. Current machine selection is validated
			// independently by effective projection and Job admission.
			continue
		}
		if cloud := capability.GetCloud(); cloud != nil {
			target := cloud.GetProviderModelTarget().GetFields()
			if _, _, err := connector.ValidateAIConfigCloudSelection(
				s.connStore, s.speechCatalog, accountNamespace,
				capability.GetCapabilityContract(), cloud.GetImplementation(),
				connector.RemoteModelCatalogRef{
					ConnectorID:          cloud.GetConnectorRef(),
					Provider:             target["provider"].GetStringValue(),
					ProviderModelID:      target["providerModelId"].GetStringValue(),
					RemoteModelCatalogID: target["remoteModelCatalogId"].GetStringValue(),
				},
			); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Service) projectAppAIConfigEffectiveSelections(
	accountNamespace string,
	config *runtimev1.AIConfig,
) []*runtimev1.AIConfigEffectiveSelection {
	result := make([]*runtimev1.AIConfigEffectiveSelection, 0, len(config.GetCapabilities()))
	for _, capability := range config.GetCapabilities() {
		if cloud := capability.GetCloud(); cloud != nil {
			result = append(result, s.projectCloudEffectiveSelection(accountNamespace, capability.GetCapabilityContract(), cloud))
			continue
		}
		local := capability.GetLocal()
		selection := &runtimev1.AIConfigEffectiveSelection{
			CapabilityContract: capability.GetCapabilityContract(),
		}
		if local == nil {
			continue
		}
		if s == nil || s.localExecution == nil {
			selection.State = runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_UNAVAILABLE
			selection.Reasons = []string{runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_NOT_CONFIGURED.String()}
			result = append(result, selection)
			continue
		}
		option, found, err := s.localExecution.ProjectSelectedLocalLoadout(capability.GetCapabilityContract())
		if err != nil {
			selection.State = runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_UNAVAILABLE
			if reason, ok := grpcerr.ExtractReasonCode(err); ok {
				selection.Reasons = []string{reason.String()}
			}
			result = append(result, selection)
			continue
		}
		if !found {
			selection.State = runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_MISSING
			selection.Reasons = []string{runtimev1.ReasonCode_AI_LOCAL_SELECTION_NOT_FOUND.String()}
			result = append(result, selection)
			continue
		}
		selection.State = runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_BLOCKED
		for _, reason := range option.Reasons {
			selection.Reasons = append(selection.Reasons, reason.String())
			if reason == runtimev1.ReasonCode_AI_LOADOUT_NOT_FOUND {
				selection.State = runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_MISSING
			}
		}
		if option.ValidationState == runtimev1.LoadoutValidationState_LOADOUT_VALIDATION_STATE_CONFIGURED {
			selection.State = runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_READY
		}
		if selection.State != runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_MISSING &&
			!localexecution.SupportsRequiredFeatures(capability.GetRequiredFeatures(), option.SupportedFeatures) {
			selection.State = runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_BLOCKED
			selection.Reasons = appendReasonStringOnce(selection.Reasons, runtimev1.ReasonCode_AI_LOCAL_CAPABILITY_MISMATCH.String())
		}
		if option.Implementation != nil && strings.TrimSpace(option.DisplayName) != "" {
			selection.Resource = &runtimev1.AIConfigEffectiveSelection_Local{Local: projectLocalResourceProjection(option)}
		}
		result = append(result, selection)
	}
	return result
}

func appendReasonStringOnce(reasons []string, candidate string) []string {
	for _, reason := range reasons {
		if reason == candidate {
			return reasons
		}
	}
	return append(reasons, candidate)
}

func (s *Service) projectCloudEffectiveSelection(
	accountNamespace string,
	capabilityContract string,
	cloud *runtimev1.AIConfigCloudIntent,
) *runtimev1.AIConfigEffectiveSelection {
	selection := &runtimev1.AIConfigEffectiveSelection{CapabilityContract: capabilityContract}
	if s == nil || s.connStore == nil || s.speechCatalog == nil {
		selection.State = runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_UNAVAILABLE
		selection.Reasons = []string{runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String()}
		return selection
	}
	target := cloud.GetProviderModelTarget().GetFields()
	record, _, err := connector.ValidateAIConfigCloudSelection(
		s.connStore, s.speechCatalog, accountNamespace, capabilityContract, cloud.GetImplementation(),
		connector.RemoteModelCatalogRef{
			ConnectorID: cloud.GetConnectorRef(), Provider: target["provider"].GetStringValue(),
			ProviderModelID:      target["providerModelId"].GetStringValue(),
			RemoteModelCatalogID: target["remoteModelCatalogId"].GetStringValue(),
		},
	)
	if err != nil {
		selection.State = connector.AIConfigEffectiveFailureState(err)
		if reason, ok := grpcerr.ExtractReasonCode(err); ok {
			selection.Reasons = []string{reason.String()}
		}
		return selection
	}
	implementation, _ := proto.Clone(cloud.GetImplementation()).(*runtimev1.CapabilityImplementationIdentity)
	providerTarget, _ := proto.Clone(cloud.GetProviderModelTarget()).(*structpb.Struct)
	label := strings.TrimSpace(record.Label)
	if label == "" {
		label = strings.TrimSpace(record.Provider)
	}
	selection.State = runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_READY
	selection.Resource = &runtimev1.AIConfigEffectiveSelection_Cloud{Cloud: &runtimev1.AIConfigCloudResourceProjection{
		Connector: &runtimev1.AIConfigCloudConnectorProjection{
			ConnectorRef: cloud.GetConnectorRef(), Label: label, Provider: record.Provider,
			State: runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_READY,
		},
		Target: &runtimev1.AIConfigCloudTargetProjection{
			ConnectorRef: cloud.GetConnectorRef(), Label: target["providerModelId"].GetStringValue(),
			CapabilityContract: capabilityContract, Implementation: implementation,
			ProviderModelTarget: providerTarget, State: runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_READY,
		},
	}}
	return selection
}

// @nimi-authority: definition.nimi.platform.core-protocol.app-operation-contract
func (s *Service) ListAppAIConfigOptions(
	ctx context.Context,
	req *runtimev1.ListAppAIConfigOptionsRequest,
) (*runtimev1.ListAppAIConfigOptionsResponse, error) {
	caller, err := authenticatedAppAIConfigCaller(ctx)
	if err != nil {
		return nil, err
	}
	if req == nil || req.GetQuery() == nil {
		return nil, invalidAppAIConfigError()
	}
	if _, err := s.appAIConfigOwnerForCaller(
		ctx,
		caller,
		req.GetOwner(),
		accountservice.LocalAppOperationAppAIConfigOptionsList,
	); err != nil {
		return nil, err
	}
	switch query := req.GetQuery().(type) {
	case *runtimev1.ListAppAIConfigOptionsRequest_LocalLoadouts:
		if !validAIConfigOptionsText(query.LocalLoadouts.GetCapabilityContract(), false) ||
			!validAIConfigOptionsText(query.LocalLoadouts.GetSearch(), true) {
			return nil, invalidAppAIConfigError()
		}
		if s == nil || s.localExecution == nil {
			return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_PERSISTENCE_UNAVAILABLE)
		}
		option, found, err := s.localExecution.ProjectSelectedLocalLoadout(query.LocalLoadouts.GetCapabilityContract())
		if err != nil {
			return nil, err
		}
		projected := make([]*runtimev1.AIConfigLocalResourceProjection, 0, 1)
		search := strings.ToLower(query.LocalLoadouts.GetSearch())
		if found && (search == "" || strings.Contains(strings.ToLower(option.LoadoutID), search) || strings.Contains(strings.ToLower(option.DisplayName), search)) &&
			option.Implementation != nil && strings.TrimSpace(option.DisplayName) != "" {
			projected = append(projected, projectLocalResourceProjection(option))
		}
		return &runtimev1.ListAppAIConfigOptionsResponse{
			Result:    &runtimev1.ListAppAIConfigOptionsResponse_LocalLoadouts{LocalLoadouts: &runtimev1.AIConfigLocalLoadoutOptions{Options: projected}},
			Truncated: false,
		}, nil
	case *runtimev1.ListAppAIConfigOptionsRequest_CloudConnectors:
		cloudQuery := query.CloudConnectors
		if !validAIConfigOptionsText(cloudQuery.GetCapabilityContract(), false) || !validAIConfigOptionsText(cloudQuery.GetSearch(), true) {
			return nil, invalidAppAIConfigError()
		}
		options, truncated, err := connector.ListAIConfigCloudConnectorOptions(
			s.connStore, s.speechCatalog, caller.accountNamespace,
			cloudQuery.GetCapabilityContract(), cloudQuery.GetSearch(), appAIConfigOptionsLimit,
		)
		if err != nil {
			return nil, err
		}
		projected := make([]*runtimev1.AIConfigCloudConnectorProjection, 0, len(options))
		for _, option := range options {
			projected = append(projected, projectCloudConnectorOption(option))
		}
		return &runtimev1.ListAppAIConfigOptionsResponse{
			Result:    &runtimev1.ListAppAIConfigOptionsResponse_CloudConnectors{CloudConnectors: &runtimev1.AIConfigCloudConnectorOptions{Options: projected}},
			Truncated: truncated,
		}, nil
	case *runtimev1.ListAppAIConfigOptionsRequest_CloudTargets:
		cloudQuery := query.CloudTargets
		if !validAIConfigOptionsText(cloudQuery.GetCapabilityContract(), false) || !validAIConfigOptionsText(cloudQuery.GetConnectorRef(), false) ||
			!validAIConfigOptionsText(cloudQuery.GetSearch(), true) {
			return nil, invalidAppAIConfigError()
		}
		options, truncated, err := connector.ListAIConfigCloudTargetOptions(
			s.connStore, s.speechCatalog, caller.accountNamespace,
			cloudQuery.GetCapabilityContract(), cloudQuery.GetConnectorRef(), cloudQuery.GetSearch(), appAIConfigOptionsLimit,
		)
		if err != nil {
			return nil, err
		}
		projected := make([]*runtimev1.AIConfigCloudTargetProjection, 0, len(options))
		for _, option := range options {
			projected = append(projected, projectCloudTargetOption(option))
		}
		return &runtimev1.ListAppAIConfigOptionsResponse{
			Result:    &runtimev1.ListAppAIConfigOptionsResponse_CloudTargets{CloudTargets: &runtimev1.AIConfigCloudTargetOptions{Options: projected}},
			Truncated: truncated,
		}, nil
	default:
		return nil, invalidAppAIConfigError()
	}
}

func validAIConfigOptionsText(value string, allowEmpty bool) bool {
	return strings.TrimSpace(value) == value && (allowEmpty || value != "")
}

func projectCloudConnectorOption(option connector.AIConfigCloudConnectorOption) *runtimev1.AIConfigCloudConnectorProjection {
	reasons := make([]string, 0, len(option.Reasons))
	for _, reason := range option.Reasons {
		reasons = append(reasons, reason.String())
	}
	return &runtimev1.AIConfigCloudConnectorProjection{
		ConnectorRef: option.ConnectorRef, Label: option.Label, Provider: option.Provider,
		State: option.State, Reasons: reasons,
	}
}

func projectCloudTargetOption(option connector.AIConfigCloudTargetOption) *runtimev1.AIConfigCloudTargetProjection {
	implementation, _ := proto.Clone(option.Implementation).(*runtimev1.CapabilityImplementationIdentity)
	target, _ := proto.Clone(option.ProviderTarget).(*structpb.Struct)
	reasons := make([]string, 0, len(option.Reasons))
	for _, reason := range option.Reasons {
		reasons = append(reasons, reason.String())
	}
	return &runtimev1.AIConfigCloudTargetProjection{
		ConnectorRef: option.ConnectorRef, Label: option.Label, CapabilityContract: option.Capability,
		Implementation: implementation, ProviderModelTarget: target,
		SupportedFeatures: append([]string(nil), option.SupportedFeatures...), State: option.State, Reasons: reasons,
	}
}

func projectLocalResourceProjection(option localexecution.LoadoutOption) *runtimev1.AIConfigLocalResourceProjection {
	implementation, _ := proto.Clone(option.Implementation).(*runtimev1.CapabilityImplementationIdentity)
	state := runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_BLOCKED
	if option.ValidationState == runtimev1.LoadoutValidationState_LOADOUT_VALIDATION_STATE_CONFIGURED {
		state = runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_READY
	}
	reasons := make([]string, 0, len(option.Reasons))
	for _, reason := range option.Reasons {
		reasons = append(reasons, reason.String())
	}
	return &runtimev1.AIConfigLocalResourceProjection{
		LoadoutRef: option.LoadoutID, Label: option.DisplayName,
		CapabilityContract: option.CapabilityContract, Implementation: implementation,
		SupportedFeatures: append([]string(nil), option.SupportedFeatures...),
		State:             state, Reasons: reasons,
	}
}
