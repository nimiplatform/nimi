package runtimeagent

import (
	"context"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func (s *Service) GetSharedLocalAgentAIConfig(
	ctx context.Context,
	req *runtimev1.GetSharedLocalAgentAIConfigRequest,
) (*runtimev1.GetSharedLocalAgentAIConfigResponse, error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "get shared LocalAgent AIConfig request is required")
	}
	caller, err := s.authorizeSharedLocalAgentAIConfig(ctx, req.GetContext(), "runtime.agent.ai_config.read")
	if err != nil {
		return nil, err
	}
	config, revision, found, err := s.readSharedLocalAgentAIConfig(ctx, caller.accountNamespace)
	if err != nil {
		return nil, err
	}
	if !found {
		return &runtimev1.GetSharedLocalAgentAIConfigResponse{Revision: revision}, nil
	}
	return &runtimev1.GetSharedLocalAgentAIConfigResponse{
		Config: config, Revision: revision,
		EffectiveSelections: s.projectSharedAIConfigEffectiveSelections(config),
	}, nil
}

func (s *Service) OverwriteSharedLocalAgentAIConfig(
	ctx context.Context,
	req *runtimev1.OverwriteSharedLocalAgentAIConfigRequest,
) (*runtimev1.OverwriteSharedLocalAgentAIConfigResponse, error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "overwrite shared LocalAgent AIConfig request is required")
	}
	caller, err := s.authorizeSharedLocalAgentAIConfig(ctx, req.GetContext(), "runtime.agent.ai_config.write")
	if err != nil {
		return nil, err
	}
	config, revision, committed, err := s.overwriteSharedLocalAgentAIConfig(
		ctx, caller.accountNamespace, req.GetExpectedRevision(), req.GetCapabilities(),
	)
	if err != nil {
		return nil, err
	}
	response := &runtimev1.OverwriteSharedLocalAgentAIConfigResponse{
		Config: config, Revision: revision, Committed: committed,
		EffectiveSelections: s.projectSharedAIConfigEffectiveSelections(config),
	}
	if !committed {
		response.ReasonCode = runtimev1.ReasonCode_AGENT_AI_CONFIG_REVISION_CONFLICT
	}
	return response, nil
}

func (s *Service) ListSharedLocalAgentAIConfigOptions(
	ctx context.Context,
	req *runtimev1.ListSharedLocalAgentAIConfigOptionsRequest,
) (*runtimev1.ListSharedLocalAgentAIConfigOptionsResponse, error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "list shared LocalAgent AIConfig options request is required")
	}
	if _, err := s.authorizeSharedLocalAgentAIConfig(ctx, req.GetContext(), "runtime.agent.ai_config.write"); err != nil {
		return nil, err
	}
	options, truncated, err := s.listSharedAIConfigLocalOptions(req.GetLocalLoadouts())
	if err != nil {
		return nil, err
	}
	return &runtimev1.ListSharedLocalAgentAIConfigOptionsResponse{
		LocalLoadouts: &runtimev1.AIConfigLocalLoadoutOptions{Options: options},
		Truncated:     truncated,
	}, nil
}

func (s *Service) PreviewSharedLocalAgentAIProfile(
	ctx context.Context,
	req *runtimev1.PreviewSharedLocalAgentAIProfileRequest,
) (*runtimev1.PreviewSharedLocalAgentAIProfileResponse, error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "preview shared LocalAgent AIProfile request is required")
	}
	caller, err := s.authorizeSharedLocalAgentAIConfig(ctx, req.GetContext(), "runtime.agent.ai_config.write")
	if err != nil {
		return nil, err
	}
	after, err := sharedLocalAgentAIConfigFromProfile(req.GetProfileJson())
	if err != nil {
		return nil, invalidSharedLocalAgentAIConfigError()
	}
	before, _, found, err := s.readSharedLocalAgentAIConfig(ctx, caller.accountNamespace)
	if err != nil {
		return nil, err
	}
	if !found {
		before = nil
	}
	return &runtimev1.PreviewSharedLocalAgentAIProfileResponse{
		Before: cloneAIConfig(before),
		After:  cloneAIConfig(after),
	}, nil
}

func (s *Service) ApplySharedLocalAgentAIProfile(
	ctx context.Context,
	req *runtimev1.ApplySharedLocalAgentAIProfileRequest,
) (*runtimev1.ApplySharedLocalAgentAIProfileResponse, error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "apply shared LocalAgent AIProfile request is required")
	}
	_, err := s.authorizeSharedLocalAgentAIConfig(ctx, req.GetContext(), "runtime.agent.ai_config.write")
	if err != nil {
		return nil, err
	}
	candidate, err := sharedLocalAgentAIConfigFromProfile(req.GetProfileJson())
	if err != nil {
		return nil, invalidSharedLocalAgentAIConfigError()
	}
	// Apply is a non-committing editor prefill. Exact resource refs and the
	// owner revision enter only through the ordinary AIConfig CAS Save.
	return &runtimev1.ApplySharedLocalAgentAIProfileResponse{Config: candidate}, nil
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r003
func (s *Service) ImportPortableAIProfile(
	ctx context.Context,
	req *runtimev1.ImportPortableAIProfileRequest,
) (*runtimev1.ImportPortableAIProfileResponse, error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "import portable AIProfile request is required")
	}
	caller, err := s.authorizeSharedLocalAgentAIConfig(ctx, req.GetContext(), "runtime.agent.ai_profile.write")
	if err != nil {
		return nil, err
	}
	profile, err := parsePortableAIProfile(req.GetProfileJson())
	if err != nil {
		return nil, invalidSharedLocalAgentAIConfigError()
	}
	if s.aiProfileStore == nil {
		return nil, sharedLocalAgentAIConfigPersistenceError(status.Error(codes.Unavailable, "AIProfile store is unavailable"))
	}
	record, err := s.aiProfileStore.Import(ctx, caller.accountNamespace, &runtimev1.PortableAIProfileRecord{
		ProfileId:   profile.profileID,
		Title:       profile.title,
		ProfileJson: append([]byte(nil), req.GetProfileJson()...),
	})
	if err != nil {
		return nil, sharedLocalAgentAIConfigPersistenceError(err)
	}
	return &runtimev1.ImportPortableAIProfileResponse{Profile: record}, nil
}

func (s *Service) ListPortableAIProfiles(
	ctx context.Context,
	req *runtimev1.ListPortableAIProfilesRequest,
) (*runtimev1.ListPortableAIProfilesResponse, error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "list portable AIProfiles request is required")
	}
	caller, err := s.authorizeSharedLocalAgentAIConfig(ctx, req.GetContext(), "runtime.agent.ai_profile.read")
	if err != nil {
		return nil, err
	}
	if s.aiProfileStore == nil {
		return nil, sharedLocalAgentAIConfigPersistenceError(status.Error(codes.Unavailable, "AIProfile store is unavailable"))
	}
	profiles, err := s.aiProfileStore.List(ctx, caller.accountNamespace)
	if err != nil {
		return nil, sharedLocalAgentAIConfigPersistenceError(err)
	}
	isolated := make([]*runtimev1.PortableAIProfileRecord, 0, len(profiles))
	for _, record := range profiles {
		profile, parseErr := parsePortableAIProfile(record.GetProfileJson())
		if parseErr != nil || profile.profileID != record.GetProfileId() || profile.title != record.GetTitle() {
			continue
		}
		isolated = append(isolated, record)
	}
	return &runtimev1.ListPortableAIProfilesResponse{Profiles: isolated}, nil
}
