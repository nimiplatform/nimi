package localservice

import (
	"context"
	"errors"
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/filedownload"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func (s *Service) verifiedAssetDescriptorForAssetID(assetID string) *runtimev1.LocalVerifiedAssetDescriptor {
	trimmed := strings.TrimSpace(assetID)
	if trimmed == "" {
		return nil
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return cloneVerifiedAsset(verifiedAssetDescriptorForAssetID(s.verified, trimmed))
}

func verifiedAssetDescriptorForAssetID(
	verified []*runtimev1.LocalVerifiedAssetDescriptor,
	assetID string,
) *runtimev1.LocalVerifiedAssetDescriptor {
	trimmed := strings.TrimSpace(assetID)
	for _, item := range verified {
		if item == nil {
			continue
		}
		if strings.TrimSpace(item.GetAssetId()) == trimmed || strings.TrimSpace(item.GetTemplateId()) == trimmed {
			return item
		}
	}
	return nil
}

func (s *Service) resolveCatalogItem(req *runtimev1.ResolveModelInstallPlanRequest) *runtimev1.LocalCatalogModelDescriptor {
	itemID := strings.TrimSpace(req.GetItemId())
	templateID := strings.TrimSpace(req.GetTemplateId())
	modelID := strings.TrimSpace(req.GetModelId())
	repo := strings.TrimSpace(req.GetRepo())
	source := strings.TrimSpace(req.GetSource())
	for _, item := range s.catalogSnapshot() {
		if itemID != "" && item.GetItemId() == itemID {
			return item
		}
		if templateID != "" && item.GetTemplateId() == templateID {
			return item
		}
		if modelID != "" && item.GetModelId() == modelID &&
			(repo == "" || item.GetRepo() == repo) &&
			(source == "" || strings.EqualFold(source, item.GetSource())) {
			return item
		}
	}
	return nil
}

// @nimi-authority: rule.nimi.runtime.local-compute.r006
// @nimi-authority: rule.nimi.runtime.local-compute.r016
// @nimi-authority: rule.nimi.runtime.ai-provider.r035
func (s *Service) ResolveModelInstallPlan(ctx context.Context, req *runtimev1.ResolveModelInstallPlanRequest) (*runtimev1.ResolveModelInstallPlanResponse, error) {
	if req == nil {
		req = &runtimev1.ResolveModelInstallPlanRequest{}
	}
	offerRef := strings.TrimSpace(req.GetOfferRef())
	if offerRef != "" && hasExistingModelInstallPlanInput(req) {
		return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID, grpcerr.ReasonOptions{Message: "offer_ref cannot be combined with catalog acquisition input"})
	}

	var catalogItem *runtimev1.LocalCatalogModelDescriptor
	checkpointLayout := ""
	if offerRef != "" {
		offer, err := s.resolveCatalogOffer(ctx, offerRef)
		if err != nil {
			return nil, err
		}
		checkpointLayout = strings.TrimSpace(offer.checkpointLayout)
		catalogItem = catalogItemFromOffer(offer)
	} else {
		hfSource := strings.EqualFold(strings.TrimSpace(req.GetSource()), "huggingface") && strings.TrimSpace(req.GetRepo()) != ""
		// An explicit portable file captures a particular revision and payload
		// even when its model ID also occurs in the device catalog.
		explicitFile := hfSource && req.GetItemId() == "" && req.GetTemplateId() == "" && req.GetEntry() != ""
		if !explicitFile {
			catalogItem = cloneCatalogItem(s.resolveCatalogItem(req))
		}
		if catalogItem == nil && hfSource {
			resolved, err := s.resolveHFCatalogAcquisition(ctx, req)
			if err != nil {
				return nil, err
			}
			catalogItem = resolved
		}
	}
	if catalogItem == nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_TEMPLATE_NOT_FOUND, grpcerr.ReasonOptions{
			Message: "catalog ModelAsset acquisition was not found", ActionHint: "search_catalog_or_import_model_asset",
		})
	}

	capabilities := normalizeAssetCapabilities(catalogItem.GetCapabilities())
	plan := &runtimev1.LocalInstallPlanDescriptor{
		PlanId: "plan_" + ulid.Make().String(), ItemId: catalogItem.GetItemId(),
		Source: defaultString(catalogItem.GetSource(), "verified"), TemplateId: catalogItem.GetTemplateId(),
		ModelId: catalogItem.GetModelId(), Repo: catalogItem.GetRepo(), Revision: defaultString(catalogItem.GetRevision(), "main"),
		Capabilities: append([]string(nil), capabilities...), Engine: "",
		EngineRuntimeMode: runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_UNSPECIFIED,
		InstallKind:       defaultString(catalogItem.GetInstallKind(), "download"), InstallAvailable: true,
		Endpoint: "", ProviderHints: cloneProviderHints(catalogItem.GetProviderHints()),
		Entry: strings.TrimSpace(catalogItem.GetEntry()), Files: append([]string(nil), catalogItem.GetFiles()...),
		License: defaultString(catalogItem.GetLicense(), "unknown"), Hashes: cloneStringMap(catalogItem.GetHashes()),
		Warnings:   modelAssetInstallPlanWarnings(catalogItem.GetHostRequirements(), collectDeviceProfile(context.Background())),
		ReasonCode: "ACTION_EXECUTED", EngineConfig: nil, TotalSizeBytes: catalogItem.GetTotalSizeBytes(),
		SourceProvenance: catalogItem.GetSourceProvenance(), ModelType: catalogItem.GetModelType(), OfferRef: offerRef,
	}
	evaluateCatalogModelAcquisitionPlan(plan)
	if plan.GetInstallAvailable() {
		switch checkpointLayout {
		case string(capabilitydriver.DiffusionCheckpointLayoutSD1):
			plan.Warnings = append(plan.Warnings, "WARN_NO_HOST_RECIPE_SD1")
		case string(capabilitydriver.DiffusionCheckpointLayoutSDXL):
			// Verified standalone SDXL checkpoint matches the native sdxl recipe.
		default:
			if strings.EqualFold(strings.TrimSpace(catalogItem.GetSource()), "huggingface") && !catalogItem.GetVerified() {
				plan.Warnings = append(plan.Warnings, "WARN_COMMUNITY_RECIPE_COMPATIBILITY_UNVERIFIED")
			}
		}
	}
	now := nowISO()
	auditPayload := map[string]any{
		"install_available": plan.GetInstallAvailable(),
		"reason_code":       plan.GetReasonCode(),
		"warnings":          append([]string(nil), plan.GetWarnings()...),
	}
	if offerRef != "" {
		auditPayload["offer_ref"] = offerRef
	}
	s.mu.Lock()
	persistErr := s.appendRuntimeAuditLocked(&runtimev1.LocalAuditEvent{
		Id: "audit_" + ulid.Make().String(), EventType: "model_install_plan_resolved", OccurredAt: now,
		Detail:  fmt.Sprintf("resolved install plan for %s (available=%t reason=%s)", plan.GetModelId(), plan.GetInstallAvailable(), plan.GetReasonCode()),
		ModelId: plan.GetModelId(),
		Payload: toStruct(auditPayload),
	})
	s.mu.Unlock()
	if persistErr != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_PERSISTENCE_UNAVAILABLE, persistErr, grpcerr.ReasonOptions{Message: "model install plan audit could not be persisted"})
	}
	s.holdModelInstallPlan(ctx, plan)
	return &runtimev1.ResolveModelInstallPlanResponse{Plan: plan}, nil
}

