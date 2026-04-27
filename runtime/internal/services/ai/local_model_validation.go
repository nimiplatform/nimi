package ai

import (
	"context"
	"fmt"
	"runtime"
	"sort"
	"strings"
	"time"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localrouting"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/texttarget"
)

type localModelLister interface {
	ListLocalAssets(context.Context, *runtimev1.ListLocalAssetsRequest) (*runtimev1.ListLocalAssetsResponse, error)
	WarmLocalAsset(context.Context, *runtimev1.WarmLocalAssetRequest) (*runtimev1.WarmLocalAssetResponse, error)
	StartLocalAsset(context.Context, *runtimev1.StartLocalAssetRequest) (*runtimev1.StartLocalAssetResponse, error)
	AcquireLocalAssetLease(context.Context, string, string) error
	ReleaseLocalAssetLease(context.Context, string, string) error
}

type localImageProfileResolver interface {
	ResolveManagedMediaImageProfile(context.Context, string, map[string]any) (string, map[string]any, map[string]any, error)
	ResolveManagedMediaBackendTarget(context.Context) (string, string, error)
	ResolveManagedAssetPath(context.Context, string) (string, error)
	ResolveCanonicalImageSelection(context.Context, string) (engine.ImageSupervisedMatrixSelection, error)
	EnsureManagedMediaImageLoaded(context.Context, string, string, map[string]any, map[string]any, string) (*nimillm.ManagedMediaImageLoadDiagnostics, error)
	ReleaseManagedMediaImage(context.Context, string, string, map[string]any, map[string]any, string) error
	UpdateManagedMediaImageExecutionStatus(context.Context, string, bool, string) error
}

type localModelSelector struct {
	modelID        string
	explicitEngine string
	preferLocal    bool
	modal          runtimev1.Modal
}

type localModelExecutionPlan struct {
	requestedModelID string
	resolvedModelID  string
	modal            runtimev1.Modal
	selected         *runtimev1.LocalAssetRecord
	warmEndpoint     string
	readinessSource  string
	readinessAt      time.Time
}

var localModelValidationGOOS = runtime.GOOS

func (s *Service) validateLocalModelRequest(ctx context.Context, requestedModelID string, remoteTarget *nimillm.RemoteTarget, modal runtimev1.Modal) error {
	return s.validateLocalModelRequestWithExtensions(ctx, requestedModelID, remoteTarget, modal, nil)
}

func (s *Service) validateLocalModelRequestWithExtensions(ctx context.Context, requestedModelID string, remoteTarget *nimillm.RemoteTarget, modal runtimev1.Modal, scenarioExtensions map[string]any) error {
	_, err := s.prepareLocalModelExecutionPlan(ctx, requestedModelID, remoteTarget, modal, scenarioExtensions)
	return err
}

