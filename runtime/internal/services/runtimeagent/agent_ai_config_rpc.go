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
	config, err := s.requireSharedLocalAgentAIConfig(ctx, caller.accountNamespace)
	if err != nil {
		return nil, err
	}
	return &runtimev1.GetSharedLocalAgentAIConfigResponse{Config: config}, nil
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
	config, err := s.overwriteSharedLocalAgentAIConfig(ctx, caller.accountNamespace, req.GetCapabilities())
	if err != nil {
		return nil, err
	}
	return &runtimev1.OverwriteSharedLocalAgentAIConfigResponse{Config: config}, nil
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
	before, found, err := s.readSharedLocalAgentAIConfig(ctx, caller.accountNamespace)
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
	caller, err := s.authorizeSharedLocalAgentAIConfig(ctx, req.GetContext(), "runtime.agent.ai_config.write")
	if err != nil {
		return nil, err
	}
	candidate, err := sharedLocalAgentAIConfigFromProfile(req.GetProfileJson())
	if err != nil {
		return nil, invalidSharedLocalAgentAIConfigError()
	}
	config, err := s.overwriteSharedLocalAgentAIConfig(ctx, caller.accountNamespace, candidate.GetCapabilities())
	if err != nil {
		return nil, err
	}
	return &runtimev1.ApplySharedLocalAgentAIProfileResponse{Config: config}, nil
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
