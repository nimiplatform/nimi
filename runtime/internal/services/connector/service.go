package connector

import (
	"context"
	"log/slog"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
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

func (s *Service) CreateConnector(_ context.Context, req *runtimev1.CreateConnectorRequest) (*runtimev1.CreateConnectorResponse, error) {
	provider := strings.TrimSpace(req.GetProvider())
	if provider == "" {
		return nil, status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID.String())
	}
	if !IsKnownProvider(provider) {
		return nil, status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID.String())
	}

	apiKey := strings.TrimSpace(req.GetApiKey())

	ownerID := strings.TrimSpace(req.GetOwnerId())
	if ownerID == "" {
		return nil, status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID.String())
	}

	// Enforce per-user limit
	existing, err := s.store.Load()
	if err != nil {
		return nil, status.Errorf(codes.Internal, "load connectors: %v", err)
	}
	count := 0
	for _, r := range existing {
		if r.OwnerID == ownerID && r.Kind == runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED {
			count++
		}
	}
	if count >= maxConnectorsPerUser {
		return nil, status.Error(codes.ResourceExhausted, runtimev1.ReasonCode_AI_CONNECTOR_LIMIT_EXCEEDED.String())
	}

	endpoint := strings.TrimSpace(req.GetEndpoint())
	if endpoint == "" {
		endpoint = ResolveEndpoint(provider, "")
	}

	// Validate endpoint requirement
	if entry, ok := ProviderCatalog[provider]; ok && entry.RequiresExplicitEndpoint && endpoint == "" {
		return nil, status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID.String())
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
		return nil, status.Errorf(codes.Internal, "create connector: %v", err)
	}

	// Re-read to get the generated ID and timestamps
	records, err := s.store.Load()
	if err != nil {
		return nil, status.Errorf(codes.Internal, "reload connectors: %v", err)
	}
	for i := len(records) - 1; i >= 0; i-- {
		if records[i].OwnerID == ownerID && records[i].Provider == provider {
			return &runtimev1.CreateConnectorResponse{
				Connector: recordToProto(records[i]),
			}, nil
		}
	}
	return nil, status.Error(codes.Internal, "connector created but not found in store")
}

func (s *Service) GetConnector(_ context.Context, req *runtimev1.GetConnectorRequest) (*runtimev1.GetConnectorResponse, error) {
	connectorID := strings.TrimSpace(req.GetConnectorId())
	if connectorID == "" {
		return nil, status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID.String())
	}

	rec, found, err := s.store.Get(connectorID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "get connector: %v", err)
	}

	ownerID := strings.TrimSpace(req.GetOwnerId())
	// Information hiding: delete_pending or owner mismatch → NOT_FOUND
	if !found || (rec.Kind == runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED && ownerID != "" && rec.OwnerID != ownerID) {
		return nil, status.Error(codes.NotFound, runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND.String())
	}

	return &runtimev1.GetConnectorResponse{
		Connector: recordToProto(rec),
	}, nil
}

func (s *Service) ListConnectors(_ context.Context, req *runtimev1.ListConnectorsRequest) (*runtimev1.ListConnectorsResponse, error) {
	records, err := s.store.Load()
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list connectors: %v", err)
	}

	ownerID := strings.TrimSpace(req.GetOwnerId())
	result := make([]*runtimev1.Connector, 0, len(records))
	for _, r := range records {
		// System connectors (local + system cloud) always visible to all
		if r.OwnerType == runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_SYSTEM {
			result = append(result, recordToProto(r))
			continue
		}
		// User-owned remote connectors filtered by owner
		if ownerID == "" || r.OwnerID == ownerID {
			result = append(result, recordToProto(r))
		}
	}

	return &runtimev1.ListConnectorsResponse{
		Connectors: result,
	}, nil
}

