package localservice

import (
	"context"
	"fmt"
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

	catalogItem := cloneCatalogItem(s.resolveCatalogItem(req))
	if catalogItem != nil {
		capabilities := normalizeAssetCapabilities(catalogItem.GetCapabilities())
		engine := defaultLocalEngine(catalogItem.GetEngine(), capabilities)
		kind := inferAssetKindFromCapabilities(capabilities)
		binding := resolveCatalogRuntimeBinding(
			engine,
			capabilities,
			kind,
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
			Capabilities:      append([]string(nil), capabilities...),
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
			Warnings:          startupCompatibilityWarningsForAsset(engine, capabilities, kind, deviceProfile),
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

	capabilities := normalizeAssetCapabilities(req.GetCapabilities())
	engine := defaultLocalEngine(strings.TrimSpace(req.GetEngine()), capabilities)
	binding := resolveInstallRuntimeBinding(
		engine,
		capabilities,
		inferAssetKindFromCapabilities(capabilities),
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
		Warnings:          startupCompatibilityWarningsForAsset(engine, capabilities, inferAssetKindFromCapabilities(capabilities), deviceProfile),
		ReasonCode:        "ACTION_EXECUTED",
		EngineConfig:      cloneStruct(req.GetEngineConfig()),
	}
	if plan.GetModelId() == "" {
		plan.InstallAvailable = false
		plan.ReasonCode = "LOCAL_MODEL_ID_REQUIRED"
		plan.Warnings = append(plan.GetWarnings(), "modelId is required for install plan resolution")
		return &runtimev1.ResolveModelInstallPlanResponse{Plan: plan}, nil
	}
	if plan.GetEngine() == "" {
		plan.InstallAvailable = false
		plan.ReasonCode = "LOCAL_ENGINE_REQUIRED"
		plan.Warnings = append(plan.GetWarnings(), "engine is required; Runtime does not select a backend from capability order")
		return &runtimev1.ResolveModelInstallPlanResponse{Plan: plan}, nil
	}
	s.evaluateInstallPlanAvailability(plan, binding.autoRecommended)
	return &runtimev1.ResolveModelInstallPlanResponse{Plan: plan}, nil
}

func defaultLocalEngine(raw string, _ []string) string {
	return strings.TrimSpace(raw)
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
	if supportWarnings := managedEngineSupportWarningsForAsset(engine, plan.GetCapabilities(), kind, deviceProfile); len(supportWarnings) > 0 {
		plan.Warnings = append(plan.GetWarnings(), supportWarnings...)
	}

	switch mode {
	case runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_ATTACHED_ENDPOINT:
		if detail := canonicalSupervisedImageAttachedEndpointDetail(engine, plan.GetCapabilities(), kind); detail != "" {
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
		if isCanonicalSupervisedImageAsset(engine, plan.GetCapabilities(), kind) {
			if !canonicalSupervisedImageHostSupportedForInstallPlan(plan, deviceProfile) {
				plan.InstallAvailable = false
				plan.ReasonCode = runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE.String()
				if detail := canonicalSupervisedImageSupportDetailForInstallPlan(plan, deviceProfile); strings.TrimSpace(detail) != "" {
					plan.Warnings = append(plan.GetWarnings(), detail)
				}
				return
			}
		} else {
			classification, detail := classifyManagedEngineSupportForAsset(engine, plan.GetCapabilities(), kind, deviceProfile)
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
		if isSupervisedSpeechInstallPlan(engine, mode) {
			plan.InstallAvailable = false
			plan.ReasonCode = runtimev1.ReasonCode_AI_LOCAL_SPEECH_DOWNLOAD_CONFIRMATION_REQUIRED.String()
			return
		}
		plan.InstallAvailable = true
		plan.ReasonCode = "ACTION_EXECUTED"
	default:
		plan.InstallAvailable = false
		plan.ReasonCode = "LOCAL_ENGINE_RUNTIME_MODE_INVALID"
	}
}

func isSupervisedSpeechInstallPlan(engine string, mode runtimev1.LocalEngineRuntimeMode) bool {
	return strings.EqualFold(strings.TrimSpace(engine), "speech") &&
		normalizeRuntimeMode(mode) == runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED
}

type localAssetExistingPolicy int

const (
	localAssetExistingPolicyFail localAssetExistingPolicy = iota
	localAssetExistingPolicyDuplicate
	localAssetExistingPolicyRebind
)

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
	localInvokeProfileID string,
	engineConfig *structpb.Struct,
	projectionOverride *modelregistry.NativeProjection,
	auditEventType string,
	auditDetail string,
	existingPolicy localAssetExistingPolicy,
	exactRebindLocalAssetID ...string,
) (*runtimev1.LocalAssetRecord, error) {
	capabilities = normalizeAssetCapabilities(capabilities)
	if kind == runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_UNSPECIFIED {
		kind = inferAssetKindFromCapabilities(capabilities)
	}
	if isRunnableKind(kind) && len(capabilities) == 0 {
		capabilities = defaultCapabilitiesForAssetKind(kind)
	}
	assetKey := localAssetIdentityKey(modelID, effectiveAssetKind(kind, capabilities), engine)

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
		if projectionOverride.HostRequirements != nil {
			projection.HostRequirements = cloneHostRequirements(projectionOverride.HostRequirements)
		}
	}
	if !isRunnableKind(kind) && (projectionOverride == nil || strings.TrimSpace(projectionOverride.LogicalModelID) == "") {
		projection.LogicalModelID = ""
	}
	record := &runtimev1.LocalAssetRecord{
		LocalAssetId: ulid.Make().String(),
		AssetId:      modelID,
		// Display name is a non-identity fact; install paths default it from the
		// asset id while import paths overwrite it with manifest/file facts.
		DisplayName:  defaultLocalImportDisplayName(modelID, ""),
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
		HostRequirements:     cloneHostRequirements(projection.HostRequirements),
	}
	if isRunnableKind(kind) && len(record.GetCapabilities()) == 0 {
		record.Capabilities = defaultCapabilitiesForAssetKind(kind)
	}
	if isRunnableKind(kind) && len(record.GetCapabilities()) == 0 {
		record.Capabilities = []string{"chat"}
	}

	exactRebindID := ""
	if len(exactRebindLocalAssetID) > 0 {
		exactRebindID = strings.TrimSpace(exactRebindLocalAssetID[0])
	}
	s.mu.Lock()
	for _, existing := range s.assets {
		if existing.GetStatus() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_REMOVED {
			continue
		}
		if localAssetIdentityKey(existing.GetAssetId(), effectiveAssetKind(existing.GetKind(), existing.GetCapabilities()), existing.GetEngine()) == assetKey {
			switch existingPolicy {
			case localAssetExistingPolicyDuplicate:
				continue
			case localAssetExistingPolicyRebind:
				if exactRebindID != "" && existing.GetLocalAssetId() != exactRebindID {
					continue
				}
				cloned := cloneLocalAsset(existing)
				cloned.AssetId = record.GetAssetId()
				cloned.Kind = record.GetKind()
				cloned.Capabilities = append([]string(nil), record.GetCapabilities()...)
				cloned.Engine = record.GetEngine()
				cloned.Entry = record.GetEntry()
				cloned.Files = append([]string(nil), record.GetFiles()...)
				cloned.BundleEntries = cloneLocalBundleEntryDigests(record.GetBundleEntries())
				cloned.License = record.GetLicense()
				if record.GetSource() != nil {
					cloned.Source = &runtimev1.LocalAssetSource{
						Repo:     record.GetSource().GetRepo(),
						Revision: record.GetSource().GetRevision(),
					}
				} else {
					cloned.Source = nil
				}
				cloned.Hashes = cloneStringMap(record.GetHashes())
				cloned.Status = runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED
				cloned.UpdatedAt = now
				cloned.HealthDetail = ""
				cloned.LocalInvokeProfileId = record.GetLocalInvokeProfileId()
				cloned.EngineConfig = cloneStruct(record.GetEngineConfig())
				cloned.LogicalModelId = record.GetLogicalModelId()
				cloned.Family = record.GetFamily()
				cloned.ArtifactRoles = append([]string(nil), record.GetArtifactRoles()...)
				cloned.PreferredEngine = record.GetPreferredEngine()
				cloned.FallbackEngines = append([]string(nil), record.GetFallbackEngines()...)
				cloned.BundleState = record.GetBundleState()
				cloned.HostRequirements = cloneHostRequirements(record.GetHostRequirements())
				s.assets[cloned.GetLocalAssetId()] = cloneLocalAsset(cloned)
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
				return cloned, nil
			default:
				s.mu.Unlock()
				return nil, grpcerr.WithReasonCode(codes.AlreadyExists, runtimev1.ReasonCode_AI_LOCAL_ASSET_ALREADY_INSTALLED)
			}
		}
	}
	if existingPolicy == localAssetExistingPolicyRebind && exactRebindID != "" {
		s.mu.Unlock()
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_INVALID_TRANSITION)
	}
	s.assets[record.GetLocalAssetId()] = cloneLocalAsset(record)
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
	capabilities := normalizeAssetCapabilities(params.capabilities)
	engine := defaultLocalEngine(strings.TrimSpace(params.engine), capabilities)
	endpoint := strings.TrimSpace(params.endpoint)
	binding := resolveInstallRuntimeBinding(
		engine,
		capabilities,
		inferAssetKindFromCapabilities(capabilities),
		endpoint,
		collectDeviceProfile(),
	)
	deviceProfile := collectDeviceProfile()
	if detail := canonicalSupervisedImageAttachedEndpointDetail(engine, capabilities, inferAssetKindFromCapabilities(capabilities)); detail != "" &&
		normalizeRuntimeMode(binding.mode) == runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_ATTACHED_ENDPOINT {
		return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
			Message:    detail,
			ActionHint: "use_supported_supervised_image_host",
		})
	}
	if isCanonicalSupervisedImageAsset(engine, capabilities, inferAssetKindFromCapabilities(capabilities)) {
		rawPlan := &runtimev1.LocalInstallPlanDescriptor{
			Engine:       engine,
			Capabilities: append([]string(nil), capabilities...),
			Entry:        params.entry,
			Files:        append([]string(nil), params.files...),
			Hashes:       cloneStringMap(params.hashes),
			EngineConfig: cloneStruct(params.engineConfig),
		}
		if !canonicalSupervisedImageHostSupportedForInstallPlan(rawPlan, deviceProfile) {
			return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
				Message:    canonicalSupervisedImageSupportDetailForInstallPlan(rawPlan, deviceProfile),
				ActionHint: "use_supported_supervised_image_host",
			})
		}
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
			engineConfig: params.engineConfig,
		})
		if err != nil {
			return nil, err
		}
		return record, nil
	}
	if strings.TrimSpace(binding.endpoint) == "" {
		if detail := attachedEndpointRequiredDetailForAsset(engine, capabilities, inferAssetKindFromCapabilities(capabilities), collectDeviceProfile()); detail != "" {
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
		"",
		params.engineConfig,
		nil,
		"runtime_model_ready_after_install",
		"model installed",
		localAssetExistingPolicyFail,
	)
	if err != nil {
		return nil, err
	}
	return record, nil
}

