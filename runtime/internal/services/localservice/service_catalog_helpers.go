package localservice

import (
	"fmt"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/localrouting"
	"google.golang.org/protobuf/types/known/structpb"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func matchesCatalogSearch(item *runtimev1.LocalCatalogModelDescriptor, query string, capability string) bool {
	if item == nil {
		return false
	}
	if capability != "" {
		normalizedCapability := normalizeLocalCapabilityToken(capability)
		matched := false
		for _, cap := range item.GetCapabilities() {
			if normalizeLocalCapabilityToken(cap) == normalizedCapability {
				matched = true
				break
			}
		}
		if !matched {
			return false
		}
	}
	if query == "" {
		return true
	}
	fields := []string{
		item.GetItemId(),
		item.GetTitle(),
		item.GetDescription(),
		item.GetModelId(),
		item.GetRepo(),
		item.GetTemplateId(),
	}
	for _, field := range fields {
		if strings.Contains(strings.ToLower(field), query) {
			return true
		}
	}
	return false
}

func adapterForProviderCapability(provider string, capability string) string {
	normalizedProvider := strings.ToLower(strings.TrimSpace(provider))
	normalizedCapability := localrouting.NormalizeCapability(capability)
	switch normalizedProvider {
	case "sidecar":
		switch normalizedCapability {
		case "music.generate":
			return "sidecar_music_adapter"
		default:
			return "openai_compat_adapter"
		}
	case "media":
		switch normalizedCapability {
		case "image.generate", "image.edit", "video.generate", "i2v":
			return "media_native_adapter"
		default:
			return "openai_compat_adapter"
		}
	case "speech":
		switch normalizedCapability {
		case "audio.transcribe", "audio.synthesize", "voice_workflow.voice_clone", "voice_workflow.voice_design":
			return "speech_native_adapter"
		default:
			return "openai_compat_adapter"
		}
	case "llama":
		return ""
	default:
		return "openai_compat_adapter"
	}
}

func apiPathForProviderCapability(provider string, capability string) string {
	normalizedProvider := strings.ToLower(strings.TrimSpace(provider))
	if normalizedProvider == "llama" {
		return ""
	}
	cap := localrouting.NormalizeCapability(capability)
	switch cap {
	case "text.embed":
		return "/v1/embeddings"
	case "image.generate":
		if normalizedProvider == "media" {
			return "/v1/media/image/generate"
		}
		return "/v1/images/generations"
	case "music.generate":
		return "/v1/music/generate"
	case "video.generate":
		if normalizedProvider == "media" {
			return "/v1/media/video/generate"
		}
		return "/v1/videos/generations"
	case "audio.synthesize":
		return "/v1/audio/speech"
	case "audio.transcribe":
		return "/v1/audio/transcriptions"
	case "voice_workflow.voice_clone":
		return "/v1/voice/clone"
	case "voice_workflow.voice_design":
		return "/v1/voice/design"
	default:
		return "/v1/chat/completions"
	}
}

func buildNodeProviderHints(
	service *runtimev1.LocalServiceDescriptor,
	provider string,
	capability string,
	adapter string,
	policyGate string,
	available bool,
	deviceProfile *runtimev1.LocalDeviceProfile,
) *runtimev1.LocalProviderHints {
	normalizedProvider := strings.ToLower(strings.TrimSpace(provider))
	normalizedCapability := strings.ToLower(strings.TrimSpace(capability))
	if normalizedProvider == "llama" {
		return nil
	}
	normalizedPolicyGate := strings.TrimSpace(policyGate)
	hints := &runtimev1.LocalProviderHints{
		Extra: map[string]string{
			"provider":     normalizedProvider,
			"capability":   normalizedCapability,
			"service_id":   strings.TrimSpace(service.GetServiceId()),
			"endpoint":     strings.TrimSpace(service.GetEndpoint()),
			"policy_gate":  normalizedPolicyGate,
			"adapter":      strings.TrimSpace(adapter),
			"availability": fmt.Sprintf("%t", available),
		},
	}
	hints.Extra["local_default_rank"] = fmt.Sprintf(
		"%d",
		localProviderPreferenceRank(localRuntimeGOOSFromProfile(deviceProfile.GetOs()), normalizedCapability, normalizedProvider),
	)
	if supportClass, supportDetail := classifyManagedEngineSupportForAsset(
		service.GetEngine(),
		[]string{capability},
		runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_UNSPECIFIED,
		deviceProfile,
	); supportClass != "" {
		hints.Extra["runtime_support_class"] = supportClass
		if strings.TrimSpace(supportDetail) != "" {
			hints.Extra["runtime_support_detail"] = strings.TrimSpace(supportDetail)
		}
	}
	switch normalizedProvider {
	case "media":
		hints.Media = &runtimev1.LocalProviderHintsMedia{
			Backend:          normalizedProvider,
			PreferredAdapter: strings.TrimSpace(adapter),
			Family:           strings.TrimSpace(hints.GetExtra()["family"]),
			ImageDriver:      strings.TrimSpace(hints.GetExtra()["image_driver"]),
			VideoDriver:      strings.TrimSpace(hints.GetExtra()["video_driver"]),
			Device:           strings.TrimSpace(hints.GetExtra()["device"]),
		}
	case "speech":
		hints.Speech = &runtimev1.LocalProviderHintsSpeech{
			Backend:             normalizedProvider,
			PreferredAdapter:    strings.TrimSpace(adapter),
			Family:              strings.TrimSpace(hints.GetExtra()["family"]),
			Driver:              strings.TrimSpace(hints.GetExtra()["driver"]),
			Device:              strings.TrimSpace(hints.GetExtra()["device"]),
			VoiceWorkflowDriver: strings.TrimSpace(hints.GetExtra()["voice_workflow_driver"]),
			PolicyGate:          normalizedPolicyGate,
		}
	case "sidecar":
		hints.Sidecar = &runtimev1.LocalProviderHintsSidecar{
			PreferredAdapter: strings.TrimSpace(adapter),
			Backend:          "sidecar",
		}
	}
	return hints
}

func modelHealth(model *runtimev1.LocalAssetRecord) *runtimev1.LocalAssetHealth {
	if model == nil {
		return &runtimev1.LocalAssetHealth{
			Status: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY,
			Detail: "model not found",
		}
	}
	detail := model.GetHealthDetail()
	switch model.GetStatus() {
	case runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE:
		if detail == "" {
			switch model.GetWarmState() {
			case runtimev1.LocalWarmState_LOCAL_WARM_STATE_READY:
				detail = "model healthy"
			case runtimev1.LocalWarmState_LOCAL_WARM_STATE_WARMING:
				detail = "model warming"
			case runtimev1.LocalWarmState_LOCAL_WARM_STATE_FAILED:
				detail = "model warm failed"
			default:
				detail = "model cold"
			}
		}
	case runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY:
		if detail == "" {
			detail = "model unhealthy"
		}
	case runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_REMOVED:
		if detail == "" {
			detail = "model removed"
		}
	default:
		if detail == "" {
			detail = "model idle"
		}
	}
	reason := model.GetReasonCode()
	if reason == runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		reason = projectionReasonCodeForEngine(model.GetEngine(), detail)
	}
	return &runtimev1.LocalAssetHealth{
		LocalAssetId: model.GetLocalAssetId(),
		Status:       model.GetStatus(),
		Detail:       detail,
		Endpoint:     "",
		ReasonCode:   reason,
	}
}

