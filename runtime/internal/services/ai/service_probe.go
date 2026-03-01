package ai

import (
	"context"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// ListTokenProviderModels is deprecated. Use ConnectorService (next round) for
// provider discovery. Returns UNIMPLEMENTED per excluded_proto_methods policy.
func (s *Service) ListTokenProviderModels(_ context.Context, _ *runtimev1.ListTokenProviderModelsRequest) (*runtimev1.ListTokenProviderModelsResponse, error) {
	return nil, status.Error(codes.Unimplemented, "ListTokenProviderModels is deprecated; use ConnectorService for provider discovery")
}

// CheckTokenProviderHealth is deprecated. Use ConnectorService (next round) for
// provider health checks. Returns UNIMPLEMENTED per excluded_proto_methods policy.
func (s *Service) CheckTokenProviderHealth(_ context.Context, _ *runtimev1.CheckTokenProviderHealthRequest) (*runtimev1.CheckTokenProviderHealthResponse, error) {
	return nil, status.Error(codes.Unimplemented, "CheckTokenProviderHealth is deprecated; use ConnectorService for provider health")
}

func (s *Service) tokenProbeCloudProvider() (*nimillm.CloudProvider, error) {
	cloudProvider, ok := s.selector.cloud.(*nimillm.CloudProvider)
	if !ok || cloudProvider == nil {
		return nil, status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
	}
	return cloudProvider, nil
}
