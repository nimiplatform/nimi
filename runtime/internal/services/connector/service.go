package connector

import (
	"context"
	"errors"
	"log/slog"
	"sort"
	"strconv"
	"strings"
	"sync"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/modelregistry"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	aicatalog "github.com/nimiplatform/nimi/runtime/internal/services/ai/catalog"
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
	localModel localModelLister
	modelCatalog *aicatalog.Resolver

	modelFetchMu       sync.Mutex
	modelFetchInFlight map[string]*modelFetchCall
}

type modelFetchCall struct {
	done   chan struct{}
	models []*runtimev1.ConnectorModelDescriptor
	err    error
}

// New creates a new ConnectorService.
func New(logger *slog.Logger, store *ConnectorStore, audit *auditlog.Store) *Service {
	return &Service{
		logger:     logger,
		store:      store,
		modelCache: NewModelCache(),
		audit:      audit,

		modelFetchInFlight: make(map[string]*modelFetchCall),
	}
}

type localModelLister interface {
	ListLocalModels(context.Context, *runtimev1.ListLocalModelsRequest) (*runtimev1.ListLocalModelsResponse, error)
}

// SetCloudProvider sets the cloud provider for probe and model listing.
func (s *Service) SetCloudProvider(cloud *nimillm.CloudProvider) {
	s.cloud = cloud
}

// SetLocalModelLister wires RuntimeLocalRuntimeService for local connector checks.
func (s *Service) SetLocalModelLister(localSvc localModelLister) {
	s.localModel = localSvc
}

// SetModelCatalogResolver wires runtime model/voice catalog management hooks.
func (s *Service) SetModelCatalogResolver(resolver *aicatalog.Resolver) {
	s.modelCatalog = resolver
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

func subjectUserIDFromContext(ctx context.Context) (string, bool) {
	identity := authn.IdentityFromContext(ctx)
	if identity == nil {
		return "", false
	}
	subject := strings.TrimSpace(identity.SubjectUserID)
	if subject == "" {
		return "", false
	}
	return subject, true
}

func requireSubjectUserID(ctx context.Context) (string, error) {
	subject, ok := subjectUserIDFromContext(ctx)
	if !ok {
		return "", grpcerr.WithReasonCode(codes.Unauthenticated, runtimev1.ReasonCode_AUTH_TOKEN_INVALID)
	}
	return subject, nil
}

func defaultManagedConnectorLabel(provider string) string {
	trimmed := strings.TrimSpace(provider)
	if trimmed == "" {
		return "Managed Connector"
	}
	if len(trimmed) == 1 {
		return "Managed " + strings.ToUpper(trimmed)
	}
	return "Managed " + strings.ToUpper(trimmed[:1]) + trimmed[1:]
}

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
	if apiKey == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING)
	}

	ownerID, err := requireSubjectUserID(ctx)
	if err != nil {
		return nil, err
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
	if rec.Label == "" {
		rec.Label = defaultManagedConnectorLabel(provider)
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
	// Information hiding: delete_pending or owner mismatch → NOT_FOUND
	if !found || (rec.Kind == runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED && (!hasOwner || rec.OwnerID != ownerID)) {
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

	ownerID, hasOwner := subjectUserIDFromContext(ctx)
	if !hasOwner {
		ownerID = ""
	}
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
			if !hasOwner || r.OwnerID != ownerID {
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

	ownerID, err := requireSubjectUserID(ctx)
	if err != nil {
		return nil, err
	}
	rec, found, err := s.store.Get(connectorID)
	if err != nil {
		return nil, s.internalProviderError("update_connector.load", err)
	}
	if !found {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND)
	}

	// Owner check
	if rec.Kind == runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED && rec.OwnerID != ownerID {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND)
	}

	// System cloud connectors are managed by config.json, not via API
	if rec.OwnerType == runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_SYSTEM &&
		rec.Kind == runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_IMMUTABLE)
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
		if req.GetStatus() != runtimev1.ConnectorStatus_CONNECTOR_STATUS_UNSPECIFIED {
			updatePaths = append(updatePaths, "status")
		}
	}

	seenPaths := make(map[string]bool, len(updatePaths))
	var mutations ConnectorMutations
	hasChange := false

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
			mutations.APIKey = &value
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