func (s *Service) prepareLocalModelExecutionPlan(ctx context.Context, requestedModelID string, remoteTarget *nimillm.RemoteTarget, modal runtimev1.Modal, scenarioExtensions map[string]any) (*localModelExecutionPlan, error) {
	totalStartedAt := time.Now()
	if remoteTarget != nil {
		return nil, nil
	}
	if s.localModel == nil {
		return nil, nil
	}
	resolvedModelID, err := texttarget.ResolveInternalDefaultAlias(s.selector.targetConfig, requestedModelID)
	if err != nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_MODULE_CONFIG_INVALID, grpcerr.ReasonOptions{
			ActionHint: "configure_runtime_default_target",
			Message:    err.Error(),
		})
	}
	if preferredRoute(resolvedModelID) != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL {
		return nil, nil
	}
	s.observeCounter("runtime_ai_local_validation_total", 1,
		"requested_model_id", requestedModelID,
		"resolved_model_id", resolvedModelID,
		"modal", modal.String(),
	)

	listStartedAt := time.Now()
	localModels, err := s.listAllLocalModels(ctx, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNSPECIFIED)
	s.observeLatency("runtime.ai.local.validation_list_ms", listStartedAt,
		"requested_model_id", requestedModelID,
		"resolved_model_id", resolvedModelID,
		"modal", modal.String(),
		"model_count", len(localModels),
	)
	s.observeCounter("runtime_ai_local_validation_list_total", 1,
		"requested_model_id", requestedModelID,
		"resolved_model_id", resolvedModelID,
		"modal", modal.String(),
	)
	if err != nil {
		return nil, normalizeLocalModelRPCError(err)
	}

	selector := parseLocalModelSelector(resolvedModelID, modal)
	selectStartedAt := time.Now()
	selected, reason, unavailableDetail := selectRunnableLocalModel(localModels, selector)
	selectedLocalAssetID := ""
	if selected != nil {
		selectedLocalAssetID = strings.TrimSpace(selected.GetLocalAssetId())
	}
	s.observeLatency("runtime.ai.local.validation_select_ms", selectStartedAt,
		"requested_model_id", requestedModelID,
		"resolved_model_id", resolvedModelID,
		"modal", modal.String(),
		"local_asset_id", selectedLocalAssetID,
		"reason_code", reason.String(),
	)
	if reason != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		if reason == runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, reason)
		}
		if reason == runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE && strings.TrimSpace(unavailableDetail) != "" {
			return nil, localModelUnavailableError(unavailableDetail)
		}
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, reason)
	}
	if selected == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}
	if bypassed, err := s.tryBypassUnhealthyManagedImageStartWithDynamicProfile(
		ctx,
		selected,
		requestedModelID,
		modal,
		scenarioExtensions,
	); err != nil {
		return nil, err
	} else if bypassed {
		if modelRequiresInvokeProfile(selected) {
			return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_PROFILE_MISSING)
		}
		return &localModelExecutionPlan{
			requestedModelID: requestedModelID,
			resolvedModelID:  resolvedModelID,
			modal:            modal,
			selected:         selected,
			readinessSource:  "dynamic_profile_bypass",
			readinessAt:      time.Now(),
		}, nil
	}
	var warmEndpoint string
	readinessSource := "listed"
	if selected.GetStatus() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED && shouldWarmInstalledLocalModel(selected, modal) {
		warmStartedAt := time.Now()
		s.observeCounter("runtime_ai_local_validation_warm_total", 1,
			"requested_model_id", requestedModelID,
			"resolved_model_id", resolvedModelID,
			"local_asset_id", selectedLocalAssetID,
			"modal", modal.String(),
		)
		warmed, err := s.localModel.WarmLocalAsset(ctx, &runtimev1.WarmLocalAssetRequest{
			LocalAssetId: selected.GetLocalAssetId(),
		})
		s.observeLatency("runtime.ai.local.validation_warm_or_start_ms", warmStartedAt,
			"operation", "warm",
			"requested_model_id", requestedModelID,
			"resolved_model_id", resolvedModelID,
			"local_asset_id", selectedLocalAssetID,
			"modal", modal.String(),
		)
		if err != nil {
			return nil, normalizeLocalModelRPCError(err)
		}
		selected.Status = runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE
		readinessSource = "warm"
		if warmed != nil && strings.TrimSpace(warmed.GetEndpoint()) != "" {
			warmEndpoint = strings.TrimSpace(warmed.GetEndpoint())
		}
	}
	if (selected.GetStatus() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED && shouldStartInstalledLocalModel(selected, modal)) ||
		(selected.GetStatus() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY && shouldRetryUnhealthyLocalModelStart(selected, modal)) {
		startStartedAt := time.Now()
		s.observeCounter("runtime_ai_local_validation_start_total", 1,
			"requested_model_id", requestedModelID,
			"resolved_model_id", resolvedModelID,
			"local_asset_id", selectedLocalAssetID,
			"modal", modal.String(),
		)
		if err := s.primeInstalledLocalModelRequest(ctx, selected, requestedModelID, modal, scenarioExtensions); err != nil {
			return nil, err
		}
		started, err := s.localModel.StartLocalAsset(ctx, &runtimev1.StartLocalAssetRequest{
			LocalAssetId: selected.GetLocalAssetId(),
		})
		if err != nil {
			return nil, normalizeLocalModelRPCError(err)
		}
		s.observeLatency("runtime.ai.local.validation_warm_or_start_ms", startStartedAt,
			"operation", "start",
			"requested_model_id", requestedModelID,
			"resolved_model_id", resolvedModelID,
			"local_asset_id", selectedLocalAssetID,
			"modal", modal.String(),
		)
		if started != nil && started.GetAsset() != nil {
			selected = started.GetAsset()
			selectedLocalAssetID = strings.TrimSpace(selected.GetLocalAssetId())
		}
		if selected.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
			return nil, localModelUnavailableErrorFromRecord(selected)
		}
		readinessSource = "start"
	}
	s.hydrateLocalProviderFromModel(selected, warmEndpoint)
	if modelRequiresInvokeProfile(selected) {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_PROFILE_MISSING)
	}
	s.observeLatency("runtime.ai.local.validation_total_ms", totalStartedAt,
		"requested_model_id", requestedModelID,
		"resolved_model_id", resolvedModelID,
		"local_asset_id", selectedLocalAssetID,
		"modal", modal.String(),
	)
	return &localModelExecutionPlan{
		requestedModelID: requestedModelID,
		resolvedModelID:  resolvedModelID,
		modal:            modal,
		selected:         selected,
		warmEndpoint:     warmEndpoint,
		readinessSource:  readinessSource,
		readinessAt:      time.Now(),
	}, nil
}

