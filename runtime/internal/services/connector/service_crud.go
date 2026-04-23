package connector

import (
	"context"
	"errors"
	"sort"
	"strconv"
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/pagination"
)

func (s *Service) CreateConnector(ctx context.Context, req *runtimev1.CreateConnectorRequest) (*runtimev1.CreateConnectorResponse, error) {
	provider := strings.TrimSpace(req.GetProvider())
	if provider == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
	}
	if !IsKnownProvider(provider) {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
	}
	capability, hasCapability := ProviderCapabilities[provider]
	if !hasCapability || capability.RuntimePlane != "remote" || !capability.ManagedSupported {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
	}

	apiKey := strings.TrimSpace(req.GetApiKey())
	credentialJSON := strings.TrimSpace(req.GetCredentialJson())
	authKind := req.GetAuthKind()
	if authKind == runtimev1.ConnectorAuthKind_CONNECTOR_AUTH_KIND_UNSPECIFIED {
		if credentialJSON != "" {
			authKind = runtimev1.ConnectorAuthKind_CONNECTOR_AUTH_KIND_OAUTH_MANAGED
		} else {
			authKind = runtimev1.ConnectorAuthKind_CONNECTOR_AUTH_KIND_API_KEY
		}
	}
	providerAuthProfile := strings.TrimSpace(req.GetProviderAuthProfile())
	if apiKey != "" && credentialJSON != "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
	}
	secretPayload := ""
	switch authKind {
	case runtimev1.ConnectorAuthKind_CONNECTOR_AUTH_KIND_API_KEY:
		if apiKey == "" {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING)
		}
		if providerAuthProfile != "" {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
		}
		secretPayload = apiKey
	case runtimev1.ConnectorAuthKind_CONNECTOR_AUTH_KIND_OAUTH_MANAGED:
		if providerAuthProfile == "" || credentialJSON == "" {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING)
		}
		if apiKey != "" {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
		}
		profile, ok := LookupProviderAuthProfile(providerAuthProfile)
		if !ok || !providerAuthProfileAllowedForProvider(profile, provider) {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
		}
		secretPayload = credentialJSON
	default:
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
	}

	ownerID, hasOwner := subjectUserIDFromContext(ctx)
	if authKind == runtimev1.ConnectorAuthKind_CONNECTOR_AUTH_KIND_OAUTH_MANAGED && !hasOwner {
		return nil, grpcerr.WithReasonCode(codes.Unauthenticated, runtimev1.ReasonCode_AUTH_TOKEN_INVALID)
	}

	endpoint := strings.TrimSpace(req.GetEndpoint())
	if endpoint == "" {
		endpoint = ResolveEndpoint(provider, "")
	}
	if entry, ok := ProviderCatalog[provider]; ok && entry.RequiresExplicitEndpoint && endpoint == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
	}

	rec := ConnectorRecord{
		Kind:                runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
		Provider:            provider,
		Endpoint:            endpoint,
		Label:               strings.TrimSpace(req.GetLabel()),
		Status:              runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
		AuthKind:            authKind,
		ProviderAuthProfile: providerAuthProfile,
	}
	if hasOwner {
		rec.OwnerType = runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER
		rec.OwnerID = ownerID
	} else {
		rec.OwnerType = runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_SYSTEM
		rec.OwnerID = "machine"
	}
	if rec.Label == "" {
		rec.Label = defaultManagedConnectorLabel(provider)
	}

	created, err := s.store.CreateWithOwnerLimit(rec, secretPayload, maxConnectorsPerUser)
	if err != nil {
		if errors.Is(err, errConnectorLimitExceeded) {
			return nil, grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_AI_CONNECTOR_LIMIT_EXCEEDED)
		}
		s.emitAudit(ctx, "connector.create", runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, map[string]any{
			"provider": provider,
		})
		return nil, s.internalProviderError("create_connector.persist", err)
	}
	s.emitAudit(ctx, "connector.create", runtimev1.ReasonCode_ACTION_EXECUTED, map[string]any{
		"connector_id": created.ConnectorID,
		"provider":     provider,
	})
	s.invalidateDynamicConnectorModelsCache(created.ConnectorID)
	return &runtimev1.CreateConnectorResponse{
		Connector: recordToProto(created),
	}, nil
}

