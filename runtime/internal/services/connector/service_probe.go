package connector

import (
	"context"
	"path"
	"sort"
	"strconv"
	"strings"
	"time"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/pagination"
)

func cloneConnectorModelDescriptors(models []*runtimev1.ConnectorModelDescriptor) []*runtimev1.ConnectorModelDescriptor {
	out := make([]*runtimev1.ConnectorModelDescriptor, 0, len(models))
	for _, item := range models {
		if item == nil {
			continue
		}
		out = append(out, &runtimev1.ConnectorModelDescriptor{
			ModelId:      item.GetModelId(),
			ModelLabel:   item.GetModelLabel(),
			Available:    item.GetAvailable(),
			Capabilities: append([]string(nil), item.GetCapabilities()...),
		})
	}
	return out
}

func (s *Service) loadDynamicConnectorModelsFromCache(connectorID string) ([]*runtimev1.ConnectorModelDescriptor, bool) {
	s.dynamicModelsMu.RLock()
	defer s.dynamicModelsMu.RUnlock()
	entry, ok := s.dynamicModelsCache[connectorID]
	if !ok || time.Now().After(entry.expiresAt) {
		return nil, false
	}
	return cloneConnectorModelDescriptors(entry.models), true
}

func (s *Service) storeDynamicConnectorModelsCache(connectorID string, ttlSeconds int, models []*runtimev1.ConnectorModelDescriptor) {
	s.dynamicModelsMu.Lock()
	defer s.dynamicModelsMu.Unlock()
	s.dynamicModelsCache[connectorID] = dynamicConnectorModelsCacheEntry{
		models:    cloneConnectorModelDescriptors(models),
		expiresAt: time.Now().Add(time.Duration(ttlSeconds) * time.Second),
	}
}

func matchesDynamicModelPattern(modelID string, pattern string) bool {
	normalizedModelID := strings.TrimSpace(modelID)
	normalizedPattern := strings.TrimSpace(pattern)
	if normalizedModelID == "" || normalizedPattern == "" {
		return false
	}
	if ok, err := path.Match(normalizedPattern, normalizedModelID); err == nil && ok {
		return true
	}
	return strings.EqualFold(normalizedModelID, normalizedPattern)
}

func dynamicModelMatchesAnyPattern(modelID string, patterns []string) bool {
	for _, pattern := range patterns {
		if matchesDynamicModelPattern(modelID, pattern) {
			return true
		}
	}
	return false
}

func preferredDynamicModelRank(modelID string, patterns []string) int {
	for index, pattern := range patterns {
		if matchesDynamicModelPattern(modelID, pattern) {
			return index
		}
	}
	return len(patterns) + 1000
}

func applyDynamicProviderPolicy(entry ProviderCatalogEntry, discovered []nimillm.ProbeModel) []*runtimev1.ConnectorModelDescriptor {
	allowedCapabilities := append([]string(nil), entry.DynamicAllowedCapabilities...)
	descriptors := make([]*runtimev1.ConnectorModelDescriptor, 0, len(discovered))
	for _, item := range discovered {
		modelID := strings.TrimSpace(item.ModelID)
		if modelID == "" {
			continue
		}
		if dynamicModelMatchesAnyPattern(modelID, entry.DynamicDenyModelPatterns) {
			continue
		}
		if entry.DynamicSelectionMode == "curated_filter" {
			if len(entry.DynamicAllowModelPatterns) > 0 || len(entry.DynamicPreferredModelPatterns) > 0 {
				if !dynamicModelMatchesAnyPattern(modelID, entry.DynamicAllowModelPatterns) &&
					!dynamicModelMatchesAnyPattern(modelID, entry.DynamicPreferredModelPatterns) {
					continue
				}
			}
		}
		label := strings.TrimSpace(item.ModelLabel)
		if label == "" {
			label = modelID
		}
		capabilities := intersectDynamicCapabilities(item.Capabilities, allowedCapabilities)
		descriptors = append(descriptors, &runtimev1.ConnectorModelDescriptor{
			ModelId:      modelID,
			ModelLabel:   label,
			Available:    item.Available,
			Capabilities: capabilities,
		})
	}
	sort.Slice(descriptors, func(i, j int) bool {
		leftRank := preferredDynamicModelRank(descriptors[i].GetModelId(), entry.DynamicPreferredModelPatterns)
		rightRank := preferredDynamicModelRank(descriptors[j].GetModelId(), entry.DynamicPreferredModelPatterns)
		if leftRank != rightRank {
			return leftRank < rightRank
		}
		if descriptors[i].GetModelLabel() == descriptors[j].GetModelLabel() {
			return descriptors[i].GetModelId() < descriptors[j].GetModelId()
		}
		return descriptors[i].GetModelLabel() < descriptors[j].GetModelLabel()
	})
	return descriptors
}

