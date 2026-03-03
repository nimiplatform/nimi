package localruntime

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/pagination"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func (s *Service) ListLocalModels(_ context.Context, req *runtimev1.ListLocalModelsRequest) (*runtimev1.ListLocalModelsResponse, error) {
	statusFilter := req.GetStatusFilter()
	engineFilter := strings.ToLower(strings.TrimSpace(req.GetEngineFilter()))
	categoryFilter := strings.ToLower(strings.TrimSpace(req.GetCategoryFilter()))

	s.mu.RLock()
	defer s.mu.RUnlock()
	models := make([]*runtimev1.LocalModelRecord, 0, len(s.models))
	for _, model := range s.models {
		if statusFilter != runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNSPECIFIED && model.GetStatus() != statusFilter {
			continue
		}
		if engineFilter != "" && strings.ToLower(strings.TrimSpace(model.GetEngine())) != engineFilter {
			continue
		}
		if categoryFilter != "" {
			matched := false
			for _, capName := range model.GetCapabilities() {
				if strings.EqualFold(strings.TrimSpace(capName), categoryFilter) {
					matched = true
					break
				}
			}
			if !matched {
				continue
			}
		}
		models = append(models, cloneLocalModel(model))
	}
	sort.Slice(models, func(i, j int) bool {
		ci := localModelSortCategory(models[i])
		cj := localModelSortCategory(models[j])
		if ci != cj {
			return ci < cj
		}
		if models[i].GetModelId() != models[j].GetModelId() {
			return models[i].GetModelId() < models[j].GetModelId()
		}
		return models[i].GetLocalModelId() < models[j].GetLocalModelId()
	})
	filterDigest := pagination.FilterDigest(statusFilter.String(), engineFilter, categoryFilter)
	start, end, next, err := resolvePageBounds(req.GetPageToken(), filterDigest, req.GetPageSize(), 50, 200, len(models))
	if err != nil {
		return nil, err
	}
	return &runtimev1.ListLocalModelsResponse{
		Models:        models[start:end],
		NextPageToken: next,
	}, nil
}

func (s *Service) ListVerifiedModels(_ context.Context, req *runtimev1.ListVerifiedModelsRequest) (*runtimev1.ListVerifiedModelsResponse, error) {
	categoryFilter := strings.ToLower(strings.TrimSpace(req.GetCategoryFilter()))
	engineFilter := strings.ToLower(strings.TrimSpace(req.GetEngineFilter()))

	s.mu.RLock()
	defer s.mu.RUnlock()
	items := make([]*runtimev1.LocalVerifiedModelDescriptor, 0, len(s.verified))
	for _, item := range s.verified {
		if engineFilter != "" && strings.ToLower(strings.TrimSpace(item.GetEngine())) != engineFilter {
			continue
		}
		if categoryFilter != "" {
			matched := false
			for _, tag := range item.GetTags() {
				if strings.EqualFold(strings.TrimSpace(tag), categoryFilter) {
					matched = true
					break
				}
			}
			if !matched {
				for _, capName := range item.GetCapabilities() {
					if strings.EqualFold(strings.TrimSpace(capName), categoryFilter) {
						matched = true
						break
					}
				}
			}
			if !matched {
				continue
			}
		}
		items = append(items, cloneVerifiedModel(item))
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].GetTemplateId() < items[j].GetTemplateId()
	})
	filterDigest := pagination.FilterDigest(categoryFilter, engineFilter)
	start, end, next, err := resolvePageBounds(req.GetPageToken(), filterDigest, req.GetPageSize(), 50, 200, len(items))
	if err != nil {
		return nil, err
	}
	return &runtimev1.ListVerifiedModelsResponse{
		Models:        items[start:end],
		NextPageToken: next,
	}, nil
}