func (s *Service) GetConnector(ctx context.Context, req *runtimev1.GetConnectorRequest) (*runtimev1.GetConnectorResponse, error) {
	connectorID := strings.TrimSpace(req.GetConnectorId())
	if connectorID == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
	}

	rec, found, err := s.store.Get(connectorID)
	if err != nil {
		return nil, s.internalProviderError("get_connector.load", err)
	}

	ownerID, hasOwner := subjectUserIDFromContext(ctx)
	// Information hiding: delete_pending or owner mismatch -> NOT_FOUND.
	// System-owned connectors are visible to all, consistent with ListConnectors.
	if !found || !connectorVisibleToCaller(rec, ownerID, hasOwner) {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND)
	}

	return &runtimev1.GetConnectorResponse{
		Connector: recordToProto(rec),
	}, nil
}

func (s *Service) ListConnectors(ctx context.Context, req *runtimev1.ListConnectorsRequest) (*runtimev1.ListConnectorsResponse, error) {
	records, err := s.store.Load()
	if err != nil {
		return nil, s.internalProviderError("list_connectors.load", err)
	}
	// store.Load already hides delete_pending records, so filtering here only applies business visibility rules.

	ownerID, hasOwner := subjectUserIDFromContext(ctx)
	if !hasOwner {
		ownerID = ""
	}
	kindFilter := req.GetKindFilter()
	statusFilter := req.GetStatusFilter()
	providerFilter := strings.TrimSpace(req.GetProviderFilter())

	filterDigest := pagination.FilterDigest(ownerID, kindFilter.String(), statusFilter.String(), providerFilter)
	cursor, err := pagination.ValidatePageToken(req.GetPageToken(), filterDigest)
	if err != nil {
		return nil, err
	}

	filtered := make([]ConnectorRecord, 0, len(records))
	for _, r := range records {
		if connectorViolatesOAuthManagedUserBoundary(r) {
			continue
		}
		if r.OwnerType != runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_SYSTEM {
			if !hasOwner || r.OwnerID != ownerID {
				continue
			}
		}
		if kindFilter != runtimev1.ConnectorKind_CONNECTOR_KIND_UNSPECIFIED && r.Kind != kindFilter {
			continue
		}
		if statusFilter != runtimev1.ConnectorStatus_CONNECTOR_STATUS_UNSPECIFIED && r.Status != statusFilter {
			continue
		}
		if providerFilter != "" && r.Provider != providerFilter {
			continue
		}
		filtered = append(filtered, r)
	}

	sort.Slice(filtered, func(i, j int) bool {
		ri, rj := filtered[i], filtered[j]
		if ri.Kind != rj.Kind {
			return ri.Kind == runtimev1.ConnectorKind_CONNECTOR_KIND_LOCAL_MODEL
		}
		if ri.Kind == runtimev1.ConnectorKind_CONNECTOR_KIND_LOCAL_MODEL {
			if ri.LocalCategory != rj.LocalCategory {
				return ri.LocalCategory < rj.LocalCategory
			}
			return ri.ConnectorID < rj.ConnectorID
		}
		if ri.CreatedAt != rj.CreatedAt {
			return ri.CreatedAt > rj.CreatedAt
		}
		return ri.ConnectorID < rj.ConnectorID
	})

	startIdx := 0
	if cursor != "" {
		if idx, convErr := strconv.Atoi(cursor); convErr == nil && idx >= 0 && idx <= len(filtered) {
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
	if endIdx > len(filtered) {
		endIdx = len(filtered)
	}

	page := filtered[startIdx:endIdx]
	result := make([]*runtimev1.Connector, len(page))
	for i, r := range page {
		result[i] = recordToProto(r)
	}

	var nextPageToken string
	if endIdx < len(filtered) {
		nextPageToken = pagination.Encode(strconv.Itoa(endIdx), filterDigest)
	}

	return &runtimev1.ListConnectorsResponse{
		Connectors:    result,
		NextPageToken: nextPageToken,
	}, nil
}

func (s *Service) UpdateConnector(ctx context.Context, req *runtimev1.UpdateConnectorRequest) (*runtimev1.UpdateConnectorResponse, error) {
	connectorID := strings.TrimSpace(req.GetConnectorId())
	if connectorID == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
	}

	rec, found, err := s.store.Get(connectorID)
	if err != nil {
		return nil, s.internalProviderError("update_connector.load", err)
	}
	if !found {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND)
	}
	if connectorViolatesOAuthManagedUserBoundary(rec) {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND)
	}
	if rec.OwnerType == runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_SYSTEM &&
		rec.Kind == runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED &&
		rec.OwnerID == "system" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_IMMUTABLE)
	}
	if !(rec.OwnerType == runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_SYSTEM &&
		rec.Kind == runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED &&
		rec.OwnerID == "machine") {
		ownerID, ownerErr := requireSubjectUserID(ctx)
		if ownerErr != nil {
			return nil, ownerErr
		}
		if rec.Kind == runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED && rec.OwnerID != ownerID {
			return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND)
		}
	}

	updatePaths := req.GetUpdateMask().GetPaths()
	if len(updatePaths) == 0 {
		if req.Label != nil {
			updatePaths = append(updatePaths, "label")
		}
		if req.Endpoint != nil {
			updatePaths = append(updatePaths, "endpoint")
		}
		if req.ApiKey != nil {
			updatePaths = append(updatePaths, "api_key")
		}
		if req.AuthKind != nil {
			updatePaths = append(updatePaths, "auth_kind")
		}
		if req.ProviderAuthProfile != nil {
			updatePaths = append(updatePaths, "provider_auth_profile")
		}
		if req.CredentialJson != nil {
			updatePaths = append(updatePaths, "credential_json")
		}
		if req.GetStatus() != runtimev1.ConnectorStatus_CONNECTOR_STATUS_UNSPECIFIED {
			updatePaths = append(updatePaths, "status")
		}
	}

	seenPaths := make(map[string]bool, len(updatePaths))
	var mutations ConnectorMutations
	hasChange := false
	nextAuthKind := normalizeAuthKind(rec.AuthKind)
	nextProviderAuthProfile := strings.TrimSpace(rec.ProviderAuthProfile)
	sawAPIKeyUpdate := false
	sawCredentialJSONUpdate := false

	for _, rawPath := range updatePaths {
		path := strings.TrimSpace(rawPath)
		if path == "" || seenPaths[path] {
			continue
		}
		seenPaths[path] = true

		if rec.Kind == runtimev1.ConnectorKind_CONNECTOR_KIND_LOCAL_MODEL && path != "status" {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_IMMUTABLE)
		}

		switch path {
		case "label":
			if req.Label == nil {
				return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
			}
			value := strings.TrimSpace(req.GetLabel())
			if value == "" {
				return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
			}
			mutations.Label = &value
			hasChange = true
		case "endpoint":
			if req.Endpoint == nil {
				return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
			}
			value := strings.TrimSpace(req.GetEndpoint())
			if value == "" {
				return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
			}
			mutations.Endpoint = &value
			hasChange = true
		case "api_key":
			if req.ApiKey == nil {
				return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
			}
			value := strings.TrimSpace(req.GetApiKey())
			if value == "" {
				return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
			}
			mutations.SecretPayload = &value
			sawAPIKeyUpdate = true
			hasChange = true
		case "auth_kind":
			if req.AuthKind == nil {
				return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
			}
			if req.GetAuthKind() == runtimev1.ConnectorAuthKind_CONNECTOR_AUTH_KIND_UNSPECIFIED {
				return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
			}
			value := normalizeAuthKind(req.GetAuthKind())
			mutations.AuthKind = &value
			nextAuthKind = value
			hasChange = true
		case "provider_auth_profile":
			if req.ProviderAuthProfile == nil {
				return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
			}
			value := strings.TrimSpace(req.GetProviderAuthProfile())
			mutations.ProviderAuthProfile = &value
			nextProviderAuthProfile = value
			hasChange = true
		case "credential_json":
			if req.CredentialJson == nil {
				return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
			}
			value := strings.TrimSpace(req.GetCredentialJson())
			if value == "" {
				return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
			}
			mutations.SecretPayload = &value
			sawCredentialJSONUpdate = true
			hasChange = true
		case "status":
			if req.GetStatus() == runtimev1.ConnectorStatus_CONNECTOR_STATUS_UNSPECIFIED {
				return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
			}
			status := req.GetStatus()
			mutations.Status = &status
			hasChange = true
		default:
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
		}
	}

	if !hasChange {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
	}
	if sawAPIKeyUpdate && sawCredentialJSONUpdate {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
	}
	switch nextAuthKind {
	case runtimev1.ConnectorAuthKind_CONNECTOR_AUTH_KIND_API_KEY:
		if nextProviderAuthProfile != "" {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
		}
		if sawCredentialJSONUpdate {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
		}
		if normalizeAuthKind(rec.AuthKind) != nextAuthKind && !sawAPIKeyUpdate && !(normalizeAuthKind(rec.AuthKind) == runtimev1.ConnectorAuthKind_CONNECTOR_AUTH_KIND_API_KEY && rec.HasCredential) {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING)
		}
	case runtimev1.ConnectorAuthKind_CONNECTOR_AUTH_KIND_OAUTH_MANAGED:
		if nextProviderAuthProfile == "" {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
		}
		profile, ok := LookupProviderAuthProfile(nextProviderAuthProfile)
		if !ok || !providerAuthProfileAllowedForProvider(profile, rec.Provider) {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
		}
		if sawAPIKeyUpdate {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
		}
		if normalizeAuthKind(rec.AuthKind) != nextAuthKind && !sawCredentialJSONUpdate && !(normalizeAuthKind(rec.AuthKind) == runtimev1.ConnectorAuthKind_CONNECTOR_AUTH_KIND_OAUTH_MANAGED && rec.HasCredential) {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING)
		}
	default:
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
	}

	updated, err := s.store.Update(connectorID, mutations)
	if err != nil {
		s.emitAudit(ctx, "connector.update", runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, map[string]any{
			"connector_id": connectorID,
		})
		return nil, s.internalProviderError("update_connector.persist", err)
	}

	s.emitAudit(ctx, "connector.update", runtimev1.ReasonCode_ACTION_EXECUTED, map[string]any{
		"connector_id": connectorID,
	})
	s.invalidateDynamicConnectorModelsCache(connectorID)
	return &runtimev1.UpdateConnectorResponse{
		Connector: recordToProto(updated),
	}, nil
}

