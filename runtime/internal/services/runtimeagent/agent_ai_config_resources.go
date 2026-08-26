package runtimeagent

import (
	"context"
	"strconv"
	"strings"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aiconfig"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

const sharedAIConfigOptionsLimit = 100
const sharedPresetVoiceIDMaxRunes = 128
const sharedPresetVoiceNameMaxRunes = 256
const sharedPresetVoiceLangMaxRunes = 64
const sharedPresetVoiceLangsLimit = 32

type sharedLocalAgentPresetVoiceResolver interface {
	ListPresetVoicesForCapturedIntent(context.Context, *runtimev1.ListPresetVoicesRequest) (*runtimev1.ListPresetVoicesResponse, error)
}

func validSharedAIConfigRevision(value string) bool {
	if value == "" || (len(value) > 1 && value[0] == '0') {
		return false
	}
	_, err := strconv.ParseUint(value, 10, 64)
	return err == nil
}

func (s *Service) validateChangedSharedAIConfigResourceReferences(
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
				s.connectorStore, s.modelCatalog, accountNamespace,
				capability.GetCapabilityContract(), cloud.GetImplementation(), connector.RemoteModelCatalogRef{
					ConnectorID: cloud.GetConnectorRef(), Provider: target["provider"].GetStringValue(),
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

func (s *Service) projectSharedAIConfigEffectiveSelections(
	accountNamespace string,
	config *runtimev1.AIConfig,
) []*runtimev1.AIConfigEffectiveSelection {
	result := make([]*runtimev1.AIConfigEffectiveSelection, 0, len(config.GetCapabilities()))
	for _, capability := range config.GetCapabilities() {
		if cloud := capability.GetCloud(); cloud != nil {
			result = append(result, s.projectSharedCloudEffectiveSelection(accountNamespace, capability.GetCapabilityContract(), cloud))
			continue
		}
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
			selection.Reasons = appendSharedReasonOnce(selection.Reasons, runtimev1.ReasonCode_AI_LOCAL_CAPABILITY_MISMATCH.String())
		}
		if option.Implementation != nil && strings.TrimSpace(option.DisplayName) != "" {
			selection.Resource = &runtimev1.AIConfigEffectiveSelection_Local{Local: projectSharedLocalResource(option)}
		}
		result = append(result, selection)
	}
	return result
}

func appendSharedReasonOnce(reasons []string, candidate string) []string {
	for _, reason := range reasons {
		if reason == candidate {
			return reasons
		}
	}
	return append(reasons, candidate)
}

func (s *Service) projectSharedCloudEffectiveSelection(
	accountNamespace string,
	capabilityContract string,
	cloud *runtimev1.AIConfigCloudIntent,
) *runtimev1.AIConfigEffectiveSelection {
	selection := &runtimev1.AIConfigEffectiveSelection{CapabilityContract: capabilityContract}
	if s == nil || s.connectorStore == nil || s.modelCatalog == nil {
		selection.State = runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_UNAVAILABLE
		selection.Reasons = []string{runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String()}
		return selection
	}
	target := cloud.GetProviderModelTarget().GetFields()
	record, _, err := connector.ValidateAIConfigCloudSelection(
		s.connectorStore, s.modelCatalog, accountNamespace, capabilityContract, cloud.GetImplementation(),
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
	option, found, err := s.localExecution.ProjectSelectedLocalLoadout(query.GetCapabilityContract())
	if err != nil {
		return nil, false, err
	}
	projected := make([]*runtimev1.AIConfigLocalResourceProjection, 0, 1)
	search := strings.ToLower(query.GetSearch())
	if found && (search == "" || strings.Contains(strings.ToLower(option.LoadoutID), search) || strings.Contains(strings.ToLower(option.DisplayName), search)) &&
		option.Implementation != nil && strings.TrimSpace(option.DisplayName) != "" {
		projected = append(projected, projectSharedLocalResource(option))
	}
	return projected, false, nil
}

func (s *Service) listSharedAIConfigCloudConnectorOptions(
	accountNamespace string,
	query *runtimev1.AIConfigCloudConnectorOptionsQuery,
) ([]*runtimev1.AIConfigCloudConnectorProjection, bool, error) {
	if query == nil || strings.TrimSpace(query.GetCapabilityContract()) == "" ||
		strings.TrimSpace(query.GetCapabilityContract()) != query.GetCapabilityContract() ||
		strings.TrimSpace(query.GetSearch()) != query.GetSearch() {
		return nil, false, invalidSharedLocalAgentAIConfigError()
	}
	options, truncated, err := connector.ListAIConfigCloudConnectorOptions(
		s.connectorStore, s.modelCatalog, accountNamespace,
		query.GetCapabilityContract(), query.GetSearch(), sharedAIConfigOptionsLimit,
	)
	if err != nil {
		return nil, false, err
	}
	projected := make([]*runtimev1.AIConfigCloudConnectorProjection, 0, len(options))
	for _, option := range options {
		reasons := make([]string, 0, len(option.Reasons))
		for _, reason := range option.Reasons {
			reasons = append(reasons, reason.String())
		}
		projected = append(projected, &runtimev1.AIConfigCloudConnectorProjection{
			ConnectorRef: option.ConnectorRef, Label: option.Label, Provider: option.Provider,
			State: option.State, Reasons: reasons,
		})
	}
	return projected, truncated, nil
}

func (s *Service) listSharedAIConfigCloudTargetOptions(
	accountNamespace string,
	query *runtimev1.AIConfigCloudTargetOptionsQuery,
) ([]*runtimev1.AIConfigCloudTargetProjection, bool, error) {
	if query == nil || strings.TrimSpace(query.GetCapabilityContract()) == "" ||
		strings.TrimSpace(query.GetCapabilityContract()) != query.GetCapabilityContract() ||
		strings.TrimSpace(query.GetConnectorRef()) == "" || strings.TrimSpace(query.GetConnectorRef()) != query.GetConnectorRef() ||
		strings.TrimSpace(query.GetSearch()) != query.GetSearch() {
		return nil, false, invalidSharedLocalAgentAIConfigError()
	}
	options, truncated, err := connector.ListAIConfigCloudTargetOptions(
		s.connectorStore, s.modelCatalog, accountNamespace,
		query.GetCapabilityContract(), query.GetConnectorRef(), query.GetSearch(), sharedAIConfigOptionsLimit,
	)
	if err != nil {
		return nil, false, err
	}
	projected := make([]*runtimev1.AIConfigCloudTargetProjection, 0, len(options))
	for _, option := range options {
		implementation, _ := proto.Clone(option.Implementation).(*runtimev1.CapabilityImplementationIdentity)
		target, _ := proto.Clone(option.ProviderTarget).(*structpb.Struct)
		reasons := make([]string, 0, len(option.Reasons))
		for _, reason := range option.Reasons {
			reasons = append(reasons, reason.String())
		}
		projected = append(projected, &runtimev1.AIConfigCloudTargetProjection{
			ConnectorRef: option.ConnectorRef, Label: option.Label, CapabilityContract: option.Capability,
			Implementation: implementation, ProviderModelTarget: target,
			SupportedFeatures: append([]string(nil), option.SupportedFeatures...), State: option.State, Reasons: reasons,
		})
	}
	return projected, truncated, nil
}

// @nimi-authority: rule.nimi.runtime.agent-participation.r169
// @nimi-authority: rule.nimi.runtime.model-catalog.r050
func (s *Service) listSharedAIConfigPresetVoiceOptions(
	ctx context.Context,
	accountNamespace string,
	appID string,
) (*runtimev1.SharedLocalAgentPresetVoiceOptions, bool, error) {
	config, err := s.requireSharedLocalAgentAIConfig(ctx, accountNamespace)
	if err != nil {
		return nil, false, err
	}
	capability := sharedLocalAgentCapabilityIntent(config, runtimeAgentAIConfigCapabilityAudioSynthesize)
	if capability == nil {
		return nil, false, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
	}
	intent, err := executionintent.FromCapability(capability)
	if err != nil || (!intent.IsLocal() && !intent.IsAIConfigCloud()) {
		return nil, false, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
	}
	if s == nil || s.sharedPresetVoices == nil {
		return nil, false, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	capturedCtx := executionintent.WithIntent(ctx, intent)
	response, err := s.sharedPresetVoices.ListPresetVoicesForCapturedIntent(capturedCtx, &runtimev1.ListPresetVoicesRequest{
		AppId: strings.TrimSpace(appID), SubjectUserId: strings.TrimSpace(accountNamespace),
	})
	if err != nil {
		return nil, false, err
	}
	voices := response.GetVoices()
	truncated := len(voices) > sharedAIConfigOptionsLimit
	if truncated {
		voices = voices[:sharedAIConfigOptionsLimit]
	}
	options := make([]*runtimev1.SharedLocalAgentPresetVoiceOption, 0, len(voices))
	for _, voice := range voices {
		if voice == nil || !validSharedPresetVoiceText(voice.GetVoiceId(), sharedPresetVoiceIDMaxRunes) ||
			!validSharedPresetVoiceText(voice.GetName(), sharedPresetVoiceNameMaxRunes) ||
			len(voice.GetSupportedLangs()) > sharedPresetVoiceLangsLimit {
			return nil, false, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
		}
		langs := make([]string, 0, len(voice.GetSupportedLangs()))
		for _, lang := range voice.GetSupportedLangs() {
			if !validSharedPresetVoiceText(lang, sharedPresetVoiceLangMaxRunes) {
				return nil, false, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
			}
			langs = append(langs, lang)
		}
		options = append(options, &runtimev1.SharedLocalAgentPresetVoiceOption{
			VoiceId: voice.GetVoiceId(), Name: voice.GetName(), SupportedLangs: langs,
		})
	}
	return &runtimev1.SharedLocalAgentPresetVoiceOptions{Options: options}, truncated, nil
}

func validSharedPresetVoiceText(value string, maxRunes int) bool {
	return value != "" && strings.TrimSpace(value) == value && utf8.ValidString(value) && utf8.RuneCountInString(value) <= maxRunes
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
