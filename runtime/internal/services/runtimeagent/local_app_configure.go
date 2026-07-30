package runtimeagent

import (
	"context"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aicapabilities"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const localAppRouteOptionLimit = 512

type localAppRouteOptionInventory interface {
	ListLocalAssets(context.Context, *runtimev1.ListLocalAssetsRequest) (*runtimev1.ListLocalAssetsResponse, error)
}

func (s *Service) SetLocalAppRouteOptionInventory(inventory localAppRouteOptionInventory) {
	if s == nil {
		return
	}
	s.localAppRouteOptionsMu.Lock()
	s.localAppRouteOptions = inventory
	s.localAppRouteOptionsMu.Unlock()
}

func localAppConfigurePermissionFailure(reason runtimev1.ReasonCode, permissionReason string) error {
	metadata := map[string]string{"permission_id": "agents.configure"}
	if permissionReason != "" {
		metadata["permission_reason"] = permissionReason
	}
	return grpcerr.WithReasonCodeOptions(codes.PermissionDenied, reason, grpcerr.ReasonOptions{Metadata: metadata})
}

func (s *Service) authorizedLocalAppConfigureAgent(ctx context.Context, operation accountservice.LocalAppOperation, handle string) (accountservice.LocalAppCallerDecision, *agentEntry, localAgentIdentity, error) {
	decision, ok := accountservice.AuthorizedLocalAppDecisionFromContext(ctx)
	if !ok || decision.Operation != operation || decision.OperationCapability != "agents.configure" ||
		handle == "" || handle != strings.TrimSpace(handle) || strings.TrimSpace(decision.LocalAgentID) == "" {
		return accountservice.LocalAppCallerDecision{}, nil, localAgentIdentity{}, localAppConfigurePermissionFailure(runtimev1.ReasonCode_LOCAL_APP_PERMISSION_DENIED, "denied")
	}
	entry, err := s.agentByID(decision.LocalAgentID)
	if err != nil || entry == nil || entry.Agent == nil || strings.TrimSpace(entry.Agent.GetOwnerUserId()) != decision.AccountID {
		return accountservice.LocalAppCallerDecision{}, nil, localAgentIdentity{}, localAppConfigurePermissionFailure(runtimev1.ReasonCode_LOCAL_APP_PERMISSION_DENIED, "denied")
	}
	identity, err := validateLocalAgentIdentity(entry.Agent.GetOwnerUserId(), entry.Agent.GetRuntimeSourceRef(), entry.Agent.GetLocalAgentRef())
	if err != nil || identity.OwnerUserID != decision.AccountID {
		return accountservice.LocalAppCallerDecision{}, nil, localAgentIdentity{}, localAppConfigurePermissionFailure(runtimev1.ReasonCode_LOCAL_APP_PERMISSION_DENIED, "denied")
	}
	return decision, entry, identity, nil
}

func (s *Service) GetLocalAppAgentConfigurationSnapshot(ctx context.Context, req *runtimev1.GetLocalAppAgentConfigurationSnapshotRequest) (*runtimev1.LocalAppAgentConfigurationSnapshotResponse, error) {
	if req == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	decision, _, _, err := s.authorizedLocalAppConfigureAgent(ctx, accountservice.LocalAppOperationConfigurationSnapshot, req.GetAgentHandle())
	if err != nil {
		return nil, err
	}
	projection, err := s.localAppModelSettingsProjection(ctx, decision.LocalAgentID)
	if err != nil {
		return nil, err
	}
	return &runtimev1.LocalAppAgentConfigurationSnapshotResponse{Projection: projection}, nil
}

func (s *Service) UpdateLocalAppAgentConfiguration(ctx context.Context, req *runtimev1.UpdateLocalAppAgentConfigurationRequest) (*runtimev1.LocalAppAgentUpdateConfigurationResponse, error) {
	if req == nil || req.GetExpectedConfigurationRevision() == 0 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	decision, entry, identity, err := s.authorizedLocalAppConfigureAgent(ctx, accountservice.LocalAppOperationUpdateConfiguration, req.GetAgentHandle())
	if err != nil {
		return nil, err
	}
	intents, err := localAppRouteIntentsToRuntime(req.GetRouteIntents())
	if err != nil {
		return nil, err
	}
	privateContext := &runtimev1.AgentRequestContext{
		AppId: decision.AppID, SubjectUserId: decision.AccountID, OwnerUserId: identity.OwnerUserID,
		RuntimeSourceRef: entry.Agent.GetRuntimeSourceRef(), LocalAgentRef: identity.LocalAgentRef,
	}
	if _, err := s.upsertRuntimeAgentAIConfig(privateContext, req.GetExpectedConfigurationRevision(), intents); err != nil {
		return nil, err
	}
	projection, err := s.localAppModelSettingsProjection(ctx, identity.LocalAgentRef)
	if err != nil {
		return nil, err
	}
	return &runtimev1.LocalAppAgentUpdateConfigurationResponse{Projection: projection}, nil
}

func (s *Service) GetLocalAppAgentReadinessSnapshot(ctx context.Context, req *runtimev1.GetLocalAppAgentReadinessSnapshotRequest) (*runtimev1.LocalAppAgentReadinessSnapshotResponse, error) {
	if req == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	decision, _, _, err := s.authorizedLocalAppConfigureAgent(ctx, accountservice.LocalAppOperationReadinessSnapshot, req.GetAgentHandle())
	if err != nil {
		return nil, err
	}
	config, err := s.committedRuntimeAgentAIConfigByAgentInstanceID(decision.LocalAgentID)
	if err != nil {
		return nil, err
	}
	readiness, err := s.localAppReadinessProjection(decision.LocalAgentID, config.GetRevision())
	if err != nil {
		return nil, err
	}
	return &runtimev1.LocalAppAgentReadinessSnapshotResponse{Projection: readiness}, nil
}

func (s *Service) localAppModelSettingsProjection(ctx context.Context, localAgentRef string) (*runtimev1.LocalAppAgentModelSettingsProjection, error) {
	config, err := s.committedRuntimeAgentAIConfigByAgentInstanceID(localAgentRef)
	if err != nil {
		return nil, err
	}
	readiness, err := s.localAppReadinessProjection(localAgentRef, config.GetRevision())
	if err != nil {
		return nil, err
	}
	intents := make([]*runtimev1.LocalAppAgentRouteIntent, 0, len(config.GetIntents()))
	for _, intent := range config.GetIntents() {
		provider := strings.TrimSpace(intent.GetProvider())
		model := strings.TrimSpace(intent.GetModelId())
		if cloud := intent.GetTargetRef().GetCloud(); cloud != nil {
			if provider == "" {
				provider = strings.TrimSpace(cloud.GetProvider())
			}
			if cloud.GetProviderModelId() != "" {
				model = strings.TrimSpace(cloud.GetProviderModelId())
			}
		}
		intents = append(intents, &runtimev1.LocalAppAgentRouteIntent{
			Capability: intent.GetCapability(), Provider: provider, Model: model, RoutePolicy: intent.GetRoutePolicy(),
		})
	}
	routeOptions, err := s.localAppModelRouteOptions(ctx, config, readiness)
	if err != nil {
		return nil, err
	}
	return &runtimev1.LocalAppAgentModelSettingsProjection{
		Capabilities: aicapabilities.CanonicalCatalog(), RouteIntents: intents,
		Readiness: readiness.GetCapabilities(), ConfigurationRevision: config.GetRevision(),
		RouteOptions: routeOptions,
	}, nil
}

func (s *Service) localAppModelRouteOptions(
	ctx context.Context,
	config *runtimev1.RuntimeAgentAIConfig,
	readiness *runtimev1.LocalAppAgentReadinessProjection,
) ([]*runtimev1.LocalAppAgentRouteOption, error) {
	options := make(map[string]*runtimev1.LocalAppAgentRouteOption)
	readyCapabilities := make(map[string]bool, len(readiness.GetCapabilities()))
	for _, item := range readiness.GetCapabilities() {
		if item != nil && item.GetState() == runtimev1.LocalAppAgentReadinessState_LOCAL_APP_AGENT_READINESS_STATE_READY {
			readyCapabilities[strings.TrimSpace(item.GetCapability())] = true
		}
	}
	for _, intent := range config.GetIntents() {
		capability := strings.TrimSpace(intent.GetCapability())
		model := strings.TrimSpace(intent.GetModelId())
		if capability == "" || model == "" || !readyCapabilities[capability] ||
			intent.GetRoutePolicy() != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL {
			continue
		}
		addLocalAppRouteOption(options, &runtimev1.LocalAppAgentRouteOption{
			Capability:   capability,
			Model:        model,
			RoutePolicy:  runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			Label:        model,
			Availability: runtimev1.LocalAppAgentRouteOptionAvailability_LOCAL_APP_AGENT_ROUTE_OPTION_AVAILABILITY_READY,
		})
	}

	s.localAppRouteOptionsMu.RLock()
	inventory := s.localAppRouteOptions
	s.localAppRouteOptionsMu.RUnlock()
	if inventory != nil {
		for _, statusFilter := range []runtimev1.LocalAssetStatus{
			runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
			runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
		} {
			pageToken := ""
			for len(options) < localAppRouteOptionLimit {
				response, err := inventory.ListLocalAssets(ctx, &runtimev1.ListLocalAssetsRequest{
					StatusFilter: statusFilter,
					PageSize:     200,
					PageToken:    pageToken,
				})
				if err != nil {
					return nil, err
				}
				for _, asset := range response.GetAssets() {
					model := strings.TrimSpace(asset.GetLogicalModelId())
					if model == "" {
						continue
					}
					label := strings.TrimSpace(asset.GetDisplayName())
					if label == "" {
						label = model
					}
					availability := runtimev1.LocalAppAgentRouteOptionAvailability_LOCAL_APP_AGENT_ROUTE_OPTION_AVAILABILITY_INSTALLED
					if asset.GetStatus() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
						availability = runtimev1.LocalAppAgentRouteOptionAvailability_LOCAL_APP_AGENT_ROUTE_OPTION_AVAILABILITY_READY
					}
					for _, rawCapability := range asset.GetCapabilities() {
						capability, normalizeErr := aicapabilities.NormalizeCatalogCapability(rawCapability)
						if normalizeErr != nil || !isAdmittedRuntimeAgentAIConfigCapability(capability) {
							continue
						}
						addLocalAppRouteOption(options, &runtimev1.LocalAppAgentRouteOption{
							Capability:   capability,
							Model:        model,
							RoutePolicy:  runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
							Label:        label,
							Availability: availability,
						})
						if len(options) >= localAppRouteOptionLimit {
							break
						}
					}
				}
				pageToken = strings.TrimSpace(response.GetNextPageToken())
				if pageToken == "" {
					break
				}
			}
		}
	}

	out := make([]*runtimev1.LocalAppAgentRouteOption, 0, len(options))
	for _, option := range options {
		out = append(out, option)
	}
	sort.Slice(out, func(i, j int) bool {
		left := out[i]
		right := out[j]
		if left.GetCapability() != right.GetCapability() {
			return left.GetCapability() < right.GetCapability()
		}
		if left.GetRoutePolicy() != right.GetRoutePolicy() {
			return left.GetRoutePolicy() < right.GetRoutePolicy()
		}
		if left.GetProvider() != right.GetProvider() {
			return left.GetProvider() < right.GetProvider()
		}
		return left.GetModel() < right.GetModel()
	})
	return out, nil
}

