package runtimeagent

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aicapabilities"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

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
	projection, err := s.localAppModelSettingsProjection(decision.LocalAgentID)
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
	projection, err := s.localAppModelSettingsProjection(identity.LocalAgentRef)
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

func (s *Service) localAppModelSettingsProjection(localAgentRef string) (*runtimev1.LocalAppAgentModelSettingsProjection, error) {
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
	return &runtimev1.LocalAppAgentModelSettingsProjection{
		Capabilities: aicapabilities.CanonicalCatalog(), RouteIntents: intents,
		Readiness: readiness.GetCapabilities(), ConfigurationRevision: config.GetRevision(),
	}, nil
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