func hasExistingModelInstallPlanInput(req *runtimev1.ResolveModelInstallPlanRequest) bool {
	return strings.TrimSpace(req.GetItemId()) != "" || strings.TrimSpace(req.GetSource()) != "" ||
		strings.TrimSpace(req.GetTemplateId()) != "" || strings.TrimSpace(req.GetModelId()) != "" ||
		strings.TrimSpace(req.GetRepo()) != "" || strings.TrimSpace(req.GetRevision()) != "" || len(req.GetCapabilities()) != 0 ||
		strings.TrimSpace(req.GetEngine()) != "" || strings.TrimSpace(req.GetEntry()) != "" || len(req.GetFiles()) != 0 ||
		strings.TrimSpace(req.GetLicense()) != "" || len(req.GetHashes()) != 0 || strings.TrimSpace(req.GetEndpoint()) != "" ||
		req.GetEngineConfig() != nil || strings.TrimSpace(req.GetModelType()) != ""
}

func catalogItemFromOffer(offer catalogOffer) *runtimev1.LocalCatalogModelDescriptor {
	return &runtimev1.LocalCatalogModelDescriptor{
		ItemId: offer.itemID, Source: offer.identity.sourceKind, Title: offer.title, Description: offer.description,
		ModelId: defaultString(offer.modelID, offer.identity.locator), Repo: offer.identity.locator, Revision: offer.identity.revision,
		TemplateId: offer.templateID, Capabilities: append([]string(nil), offer.capabilities...),
		InstallKind: "download", InstallAvailable: true, Entry: offer.entryPath, Files: append([]string(nil), offer.files...),
		License: offer.license, Hashes: cloneStringMap(offer.hashes), HostRequirements: cloneHostRequirements(offer.hostRequirements),
		TotalSizeBytes: offer.totalSizeBytes, SourceProvenance: offer.sourceProvenance, ModelType: offer.modelType,
	}
}