func (s *Service) tryBypassUnhealthyManagedImageStartWithDynamicProfile(
	ctx context.Context,
	selected *runtimev1.LocalAssetRecord,
	requestedModelID string,
	modal runtimev1.Modal,
	scenarioExtensions map[string]any,
) (bool, error) {
	if s == nil || selected == nil || s.localImageProfile == nil {
		return false, nil
	}
	if modal != runtimev1.Modal_MODAL_IMAGE || !shouldRetryUnhealthyLocalModelStart(selected, modal) {
		return false, nil
	}
	if len(scenarioExtensions) == 0 {
		return false, nil
	}
	if _, hasProfileEntries := scenarioExtensions["profile_entries"]; !hasProfileEntries {
		if _, hasEntryOverrides := scenarioExtensions["entry_overrides"]; !hasEntryOverrides {
			return false, nil
		}
	}
	selection, err := s.localImageProfile.ResolveCanonicalImageSelection(ctx, requestedModelID)
	if err != nil {
		return false, localModelUnavailableError(err.Error())
	}
	if !selection.Matched || selection.Conflict || selection.Entry == nil {
		return false, localModelUnavailableError(strings.TrimSpace(selection.CompatibilityDetail))
	}
	if selection.ControlPlane != engine.ImageControlPlaneRuntime ||
		selection.ExecutionPlane != engine.EngineMedia ||
		selection.BackendClass != engine.ImageBackendClassNativeBinary {
		return false, nil
	}
	if _, _, _, err := s.localImageProfile.ResolveManagedMediaImageProfile(ctx, requestedModelID, scenarioExtensions); err != nil {
		return false, localModelUnavailableError(err.Error())
	}
	providerID := strings.ToLower(strings.TrimSpace(selected.GetEngine()))
	endpoint := installedLocalProviderEndpoint(selected, "")
	if endpoint == "" || !localrouting.IsKnownProvider(providerID) {
		return false, nil
	}
	s.SetLocalProviderEndpoint(providerID, endpoint, "")
	return true, nil
}

func (s *Service) primeInstalledLocalModelRequest(ctx context.Context, selected *runtimev1.LocalAssetRecord, requestedModelID string, modal runtimev1.Modal, scenarioExtensions map[string]any) error {
	if s == nil || selected == nil {
		return nil
	}
	if modal != runtimev1.Modal_MODAL_IMAGE || s.localImageProfile == nil {
		return nil
	}
	selection, err := s.localImageProfile.ResolveCanonicalImageSelection(ctx, requestedModelID)
	if err != nil {
		return localModelUnavailableError(err.Error())
	}
	if !selection.Matched || selection.Conflict || selection.Entry == nil {
		return localModelUnavailableError(strings.TrimSpace(selection.CompatibilityDetail))
	}
	if selection.ControlPlane != engine.ImageControlPlaneRuntime ||
		selection.ExecutionPlane != engine.EngineMedia ||
		selection.BackendClass != engine.ImageBackendClassNativeBinary {
		return nil
	}
	if _, _, _, err := s.localImageProfile.ResolveManagedMediaImageProfile(ctx, requestedModelID, scenarioExtensions); err != nil {
		return localModelUnavailableError(err.Error())
	}
	return nil
}

