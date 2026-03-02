package connector

import (
	"context"
	"log/slog"
	"sort"
	"strconv"
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/modelregistry"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/pagination"
)

const maxConnectorsPerUser = 128

// Service implements RuntimeConnectorServiceServer.
type Service struct {
	runtimev1.UnimplementedRuntimeConnectorServiceServer
	logger     *slog.Logger
	store      *ConnectorStore
	modelCache *ModelCache
	audit      *auditlog.Store
	cloud      *nimillm.CloudProvider
}

// New creates a new ConnectorService.
func New(logger *slog.Logger, store *ConnectorStore, audit *auditlog.Store) *Service {
	return &Service{
		logger:     logger,
		store:      store,
		modelCache: NewModelCache(),
		audit:      audit,
	}
}

// SetCloudProvider sets the cloud provider for probe and model listing.
func (s *Service) SetCloudProvider(cloud *nimillm.CloudProvider) {
	s.cloud = cloud
}

func (s *Service) internalProviderError(operation string, err error) error {
	if err != nil {
		s.logger.Error("connector service internal error", "operation", operation, "error", err)
	} else {
		s.logger.Error("connector service internal error", "operation", operation)
	}
	return grpcerr.WithReasonCodeOptions(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, grpcerr.ReasonOptions{
		ActionHint: "retry_or_check_runtime_logs",
	})
}

func (s *Service) CreateConnector(_ context.Context, req *runtimev1.CreateConnectorRequest) (*runtimev1.CreateConnectorResponse, error) {
	provider := strings.TrimSpace(req.GetProvider())
	if provider == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
	}
	if !IsKnownProvider(provider) {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
	}

	apiKey := strings.TrimSpace(req.GetApiKey())
	if apiKey == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING)
	}

	ownerID := strings.TrimSpace(req.GetOwnerId())
	if ownerID == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
	}

	// Enforce per-user limit
	existing, err := s.store.Load()
	if err != nil {
		return nil, s.internalProviderError("create_connector.load_connectors", err)
	}
	count := 0
	for _, r := range existing {
		if r.OwnerID == ownerID && r.Kind == runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED {
			count++
		}
	}
	if count >= maxConnectorsPerUser {
		return nil, grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_AI_CONNECTOR_LIMIT_EXCEEDED)
	}

	endpoint := strings.TrimSpace(req.GetEndpoint())
	if endpoint == "" {
		endpoint = ResolveEndpoint(provider, "")
	}

	// Validate endpoint requirement
	if entry, ok := ProviderCatalog[provider]; ok && entry.RequiresExplicitEndpoint && endpoint == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
	}

	rec := ConnectorRecord{
		Kind:      runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
		OwnerType: runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER,
		OwnerID:   ownerID,
		Provider:  provider,
		Endpoint:  endpoint,
		Label:     strings.TrimSpace(req.GetLabel()),
		Status:    runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
	}

	if err := s.store.Create(rec, apiKey); err != nil {
		return nil, s.internalProviderError("create_connector.persist", err)
	}

	// Re-read to get the generated ID and timestamps
	records, err := s.store.Load()
	if err != nil {
		return nil, s.internalProviderError("create_connector.reload_connectors", err)
	}
	for i := len(records) - 1; i >= 0; i-- {
		if records[i].OwnerID == ownerID && records[i].Provider == provider {
			return &runtimev1.CreateConnectorResponse{
				Connector: recordToProto(records[i]),
			}, nil
		}
	}
	return nil, s.internalProviderError("create_connector.reload_missing_record", nil)
}

func (s *Service) GetConnector(_ context.Context, req *runtimev1.GetConnectorRequest) (*runtimev1.GetConnectorResponse, error) {
	connectorID := strings.TrimSpace(req.GetConnectorId())
	if connectorID == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
	}

	rec, found, err := s.store.Get(connectorID)
	if err != nil {
		return nil, s.internalProviderError("get_connector.load", err)
	}

	ownerID := strings.TrimSpace(req.GetOwnerId())
	// Information hiding: delete_pending or owner mismatch → NOT_FOUND
	if !found || (rec.Kind == runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED && ownerID != "" && rec.OwnerID != ownerID) {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND)
	}

	return &runtimev1.GetConnectorResponse{
		Connector: recordToProto(rec),
	}, nil
}