func (s *Service) resolveCatalogOffer(ctx context.Context, offerRef string) (catalogOffer, error) {
	identity, err := parseModelAssetOfferRef(offerRef)
	if err != nil {
		return catalogOffer{}, grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID, err, grpcerr.ReasonOptions{Message: "offer_ref is invalid"})
	}
	if offer, ok := s.modelIndexOfferByRef(offerRef); ok {
		return offer, nil
	}
	for _, item := range s.catalogSnapshot() {
		offer, offerErr := catalogOfferFromCatalogItem(item)
		if offerErr == nil && offer.offerRef == offerRef {
			return offer, nil
		}
	}
	if identity.sourceKind == "huggingface" {
		offer, err := s.resolveHFCatalogOffer(ctx, identity)
		if err != nil && ctx.Err() != nil {
			return catalogOffer{}, ctx.Err()
		}
		if err != nil && status.Code(err) != codes.Unknown {
			return catalogOffer{}, err
		}
		if err == nil && offer.offerRef == offerRef {
			return offer, nil
		}
	}
	return catalogOffer{}, grpcerr.WithReasonCodeOptions(codes.NotFound, runtimev1.ReasonCode_AI_LOCAL_TEMPLATE_NOT_FOUND, grpcerr.ReasonOptions{
		Message:    "catalog ModelAsset offer is stale or not found",
		ActionHint: "refresh_catalog",
	})
}

func (s *Service) resolveHFCatalogOffer(ctx context.Context, identity modelAssetOfferIdentity) (catalogOffer, error) {
	variants, err := s.listHFCatalogVariants(ctx, identity.locator, identity.revision)
	if err != nil {
		return catalogOffer{}, hfCatalogRPCError(err, "catalog variant resolution failed")
	}
	var offer catalogOffer
	found := false
	for _, variant := range variants {
		if hfVariantEntryIdentity(variant.Format, variant.Entry) != identity.entryID {
			continue
		}
		if strings.TrimSpace(variant.Revision) != identity.revision {
			return catalogOffer{}, fmt.Errorf("Hugging Face offer source revision changed")
		}
		if variant.Format == "safetensors" && len(variant.Files) == 0 {
			if err := s.resolveSingleFileCheckpoint(ctx, identity, &variant); err != nil {
				return catalogOffer{}, err
			}
		}
		offer, err = catalogOfferFromHFVariant(identity.locator, variant.Revision, variant)
		if err != nil {
			return catalogOffer{}, err
		}
		found = true
		break
	}
	if !found {
		return catalogOffer{}, fmt.Errorf("Hugging Face offer is not present")
	}
	return offer, nil
}

func modelAssetInstallPlanWarnings(requirements *runtimev1.LocalHostRequirements, profile *runtimev1.LocalDeviceProfile) []string {
	if requirements == nil || profile == nil {
		return []string{}
	}
	warnings := make([]string, 0, 3)
	if requirements.GetGpuRequired() && !profile.GetGpu().GetAvailable() {
		warnings = append(warnings, "WARN_GPU_REQUIRED")
	}
	if requirements.GetPythonRuntimeRequired() && !profile.GetPython().GetAvailable() {
		warnings = append(warnings, "WARN_PYTHON_REQUIRED")
	}
	for _, backend := range requirements.GetRequiredBackends() {
		if strings.EqualFold(strings.TrimSpace(backend), "npu") && (!profile.GetNpu().GetAvailable() || !profile.GetNpu().GetReady()) {
			warnings = append(warnings, "WARN_NPU_REQUIRED")
			break
		}
	}
	return warnings
}

