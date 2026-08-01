package runtimeagent

import (
	"context"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
)

func (s *Service) PreviewLocalAppAgentAIProfile(
	ctx context.Context,
	req *runtimev1.PreviewLocalAppAgentAIProfileRequest,
) (*runtimev1.LocalAppAgentAIProfilePreviewResponse, error) {
	if req == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	decision, entry, identity, err := s.authorizedLocalAppConfigureAgent(
		ctx,
		accountservice.LocalAppOperationAIProfilePreview,
		req.GetAgentHandle(),
	)
	if err != nil {
		return nil, err
	}
	projection, err := s.prepareRuntimeAgentAIProfileProjection(
		ctx,
		localAppPrivateAIConfigContext(decision, entry, identity),
		req.GetProfileJson(),
		req.GetRuntimeDescriptorJson(),
	)
	if err != nil {
		return nil, err
	}
	return &runtimev1.LocalAppAgentAIProfilePreviewResponse{
		Before:               s.localAppAIConfigValueProjection(ctx, projection.before),
		After:                s.localAppAIConfigValueProjection(ctx, projection.after),
		Outcome:              localAppAIProfileOutcome(projection.outcome),
		BaseRevision:         projection.before.GetRevision(),
		BlockingCapabilities: append([]string(nil), projection.blockingCapabilities...),
		ReasonCodes:          append([]string(nil), projection.reasonCodes...),
		ActionRefs:           append([]string(nil), projection.actionRefs...),
		ProbeWarnings:        append([]string(nil), projection.probeWarnings...),
	}, nil
}

func (s *Service) ApplyLocalAppAgentAIProfile(
	ctx context.Context,
	req *runtimev1.ApplyLocalAppAgentAIProfileRequest,
) (*runtimev1.LocalAppAgentAIProfileApplyResponse, error) {
	if req == nil || req.GetExpectedConfigurationRevision() == 0 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	decision, entry, identity, err := s.authorizedLocalAppConfigureAgent(
		ctx,
		accountservice.LocalAppOperationAIProfileApply,
		req.GetAgentHandle(),
	)
	if err != nil {
		return nil, err
	}
	privateContext := localAppPrivateAIConfigContext(decision, entry, identity)
	current, err := s.committedRuntimeAgentAIConfigForContext(privateContext)
	if err != nil {
		return nil, err
	}
	if current.GetRevision() != req.GetExpectedConfigurationRevision() {
		return &runtimev1.LocalAppAgentAIProfileApplyResponse{
			Outcome:     runtimev1.LocalAppAgentAIProfileApplyOutcome_LOCAL_APP_AGENT_AI_PROFILE_APPLY_OUTCOME_STALE_BASE,
			ReasonCodes: []string{"stale_base"},
		}, nil
	}
	prepared, err := s.prepareRuntimeAgentAIProfileProjection(
		ctx,
		privateContext,
		req.GetProfileJson(),
		req.GetRuntimeDescriptorJson(),
	)
	if err != nil {
		return nil, err
	}
	response := &runtimev1.LocalAppAgentAIProfileApplyResponse{
		Outcome:              localAppAIProfileOutcome(prepared.outcome),
		BlockingCapabilities: append([]string(nil), prepared.blockingCapabilities...),
		ReasonCodes:          append([]string(nil), prepared.reasonCodes...),
		ActionRefs:           append([]string(nil), prepared.actionRefs...),
		ProbeWarnings:        append([]string(nil), prepared.probeWarnings...),
	}
	if prepared.outcome != runtimev1.RuntimeAgentAIProfileApplyOutcome_RUNTIME_AGENT_AI_PROFILE_APPLY_OUTCOME_READY_TO_APPLY ||
		prepared.after == nil {
		return response, nil
	}
	if _, err := s.upsertRuntimeAgentAIConfig(
		privateContext,
		req.GetExpectedConfigurationRevision(),
		prepared.after.GetIntents(),
		prepared.after.GetProfileOrigin(),
	); err != nil {
		if reason, ok := grpcerr.ExtractReasonCode(err); ok {
			switch reason {
			case runtimev1.ReasonCode_AGENT_AI_CONFIG_REVISION_CONFLICT:
				response.Outcome = runtimev1.LocalAppAgentAIProfileApplyOutcome_LOCAL_APP_AGENT_AI_PROFILE_APPLY_OUTCOME_STALE_BASE
				response.ReasonCodes = []string{"stale_base"}
				return response, nil
			case runtimev1.ReasonCode_AGENT_AI_CONFIG_TARGET_UNAVAILABLE:
				response.Outcome = runtimev1.LocalAppAgentAIProfileApplyOutcome_LOCAL_APP_AGENT_AI_PROFILE_APPLY_OUTCOME_SETUP_REQUIRED_NO_LIVE_CONFIG
				response.ReasonCodes = []string{"target_unavailable"}
				return response, nil
			case runtimev1.ReasonCode_AGENT_AI_CONFIG_INVALID,
				runtimev1.ReasonCode_AGENT_AI_CONFIG_TARGET_INVALID,
				runtimev1.ReasonCode_AGENT_AI_CONFIG_CAPABILITY_MISMATCH,
				runtimev1.ReasonCode_AGENT_AI_CONFIG_MODEL_TARGET_MISMATCH:
				response.Outcome = runtimev1.LocalAppAgentAIProfileApplyOutcome_LOCAL_APP_AGENT_AI_PROFILE_APPLY_OUTCOME_INVALID_PROFILE
				response.ReasonCodes = []string{"profile_materialization_invalid"}
				return response, nil
			}
		}
		return nil, err
	}
	response.Projection, err = s.localAppAIConfigProjection(ctx, identity.LocalAgentRef)
	if err != nil {
		return nil, err
	}
	return response, nil
}

