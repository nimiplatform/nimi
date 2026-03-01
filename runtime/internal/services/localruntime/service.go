package localruntime

import (
	"context"
	"fmt"
	"log/slog"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/oklog/ulid/v2"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	defaultLocalRuntimeEndpoint = "http://127.0.0.1:1234/v1"
	defaultServiceEndpoint      = "http://127.0.0.1:8080"
	localRuntimeAuditDomain     = "runtime.local_runtime"
)

// Service implements RuntimeLocalRuntimeService with persisted local-runtime state.
type Service struct {
	runtimev1.UnimplementedRuntimeLocalRuntimeServiceServer

	logger         *slog.Logger
	auditStore     *auditlog.Store
	stateStorePath string

	mu       sync.RWMutex
	models   map[string]*runtimev1.LocalModelRecord
	services map[string]*runtimev1.LocalServiceDescriptor
	audits   []*runtimev1.LocalAuditEvent
	verified []*runtimev1.LocalVerifiedModelDescriptor
	catalog  []*runtimev1.LocalCatalogModelDescriptor
}

func New(logger *slog.Logger, store *auditlog.Store, stateStorePath string, localAuditCapacity int) *Service {
	if logger == nil {
		logger = slog.Default()
	}
	if localAuditCapacity <= 0 {
		localAuditCapacity = 5000
	}
	verified := defaultVerifiedModels()
	svc := &Service{
		logger:         logger,
		auditStore:     store,
		stateStorePath: resolveLocalRuntimeStatePath(stateStorePath),
		models:         make(map[string]*runtimev1.LocalModelRecord),
		services:       make(map[string]*runtimev1.LocalServiceDescriptor),
		audits:         make([]*runtimev1.LocalAuditEvent, 0, localAuditCapacity),
		verified:       verified,
		catalog:        defaultCatalogFromVerified(verified),
	}
	svc.restoreState()
	return svc
}

func (s *Service) ListLocalModels(context.Context, *runtimev1.ListLocalModelsRequest) (*runtimev1.ListLocalModelsResponse, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	models := make([]*runtimev1.LocalModelRecord, 0, len(s.models))
	for _, model := range s.models {
		models = append(models, cloneLocalModel(model))
	}
	sort.Slice(models, func(i, j int) bool {
		if models[i].GetInstalledAt() == models[j].GetInstalledAt() {
			return models[i].GetLocalModelId() < models[j].GetLocalModelId()
		}
		return models[i].GetInstalledAt() > models[j].GetInstalledAt()
	})
	return &runtimev1.ListLocalModelsResponse{Models: models}, nil
}

func (s *Service) ListVerifiedModels(context.Context, *runtimev1.ListVerifiedModelsRequest) (*runtimev1.ListVerifiedModelsResponse, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	items := make([]*runtimev1.LocalVerifiedModelDescriptor, 0, len(s.verified))
	for _, item := range s.verified {
		items = append(items, cloneVerifiedModel(item))
	}
	return &runtimev1.ListVerifiedModelsResponse{Models: items}, nil
}