func evaluateCatalogModelAcquisitionPlan(plan *runtimev1.LocalInstallPlanDescriptor) {
	if plan == nil {
		return
	}
	plan.InstallAvailable = true
	plan.ReasonCode = "ACTION_EXECUTED"
	if strings.TrimSpace(plan.GetModelId()) == "" || strings.TrimSpace(plan.GetRepo()) == "" {
		plan.InstallAvailable = false
		plan.ReasonCode = runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID.String()
		return
	}
	files := normalizeStringSlice(plan.GetFiles())
	if len(files) == 0 {
		plan.InstallAvailable = false
		plan.ReasonCode = runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID.String()
		return
	}
	for _, file := range files {
		if normalizeExactSHA256Hex(plan.GetHashes()[file]) == "" {
			plan.InstallAvailable = false
			plan.ReasonCode = runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID.String()
			return
		}
	}
}

func (s *Service) resolveHFCatalogAcquisition(
	ctx context.Context,
	req *runtimev1.ResolveModelInstallPlanRequest,
) (*runtimev1.LocalCatalogModelDescriptor, error) {
	repo, err := normalizeHFRepo(req.GetRepo())
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_HF_REPO_INVALID, err, grpcerr.ReasonOptions{Message: "catalog repository is invalid"})
	}
	capabilities := normalizeAssetCapabilities(req.GetCapabilities())
	if len(capabilities) != 1 {
		return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID, grpcerr.ReasonOptions{Message: "catalog acquisition requires one CapabilityContract"})
	}
	requestedRevision := strings.TrimSpace(req.GetRevision())
	sourceRevision := strings.ToLower(requestedRevision)
	item := &runtimev1.LocalCatalogModelDescriptor{ItemId: "hf_" + slug(repo)}
	if !hfCommitRevisionPattern.MatchString(sourceRevision) {
		if s.hasCustomHFCatalogSearch() {
			items, err := s.searchHFCatalog(ctx, hfCatalogSearchRequest{Query: repo, Capability: capabilities[0], Limit: hfCatalogDefaultLimit})
			if err != nil {
				return nil, hfCatalogRPCError(err, "catalog source resolution failed")
			}
			sourceRevision = ""
			for _, candidate := range items {
				if strings.EqualFold(candidate.GetRepo(), repo) {
					item = cloneCatalogItem(candidate)
					sourceRevision = strings.ToLower(strings.TrimSpace(item.GetRevision()))
					break
				}
			}
		} else {
			resolvedItem, err := fetchHFRepoHeadRevision(ctx, s.hfHTTPClient(), s.hfCatalogEndpointURL(), repo, requestedRevision)
			if err != nil {
				if errors.Is(err, errHFRepoNotFound) {
					return nil, grpcerr.WithReasonCodeOptions(codes.NotFound, runtimev1.ReasonCode_AI_LOCAL_TEMPLATE_NOT_FOUND, grpcerr.ReasonOptions{Message: "portable source is not present in the current catalog"})
				}
				return nil, hfCatalogRPCError(err, "catalog source resolution failed")
			}
			item = resolvedItem
			sourceRevision = strings.ToLower(strings.TrimSpace(item.GetRevision()))
		}
		if !hfCommitRevisionPattern.MatchString(sourceRevision) {
			return nil, grpcerr.WithReasonCodeOptions(codes.NotFound, runtimev1.ReasonCode_AI_LOCAL_TEMPLATE_NOT_FOUND, grpcerr.ReasonOptions{Message: "portable source is not present in the current catalog"})
		}
	}
	entry, ok := normalizeHFFilePath(req.GetEntry())
	if !ok {
		return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID, grpcerr.ReasonOptions{Message: "portable source file is invalid"})
	}
	if isHFWeightShard(entry) {
		return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID, grpcerr.ReasonOptions{Message: "a single portable source file cannot restore a sharded model distribution"})
	}
	variants, err := s.listHFCatalogVariants(ctx, repo, sourceRevision)
	if err != nil {
		return nil, hfCatalogRPCError(err, "catalog variant resolution failed")
	}
	var variant *hfCatalogVariant
	for index := range variants {
		if variants[index].Entry == entry && variants[index].Revision == sourceRevision {
			variant = &variants[index]
			break
		}
	}
	if variant == nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.NotFound, runtimev1.ReasonCode_AI_LOCAL_TEMPLATE_NOT_FOUND, grpcerr.ReasonOptions{Message: "portable source file is not present in the current catalog"})
	}
	catalogHash := normalizeExactSHA256Hex(variant.SHA256)
	expectedHash := normalizeExactSHA256Hex(req.GetHashes()[entry])
	if catalogHash == "" {
		return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID, grpcerr.ReasonOptions{Message: "catalog variant has no exact SHA-256"})
	}
	if expectedHash == "" || expectedHash != catalogHash {
		return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_DOWNLOAD_HASH_MISMATCH, grpcerr.ReasonOptions{Message: "portable source integrity does not match the current catalog"})
	}
	item.Source = "huggingface"
	item.Title = defaultString(variant.Title, repo)
	item.License = defaultString(variant.License, item.GetLicense())
	item.ModelType = defaultString(variant.ModelType, item.GetModelType())
	item.ModelId = repo
	item.Repo = repo
	item.Revision = sourceRevision
	item.Capabilities = capabilities
	item.Engine = ""
	item.EngineRuntimeMode = runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_UNSPECIFIED
	item.Endpoint = ""
	item.Entry = entry
	item.Files = []string{entry}
	item.Hashes = map[string]string{entry: catalogHash}
	item.TotalSizeBytes = variant.SizeBytes
	item.EngineConfig = nil
	item.InstallKind = "download"
	item.InstallAvailable = true
	return item, nil
}

