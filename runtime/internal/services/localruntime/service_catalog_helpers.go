package localruntime

import (
	"fmt"
	"strings"

	"google.golang.org/protobuf/types/known/structpb"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func matchesCatalogSearch(item *runtimev1.LocalCatalogModelDescriptor, query string, capability string) bool {
	if item == nil {
		return false
	}
	if capability != "" {
		matched := false
		for _, cap := range item.GetCapabilities() {
			if strings.EqualFold(strings.TrimSpace(cap), capability) {
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
	normalizedCapability := strings.ToLower(strings.TrimSpace(capability))
	switch normalizedProvider {
	case "nexa":
		return "nexa_native_adapter"
	case "localai":
		switch normalizedCapability {
		case "image", "video", "tts", "speech", "stt", "transcription":
			return "localai_native_adapter"
		default:
			return "openai_compat_adapter"
		}
	default:
		return "openai_compat_adapter"
	}
}

func apiPathForProviderCapability(provider string, capability string) string {
	cap := strings.ToLower(strings.TrimSpace(capability))
	switch cap {
	case "embedding", "embed":
		return "/v1/embeddings"
	case "image":
		return "/v1/images/generations"
	case "video":
		if strings.EqualFold(strings.TrimSpace(provider), "nexa") {
			return "/v1/video/generations"
		}
		return "/v1/videos/generations"
	case "tts", "speech":
		return "/v1/audio/speech"
	case "stt", "transcription":
		return "/v1/audio/transcriptions"
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
	switch normalizedProvider {
	case "localai":
		localAI := &runtimev1.LocalProviderHintsLocalAi{
			Backend:          "localai",
			PreferredAdapter: strings.TrimSpace(adapter),
		}
		switch normalizedCapability {
		case "stt", "transcription":
			localAI.WhisperVariant = "whisper-large-v3"
		case "image":
			localAI.StablediffusionPipeline = "default"
		case "video":
			localAI.VideoBackend = "openai_compat"
		}
		hints.Localai = localAI
	case "nexa":
		npuProfile := &runtimev1.LocalNpuProfile{}
		if deviceProfile != nil && deviceProfile.GetNpu() != nil {
			npuProfile = deviceProfile.GetNpu()
		}
		hostNPUReady := npuProfile.GetReady()
		modelProbeHasNPUCandidate := true
		policyGateAllowsNPU := normalizedPolicyGate == "" && hostNPUReady && modelProbeHasNPUCandidate
		npuUsable := policyGateAllowsNPU && available
		gateReason := ""
		gateDetail := ""
		switch {
		case normalizedPolicyGate != "":
			gateReason = runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED.String()
			gateDetail = "policy gate blocked nexa capability"
		case !hostNPUReady:
			gateReason = "LOCAL_NPU_NOT_READY"
			gateDetail = defaultString(npuProfile.GetDetail(), "host npu profile not ready")
		case !available:
			gateReason = "LOCAL_NODE_UNAVAILABLE"
			gateDetail = "node unavailable"
		}
		hints.Nexa = &runtimev1.LocalProviderHintsNexa{
			Backend:                   "nexa",
			PreferredAdapter:          strings.TrimSpace(adapter),
			PluginId:                  strings.TrimSpace(service.GetServiceId()),
			DeviceId:                  defaultString(strings.TrimSpace(npuProfile.GetVendor()), "host-npu"),
			ModelType:                 normalizedCapability,
			NpuMode:                   defaultString(strings.TrimSpace(hints.GetExtra()["npu_mode"]), "auto"),
			PolicyGate:                normalizedPolicyGate,
			HostNpuReady:              hostNPUReady,
			ModelProbeHasNpuCandidate: modelProbeHasNPUCandidate,
			PolicyGateAllowsNpu:       policyGateAllowsNPU,
			NpuUsable:                 npuUsable,
			GateReason:                gateReason,
			GateDetail:                gateDetail,
		}
	}
	return hints
}

func modelHealth(model *runtimev1.LocalModelRecord) *runtimev1.LocalModelHealth {
	if model == nil {
		return &runtimev1.LocalModelHealth{
			Status: runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNHEALTHY,
			Detail: "model not found",
		}
	}
	detail := model.GetHealthDetail()
	switch model.GetStatus() {
	case runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE:
		if detail == "" {
			detail = "model healthy"
		}
	case runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNHEALTHY:
		if detail == "" {
			detail = "model unhealthy"
		}
	case runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_REMOVED:
		if detail == "" {
			detail = "model removed"
		}
	default:
		if detail == "" {
			detail = "model idle"
		}
	}
	return &runtimev1.LocalModelHealth{
		LocalModelId: model.GetLocalModelId(),
		Status:       model.GetStatus(),
		Detail:       detail,
		Endpoint:     model.GetEndpoint(),
	}
}

func mergeInferencePayload(req *runtimev1.AppendInferenceAuditRequest) *structpb.Struct {
	payload := map[string]any{
		"modId":        strings.TrimSpace(req.GetModId()),
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

func defaultVerifiedModels() []*runtimev1.LocalVerifiedModelDescriptor {
	return []*runtimev1.LocalVerifiedModelDescriptor{
		{
			TemplateId:  "verified.chat.llama3_8b",
			Title:       "Llama 3 8B Instruct",
			Description: "General chat model for local runtime",
			InstallKind: "download",
			ModelId:     "local/llama3.1",
			Repo:        "nimiplatform/llama3.1-8b-instruct",
			Revision:    "main",
			Capabilities: []string{
				"chat",
			},
			Engine:         "localai",
			Entry:          "./dist/index.js",
			Files:          []string{"model.gguf"},
			License:        "llama3",
			Hashes:         map[string]string{},
			Endpoint:       defaultLocalRuntimeEndpoint,
			FileCount:      1,
			TotalSizeBytes: 0,
			Tags:           []string{"chat", "verified"},
		},
		{
			TemplateId:  "verified.stt.whisper",
			Title:       "Whisper STT",
			Description: "Speech to text local model",
			InstallKind: "download",
			ModelId:     "local/whisper-large-v3",
			Repo:        "nimiplatform/whisper-large-v3",
			Revision:    "main",
			Capabilities: []string{
				"stt",
			},
			Engine:         "localai",
			Entry:          "./dist/index.js",
			Files:          []string{"model.bin"},
			License:        "mit",
			Hashes:         map[string]string{},
			Endpoint:       defaultLocalRuntimeEndpoint,
			FileCount:      1,
			TotalSizeBytes: 0,
			Tags:           []string{"stt", "verified"},
		},
	}
}

func defaultCatalogFromVerified(verified []*runtimev1.LocalVerifiedModelDescriptor) []*runtimev1.LocalCatalogModelDescriptor {
	items := make([]*runtimev1.LocalCatalogModelDescriptor, 0, len(verified))
	for _, item := range verified {
		items = append(items, &runtimev1.LocalCatalogModelDescriptor{
			ItemId:            "catalog_" + slug(item.GetTemplateId()),
			Source:            "verified",
			Title:             item.GetTitle(),
			Description:       item.GetDescription(),
			ModelId:           item.GetModelId(),
			Repo:              item.GetRepo(),
			Revision:          item.GetRevision(),
			TemplateId:        item.GetTemplateId(),
			Capabilities:      append([]string(nil), item.GetCapabilities()...),
			Engine:            item.GetEngine(),
			EngineRuntimeMode: runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_ATTACHED_ENDPOINT,
			InstallKind:       item.GetInstallKind(),
			InstallAvailable:  true,
			Endpoint:          item.GetEndpoint(),
			Entry:             item.GetEntry(),
			Files:             append([]string(nil), item.GetFiles()...),
			License:           item.GetLicense(),
			Hashes:            cloneStringMap(item.GetHashes()),
			Tags:              append([]string(nil), item.GetTags()...),
			Verified:          true,
		})
	}
	return items
}