func (s *Service) SearchCatalogModels(_ context.Context, req *runtimev1.SearchCatalogModelsRequest) (*runtimev1.SearchCatalogModelsResponse, error) {
	query := strings.ToLower(strings.TrimSpace(req.GetQuery()))
	capability := strings.ToLower(strings.TrimSpace(req.GetCapability()))
	limit := int(req.GetLimit())
	if limit <= 0 {
		limit = 20
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	items := make([]*runtimev1.LocalCatalogModelDescriptor, 0, limit)
	for _, item := range s.catalog {
		if !matchesCatalogSearch(item, query, capability) {
			continue
		}
		items = append(items, cloneCatalogItem(item))
		if len(items) >= limit {
			break
		}
	}
	return &runtimev1.SearchCatalogModelsResponse{Items: items}, nil
}

func (s *Service) ResolveModelInstallPlan(_ context.Context, req *runtimev1.ResolveModelInstallPlanRequest) (*runtimev1.ResolveModelInstallPlanResponse, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	now := nowISO()
	if catalogItem := s.resolveCatalogItem(req); catalogItem != nil {
		plan := &runtimev1.LocalInstallPlanDescriptor{
			PlanId:            "plan_" + ulid.Make().String(),
			ItemId:            catalogItem.GetItemId(),
			Source:            defaultString(catalogItem.GetSource(), "verified"),
			TemplateId:        catalogItem.GetTemplateId(),
			ModelId:           catalogItem.GetModelId(),
			Repo:              catalogItem.GetRepo(),
			Revision:          defaultString(catalogItem.GetRevision(), "main"),
			Capabilities:      append([]string(nil), catalogItem.GetCapabilities()...),
			Engine:            defaultString(catalogItem.GetEngine(), "localai"),
			EngineRuntimeMode: catalogItem.GetEngineRuntimeMode(),
			InstallKind:       defaultString(catalogItem.GetInstallKind(), "download"),
			InstallAvailable:  true,
			Endpoint:          defaultString(req.GetEndpoint(), defaultString(catalogItem.GetEndpoint(), defaultLocalRuntimeEndpoint)),
			ProviderHints:     cloneProviderHints(catalogItem.GetProviderHints()),
			Entry:             defaultString(catalogItem.GetEntry(), "./dist/index.js"),
			Files:             append([]string(nil), catalogItem.GetFiles()...),
			License:           defaultString(catalogItem.GetLicense(), "unknown"),
			Hashes:            cloneStringMap(catalogItem.GetHashes()),
			Warnings:          []string{},
		}
		if plan.GetRevision() == "" {
			plan.Revision = "main"
		}
		if plan.GetEndpoint() == "" {
			plan.Endpoint = defaultLocalRuntimeEndpoint
		}
		s.appendRuntimeAuditLocked(&runtimev1.LocalAuditEvent{
			Id:         "audit_" + ulid.Make().String(),
			EventType:  "model_install_plan_resolved",
			OccurredAt: now,
			Detail:     fmt.Sprintf("resolved install plan for %s", plan.GetModelId()),
			ModelId:    plan.GetModelId(),
		})
		return &runtimev1.ResolveModelInstallPlanResponse{Plan: plan}, nil
	}

	plan := &runtimev1.LocalInstallPlanDescriptor{
		PlanId:            "plan_" + ulid.Make().String(),
		ItemId:            req.GetItemId(),
		Source:            defaultString(req.GetSource(), "manual"),
		TemplateId:        req.GetTemplateId(),
		ModelId:           strings.TrimSpace(req.GetModelId()),
		Repo:              strings.TrimSpace(req.GetRepo()),
		Revision:          defaultString(strings.TrimSpace(req.GetRevision()), "main"),
		Capabilities:      normalizeStringSlice(req.GetCapabilities()),
		Engine:            defaultString(strings.TrimSpace(req.GetEngine()), "localai"),
		EngineRuntimeMode: runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_ATTACHED_ENDPOINT,
		InstallKind:       "download",
		InstallAvailable:  true,
		Endpoint:          defaultString(strings.TrimSpace(req.GetEndpoint()), defaultLocalRuntimeEndpoint),
		Entry:             defaultString(strings.TrimSpace(req.GetEntry()), "./dist/index.js"),
		Files:             normalizeStringSlice(req.GetFiles()),
		License:           defaultString(strings.TrimSpace(req.GetLicense()), "unknown"),
		Hashes:            cloneStringMap(req.GetHashes()),
		Warnings:          []string{},
	}
	if plan.GetModelId() == "" {
		plan.ReasonCode = "LOCAL_MODEL_ID_REQUIRED"
		plan.Warnings = append(plan.Warnings, "modelId is required for install plan resolution")
	}
	return &runtimev1.ResolveModelInstallPlanResponse{Plan: plan}, nil
}

func (s *Service) InstallLocalModel(_ context.Context, req *runtimev1.InstallLocalModelRequest) (*runtimev1.InstallLocalModelResponse, error) {
	modelID := strings.TrimSpace(req.GetModelId())
	if modelID == "" {
		return &runtimev1.InstallLocalModelResponse{
			Model: &runtimev1.LocalModelRecord{
				Status:       runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNHEALTHY,
				HealthDetail: "model_id required",
			},
		}, nil
	}

	now := nowISO()
	localModelID := "local_" + slug(modelID) + "_" + ulid.Make().String()
	record := &runtimev1.LocalModelRecord{
		LocalModelId: localModelID,
		ModelId:      modelID,
		Capabilities: normalizeStringSlice(req.GetCapabilities()),
		Engine:       defaultString(strings.TrimSpace(req.GetEngine()), "localai"),
		Entry:        defaultString(strings.TrimSpace(req.GetEntry()), "./dist/index.js"),
		License:      defaultString(strings.TrimSpace(req.GetLicense()), "unknown"),
		Source: &runtimev1.LocalModelSource{
			Repo:     strings.TrimSpace(req.GetRepo()),
			Revision: defaultString(strings.TrimSpace(req.GetRevision()), "main"),
		},
		Hashes:      cloneStringMap(req.GetHashes()),
		Endpoint:    defaultString(strings.TrimSpace(req.GetEndpoint()), defaultLocalRuntimeEndpoint),
		Status:      runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_INSTALLED,
		InstalledAt: now,
		UpdatedAt:   now,
	}
	if len(record.GetCapabilities()) == 0 {
		record.Capabilities = []string{"chat"}
	}

	s.mu.Lock()
	s.models[record.GetLocalModelId()] = cloneLocalModel(record)
	s.appendRuntimeAuditLocked(&runtimev1.LocalAuditEvent{
		Id:           "audit_" + ulid.Make().String(),
		EventType:    "runtime_model_ready_after_install",
		OccurredAt:   now,
		Source:       "local-runtime",
		Modality:     firstCapability(record.GetCapabilities()),
		ModelId:      record.GetModelId(),
		LocalModelId: record.GetLocalModelId(),
		Detail:       "model installed",
	})
	s.mu.Unlock()
	return &runtimev1.InstallLocalModelResponse{Model: record}, nil
}

func (s *Service) InstallVerifiedModel(ctx context.Context, req *runtimev1.InstallVerifiedModelRequest) (*runtimev1.InstallVerifiedModelResponse, error) {
	templateID := strings.TrimSpace(req.GetTemplateId())
	if templateID == "" {
		return &runtimev1.InstallVerifiedModelResponse{
			Model: &runtimev1.LocalModelRecord{
				Status:       runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNHEALTHY,
				HealthDetail: "template_id required",
			},
		}, nil
	}

	s.mu.RLock()
	var matched *runtimev1.LocalVerifiedModelDescriptor
	for _, item := range s.verified {
		if item.GetTemplateId() == templateID {
			matched = item
			break
		}
	}
	s.mu.RUnlock()

	if matched == nil {
		return &runtimev1.InstallVerifiedModelResponse{
			Model: &runtimev1.LocalModelRecord{
				Status:       runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNHEALTHY,
				HealthDetail: "verified template not found",
			},
		}, nil
	}

	resp, err := s.InstallLocalModel(ctx, &runtimev1.InstallLocalModelRequest{
		ModelId:      matched.GetModelId(),
		Repo:         matched.GetRepo(),
		Revision:     matched.GetRevision(),
		Capabilities: append([]string(nil), matched.GetCapabilities()...),
		Engine:       matched.GetEngine(),
		Entry:        matched.GetEntry(),
		Files:        append([]string(nil), matched.GetFiles()...),
		License:      matched.GetLicense(),
		Hashes:       cloneStringMap(matched.GetHashes()),
		Endpoint:     defaultString(strings.TrimSpace(req.GetEndpoint()), matched.GetEndpoint()),
	})
	if err != nil {
		return nil, err
	}
	return &runtimev1.InstallVerifiedModelResponse{Model: resp.GetModel()}, nil
}

func (s *Service) ImportLocalModel(_ context.Context, req *runtimev1.ImportLocalModelRequest) (*runtimev1.ImportLocalModelResponse, error) {
	manifestPath := strings.TrimSpace(req.GetManifestPath())
	if manifestPath == "" {
		return &runtimev1.ImportLocalModelResponse{
			Model: &runtimev1.LocalModelRecord{
				Status:       runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNHEALTHY,
				HealthDetail: "manifest_path required",
			},
		}, nil
	}
	base := strings.TrimSuffix(filepath.Base(manifestPath), filepath.Ext(manifestPath))
	modelID := defaultString(strings.TrimSpace(base), "imported-model")
	now := nowISO()

	record := &runtimev1.LocalModelRecord{
		LocalModelId: "local_" + slug(modelID) + "_" + ulid.Make().String(),
		ModelId:      modelID,
		Capabilities: []string{"chat"},
		Engine:       "localai",
		Entry:        "./dist/index.js",
		License:      "unknown",
		Source: &runtimev1.LocalModelSource{
			Repo:     "file://" + manifestPath,
			Revision: "import",
		},
		Hashes:      map[string]string{},
		Endpoint:    defaultString(strings.TrimSpace(req.GetEndpoint()), defaultLocalRuntimeEndpoint),
		Status:      runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_INSTALLED,
		InstalledAt: now,
		UpdatedAt:   now,
	}

	s.mu.Lock()
	s.models[record.GetLocalModelId()] = cloneLocalModel(record)
	s.appendRuntimeAuditLocked(&runtimev1.LocalAuditEvent{
		Id:           "audit_" + ulid.Make().String(),
		EventType:    "runtime_model_imported",
		OccurredAt:   now,
		Source:       "local-runtime",
		ModelId:      record.GetModelId(),
		LocalModelId: record.GetLocalModelId(),
		Detail:       manifestPath,
	})
	s.mu.Unlock()
	return &runtimev1.ImportLocalModelResponse{Model: record}, nil
}

func (s *Service) RemoveLocalModel(_ context.Context, req *runtimev1.RemoveLocalModelRequest) (*runtimev1.RemoveLocalModelResponse, error) {
	return &runtimev1.RemoveLocalModelResponse{Model: s.updateModelStatus(req.GetLocalModelId(), runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_REMOVED, "model removed")}, nil
}

func (s *Service) StartLocalModel(_ context.Context, req *runtimev1.StartLocalModelRequest) (*runtimev1.StartLocalModelResponse, error) {
	return &runtimev1.StartLocalModelResponse{Model: s.updateModelStatus(req.GetLocalModelId(), runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE, "model active")}, nil
}

func (s *Service) StopLocalModel(_ context.Context, req *runtimev1.StopLocalModelRequest) (*runtimev1.StopLocalModelResponse, error) {
	return &runtimev1.StopLocalModelResponse{Model: s.updateModelStatus(req.GetLocalModelId(), runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_INSTALLED, "model stopped")}, nil
}

func (s *Service) CheckLocalModelHealth(_ context.Context, req *runtimev1.CheckLocalModelHealthRequest) (*runtimev1.CheckLocalModelHealthResponse, error) {
	target := strings.TrimSpace(req.GetLocalModelId())
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make([]*runtimev1.LocalModelHealth, 0, len(s.models))
	for _, model := range s.models {
		if target != "" && model.GetLocalModelId() != target {
			continue
		}
		result = append(result, modelHealth(model))
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].GetLocalModelId() < result[j].GetLocalModelId()
	})
	return &runtimev1.CheckLocalModelHealthResponse{Models: result}, nil
}