func defaultLocalEngine(raw string, capabilities []string) string {
	normalized := strings.ToLower(strings.TrimSpace(raw))
	if normalized == "audio-cpp" {
		return "speech"
	}
	if normalized != "" {
		return normalized
	}
	for _, capability := range capabilities {
		switch normalizeLocalCapabilityToken(capability) {
		case "text.generate", "text.embed":
			return "llama"
		case "image.generate", "video.generate", "world.generate", "image.upscale", "video.upscale":
			return "media"
		case "audio.synthesize", "audio.transcribe", "music.generate", "music.transcribe", "voice.create", "realtime.interact":
			return "speech"
		}
	}
	return ""
}

func (s *Service) InstallModelFromPlan(ctx context.Context, req *runtimev1.InstallModelFromPlanRequest) (*runtimev1.InstallModelFromPlanResponse, error) {
	planID := ""
	if req != nil {
		planID = req.GetPlanId()
	}
	plan, err := s.takeModelInstallPlan(ctx, planID)
	if err != nil {
		code := codes.NotFound
		actionHint := "resolve_model_install_plan"
		if errors.Is(err, errModelInstallPlanMissing) {
			code = codes.InvalidArgument
			actionHint = "provide_install_plan_id"
		} else if errors.Is(err, errModelInstallPlanExpired) {
			code = codes.FailedPrecondition
		} else if errors.Is(err, errModelInstallPlanOwner) {
			code = codes.PermissionDenied
		}
		return nil, grpcerr.WithReasonCodeOptions(code, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
			Message: err.Error(), ActionHint: actionHint,
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
	if len(plan.GetFiles()) == 0 {
		return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
			Message: "ModelAsset install plan contains no payload files",
		})
	}
	kind := inferAssetKindFromCapabilities(plan.GetCapabilities())
	if kind == runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_UNSPECIFIED && strings.TrimSpace(plan.GetModelType()) != "" {
		kind, err = verifiedAssetKindForPassiveModel(strings.TrimSpace(plan.GetModelType()))
		if err != nil {
			return nil, grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID, err, grpcerr.ReasonOptions{Message: "install plan model_type is invalid"})
		}
	}
	if err := s.requireModelAssetWrites(); err != nil {
		return nil, err
	}
	archive, err := s.catalogReleaseArchiveForPlan(plan)
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID, err, grpcerr.ReasonOptions{
			Message: "install plan does not match its catalog offer", ActionHint: "resolve_model_install_plan",
		})
	}
	githubCommitFiles, sourceEntry, err := s.catalogFileSourceForPlan(plan)
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID, err, grpcerr.ReasonOptions{})
	}
	record, installSessionID, err := s.installManagedDownloadedModelWithTransfer(ctx, managedDownloadedModelSpec{
		modelID:           defaultString(plan.GetTemplateId(), defaultString(plan.GetItemId(), plan.GetModelId())),
		displayName:       plan.GetModelId(),
		catalogAssetID:    plan.GetItemId(),
		catalogTemplateID: plan.GetTemplateId(),
		kind:              kind,
		capabilities:      append([]string(nil), plan.GetCapabilities()...),
		entry:             plan.GetEntry(),
		files:             append([]string(nil), plan.GetFiles()...),
		license:           plan.GetLicense(),
		sourceProvenance:  plan.GetSourceProvenance(),
		repo:              plan.GetRepo(),
		revision:          plan.GetRevision(),
		hashes:            cloneStringMap(plan.GetHashes()),
		totalSizeBytes:    plan.GetTotalSizeBytes(),
		planID:            plan.GetPlanId(),
		archive:           archive,
		githubCommitFiles: githubCommitFiles,
		sourceEntry:       sourceEntry,
	}, "")
	if err != nil {
		return nil, modelInstallRPCError(err)
	}
	if record == nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
			Message: "install plan produced no ModelAsset payload",
		})
	}
	return &runtimev1.InstallModelFromPlanResponse{
		ModelAsset: record, InstallSessionId: installSessionID,
		Disposition: s.localTransferSummary(installSessionID).GetDisposition(),
	}, nil
}