func (s *Service) SearchCatalogModels(ctx context.Context, req *runtimev1.SearchCatalogModelsRequest) (*runtimev1.SearchCatalogModelsResponse, error) {
	query := strings.ToLower(strings.TrimSpace(req.GetQuery()))
	capability := strings.ToLower(strings.TrimSpace(req.GetCapability()))
	categoryFilter := strings.ToLower(strings.TrimSpace(req.GetCategoryFilter()))
	engineFilter := strings.ToLower(strings.TrimSpace(req.GetEngineFilter()))

	s.mu.RLock()
	localCatalog := make([]*runtimev1.LocalCatalogModelDescriptor, 0, len(s.catalog))
	for _, item := range s.catalog {
		localCatalog = append(localCatalog, cloneCatalogItem(item))
	}
	s.mu.RUnlock()

	items := make([]*runtimev1.LocalCatalogModelDescriptor, 0, len(localCatalog)+hfCatalogDefaultLimit)
	for _, item := range localCatalog {
		if !matchesCatalogFilters(item, query, capability, categoryFilter, engineFilter) {
			continue
		}
		items = append(items, item)
	}

	hfLimit := req.GetLimit()
	if hfLimit <= 0 {
		hfLimit = req.GetPageSize()
	}
	hfItems, err := s.searchHFCatalog(ctx, hfCatalogSearchRequest{
		Query:          query,
		Capability:     capability,
		CategoryFilter: categoryFilter,
		EngineFilter:   engineFilter,
		Limit:          hfLimit,
	})
	if err != nil {
		if strings.Contains(err.Error(), errHfRepoInvalid.Error()) {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_HF_REPO_INVALID)
		}
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_LOCAL_HF_SEARCH_FAILED)
	}
	for _, item := range hfItems {
		if !matchesCatalogFilters(item, query, capability, categoryFilter, engineFilter) {
			continue
		}
		items = append(items, cloneCatalogItem(item))
	}

	sort.Slice(items, func(i, j int) bool {
		if items[i].GetVerified() != items[j].GetVerified() {
			return items[i].GetVerified()
		}
		if strings.EqualFold(items[i].GetTitle(), items[j].GetTitle()) {
			return items[i].GetItemId() < items[j].GetItemId()
		}
		return strings.ToLower(items[i].GetTitle()) < strings.ToLower(items[j].GetTitle())
	})
	items = dedupeCatalogItems(items)

	pageSize := req.GetPageSize()
	if pageSize <= 0 {
		if req.GetLimit() > 0 {
			pageSize = req.GetLimit()
		} else {
			pageSize = 50
		}
	}
	filterDigest := pagination.FilterDigest(query, capability, categoryFilter, engineFilter)
	start, end, next, err := resolvePageBounds(req.GetPageToken(), filterDigest, pageSize, 50, 200, len(items))
	if err != nil {
		return nil, err
	}
	return &runtimev1.SearchCatalogModelsResponse{
		Items:         items[start:end],
		NextPageToken: next,
	}, nil
}

func matchesCatalogFilters(item *runtimev1.LocalCatalogModelDescriptor, query string, capability string, categoryFilter string, engineFilter string) bool {
	if !matchesCatalogSearch(item, query, capability) {
		return false
	}
	if engineFilter != "" && strings.ToLower(strings.TrimSpace(item.GetEngine())) != engineFilter {
		return false
	}
	if categoryFilter == "" {
		return true
	}
	for _, tag := range item.GetTags() {
		if strings.EqualFold(strings.TrimSpace(tag), categoryFilter) {
			return true
		}
	}
	for _, capName := range item.GetCapabilities() {
		if strings.EqualFold(strings.TrimSpace(capName), categoryFilter) {
			return true
		}
	}
	return false
}

func dedupeCatalogItems(items []*runtimev1.LocalCatalogModelDescriptor) []*runtimev1.LocalCatalogModelDescriptor {
	seen := make(map[string]bool, len(items))
	out := make([]*runtimev1.LocalCatalogModelDescriptor, 0, len(items))
	for _, item := range items {
		if item == nil {
			continue
		}
		key := strings.ToLower(strings.TrimSpace(item.GetModelId()) + "|" + strings.TrimSpace(item.GetEngine()))
		if key == "|" {
			key = strings.ToLower(strings.TrimSpace(item.GetItemId()))
		}
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, item)
	}
	return out
}