func (s *Service) UpdateConnector(_ context.Context, req *runtimev1.UpdateConnectorRequest) (*runtimev1.UpdateConnectorResponse, error) {
	connectorID := strings.TrimSpace(req.GetConnectorId())
	if connectorID == "" {
		return nil, status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID.String())
	}

	ownerID := strings.TrimSpace(req.GetOwnerId())
	rec, found, err := s.store.Get(connectorID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "get connector: %v", err)
	}
	if !found {
		return nil, status.Error(codes.NotFound, runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND.String())
	}

	// Owner check
	if rec.Kind == runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED && ownerID != "" && rec.OwnerID != ownerID {
		return nil, status.Error(codes.NotFound, runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND.String())
	}

	// Immutability check for local connectors (only status can change)
	if rec.Kind == runtimev1.ConnectorKind_CONNECTOR_KIND_LOCAL_MODEL {
		if req.GetLabel() != "" || req.GetEndpoint() != "" || req.GetApiKey() != "" {
			return nil, status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_IMMUTABLE.String())
		}
	}

	// System cloud connectors are managed by config.json, not via API
	if rec.OwnerType == runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_SYSTEM &&
		rec.Kind == runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED {
		return nil, status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_IMMUTABLE.String())
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
		return nil, status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID.String())
	}

	// If api_key or endpoint changed, invalidate model cache
	if mutations.APIKey != nil || mutations.Endpoint != nil {
		s.modelCache.Invalidate(connectorID)
	}

	updated, err := s.store.Update(connectorID, mutations)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "update connector: %v", err)
	}

	return &runtimev1.UpdateConnectorResponse{
		Connector: recordToProto(updated),
	}, nil
}

func (s *Service) DeleteConnector(_ context.Context, req *runtimev1.DeleteConnectorRequest) (*runtimev1.DeleteConnectorResponse, error) {
	connectorID := strings.TrimSpace(req.GetConnectorId())
	if connectorID == "" {
		return nil, status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID.String())
	}

	rec, found, err := s.store.Get(connectorID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "get connector: %v", err)
	}
	if !found {
		return &runtimev1.DeleteConnectorResponse{
			Ack: &runtimev1.Ack{Ok: true},
		}, nil
	}

	// System connectors (local + system cloud) cannot be deleted via API
	if rec.Kind == runtimev1.ConnectorKind_CONNECTOR_KIND_LOCAL_MODEL ||
		rec.OwnerType == runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_SYSTEM {
		return nil, status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_IMMUTABLE.String())
	}

	// Owner check
	ownerID := strings.TrimSpace(req.GetOwnerId())
	if ownerID != "" && rec.OwnerID != ownerID {
		return nil, status.Error(codes.NotFound, runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND.String())
	}

	if err := s.store.Delete(connectorID); err != nil {
		return nil, status.Errorf(codes.Internal, "delete connector: %v", err)
	}

	s.modelCache.Invalidate(connectorID)

	return &runtimev1.DeleteConnectorResponse{
		Ack: &runtimev1.Ack{Ok: true},
	}, nil
}

func (s *Service) TestConnector(ctx context.Context, req *runtimev1.TestConnectorRequest) (*runtimev1.TestConnectorResponse, error) {
	connectorID := strings.TrimSpace(req.GetConnectorId())
	if connectorID == "" {
		return nil, status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID.String())
	}

	ownerID := strings.TrimSpace(req.GetOwnerId())
	rec, found, err := s.store.Get(connectorID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "get connector: %v", err)
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
		return nil, status.Errorf(codes.Internal, "load credential: %v", err)
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
		return nil, status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID.String())
	}

	ownerID := strings.TrimSpace(req.GetOwnerId())
	rec, found, err := s.store.Get(connectorID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "get connector: %v", err)
	}
	if !found || (rec.Kind == runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED && ownerID != "" && rec.OwnerID != ownerID) {
		return nil, status.Error(codes.NotFound, runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND.String())
	}

	if rec.Status == runtimev1.ConnectorStatus_CONNECTOR_STATUS_DISABLED {
		return nil, status.Error(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONNECTOR_DISABLED.String())
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
		return nil, status.Errorf(codes.Internal, "load credential: %v", err)
	}
	if apiKey == "" {
		return nil, status.Error(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING.String())
	}

	// Fetch models via backend
	var models []*runtimev1.ConnectorModelDescriptor
	if s.cloud != nil {
		backend, _, probeErr := s.cloud.ResolveProbeBackend(rec.Provider, rec.Endpoint, apiKey)
		if probeErr != nil {
			return nil, status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
		}
		rawModels, listErr := backend.ListModels(ctx)
		if listErr != nil {
			s.logger.Warn("list connector models failed", "connector_id", connectorID, "error", listErr)
			return nil, status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
		}
		for _, m := range rawModels {
			models = append(models, &runtimev1.ConnectorModelDescriptor{
				ModelId:    m.ModelID,
				ModelLabel: m.ModelLabel,
				Available:  m.Available,
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
