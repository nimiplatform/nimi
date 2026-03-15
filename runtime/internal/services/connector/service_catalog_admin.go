package connector

import (
	"context"
	"errors"
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	aicatalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func (s *Service) ListProviderCatalog(_ context.Context, _ *runtimev1.ListProviderCatalogRequest) (*runtimev1.ListProviderCatalogResponse, error) {
	entries := make([]*runtimev1.ProviderCatalogEntry, 0, len(ProviderCatalog))
	for provider, entry := range ProviderCatalog {
		cap := ProviderCapabilities[provider]
		entries = append(entries, &runtimev1.ProviderCatalogEntry{
			Provider:                 provider,
			DefaultEndpoint:          entry.DefaultEndpoint,
			RequiresExplicitEndpoint: entry.RequiresExplicitEndpoint,
			RuntimePlane:             cap.RuntimePlane,
			ExecutionModule:          cap.ExecutionModule,
			ManagedSupported:         cap.ManagedSupported,
		})
	}
	return &runtimev1.ListProviderCatalogResponse{Providers: entries}, nil
}

func (s *Service) ListModelCatalogProviders(ctx context.Context, _ *runtimev1.ListModelCatalogProvidersRequest) (*runtimev1.ListModelCatalogProvidersResponse, error) {
	if s.modelCatalog == nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.Unavailable, runtimev1.ReasonCode_AI_MODULE_CONFIG_INVALID, grpcerr.ReasonOptions{
			ActionHint: "configure_runtime_model_catalog_custom_dir",
		})
	}

	subjectUserID, _ := subjectUserIDFromContext(ctx)
	records := s.modelCatalog.ListProvidersForSubject(subjectUserID)
	entries := make([]*runtimev1.ModelCatalogProviderEntry, 0, len(records))
	for _, record := range records {
		entries = append(entries, modelCatalogProviderEntryFromRecord(record))
	}
	return &runtimev1.ListModelCatalogProvidersResponse{Providers: entries}, nil
}

func (s *Service) UpsertModelCatalogProvider(ctx context.Context, req *runtimev1.UpsertModelCatalogProviderRequest) (*runtimev1.UpsertModelCatalogProviderResponse, error) {
	subjectUserID, err := requireSubjectUserID(ctx)
	if err != nil {
		return nil, err
	}
	if s.modelCatalog == nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.Unavailable, runtimev1.ReasonCode_AI_MODULE_CONFIG_INVALID, grpcerr.ReasonOptions{
			ActionHint: "configure_runtime_model_catalog_custom_dir",
		})
	}

	provider := strings.TrimSpace(req.GetProvider())
	rawYAML := strings.TrimSpace(req.GetYaml())
	if provider == "" || rawYAML == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}

	record, err := s.modelCatalog.UpsertCustomProviderForSubject(subjectUserID, provider, []byte(rawYAML))
	if err != nil {
		switch {
		case errors.Is(err, aicatalog.ErrCatalogMutationDisabled):
			return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_MODULE_CONFIG_INVALID, grpcerr.ReasonOptions{
				ActionHint: "configure_runtime_model_catalog_custom_dir",
			})
		case errors.Is(err, aicatalog.ErrProviderUnsupported):
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		default:
			return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_MODULE_CONFIG_INVALID, grpcerr.ReasonOptions{
				ActionHint: "fix_provider_catalog_yaml",
				Message:    err.Error(),
			})
		}
	}

	return &runtimev1.UpsertModelCatalogProviderResponse{
		Provider: modelCatalogProviderEntryFromRecord(record),
	}, nil
}

func (s *Service) DeleteModelCatalogProvider(ctx context.Context, req *runtimev1.DeleteModelCatalogProviderRequest) (*runtimev1.DeleteModelCatalogProviderResponse, error) {
	subjectUserID, err := requireSubjectUserID(ctx)
	if err != nil {
		return nil, err
	}
	if s.modelCatalog == nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.Unavailable, runtimev1.ReasonCode_AI_MODULE_CONFIG_INVALID, grpcerr.ReasonOptions{
			ActionHint: "configure_runtime_model_catalog_custom_dir",
		})
	}

	provider := strings.TrimSpace(req.GetProvider())
	if provider == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	if err := s.modelCatalog.DeleteCustomProviderForSubject(subjectUserID, provider); err != nil {
		switch {
		case errors.Is(err, aicatalog.ErrCatalogMutationDisabled):
			return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_MODULE_CONFIG_INVALID, grpcerr.ReasonOptions{
				ActionHint: "configure_runtime_model_catalog_custom_dir",
			})
		case errors.Is(err, aicatalog.ErrProviderUnsupported):
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		default:
			return nil, s.internalProviderError("delete_model_catalog_provider", err)
		}
	}

	return &runtimev1.DeleteModelCatalogProviderResponse{
		Ack: &runtimev1.Ack{Ok: true},
	}, nil
}