func shouldWarmInstalledLocalModel(model *runtimev1.LocalAssetRecord, modal runtimev1.Modal) bool {
	if model == nil {
		return false
	}
	switch modal {
	case runtimev1.Modal_MODAL_UNSPECIFIED, runtimev1.Modal_MODAL_TEXT, runtimev1.Modal_MODAL_EMBEDDING:
	default:
		return false
	}
	for _, capability := range model.GetCapabilities() {
		normalized := strings.ToLower(strings.TrimSpace(capability))
		if normalized == "chat" || normalized == "text.generate" {
			return true
		}
	}
	return false
}

func installedLocalProviderEndpoint(model *runtimev1.LocalAssetRecord, endpointOverride string) string {
	if trimmed := strings.TrimSpace(endpointOverride); trimmed != "" {
		return trimmed
	}
	if model == nil {
		return ""
	}
	return strings.TrimSpace(model.GetEndpoint())
}

func shouldStartInstalledLocalModel(model *runtimev1.LocalAssetRecord, modal runtimev1.Modal) bool {
	if model == nil || model.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED {
		return false
	}
	if strings.TrimSpace(model.GetLocalAssetId()) == "" {
		return false
	}
	switch modal {
	case runtimev1.Modal_MODAL_IMAGE,
		runtimev1.Modal_MODAL_VIDEO,
		runtimev1.Modal_MODAL_TTS,
		runtimev1.Modal_MODAL_STT,
		runtimev1.Modal_MODAL_MUSIC:
		return true
	default:
		return false
	}
}

func shouldRetryUnhealthyLocalModelStart(model *runtimev1.LocalAssetRecord, modal runtimev1.Modal) bool {
	if model == nil || model.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY {
		return false
	}
	if strings.TrimSpace(model.GetLocalAssetId()) == "" {
		return false
	}
	switch modal {
	case runtimev1.Modal_MODAL_IMAGE:
	default:
		return false
	}
	if !strings.EqualFold(strings.TrimSpace(model.GetEngine()), "media") {
		return false
	}
	for _, capability := range model.GetCapabilities() {
		normalized := strings.ToLower(strings.TrimSpace(capability))
		if normalized == "image" || normalized == "image.generate" {
			return true
		}
	}
	return false
}

func nonActiveLocalModelStartDetail(model *runtimev1.LocalAssetRecord) string {
	if model == nil {
		return "local model failed to become active"
	}
	if detail := strings.TrimSpace(model.GetHealthDetail()); detail != "" {
		return detail
	}
	status := strings.ToLower(strings.TrimSpace(model.GetStatus().String()))
	if status == "" {
		return "local model failed to become active"
	}
	return "local model start did not reach active state: " + status
}

func localModelUnavailableErrorFromRecord(model *runtimev1.LocalAssetRecord) error {
	if model == nil {
		return localModelUnavailableError("")
	}
	detail := nonActiveLocalModelStartDetail(model)
	if reason := model.GetReasonCode(); reason != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		options := grpcerr.ReasonOptions{
			ActionHint: "inspect_local_runtime_model_health",
			Message:    strings.TrimSpace(detail),
		}
		if trimmed := strings.TrimSpace(detail); trimmed != "" {
			options.Metadata = map[string]string{
				"provider_message": trimmed,
			}
		}
		return grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, reason, options)
	}
	return localModelUnavailableError(detail)
}

func localModelUnavailableError(detail string) error {
	trimmed := strings.TrimSpace(detail)
	reasonCode := runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE
	if speechReason, ok := localSpeechReasonCodeFromDetail(trimmed); ok {
		reasonCode = speechReason
	}
	options := grpcerr.ReasonOptions{
		ActionHint: "inspect_local_runtime_model_health",
		Message:    trimmed,
	}
	if trimmed != "" {
		options.Metadata = map[string]string{
			"provider_message": trimmed,
		}
	}
	return grpcerr.WithReasonCodeOptions(
		codes.FailedPrecondition,
		reasonCode,
		options,
	)
}

func normalizeLocalModelRPCError(err error) error {
	if err == nil {
		return nil
	}
	if _, ok := grpcerr.ExtractReasonCode(err); ok {
		return err
	}
	return localModelUnavailableError(err.Error())
}

