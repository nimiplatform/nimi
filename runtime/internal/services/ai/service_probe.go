package ai

import (
	"context"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const defaultTokenProviderProbeTimeout = 10 * time.Second

func (s *Service) ListTokenProviderModels(ctx context.Context, req *runtimev1.ListTokenProviderModelsRequest) (*runtimev1.ListTokenProviderModelsResponse, error) {
	if err := validateTokenProviderProbeEnvelope(req.GetAppId(), req.GetSubjectUserId()); err != nil {
		return nil, err
	}
	credentials, err := resolveTokenProviderProbeCredentials(ctx, req.GetProviderEndpoint())
	if err != nil {
		return nil, err
	}

	cloudProvider, err := s.tokenProbeCloudProvider()
	if err != nil {
		return nil, err
	}
	probeBackend, providerID, err := cloudProvider.ResolveProbeBackend(req.GetProviderId(), credentials.ProviderEndpoint, credentials.ProviderAPIKey)
	if err != nil {
		return nil, err
	}

	requestCtx, cancel := withTimeout(ctx, req.GetTimeoutMs(), defaultTokenProviderProbeTimeout)
	defer cancel()

	models, err := probeBackend.ListModels(requestCtx)
	if err != nil {
		return nil, err
	}

	descriptors := make([]*runtimev1.TokenProviderModelDescriptor, 0, len(models))
	for _, item := range models {
		descriptors = append(descriptors, &runtimev1.TokenProviderModelDescriptor{
			ModelId:    strings.TrimSpace(item.ModelID),
			ModelLabel: strings.TrimSpace(item.ModelLabel),
			Available:  item.Available,
		})
	}

	return &runtimev1.ListTokenProviderModelsResponse{
		ProviderId:       providerID,
		ProviderEndpoint: probeBackend.Endpoint(),
		Models:           descriptors,
		TraceId:          ulid.Make().String(),
	}, nil
}

func (s *Service) CheckTokenProviderHealth(ctx context.Context, req *runtimev1.CheckTokenProviderHealthRequest) (*runtimev1.CheckTokenProviderHealthResponse, error) {
	if err := validateTokenProviderProbeEnvelope(req.GetAppId(), req.GetSubjectUserId()); err != nil {
		return nil, err
	}
	credentials, err := resolveTokenProviderProbeCredentials(ctx, req.GetProviderEndpoint())
	if err != nil {
		return nil, err
	}

	cloudProvider, err := s.tokenProbeCloudProvider()
	if err != nil {
		return nil, err
	}
	probeBackend, providerID, err := cloudProvider.ResolveProbeBackend(req.GetProviderId(), credentials.ProviderEndpoint, credentials.ProviderAPIKey)
	if err != nil {
		return nil, err
	}

	requestCtx, cancel := withTimeout(ctx, req.GetTimeoutMs(), defaultTokenProviderProbeTimeout)
	defer cancel()

	statusValue, detail := probeBackend.ProbeHealth(requestCtx, req.GetModelId())
	return &runtimev1.CheckTokenProviderHealthResponse{
		Health: &runtimev1.TokenProviderHealthSnapshot{
			Status:           statusValue,
			Detail:           strings.TrimSpace(detail),
			CheckedAt:        timestamppb.New(time.Now().UTC()),
			ProviderId:       providerID,
			ProviderEndpoint: probeBackend.Endpoint(),
			ModelId:          strings.TrimSpace(req.GetModelId()),
		},
		TraceId: ulid.Make().String(),
	}, nil
}

func validateTokenProviderProbeEnvelope(appID string, subjectUserID string) error {
	if strings.TrimSpace(appID) == "" || strings.TrimSpace(subjectUserID) == "" {
		return status.Error(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID.String())
	}
	return nil
}

type tokenProbeCredentials struct {
	ProviderEndpoint string
	ProviderAPIKey   string
}

func resolveTokenProviderProbeCredentials(ctx context.Context, requestProviderEndpoint string) (tokenProbeCredentials, error) {
	credentials := parseRequestCredentials(ctx)
	if !isValidCredentialSource(credentials.Source) {
		return tokenProbeCredentials{}, credentialValidationError(runtimev1.ReasonCode_AI_REQUEST_CREDENTIAL_INVALID)
	}
	if credentials.Source != credentialSourceRequestInjected {
		return tokenProbeCredentials{}, credentialValidationError(runtimev1.ReasonCode_AI_REQUEST_CREDENTIAL_REQUIRED)
	}

	providerAPIKey := strings.TrimSpace(credentials.ProviderAPIKey)
	if providerAPIKey == "" {
		return tokenProbeCredentials{}, credentialValidationError(runtimev1.ReasonCode_AI_REQUEST_CREDENTIAL_MISSING)
	}

	requestEndpoint := strings.TrimSpace(requestProviderEndpoint)
	metadataEndpoint := strings.TrimSpace(credentials.ProviderEndpoint)
	if requestEndpoint != "" && metadataEndpoint != "" && !strings.EqualFold(strings.TrimRight(requestEndpoint, "/"), strings.TrimRight(metadataEndpoint, "/")) {
		return tokenProbeCredentials{}, status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
	}
	if requestEndpoint == "" {
		requestEndpoint = metadataEndpoint
	}

	return tokenProbeCredentials{
		ProviderEndpoint: requestEndpoint,
		ProviderAPIKey:   providerAPIKey,
	}, nil
}

func (s *Service) tokenProbeCloudProvider() (*nimillm.CloudProvider, error) {
	cloudProvider, ok := s.selector.cloud.(*nimillm.CloudProvider)
	if !ok || cloudProvider == nil {
		return nil, status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
	}
	return cloudProvider, nil
}
