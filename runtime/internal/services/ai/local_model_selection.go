package ai

import (
	"fmt"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localrouting"
)

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