func intersectDynamicCapabilities(discovered []string, allowed []string) []string {
	if len(discovered) == 0 {
		return nil
	}
	if len(allowed) == 0 {
		return append([]string(nil), discovered...)
	}
	allowedSet := make(map[string]struct{}, len(allowed))
	for _, capability := range allowed {
		normalized := strings.TrimSpace(capability)
		if normalized == "" {
			continue
		}
		allowedSet[normalized] = struct{}{}
	}
	out := make([]string, 0, len(discovered))
	for _, capability := range discovered {
		normalized := strings.TrimSpace(capability)
		if normalized == "" {
			continue
		}
		if _, ok := allowedSet[normalized]; !ok {
			continue
		}
		out = append(out, normalized)
	}
	return out
}

func (s *Service) listDynamicConnectorModels(ctx context.Context, connectorID string, rec ConnectorRecord, forceRefresh bool) ([]*runtimev1.ConnectorModelDescriptor, error) {
	entry, ok := ProviderCatalog[rec.Provider]
	if !ok || entry.InventoryMode != "dynamic_endpoint" {
		return s.listCatalogConnectorModels("", rec.Provider)
	}
	if !forceRefresh {
		if cached, ok := s.loadDynamicConnectorModelsFromCache(connectorID); ok {
			return cached, nil
		}
	}
	secretPayload, err := s.store.LoadSecretPayload(connectorID)
	if err != nil {
		return nil, s.internalProviderError("list_connector_models.load_credential", err)
	}
	resolvedCredential := ResolveCredential(rec, secretPayload)
	if resolvedCredential.APIKey == "" {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING)
	}
	cloud := s.cloudProvider()
	if cloud == nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, grpcerr.ReasonOptions{
			ActionHint: "check_runtime_cloud_provider",
		})
	}
	backend, _, err := cloud.ResolveProbeBackend(rec.Provider, rec.Endpoint, resolvedCredential.APIKey, resolvedCredential.Headers)
	if err != nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, grpcerr.ReasonOptions{
			ActionHint: "check_connector_endpoint_or_provider_support",
			Message:    err.Error(),
		})
	}
	discovered, err := backend.ListModels(ctx)
	if err != nil {
		if entry.DynamicFailurePolicy == "use_cache_then_fail_closed" {
			if cached, ok := s.loadDynamicConnectorModelsFromCache(connectorID); ok {
				return cached, nil
			}
		}
		return nil, err
	}
	descriptors := applyDynamicProviderPolicy(entry, discovered)
	s.storeDynamicConnectorModelsCache(connectorID, entry.DynamicCacheTTLSeconds, descriptors)
	return descriptors, nil
}

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

	secretPayload, err := s.store.LoadSecretPayload(connectorID)
	if err != nil {
		return nil, s.internalProviderError("test_connector.load_credential", err)
	}
	resolvedCredential := ResolveCredential(rec, secretPayload)
	if resolvedCredential.APIKey == "" {
		s.emitAudit(ctx, "connector.test", runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING, auditPayload)
		return &runtimev1.TestConnectorResponse{
			Ack: &runtimev1.Ack{Ok: false, ReasonCode: runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING},
		}, nil
	}

	if cloud := s.cloudProvider(); cloud != nil {
		backend, _, probeErr := cloud.ResolveProbeBackend(rec.Provider, rec.Endpoint, resolvedCredential.APIKey, resolvedCredential.Headers)
		if probeErr != nil {
			s.emitAudit(ctx, "connector.test", runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, auditPayload)
			return &runtimev1.TestConnectorResponse{
				Ack: &runtimev1.Ack{Ok: false, ReasonCode: runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE},
			}, nil
		}
		probeErr = backend.ProbeConnector(ctx)
		if probeErr != nil {
			s.logger.Warn("connector test probe failed", "connector_id", connectorID, "error", probeErr)
			reasonCode := runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE
			if extracted, ok := grpcerr.ExtractReasonCode(probeErr); ok {
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
		if entry, ok := ProviderCatalog[rec.Provider]; ok && entry.InventoryMode == "dynamic_endpoint" {
			models, err = s.listDynamicConnectorModels(ctx, connectorID, rec, req.GetForceRefresh())
			if err != nil {
				return nil, err
			}
		} else {
			models, err = s.listCatalogConnectorModels(ownerID, rec.Provider)
			if err != nil {
				return nil, err
			}
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
