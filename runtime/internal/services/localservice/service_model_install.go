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
	"github.com/nimiplatform/nimi/runtime/internal/modelregistry"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/structpb"
)

func (s *Service) ResolveModelInstallPlan(_ context.Context, req *runtimev1.ResolveModelInstallPlanRequest) (*runtimev1.ResolveModelInstallPlanResponse, error) {
	deviceProfile := collectDeviceProfile()
	now := nowISO()

	s.mu.RLock()
	catalogItem := cloneCatalogItem(s.resolveCatalogItem(req))
	s.mu.RUnlock()
	if catalogItem != nil {
		engine := defaultLocalEngine(catalogItem.GetEngine(), catalogItem.GetCapabilities())
		binding := resolveCatalogRuntimeBinding(
			engine,
			req.GetEndpoint(),
			catalogItem.GetEngineRuntimeMode(),
			catalogItem.GetEndpoint(),
			deviceProfile,
		)
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
			EngineRuntimeMode: binding.mode,
			InstallKind:       defaultString(catalogItem.GetInstallKind(), "download"),
			InstallAvailable:  true,
			Endpoint:          binding.endpoint,
			ProviderHints:     cloneProviderHints(catalogItem.GetProviderHints()),
			Entry:             defaultString(catalogItem.GetEntry(), "./dist/index.js"),
			Files:             append([]string(nil), catalogItem.GetFiles()...),
			License:           defaultString(catalogItem.GetLicense(), "unknown"),
			Hashes:            cloneStringMap(catalogItem.GetHashes()),
			Warnings:          startupCompatibilityWarnings(engine, deviceProfile),
			ReasonCode:        "ACTION_EXECUTED",
			EngineConfig:      cloneStruct(catalogItem.GetEngineConfig()),
		}
		s.evaluateInstallPlanAvailability(plan, binding.autoRecommended)
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

	capabilities := normalizeStringSlice(req.GetCapabilities())
	engine := defaultLocalEngine(strings.TrimSpace(req.GetEngine()), capabilities)
	binding := resolveInstallRuntimeBinding(engine, strings.TrimSpace(req.GetEndpoint()), deviceProfile)
	plan := &runtimev1.LocalInstallPlanDescriptor{
		PlanId:            "plan_" + ulid.Make().String(),
		ItemId:            req.GetItemId(),
		Source:            defaultString(req.GetSource(), "manual"),
		TemplateId:        req.GetTemplateId(),
		ModelId:           strings.TrimSpace(req.GetModelId()),
		Repo:              strings.TrimSpace(req.GetRepo()),
		Revision:          defaultString(strings.TrimSpace(req.GetRevision()), "main"),
		Capabilities:      capabilities,
		Engine:            engine,
		EngineRuntimeMode: binding.mode,
		InstallKind:       "download",
		InstallAvailable:  true,
		Endpoint:          binding.endpoint,
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
	s.evaluateInstallPlanAvailability(plan, binding.autoRecommended)
	return &runtimev1.ResolveModelInstallPlanResponse{Plan: plan}, nil
}

func defaultLocalEngine(raw string, capabilities []string) string {
	if trimmed := strings.TrimSpace(raw); trimmed != "" {
		return trimmed
	}
	for _, capability := range capabilities {
		order := localProviderPreferenceOrder(localRuntimeGOOSFromProfile(""), capability)
		if len(order) > 0 {
			return order[0]
		}
	}
	return "llama"
}

func (s *Service) evaluateInstallPlanAvailability(plan *runtimev1.LocalInstallPlanDescriptor, autoRecommended bool) {
	if plan == nil {
		return
	}
	engine := strings.ToLower(strings.TrimSpace(plan.GetEngine()))
	mode := normalizeRuntimeMode(plan.GetEngineRuntimeMode())
	plan.EngineRuntimeMode = mode
	deviceProfile := collectDeviceProfile()
	if supportWarnings := managedEngineSupportWarnings(engine, deviceProfile); len(supportWarnings) > 0 {
		plan.Warnings = append(plan.GetWarnings(), supportWarnings...)
	}

	switch mode {
	case runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_ATTACHED_ENDPOINT:
		endpoint := strings.TrimSpace(plan.GetEndpoint())
		if endpoint == "" {
			plan.InstallAvailable = false
			plan.ReasonCode = runtimev1.ReasonCode_AI_LOCAL_ENDPOINT_REQUIRED.String()
			return
		}
		if _, err := buildEndpointProbeURL(engine, endpoint); err != nil {
			plan.InstallAvailable = false
			plan.ReasonCode = "LOCAL_ENDPOINT_INVALID"
			return
		}
		plan.InstallAvailable = true
		plan.ReasonCode = "ACTION_EXECUTED"
	case runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED:
		classification, detail := classifyManagedEngineSupport(engine, deviceProfile)
		if classification != localEngineSupportSupportedSupervised {
			if autoRecommended {
				plan.EngineRuntimeMode = runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_ATTACHED_ENDPOINT
				plan.Endpoint = ""
				plan.InstallAvailable = false
				plan.ReasonCode = runtimev1.ReasonCode_AI_LOCAL_ENDPOINT_REQUIRED.String()
				if strings.TrimSpace(detail) != "" {
					plan.Warnings = append(plan.GetWarnings(), detail)
				}
				return
			}
			plan.InstallAvailable = false
			plan.ReasonCode = "LOCAL_ENGINE_ATTACHED_ENDPOINT_ONLY"
			if strings.TrimSpace(detail) != "" {
				plan.Warnings = append(plan.GetWarnings(), detail)
			}
			return
		}
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

func (s *Service) installLocalModelRecord(
	modelID string,
	capabilities []string,
	engine string,
	entry string,
	license string,
	repo string,
	revision string,
	hashes map[string]string,
	endpoint string,
	mode runtimev1.LocalEngineRuntimeMode,
	localInvokeProfileID string,
	engineConfig *structpb.Struct,
	projectionOverride *modelregistry.NativeProjection,
	auditEventType string,
	auditDetail string,
) (*runtimev1.LocalModelRecord, error) {
	modelKey := localModelIdentityKey(modelID, engine)

	now := nowISO()
	projection, err := modelregistry.InferNativeProjection(modelID, capabilities, nil, runtimev1.ModelStatus_MODEL_STATUS_INSTALLED)
	if err != nil {
		return nil, fmt.Errorf("infer native projection: %w", err)
	}
	if projectionOverride != nil {
		if value := strings.TrimSpace(projectionOverride.LogicalModelID); value != "" {
			projection.LogicalModelID = value
		}
		if value := strings.TrimSpace(projectionOverride.Family); value != "" {
			projection.Family = value
		}
		if len(projectionOverride.ArtifactRoles) > 0 {
			projection.ArtifactRoles = normalizeStringSlice(projectionOverride.ArtifactRoles)
		}
		if value := strings.TrimSpace(projectionOverride.PreferredEngine); value != "" {
			projection.PreferredEngine = value
		}
		if projectionOverride.FallbackEngines != nil {
			projection.FallbackEngines = normalizeStringSlice(projectionOverride.FallbackEngines)
		}
		if projectionOverride.BundleState != runtimev1.LocalBundleState_LOCAL_BUNDLE_STATE_UNSPECIFIED {
			projection.BundleState = projectionOverride.BundleState
		}
		if projectionOverride.WarmState != runtimev1.LocalWarmState_LOCAL_WARM_STATE_UNSPECIFIED {
			projection.WarmState = projectionOverride.WarmState
		}
		if projectionOverride.HostRequirements != nil {
			projection.HostRequirements = cloneHostRequirements(projectionOverride.HostRequirements)
		}
	}
	record := &runtimev1.LocalModelRecord{
		LocalModelId: ulid.Make().String(),
		ModelId:      modelID,
		Capabilities: capabilities,
		Engine:       engine,
		Entry:        entry,
		License:      license,
		Source: &runtimev1.LocalModelSource{
			Repo:     repo,
			Revision: revision,
		},
		Hashes:               cloneStringMap(hashes),
		Endpoint:             s.storedEndpointForRuntimeMode(engine, mode, endpoint),
		Status:               runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_INSTALLED,
		InstalledAt:          now,
		UpdatedAt:            now,
		LocalInvokeProfileId: strings.TrimSpace(localInvokeProfileID),
		EngineConfig:         cloneStruct(engineConfig),
		LogicalModelId:       projection.LogicalModelID,
		Family:               projection.Family,
		ArtifactRoles:        append([]string(nil), projection.ArtifactRoles...),
		PreferredEngine:      projection.PreferredEngine,
		FallbackEngines:      append([]string(nil), projection.FallbackEngines...),
		BundleState:          projection.BundleState,
		WarmState:            projection.WarmState,
		HostRequirements:     cloneHostRequirements(projection.HostRequirements),
	}
	if len(record.GetCapabilities()) == 0 {
		record.Capabilities = []string{"chat"}
	}

	s.mu.Lock()
	for _, existing := range s.models {
		if existing.GetStatus() == runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_REMOVED {
			continue
		}
		if localModelIdentityKey(existing.GetModelId(), existing.GetEngine()) == modelKey {
			s.mu.Unlock()
			return nil, grpcerr.WithReasonCode(codes.AlreadyExists, runtimev1.ReasonCode_AI_LOCAL_MODEL_ALREADY_INSTALLED)
		}
	}
	s.models[record.GetLocalModelId()] = cloneLocalModel(record)
	s.setModelRuntimeModeLocked(record.GetLocalModelId(), mode)
	s.appendRuntimeAuditLocked(&runtimev1.LocalAuditEvent{
		Id:           "audit_" + ulid.Make().String(),
		EventType:    auditEventType,
		OccurredAt:   now,
		Source:       "local",
		Modality:     firstCapability(record.GetCapabilities()),
		ModelId:      record.GetModelId(),
		LocalModelId: record.GetLocalModelId(),
		Detail:       auditDetail,
	})
	s.mu.Unlock()
	if syncErr := s.SyncManagedLlamaAssets(context.Background()); syncErr != nil {
		s.logger.Warn("sync llama assets after model mutation failed", "model_id", record.GetModelId(), "error", syncErr)
	}
	return record, nil
}

func (s *Service) InstallLocalModel(ctx context.Context, req *runtimev1.InstallLocalModelRequest) (*runtimev1.InstallLocalModelResponse, error) {
	modelID := strings.TrimSpace(req.GetModelId())
	if modelID == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID)
	}
	capabilities := normalizeStringSlice(req.GetCapabilities())
	engine := defaultLocalEngine(strings.TrimSpace(req.GetEngine()), capabilities)
	endpoint := strings.TrimSpace(req.GetEndpoint())
	binding := resolveInstallRuntimeBinding(engine, endpoint, collectDeviceProfile())
	if normalizeRuntimeMode(binding.mode) == runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED {
		files := normalizeStringSlice(req.GetFiles())
		entry := defaultString(strings.TrimSpace(req.GetEntry()), "")
		if entry == "" && len(files) > 0 {
			entry = files[0]
		}
		record, err := s.installManagedDownloadedModel(ctx, managedDownloadedModelSpec{
			modelID:        modelID,
			capabilities:   capabilities,
			engine:         engine,
			entry:          entry,
			files:          files,
			license:        defaultString(strings.TrimSpace(req.GetLicense()), "unknown"),
			repo:           strings.TrimSpace(req.GetRepo()),
			revision:       defaultString(strings.TrimSpace(req.GetRevision()), "main"),
			hashes:         cloneStringMap(req.GetHashes()),
			endpoint:       binding.endpoint,
			mode:           binding.mode,
			engineConfig:   req.GetEngineConfig(),
		})
		if err != nil {
			return nil, err
		}
		return &runtimev1.InstallLocalModelResponse{Model: record}, nil
	}
	if strings.TrimSpace(binding.endpoint) == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_ENDPOINT_REQUIRED)
	}
	record, err := s.installLocalModelRecord(
		modelID,
		capabilities,
		engine,
		defaultString(strings.TrimSpace(req.GetEntry()), "./dist/index.js"),
		defaultString(strings.TrimSpace(req.GetLicense()), "unknown"),
		strings.TrimSpace(req.GetRepo()),
		defaultString(strings.TrimSpace(req.GetRevision()), "main"),
		req.GetHashes(),
		binding.endpoint,
		binding.mode,
		"",
		req.GetEngineConfig(),
		nil,
		"runtime_model_ready_after_install",
		"model installed",
	)
	if err != nil {
		return nil, err
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

	binding := resolveInstallRuntimeBinding(
		matched.GetEngine(),
		defaultString(strings.TrimSpace(req.GetEndpoint()), matched.GetEndpoint()),
		collectDeviceProfile(),
	)
	if normalizeRuntimeMode(binding.mode) == runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_ATTACHED_ENDPOINT && strings.TrimSpace(binding.endpoint) == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_ENDPOINT_REQUIRED)
	}
	if normalizeRuntimeMode(binding.mode) == runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED {
		files := normalizeStringSlice(matched.GetFiles())
		entry := defaultString(strings.TrimSpace(matched.GetEntry()), "")
		if entry == "" && len(files) > 0 {
			entry = files[0]
		}
		record, err := s.installManagedDownloadedModel(ctx, managedDownloadedModelSpec{
			modelID:        matched.GetModelId(),
			logicalModelID: strings.TrimSpace(matched.GetLogicalModelId()),
			capabilities:   append([]string(nil), matched.GetCapabilities()...),
			engine:         matched.GetEngine(),
			entry:          entry,
			files:          files,
			license:        matched.GetLicense(),
			repo:           matched.GetRepo(),
			revision:       defaultString(matched.GetRevision(), "main"),
			hashes:         cloneStringMap(matched.GetHashes()),
			endpoint:       binding.endpoint,
			mode:           binding.mode,
			engineConfig:   matched.GetEngineConfig(),
			projectionOverride: &modelregistry.NativeProjection{
				LogicalModelID:  strings.TrimSpace(matched.GetLogicalModelId()),
				ArtifactRoles:   append([]string(nil), matched.GetArtifactRoles()...),
				PreferredEngine: strings.TrimSpace(matched.GetPreferredEngine()),
				FallbackEngines: normalizePublicFallbackEngines(matched.GetFallbackEngines()),
			},
		})
		if err != nil {
			return nil, err
		}
		return &runtimev1.InstallVerifiedModelResponse{Model: record}, nil
	}
	record, err := s.installLocalModelRecord(
		matched.GetModelId(),
		append([]string(nil), matched.GetCapabilities()...),
		matched.GetEngine(),
		matched.GetEntry(),
		matched.GetLicense(),
		matched.GetRepo(),
		matched.GetRevision(),
		matched.GetHashes(),
		binding.endpoint,
		binding.mode,
		"",
		matched.GetEngineConfig(),
		&modelregistry.NativeProjection{
			LogicalModelID:  strings.TrimSpace(matched.GetLogicalModelId()),
			ArtifactRoles:   append([]string(nil), matched.GetArtifactRoles()...),
			PreferredEngine: strings.TrimSpace(matched.GetPreferredEngine()),
			FallbackEngines: normalizePublicFallbackEngines(matched.GetFallbackEngines()),
		},
		"runtime_model_ready_after_install",
		"model installed",
	)
	if err != nil {
		return nil, err
	}
	return &runtimev1.InstallVerifiedModelResponse{Model: record}, nil
}