func (s *Service) CollectDeviceProfile(context.Context, *runtimev1.CollectDeviceProfileRequest) (*runtimev1.CollectDeviceProfileResponse, error) {
	return &runtimev1.CollectDeviceProfileResponse{Profile: collectDeviceProfile()}, nil
}

func (s *Service) ResolveDependencies(_ context.Context, req *runtimev1.ResolveDependenciesRequest) (*runtimev1.ResolveDependenciesResponse, error) {
	return &runtimev1.ResolveDependenciesResponse{
		Plan: resolveDependencyPlan(req),
	}, nil
}

func (s *Service) ApplyDependencies(ctx context.Context, req *runtimev1.ApplyDependenciesRequest) (*runtimev1.ApplyDependenciesResponse, error) {
	return &runtimev1.ApplyDependenciesResponse{
		Result: s.applyDependenciesStrict(ctx, req.GetPlan()),
	}, nil
}

func (s *Service) ListLocalServices(context.Context, *runtimev1.ListLocalServicesRequest) (*runtimev1.ListLocalServicesResponse, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	services := make([]*runtimev1.LocalServiceDescriptor, 0, len(s.services))
	for _, service := range s.services {
		services = append(services, cloneServiceDescriptor(service))
	}
	sort.Slice(services, func(i, j int) bool {
		if services[i].GetInstalledAt() == services[j].GetInstalledAt() {
			return services[i].GetServiceId() < services[j].GetServiceId()
		}
		return services[i].GetInstalledAt() > services[j].GetInstalledAt()
	})
	return &runtimev1.ListLocalServicesResponse{Services: services}, nil
}

func (s *Service) InstallLocalService(_ context.Context, req *runtimev1.InstallLocalServiceRequest) (*runtimev1.InstallLocalServiceResponse, error) {
	serviceID := strings.TrimSpace(req.GetServiceId())
	if serviceID == "" {
		serviceID = "svc_" + ulid.Make().String()
	}
	now := nowISO()
	service := &runtimev1.LocalServiceDescriptor{
		ServiceId:    serviceID,
		Title:        defaultString(strings.TrimSpace(req.GetTitle()), serviceID),
		Engine:       defaultString(strings.TrimSpace(req.GetEngine()), "localai"),
		ArtifactType: "binary",
		Endpoint:     defaultString(strings.TrimSpace(req.GetEndpoint()), defaultServiceEndpoint),
		Capabilities: normalizeStringSlice(req.GetCapabilities()),
		LocalModelId: strings.TrimSpace(req.GetLocalModelId()),
		Status:       runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_INSTALLED,
		InstalledAt:  now,
		UpdatedAt:    now,
	}
	if len(service.GetCapabilities()) == 0 {
		service.Capabilities = []string{"chat"}
	}

	s.mu.Lock()
	s.services[service.GetServiceId()] = cloneServiceDescriptor(service)
	s.appendRuntimeAuditLocked(&runtimev1.LocalAuditEvent{
		Id:         "audit_" + ulid.Make().String(),
		EventType:  "service_install_completed",
		OccurredAt: now,
		Source:     "local-runtime",
		Detail:     service.GetServiceId(),
	})
	s.mu.Unlock()
	return &runtimev1.InstallLocalServiceResponse{Service: service}, nil
}

