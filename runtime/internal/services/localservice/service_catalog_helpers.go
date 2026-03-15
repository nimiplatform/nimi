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
	normalizedCapability := localrouting.NormalizeCapability(capability)
	switch normalizedProvider {
	case "sidecar":
		switch normalizedCapability {
		case "music.generate":
			return "sidecar_music_adapter"
		default:
			return "openai_compat_adapter"
		}
	case "nexa":
		switch normalizedCapability {
		case "text.generate", "text.embed", "audio.synthesize", "audio.transcribe":
			return "nexa_native_adapter"
		default:
			return "openai_compat_adapter"
		}
	case "nimi_media":
		switch normalizedCapability {
		case "image.generate", "video.generate":
			return "nimi_media_native_adapter"
		default:
			return "openai_compat_adapter"
		}
	case "localai":
		switch normalizedCapability {
		case "music.generate":
			return "localai_music_adapter"
		case "image.generate", "video.generate", "audio.synthesize", "audio.transcribe", "vision", "multimodal", "audio_chat", "video_chat", "text.generate.vision", "text.generate.audio", "text.generate.video":
			return "localai_native_adapter"
		default:
			return "openai_compat_adapter"
		}
	default:
		return "openai_compat_adapter"
	}
}

func apiPathForProviderCapability(provider string, capability string) string {
	normalizedProvider := strings.ToLower(strings.TrimSpace(provider))
	cap := strings.ToLower(strings.TrimSpace(capability))
	switch cap {
	case "embedding", "embed":
		return "/v1/embeddings"
	case "image":
		if normalizedProvider == "nimi_media" {
			return "/v1/media/image/generate"
		}
		return "/v1/images/generations"
	case "music", "music.generate":
		if normalizedProvider == "localai" {
			return "/v1/audio/speech"
		}
		return "/v1/music/generate"
	case "video":
		if normalizedProvider == "nimi_media" {
			return "/v1/media/video/generate"
		}
		if normalizedProvider == "nexa" {
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
	hints.Extra["local_default_rank"] = fmt.Sprintf(
		"%d",
		localProviderPreferenceRank(localRuntimeGOOSFromProfile(deviceProfile.GetOs()), normalizedCapability, normalizedProvider),
	)
	if supportClass, supportDetail := classifyManagedEngineSupport(service.GetEngine(), deviceProfile); supportClass != "" {
		hints.Extra["runtime_support_class"] = supportClass
		if strings.TrimSpace(supportDetail) != "" {
			hints.Extra["runtime_support_detail"] = strings.TrimSpace(supportDetail)
		}
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
		case "video", "vision", "multimodal", "audio_chat", "video_chat", "text.generate.vision", "text.generate.audio", "text.generate.video":
			localAI.VideoBackend = "openai_compat"
		}
		hints.Localai = localAI
	case "nexa":
		npuProfile := &runtimev1.LocalNpuProfile{}
		if deviceProfile != nil && deviceProfile.GetNpu() != nil {
			npuProfile = deviceProfile.GetNpu()
		}
		hostNPUReady := npuProfile.GetReady()
		modelProbeHasNPUCandidate := false
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
			NpuMode:                   strings.TrimSpace(hints.GetExtra()["npu_mode"]),
			PolicyGate:                normalizedPolicyGate,
			HostNpuReady:              hostNPUReady,
			ModelProbeHasNpuCandidate: modelProbeHasNPUCandidate,
			PolicyGateAllowsNpu:       policyGateAllowsNPU,
			NpuUsable:                 npuUsable,
			GateReason:                gateReason,
			GateDetail:                gateDetail,
		}
	case "nimi_media":
		hints.NimiMedia = &runtimev1.LocalProviderHintsNimiMedia{
			Backend:          "diffusers",
			PreferredAdapter: strings.TrimSpace(adapter),
			Family:           strings.TrimSpace(hints.GetExtra()["family"]),
			ImageDriver:      strings.TrimSpace(hints.GetExtra()["image_driver"]),
			VideoDriver:      strings.TrimSpace(hints.GetExtra()["video_driver"]),
			Device:           strings.TrimSpace(hints.GetExtra()["device"]),
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
	zImageDefaults, _ := structpb.NewStruct(map[string]any{
		"backend":   "stablediffusion-ggml",
		"cfg_scale": 1,
		"step":      25,
		"options": []any{
			"diffusion_model",
			"offload_params_to_cpu:true",
		},
	})
	chatEngine := defaultLocalEngine("", []string{"chat"})
	sttEngine := defaultLocalEngine("", []string{"stt"})
	imageEngine := defaultLocalEngine("", []string{"image"})
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
			Engine:         chatEngine,
			Entry:          "./dist/index.js",
			Files:          []string{"model.gguf"},
			License:        "llama3",
			Hashes:         map[string]string{},
			Endpoint:       "",
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
			Engine:         sttEngine,
			Entry:          "./dist/index.js",
			Files:          []string{"model.bin"},
			License:        "mit",
			Hashes:         map[string]string{},
			Endpoint:       "",
			FileCount:      1,
			TotalSizeBytes: 0,
			Tags:           []string{"stt", "verified"},
		},
		{
			TemplateId:   "verified.image.z_image_turbo",
			Title:        "Z-Image Turbo (GGUF)",
			Description:  "Recommended verified LocalAI image main model for dynamic workflow assembly",
			InstallKind:  "download",
			ModelId:      "local/z_image_turbo",
			Repo:         "jayn7/Z-Image-Turbo-GGUF",
			Revision:     "main",
			Capabilities: []string{"image"},
			Engine:       imageEngine,
			Entry:        "z_image_turbo-Q4_K_M.gguf",
			Files:        []string{"z_image_turbo-Q4_K_M.gguf"},
			License:      "apache-2.0",
			Hashes: map[string]string{
				"z_image_turbo-Q4_K_M.gguf": "sha256:745ec270db042409fde084d6b5cfccabf214a7fe5a494edf994a391125656afd",
			},
			Endpoint:       "",
			FileCount:      1,
			TotalSizeBytes: 4981532736,
			Tags:           []string{"image", "verified", "recommended", "z-image"},
			EngineConfig:   zImageDefaults,
		},
	}
}