func addLocalAppRouteOption(
	options map[string]*runtimev1.LocalAppAgentRouteOption,
	option *runtimev1.LocalAppAgentRouteOption,
) {
	if option == nil {
		return
	}
	key := strings.Join([]string{
		strings.TrimSpace(option.GetCapability()),
		option.GetRoutePolicy().String(),
		strings.TrimSpace(option.GetProvider()),
		strings.TrimSpace(option.GetModel()),
	}, "\x00")
	if key == "\x00\x00\x00" {
		return
	}
	if existing := options[key]; existing != nil {
		if existing.GetAvailability() != runtimev1.LocalAppAgentRouteOptionAvailability_LOCAL_APP_AGENT_ROUTE_OPTION_AVAILABILITY_READY &&
			option.GetAvailability() == runtimev1.LocalAppAgentRouteOptionAvailability_LOCAL_APP_AGENT_ROUTE_OPTION_AVAILABILITY_READY {
			options[key] = option
		}
		return
	}
	options[key] = option
}

func (s *Service) localAppReadinessProjection(localAgentRef string, revision uint64) (*runtimev1.LocalAppAgentReadinessProjection, error) {
	snapshot, err := s.currentRuntimeAgentAIConfigReadinessSnapshot(localAgentRef)
	if err != nil {
		return nil, err
	}
	if snapshot == nil || snapshot.GetConfigRevision() != revision {
		return nil, status.Error(codes.Unavailable, "runtime agent readiness projection unavailable")
	}
	items := make([]*runtimev1.LocalAppAgentCapabilityReadiness, 0, len(snapshot.GetCapabilities()))
	for _, item := range snapshot.GetCapabilities() {
		state := runtimev1.LocalAppAgentReadinessState_LOCAL_APP_AGENT_READINESS_STATE_FAILED
		switch item.GetState() {
		case runtimev1.RuntimeAgentAIConfigReadinessState_RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_READY:
			state = runtimev1.LocalAppAgentReadinessState_LOCAL_APP_AGENT_READINESS_STATE_READY
		case runtimev1.RuntimeAgentAIConfigReadinessState_RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_NOT_CONFIGURED:
			state = runtimev1.LocalAppAgentReadinessState_LOCAL_APP_AGENT_READINESS_STATE_BLOCKED
		case runtimev1.RuntimeAgentAIConfigReadinessState_RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_UNAVAILABLE:
			state = runtimev1.LocalAppAgentReadinessState_LOCAL_APP_AGENT_READINESS_STATE_UNAVAILABLE
		}
		items = append(items, &runtimev1.LocalAppAgentCapabilityReadiness{
			Capability: item.GetCapability(), State: state, Reason: item.GetReasonCode(), ObservedAt: cloneTimestamp(item.GetProbedAt()),
		})
	}
	return &runtimev1.LocalAppAgentReadinessProjection{Capabilities: items, ConfigurationRevision: revision}, nil
}