func (s *Service) ResolveModelInstallPlan(_ context.Context, req *runtimev1.ResolveModelInstallPlanRequest) (*runtimev1.ResolveModelInstallPlanResponse, error) {
	deviceProfile := collectDeviceProfile()
	now := nowISO()

	s.mu.RLock()
	catalogItem := cloneCatalogItem(s.resolveCatalogItem(req))
	s.mu.RUnlock()
	if catalogItem != nil {
		engine := defaultString(catalogItem.GetEngine(), "localai")
		plan := &runtimev1.LocalInstallPlanDescriptor{
			PlanId:            "plan_" + ulid.Make().String(),
			ItemId:            catalogItem.GetItemId(),
			Source:            defaultString(catalogItem.GetSource(), "verified"),
			TemplateId:        catalogItem.GetTemplateId(),
			ModelId:           catalogItem.GetModelId(),
			Repo:              catalogItem.GetRepo(),
			Revision:          defaultString(catalogItem.GetRevision(), "main"),
			Capabilities:      append([]string(nil), catalogItem.GetCapabilities()...),
			Engine:            engine,
			EngineRuntimeMode: defaultRuntimeMode(catalogItem.GetEngineRuntimeMode()),
			InstallKind:       defaultString(catalogItem.GetInstallKind(), "download"),
			InstallAvailable:  true,
			Endpoint:          resolveInstallPlanEndpoint(engine, req.GetEndpoint(), catalogItem.GetEndpoint()),
			ProviderHints:     cloneProviderHints(catalogItem.GetProviderHints()),
			Entry:             defaultString(catalogItem.GetEntry(), "./dist/index.js"),
			Files:             append([]string(nil), catalogItem.GetFiles()...),
			License:           defaultString(catalogItem.GetLicense(), "unknown"),
			Hashes:            cloneStringMap(catalogItem.GetHashes()),
			Warnings:          startupCompatibilityWarnings(engine, deviceProfile),
			ReasonCode:        "ACTION_EXECUTED",
		}
		s.evaluateInstallPlanAvailability(plan)
		s.mu.Lock()
		s.appendRuntimeAuditLocked(&runtimev1.LocalAuditEvent{
			Id:         "audit_" + ulid.Make().String(),
			EventType:  "model_install_plan_resolved",
			OccurredAt: now,
			Detail:     fmt.Sprintf("resolved install plan for %s (available=%t reason=%s)", plan.GetModelId(), plan.GetInstallAvailable(), plan.GetReasonCode()),
			ModelId:    plan.GetModelId(),
			Payload: toStruct(map[string]any{
				"install_available": plan.GetInstallAvailable(),
				"reason_code":       plan.GetReasonCode(),
				"warnings":          append([]string(nil), plan.GetWarnings()...),
			}),
		})
		s.mu.Unlock()
		return &runtimev1.ResolveModelInstallPlanResponse{Plan: plan}, nil
	}

	engine := defaultString(strings.TrimSpace(req.GetEngine()), "localai")
	plan := &runtimev1.LocalInstallPlanDescriptor{
		PlanId:            "plan_" + ulid.Make().String(),
		ItemId:            req.GetItemId(),
		Source:            defaultString(req.GetSource(), "manual"),
		TemplateId:        req.GetTemplateId(),
		ModelId:           strings.TrimSpace(req.GetModelId()),
		Repo:              strings.TrimSpace(req.GetRepo()),
		Revision:          defaultString(strings.TrimSpace(req.GetRevision()), "main"),
		Capabilities:      normalizeStringSlice(req.GetCapabilities()),
		Engine:            engine,
		EngineRuntimeMode: runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_ATTACHED_ENDPOINT,
		InstallKind:       "download",
		InstallAvailable:  true,
		Endpoint:          resolveInstallPlanEndpoint(engine, strings.TrimSpace(req.GetEndpoint()), ""),
		Entry:             defaultString(strings.TrimSpace(req.GetEntry()), "./dist/index.js"),
		Files:             normalizeStringSlice(req.GetFiles()),
		License:           defaultString(strings.TrimSpace(req.GetLicense()), "unknown"),
		Hashes:            cloneStringMap(req.GetHashes()),
		Warnings:          startupCompatibilityWarnings(engine, deviceProfile),
		ReasonCode:        "ACTION_EXECUTED",
	}
	if plan.GetModelId() == "" {
		plan.InstallAvailable = false
		plan.ReasonCode = "LOCAL_MODEL_ID_REQUIRED"
		plan.Warnings = append(plan.GetWarnings(), "modelId is required for install plan resolution")
		return &runtimev1.ResolveModelInstallPlanResponse{Plan: plan}, nil
	}
	s.evaluateInstallPlanAvailability(plan)
	return &runtimev1.ResolveModelInstallPlanResponse{Plan: plan}, nil
}

