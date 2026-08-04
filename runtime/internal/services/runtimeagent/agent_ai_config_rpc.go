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
