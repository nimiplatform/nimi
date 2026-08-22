package ai

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

const appAIConfigOptionsLimit = 100

// @nimi-authority: rule.nimi.platform.core-protocol.p-caiex-006
func (s *Service) validateChangedAppAIConfigLocalReferences(
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
		local := capability.GetLocal()
		if local == nil {
			continue
		}
		if proto.Equal(currentByCapability[capability.GetCapabilityContract()], capability) {
			continue
		}
		if s.localExecution == nil {
			return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_NOT_CONFIGURED)
		}
		if _, err := s.localExecution.ResolveLocalExecution(
			capability.GetCapabilityContract(),
			local.GetLoadoutRef(),
		); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) projectAppAIConfigEffectiveSelections(
	config *runtimev1.AIConfig,
) []*runtimev1.AIConfigEffectiveSelection {
	result := make([]*runtimev1.AIConfigEffectiveSelection, 0, len(config.GetCapabilities()))
	for _, capability := range config.GetCapabilities() {
		local := capability.GetLocal()
		if local == nil {
			continue
		}
		selection := &runtimev1.AIConfigEffectiveSelection{
			CapabilityContract: capability.GetCapabilityContract(),
		}
		if s == nil || s.localExecution == nil {
			selection.State = runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_UNAVAILABLE
			selection.Reasons = []string{runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_NOT_CONFIGURED.String()}
			result = append(result, selection)
			continue
		}
		resolved, err := s.localExecution.ResolveLocalExecution(capability.GetCapabilityContract(), local.GetLoadoutRef())
		if err != nil {
			selection.State = runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_BLOCKED
			if reason, ok := grpcerr.ExtractReasonCode(err); ok {
				selection.Reasons = []string{reason.String()}
				if reason == runtimev1.ReasonCode_AI_LOADOUT_NOT_FOUND {
					selection.State = runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_MISSING
				}
			} else {
				selection.State = runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_UNAVAILABLE
			}
			result = append(result, selection)
			continue
		}
		selection.State = runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_READY
		selection.Resource = &runtimev1.AIConfigEffectiveSelection_Local{
			Local: projectLocalResourceProjection(localexecution.LoadoutOption{
				LoadoutID: resolved.LoadoutID, DisplayName: resolved.DisplayName,
				CapabilityContract: resolved.CapabilityContract, Implementation: resolved.DriverIdentity,
				SupportedFeatures: resolved.SupportedFeatures,
				ValidationState: runtimev1.LoadoutValidationState_LOADOUT_VALIDATION_STATE_CONFIGURED,
			}),
		}
		result = append(result, selection)
	}
	return result
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
	if req == nil || req.GetLocalLoadouts() == nil {
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
	query := req.GetLocalLoadouts()
	if strings.TrimSpace(query.GetCapabilityContract()) == "" ||
		strings.TrimSpace(query.GetCapabilityContract()) != query.GetCapabilityContract() ||
		strings.TrimSpace(query.GetSearch()) != query.GetSearch() {
		return nil, invalidAppAIConfigError()
	}
	if s == nil || s.localExecution == nil {
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_PERSISTENCE_UNAVAILABLE)
	}
	options, truncated, err := s.localExecution.ListLocalLoadouts(
		query.GetCapabilityContract(),
		query.GetSearch(),
		appAIConfigOptionsLimit,
	)
	if err != nil {
		return nil, err
	}
	projected := make([]*runtimev1.AIConfigLocalResourceProjection, 0, len(options))
	for _, option := range options {
		projected = append(projected, projectLocalResourceProjection(option))
	}
	return &runtimev1.ListAppAIConfigOptionsResponse{
		Result: &runtimev1.ListAppAIConfigOptionsResponse_LocalLoadouts{
			LocalLoadouts: &runtimev1.AIConfigLocalLoadoutOptions{Options: projected},
		},
		Truncated: truncated,
	}, nil
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
		State: state, Reasons: reasons,
	}
}
