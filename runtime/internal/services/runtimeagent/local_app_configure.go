package runtimeagent

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// authorizedLocalAppSharedAIConfig verifies the shared subsystem AIConfig
// operations. They resolve the singular subsystem owner from the authorized
// account scope and never take an Agent handle.
func authorizedLocalAppSharedAIConfig(ctx context.Context, operation accountservice.LocalAppOperation) (accountservice.LocalAppCallerDecision, error) {
	decision, ok := authorizedLocalAppAgentDecision(ctx, operation)
	classification, classificationErr := localappop.ClassifyOperation(operation)
	if !ok || classificationErr != nil || decision.OperationCapability != string(classification.Domain) ||
		strings.TrimSpace(decision.LocalAgentID) != "" {
		return accountservice.LocalAppCallerDecision{}, localAppAgentAccessDenied()
	}
	return decision, nil
}

// @nimi-authority: definition.nimi.platform.app-ecosystem.agent-configuration-operation-family
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-agid-010a
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-agid-010b
func (s *Service) GetLocalAppSharedLocalAgentAIConfig(ctx context.Context, req *runtimev1.GetLocalAppSharedLocalAgentAIConfigRequest) (*runtimev1.GetLocalAppSharedLocalAgentAIConfigResponse, error) {
	if req == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	decision, err := authorizedLocalAppSharedAIConfig(ctx, accountservice.LocalAppOperationSharedAIConfigGet)
	if err != nil {
		return nil, err
	}
	config, revision, found, err := s.readSharedLocalAgentAIConfig(ctx, decision.AccountID)
	if err != nil {
		return nil, err
	}
	var effective []*runtimev1.AIConfigEffectiveSelection
	if found {
		effective = s.projectSharedAIConfigEffectiveSelections(decision.AccountID, config)
	}
	return &runtimev1.GetLocalAppSharedLocalAgentAIConfigResponse{
		Projection: localAppSharedAIConfigProjection(config, revision, effective),
	}, nil
}

func (s *Service) OverwriteLocalAppSharedLocalAgentAIConfig(ctx context.Context, req *runtimev1.OverwriteLocalAppSharedLocalAgentAIConfigRequest) (*runtimev1.OverwriteLocalAppSharedLocalAgentAIConfigResponse, error) {
	if req == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	decision, err := authorizedLocalAppSharedAIConfig(ctx, accountservice.LocalAppOperationSharedAIConfigOverwrite)
	if err != nil {
		return nil, err
	}
	config, revision, committed, err := s.overwriteSharedLocalAgentAIConfig(
		ctx, decision.AccountID, req.GetExpectedRevision(), req.GetCapabilities(),
	)
	if err != nil {
		return nil, err
	}
	response := &runtimev1.OverwriteLocalAppSharedLocalAgentAIConfigResponse{
		Projection: localAppSharedAIConfigProjection(
			config, revision, s.projectSharedAIConfigEffectiveSelections(decision.AccountID, config),
		),
		Committed: committed,
	}
	if !committed {
		response.ReasonCode = runtimev1.ReasonCode_AGENT_AI_CONFIG_REVISION_CONFLICT
	}
	return response, nil
}

func (s *Service) ListLocalAppSharedLocalAgentAIConfigOptions(
	ctx context.Context,
	req *runtimev1.ListLocalAppSharedLocalAgentAIConfigOptionsRequest,
) (*runtimev1.ListLocalAppSharedLocalAgentAIConfigOptionsResponse, error) {
	if req == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	decision, err := authorizedLocalAppSharedAIConfig(ctx, accountservice.LocalAppOperationSharedAIConfigOptions)
	if err != nil {
		return nil, err
	}
	response := &runtimev1.ListLocalAppSharedLocalAgentAIConfigOptionsResponse{}
	switch query := req.GetQuery().(type) {
	case *runtimev1.ListLocalAppSharedLocalAgentAIConfigOptionsRequest_LocalLoadouts:
		options, truncated, err := s.listSharedAIConfigLocalOptions(query.LocalLoadouts)
		if err != nil {
			return nil, err
		}
		response.Result = &runtimev1.ListLocalAppSharedLocalAgentAIConfigOptionsResponse_LocalLoadouts{LocalLoadouts: &runtimev1.AIConfigLocalLoadoutOptions{Options: options}}
		response.Truncated = truncated
	case *runtimev1.ListLocalAppSharedLocalAgentAIConfigOptionsRequest_CloudConnectors:
		options, truncated, err := s.listSharedAIConfigCloudConnectorOptions(decision.AccountID, query.CloudConnectors)
		if err != nil {
			return nil, err
		}
		response.Result = &runtimev1.ListLocalAppSharedLocalAgentAIConfigOptionsResponse_CloudConnectors{CloudConnectors: &runtimev1.AIConfigCloudConnectorOptions{Options: options}}
		response.Truncated = truncated
	case *runtimev1.ListLocalAppSharedLocalAgentAIConfigOptionsRequest_CloudTargets:
		options, truncated, err := s.listSharedAIConfigCloudTargetOptions(decision.AccountID, query.CloudTargets)
		if err != nil {
			return nil, err
		}
		response.Result = &runtimev1.ListLocalAppSharedLocalAgentAIConfigOptionsResponse_CloudTargets{CloudTargets: &runtimev1.AIConfigCloudTargetOptions{Options: options}}
		response.Truncated = truncated
	default:
		return nil, invalidSharedLocalAgentAIConfigError()
	}
	return response, nil
}