func defaultRuntimeMode(mode runtimev1.LocalEngineRuntimeMode) runtimev1.LocalEngineRuntimeMode {
	if mode == runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_UNSPECIFIED {
		return runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_ATTACHED_ENDPOINT
	}
	return mode
}

func resolveInstallPlanEndpoint(engine string, requestEndpoint string, fallbackEndpoint string) string {
	if endpoint := strings.TrimSpace(requestEndpoint); endpoint != "" {
		return endpoint
	}
	if endpoint := strings.TrimSpace(fallbackEndpoint); endpoint != "" {
		return endpoint
	}
	if strings.EqualFold(strings.TrimSpace(engine), "localai") {
		return defaultLocalRuntimeEndpoint
	}
	return ""
}

func (s *Service) evaluateInstallPlanAvailability(plan *runtimev1.LocalInstallPlanDescriptor) {
	if plan == nil {
		return
	}
	engine := strings.ToLower(strings.TrimSpace(plan.GetEngine()))
	mode := defaultRuntimeMode(plan.GetEngineRuntimeMode())
	plan.EngineRuntimeMode = mode

	switch mode {
	case runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_ATTACHED_ENDPOINT:
		endpoint := strings.TrimSpace(plan.GetEndpoint())
		if endpoint == "" {
			plan.InstallAvailable = false
			if engine == "nexa" {
				plan.ReasonCode = runtimev1.ReasonCode_AI_LOCAL_ENDPOINT_REQUIRED.String()
			} else {
				plan.ReasonCode = "LOCAL_ENDPOINT_REQUIRED"
			}
			return
		}
		if _, err := buildModelsProbeURL(endpoint); err != nil {
			plan.InstallAvailable = false
			plan.ReasonCode = "LOCAL_ENDPOINT_INVALID"
			return
		}
		plan.InstallAvailable = true
		plan.ReasonCode = "ACTION_EXECUTED"
	case runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED:
		mgr, err := s.getEngineManager()
		if err != nil {
			plan.InstallAvailable = false
			plan.ReasonCode = "LOCAL_ENGINE_MANAGER_UNAVAILABLE"
			return
		}
		if _, err := mgr.EngineStatus(engine); err != nil {
			plan.InstallAvailable = false
			plan.ReasonCode = "LOCAL_ENGINE_BINARY_UNAVAILABLE"
			return
		}
		plan.InstallAvailable = true
		plan.ReasonCode = "ACTION_EXECUTED"
	default:
		plan.InstallAvailable = false
		plan.ReasonCode = "LOCAL_ENGINE_RUNTIME_MODE_INVALID"
	}
}