func (s *Service) InstallModelFromPlan(ctx context.Context, req *runtimev1.InstallModelFromPlanRequest) (*runtimev1.InstallModelFromPlanResponse, error) {
	plan := req.GetPlan()
	if plan == nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID, grpcerr.ReasonOptions{
			Message: "install plan is required",
		})
	}
	if !plan.GetInstallAvailable() {
		message := strings.TrimSpace(plan.GetReasonCode())
		if message == "" {
			message = "install plan is not available"
		}
		return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
			Message: message,
		})
	}
	record, err := s.installLocalAsset(ctx, installLocalAssetParams{
		assetID:      plan.GetModelId(),
		capabilities: append([]string(nil), plan.GetCapabilities()...),
		engine:       plan.GetEngine(),
		entry:        plan.GetEntry(),
		files:        append([]string(nil), plan.GetFiles()...),
		license:      plan.GetLicense(),
		repo:         plan.GetRepo(),
		revision:     plan.GetRevision(),
		hashes:       cloneStringMap(plan.GetHashes()),
		endpoint:     plan.GetEndpoint(),
		engineConfig: cloneStruct(plan.GetEngineConfig()),
	})
	if err != nil {
		return nil, err
	}
	return &runtimev1.InstallModelFromPlanResponse{Asset: record}, nil
}