func defaultVerifiedArtifacts() []*runtimev1.LocalVerifiedArtifactDescriptor {
	vaeMeta, _ := structpb.NewStruct(map[string]any{
		"family": "z-image",
		"format": "safetensors",
	})
	llmMeta, _ := structpb.NewStruct(map[string]any{
		"family": "z-image",
		"format": "gguf",
	})
	return []*runtimev1.LocalVerifiedArtifactDescriptor{
		{
			TemplateId:     "verified.artifact.z_image.vae",
			Title:          "Z-Image AE VAE",
			Description:    "Recommended verified companion VAE for LocalAI Z-Image workflows",
			ArtifactId:     "local/z_image_ae",
			Kind:           runtimev1.LocalArtifactKind_LOCAL_ARTIFACT_KIND_VAE,
			Engine:         "localai",
			Entry:          "vae/diffusion_pytorch_model.safetensors",
			Files:          []string{"vae/diffusion_pytorch_model.safetensors"},
			License:        "tongyi",
			Repo:           "Tongyi-MAI/Z-Image-Turbo",
			Revision:       "main",
			Hashes:         map[string]string{},
			FileCount:      1,
			TotalSizeBytes: 0,
			Tags:           []string{"image", "verified", "recommended", "z-image", "vae"},
			Metadata:       vaeMeta,
		},
		{
			TemplateId:     "verified.artifact.z_image.qwen3_4b",
			Title:          "Qwen3 4B Companion LLM",
			Description:    "Recommended verified companion LLM for LocalAI Z-Image workflows",
			ArtifactId:     "local/qwen3_4b_companion",
			Kind:           runtimev1.LocalArtifactKind_LOCAL_ARTIFACT_KIND_LLM,
			Engine:         "localai",
			Entry:          "Qwen3-4B-Q4_K_M.gguf",
			Files:          []string{"Qwen3-4B-Q4_K_M.gguf"},
			License:        "qwen",
			Repo:           "Qwen/Qwen3-4B-GGUF",
			Revision:       "main",
			Hashes:         map[string]string{},
			FileCount:      1,
			TotalSizeBytes: 0,
			Tags:           []string{"image", "verified", "recommended", "z-image", "llm"},
			Metadata:       llmMeta,
		},
	}
}

func defaultCatalogFromVerified(verified []*runtimev1.LocalVerifiedModelDescriptor) []*runtimev1.LocalCatalogModelDescriptor {
	items := make([]*runtimev1.LocalCatalogModelDescriptor, 0, len(verified))
	deviceProfile := collectDeviceProfile()
	for _, item := range verified {
		binding := autoRecommendedRuntimeBinding(item.GetEngine(), deviceProfile)
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
			EngineRuntimeMode: binding.mode,
			InstallKind:       item.GetInstallKind(),
			InstallAvailable:  catalogBindingInstallAvailable(item.GetEngine(), binding, deviceProfile),
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
