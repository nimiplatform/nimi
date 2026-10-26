package connector

import (
	"context"
	"sort"
	"strconv"
	"strings"
	"time"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/pagination"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.r025
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
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND)
	}

	if rec.Status == runtimev1.ConnectorStatus_CONNECTOR_STATUS_DISABLED {
		s.emitAudit(ctx, "connector.test", runtimev1.ReasonCode_AI_CONNECTOR_DISABLED, auditPayload)
		return &runtimev1.TestConnectorResponse{
			Ack: &runtimev1.Ack{Ok: false, ReasonCode: runtimev1.ReasonCode_AI_CONNECTOR_DISABLED},
		}, nil
	}

	if IsRetiredLocalConnectorKind(rec.Kind) {
		s.emitAudit(ctx, "connector.test", runtimev1.ReasonCode_AI_LOCAL_CONNECTOR_RETIRED, auditPayload)
		return &runtimev1.TestConnectorResponse{
			Ack: &runtimev1.Ack{Ok: false, ReasonCode: runtimev1.ReasonCode_AI_LOCAL_CONNECTOR_RETIRED},
		}, nil
	}
	if !storedConnectorProviderAdmitted(rec) {
		s.emitAudit(ctx, "connector.test", runtimev1.ReasonCode_AI_CONNECTOR_INVALID, auditPayload)
		return &runtimev1.TestConnectorResponse{
			Ack: &runtimev1.Ack{Ok: false, ReasonCode: runtimev1.ReasonCode_AI_CONNECTOR_INVALID},
		}, nil
	}
	rec, secretPayload, found, err := s.store.captureCheck(connectorID)
	if err != nil {
		return nil, s.internalProviderError("test_connector.load_credential", err)
	}
	if !found || !connectorVisibleToCaller(rec, ownerID, hasOwner) {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND)
	}
	if rec.Status != runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONNECTOR_DISABLED)
	}
	started := s.store.now().UnixNano()
	finish := func(reason runtimev1.ReasonCode, hint string) (*runtimev1.TestConnectorResponse, error) {
		check := ConnectionCheck{OK: reason == runtimev1.ReasonCode_ACTION_EXECUTED, Reason: reason, CheckedAt: s.store.now().UnixMilli(), StartedAt: started}
		updated, accepted, err := s.store.saveConnectionCheck(rec, check)
		if err != nil {
			return nil, s.internalProviderError("test_connector.persist", err)
		}
		if !accepted {
			return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
		}
		s.emitAudit(ctx, "connector.test", reason, auditPayload)
		return &runtimev1.TestConnectorResponse{Ack: &runtimev1.Ack{Ok: check.OK, ReasonCode: reason, ActionHint: hint}, Connector: recordToProto(updated)}, nil
	}
	probeCtx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()
	if IsChatGPTPlanRecord(rec) {
		reason, hint := s.testChatGPTPlanConnector(probeCtx, rec)
		return finish(reason, hint)
	}
	resolvedCredential := ResolveCredential(rec, secretPayload)
	if resolvedCredential.APIKey == "" {
		return finish(runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING, "")
	}

	cloud := s.cloudProvider()
	if cloud == nil {
		return finish(runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, "")
	}
	probeErr := cloud.ProbeConnector(probeCtx, rec.Provider, rec.Endpoint, resolvedCredential.APIKey, resolvedCredential.Headers)
	if probeErr != nil {
		s.logger.Warn("connector test probe failed", "connector_id", connectorID, "error", probeErr)
		reasonCode := runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE
		if extracted, ok := grpcerr.ExtractReasonCode(probeErr); ok {
			reasonCode = extracted
		}
		return finish(reasonCode, "")
	}

	return finish(runtimev1.ReasonCode_ACTION_EXECUTED, "")
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
	if IsRetiredLocalConnectorKind(rec.Kind) {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CONNECTOR_RETIRED)
	}
	if !storedConnectorProviderAdmitted(rec) {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
	}

	filterDigest := pagination.FilterDigest(connectorID)
	cursor, err := pagination.ValidatePageToken(req.GetPageToken(), filterDigest)
	if err != nil {
		return nil, err
	}

	var models []*runtimev1.ConnectorModelDescriptor
	providerCatalogEntry := ProviderCatalog[strings.TrimSpace(rec.Provider)]
	if IsChatGPTPlanRecord(rec) {
		models, err = s.listChatGPTPlanConnectorModels(ctx, ownerID, rec)
	} else if providerCatalogEntry.InventoryMode == "dynamic_endpoint" {
		models, err = s.listCatalogConnectorModels(ownerID, rec.Provider, rec)
	} else {
		models, err = s.listCatalogConnectorModels(ownerID, rec.Provider, rec)
	}
	if err != nil {
		return nil, err
	}

	sort.Slice(models, func(i, j int) bool {
		if models[i].GetProviderModelId() == models[j].GetProviderModelId() {
			if models[i].GetRemoteModelCatalogId() == models[j].GetRemoteModelCatalogId() {
				return models[i].GetModelLabel() < models[j].GetModelLabel()
			}
			return models[i].GetRemoteModelCatalogId() < models[j].GetRemoteModelCatalogId()
		}
		return models[i].GetProviderModelId() < models[j].GetProviderModelId()
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
