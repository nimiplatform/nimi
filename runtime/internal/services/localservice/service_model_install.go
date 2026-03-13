package localservice

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
)

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
			EngineConfig:      cloneStruct(catalogItem.GetEngineConfig()),
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
		EngineConfig:      cloneStruct(req.GetEngineConfig()),
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
	if engineRequiresExplicitEndpoint(engine) {
		return ""
	}
	if strings.EqualFold(strings.TrimSpace(engine), "localai") {
		return defaultLocalEndpoint
	}
	return defaultLocalEndpoint
}

func engineRequiresExplicitEndpoint(engine string) bool {
	switch strings.ToLower(strings.TrimSpace(engine)) {
	case "nexa", "sidecar":
		return true
	default:
		return false
	}
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
			if engineRequiresExplicitEndpoint(engine) {
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
	if engineRequiresExplicitEndpoint(engine) && endpoint == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_ENDPOINT_REQUIRED)
	}
	if endpoint == "" {
		endpoint = defaultLocalEndpoint
	}
	endpoint = s.normalizeRequestedLocalModelEndpoint(engine, endpoint)

	s.mu.RLock()
	for _, existing := range s.models {
		if existing.GetStatus() == runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_REMOVED {
			continue
		}
		if strings.EqualFold(existing.GetModelId(), modelID) && strings.EqualFold(existing.GetEngine(), engine) {
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
		Hashes:       cloneStringMap(req.GetHashes()),
		Endpoint:     endpoint,
		Status:       runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_INSTALLED,
		InstalledAt:  now,
		UpdatedAt:    now,
		EngineConfig: cloneStruct(req.GetEngineConfig()),
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
		Source:       "local",
		Modality:     firstCapability(record.GetCapabilities()),
		ModelId:      record.GetModelId(),
		LocalModelId: record.GetLocalModelId(),
		Detail:       "model installed",
	})
	s.mu.Unlock()
	if syncErr := s.SyncManagedLocalAIAssets(context.Background()); syncErr != nil {
		s.logger.Warn("sync localai assets after install failed", "model_id", record.GetModelId(), "error", syncErr)
	}
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
		EngineConfig: cloneStruct(matched.GetEngineConfig()),
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
	if engineRequiresExplicitEndpoint(engine) && strings.TrimSpace(endpoint) == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_ENDPOINT_REQUIRED)
	}
	if endpoint == "" {
		endpoint = defaultLocalEndpoint
	}
	endpoint = s.normalizeRequestedLocalModelEndpoint(engine, endpoint)

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
	engineConfig, engineConfigErr := manifestStruct(manifest, "engine_config", "engineConfig")
	if engineConfigErr != nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_SCHEMA_INVALID)
	}
	if req.GetEngineConfig() != nil {
		engineConfig = cloneStruct(req.GetEngineConfig())
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
		if strings.EqualFold(existing.GetModelId(), modelID) && strings.EqualFold(existing.GetEngine(), engine) {
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
		EngineConfig:         engineConfig,
	}

	s.mu.Lock()
	s.models[record.GetLocalModelId()] = cloneLocalModel(record)
	s.appendRuntimeAuditLocked(&runtimev1.LocalAuditEvent{
		Id:           "audit_" + ulid.Make().String(),
		EventType:    "runtime_model_imported",
		OccurredAt:   now,
		Source:       "local",
		ModelId:      record.GetModelId(),
		LocalModelId: record.GetLocalModelId(),
		Detail:       manifestPath,
	})
	s.mu.Unlock()
	if syncErr := s.SyncManagedLocalAIAssets(context.Background()); syncErr != nil {
		s.logger.Warn("sync localai assets after import failed", "model_id", record.GetModelId(), "error", syncErr)
	}
	return &runtimev1.ImportLocalModelResponse{Model: record}, nil
}
