package ai

import (
	"context"
	"runtime"
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

type managedLlamaModelResolver interface {
	ResolveManagedLlamaModelByCapabilities(preferred string, capabilities ...string) (string, bool)
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
	providerModelID  string
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
		providerModelID:  s.resolveSelectedLocalProviderModelID(selected, resolvedModelID, modal),
		modal:            modal,
		selected:         selected,
		warmEndpoint:     warmEndpoint,
		readinessSource:  readinessSource,
		readinessAt:      time.Now(),
	}, nil
}

func (s *Service) resolveSelectedLocalProviderModelID(selected *runtimev1.LocalAssetRecord, requestedModelID string, modal runtimev1.Modal) string {
	if selected == nil {
		return strings.TrimSpace(requestedModelID)
	}
	if strings.EqualFold(strings.TrimSpace(selected.GetEngine()), "llama") {
		if resolver, ok := s.localModel.(managedLlamaModelResolver); ok && resolver != nil {
			capability := localRoutingCapabilityForModal(modal)
			for _, preferred := range []string{
				selected.GetLocalAssetId(),
				requestedModelID,
				selected.GetAssetId(),
				selected.GetLogicalModelId(),
			} {
				if resolved, found := resolver.ResolveManagedLlamaModelByCapabilities(preferred, capability); found && strings.TrimSpace(resolved) != "" {
					return strings.TrimSpace(resolved)
				}
			}
		}
	}
	for _, candidate := range []string{
		selected.GetAssetId(),
		selected.GetLogicalModelId(),
		requestedModelID,
	} {
		if trimmed := strings.TrimSpace(candidate); trimmed != "" {
			return trimmed
		}
	}
	return ""
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
	if shouldRetryUnhealthyManagedLlamaStart(model, modal) {
		return true
	}
	if shouldRetryUnhealthyManagedSpeechStart(model, modal) {
		return true
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

func shouldRetryUnhealthyManagedSpeechStart(model *runtimev1.LocalAssetRecord, modal runtimev1.Modal) bool {
	if model == nil || model.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY {
		return false
	}
	if !strings.EqualFold(strings.TrimSpace(model.GetEngine()), "speech") {
		return false
	}
	switch modal {
	case runtimev1.Modal_MODAL_TTS:
		return localModelHasAnyCapability(model, "audio.synthesize", "tts")
	case runtimev1.Modal_MODAL_STT:
		return localModelHasAnyCapability(model, "audio.transcribe", "stt")
	default:
		return false
	}
}

func shouldRetryUnhealthyManagedLlamaStart(model *runtimev1.LocalAssetRecord, modal runtimev1.Modal) bool {
	if model == nil {
		return false
	}
	switch modal {
	case runtimev1.Modal_MODAL_UNSPECIFIED, runtimev1.Modal_MODAL_TEXT, runtimev1.Modal_MODAL_EMBEDDING:
	default:
		return false
	}
	if !strings.EqualFold(strings.TrimSpace(model.GetEngine()), "llama") {
		return false
	}
	detail := strings.ToLower(strings.TrimSpace(model.GetHealthDetail()))
	if !strings.Contains(detail, "plane=local-supervised") || !strings.Contains(detail, "connect: connection refused") {
		return false
	}
	for _, capability := range model.GetCapabilities() {
		normalized := strings.ToLower(strings.TrimSpace(capability))
		if normalized == "chat" || normalized == "text.generate" || normalized == "embedding" || normalized == "text.embed" {
			return true
		}
	}
	return false
}

func localModelHasAnyCapability(model *runtimev1.LocalAssetRecord, capabilities ...string) bool {
	if model == nil {
		return false
	}
	expected := make(map[string]struct{}, len(capabilities))
	for _, capability := range capabilities {
		normalized := strings.ToLower(strings.TrimSpace(capability))
		if normalized != "" {
			expected[normalized] = struct{}{}
		}
	}
	if len(expected) == 0 {
		return false
	}
	for _, capability := range model.GetCapabilities() {
		normalized := strings.ToLower(strings.TrimSpace(capability))
		if _, ok := expected[normalized]; ok {
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
		runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE,
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

func (s *Service) hydrateLocalProviderFromModel(model *runtimev1.LocalAssetRecord, endpointOverride string) {
	if s == nil || model == nil {
		return
	}
	switch model.GetStatus() {
	case runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE:
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