func localAppSharedAIConfigProjection(
	config *runtimev1.AIConfig,
	revision string,
	effective []*runtimev1.AIConfigEffectiveSelection,
) *runtimev1.LocalAppSharedLocalAgentAIConfigProjection {
	return &runtimev1.LocalAppSharedLocalAgentAIConfigProjection{
		Config: cloneAIConfig(config), Revision: revision, EffectiveSelections: effective,
		Participation: projectLocalAgentCapabilityParticipation(),
	}
}

func (s *Service) GetLocalAppAgentAutonomySnapshot(ctx context.Context, req *runtimev1.GetLocalAppAgentAutonomySnapshotRequest) (*runtimev1.LocalAppAgentAutonomySnapshotResponse, error) {
	if req == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	resolved, _, err := s.resolveLocalAppAgent(ctx, accountservice.LocalAppOperationAutonomySnapshot, req.GetAgentHandle())
	if err != nil {
		return nil, err
	}
	return &runtimev1.LocalAppAgentAutonomySnapshotResponse{Projection: localAppAutonomyProjection(resolved.entry.GetAutonomy())}, nil
}

func (s *Service) UpdateLocalAppAgentAutonomy(ctx context.Context, req *runtimev1.UpdateLocalAppAgentAutonomyRequest) (*runtimev1.LocalAppAgentUpdateAutonomyResponse, error) {
	if req == nil || req.GetExpectedAutonomyRevision() == 0 || req.GetIntent() == nil ||
		(req.GetIntent().Enabled == nil && req.GetIntent().Config == nil) {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	resolved, _, err := s.resolveLocalAppAgent(ctx, accountservice.LocalAppOperationUpdateAutonomy, req.GetAgentHandle())
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
	autonomy, err := s.updateAgentAutonomyCAS(resolved.identity, req.GetExpectedAutonomyRevision(), agentAutonomyMutationIntent{
		enabled: req.GetIntent().Enabled,
		config:  config,
	})
	if err != nil {
		if status.Code(err) == codes.NotFound {
			return nil, localAppAgentAccessDenied()
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
	resolved, _, err := s.resolveLocalAppAgent(ctx, accountservice.LocalAppOperationPresentationSnapshot, req.GetAgentHandle())
	if err != nil {
		return nil, err
	}
	return &runtimev1.LocalAppAgentPresentationSnapshotResponse{Projection: localAppPresentationProjection(
		resolved.entry.GetPresentationProfile(),
		resolved.entry.GetPreviousPresentationProfile(),
		resolved.entry.GetPresentationProfileRevision(),
	)}, nil
}

func (s *Service) CommitLocalAppAgentPresentation(ctx context.Context, req *runtimev1.CommitLocalAppAgentPresentationRequest) (*runtimev1.LocalAppAgentCommitPresentationResponse, error) {
	if req == nil || req.GetIntent() == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	resolved, _, err := s.resolveLocalAppAgent(ctx, accountservice.LocalAppOperationCommitPresentation, req.GetAgentHandle())
	if err != nil {
		return nil, err
	}
	profile, previous, revision, err := s.commitAgentPresentation(ctx, resolved.identity, resolved.decision.AppID, req.GetExpectedPresentationRevision(), agentPresentationMutation{
		profile: localAppPresentationIntentProfile(req.GetIntent()), importedAssets: req.GetImportedAssets(),
	})
	if err != nil {
		if status.Code(err) == codes.NotFound {
			return nil, localAppAgentAccessDenied()
		}
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