func localAppPrivateAIConfigContext(
	decision accountservice.LocalAppCallerDecision,
	entry *agentEntry,
	identity localAgentIdentity,
) *runtimev1.AgentRequestContext {
	return &runtimev1.AgentRequestContext{
		AppId: decision.AppID, SubjectUserId: decision.AccountID, OwnerUserId: identity.OwnerUserID,
		RuntimeSourceRef: entry.Agent.GetRuntimeSourceRef(), LocalAgentRef: identity.LocalAgentRef,
	}
}

func localAppAIProfileOutcome(
	outcome runtimev1.RuntimeAgentAIProfileApplyOutcome,
) runtimev1.LocalAppAgentAIProfileApplyOutcome {
	switch outcome {
	case runtimev1.RuntimeAgentAIProfileApplyOutcome_RUNTIME_AGENT_AI_PROFILE_APPLY_OUTCOME_READY_TO_APPLY:
		return runtimev1.LocalAppAgentAIProfileApplyOutcome_LOCAL_APP_AGENT_AI_PROFILE_APPLY_OUTCOME_READY_TO_APPLY
	case runtimev1.RuntimeAgentAIProfileApplyOutcome_RUNTIME_AGENT_AI_PROFILE_APPLY_OUTCOME_SETUP_REQUIRED_NO_LIVE_CONFIG:
		return runtimev1.LocalAppAgentAIProfileApplyOutcome_LOCAL_APP_AGENT_AI_PROFILE_APPLY_OUTCOME_SETUP_REQUIRED_NO_LIVE_CONFIG
	case runtimev1.RuntimeAgentAIProfileApplyOutcome_RUNTIME_AGENT_AI_PROFILE_APPLY_OUTCOME_UNSUPPORTED_NO_LIVE_CONFIG:
		return runtimev1.LocalAppAgentAIProfileApplyOutcome_LOCAL_APP_AGENT_AI_PROFILE_APPLY_OUTCOME_UNSUPPORTED_NO_LIVE_CONFIG
	case runtimev1.RuntimeAgentAIProfileApplyOutcome_RUNTIME_AGENT_AI_PROFILE_APPLY_OUTCOME_INVALID_PROFILE:
		return runtimev1.LocalAppAgentAIProfileApplyOutcome_LOCAL_APP_AGENT_AI_PROFILE_APPLY_OUTCOME_INVALID_PROFILE
	case runtimev1.RuntimeAgentAIProfileApplyOutcome_RUNTIME_AGENT_AI_PROFILE_APPLY_OUTCOME_STALE_BASE:
		return runtimev1.LocalAppAgentAIProfileApplyOutcome_LOCAL_APP_AGENT_AI_PROFILE_APPLY_OUTCOME_STALE_BASE
	default:
		return runtimev1.LocalAppAgentAIProfileApplyOutcome_LOCAL_APP_AGENT_AI_PROFILE_APPLY_OUTCOME_FAILED
	}
}

func (s *Service) localAppAIConfigValueProjection(
	ctx context.Context,
	config *runtimev1.RuntimeAgentAIConfig,
) *runtimev1.LocalAppAgentAIConfigProjection {
	if config == nil {
		return nil
	}
	intents := make([]*runtimev1.LocalAppAgentAIConfigIntent, 0, len(config.GetIntents()))
	capabilities := make([]string, 0, len(config.GetIntents()))
	for _, intent := range config.GetIntents() {
		provider := strings.TrimSpace(intent.GetProvider())
		model := s.localAppLogicalModelForIntent(ctx, intent)
		if cloud := intent.GetTargetRef().GetCloud(); cloud != nil {
			if provider == "" {
				provider = strings.TrimSpace(cloud.GetProvider())
			}
			if cloud.GetProviderModelId() != "" {
				model = strings.TrimSpace(cloud.GetProviderModelId())
			}
		}
		if model == "" {
			continue
		}
		normalizedSelectedParams, paramsValid := normalizeRuntimeAgentAIConfigSelectedParams(
			strings.TrimSpace(intent.GetCapability()),
			intent.GetSelectedParams(),
		)
		if !paramsValid {
			continue
		}
		capability := strings.TrimSpace(intent.GetCapability())
		capabilities = append(capabilities, capability)
		intents = append(intents, &runtimev1.LocalAppAgentAIConfigIntent{
			Capability: capability, Provider: provider, LogicalModelId: model,
			RoutePolicy: intent.GetRoutePolicy(), SelectedParams: normalizedSelectedParams,
			SelectedComponents: s.localAppAIConfigComponentProjections(ctx, intent.GetSelectedComponents()),
		})
	}
	sort.Strings(capabilities)
	return &runtimev1.LocalAppAgentAIConfigProjection{
		Capabilities:          capabilities,
		Intents:               intents,
		ConfigurationRevision: config.GetRevision(),
		ScopeOwnerId:          config.GetAgentInstanceId(),
		ProfileOrigin:         localAppProfileOriginFromRuntime(config.GetProfileOrigin()),
	}
}
