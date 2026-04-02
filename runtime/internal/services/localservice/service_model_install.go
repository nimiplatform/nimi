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
		kind := inferAssetKindFromCapabilities(catalogItem.GetCapabilities())
		binding := resolveCatalogRuntimeBinding(
			engine,
			catalogItem.GetCapabilities(),
			kind,
			catalogItem.GetEngineConfig(),
			"",
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
			Warnings:          startupCompatibilityWarningsForAsset(engine, catalogItem.GetCapabilities(), kind, catalogItem.GetEngineConfig(), "", deviceProfile),
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
	binding := resolveInstallRuntimeBinding(
		engine,
		capabilities,
		inferAssetKindFromCapabilities(capabilities),
		req.GetEngineConfig(),
		"",
		strings.TrimSpace(req.GetEndpoint()),
		deviceProfile,
	)
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
		Warnings:          startupCompatibilityWarningsForAsset(engine, capabilities, inferAssetKindFromCapabilities(capabilities), req.GetEngineConfig(), "", deviceProfile),
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
	kind := inferAssetKindFromCapabilities(plan.GetCapabilities())
	mode := normalizeRuntimeMode(plan.GetEngineRuntimeMode())
	plan.EngineRuntimeMode = mode
	deviceProfile := collectDeviceProfile()
	if supportWarnings := managedEngineSupportWarningsForAsset(engine, plan.GetCapabilities(), kind, plan.GetEngineConfig(), "", deviceProfile); len(supportWarnings) > 0 {
		plan.Warnings = append(plan.GetWarnings(), supportWarnings...)
	}

	switch mode {
	case runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_ATTACHED_ENDPOINT:
		if detail := canonicalSupervisedImageAttachedEndpointDetail(engine, plan.GetCapabilities(), kind, plan.GetEngineConfig(), ""); detail != "" {
			plan.InstallAvailable = false
			plan.ReasonCode = runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE.String()
			plan.Warnings = append(plan.GetWarnings(), detail)
			return
		}
		endpoint := strings.TrimSpace(plan.GetEndpoint())
		if endpoint == "" {
			plan.InstallAvailable = false
			plan.ReasonCode = runtimev1.ReasonCode_AI_LOCAL_ENDPOINT_REQUIRED.String()
			return
		}
		if detail := attachedLoopbackConfigErrorDetail(engine, mode, endpoint, deviceProfile); detail != "" {
			plan.InstallAvailable = false
			plan.ReasonCode = runtimev1.ReasonCode_AI_LOCAL_ENDPOINT_REQUIRED.String()
			plan.Warnings = append(plan.GetWarnings(), detail)
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
		classification, detail := classifyManagedEngineSupportForAsset(engine, plan.GetCapabilities(), kind, plan.GetEngineConfig(), "", deviceProfile)
		if classification != localEngineSupportSupportedSupervised {
			if isCanonicalSupervisedImageAsset(engine, plan.GetCapabilities(), kind, plan.GetEngineConfig(), "") {
				plan.InstallAvailable = false
				plan.ReasonCode = runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE.String()
				if strings.TrimSpace(detail) != "" {
					plan.Warnings = append(plan.GetWarnings(), detail)
				}
				return
			}
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

func (s *Service) installLocalAssetRecord(
	modelID string,
	kind runtimev1.LocalAssetKind,
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
	allowExistingRebind bool,
) (*runtimev1.LocalAssetRecord, error) {
	if kind == runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_UNSPECIFIED {
		kind = inferAssetKindFromCapabilities(capabilities)
	}
	if isRunnableKind(kind) && len(capabilities) == 0 {
		capabilities = defaultCapabilitiesForAssetKind(kind)
	}
	assetKey := localAssetIdentityKey(modelID, kind, engine)

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
	record := &runtimev1.LocalAssetRecord{
		LocalAssetId: ulid.Make().String(),
		AssetId:      modelID,
		Kind:         kind,
		Capabilities: capabilities,
		Engine:       engine,
		Entry:        entry,
		License:      license,
		Source: &runtimev1.LocalAssetSource{
			Repo:     repo,
			Revision: revision,
		},
		Hashes:               cloneStringMap(hashes),
		Status:               runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
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
		Endpoint: storedEndpointForAssetRuntimeMode(
			engine,
			capabilities,
			kind,
			engineConfig,
			projection.PreferredEngine,
			mode,
			endpoint,
			s.managedEndpointForAssetLocked(engine, capabilities, kind, engineConfig, projection.PreferredEngine),
		),
	}
	if isRunnableKind(kind) && len(record.GetCapabilities()) == 0 {
		record.Capabilities = defaultCapabilitiesForAssetKind(kind)
	}
	if isRunnableKind(kind) && len(record.GetCapabilities()) == 0 {
		record.Capabilities = []string{"chat"}
	}

	s.mu.Lock()
	for _, existing := range s.assets {
		if existing.GetStatus() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_REMOVED {
			continue
		}
		if localAssetIdentityKey(existing.GetAssetId(), existing.GetKind(), existing.GetEngine()) == assetKey {
			if !allowExistingRebind {
				s.mu.Unlock()
				return nil, grpcerr.WithReasonCode(codes.AlreadyExists, runtimev1.ReasonCode_AI_LOCAL_ASSET_ALREADY_INSTALLED)
			}
			cloned := cloneLocalAsset(existing)
			cloned.AssetId = modelID
			cloned.Kind = kind
			cloned.Capabilities = append([]string(nil), capabilities...)
			cloned.Engine = engine
			cloned.Entry = entry
			cloned.License = license
			cloned.Source = &runtimev1.LocalAssetSource{
				Repo:     repo,
				Revision: revision,
			}
			cloned.Hashes = cloneStringMap(hashes)
			cloned.Status = runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED
			cloned.UpdatedAt = now
			cloned.HealthDetail = ""
			cloned.LocalInvokeProfileId = strings.TrimSpace(localInvokeProfileID)
			cloned.EngineConfig = cloneStruct(engineConfig)
			cloned.LogicalModelId = projection.LogicalModelID
			cloned.Family = projection.Family
			cloned.ArtifactRoles = append([]string(nil), projection.ArtifactRoles...)
			cloned.PreferredEngine = projection.PreferredEngine
			cloned.FallbackEngines = append([]string(nil), projection.FallbackEngines...)
			cloned.BundleState = projection.BundleState
			cloned.WarmState = projection.WarmState
			cloned.HostRequirements = cloneHostRequirements(projection.HostRequirements)
			cloned.Endpoint = storedEndpointForAssetRuntimeMode(
				engine,
				capabilities,
				kind,
				engineConfig,
				projection.PreferredEngine,
				mode,
				endpoint,
				s.managedEndpointForAssetLocked(engine, capabilities, kind, engineConfig, projection.PreferredEngine),
			)
			s.assets[cloned.GetLocalAssetId()] = cloneLocalAsset(cloned)
			s.setModelRuntimeModeLocked(cloned.GetLocalAssetId(), mode)
			delete(s.assetProbeState, cloned.GetLocalAssetId())
			s.appendRuntimeAuditLocked(&runtimev1.LocalAuditEvent{
				Id:           "audit_" + ulid.Make().String(),
				EventType:    auditEventType,
				OccurredAt:   now,
				Source:       "local",
				Modality:     firstCapability(cloned.GetCapabilities()),
				ModelId:      cloned.GetAssetId(),
				LocalModelId: cloned.GetLocalAssetId(),
				Detail:       auditDetail,
			})
			s.mu.Unlock()
			if syncErr := s.SyncManagedLlamaAssets(context.Background()); syncErr != nil {
				s.logger.Warn("sync llama assets after model mutation failed", "model_id", cloned.GetAssetId(), "error", syncErr)
			}
			return cloned, nil
		}
	}
	s.assets[record.GetLocalAssetId()] = cloneLocalAsset(record)
	s.setModelRuntimeModeLocked(record.GetLocalAssetId(), mode)
	s.appendRuntimeAuditLocked(&runtimev1.LocalAuditEvent{
		Id:           "audit_" + ulid.Make().String(),
		EventType:    auditEventType,
		OccurredAt:   now,
		Source:       "local",
		Modality:     firstCapability(record.GetCapabilities()),
		ModelId:      record.GetAssetId(),
		LocalModelId: record.GetLocalAssetId(),
		Detail:       auditDetail,
	})
	s.mu.Unlock()
	if syncErr := s.SyncManagedLlamaAssets(context.Background()); syncErr != nil {
		s.logger.Warn("sync llama assets after model mutation failed", "model_id", record.GetAssetId(), "error", syncErr)
	}
	return record, nil
}

// installLocalAssetParams holds the parameters for a direct asset install.
type installLocalAssetParams struct {
	assetID      string
	capabilities []string
	engine       string
	entry        string
	files        []string
	license      string
	repo         string
	revision     string
	hashes       map[string]string
	endpoint     string
	engineConfig *structpb.Struct
}

// installLocalAsset creates or downloads a local asset record from raw parameters.
// This is an internal helper used by other install paths (verified, import, etc.).
func (s *Service) installLocalAsset(ctx context.Context, params installLocalAssetParams) (*runtimev1.LocalAssetRecord, error) {
	modelID := strings.TrimSpace(params.assetID)
	if modelID == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID)
	}
	capabilities := normalizeStringSlice(params.capabilities)
	engine := defaultLocalEngine(strings.TrimSpace(params.engine), capabilities)
	endpoint := strings.TrimSpace(params.endpoint)
	binding := resolveInstallRuntimeBinding(
		engine,
		capabilities,
		inferAssetKindFromCapabilities(capabilities),
		params.engineConfig,
		"",
		endpoint,
		collectDeviceProfile(),
	)
	deviceProfile := collectDeviceProfile()
	if detail := canonicalSupervisedImageAttachedEndpointDetail(engine, capabilities, inferAssetKindFromCapabilities(capabilities), params.engineConfig, ""); detail != "" &&
		normalizeRuntimeMode(binding.mode) == runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_ATTACHED_ENDPOINT {
		return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
			Message:    detail,
			ActionHint: "use_supported_supervised_image_host",
		})
	}
	if !canonicalSupervisedImageHostSupportedForAsset(engine, capabilities, inferAssetKindFromCapabilities(capabilities), params.engineConfig, "", deviceProfile) {
		return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
			Message:    canonicalSupervisedImageSupportDetailForAsset(engine, capabilities, inferAssetKindFromCapabilities(capabilities), params.engineConfig, "", deviceProfile),
			ActionHint: "use_supported_supervised_image_host",
		})
	}
	if normalizeRuntimeMode(binding.mode) == runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED {
		files := normalizeStringSlice(params.files)
		entry := defaultString(strings.TrimSpace(params.entry), "")
		if entry == "" && len(files) > 0 {
			entry = files[0]
		}
		record, err := s.installManagedDownloadedModel(ctx, managedDownloadedModelSpec{
			modelID:      modelID,
			kind:         inferAssetKindFromCapabilities(capabilities),
			capabilities: capabilities,
			engine:       engine,
			entry:        entry,
			files:        files,
			license:      defaultString(strings.TrimSpace(params.license), "unknown"),
			repo:         strings.TrimSpace(params.repo),
			revision:     defaultString(strings.TrimSpace(params.revision), "main"),
			hashes:       cloneStringMap(params.hashes),
			endpoint:     binding.endpoint,
			mode:         binding.mode,
			engineConfig: params.engineConfig,
		})
		if err != nil {
			return nil, err
		}
		return record, nil
	}
	if strings.TrimSpace(binding.endpoint) == "" {
		if detail := attachedEndpointRequiredDetailForAsset(engine, capabilities, inferAssetKindFromCapabilities(capabilities), params.engineConfig, "", collectDeviceProfile()); detail != "" {
			return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_ENDPOINT_REQUIRED, grpcerr.ReasonOptions{
				Message:    detail,
				ActionHint: "set_local_provider_endpoint",
			})
		}
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_ENDPOINT_REQUIRED)
	}
	if detail := attachedLoopbackConfigErrorDetail(engine, binding.mode, binding.endpoint, collectDeviceProfile()); detail != "" {
		return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_ENDPOINT_REQUIRED, grpcerr.ReasonOptions{
			Message:    detail,
			ActionHint: "set_local_provider_endpoint",
		})
	}
	record, err := s.installLocalAssetRecord(
		modelID,
		inferAssetKindFromCapabilities(capabilities),
		capabilities,
		engine,
		defaultString(strings.TrimSpace(params.entry), "./dist/index.js"),
		defaultString(strings.TrimSpace(params.license), "unknown"),
		strings.TrimSpace(params.repo),
		defaultString(strings.TrimSpace(params.revision), "main"),
		params.hashes,
		binding.endpoint,
		binding.mode,
		"",
		params.engineConfig,
		nil,
		"runtime_model_ready_after_install",
		"model installed",
		false,
	)
	if err != nil {
		return nil, err
	}
	return record, nil
}