func (s *Service) ListConnectors(_ context.Context, req *runtimev1.ListConnectorsRequest) (*runtimev1.ListConnectorsResponse, error) {
	records, err := s.store.Load()
	if err != nil {
		return nil, s.internalProviderError("list_connectors.load", err)
	}

	ownerID := strings.TrimSpace(req.GetOwnerId())
	kindFilter := req.GetKindFilter()
	statusFilter := req.GetStatusFilter()
	providerFilter := strings.TrimSpace(req.GetProviderFilter())

	// Build filter digest for pagination token validation (K-PAGE-003)
	filterDigest := pagination.FilterDigest(
		ownerID,
		kindFilter.String(),
		statusFilter.String(),
		providerFilter,
	)

	// Validate page_token (K-PAGE-002)
	cursor, err := pagination.ValidatePageToken(req.GetPageToken(), filterDigest)
	if err != nil {
		return nil, err
	}

	// Filter
	filtered := make([]ConnectorRecord, 0, len(records))
	for _, r := range records {
		// Owner visibility: system connectors visible to all, user-owned filtered by owner
		if r.OwnerType != runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_SYSTEM {
			if ownerID != "" && r.OwnerID != ownerID {
				continue
			}
		}
		// Kind filter
		if kindFilter != runtimev1.ConnectorKind_CONNECTOR_KIND_UNSPECIFIED && r.Kind != kindFilter {
			continue
		}
		// Status filter
		if statusFilter != runtimev1.ConnectorStatus_CONNECTOR_STATUS_UNSPECIFIED && r.Status != statusFilter {
			continue
		}
		// Provider filter
		if providerFilter != "" && r.Provider != providerFilter {
			continue
		}
		filtered = append(filtered, r)
	}

	// Sort (K-PAGE-004): LOCAL_MODEL first → category ASC → connector_id ASC;
	// REMOTE_MANAGED → created_at DESC → connector_id ASC
	sort.Slice(filtered, func(i, j int) bool {
		ri, rj := filtered[i], filtered[j]
		// Local connectors before remote
		if ri.Kind != rj.Kind {
			return ri.Kind == runtimev1.ConnectorKind_CONNECTOR_KIND_LOCAL_MODEL
		}
		if ri.Kind == runtimev1.ConnectorKind_CONNECTOR_KIND_LOCAL_MODEL {
			if ri.LocalCategory != rj.LocalCategory {
				return ri.LocalCategory < rj.LocalCategory
			}
			return ri.ConnectorID < rj.ConnectorID
		}
		// REMOTE_MANAGED: created_at DESC, then connector_id ASC
		if ri.CreatedAt != rj.CreatedAt {
			return ri.CreatedAt > rj.CreatedAt
		}
		return ri.ConnectorID < rj.ConnectorID
	})

	// Apply cursor-based pagination
	startIdx := 0
	if cursor != "" {
		if idx, convErr := strconv.Atoi(cursor); convErr == nil && idx > 0 && idx <= len(filtered) {
			startIdx = idx
		}
	}

	pageSize := int(req.GetPageSize())
	if pageSize <= 0 || pageSize > 100 {
		pageSize = 50
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

func (s *Service) UpdateConnector(_ context.Context, req *runtimev1.UpdateConnectorRequest) (*runtimev1.UpdateConnectorResponse, error) {
	connectorID := strings.TrimSpace(req.GetConnectorId())
	if connectorID == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
	}

	ownerID := strings.TrimSpace(req.GetOwnerId())
	rec, found, err := s.store.Get(connectorID)
	if err != nil {
		return nil, s.internalProviderError("update_connector.load", err)
	}
	if !found {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND)
	}

	// Owner check
	if rec.Kind == runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED && ownerID != "" && rec.OwnerID != ownerID {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND)
	}

	// Immutability check for local connectors (only status can change)
	if rec.Kind == runtimev1.ConnectorKind_CONNECTOR_KIND_LOCAL_MODEL {
		if req.GetLabel() != "" || req.GetEndpoint() != "" || req.GetApiKey() != "" {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_IMMUTABLE)
		}
	}

	// System cloud connectors are managed by config.json, not via API
	if rec.OwnerType == runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_SYSTEM &&
		rec.Kind == runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_IMMUTABLE)
	}

	var mutations ConnectorMutations
	hasChange := false

	if v := strings.TrimSpace(req.GetLabel()); v != "" {
		mutations.Label = &v
		hasChange = true
	}
	if v := strings.TrimSpace(req.GetEndpoint()); v != "" {
		mutations.Endpoint = &v
		hasChange = true
	}
	if v := req.GetApiKey(); v != "" {
		trimmed := strings.TrimSpace(v)
		mutations.APIKey = &trimmed
		hasChange = true
	}
	if req.GetStatus() != runtimev1.ConnectorStatus_CONNECTOR_STATUS_UNSPECIFIED {
		st := req.GetStatus()
		mutations.Status = &st
		hasChange = true
	}

	if !hasChange {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
	}

	// If api_key or endpoint changed, invalidate model cache
	if mutations.APIKey != nil || mutations.Endpoint != nil {
		s.modelCache.Invalidate(connectorID)
	}

	updated, err := s.store.Update(connectorID, mutations)
	if err != nil {
		return nil, s.internalProviderError("update_connector.persist", err)
	}

	return &runtimev1.UpdateConnectorResponse{
		Connector: recordToProto(updated),
	}, nil
}