func (s *Service) DeleteConnector(ctx context.Context, req *runtimev1.DeleteConnectorRequest) (*runtimev1.DeleteConnectorResponse, error) {
	connectorID := strings.TrimSpace(req.GetConnectorId())
	if connectorID == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
	}

	ownerID, err := requireSubjectUserID(ctx)
	if err != nil {
		return nil, err
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
	if rec.OwnerID != ownerID {
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

	ownerID, hasOwner := subjectUserIDFromContext(ctx)
	rec, found, err := s.store.Get(connectorID)
	if err != nil {
		return nil, s.internalProviderError("test_connector.load", err)
	}
	if !found || (rec.Kind == runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED && (!hasOwner || rec.OwnerID != ownerID)) {
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
		if s.localModel == nil {
			return &runtimev1.TestConnectorResponse{
				Ack: &runtimev1.Ack{Ok: true},
			}, nil
		}
		localModels, listErr := s.listAllActiveLocalModels(ctx)
		if listErr != nil {
			return nil, s.internalProviderError("test_connector.list_local_models", listErr)
		}
		if !hasActiveLocalModelForCategory(localModels, rec.LocalCategory) {
			return &runtimev1.TestConnectorResponse{
				Ack: &runtimev1.Ack{Ok: false, ReasonCode: runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE},
			}, nil
		}
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

	ownerID, hasOwner := subjectUserIDFromContext(ctx)
	rec, found, err := s.store.Get(connectorID)
	if err != nil {
		return nil, s.internalProviderError("list_connector_models.load", err)
	}
	if !found || (rec.Kind == runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED && (!hasOwner || rec.OwnerID != ownerID)) {
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
		if s.localModel == nil {
			models = []*runtimev1.ConnectorModelDescriptor{}
		} else {
			localModels, listErr := s.listAllActiveLocalModels(ctx)
			if listErr != nil {
				return nil, s.internalProviderError("list_connector_models.list_local_models", listErr)
			}
			models = buildLocalConnectorModelDescriptors(localModels, rec.LocalCategory)
		}
	} else {
		// Check cache (unless force_refresh)
		if !req.GetForceRefresh() {
			if cached := s.modelCache.Get(connectorID); cached != nil {
				models = append(models, cached...)
			}
		}
		if models == nil {
			models, err = s.listRemoteConnectorModels(ctx, connectorID, rec)
			if err != nil {
				return nil, err
			}
			s.modelCache.Set(connectorID, models)
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

func (s *Service) ListModelCatalogProviders(_ context.Context, _ *runtimev1.ListModelCatalogProvidersRequest) (*runtimev1.ListModelCatalogProvidersResponse, error) {
	if s.modelCatalog == nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.Unavailable, runtimev1.ReasonCode_AI_MODULE_CONFIG_INVALID, grpcerr.ReasonOptions{
			ActionHint: "configure_runtime_model_catalog_custom_dir",
		})
	}

	records := s.modelCatalog.ListProviders()
	entries := make([]*runtimev1.ModelCatalogProviderEntry, 0, len(records))
	for _, record := range records {
		entries = append(entries, &runtimev1.ModelCatalogProviderEntry{
			Provider:       record.Provider,
			Version:        int32(record.Version),
			CatalogVersion: record.CatalogVersion,
			Source:         mapCatalogProviderSource(record.Source),
			ModelCount:     uint32(record.ModelCount),
			VoiceCount:     uint32(record.VoiceCount),
			Yaml:           record.YAML,
		})
	}
	return &runtimev1.ListModelCatalogProvidersResponse{Providers: entries}, nil
}

func (s *Service) UpsertModelCatalogProvider(ctx context.Context, req *runtimev1.UpsertModelCatalogProviderRequest) (*runtimev1.UpsertModelCatalogProviderResponse, error) {
	if _, err := requireSubjectUserID(ctx); err != nil {
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

	record, err := s.modelCatalog.UpsertCustomProvider(provider, []byte(rawYAML))
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
		Provider: &runtimev1.ModelCatalogProviderEntry{
			Provider:       record.Provider,
			Version:        int32(record.Version),
			CatalogVersion: record.CatalogVersion,
			Source:         mapCatalogProviderSource(record.Source),
			ModelCount:     uint32(record.ModelCount),
			VoiceCount:     uint32(record.VoiceCount),
			Yaml:           record.YAML,
		},
	}, nil
}

func (s *Service) DeleteModelCatalogProvider(ctx context.Context, req *runtimev1.DeleteModelCatalogProviderRequest) (*runtimev1.DeleteModelCatalogProviderResponse, error) {
	if _, err := requireSubjectUserID(ctx); err != nil {
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
	if err := s.modelCatalog.DeleteCustomProvider(provider); err != nil {
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

func mapCatalogProviderSource(source aicatalog.ProviderSource) runtimev1.ModelCatalogProviderSource {
	switch source {
	case aicatalog.ProviderSourceCustom:
		return runtimev1.ModelCatalogProviderSource_MODEL_CATALOG_PROVIDER_SOURCE_CUSTOM
	case aicatalog.ProviderSourceRemote:
		return runtimev1.ModelCatalogProviderSource_MODEL_CATALOG_PROVIDER_SOURCE_REMOTE
	default:
		return runtimev1.ModelCatalogProviderSource_MODEL_CATALOG_PROVIDER_SOURCE_BUILTIN
	}
}

func (s *Service) listAllActiveLocalModels(ctx context.Context) ([]*runtimev1.LocalModelRecord, error) {
	if s.localModel == nil {
		return nil, nil
	}
	pageToken := ""
	collected := make([]*runtimev1.LocalModelRecord, 0, 16)
	for i := 0; i < 20; i++ {
		resp, err := s.localModel.ListLocalModels(ctx, &runtimev1.ListLocalModelsRequest{
			StatusFilter: runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE,
			PageSize:     100,
			PageToken:    pageToken,
		})
		if err != nil {
			return nil, err
		}
		collected = append(collected, resp.GetModels()...)
		pageToken = strings.TrimSpace(resp.GetNextPageToken())
		if pageToken == "" {
			break
		}
	}
	return collected, nil
}

func hasActiveLocalModelForCategory(models []*runtimev1.LocalModelRecord, category runtimev1.LocalConnectorCategory) bool {
	for _, model := range models {
		if modelMatchesCategory(model, category) {
			return true
		}
	}
	return false
}

func buildLocalConnectorModelDescriptors(models []*runtimev1.LocalModelRecord, category runtimev1.LocalConnectorCategory) []*runtimev1.ConnectorModelDescriptor {
	descriptors := make([]*runtimev1.ConnectorModelDescriptor, 0, len(models))
	for _, model := range models {
		if !modelMatchesCategory(model, category) {
			continue
		}
		descriptors = append(descriptors, &runtimev1.ConnectorModelDescriptor{
			ModelId:      model.GetModelId(),
			ModelLabel:   model.GetModelId(),
			Available:    model.GetStatus() == runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE,
			Capabilities: append([]string(nil), model.GetCapabilities()...),
		})
	}
	return descriptors
}

func (s *Service) listRemoteConnectorModels(ctx context.Context, connectorID string, rec ConnectorRecord) ([]*runtimev1.ConnectorModelDescriptor, error) {
	call, owner := s.beginRemoteModelFetch(connectorID)
	if !owner {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-call.done:
			if call.err != nil {
				return nil, call.err
			}
			return append([]*runtimev1.ConnectorModelDescriptor(nil), call.models...), nil
		}
	}

	models, err := s.fetchRemoteConnectorModelsUncached(ctx, connectorID, rec)
	s.completeRemoteModelFetch(connectorID, call, models, err)
	if err != nil {
		return nil, err
	}
	return append([]*runtimev1.ConnectorModelDescriptor(nil), models...), nil
}

func (s *Service) beginRemoteModelFetch(connectorID string) (*modelFetchCall, bool) {
	s.modelFetchMu.Lock()
	defer s.modelFetchMu.Unlock()
	if call, ok := s.modelFetchInFlight[connectorID]; ok {
		return call, false
	}
	call := &modelFetchCall{done: make(chan struct{})}
	s.modelFetchInFlight[connectorID] = call
	return call, true
}

func (s *Service) completeRemoteModelFetch(connectorID string, call *modelFetchCall, models []*runtimev1.ConnectorModelDescriptor, err error) {
	call.models = models
	call.err = err
	close(call.done)

	s.modelFetchMu.Lock()
	delete(s.modelFetchInFlight, connectorID)
	s.modelFetchMu.Unlock()
}

func (s *Service) fetchRemoteConnectorModelsUncached(ctx context.Context, connectorID string, rec ConnectorRecord) ([]*runtimev1.ConnectorModelDescriptor, error) {
	apiKey, err := s.store.LoadCredential(connectorID)
	if err != nil {
		return nil, s.internalProviderError("list_connector_models.load_credential", err)
	}
	if apiKey == "" {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING)
	}
	if s.cloud == nil {
		return []*runtimev1.ConnectorModelDescriptor{}, nil
	}

	backend, _, probeErr := s.cloud.ResolveProbeBackend(rec.Provider, rec.Endpoint, apiKey)
	if probeErr != nil {
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	rawModels, listErr := backend.ListModels(ctx)
	if listErr != nil {
		s.logger.Warn("list connector models failed", "connector_id", connectorID, "error", listErr)
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}

	models := make([]*runtimev1.ConnectorModelDescriptor, 0, len(rawModels))
	for _, m := range rawModels {
		models = append(models, &runtimev1.ConnectorModelDescriptor{
			ModelId:      m.ModelID,
			ModelLabel:   m.ModelLabel,
			Available:    m.Available,
			Capabilities: modelregistry.InferCapabilities(m.ModelID),
		})
	}
	return models, nil
}

func modelMatchesCategory(model *runtimev1.LocalModelRecord, category runtimev1.LocalConnectorCategory) bool {
	caps := make(map[string]bool, len(model.GetCapabilities()))
	for _, capability := range model.GetCapabilities() {
		capLower := strings.ToLower(strings.TrimSpace(capability))
		if capLower != "" {
			caps[capLower] = true
		}
	}
	hasAny := func(keys ...string) bool {
		for _, key := range keys {
			if caps[strings.ToLower(strings.TrimSpace(key))] {
				return true
			}
		}
		return false
	}

	switch category {
	case runtimev1.LocalConnectorCategory_LOCAL_CONNECTOR_CATEGORY_LLM:
		return hasAny("chat", "llm", "text", "text.generate")
	case runtimev1.LocalConnectorCategory_LOCAL_CONNECTOR_CATEGORY_VISION:
		return hasAny("vision", "vl", "multimodal", "image.understand")
	case runtimev1.LocalConnectorCategory_LOCAL_CONNECTOR_CATEGORY_IMAGE:
		return hasAny("image", "image.generate")
	case runtimev1.LocalConnectorCategory_LOCAL_CONNECTOR_CATEGORY_TTS:
		return hasAny("tts", "speech.synthesize", "audio.synthesize")
	case runtimev1.LocalConnectorCategory_LOCAL_CONNECTOR_CATEGORY_STT:
		return hasAny("stt", "speech.transcribe", "audio.transcribe")
	case runtimev1.LocalConnectorCategory_LOCAL_CONNECTOR_CATEGORY_CUSTOM:
		return strings.TrimSpace(model.GetLocalInvokeProfileId()) != "" || hasAny("custom")
	default:
		return true
	}
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
