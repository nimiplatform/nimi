package ai

import (
	"context"
	"fmt"
	"runtime"
	"sort"
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localrouting"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/texttarget"
)

type localModelLister interface {
	ListLocalModels(context.Context, *runtimev1.ListLocalModelsRequest) (*runtimev1.ListLocalModelsResponse, error)
	WarmLocalModel(context.Context, *runtimev1.WarmLocalModelRequest) (*runtimev1.WarmLocalModelResponse, error)
}

type localImageProfileResolver interface {
	ResolveManagedMediaImageProfile(context.Context, string, map[string]any) (string, map[string]any, map[string]any, error)
	ResolveManagedArtifactPath(context.Context, string) (string, error)
}

type localModelSelector struct {
	modelID        string
	explicitEngine string
	preferLocal    bool
	modal          runtimev1.Modal
}

var localModelValidationGOOS = runtime.GOOS

func (s *Service) validateLocalModelRequest(ctx context.Context, requestedModelID string, remoteTarget *nimillm.RemoteTarget, modal runtimev1.Modal) error {
	if remoteTarget != nil {
		return nil
	}
	if s.localModel == nil {
		return nil
	}
	resolvedModelID, err := texttarget.ResolveInternalDefaultAlias(s.selector.targetConfig, requestedModelID)
	if err != nil {
		return grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_MODULE_CONFIG_INVALID, grpcerr.ReasonOptions{
			ActionHint: "configure_runtime_default_target",
			Message:    err.Error(),
		})
	}
	if preferredRoute(resolvedModelID) != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL {
		return nil
	}

	localModels, err := s.listAllLocalModels(ctx, runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNSPECIFIED)
	if err != nil {
		return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}

	selector := parseLocalModelSelector(resolvedModelID, modal)
	selected, reason, unavailableDetail := selectRunnableLocalModel(localModels, selector)
	if reason != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		if reason == runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED {
			return grpcerr.WithReasonCode(codes.InvalidArgument, reason)
		}
		if reason == runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE && strings.TrimSpace(unavailableDetail) != "" {
			return grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, reason, grpcerr.ReasonOptions{
				ActionHint: "inspect_local_runtime_model_health",
				Message:    unavailableDetail,
			})
		}
		return grpcerr.WithReasonCode(codes.FailedPrecondition, reason)
	}
	if selected == nil {
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}
	if selected.GetStatus() == runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_INSTALLED {
		warmed, err := s.localModel.WarmLocalModel(ctx, &runtimev1.WarmLocalModelRequest{
			LocalModelId: selected.GetLocalModelId(),
		})
		if err != nil {
			return grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
				ActionHint: "inspect_local_runtime_model_health",
				Message:    err.Error(),
			})
		}
		selected.Status = runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE
		if warmed != nil && strings.TrimSpace(warmed.GetEndpoint()) != "" {
			selected.Endpoint = strings.TrimSpace(warmed.GetEndpoint())
		}
	}
	s.hydrateLocalProviderFromModel(selected)
	if modelRequiresInvokeProfile(selected) {
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_PROFILE_MISSING)
	}
	return nil
}

func (s *Service) hydrateLocalProviderFromModel(model *runtimev1.LocalModelRecord) {
	if s == nil || model == nil {
		return
	}
	switch model.GetStatus() {
	case runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE,
		runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNSPECIFIED:
	default:
		return
	}
	providerID := strings.ToLower(strings.TrimSpace(model.GetEngine()))
	endpoint := strings.TrimSpace(model.GetEndpoint())
	if endpoint == "" || !localrouting.IsKnownProvider(providerID) {
		return
	}
	s.SetLocalProviderEndpoint(providerID, endpoint, "")
}

func (s *Service) listAllLocalModels(ctx context.Context, statusFilter runtimev1.LocalModelStatus) ([]*runtimev1.LocalModelRecord, error) {
	pageToken := ""
	collected := make([]*runtimev1.LocalModelRecord, 0, 16)
	for i := 0; i < 20; i++ {
		resp, err := s.localModel.ListLocalModels(ctx, &runtimev1.ListLocalModelsRequest{
			StatusFilter: statusFilter,
			PageSize:     100,
			PageToken:    pageToken,
		})
		if err != nil {
			return nil, err
		}
		collected = append(collected, resp.GetModels()...)
		pageToken = strings.TrimSpace(resp.GetNextPageToken())
		if pageToken == "" {
			break
		}
	}
	return collected, nil
}