func (s *Service) DeleteConnector(_ context.Context, req *runtimev1.DeleteConnectorRequest) (*runtimev1.DeleteConnectorResponse, error) {
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

	// System connectors (local + system cloud) cannot be deleted via API
	if rec.Kind == runtimev1.ConnectorKind_CONNECTOR_KIND_LOCAL_MODEL ||
		rec.OwnerType == runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_SYSTEM {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_IMMUTABLE)
	}

	// Owner check
	ownerID := strings.TrimSpace(req.GetOwnerId())
	if ownerID != "" && rec.OwnerID != ownerID {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND)
	}

	if err := s.store.Delete(connectorID); err != nil {
		return nil, s.internalProviderError("delete_connector.persist", err)
	}

	s.modelCache.Invalidate(connectorID)

	return &runtimev1.DeleteConnectorResponse{
		Ack: &runtimev1.Ack{Ok: true},
	}, nil
}

func (s *Service) TestConnector(ctx context.Context, req *runtimev1.TestConnectorRequest) (*runtimev1.TestConnectorResponse, error) {
	connectorID := strings.TrimSpace(req.GetConnectorId())
	if connectorID == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
	}

	ownerID := strings.TrimSpace(req.GetOwnerId())
	rec, found, err := s.store.Get(connectorID)
	if err != nil {
		return nil, s.internalProviderError("test_connector.load", err)
	}
	if !found || (rec.Kind == runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED && ownerID != "" && rec.OwnerID != ownerID) {
		return &runtimev1.TestConnectorResponse{
			Ack: &runtimev1.Ack{Ok: false, ReasonCode: runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND},
		}, nil
	}

	// Status check
	if rec.Status == runtimev1.ConnectorStatus_CONNECTOR_STATUS_DISABLED {
		return &runtimev1.TestConnectorResponse{
			Ack: &runtimev1.Ack{Ok: false, ReasonCode: runtimev1.ReasonCode_AI_CONNECTOR_DISABLED},
		}, nil
	}

	// Local connectors always pass test
	if rec.Kind == runtimev1.ConnectorKind_CONNECTOR_KIND_LOCAL_MODEL {
		return &runtimev1.TestConnectorResponse{
			Ack: &runtimev1.Ack{Ok: true},
		}, nil
	}

	// Credential check
	apiKey, err := s.store.LoadCredential(connectorID)
	if err != nil {
		return nil, s.internalProviderError("test_connector.load_credential", err)
	}
	if apiKey == "" {
		return &runtimev1.TestConnectorResponse{
			Ack: &runtimev1.Ack{Ok: false, ReasonCode: runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING},
		}, nil
	}

	// Probe endpoint via CloudProvider
	if s.cloud != nil {
		backend, _, probeErr := s.cloud.ResolveProbeBackend(rec.Provider, rec.Endpoint, apiKey)
		if probeErr != nil {
			return &runtimev1.TestConnectorResponse{
				Ack: &runtimev1.Ack{Ok: false, ReasonCode: runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE},
			}, nil
		}
		models, listErr := backend.ListModels(ctx)
		if listErr != nil {
			s.logger.Warn("connector test probe failed", "connector_id", connectorID, "error", listErr)
			return &runtimev1.TestConnectorResponse{
				Ack: &runtimev1.Ack{Ok: false, ReasonCode: runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE},
			}, nil
		}
		_ = models // probe succeeded
	}

	return &runtimev1.TestConnectorResponse{
		Ack: &runtimev1.Ack{Ok: true},
	}, nil
}