func (s *Service) InstallLocalModel(_ context.Context, req *runtimev1.InstallLocalModelRequest) (*runtimev1.InstallLocalModelResponse, error) {
	modelID := strings.TrimSpace(req.GetModelId())
	if modelID == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID)
	}
	engine := defaultString(strings.TrimSpace(req.GetEngine()), "localai")
	endpoint := strings.TrimSpace(req.GetEndpoint())
	if strings.EqualFold(engine, "nexa") && endpoint == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_ENDPOINT_REQUIRED)
	}
	if endpoint == "" {
		endpoint = defaultLocalRuntimeEndpoint
	}

	s.mu.RLock()
	for _, existing := range s.models {
		if existing.GetStatus() == runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_REMOVED {
			continue
		}
		if existing.GetModelId() == modelID && strings.EqualFold(existing.GetEngine(), engine) {
			s.mu.RUnlock()
			return nil, grpcerr.WithReasonCode(codes.AlreadyExists, runtimev1.ReasonCode_AI_LOCAL_MODEL_ALREADY_INSTALLED)
		}
	}
	s.mu.RUnlock()

	now := nowISO()
	localModelID := ulid.Make().String()
	record := &runtimev1.LocalModelRecord{
		LocalModelId: localModelID,
		ModelId:      modelID,
		Capabilities: normalizeStringSlice(req.GetCapabilities()),
		Engine:       engine,
		Entry:        defaultString(strings.TrimSpace(req.GetEntry()), "./dist/index.js"),
		License:      defaultString(strings.TrimSpace(req.GetLicense()), "unknown"),
		Source: &runtimev1.LocalModelSource{
			Repo:     strings.TrimSpace(req.GetRepo()),
			Revision: defaultString(strings.TrimSpace(req.GetRevision()), "main"),
		},
		Hashes:      cloneStringMap(req.GetHashes()),
		Endpoint:    endpoint,
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
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_TEMPLATE_NOT_FOUND)
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
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_LOCAL_TEMPLATE_NOT_FOUND)
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
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID)
	}
	content, err := os.ReadFile(manifestPath)
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID)
	}
	var manifest map[string]any
	if err := json.Unmarshal(content, &manifest); err != nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID)
	}

	modelID, ok := manifestString(manifest, "model_id", "modelId")
	if !ok || strings.TrimSpace(modelID) == "" {
		base := strings.TrimSuffix(filepath.Base(manifestPath), filepath.Ext(manifestPath))
		modelID = strings.TrimSpace(base)
	}
	if modelID == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID)
	}
	engine := defaultString(manifestStringDefault(manifest, "engine"), "localai")
	entry := defaultString(manifestStringDefault(manifest, "entry"), "./dist/index.js")
	license := defaultString(manifestStringDefault(manifest, "license"), "unknown")
	endpoint := strings.TrimSpace(req.GetEndpoint())
	if endpoint == "" {
		endpoint = manifestStringDefault(manifest, "endpoint")
	}
	if strings.EqualFold(engine, "nexa") && strings.TrimSpace(endpoint) == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_ENDPOINT_REQUIRED)
	}
	if endpoint == "" {
		endpoint = defaultLocalRuntimeEndpoint
	}

	capabilities, capsErr := manifestStringSlice(manifest, "capabilities")
	if capsErr != nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_SCHEMA_INVALID)
	}
	if len(capabilities) == 0 {
		capabilities = []string{"chat"}
	}
	hashes, hashesErr := manifestStringMap(manifest, "hashes")
	if hashesErr != nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_SCHEMA_INVALID)
	}
	repo := manifestStringDefault(manifest, "repo")
	revision := defaultString(manifestStringDefault(manifest, "revision"), "import")
	if sourceValue, ok := manifest["source"]; ok {
		sourceObj, objOK := sourceValue.(map[string]any)
		if !objOK {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_SCHEMA_INVALID)
		}
		if sourceRepo, ok := manifestString(sourceObj, "repo"); ok {
			repo = sourceRepo
		}
		if sourceRevision, ok := manifestString(sourceObj, "revision"); ok {
			revision = sourceRevision
		}
	}
	if repo == "" {
		repo = "file://" + manifestPath
	}

	s.mu.RLock()
	for _, existing := range s.models {
		if existing.GetStatus() == runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_REMOVED {
			continue
		}
		if existing.GetModelId() == modelID && strings.EqualFold(existing.GetEngine(), engine) {
			s.mu.RUnlock()
			return nil, grpcerr.WithReasonCode(codes.AlreadyExists, runtimev1.ReasonCode_AI_LOCAL_MODEL_ALREADY_INSTALLED)
		}
	}
	s.mu.RUnlock()

	now := nowISO()

	record := &runtimev1.LocalModelRecord{
		LocalModelId: ulid.Make().String(),
		ModelId:      modelID,
		Capabilities: normalizeStringSlice(capabilities),
		Engine:       engine,
		Entry:        entry,
		License:      license,
		Source: &runtimev1.LocalModelSource{
			Repo:     repo,
			Revision: revision,
		},
		Hashes:               hashes,
		Endpoint:             endpoint,
		Status:               runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_INSTALLED,
		InstalledAt:          now,
		UpdatedAt:            now,
		LocalInvokeProfileId: manifestStringDefault(manifest, "local_invoke_profile_id", "localInvokeProfileId"),
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

func manifestString(input map[string]any, keys ...string) (string, bool) {
	for _, key := range keys {
		value, exists := input[key]
		if !exists {
			continue
		}
		text, ok := value.(string)
		if !ok {
			return "", false
		}
		return strings.TrimSpace(text), true
	}
	return "", false
}

func manifestStringDefault(input map[string]any, keys ...string) string {
	value, ok := manifestString(input, keys...)
	if !ok {
		return ""
	}
	return value
}

func manifestStringSlice(input map[string]any, key string) ([]string, error) {
	value, exists := input[key]
	if !exists || value == nil {
		return nil, nil
	}
	rawItems, ok := value.([]any)
	if !ok {
		return nil, fmt.Errorf("invalid %s", key)
	}
	items := make([]string, 0, len(rawItems))
	for _, item := range rawItems {
		text, ok := item.(string)
		if !ok {
			return nil, fmt.Errorf("invalid %s entry", key)
		}
		items = append(items, strings.TrimSpace(text))
	}
	return normalizeStringSlice(items), nil
}

func manifestStringMap(input map[string]any, key string) (map[string]string, error) {
	value, exists := input[key]
	if !exists || value == nil {
		return map[string]string{}, nil
	}
	rawMap, ok := value.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("invalid %s", key)
	}
	result := make(map[string]string, len(rawMap))
	for k, v := range rawMap {
		text, ok := v.(string)
		if !ok {
			return nil, fmt.Errorf("invalid %s value", key)
		}
		result[k] = strings.TrimSpace(text)
	}
	return result, nil
}