// Compatibility-only fallback for legacy local-runtime paths that still surface
// speech failures as detail strings without a structured reason code.
func localSpeechReasonCodeFromDetail(detail string) (runtimev1.ReasonCode, bool) {
	lower := strings.ToLower(strings.TrimSpace(detail))
	if lower == "" {
		return runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, false
	}
	if !looksLikeSpeechDetail(lower) {
		return runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, false
	}

	switch {
	case strings.Contains(lower, "explicit download confirmation is required"),
		strings.Contains(lower, "download confirmation required"),
		strings.Contains(lower, "awaiting download confirmation"):
		return runtimev1.ReasonCode_AI_LOCAL_SPEECH_DOWNLOAD_CONFIRMATION_REQUIRED, true
	case strings.Contains(lower, "speech-backed supervised mode is unavailable on this host"),
		strings.Contains(lower, "configure an attached endpoint instead"),
		strings.Contains(lower, "requires windows x64"),
		strings.Contains(lower, "requires an nvidia gpu"),
		strings.Contains(lower, "requires a cuda-ready nvidia runtime"):
		return runtimev1.ReasonCode_AI_LOCAL_SPEECH_PREFLIGHT_BLOCKED, true
	case strings.Contains(lower, "ensure uv for speech"),
		strings.Contains(lower, "ensure managed python for speech"),
		strings.Contains(lower, "write speech server script"),
		strings.Contains(lower, "install speech dependencies"),
		strings.Contains(lower, "write speech dependency stamp"):
		return runtimev1.ReasonCode_AI_LOCAL_SPEECH_ENV_INIT_FAILED, true
	case strings.Contains(lower, "speech probe missing expected model"):
		return runtimev1.ReasonCode_AI_LOCAL_SPEECH_CAPABILITY_DOWNLOAD_FAILED, true
	case strings.Contains(lower, "speech probe missing required capability"),
		strings.Contains(lower, "managed bundle file"),
		strings.Contains(lower, "managed local model entry missing"),
		strings.Contains(lower, "managed speech endpoint missing"),
		strings.Contains(lower, "managed speech voices invalid"),
		strings.Contains(lower, "voices.json"):
		return runtimev1.ReasonCode_AI_LOCAL_SPEECH_BUNDLE_DEGRADED, true
	case strings.Contains(lower, "speech") &&
		(strings.Contains(lower, "probe request failed") ||
			strings.Contains(lower, "probe status not ok") ||
			strings.Contains(lower, "probe response parse failed") ||
			strings.Contains(lower, "catalog status not ok") ||
			strings.Contains(lower, "catalog parse failed") ||
			strings.Contains(lower, "connect") ||
			strings.Contains(lower, "timed out") ||
			strings.Contains(lower, "engine not ready")):
		return runtimev1.ReasonCode_AI_LOCAL_SPEECH_HOST_INIT_FAILED, true
	default:
		return runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, false
	}
}

func looksLikeSpeechDetail(detail string) bool {
	return strings.Contains(detail, "speech") ||
		strings.Contains(detail, "audio.transcribe") ||
		strings.Contains(detail, "audio.synthesize") ||
		strings.Contains(detail, "voice") ||
		strings.Contains(detail, "voices.json") ||
		strings.Contains(detail, "tts") ||
		strings.Contains(detail, "asr") ||
		strings.Contains(detail, "whisper") ||
		strings.Contains(detail, "kokoro")
}

func (s *Service) hydrateLocalProviderFromModel(model *runtimev1.LocalAssetRecord, endpointOverride string) {
	if s == nil || model == nil {
		return
	}
	switch model.GetStatus() {
	case runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
		runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNSPECIFIED:
	default:
		return
	}
	providerID := strings.ToLower(strings.TrimSpace(model.GetEngine()))
	endpoint := strings.TrimSpace(endpointOverride)
	if endpoint == "" {
		endpoint = strings.TrimSpace(model.GetEndpoint())
	}
	if endpoint == "" || !localrouting.IsKnownProvider(providerID) {
		return
	}
	s.SetLocalProviderEndpoint(providerID, endpoint, "")
}