func (s *Service) ListConnectorModels(ctx context.Context, req *runtimev1.ListConnectorModelsRequest) (*runtimev1.ListConnectorModelsResponse, error) {
	connectorID := strings.TrimSpace(req.GetConnectorId())
	if connectorID == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
	}

	ownerID := strings.TrimSpace(req.GetOwnerId())
	rec, found, err := s.store.Get(connectorID)
	if err != nil {
		return nil, s.internalProviderError("list_connector_models.load", err)
	}
	if !found || (rec.Kind == runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED && ownerID != "" && rec.OwnerID != ownerID) {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND)
	}

	if rec.Status == runtimev1.ConnectorStatus_CONNECTOR_STATUS_DISABLED {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONNECTOR_DISABLED)
	}

	// Check cache (unless force_refresh)
	if !req.GetForceRefresh() {
		if cached := s.modelCache.Get(connectorID); cached != nil {
			return &runtimev1.ListConnectorModelsResponse{Models: cached}, nil
		}
	}

	// Local connectors return empty model list (managed by local runtime)
	if rec.Kind == runtimev1.ConnectorKind_CONNECTOR_KIND_LOCAL_MODEL {
		return &runtimev1.ListConnectorModelsResponse{}, nil
	}

	// Load credential
	apiKey, err := s.store.LoadCredential(connectorID)
	if err != nil {
		return nil, s.internalProviderError("list_connector_models.load_credential", err)
	}
	if apiKey == "" {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING)
	}

	// Fetch models via backend
	var models []*runtimev1.ConnectorModelDescriptor
	if s.cloud != nil {
		backend, _, probeErr := s.cloud.ResolveProbeBackend(rec.Provider, rec.Endpoint, apiKey)
		if probeErr != nil {
			return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
		}
		rawModels, listErr := backend.ListModels(ctx)
		if listErr != nil {
			s.logger.Warn("list connector models failed", "connector_id", connectorID, "error", listErr)
			return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
		}
		for _, m := range rawModels {
			models = append(models, &runtimev1.ConnectorModelDescriptor{
				ModelId:      m.ModelID,
				ModelLabel:   m.ModelLabel,
				Available:    m.Available,
				Capabilities: modelregistry.InferCapabilities(m.ModelID),
			})
		}
	}

	s.modelCache.Set(connectorID, models)

	return &runtimev1.ListConnectorModelsResponse{
		Models: models,
	}, nil
}

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

func (s *Service) Store() *ConnectorStore {
	return s.store
}

func recordToProto(r ConnectorRecord) *runtimev1.Connector {
	return &runtimev1.Connector{
		ConnectorId:   r.ConnectorID,
		Kind:          r.Kind,
		OwnerType:     r.OwnerType,
		OwnerId:       r.OwnerID,
		Provider:      r.Provider,
		Endpoint:      r.Endpoint,
		Label:         r.Label,
		Status:        r.Status,
		LocalCategory: r.LocalCategory,
		HasCredential: r.HasCredential,
		CreatedAt:     r.CreatedAt,
		UpdatedAt:     r.UpdatedAt,
	}
}