func (s *Service) DeleteConnector(ctx context.Context, req *runtimev1.DeleteConnectorRequest) (*runtimev1.DeleteConnectorResponse, error) {
	connectorID := strings.TrimSpace(req.GetConnectorId())
	if connectorID == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
	}

	rec, found, err := s.store.Get(connectorID)
	if err != nil {
		return nil, s.internalProviderError("delete_connector.load", err)
	}
	if !found {
		return &runtimev1.DeleteConnectorResponse{
			Ack: &runtimev1.Ack{Ok: true},
		}, nil
	}
	if connectorViolatesOAuthManagedUserBoundary(rec) {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND)
	}

	if rec.Kind == runtimev1.ConnectorKind_CONNECTOR_KIND_LOCAL_MODEL ||
		(rec.OwnerType == runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_SYSTEM && rec.OwnerID == "system") {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_IMMUTABLE)
	}
	if !(rec.OwnerType == runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_SYSTEM &&
		rec.Kind == runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED &&
		rec.OwnerID == "machine") {
		ownerID, ownerErr := requireSubjectUserID(ctx)
		if ownerErr != nil {
			return nil, ownerErr
		}
		if rec.OwnerID != ownerID {
			return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND)
		}
	}

	if err := s.store.Delete(connectorID); err != nil {
		s.emitAudit(ctx, "connector.delete", runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, map[string]any{
			"connector_id": connectorID,
		})
		return nil, s.internalProviderError("delete_connector.persist", err)
	}

	s.emitAudit(ctx, "connector.delete", runtimev1.ReasonCode_ACTION_EXECUTED, map[string]any{
		"connector_id": connectorID,
	})
	s.invalidateDynamicConnectorModelsCache(connectorID)
	return &runtimev1.DeleteConnectorResponse{
		Ack: &runtimev1.Ack{Ok: true},
	}, nil
}