func (s *Service) listAllLocalModels(ctx context.Context, statusFilter runtimev1.LocalAssetStatus) ([]*runtimev1.LocalAssetRecord, error) {
	pageToken := ""
	collected := make([]*runtimev1.LocalAssetRecord, 0, 16)
	for i := 0; i < 20; i++ {
		resp, err := s.localModel.ListLocalAssets(ctx, &runtimev1.ListLocalAssetsRequest{
			StatusFilter: statusFilter,
			PageSize:     100,
			PageToken:    pageToken,
		})
		if err != nil {
			return nil, err
		}
		collected = append(collected, resp.GetAssets()...)
		pageToken = strings.TrimSpace(resp.GetNextPageToken())
		if pageToken == "" {
			break
		}
	}
	return collected, nil
}

func (s *Service) listAllActiveLocalModels(ctx context.Context) ([]*runtimev1.LocalAssetRecord, error) {
	return s.listAllLocalModels(ctx, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE)
}

func parseLocalModelSelector(modelID string, modal runtimev1.Modal) localModelSelector {
	raw := strings.TrimSpace(modelID)
	lower := strings.ToLower(raw)
	selector := localModelSelector{modal: modal}
	switch {
	case strings.HasPrefix(lower, "llama/"):
		selector.explicitEngine = "llama"
		selector.modelID = strings.TrimSpace(raw[len("llama/"):])
	case strings.HasPrefix(lower, "media/"):
		selector.explicitEngine = "media"
		selector.modelID = strings.TrimSpace(raw[len("media/"):])
	case strings.HasPrefix(lower, "speech/"):
		selector.explicitEngine = "speech"
		selector.modelID = strings.TrimSpace(raw[len("speech/"):])
	case strings.HasPrefix(lower, "sidecar/"):
		selector.explicitEngine = "sidecar"
		selector.modelID = strings.TrimSpace(raw[len("sidecar/"):])
	case strings.HasPrefix(lower, "local/"):
		selector.preferLocal = true
		selector.modelID = strings.TrimSpace(raw[len("local/"):])
	default:
		selector.modelID = raw
	}
	return selector
}

func selectActiveLocalModel(models []*runtimev1.LocalAssetRecord, selector localModelSelector) (*runtimev1.LocalAssetRecord, runtimev1.ReasonCode) {
	if explicitReason := unsupportedExplicitLocalEngineReason(selector); explicitReason != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		return nil, explicitReason
	}
	expectedModelID := normalizeComparableModelID(selector.modelID)
	candidates := make([]*runtimev1.LocalAssetRecord, 0, len(models))
	for _, model := range models {
		if normalizeComparableModelID(model.GetAssetId()) != expectedModelID {
			continue
		}
		candidates = append(candidates, model)
	}
	if len(candidates) == 0 {
		return nil, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE
	}

	sort.Slice(candidates, func(i, j int) bool {
		pi := localEnginePriorityForModal(candidates[i].GetEngine(), selector.modal)
		pj := localEnginePriorityForModal(candidates[j].GetEngine(), selector.modal)
		if pi != pj {
			return pi < pj
		}
		return candidates[i].GetLocalAssetId() < candidates[j].GetLocalAssetId()
	})

	if selector.explicitEngine != "" {
		for _, model := range candidates {
			if strings.EqualFold(strings.TrimSpace(model.GetEngine()), selector.explicitEngine) {
				return model, runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED
			}
		}
		return nil, runtimev1.ReasonCode_AI_MODEL_PROVIDER_MISMATCH
	}

	if selector.preferLocal {
		for _, engine := range localPreferredEngines(selector.modal) {
			for _, model := range candidates {
				if strings.EqualFold(strings.TrimSpace(model.GetEngine()), engine) {
					return model, runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED
				}
			}
		}
		return nil, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE
	}

	return candidates[0], runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED
}

