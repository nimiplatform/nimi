package runtimeagent

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aiconfig"
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

// authorizedLocalAppConfigureAgent is reserved for the per-Agent autonomy and
// presentation planes. Shared LocalAgent AIConfig actions never call it.
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

func (s *Service) authorizedLocalAppSharedAIConfig(ctx context.Context, operation accountservice.LocalAppOperation) (accountservice.LocalAppCallerDecision, error) {
	decision, ok := accountservice.AuthorizedLocalAppDecisionFromContext(ctx)
	if !ok || decision.Operation != operation || decision.OperationCapability != "agents.configure" ||
		!exactSharedAIConfigIdentity(decision.AccountID) || !exactSharedAIConfigIdentity(decision.AppID) ||
		strings.TrimSpace(decision.LocalAgentID) != "" {
		return accountservice.LocalAppCallerDecision{}, localAppConfigurePermissionFailure(runtimev1.ReasonCode_LOCAL_APP_PERMISSION_DENIED, "denied")
	}
	return decision, nil
}

func (s *Service) GetLocalAppSharedLocalAgentAIConfig(ctx context.Context, req *runtimev1.GetLocalAppSharedLocalAgentAIConfigRequest) (*runtimev1.GetLocalAppSharedLocalAgentAIConfigResponse, error) {
	if req == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	decision, err := s.authorizedLocalAppSharedAIConfig(ctx, accountservice.LocalAppOperationSharedAIConfigGet)
	if err != nil {
		return nil, err
	}
	config, found, err := s.readSharedLocalAgentAIConfig(ctx, decision.AccountID)
	if err != nil {
		return nil, err
	}
	if !found {
		config = &runtimev1.AIConfig{Owner: aiconfig.LocalAgentSubsystemOwner()}
	}
	return &runtimev1.GetLocalAppSharedLocalAgentAIConfigResponse{Projection: localAppSharedAIConfigProjection(config)}, nil
}

func (s *Service) OverwriteLocalAppSharedLocalAgentAIConfig(ctx context.Context, req *runtimev1.OverwriteLocalAppSharedLocalAgentAIConfigRequest) (*runtimev1.OverwriteLocalAppSharedLocalAgentAIConfigResponse, error) {
	if req == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	decision, err := s.authorizedLocalAppSharedAIConfig(ctx, accountservice.LocalAppOperationSharedAIConfigOverwrite)
	if err != nil {
		return nil, err
	}
	config, err := s.overwriteSharedLocalAgentAIConfig(ctx, decision.AccountID, req.GetCapabilities())
	if err != nil {
		return nil, err
	}
	return &runtimev1.OverwriteLocalAppSharedLocalAgentAIConfigResponse{Projection: localAppSharedAIConfigProjection(config)}, nil
}

func (s *Service) PreviewLocalAppSharedLocalAgentAIProfile(ctx context.Context, req *runtimev1.PreviewLocalAppSharedLocalAgentAIProfileRequest) (*runtimev1.PreviewLocalAppSharedLocalAgentAIProfileResponse, error) {
	if req == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	decision, err := s.authorizedLocalAppSharedAIConfig(ctx, accountservice.LocalAppOperationSharedAIProfilePreview)
	if err != nil {
		return nil, err
	}
	after, err := sharedLocalAgentAIConfigFromProfile(req.GetProfileJson())
	if err != nil {
		return nil, invalidSharedLocalAgentAIConfigError()
	}
	before, found, err := s.readSharedLocalAgentAIConfig(ctx, decision.AccountID)
	if err != nil {
		return nil, err
	}
	if !found {
		before = nil
	}
	return &runtimev1.PreviewLocalAppSharedLocalAgentAIProfileResponse{
		Before: localAppSharedAIConfigProjection(before),
		After:  localAppSharedAIConfigProjection(after),
	}, nil
}

func (s *Service) ApplyLocalAppSharedLocalAgentAIProfile(ctx context.Context, req *runtimev1.ApplyLocalAppSharedLocalAgentAIProfileRequest) (*runtimev1.ApplyLocalAppSharedLocalAgentAIProfileResponse, error) {
	if req == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	decision, err := s.authorizedLocalAppSharedAIConfig(ctx, accountservice.LocalAppOperationSharedAIProfileApply)
	if err != nil {
		return nil, err
	}
	candidate, err := sharedLocalAgentAIConfigFromProfile(req.GetProfileJson())
	if err != nil {
		return nil, invalidSharedLocalAgentAIConfigError()
	}
	config, err := s.overwriteSharedLocalAgentAIConfig(ctx, decision.AccountID, candidate.GetCapabilities())
	if err != nil {
		return nil, err
	}
	return &runtimev1.ApplyLocalAppSharedLocalAgentAIProfileResponse{Projection: localAppSharedAIConfigProjection(config)}, nil
}

func localAppSharedAIConfigProjection(config *runtimev1.AIConfig) *runtimev1.LocalAppSharedLocalAgentAIConfigProjection {
	if config == nil {
		return nil
	}
	return &runtimev1.LocalAppSharedLocalAgentAIConfigProjection{Config: cloneAIConfig(config)}
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