func (s *Service) InstallVerifiedAsset(ctx context.Context, req *runtimev1.InstallVerifiedAssetRequest) (*runtimev1.InstallVerifiedAssetResponse, error) {
	record, err := s.installVerifiedAssetByTemplateID(ctx, req.GetTemplateId(), req.GetEndpoint())
	if err != nil {
		return nil, err
	}
	return &runtimev1.InstallVerifiedAssetResponse{Asset: record}, nil
}

// installVerifiedAssetByTemplateID installs a verified catalog asset by its
// template id (the K-MCAT-032 variant id, identical to the asset id). It is the
// shared install path behind the InstallVerifiedAsset RPC and the first-run
// model.asset materializer job: both resolve a concrete asset id, then this
// helper downloads + installs it from the verified catalog descriptor.
// endpointRaw is the optional caller-supplied local provider endpoint (empty
// for the materializer path; supervised assets do not require one).
//
// The supervised bundle stages and activates under the single config-sourced
// runtime models root (`resolveLocalModelsPath(s.localModelsPath)` →
// `<dataRootRef>/models`). The desktop-bridge runtime is given that data root
// by the desktop config sync before materialization starts; an unresolved root
// fails closed in resolveManagedBundleModelsRoot rather than staging into the
// runtime process CWD.
func (s *Service) installVerifiedAssetByTemplateID(ctx context.Context, templateIDRaw string, endpointRaw string) (*runtimev1.LocalAssetRecord, error) {
	return s.installVerifiedAssetByTemplateIDWithExistingPolicy(
		ctx,
		templateIDRaw,
		endpointRaw,
		localAssetExistingPolicyFail,
	)
}