func (s *Service) RemoveLocalModel(_ context.Context, req *runtimev1.RemoveLocalModelRequest) (*runtimev1.RemoveLocalModelResponse, error) {
	localModelID := strings.TrimSpace(req.GetLocalModelId())
	if localModelID == "" {
		return nil, status.Errorf(codes.InvalidArgument, "local model id is required")
	}
	current := s.modelByID(localModelID)
	if current == nil {
		return nil, status.Errorf(codes.NotFound, "local model %s not found", localModelID)
	}
	if boundServiceID := s.findBoundServiceID(localModelID); boundServiceID != "" {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_INVALID_TRANSITION)
	}
	model, err := s.updateModelStatus(localModelID, runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_REMOVED, "model removed")
	if err != nil {
		return nil, err
	}
	return &runtimev1.RemoveLocalModelResponse{Model: model}, nil
}

func (s *Service) StartLocalModel(ctx context.Context, req *runtimev1.StartLocalModelRequest) (*runtimev1.StartLocalModelResponse, error) {
	localModelID := strings.TrimSpace(req.GetLocalModelId())
	if localModelID == "" {
		return nil, status.Errorf(codes.InvalidArgument, "local model id is required")
	}
	current := s.modelByID(localModelID)
	if current == nil {
		return nil, status.Errorf(codes.NotFound, "local model %s not found", localModelID)
	}
	if current.GetStatus() == runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_REMOVED {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_INVALID_TRANSITION)
	}

	profile := collectDeviceProfile()
	warnings := startupCompatibilityWarnings(current.GetEngine(), profile)

	if current.GetStatus() != runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE {
		activated, err := s.updateModelStatus(
			localModelID,
			runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE,
			appendWarnings("model active", warnings),
		)
		if err != nil {
			return nil, err
		}
		current = activated
	}

	bootstrapErr := s.bootstrapEngineIfManaged(ctx, current.GetEngine(), modelProbeEndpoint(current))
	probe := s.probeEndpoint(ctx, modelProbeEndpoint(current))
	if probe.healthy {
		s.resetModelRecovery(localModelID)
		latest := s.modelByID(localModelID)
		if latest == nil {
			return nil, status.Errorf(codes.NotFound, "local model %s not found", localModelID)
		}
		return &runtimev1.StartLocalModelResponse{Model: latest}, nil
	}

	failures, _ := s.modelRecoveryFailure(localModelID, time.Now().UTC())
	detail := appendWarnings(defaultString(probe.detail, "model probe failed"), warnings)
	if bootstrapErr != nil {
		detail += "; bootstrap_error=" + strings.TrimSpace(bootstrapErr.Error())
	}
	if strings.TrimSpace(probe.probeURL) != "" {
		detail += "; probe_url=" + probe.probeURL
	}
	detail = fmt.Sprintf("%s; consecutive_failures=%d", detail, failures)
	unhealthy, err := s.updateModelStatus(localModelID, runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNHEALTHY, detail)
	if err != nil {
		return nil, err
	}
	return &runtimev1.StartLocalModelResponse{Model: unhealthy}, nil
}