func (s *Service) StartLocalService(_ context.Context, req *runtimev1.StartLocalServiceRequest) (*runtimev1.StartLocalServiceResponse, error) {
	return &runtimev1.StartLocalServiceResponse{Service: s.updateServiceStatus(req.GetServiceId(), runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_ACTIVE, "service active")}, nil
}

func (s *Service) StopLocalService(_ context.Context, req *runtimev1.StopLocalServiceRequest) (*runtimev1.StopLocalServiceResponse, error) {
	return &runtimev1.StopLocalServiceResponse{Service: s.updateServiceStatus(req.GetServiceId(), runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_INSTALLED, "service stopped")}, nil
}

func (s *Service) CheckLocalServiceHealth(_ context.Context, req *runtimev1.CheckLocalServiceHealthRequest) (*runtimev1.CheckLocalServiceHealthResponse, error) {
	target := strings.TrimSpace(req.GetServiceId())
	s.mu.RLock()
	defer s.mu.RUnlock()
	services := make([]*runtimev1.LocalServiceDescriptor, 0, len(s.services))
	for _, service := range s.services {
		if target != "" && service.GetServiceId() != target {
			continue
		}
		health := cloneServiceDescriptor(service)
		switch health.GetStatus() {
		case runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_ACTIVE:
			health.Detail = "service healthy"
		case runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_UNHEALTHY:
			health.Detail = defaultString(health.GetDetail(), "service unhealthy")
		case runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_REMOVED:
			health.Detail = "service removed"
		default:
			health.Detail = "service idle"
		}
		services = append(services, health)
	}
	sort.Slice(services, func(i, j int) bool {
		return services[i].GetServiceId() < services[j].GetServiceId()
	})
	return &runtimev1.CheckLocalServiceHealthResponse{Services: services}, nil
}

func (s *Service) RemoveLocalService(_ context.Context, req *runtimev1.RemoveLocalServiceRequest) (*runtimev1.RemoveLocalServiceResponse, error) {
	return &runtimev1.RemoveLocalServiceResponse{Service: s.updateServiceStatus(req.GetServiceId(), runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_REMOVED, "service removed")}, nil
}

func (s *Service) ListNodeCatalog(_ context.Context, req *runtimev1.ListNodeCatalogRequest) (*runtimev1.ListNodeCatalogResponse, error) {
	capabilityFilter := strings.ToLower(strings.TrimSpace(req.GetCapability()))
	serviceFilter := strings.TrimSpace(req.GetServiceId())
	providerFilter := strings.ToLower(strings.TrimSpace(req.GetProvider()))
	deviceProfile := collectDeviceProfile()

	s.mu.RLock()
	defer s.mu.RUnlock()

	nodes := make([]*runtimev1.LocalNodeDescriptor, 0, len(s.services)*2)
	for _, service := range s.services {
		if serviceFilter != "" && service.GetServiceId() != serviceFilter {
			continue
		}
		provider := strings.ToLower(defaultString(service.GetEngine(), "localai"))
		if providerFilter != "" && provider != providerFilter {
			continue
		}
		capabilities := service.GetCapabilities()
		if len(capabilities) == 0 {
			capabilities = []string{"chat"}
		}
		for _, capability := range capabilities {
			if capabilityFilter != "" && strings.ToLower(capability) != capabilityFilter {
				continue
			}
			available := service.GetStatus() != runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_REMOVED
			adapter := adapterForProviderCapability(provider, capability)
			apiPath := apiPathForProviderCapability(provider, capability)
			reasonCode := ""
			policyGate := ""
			if provider == "nexa" && strings.EqualFold(strings.TrimSpace(capability), "video") {
				available = false
				reasonCode = runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED.String()
				policyGate = "nexa.video.unsupported"
			}
			nodeID := fmt.Sprintf("node_%s_%s", slug(service.GetServiceId()), slug(capability))
			nodes = append(nodes, &runtimev1.LocalNodeDescriptor{
				NodeId:        nodeID,
				Title:         fmt.Sprintf("%s %s node", service.GetTitle(), capability),
				ServiceId:     service.GetServiceId(),
				Capabilities:  []string{capability},
				Provider:      provider,
				Adapter:       adapter,
				Backend:       provider,
				BackendSource: "runtime",
				Available:     available,
				ReasonCode:    reasonCode,
				ProviderHints: buildNodeProviderHints(service, provider, capability, adapter, policyGate, available, deviceProfile),
				PolicyGate:    policyGate,
				ApiPath:       apiPath,
				ReadOnly:      false,
			})
		}
	}
	sort.Slice(nodes, func(i, j int) bool {
		return nodes[i].GetNodeId() < nodes[j].GetNodeId()
	})
	return &runtimev1.ListNodeCatalogResponse{Nodes: nodes}, nil
}

func (s *Service) ListLocalAudits(_ context.Context, req *runtimev1.ListLocalAuditsRequest) (*runtimev1.ListLocalAuditsResponse, error) {
	limit := int(req.GetLimit())
	if limit <= 0 {
		limit = 200
	}
	s.mu.RLock()
	source := make([]*runtimev1.LocalAuditEvent, len(s.audits))
	for i, event := range s.audits {
		source[i] = cloneLocalAuditEvent(event)
	}
	s.mu.RUnlock()

	eventTypes := make(map[string]bool)
	for _, item := range req.GetEventTypes() {
		normalized := strings.TrimSpace(item)
		if normalized != "" {
			eventTypes[normalized] = true
		}
	}
	if eventType := strings.TrimSpace(req.GetEventType()); eventType != "" {
		eventTypes[eventType] = true
	}

	filtered := make([]*runtimev1.LocalAuditEvent, 0, limit)
	for _, event := range source {
		if !matchesLocalAuditFilter(event, req, eventTypes) {
			continue
		}
		filtered = append(filtered, event)
		if len(filtered) >= limit {
			break
		}
	}
	return &runtimev1.ListLocalAuditsResponse{Events: filtered}, nil
}