// installVerifiedAssetByTemplateIDWithExistingPolicy keeps the public verified
// install path fail-on-duplicate while allowing the first-run materializer to
// replace an existing registry row after the configured data root changes.
// The bundle activation remains transactional; the registry is rebound only
// after the new bundle has downloaded, verified, and activated successfully.
func (s *Service) installVerifiedAssetByTemplateIDWithExistingPolicy(
	ctx context.Context,
	templateIDRaw string,
	endpointRaw string,
	existingPolicy localAssetExistingPolicy,
) (*runtimev1.LocalAssetRecord, error) {
	templateID := strings.TrimSpace(templateIDRaw)
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
		defaultString(strings.TrimSpace(endpointRaw), matched.GetEndpoint()),
		collectDeviceProfile(),
	)
	deviceProfile := collectDeviceProfile()
	if detail := canonicalSupervisedImageAttachedEndpointDetail(matched.GetEngine(), matched.GetCapabilities(), matched.GetKind()); detail != "" &&
		normalizeRuntimeMode(binding.mode) == runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_ATTACHED_ENDPOINT {
		return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
			Message:    detail,
			ActionHint: "use_supported_supervised_image_host",
		})
	}
	if isCanonicalSupervisedImageAsset(matched.GetEngine(), matched.GetCapabilities(), matched.GetKind()) &&
		!canonicalSupervisedImageHostSupportedForVerifiedAsset(matched, deviceProfile) {
		return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
			Message:    canonicalSupervisedImageSupportDetailForVerifiedAsset(matched, deviceProfile),
			ActionHint: "use_supported_supervised_image_host",
		})
	}
	if isRunnableKind(matched.GetKind()) && normalizeRuntimeMode(binding.mode) == runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_ATTACHED_ENDPOINT && strings.TrimSpace(binding.endpoint) == "" {
		if detail := attachedEndpointRequiredDetailForAsset(matched.GetEngine(), matched.GetCapabilities(), matched.GetKind(), collectDeviceProfile()); detail != "" {
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
			engineConfig:   matched.GetEngineConfig(),
			existingPolicy: existingPolicy,
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
		return record, nil
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
		existingPolicy,
	)
	if err != nil {
		return nil, err
	}
	return record, nil
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