func (s *Service) StopLocalModel(_ context.Context, req *runtimev1.StopLocalModelRequest) (*runtimev1.StopLocalModelResponse, error) {
	localModelID := strings.TrimSpace(req.GetLocalModelId())
	if localModelID == "" {
		return nil, status.Errorf(codes.InvalidArgument, "local model id is required")
	}
	current := s.modelByID(localModelID)
	if current == nil {
		return nil, status.Errorf(codes.NotFound, "local model %s not found", localModelID)
	}
	model, err := s.updateModelStatus(localModelID, runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_INSTALLED, "model stopped")
	if err != nil {
		return nil, err
	}
	return &runtimev1.StopLocalModelResponse{Model: model}, nil
}

func (s *Service) CheckLocalModelHealth(ctx context.Context, req *runtimev1.CheckLocalModelHealthRequest) (*runtimev1.CheckLocalModelHealthResponse, error) {
	target := strings.TrimSpace(req.GetLocalModelId())
	s.mu.RLock()
	models := make([]*runtimev1.LocalModelRecord, 0, len(s.models))
	for _, model := range s.models {
		if target != "" && model.GetLocalModelId() != target {
			continue
		}
		models = append(models, cloneLocalModel(model))
	}
	s.mu.RUnlock()
	if target != "" && len(models) == 0 {
		return nil, status.Errorf(codes.NotFound, "local model %s not found", target)
	}

	result := make([]*runtimev1.LocalModelHealth, 0, len(models))
	for _, model := range models {
		if model == nil {
			continue
		}
		localModelID := strings.TrimSpace(model.GetLocalModelId())
		switch model.GetStatus() {
		case runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE:
			bootstrapErr := s.bootstrapEngineIfManaged(ctx, model.GetEngine(), modelProbeEndpoint(model))
			probe := s.probeEndpoint(ctx, modelProbeEndpoint(model))
			if probe.healthy {
				s.resetModelRecovery(localModelID)
				result = append(result, modelHealth(model))
				continue
			}
			failures, interval := s.modelRecoveryFailure(localModelID, time.Now().UTC())
			detail := defaultString(probe.detail, "model probe failed")
			if bootstrapErr != nil {
				detail += "; bootstrap_error=" + strings.TrimSpace(bootstrapErr.Error())
			}
			if strings.TrimSpace(probe.probeURL) != "" {
				detail += "; probe_url=" + probe.probeURL
			}
			detail = fmt.Sprintf("%s; consecutive_failures=%d; next_probe_in=%s", detail, failures, interval.String())
			transitioned, err := s.updateModelStatus(localModelID, runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNHEALTHY, detail)
			if err != nil {
				return nil, err
			}
			result = append(result, modelHealth(transitioned))
		case runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNHEALTHY:
			bootstrapErr := s.bootstrapEngineIfManaged(ctx, model.GetEngine(), modelProbeEndpoint(model))
			probe := s.probeEndpoint(ctx, modelProbeEndpoint(model))
			if probe.healthy {
				successes := s.modelRecoverySuccess(localModelID, time.Now().UTC())
				if successes >= localRecoverySuccessThreshold {
					recovered, err := s.updateModelStatus(localModelID, runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE, "model active")
					if err != nil {
						return nil, err
					}
					s.resetModelRecovery(localModelID)
					result = append(result, modelHealth(recovered))
				} else {
					health := modelHealth(model)
					detail := fmt.Sprintf("recovery probe succeeded (%d/%d)", successes, localRecoverySuccessThreshold)
					if strings.TrimSpace(probe.probeURL) != "" {
						detail += "; probe_url=" + probe.probeURL
					}
					health.Detail = detail
					result = append(result, health)
				}
				continue
			}
			failures, interval := s.modelRecoveryFailure(localModelID, time.Now().UTC())
			health := modelHealth(model)
			detail := defaultString(probe.detail, "model probe failed")
			if bootstrapErr != nil {
				detail += "; bootstrap_error=" + strings.TrimSpace(bootstrapErr.Error())
			}
			if strings.TrimSpace(probe.probeURL) != "" {
				detail += "; probe_url=" + probe.probeURL
			}
			health.Detail = fmt.Sprintf("%s; consecutive_failures=%d; next_probe_in=%s", detail, failures, interval.String())
			result = append(result, health)
		default:
			s.resetModelRecovery(localModelID)
			result = append(result, modelHealth(model))
		}
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].GetLocalModelId() < result[j].GetLocalModelId()
	})
	return &runtimev1.CheckLocalModelHealthResponse{Models: result}, nil
}