func (s *Service) ImportLocalModel(_ context.Context, req *runtimev1.ImportLocalModelRequest) (*runtimev1.ImportLocalModelResponse, error) {
	manifestPath := strings.TrimSpace(req.GetManifestPath())
	if manifestPath == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID)
	}
	if err := validateResolvedModelManifestPath(manifestPath, resolveLocalModelsPath(s.localModelsPath)); err != nil {
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
	engine := defaultLocalEngine(manifestStringDefault(manifest, "engine"), nil)
	entry := defaultString(manifestStringDefault(manifest, "entry"), "./dist/index.js")
	license := defaultString(manifestStringDefault(manifest, "license"), "unknown")
	endpoint := strings.TrimSpace(req.GetEndpoint())
	if endpoint == "" {
		endpoint = manifestStringDefault(manifest, "endpoint")
	}
	binding := resolveInstallRuntimeBinding(engine, endpoint, collectDeviceProfile())
	if normalizeRuntimeMode(binding.mode) == runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_ATTACHED_ENDPOINT && strings.TrimSpace(binding.endpoint) == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_ENDPOINT_REQUIRED)
	}

	capabilities, capsErr := manifestStringSlice(manifest, "capabilities")
	if capsErr != nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_SCHEMA_INVALID)
	}
	if len(capabilities) == 0 {
		capabilities = []string{"chat"}
	}
	artifactRoles, artifactRolesErr := manifestStringSliceKeys(manifest, "artifact_roles", "artifactRoles")
	if artifactRolesErr != nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_SCHEMA_INVALID)
	}
	fallbackEngines, fallbackEnginesErr := manifestStringSliceKeys(manifest, "fallback_engines", "fallbackEngines")
	if fallbackEnginesErr != nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_SCHEMA_INVALID)
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
	if normalizeRuntimeMode(binding.mode) == runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED {
		repo = "file://" + filepath.ToSlash(manifestPath)
	}

	record, err := s.installLocalModelRecord(
		modelID,
		normalizeStringSlice(capabilities),
		engine,
		entry,
		license,
		repo,
		revision,
		hashes,
		binding.endpoint,
		binding.mode,
		manifestStringDefault(manifest, "local_invoke_profile_id", "localInvokeProfileId"),
		engineConfig,
		&modelregistry.NativeProjection{
			LogicalModelID:  manifestStringDefault(manifest, "logical_model_id", "logicalModelId"),
			Family:          manifestStringDefault(manifest, "family"),
			ArtifactRoles:   artifactRoles,
			PreferredEngine: manifestStringDefault(manifest, "preferred_engine", "preferredEngine"),
			FallbackEngines: normalizePublicFallbackEngines(fallbackEngines),
		},
		"runtime_model_imported",
		manifestPath,
	)
	if err != nil {
		return nil, err
	}
	return &runtimev1.ImportLocalModelResponse{Model: record}, nil
}

func normalizePublicFallbackEngines(values []string) []string {
	filtered := make([]string, 0, len(values))
	for _, value := range normalizeStringSlice(values) {
		if strings.EqualFold(strings.TrimSpace(value), "media.diffusers") {
			continue
		}
		filtered = append(filtered, value)
	}
	return filtered
}