func selectRunnableLocalModel(models []*runtimev1.LocalAssetRecord, selector localModelSelector) (*runtimev1.LocalAssetRecord, runtimev1.ReasonCode, string) {
	if explicitReason := unsupportedExplicitLocalEngineReason(selector); explicitReason != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		return nil, explicitReason, ""
	}
	expectedModelID := normalizeComparableModelID(selector.modelID)
	candidates := make([]*runtimev1.LocalAssetRecord, 0, len(models))
	for _, model := range models {
		if model == nil {
			continue
		}
		if model.GetStatus() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_REMOVED {
			continue
		}
		if normalizeComparableModelID(model.GetAssetId()) != expectedModelID {
			continue
		}
		candidates = append(candidates, model)
	}
	if len(candidates) == 0 {
		return nil, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, ""
	}

	if selector.explicitEngine != "" {
		engineCandidates := filterLocalModelsByEngine(candidates, selector.explicitEngine)
		if len(engineCandidates) == 0 {
			return nil, runtimev1.ReasonCode_AI_MODEL_PROVIDER_MISMATCH, ""
		}
		if selected := firstRunnableLocalModel(engineCandidates, selector.modal); selected != nil {
			return selected, runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, ""
		}
		return nil, unavailableLocalModelReason(engineCandidates), unavailableLocalModelDetail(engineCandidates)
	}

	if selector.preferLocal {
		for _, engine := range localPreferredEngines(selector.modal) {
			if selected := firstRunnableLocalModel(filterLocalModelsByEngine(candidates, engine), selector.modal); selected != nil {
				return selected, runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, ""
			}
		}
		return nil, unavailableLocalModelReason(candidates), unavailableLocalModelDetail(candidates)
	}

	if selected := firstRunnableLocalModel(candidates, selector.modal); selected != nil {
		return selected, runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, ""
	}
	return nil, unavailableLocalModelReason(candidates), unavailableLocalModelDetail(candidates)
}

func firstRunnableLocalModel(models []*runtimev1.LocalAssetRecord, modal runtimev1.Modal) *runtimev1.LocalAssetRecord {
	for _, candidate := range models {
		if candidate == nil {
			continue
		}
		switch candidate.GetStatus() {
		case runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
			runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNSPECIFIED:
			return candidate
		}
	}
	for _, candidate := range models {
		if candidate != nil && candidate.GetStatus() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED {
			return candidate
		}
	}
	for _, candidate := range models {
		if shouldRetryUnhealthyLocalModelStart(candidate, modal) {
			return candidate
		}
	}
	return nil
}

func unsupportedExplicitLocalEngineReason(selector localModelSelector) runtimev1.ReasonCode {
	if selector.explicitEngine == "" {
		return runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED
	}
	if !localrouting.IsKnownProvider(selector.explicitEngine) {
		return runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED
	}
	if !localrouting.ProviderSupportsCapability(selector.explicitEngine, localRoutingCapabilityForModal(selector.modal)) {
		return runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED
	}
	return runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED
}

func filterLocalModelsByEngine(models []*runtimev1.LocalAssetRecord, engine string) []*runtimev1.LocalAssetRecord {
	normalizedEngine := strings.TrimSpace(engine)
	filtered := make([]*runtimev1.LocalAssetRecord, 0, len(models))
	for _, model := range models {
		if strings.EqualFold(strings.TrimSpace(model.GetEngine()), normalizedEngine) {
			filtered = append(filtered, model)
		}
	}
	return filtered
}

func firstActiveLocalModel(models []*runtimev1.LocalAssetRecord) *runtimev1.LocalAssetRecord {
	active := make([]*runtimev1.LocalAssetRecord, 0, len(models))
	for _, model := range models {
		switch model.GetStatus() {
		case runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
			runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNSPECIFIED:
			active = append(active, model)
		}
	}
	if len(active) == 0 {
		return nil
	}
	sort.Slice(active, func(i, j int) bool {
		pi := localEnginePriorityForModal(active[i].GetEngine(), runtimev1.Modal_MODAL_UNSPECIFIED)
		pj := localEnginePriorityForModal(active[j].GetEngine(), runtimev1.Modal_MODAL_UNSPECIFIED)
		if pi != pj {
			return pi < pj
		}
		return active[i].GetLocalAssetId() < active[j].GetLocalAssetId()
	})
	return active[0]
}