func (s *Service) CollectDeviceProfile(_ context.Context, req *runtimev1.CollectDeviceProfileRequest) (*runtimev1.CollectDeviceProfileResponse, error) {
	return &runtimev1.CollectDeviceProfileResponse{Profile: collectDeviceProfile(req.GetExtraPorts()...)}, nil
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

func localModelSortCategory(model *runtimev1.LocalModelRecord) string {
	if model == nil {
		return "zzzz"
	}
	has := func(keys ...string) bool {
		for _, capability := range model.GetCapabilities() {
			capability = strings.ToLower(strings.TrimSpace(capability))
			for _, key := range keys {
				if capability == key {
					return true
				}
			}
		}
		return false
	}

	switch {
	case has("custom"):
		return "custom"
	case has("vision", "vl", "multimodal", "image.understand"):
		return "vision"
	case has("image", "image.generate"):
		return "image"
	case has("tts", "speech.synthesize", "audio.synthesize"):
		return "tts"
	case has("stt", "speech.transcribe", "audio.transcribe"):
		return "stt"
	default:
		return "llm"
	}
}

func (s *Service) findBoundServiceID(localModelID string) string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, service := range s.services {
		if service == nil {
			continue
		}
		if service.GetStatus() == runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_REMOVED {
			continue
		}
		if strings.TrimSpace(service.GetLocalModelId()) == localModelID {
			return service.GetServiceId()
		}
	}
	return ""
}
