package localruntime

import (
	"context"
	"fmt"
	"path/filepath"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
)

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
	model, err := s.updateModelStatus(req.GetLocalModelId(), runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_REMOVED, "model removed")
	if err != nil {
		return nil, err
	}
	return &runtimev1.RemoveLocalModelResponse{Model: model}, nil
}

func (s *Service) StartLocalModel(_ context.Context, req *runtimev1.StartLocalModelRequest) (*runtimev1.StartLocalModelResponse, error) {
	model, err := s.updateModelStatus(req.GetLocalModelId(), runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE, "model active")
	if err != nil {
		return nil, err
	}
	return &runtimev1.StartLocalModelResponse{Model: model}, nil
}

func (s *Service) StopLocalModel(_ context.Context, req *runtimev1.StopLocalModelRequest) (*runtimev1.StopLocalModelResponse, error) {
	model, err := s.updateModelStatus(req.GetLocalModelId(), runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_INSTALLED, "model stopped")
	if err != nil {
		return nil, err
	}
	return &runtimev1.StopLocalModelResponse{Model: model}, nil
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