func (s *Service) InstallVerifiedAsset(ctx context.Context, req *runtimev1.InstallVerifiedAssetRequest) (*runtimev1.InstallVerifiedAssetResponse, error) {
	templateID := strings.TrimSpace(req.GetTemplateId())
	if templateID == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_TEMPLATE_NOT_FOUND)
	}

	s.mu.RLock()
	var matched *runtimev1.LocalVerifiedAssetDescriptor
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
		matched.GetCapabilities(),
		matched.GetKind(),
		matched.GetEngineConfig(),
		matched.GetPreferredEngine(),
		defaultString(strings.TrimSpace(req.GetEndpoint()), matched.GetEndpoint()),
		collectDeviceProfile(),
	)
	deviceProfile := collectDeviceProfile()
	if detail := canonicalSupervisedImageAttachedEndpointDetail(matched.GetEngine(), matched.GetCapabilities(), matched.GetKind(), matched.GetEngineConfig(), matched.GetPreferredEngine()); detail != "" &&
		normalizeRuntimeMode(binding.mode) == runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_ATTACHED_ENDPOINT {
		return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
			Message:    detail,
			ActionHint: "use_supported_supervised_image_host",
		})
	}
	if !canonicalSupervisedImageHostSupportedForAsset(matched.GetEngine(), matched.GetCapabilities(), matched.GetKind(), matched.GetEngineConfig(), matched.GetPreferredEngine(), deviceProfile) {
		return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
			Message:    canonicalSupervisedImageSupportDetailForAsset(matched.GetEngine(), matched.GetCapabilities(), matched.GetKind(), matched.GetEngineConfig(), matched.GetPreferredEngine(), deviceProfile),
			ActionHint: "use_supported_supervised_image_host",
		})
	}
	if isRunnableKind(matched.GetKind()) && normalizeRuntimeMode(binding.mode) == runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_ATTACHED_ENDPOINT && strings.TrimSpace(binding.endpoint) == "" {
		if detail := attachedEndpointRequiredDetailForAsset(matched.GetEngine(), matched.GetCapabilities(), matched.GetKind(), matched.GetEngineConfig(), matched.GetPreferredEngine(), collectDeviceProfile()); detail != "" {
			return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_ENDPOINT_REQUIRED, grpcerr.ReasonOptions{
				Message:    detail,
				ActionHint: "set_local_provider_endpoint",
			})
		}
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_ENDPOINT_REQUIRED)
	}
	if detail := attachedLoopbackConfigErrorDetail(matched.GetEngine(), binding.mode, binding.endpoint, collectDeviceProfile()); detail != "" {
		return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_ENDPOINT_REQUIRED, grpcerr.ReasonOptions{
			Message:    detail,
			ActionHint: "set_local_provider_endpoint",
		})
	}
	if normalizeRuntimeMode(binding.mode) == runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED {
		files := normalizeStringSlice(matched.GetFiles())
		entry := defaultString(strings.TrimSpace(matched.GetEntry()), "")
		if entry == "" && len(files) > 0 {
			entry = files[0]
		}
		record, err := s.installManagedDownloadedModel(ctx, managedDownloadedModelSpec{
			modelID:        matched.GetAssetId(),
			logicalModelID: strings.TrimSpace(matched.GetLogicalModelId()),
			kind:           matched.GetKind(),
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
		return &runtimev1.InstallVerifiedAssetResponse{Asset: record}, nil
	}
	record, err := s.installLocalAssetRecord(
		matched.GetAssetId(),
		matched.GetKind(),
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
		false,
	)
	if err != nil {
		return nil, err
	}
	return &runtimev1.InstallVerifiedAssetResponse{Asset: record}, nil
}

func (s *Service) ImportLocalAsset(_ context.Context, req *runtimev1.ImportLocalAssetRequest) (*runtimev1.ImportLocalAssetResponse, error) {
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

	if manifestHasAnyKey(manifest, "model_id", "modelId", "artifact_id", "artifactId") {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_SCHEMA_INVALID)
	}
	assetID, ok := manifestString(manifest, "asset_id", "assetId")
	if !ok || strings.TrimSpace(assetID) == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID)
	}
	kind, ok := manifestAssetKind(manifest, "kind", "asset_kind", "assetKind")
	if !ok || kind == runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_UNSPECIFIED {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_SCHEMA_INVALID)
	}
	engineConfig, engineConfigErr := manifestStruct(manifest, "engine_config", "engineConfig")
	if engineConfigErr != nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_SCHEMA_INVALID)
	}
	if req.GetEngineConfig() != nil {
		engineConfig = cloneStruct(req.GetEngineConfig())
	}
	capabilities, capsErr := manifestStringSlice(manifest, "capabilities")
	if capsErr != nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_SCHEMA_INVALID)
	}
	if isRunnableKind(kind) && len(capabilities) == 0 {
		capabilities = defaultCapabilitiesForAssetKind(kind)
	}
	if isRunnableKind(kind) && len(capabilities) == 0 {
		capabilities = []string{"chat"}
	}
	if !isRunnableKind(kind) && len(capabilities) > 0 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_SCHEMA_INVALID)
	}
	preferredEngine := manifestStringDefault(manifest, "preferred_engine", "preferredEngine")
	engine := defaultLocalEngine(manifestStringDefault(manifest, "engine"), capabilities)
	entry := defaultString(manifestStringDefault(manifest, "entry"), "./dist/index.js")
	license := defaultString(manifestStringDefault(manifest, "license"), "unknown")
	endpoint := strings.TrimSpace(req.GetEndpoint())
	if endpoint == "" {
		endpoint = manifestStringDefault(manifest, "endpoint")
	}
	binding := resolveInstallRuntimeBinding(
		engine,
		capabilities,
		kind,
		engineConfig,
		preferredEngine,
		endpoint,
		collectDeviceProfile(),
	)
	deviceProfile := collectDeviceProfile()
	if detail := canonicalSupervisedImageAttachedEndpointDetail(engine, capabilities, kind, engineConfig, preferredEngine); detail != "" &&
		normalizeRuntimeMode(binding.mode) == runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_ATTACHED_ENDPOINT {
		return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
			Message:    detail,
			ActionHint: "use_supported_supervised_image_host",
		})
	}
	if !canonicalSupervisedImageHostSupportedForAsset(engine, capabilities, kind, engineConfig, preferredEngine, deviceProfile) {
		return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
			Message:    canonicalSupervisedImageSupportDetailForAsset(engine, capabilities, kind, engineConfig, preferredEngine, deviceProfile),
			ActionHint: "use_supported_supervised_image_host",
		})
	}
	if isRunnableKind(kind) && normalizeRuntimeMode(binding.mode) == runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_ATTACHED_ENDPOINT && strings.TrimSpace(binding.endpoint) == "" {
		if detail := attachedEndpointRequiredDetailForAsset(engine, capabilities, kind, engineConfig, preferredEngine, collectDeviceProfile()); detail != "" {
			return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_ENDPOINT_REQUIRED, grpcerr.ReasonOptions{
				Message:    detail,
				ActionHint: "set_local_provider_endpoint",
			})
		}
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_ENDPOINT_REQUIRED)
	}
	if detail := attachedLoopbackConfigErrorDetail(engine, binding.mode, binding.endpoint, collectDeviceProfile()); detail != "" {
		return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_ENDPOINT_REQUIRED, grpcerr.ReasonOptions{
			Message:    detail,
			ActionHint: "set_local_provider_endpoint",
		})
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

	record, err := s.installLocalAssetRecord(
		assetID,
		kind,
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
			PreferredEngine: preferredEngine,
			FallbackEngines: normalizePublicFallbackEngines(fallbackEngines),
		},
		"runtime_model_imported",
		manifestPath,
		true,
	)
	if err != nil {
		return nil, err
	}
	return &runtimev1.ImportLocalAssetResponse{Asset: record}, nil
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
