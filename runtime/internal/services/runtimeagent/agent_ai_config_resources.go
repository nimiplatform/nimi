package runtimeagent

import (
	"context"
	"strconv"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aiconfig"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

const sharedAIConfigOptionsLimit = 100

func validSharedAIConfigRevision(value string) bool {
	if value == "" || (len(value) > 1 && value[0] == '0') {
		return false
	}
	_, err := strconv.ParseUint(value, 10, 64)
	return err == nil
}

func (s *Service) validateChangedSharedAIConfigLocalReferences(
	ctx context.Context,
	accountNamespace string,
	candidate *runtimev1.AIConfig,
) error {
	current, _, found, err := s.aiConfigStore.Get(ctx, accountNamespace, aiconfig.LocalAgentSubsystemOwner())
	if err != nil {
		return sharedLocalAgentAIConfigPersistenceError(err)
	}
	currentByCapability := make(map[string]*runtimev1.AIConfigCapabilityIntent)
	if found {
		for _, capability := range current.GetCapabilities() {
			currentByCapability[capability.GetCapabilityContract()] = capability
		}
	}
	for _, capability := range candidate.GetCapabilities() {
		local := capability.GetLocal()
		if local == nil || proto.Equal(currentByCapability[capability.GetCapabilityContract()], capability) {
			continue
		}
		if s.localExecution == nil {
			return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_NOT_CONFIGURED)
		}
		if _, err := s.localExecution.ResolveLocalExecution(capability.GetCapabilityContract(), local.GetLoadoutRef()); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) projectSharedAIConfigEffectiveSelections(
	config *runtimev1.AIConfig,
) []*runtimev1.AIConfigEffectiveSelection {
	result := make([]*runtimev1.AIConfigEffectiveSelection, 0, len(config.GetCapabilities()))
	for _, capability := range config.GetCapabilities() {
		local := capability.GetLocal()
		if local == nil {
			continue
		}
		selection := &runtimev1.AIConfigEffectiveSelection{CapabilityContract: capability.GetCapabilityContract()}
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
		selection.Resource = &runtimev1.AIConfigEffectiveSelection_Local{Local: projectSharedLocalResource(localexecution.LoadoutOption{
			LoadoutID: resolved.LoadoutID, DisplayName: resolved.DisplayName,
			CapabilityContract: resolved.CapabilityContract, Implementation: resolved.DriverIdentity,
			SupportedFeatures: resolved.SupportedFeatures,
			ValidationState:   runtimev1.LoadoutValidationState_LOADOUT_VALIDATION_STATE_CONFIGURED,
		})}
		result = append(result, selection)
	}
	return result
}

func (s *Service) listSharedAIConfigLocalOptions(
	query *runtimev1.AIConfigLocalLoadoutOptionsQuery,
) ([]*runtimev1.AIConfigLocalResourceProjection, bool, error) {
	if query == nil || strings.TrimSpace(query.GetCapabilityContract()) == "" ||
		strings.TrimSpace(query.GetCapabilityContract()) != query.GetCapabilityContract() ||
		strings.TrimSpace(query.GetSearch()) != query.GetSearch() {
		return nil, false, invalidSharedLocalAgentAIConfigError()
	}
	if s == nil || s.localExecution == nil {
		return nil, false, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_PERSISTENCE_UNAVAILABLE)
	}
	options, truncated, err := s.localExecution.ListLocalLoadouts(query.GetCapabilityContract(), query.GetSearch(), sharedAIConfigOptionsLimit)
	if err != nil {
		return nil, false, err
	}
	projected := make([]*runtimev1.AIConfigLocalResourceProjection, 0, len(options))
	for _, option := range options {
		projected = append(projected, projectSharedLocalResource(option))
	}
	return projected, truncated, nil
}

func projectSharedLocalResource(option localexecution.LoadoutOption) *runtimev1.AIConfigLocalResourceProjection {
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