func mergeInferencePayload(req *runtimev1.AppendInferenceAuditRequest) *structpb.Struct {
	payload := map[string]any{
		"targetId":     strings.TrimSpace(req.GetTargetId()),
		"source":       strings.TrimSpace(req.GetSource()),
		"provider":     strings.TrimSpace(req.GetProvider()),
		"modality":     strings.TrimSpace(req.GetModality()),
		"adapter":      strings.TrimSpace(req.GetAdapter()),
		"model":        strings.TrimSpace(req.GetModel()),
		"localModelId": strings.TrimSpace(req.GetLocalModelId()),
		"endpoint":     strings.TrimSpace(req.GetEndpoint()),
		"reasonCode":   strings.TrimSpace(req.GetReasonCode()),
		"detail":       strings.TrimSpace(req.GetDetail()),
	}
	if policy := structToMap(req.GetPolicyGate()); len(policy) > 0 {
		payload["policyGate"] = policy
	}
	if extra := structToMap(req.GetExtra()); len(extra) > 0 {
		payload["extra"] = extra
	}
	return toStruct(payload)
}

func defaultCatalogFromVerified(verified []*runtimev1.LocalVerifiedAssetDescriptor) []*runtimev1.LocalCatalogModelDescriptor {
	items := make([]*runtimev1.LocalCatalogModelDescriptor, 0, len(verified))
	deviceProfile := collectDeviceProfile()
	for _, item := range verified {
		binding := autoRecommendedRuntimeBinding(
			item.GetEngine(),
			item.GetCapabilities(),
			item.GetKind(),
			deviceProfile,
		)
		items = append(items, &runtimev1.LocalCatalogModelDescriptor{
			ItemId:            "catalog_" + slug(item.GetTemplateId()),
			Source:            "verified",
			Title:             item.GetTitle(),
			Description:       item.GetDescription(),
			ModelId:           item.GetAssetId(),
			Repo:              item.GetRepo(),
			Revision:          item.GetRevision(),
			TemplateId:        item.GetTemplateId(),
			Capabilities:      append([]string(nil), item.GetCapabilities()...),
			Engine:            item.GetEngine(),
			EngineRuntimeMode: binding.mode,
			InstallKind:       item.GetInstallKind(),
			InstallAvailable:  catalogBindingInstallAvailableForVerifiedAsset(item, binding, deviceProfile),
			Endpoint:          binding.endpoint,
			Entry:             item.GetEntry(),
			Files:             append([]string(nil), item.GetFiles()...),
			License:           item.GetLicense(),
			Hashes:            cloneStringMap(item.GetHashes()),
			Tags:              append([]string(nil), item.GetTags()...),
			Verified:          true,
			EngineConfig:      cloneStruct(item.GetEngineConfig()),
		})
	}
	return items
}