func unavailableLocalModelDetail(models []*runtimev1.LocalAssetRecord) string {
	if len(models) == 0 {
		return ""
	}
	sorted := append([]*runtimev1.LocalAssetRecord(nil), models...)
	sort.Slice(sorted, func(i, j int) bool {
		si := localUnavailableStatusPriority(sorted[i].GetStatus())
		sj := localUnavailableStatusPriority(sorted[j].GetStatus())
		if si != sj {
			return si < sj
		}
		pi := localEnginePriorityForModal(sorted[i].GetEngine(), runtimev1.Modal_MODAL_UNSPECIFIED)
		pj := localEnginePriorityForModal(sorted[j].GetEngine(), runtimev1.Modal_MODAL_UNSPECIFIED)
		if pi != pj {
			return pi < pj
		}
		return sorted[i].GetLocalAssetId() < sorted[j].GetLocalAssetId()
	})
	selected := sorted[0]
	if detail := strings.TrimSpace(selected.GetHealthDetail()); detail != "" {
		return detail
	}
	return fmt.Sprintf("local model %q is %s", strings.TrimSpace(selected.GetAssetId()), localModelStatusLabel(selected.GetStatus()))
}

func unavailableLocalModelReason(models []*runtimev1.LocalAssetRecord) runtimev1.ReasonCode {
	if len(models) == 0 {
		return runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE
	}
	sorted := append([]*runtimev1.LocalAssetRecord(nil), models...)
	sort.Slice(sorted, func(i, j int) bool {
		si := localUnavailableStatusPriority(sorted[i].GetStatus())
		sj := localUnavailableStatusPriority(sorted[j].GetStatus())
		if si != sj {
			return si < sj
		}
		pi := localEnginePriorityForModal(sorted[i].GetEngine(), runtimev1.Modal_MODAL_UNSPECIFIED)
		pj := localEnginePriorityForModal(sorted[j].GetEngine(), runtimev1.Modal_MODAL_UNSPECIFIED)
		if pi != pj {
			return pi < pj
		}
		return sorted[i].GetLocalAssetId() < sorted[j].GetLocalAssetId()
	})
	if reason := sorted[0].GetReasonCode(); reason != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		return reason
	}
	return runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE
}

func localUnavailableStatusPriority(status runtimev1.LocalAssetStatus) int {
	switch status {
	case runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY:
		return 0
	case runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED:
		return 1
	case runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE:
		return 2
	default:
		return 3
	}
}

func localModelStatusLabel(status runtimev1.LocalAssetStatus) string {
	switch status {
	case runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE:
		return "active"
	case runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED:
		return "installed"
	case runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY:
		return "unhealthy"
	case runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_REMOVED:
		return "removed"
	default:
		return strings.ToLower(strings.TrimSpace(status.String()))
	}
}

func localEnginePriority(engine string) int {
	return localEnginePriorityForModal(engine, runtimev1.Modal_MODAL_UNSPECIFIED)
}

func localEnginePriorityForModal(engine string, modal runtimev1.Modal) int {
	return localrouting.PreferenceRank(localModelValidationGOOS, localRoutingCapabilityForModal(modal), engine)
}

func localPreferredEngines(modal runtimev1.Modal) []string {
	return localrouting.PreferenceOrder(localModelValidationGOOS, localRoutingCapabilityForModal(modal))
}

func localRoutingCapabilityForModal(modal runtimev1.Modal) string {
	switch modal {
	case runtimev1.Modal_MODAL_IMAGE:
		return "image.generate"
	case runtimev1.Modal_MODAL_VIDEO:
		return "video.generate"
	case runtimev1.Modal_MODAL_TTS:
		return "audio.synthesize"
	case runtimev1.Modal_MODAL_STT:
		return "audio.transcribe"
	case runtimev1.Modal_MODAL_MUSIC:
		return "music.generate"
	case runtimev1.Modal_MODAL_EMBEDDING:
		return "text.embed"
	default:
		return "text.generate"
	}
}

func modelRequiresInvokeProfile(model *runtimev1.LocalAssetRecord) bool {
	if strings.TrimSpace(model.GetLocalInvokeProfileId()) != "" {
		return false
	}
	for _, capability := range model.GetCapabilities() {
		capability = strings.ToLower(strings.TrimSpace(capability))
		if capability == "custom" || strings.HasPrefix(capability, "custom.") || strings.HasPrefix(capability, "custom/") {
			return true
		}
	}
	return false
}