func modelInstallRPCError(err error) error {
	var conflict *modelObjectConflict
	if errors.As(err, &conflict) {
		return modelObjectConflictRPCError(conflict)
	}
	if errors.Is(err, errLocalTransferCancelled) {
		return grpcerr.WrapWithReasonCode(codes.Canceled, runtimev1.ReasonCode_AI_LOCAL_EXECUTION_CANCELED, err, grpcerr.ReasonOptions{
			Message:    "model install cancelled",
			ActionHint: "retry_model_install",
		})
	}
	var rateLimit *filedownload.RateLimitError
	if errors.As(err, &rateLimit) {
		return hfRateLimitedRPCError(err, rateLimit.RetryAfter, "model download rate limited")
	}
	return err
}

// @nimi-authority: rule.nimi.runtime.model-catalog.r032
// Source selection is resolved once from exact current catalog facts and then
// retained in the durable transfer. Resume never reinterprets mutable catalog.
func (s *Service) catalogFileSourceForPlan(plan *runtimev1.LocalInstallPlanDescriptor) (githubCommit bool, sourceEntry string, err error) {
	if s.localProviderCatalog == nil {
		return false, "", nil
	}
	for _, row := range s.localProviderCatalog.LocalPlaneModels() {
		if row.Install == nil {
			continue
		}
		github := row.Install.InstallKind == githubCommitInstallKind
		for _, variant := range row.Variants {
			if (!github && variant.SourceEntry == "") || variant.VariantID != plan.GetTemplateId() {
				continue
			}
			repo, commit := catalogVariantSource(row, variant)
			if (github && !validGitHubCommitSource(repo, commit)) || plan.GetRepo() != repo || plan.GetRevision() != commit || plan.GetEntry() != variant.Entry || plan.GetTotalSizeBytes() != variant.TotalSizeBytes || len(plan.GetFiles()) != len(variant.Files) {
				return false, "", fmt.Errorf("model file plan no longer matches its offer")
			}
			for i, file := range variant.Files {
				if plan.GetFiles()[i] != file || normalizeExactSHA256Hex(plan.GetHashes()[file]) != normalizeExactSHA256Hex(variant.Hashes[file]) {
					return false, "", fmt.Errorf("model file plan integrity changed")
				}
			}
			return github, variant.SourceEntry, nil
		}
	}
	return false, "", nil
}
