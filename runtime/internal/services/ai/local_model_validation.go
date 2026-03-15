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
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/texttarget"
)

type localModelLister interface {
	ListLocalModels(context.Context, *runtimev1.ListLocalModelsRequest) (*runtimev1.ListLocalModelsResponse, error)
}

type localImageProfileResolver interface {
	ResolveLocalAIImageProfile(context.Context, string, map[string]any) (string, map[string]any, map[string]any, error)
	ResolveLocalAIArtifactPath(context.Context, string) (string, error)
}

type localModelSelector struct {
	modelID        string
	explicitEngine string
	preferLocalAI  bool
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
	if modelRequiresInvokeProfile(selected) {
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_PROFILE_MISSING)
	}
	return nil
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
	case strings.HasPrefix(lower, "localai/"):
		selector.explicitEngine = "localai"
		selector.modelID = strings.TrimSpace(raw[len("localai/"):])
	case strings.HasPrefix(lower, "nexa/"):
		selector.explicitEngine = "nexa"
		selector.modelID = strings.TrimSpace(raw[len("nexa/"):])
	case strings.HasPrefix(lower, "nimi_media/"):
		selector.explicitEngine = "nimi_media"
		selector.modelID = strings.TrimSpace(raw[len("nimi_media/"):])
	case strings.HasPrefix(lower, "sidecar/"):
		selector.explicitEngine = "sidecar"
		selector.modelID = strings.TrimSpace(raw[len("sidecar/"):])
	case strings.HasPrefix(lower, "localsidecar/"):
		selector.explicitEngine = "sidecar"
		selector.modelID = strings.TrimSpace(raw[len("localsidecar/"):])
	case strings.HasPrefix(lower, "local/"):
		selector.preferLocalAI = true
		selector.modelID = strings.TrimSpace(raw[len("local/"):])
	default:
		selector.modelID = raw
	}
	return selector
}

func selectActiveLocalModel(models []*runtimev1.LocalModelRecord, selector localModelSelector) (*runtimev1.LocalModelRecord, runtimev1.ReasonCode) {
	candidates := make([]*runtimev1.LocalModelRecord, 0, len(models))
	for _, model := range models {
		if !strings.EqualFold(strings.TrimSpace(model.GetModelId()), selector.modelID) {
			continue
		}
		candidates = append(candidates, model)
	}
	if len(candidates) == 0 {
		return nil, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE
	}

	sort.Slice(candidates, func(i, j int) bool {
		pi := localEnginePriority(candidates[i].GetEngine())
		pj := localEnginePriority(candidates[j].GetEngine())
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

	if selector.preferLocalAI {
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
	candidates := make([]*runtimev1.LocalModelRecord, 0, len(models))
	for _, model := range models {
		if model == nil {
			continue
		}
		if model.GetStatus() == runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_REMOVED {
			continue
		}
		if !strings.EqualFold(strings.TrimSpace(model.GetModelId()), selector.modelID) {
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
		if selected := firstActiveLocalModel(engineCandidates); selected != nil {
			return selected, runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, ""
		}
		return nil, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, unavailableLocalModelDetail(engineCandidates)
	}

	if selector.preferLocalAI {
		for _, engine := range localPreferredEngines(selector.modal) {
			if selected := firstActiveLocalModel(filterLocalModelsByEngine(candidates, engine)); selected != nil {
				return selected, runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, ""
			}
		}
		return nil, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, unavailableLocalModelDetail(candidates)
	}

	if selected := firstActiveLocalModel(candidates); selected != nil {
		return selected, runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, ""
	}
	return nil, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, unavailableLocalModelDetail(candidates)
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
		pi := localEnginePriority(active[i].GetEngine())
		pj := localEnginePriority(active[j].GetEngine())
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
		pi := localEnginePriority(sorted[i].GetEngine())
		pj := localEnginePriority(sorted[j].GetEngine())
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
	switch strings.ToLower(strings.TrimSpace(engine)) {
	case "localai":
		return 0
	case "sidecar":
		return 1
	case "nexa":
		return 2
	case "nimi_media":
		return 3
	default:
		return 4
	}
}

func localPreferredEngines(modal runtimev1.Modal) []string {
	if localModelValidationGOOS == "windows" {
		switch modal {
		case runtimev1.Modal_MODAL_IMAGE, runtimev1.Modal_MODAL_VIDEO:
			return []string{"nimi_media", "localai", "nexa", "sidecar"}
		case runtimev1.Modal_MODAL_TTS, runtimev1.Modal_MODAL_STT:
			return []string{"nexa", "localai", "sidecar", "nimi_media"}
		case runtimev1.Modal_MODAL_MUSIC:
			return []string{"sidecar", "localai", "nexa", "nimi_media"}
		default:
			return []string{"localai", "sidecar", "nexa", "nimi_media"}
		}
	}
	switch modal {
	case runtimev1.Modal_MODAL_IMAGE, runtimev1.Modal_MODAL_VIDEO:
		return []string{"localai", "nimi_media", "nexa", "sidecar"}
	case runtimev1.Modal_MODAL_TTS, runtimev1.Modal_MODAL_STT:
		return []string{"localai", "nexa", "sidecar", "nimi_media"}
	case runtimev1.Modal_MODAL_MUSIC:
		return []string{"sidecar", "localai", "nexa", "nimi_media"}
	default:
		return []string{"localai", "sidecar", "nexa", "nimi_media"}
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
