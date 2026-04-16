package connector

import (
	"context"
	"sort"
	"strconv"
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/pagination"
)

func (s *Service) TestConnector(ctx context.Context, req *runtimev1.TestConnectorRequest) (*runtimev1.TestConnectorResponse, error) {
	connectorID := strings.TrimSpace(req.GetConnectorId())
	if connectorID == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
	}

	auditPayload := map[string]any{"connector_id": connectorID}

	ownerID, hasOwner := subjectUserIDFromContext(ctx)
	rec, found, err := s.store.Get(connectorID)
	if err != nil {
		return nil, s.internalProviderError("test_connector.load", err)
	}
	if !found || !connectorVisibleToCaller(rec, ownerID, hasOwner) {
		s.emitAudit(ctx, "connector.test", runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND, auditPayload)
		return &runtimev1.TestConnectorResponse{
			Ack: &runtimev1.Ack{Ok: false, ReasonCode: runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND},
		}, nil
	}

	if rec.Status == runtimev1.ConnectorStatus_CONNECTOR_STATUS_DISABLED {
		s.emitAudit(ctx, "connector.test", runtimev1.ReasonCode_AI_CONNECTOR_DISABLED, auditPayload)
		return &runtimev1.TestConnectorResponse{
			Ack: &runtimev1.Ack{Ok: false, ReasonCode: runtimev1.ReasonCode_AI_CONNECTOR_DISABLED},
		}, nil
	}

	if rec.Kind == runtimev1.ConnectorKind_CONNECTOR_KIND_LOCAL_MODEL {
		if s.localModelLister() == nil {
			s.emitAudit(ctx, "connector.test", runtimev1.ReasonCode_ACTION_EXECUTED, auditPayload)
			return &runtimev1.TestConnectorResponse{
				Ack: &runtimev1.Ack{Ok: true},
			}, nil
		}
		localModels, listErr := s.listAllActiveLocalModels(ctx)
		if listErr != nil {
			return nil, s.internalProviderError("test_connector.list_local_models", listErr)
		}
		if !hasActiveLocalModelForCategory(localModels, rec.LocalCategory) {
			s.emitAudit(ctx, "connector.test", runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, auditPayload)
			return &runtimev1.TestConnectorResponse{
				Ack: &runtimev1.Ack{Ok: false, ReasonCode: runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE},
			}, nil
		}
		s.emitAudit(ctx, "connector.test", runtimev1.ReasonCode_ACTION_EXECUTED, auditPayload)
		return &runtimev1.TestConnectorResponse{
			Ack: &runtimev1.Ack{Ok: true},
		}, nil
	}

	apiKey, err := s.store.LoadCredential(connectorID)
	if err != nil {
		return nil, s.internalProviderError("test_connector.load_credential", err)
	}
	if apiKey == "" {
		s.emitAudit(ctx, "connector.test", runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING, auditPayload)
		return &runtimev1.TestConnectorResponse{
			Ack: &runtimev1.Ack{Ok: false, ReasonCode: runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING},
		}, nil
	}

	if cloud := s.cloudProvider(); cloud != nil {
		backend, _, probeErr := cloud.ResolveProbeBackend(rec.Provider, rec.Endpoint, apiKey)
		if probeErr != nil {
			s.emitAudit(ctx, "connector.test", runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, auditPayload)
			return &runtimev1.TestConnectorResponse{
				Ack: &runtimev1.Ack{Ok: false, ReasonCode: runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE},
			}, nil
		}
		_, listErr := backend.ListModels(ctx)
		if listErr != nil {
			s.logger.Warn("connector test probe failed", "connector_id", connectorID, "error", listErr)
			reasonCode := runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE
			if extracted, ok := grpcerr.ExtractReasonCode(listErr); ok {
				reasonCode = extracted
			}
			s.emitAudit(ctx, "connector.test", reasonCode, auditPayload)
			return &runtimev1.TestConnectorResponse{
				Ack: &runtimev1.Ack{Ok: false, ReasonCode: reasonCode},
			}, nil
		}
	}

	s.emitAudit(ctx, "connector.test", runtimev1.ReasonCode_ACTION_EXECUTED, auditPayload)
	return &runtimev1.TestConnectorResponse{
		Ack: &runtimev1.Ack{Ok: true},
	}, nil
}

func (s *Service) ListConnectorModels(ctx context.Context, req *runtimev1.ListConnectorModelsRequest) (*runtimev1.ListConnectorModelsResponse, error) {
	connectorID := strings.TrimSpace(req.GetConnectorId())
	if connectorID == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
	}

	ownerID, hasOwner := subjectUserIDFromContext(ctx)
	rec, found, err := s.store.Get(connectorID)
	if err != nil {
		return nil, s.internalProviderError("list_connector_models.load", err)
	}
	if !found || !connectorVisibleToCaller(rec, ownerID, hasOwner) {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND)
	}

	if rec.Status == runtimev1.ConnectorStatus_CONNECTOR_STATUS_DISABLED {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONNECTOR_DISABLED)
	}

	filterDigest := pagination.FilterDigest(connectorID)
	cursor, err := pagination.ValidatePageToken(req.GetPageToken(), filterDigest)
	if err != nil {
		return nil, err
	}

	var models []*runtimev1.ConnectorModelDescriptor
	if rec.Kind == runtimev1.ConnectorKind_CONNECTOR_KIND_LOCAL_MODEL {
		if s.localModelLister() == nil {
			models = []*runtimev1.ConnectorModelDescriptor{}
		} else {
			localModels, listErr := s.listAllActiveLocalModels(ctx)
			if listErr != nil {
				return nil, s.internalProviderError("list_connector_models.list_local_models", listErr)
			}
			models = buildLocalConnectorModelDescriptors(localModels, rec.LocalCategory)
		}
	} else {
		models, err = s.listCatalogConnectorModels(ownerID, rec.Provider)
		if err != nil {
			return nil, err
		}
	}

	sort.Slice(models, func(i, j int) bool {
		if models[i].GetModelId() == models[j].GetModelId() {
			return models[i].GetModelLabel() < models[j].GetModelLabel()
		}
		return models[i].GetModelId() < models[j].GetModelId()
	})

	startIdx := 0
	if cursor != "" {
		if idx, convErr := strconv.Atoi(cursor); convErr == nil && idx >= 0 && idx <= len(models) {
			startIdx = idx
		} else {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PAGE_TOKEN_INVALID)
		}
	}

	pageSize := int(req.GetPageSize())
	if pageSize <= 0 {
		pageSize = 50
	} else if pageSize > 200 {
		pageSize = 200
	}
	endIdx := startIdx + pageSize
	if endIdx > len(models) {
		endIdx = len(models)
	}

	nextToken := ""
	if endIdx < len(models) {
		nextToken = pagination.Encode(strconv.Itoa(endIdx), filterDigest)
	}

	return &runtimev1.ListConnectorModelsResponse{
		Models:        models[startIdx:endIdx],
		NextPageToken: nextToken,
	}, nil
}