func (s *Service) AppendInferenceAudit(_ context.Context, req *runtimev1.AppendInferenceAuditRequest) (*runtimev1.Ack, error) {
	event := &runtimev1.LocalAuditEvent{
		Id:           "audit_" + ulid.Make().String(),
		EventType:    strings.TrimSpace(req.GetEventType()),
		OccurredAt:   nowISO(),
		Source:       strings.TrimSpace(req.GetSource()),
		Modality:     strings.TrimSpace(req.GetModality()),
		ReasonCode:   strings.TrimSpace(req.GetReasonCode()),
		Detail:       strings.TrimSpace(req.GetDetail()),
		ModelId:      strings.TrimSpace(req.GetModel()),
		LocalModelId: strings.TrimSpace(req.GetLocalModelId()),
		Payload:      mergeInferencePayload(req),
	}
	if event.GetEventType() == "" {
		event.EventType = "inference_invoked"
	}
	if event.GetDetail() == "" {
		event.Detail = strings.TrimSpace(req.GetProvider())
	}

	s.mu.Lock()
	s.appendRuntimeAuditLocked(event)
	s.mu.Unlock()
	return &runtimev1.Ack{Ok: true, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func (s *Service) AppendRuntimeAudit(_ context.Context, req *runtimev1.AppendRuntimeAuditRequest) (*runtimev1.Ack, error) {
	event := &runtimev1.LocalAuditEvent{
		Id:           "audit_" + ulid.Make().String(),
		EventType:    defaultString(strings.TrimSpace(req.GetEventType()), "runtime_event"),
		OccurredAt:   nowISO(),
		Source:       "local-runtime",
		ReasonCode:   "",
		Detail:       "",
		ModelId:      strings.TrimSpace(req.GetModelId()),
		LocalModelId: strings.TrimSpace(req.GetLocalModelId()),
		Payload:      cloneStruct(req.GetPayload()),
	}
	s.mu.Lock()
	s.appendRuntimeAuditLocked(event)
	s.mu.Unlock()
	return &runtimev1.Ack{Ok: true, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func (s *Service) resolveCatalogItem(req *runtimev1.ResolveModelInstallPlanRequest) *runtimev1.LocalCatalogModelDescriptor {
	itemID := strings.TrimSpace(req.GetItemId())
	templateID := strings.TrimSpace(req.GetTemplateId())
	modelID := strings.TrimSpace(req.GetModelId())
	repo := strings.TrimSpace(req.GetRepo())
	source := strings.TrimSpace(req.GetSource())
	for _, item := range s.catalog {
		if itemID != "" && item.GetItemId() == itemID {
			return item
		}
		if templateID != "" && item.GetTemplateId() == templateID {
			return item
		}
		if modelID != "" && item.GetModelId() == modelID {
			if repo == "" || item.GetRepo() == repo {
				if source == "" || strings.EqualFold(source, item.GetSource()) {
					return item
				}
			}
		}
	}
	return nil
}

func (s *Service) updateModelStatus(localModelID string, status runtimev1.LocalModelStatus, detail string) *runtimev1.LocalModelRecord {
	id := strings.TrimSpace(localModelID)
	if id == "" {
		return &runtimev1.LocalModelRecord{
			Status:       runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNHEALTHY,
			HealthDetail: "local_model_id required",
		}
	}
	now := nowISO()
	s.mu.Lock()
	defer s.mu.Unlock()
	current := cloneLocalModel(s.models[id])
	if current == nil {
		return &runtimev1.LocalModelRecord{
			LocalModelId: id,
			Status:       runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNHEALTHY,
			HealthDetail: "model not found",
		}
	}
	current.Status = status
	current.UpdatedAt = now
	current.HealthDetail = detail
	s.models[id] = cloneLocalModel(current)
	s.appendRuntimeAuditLocked(&runtimev1.LocalAuditEvent{
		Id:           "audit_" + ulid.Make().String(),
		EventType:    "runtime_model_status_changed",
		OccurredAt:   now,
		Source:       "local-runtime",
		ModelId:      current.GetModelId(),
		LocalModelId: current.GetLocalModelId(),
		Detail:       detail,
	})
	return current
}

func (s *Service) updateServiceStatus(serviceID string, status runtimev1.LocalServiceStatus, detail string) *runtimev1.LocalServiceDescriptor {
	id := strings.TrimSpace(serviceID)
	if id == "" {
		return &runtimev1.LocalServiceDescriptor{
			Status: runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_UNHEALTHY,
			Detail: "service_id required",
		}
	}
	now := nowISO()
	s.mu.Lock()
	defer s.mu.Unlock()
	current := cloneServiceDescriptor(s.services[id])
	if current == nil {
		return &runtimev1.LocalServiceDescriptor{
			ServiceId: id,
			Status:    runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_UNHEALTHY,
			Detail:    "service not found",
		}
	}
	current.Status = status
	current.UpdatedAt = now
	current.Detail = detail
	s.services[id] = cloneServiceDescriptor(current)
	s.appendRuntimeAuditLocked(&runtimev1.LocalAuditEvent{
		Id:         "audit_" + ulid.Make().String(),
		EventType:  "runtime_service_status_changed",
		OccurredAt: now,
		Source:     "local-runtime",
		Detail:     detail,
		Payload: toStruct(map[string]any{
			"serviceId": current.GetServiceId(),
			"status":    current.GetStatus().String(),
		}),
	})
	return current
}

func (s *Service) appendRuntimeAuditLocked(event *runtimev1.LocalAuditEvent) {
	if event == nil {
		return
	}
	copy := cloneLocalAuditEvent(event)
	if copy.GetId() == "" {
		copy.Id = "audit_" + ulid.Make().String()
	}
	if copy.GetOccurredAt() == "" {
		copy.OccurredAt = nowISO()
	}
	s.audits = append([]*runtimev1.LocalAuditEvent{copy}, s.audits...)
	if len(s.audits) > 5000 {
		s.audits = append([]*runtimev1.LocalAuditEvent(nil), s.audits[:5000]...)
	}
	s.persistStateLocked()
	if s.auditStore == nil {
		return
	}

	reasonCode := runtimev1.ReasonCode_ACTION_EXECUTED
	if raw := strings.TrimSpace(copy.GetReasonCode()); raw != "" {
		if parsed, ok := runtimev1.ReasonCode_value[raw]; ok {
			reasonCode = runtimev1.ReasonCode(parsed)
		}
	}
	s.auditStore.AppendEvent(&runtimev1.AuditEventRecord{
		AuditId:       copy.GetId(),
		AppId:         "nimi.desktop",
		Domain:        localRuntimeAuditDomain,
		Operation:     strings.TrimSpace(copy.GetEventType()),
		ReasonCode:    reasonCode,
		TraceId:       ulid.Make().String(),
		Timestamp:     timestamppb.New(time.Now().UTC()),
		Payload:       cloneStruct(copy.GetPayload()),
		CallerKind:    runtimev1.CallerKind_CALLER_KIND_DESKTOP_CORE,
		CallerId:      "runtime.local_runtime.service",
		SurfaceId:     "runtime.local_runtime",
		Capability:    "runtime.local_runtime.audit.append",
		PrincipalId:   "runtime.local_runtime",
		PrincipalType: "runtime_service",
	})
}

func modelHealth(model *runtimev1.LocalModelRecord) *runtimev1.LocalModelHealth {
	if model == nil {
		return &runtimev1.LocalModelHealth{
			Status: runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNHEALTHY,
			Detail: "model not found",
		}
	}
	detail := model.GetHealthDetail()
	switch model.GetStatus() {
	case runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE:
		if detail == "" {
			detail = "model healthy"
		}
	case runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNHEALTHY:
		if detail == "" {
			detail = "model unhealthy"
		}
	case runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_REMOVED:
		if detail == "" {
			detail = "model removed"
		}
	default:
		if detail == "" {
			detail = "model idle"
		}
	}
	return &runtimev1.LocalModelHealth{
		LocalModelId: model.GetLocalModelId(),
		Status:       model.GetStatus(),
		Detail:       detail,
		Endpoint:     model.GetEndpoint(),
	}
}

func mergeInferencePayload(req *runtimev1.AppendInferenceAuditRequest) *structpb.Struct {
	payload := map[string]any{
		"modId":        strings.TrimSpace(req.GetModId()),
		"source":       strings.TrimSpace(req.GetSource()),
		"provider":     strings.TrimSpace(req.GetProvider()),
		"modality":     strings.TrimSpace(req.GetModality()),
		"adapter":      strings.TrimSpace(req.GetAdapter()),
		"model":        strings.TrimSpace(req.GetModel()),
		"localModelId": strings.TrimSpace(req.GetLocalModelId()),
		"endpoint":     strings.TrimSpace(req.GetEndpoint()),
		"reasonCode":   strings.TrimSpace(req.GetReasonCode()),
		"detail":       strings.TrimSpace(req.GetDetail()),
	}
	if policy := structToMap(req.GetPolicyGate()); len(policy) > 0 {
		payload["policyGate"] = policy
	}
	if extra := structToMap(req.GetExtra()); len(extra) > 0 {
		payload["extra"] = extra
	}
	return toStruct(payload)
}

func matchesCatalogSearch(item *runtimev1.LocalCatalogModelDescriptor, query string, capability string) bool {
	if item == nil {
		return false
	}
	if capability != "" {
		matched := false
		for _, cap := range item.GetCapabilities() {
			if strings.EqualFold(strings.TrimSpace(cap), capability) {
				matched = true
				break
			}
		}
		if !matched {
			return false
		}
	}
	if query == "" {
		return true
	}
	fields := []string{
		item.GetItemId(),
		item.GetTitle(),
		item.GetDescription(),
		item.GetModelId(),
		item.GetRepo(),
		item.GetTemplateId(),
	}
	for _, field := range fields {
		if strings.Contains(strings.ToLower(field), query) {
			return true
		}
	}
	return false
}

func adapterForProviderCapability(provider string, capability string) string {
	normalizedProvider := strings.ToLower(strings.TrimSpace(provider))
	normalizedCapability := strings.ToLower(strings.TrimSpace(capability))
	switch normalizedProvider {
	case "nexa":
		return "nexa_native_adapter"
	case "localai":
		switch normalizedCapability {
		case "image", "video", "tts", "speech", "stt", "transcription":
			return "localai_native_adapter"
		default:
			return "openai_compat_adapter"
		}
	default:
		return "openai_compat_adapter"
	}
}

func apiPathForProviderCapability(provider string, capability string) string {
	cap := strings.ToLower(strings.TrimSpace(capability))
	switch cap {
	case "embedding", "embed":
		return "/v1/embeddings"
	case "image":
		return "/v1/images/generations"
	case "video":
		if strings.EqualFold(strings.TrimSpace(provider), "nexa") {
			return "/v1/video/generations"
		}
		return "/v1/videos/generations"
	case "tts", "speech":
		return "/v1/audio/speech"
	case "stt", "transcription":
		return "/v1/audio/transcriptions"
	default:
		return "/v1/chat/completions"
	}
}

func buildNodeProviderHints(
	service *runtimev1.LocalServiceDescriptor,
	provider string,
	capability string,
	adapter string,
	policyGate string,
	available bool,
	deviceProfile *runtimev1.LocalDeviceProfile,
) *runtimev1.LocalProviderHints {
	normalizedProvider := strings.ToLower(strings.TrimSpace(provider))
	normalizedCapability := strings.ToLower(strings.TrimSpace(capability))
	normalizedPolicyGate := strings.TrimSpace(policyGate)
	hints := &runtimev1.LocalProviderHints{
		Extra: map[string]string{
			"provider":     normalizedProvider,
			"capability":   normalizedCapability,
			"service_id":   strings.TrimSpace(service.GetServiceId()),
			"endpoint":     strings.TrimSpace(service.GetEndpoint()),
			"policy_gate":  normalizedPolicyGate,
			"adapter":      strings.TrimSpace(adapter),
			"availability": fmt.Sprintf("%t", available),
		},
	}
	switch normalizedProvider {
	case "localai":
		localAI := &runtimev1.LocalProviderHintsLocalAi{
			Backend:          "localai",
			PreferredAdapter: strings.TrimSpace(adapter),
		}
		switch normalizedCapability {
		case "stt", "transcription":
			localAI.WhisperVariant = "whisper-large-v3"
		case "image":
			localAI.StablediffusionPipeline = "default"
		case "video":
			localAI.VideoBackend = "openai_compat"
		}
		hints.Localai = localAI
	case "nexa":
		npuProfile := &runtimev1.LocalNpuProfile{}
		if deviceProfile != nil && deviceProfile.GetNpu() != nil {
			npuProfile = deviceProfile.GetNpu()
		}
		hostNPUReady := npuProfile.GetReady()
		modelProbeHasNPUCandidate := true
		policyGateAllowsNPU := normalizedPolicyGate == "" && hostNPUReady && modelProbeHasNPUCandidate
		npuUsable := policyGateAllowsNPU && available
		gateReason := ""
		gateDetail := ""
		switch {
		case normalizedPolicyGate != "":
			gateReason = runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED.String()
			gateDetail = "policy gate blocked nexa capability"
		case !hostNPUReady:
			gateReason = "LOCAL_NPU_NOT_READY"
			gateDetail = defaultString(npuProfile.GetDetail(), "host npu profile not ready")
		case !available:
			gateReason = "LOCAL_NODE_UNAVAILABLE"
			gateDetail = "node unavailable"
		}
		hints.Nexa = &runtimev1.LocalProviderHintsNexa{
			Backend:                   "nexa",
			PreferredAdapter:          strings.TrimSpace(adapter),
			PluginId:                  strings.TrimSpace(service.GetServiceId()),
			DeviceId:                  defaultString(strings.TrimSpace(npuProfile.GetVendor()), "host-npu"),
			ModelType:                 normalizedCapability,
			NpuMode:                   defaultString(strings.TrimSpace(hints.GetExtra()["npu_mode"]), "auto"),
			PolicyGate:                normalizedPolicyGate,
			HostNpuReady:              hostNPUReady,
			ModelProbeHasNpuCandidate: modelProbeHasNPUCandidate,
			PolicyGateAllowsNpu:       policyGateAllowsNPU,
			NpuUsable:                 npuUsable,
			GateReason:                gateReason,
			GateDetail:                gateDetail,
		}
	}
	return hints
}

func matchesLocalAuditFilter(event *runtimev1.LocalAuditEvent, req *runtimev1.ListLocalAuditsRequest, eventTypes map[string]bool) bool {
	if event == nil {
		return false
	}
	if len(eventTypes) > 0 && !eventTypes[event.GetEventType()] {
		return false
	}
	if source := strings.TrimSpace(req.GetSource()); source != "" && event.GetSource() != source {
		return false
	}
	if modality := strings.TrimSpace(req.GetModality()); modality != "" && event.GetModality() != modality {
		return false
	}
	if localModelID := strings.TrimSpace(req.GetLocalModelId()); localModelID != "" && event.GetLocalModelId() != localModelID {
		return false
	}
	if reasonCode := strings.TrimSpace(req.GetReasonCode()); reasonCode != "" && event.GetReasonCode() != reasonCode {
		return false
	}
	if modID := strings.TrimSpace(req.GetModId()); modID != "" {
		payload := structToMap(event.GetPayload())
		if payloadModID := strings.TrimSpace(fmt.Sprintf("%v", payload["modId"])); payloadModID != modID {
			return false
		}
	}
	if tr := req.GetTimeRange(); tr != nil {
		from := strings.TrimSpace(tr.GetFrom())
		if from != "" && event.GetOccurredAt() < from {
			return false
		}
		to := strings.TrimSpace(tr.GetTo())
		if to != "" && event.GetOccurredAt() > to {
			return false
		}
	}
	return true
}

func defaultVerifiedModels() []*runtimev1.LocalVerifiedModelDescriptor {
	return []*runtimev1.LocalVerifiedModelDescriptor{
		{
			TemplateId:  "verified.chat.llama3_8b",
			Title:       "Llama 3 8B Instruct",
			Description: "General chat model for local runtime",
			InstallKind: "download",
			ModelId:     "local/llama3.1",
			Repo:        "nimiplatform/llama3.1-8b-instruct",
			Revision:    "main",
			Capabilities: []string{
				"chat",
			},
			Engine:         "localai",
			Entry:          "./dist/index.js",
			Files:          []string{"model.gguf"},
			License:        "llama3",
			Hashes:         map[string]string{},
			Endpoint:       defaultLocalRuntimeEndpoint,
			FileCount:      1,
			TotalSizeBytes: 0,
			Tags:           []string{"chat", "verified"},
		},
		{
			TemplateId:  "verified.stt.whisper",
			Title:       "Whisper STT",
			Description: "Speech to text local model",
			InstallKind: "download",
			ModelId:     "local/whisper-large-v3",
			Repo:        "nimiplatform/whisper-large-v3",
			Revision:    "main",
			Capabilities: []string{
				"stt",
			},
			Engine:         "localai",
			Entry:          "./dist/index.js",
			Files:          []string{"model.bin"},
			License:        "mit",
			Hashes:         map[string]string{},
			Endpoint:       defaultLocalRuntimeEndpoint,
			FileCount:      1,
			TotalSizeBytes: 0,
			Tags:           []string{"stt", "verified"},
		},
	}
}

func defaultCatalogFromVerified(verified []*runtimev1.LocalVerifiedModelDescriptor) []*runtimev1.LocalCatalogModelDescriptor {
	items := make([]*runtimev1.LocalCatalogModelDescriptor, 0, len(verified))
	for _, item := range verified {
		items = append(items, &runtimev1.LocalCatalogModelDescriptor{
			ItemId:            "catalog_" + slug(item.GetTemplateId()),
			Source:            "verified",
			Title:             item.GetTitle(),
			Description:       item.GetDescription(),
			ModelId:           item.GetModelId(),
			Repo:              item.GetRepo(),
			Revision:          item.GetRevision(),
			TemplateId:        item.GetTemplateId(),
			Capabilities:      append([]string(nil), item.GetCapabilities()...),
			Engine:            item.GetEngine(),
			EngineRuntimeMode: runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_ATTACHED_ENDPOINT,
			InstallKind:       item.GetInstallKind(),
			InstallAvailable:  true,
			Endpoint:          item.GetEndpoint(),
			Entry:             item.GetEntry(),
			Files:             append([]string(nil), item.GetFiles()...),
			License:           item.GetLicense(),
			Hashes:            cloneStringMap(item.GetHashes()),
			Tags:              append([]string(nil), item.GetTags()...),
			Verified:          true,
		})
	}
	return items
}

func defaultString(input string, fallback string) string {
	normalized := strings.TrimSpace(input)
	if normalized != "" {
		return normalized
	}
	return fallback
}

func firstCapability(values []string) string {
	if len(values) == 0 {
		return ""
	}
	return strings.TrimSpace(values[0])
}

func normalizeStringSlice(values []string) []string {
	seen := make(map[string]bool, len(values))
	out := make([]string, 0, len(values))
	for _, item := range values {
		normalized := strings.TrimSpace(item)
		if normalized == "" || seen[normalized] {
			continue
		}
		seen[normalized] = true
		out = append(out, normalized)
	}
	return out
}

func cloneStringMap(input map[string]string) map[string]string {
	if len(input) == 0 {
		return map[string]string{}
	}
	out := make(map[string]string, len(input))
	for key, value := range input {
		out[key] = value
	}
	return out
}

func cloneLocalModel(input *runtimev1.LocalModelRecord) *runtimev1.LocalModelRecord {
	if input == nil {
		return nil
	}
	cloned, _ := proto.Clone(input).(*runtimev1.LocalModelRecord)
	return cloned
}

func cloneVerifiedModel(input *runtimev1.LocalVerifiedModelDescriptor) *runtimev1.LocalVerifiedModelDescriptor {
	if input == nil {
		return nil
	}
	cloned, _ := proto.Clone(input).(*runtimev1.LocalVerifiedModelDescriptor)
	return cloned
}

func cloneCatalogItem(input *runtimev1.LocalCatalogModelDescriptor) *runtimev1.LocalCatalogModelDescriptor {
	if input == nil {
		return nil
	}
	cloned, _ := proto.Clone(input).(*runtimev1.LocalCatalogModelDescriptor)
	return cloned
}

func cloneDeviceProfile(input *runtimev1.LocalDeviceProfile) *runtimev1.LocalDeviceProfile {
	if input == nil {
		return nil
	}
	cloned, _ := proto.Clone(input).(*runtimev1.LocalDeviceProfile)
	return cloned
}

func cloneDependencyDescriptor(input *runtimev1.LocalDependencyDescriptor) *runtimev1.LocalDependencyDescriptor {
	if input == nil {
		return nil
	}
	cloned, _ := proto.Clone(input).(*runtimev1.LocalDependencyDescriptor)
	return cloned
}

func clonePreflightDecisions(input []*runtimev1.LocalPreflightDecision) []*runtimev1.LocalPreflightDecision {
	out := make([]*runtimev1.LocalPreflightDecision, 0, len(input))
	for _, item := range input {
		cloned, _ := proto.Clone(item).(*runtimev1.LocalPreflightDecision)
		if cloned != nil {
			out = append(out, cloned)
		}
	}
	return out
}

func cloneServiceDescriptor(input *runtimev1.LocalServiceDescriptor) *runtimev1.LocalServiceDescriptor {
	if input == nil {
		return nil
	}
	cloned, _ := proto.Clone(input).(*runtimev1.LocalServiceDescriptor)
	return cloned
}

func cloneProviderHints(input *runtimev1.LocalProviderHints) *runtimev1.LocalProviderHints {
	if input == nil {
		return nil
	}
	cloned, _ := proto.Clone(input).(*runtimev1.LocalProviderHints)
	return cloned
}

func cloneLocalAuditEvent(input *runtimev1.LocalAuditEvent) *runtimev1.LocalAuditEvent {
	if input == nil {
		return nil
	}
	cloned, _ := proto.Clone(input).(*runtimev1.LocalAuditEvent)
	return cloned
}

func toStruct(payload map[string]any) *structpb.Struct {
	if len(payload) == 0 {
		return nil
	}
	result, err := structpb.NewStruct(payload)
	if err != nil {
		return nil
	}
	return result
}

func structToMap(value *structpb.Struct) map[string]any {
	if value == nil {
		return map[string]any{}
	}
	return value.AsMap()
}

func cloneStruct(value *structpb.Struct) *structpb.Struct {
	if value == nil {
		return nil
	}
	cloned, _ := proto.Clone(value).(*structpb.Struct)
	return cloned
}

func slug(input string) string {
	normalized := strings.TrimSpace(strings.ToLower(input))
	if normalized == "" {
		return "item"
	}
	var builder strings.Builder
	lastDash := false
	for _, r := range normalized {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			builder.WriteRune(r)
			lastDash = false
			continue
		}
		if !lastDash {
			builder.WriteRune('_')
			lastDash = true
		}
	}
	out := strings.Trim(builder.String(), "_")
	if out == "" {
		return "item"
	}
	return out
}

func nowISO() string {
	return time.Now().UTC().Format(time.RFC3339Nano)
}