func (s *Service) listAllActiveLocalModels(ctx context.Context) ([]*runtimev1.LocalModelRecord, error) {
	return s.listAllLocalModels(ctx, runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE)
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

func selectActiveLocalModel(models []*runtimev1.LocalModelRecord, selector localModelSelector) (*runtimev1.LocalModelRecord, runtimev1.ReasonCode) {
	if explicitReason := unsupportedExplicitLocalEngineReason(selector); explicitReason != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		return nil, explicitReason
	}
	expectedModelID := normalizeComparableModelID(selector.modelID)
	candidates := make([]*runtimev1.LocalModelRecord, 0, len(models))
	for _, model := range models {
		if normalizeComparableModelID(model.GetModelId()) != expectedModelID {
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
		return candidates[i].GetLocalModelId() < candidates[j].GetLocalModelId()
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

func selectRunnableLocalModel(models []*runtimev1.LocalModelRecord, selector localModelSelector) (*runtimev1.LocalModelRecord, runtimev1.ReasonCode, string) {
	if explicitReason := unsupportedExplicitLocalEngineReason(selector); explicitReason != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		return nil, explicitReason, ""
	}
	expectedModelID := normalizeComparableModelID(selector.modelID)
	candidates := make([]*runtimev1.LocalModelRecord, 0, len(models))
	for _, model := range models {
		if model == nil {
			continue
		}
		if model.GetStatus() == runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_REMOVED {
			continue
		}
		if normalizeComparableModelID(model.GetModelId()) != expectedModelID {
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
		if selected := firstRunnableLocalModel(engineCandidates); selected != nil {
			return selected, runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, ""
		}
		return nil, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, unavailableLocalModelDetail(engineCandidates)
	}

	if selector.preferLocal {
		for _, engine := range localPreferredEngines(selector.modal) {
			if selected := firstRunnableLocalModel(filterLocalModelsByEngine(candidates, engine)); selected != nil {
				return selected, runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, ""
			}
		}
		return nil, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, unavailableLocalModelDetail(candidates)
	}

	if selected := firstRunnableLocalModel(candidates); selected != nil {
		return selected, runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, ""
	}
	return nil, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, unavailableLocalModelDetail(candidates)
}

func firstRunnableLocalModel(models []*runtimev1.LocalModelRecord) *runtimev1.LocalModelRecord {
	for _, candidate := range models {
		if candidate == nil {
			continue
		}
		switch candidate.GetStatus() {
		case runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE,
			runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNSPECIFIED:
			return candidate
		}
	}
	for _, candidate := range models {
		if candidate != nil && candidate.GetStatus() == runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_INSTALLED {
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

func filterLocalModelsByEngine(models []*runtimev1.LocalModelRecord, engine string) []*runtimev1.LocalModelRecord {
	normalizedEngine := strings.TrimSpace(engine)
	filtered := make([]*runtimev1.LocalModelRecord, 0, len(models))
	for _, model := range models {
		if strings.EqualFold(strings.TrimSpace(model.GetEngine()), normalizedEngine) {
			filtered = append(filtered, model)
		}
	}
	return filtered
}

func firstActiveLocalModel(models []*runtimev1.LocalModelRecord) *runtimev1.LocalModelRecord {
	active := make([]*runtimev1.LocalModelRecord, 0, len(models))
	for _, model := range models {
		switch model.GetStatus() {
		case runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE,
			runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNSPECIFIED:
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
		return active[i].GetLocalModelId() < active[j].GetLocalModelId()
	})
	return active[0]
}

func unavailableLocalModelDetail(models []*runtimev1.LocalModelRecord) string {
	if len(models) == 0 {
		return ""
	}
	sorted := append([]*runtimev1.LocalModelRecord(nil), models...)
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
		return sorted[i].GetLocalModelId() < sorted[j].GetLocalModelId()
	})
	selected := sorted[0]
	if detail := strings.TrimSpace(selected.GetHealthDetail()); detail != "" {
		return detail
	}
	return fmt.Sprintf("local model %q is %s", strings.TrimSpace(selected.GetModelId()), localModelStatusLabel(selected.GetStatus()))
}

func localUnavailableStatusPriority(status runtimev1.LocalModelStatus) int {
	switch status {
	case runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNHEALTHY:
		return 0
	case runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_INSTALLED:
		return 1
	case runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE:
		return 2
	default:
		return 3
	}
}

func localModelStatusLabel(status runtimev1.LocalModelStatus) string {
	switch status {
	case runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE:
		return "active"
	case runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_INSTALLED:
		return "installed"
	case runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNHEALTHY:
		return "unhealthy"
	case runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_REMOVED:
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

func modelRequiresInvokeProfile(model *runtimev1.LocalModelRecord) bool {
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