func localAppRouteIntentsToRuntime(input []*runtimev1.LocalAppAgentRouteIntent) ([]*runtimev1.RuntimeAgentAIConfigIntent, error) {
	if len(input) == 0 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	seen := make(map[string]struct{}, len(input))
	out := make([]*runtimev1.RuntimeAgentAIConfigIntent, 0, len(input))
	for _, item := range input {
		if item == nil {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		capability, err := aicapabilities.NormalizeCatalogCapability(item.GetCapability())
		if err != nil || !isAdmittedRuntimeAgentAIConfigCapability(capability) {
			return nil, grpcerr.WithReasonCode(codes.Unimplemented, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
		}
		if _, duplicate := seen[capability]; duplicate {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		seen[capability] = struct{}{}
		provider := strings.TrimSpace(item.GetProvider())
		model := strings.TrimSpace(item.GetModel())
		route := item.GetRoutePolicy()
		if model == "" || (route != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL && route != runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD) ||
			(route == runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL && provider != "") ||
			(route == runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD && provider == "") {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		out = append(out, &runtimev1.RuntimeAgentAIConfigIntent{Capability: capability, Provider: provider, ModelId: model, RoutePolicy: route})
	}
	return out, nil
}

func (s *Service) GetLocalAppAgentAutonomySnapshot(ctx context.Context, req *runtimev1.GetLocalAppAgentAutonomySnapshotRequest) (*runtimev1.LocalAppAgentAutonomySnapshotResponse, error) {
	if req == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	_, entry, _, err := s.authorizedLocalAppConfigureAgent(ctx, accountservice.LocalAppOperationAutonomySnapshot, req.GetAgentHandle())
	if err != nil {
		return nil, err
	}
	return &runtimev1.LocalAppAgentAutonomySnapshotResponse{Projection: localAppAutonomyProjection(entry.Agent.GetAutonomy())}, nil
}

func (s *Service) UpdateLocalAppAgentAutonomy(ctx context.Context, req *runtimev1.UpdateLocalAppAgentAutonomyRequest) (*runtimev1.LocalAppAgentUpdateAutonomyResponse, error) {
	if req == nil || req.GetExpectedAutonomyRevision() == 0 || req.GetIntent() == nil ||
		(req.GetIntent().Enabled == nil && req.GetIntent().Config == nil) {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	_, _, identity, err := s.authorizedLocalAppConfigureAgent(ctx, accountservice.LocalAppOperationUpdateAutonomy, req.GetAgentHandle())
	if err != nil {
		return nil, err
	}
	var config *runtimev1.AgentAutonomyConfig
	if req.GetIntent().Config != nil {
		config, err = runtimeAutonomyConfigFromLocalApp(req.GetIntent().GetConfig())
		if err != nil {
			return nil, err
		}
	}
	autonomy, err := s.updateAgentAutonomyCAS(identity, req.GetExpectedAutonomyRevision(), agentAutonomyMutationIntent{
		enabled: req.GetIntent().Enabled,
		config:  config,
	})
	if err != nil {
		if status.Code(err) == codes.NotFound || status.Code(err) == codes.FailedPrecondition {
			return nil, localAppConfigurePermissionFailure(runtimev1.ReasonCode_LOCAL_APP_PERMISSION_DENIED, "denied")
		}
		return nil, err
	}
	return &runtimev1.LocalAppAgentUpdateAutonomyResponse{Projection: localAppAutonomyProjection(autonomy)}, nil
}

func runtimeAutonomyConfigFromLocalApp(input *runtimev1.LocalAppAgentAutonomyConfig) (*runtimev1.AgentAutonomyConfig, error) {
	if input == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	return validateAgentAutonomyMutationConfig(&runtimev1.AgentAutonomyConfig{
		DailyTokenBudget: input.GetDailyTokenBudget(), MaxTokensPerHook: input.GetMaxTokensPerHook(),
		MinHookInterval: input.GetMinHookInterval(), SuspendUntil: input.GetSuspendUntil(), Mode: runtimev1.AgentAutonomyMode(input.GetMode()),
	})
}

func localAppAutonomyProjection(input *runtimev1.AgentAutonomyState) *runtimev1.LocalAppAgentAutonomyProjection {
	if input == nil {
		return nil
	}
	config := input.GetConfig()
	var projectedConfig *runtimev1.LocalAppAgentAutonomyConfig
	if config != nil {
		projectedConfig = &runtimev1.LocalAppAgentAutonomyConfig{
			DailyTokenBudget: config.GetDailyTokenBudget(), MaxTokensPerHook: config.GetMaxTokensPerHook(),
			MinHookInterval: config.GetMinHookInterval(), SuspendUntil: cloneTimestamp(config.GetSuspendUntil()),
			Mode: runtimev1.LocalAppAgentAutonomyMode(config.GetMode()),
		}
	}
	return &runtimev1.LocalAppAgentAutonomyProjection{
		Enabled: input.GetEnabled(), Config: projectedConfig, UsedTokensInWindow: input.GetUsedTokensInWindow(),
		WindowStartedAt: cloneTimestamp(input.GetWindowStartedAt()), BudgetExhausted: input.GetBudgetExhausted(),
		SuspendedUntil: cloneTimestamp(input.GetSuspendedUntil()), AutonomyRevision: input.GetRevision(),
	}
}

func (s *Service) GetLocalAppAgentPresentationSnapshot(ctx context.Context, req *runtimev1.GetLocalAppAgentPresentationSnapshotRequest) (*runtimev1.LocalAppAgentPresentationSnapshotResponse, error) {
	if req == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	_, entry, _, err := s.authorizedLocalAppConfigureAgent(ctx, accountservice.LocalAppOperationPresentationSnapshot, req.GetAgentHandle())
	if err != nil {
		return nil, err
	}
	return &runtimev1.LocalAppAgentPresentationSnapshotResponse{Projection: localAppPresentationProjection(entry.Agent.GetPresentationProfile(), entry.Agent.GetPreviousPresentationProfile(), entry.Agent.GetPresentationProfileRevision())}, nil
}

func (s *Service) CommitLocalAppAgentPresentation(ctx context.Context, req *runtimev1.CommitLocalAppAgentPresentationRequest) (*runtimev1.LocalAppAgentCommitPresentationResponse, error) {
	if req == nil || req.GetIntent() == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	decision, _, identity, err := s.authorizedLocalAppConfigureAgent(ctx, accountservice.LocalAppOperationCommitPresentation, req.GetAgentHandle())
	if err != nil {
		return nil, err
	}
	profile, previous, revision, err := s.commitAgentPresentation(ctx, identity, decision.AppID, req.GetExpectedPresentationRevision(), agentPresentationMutation{
		profile: localAppPresentationIntentProfile(req.GetIntent()), importedAssets: req.GetImportedAssets(),
	})
	if err != nil {
		return nil, err
	}
	return &runtimev1.LocalAppAgentCommitPresentationResponse{Projection: localAppPresentationProjection(profile, previous, revision)}, nil
}

func localAppPresentationIntentProfile(input *runtimev1.LocalAppAgentPresentationIntent) *runtimev1.AgentPresentationProfile {
	if input == nil {
		return nil
	}
	return &runtimev1.AgentPresentationProfile{
		BackendKind: input.GetBackendKind(), AvatarAssetRef: input.GetAvatarAssetRef(), ExpressionProfileRef: input.GetExpressionProfileRef(),
		IdlePreset: input.GetIdlePreset(), InteractionPolicyRef: input.GetInteractionPolicyRef(), DefaultVoiceReference: input.GetDefaultVoiceReference(),
		AvatarAutoplay: input.GetAvatarAutoplay(), BackgroundAssetRef: input.GetBackgroundAssetRef(),
	}
}

func localAppPresentationProjection(profile, previous *runtimev1.AgentPresentationProfile, revision uint64) *runtimev1.LocalAppAgentPresentationProjection {
	cloned := clonePresentationProfile(profile)
	voice := ""
	if cloned != nil {
		voice = cloned.GetDefaultVoiceReference()
	}
	return &runtimev1.LocalAppAgentPresentationProjection{
		Profile: cloned, PreviousProfile: clonePresentationProfile(previous),
		DefaultVoiceReference: voice, PresentationRevision: revision,
	}
}
