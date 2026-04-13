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
		case "audio.transcribe", "audio.synthesize", "voice_workflow.tts_v2v", "voice_workflow.tts_t2v":
			return "speech_native_adapter"
		default:
			return "openai_compat_adapter"
		}
	case "llama":
		switch normalizedCapability {
		case "chat", "text.generate", "embedding", "embed", "text.embed", "image.understand", "audio.understand", "vision", "multimodal", "audio_chat", "video_chat", "text.generate.vision", "text.generate.audio", "text.generate.video":
			return "llama_native_adapter"
		default:
			return "openai_compat_adapter"
		}
	default:
		return "openai_compat_adapter"
	}
}

func apiPathForProviderCapability(provider string, capability string) string {
	normalizedProvider := strings.ToLower(strings.TrimSpace(provider))
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
	case "llama":
		llama := &runtimev1.LocalProviderHintsLlama{
			Backend:          "llama",
			PreferredAdapter: strings.TrimSpace(adapter),
		}
		hints.Llama = llama
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
	return &runtimev1.LocalAssetHealth{
		LocalAssetId: model.GetLocalAssetId(),
		Status:       model.GetStatus(),
		Detail:       detail,
		Endpoint:     "",
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

func defaultVerifiedAssets() []*runtimev1.LocalVerifiedAssetDescriptor {
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
	runnable := []*runtimev1.LocalVerifiedAssetDescriptor{
		{
			TemplateId:     "verified.chat.llama3_8b",
			Title:          "Llama 3 8B Instruct",
			Description:    "General chat model for local runtime",
			InstallKind:    "download",
			AssetId:        "local/llama3.1",
			LogicalModelId: "nimi/chat-llama3.1-8b",
			Repo:           "nimiplatform/llama3.1-8b-instruct",
			Revision:       "main",
			Capabilities: []string{
				"chat",
			},
			Engine:          chatEngine,
			Entry:           "./dist/index.js",
			Files:           []string{"model.gguf"},
			License:         "llama3",
			Hashes:          map[string]string{},
			Endpoint:        "",
			FileCount:       1,
			TotalSizeBytes:  0,
			Tags:            []string{"chat", "verified"},
			ArtifactRoles:   []string{"llm", "tokenizer"},
			PreferredEngine: "llama",
		},
		{
			TemplateId:     "verified.stt.whisper",
			Title:          "Whisper STT",
			Description:    "Speech to text local model",
			InstallKind:    "download",
			AssetId:        "local/whisper-large-v3",
			LogicalModelId: "nimi/stt-whisper-large-v3",
			Repo:           "nimiplatform/whisper-large-v3",
			Revision:       "main",
			Capabilities: []string{
				"audio.transcribe",
			},
			Engine:          sttEngine,
			Entry:           "./dist/index.js",
			Files:           []string{"model.bin"},
			License:         "mit",
			Hashes:          map[string]string{},
			Endpoint:        "",
			FileCount:       1,
			TotalSizeBytes:  0,
			Tags:            []string{"stt", "verified"},
			ArtifactRoles:   []string{"stt_model"},
			PreferredEngine: "speech",
		},
		{
			TemplateId:      "verified.tts.kokoro",
			Title:           "Kokoro TTS",
			Description:     "Default local speech synthesis model",
			InstallKind:     "download",
			AssetId:         "local/kokoro-tts",
			LogicalModelId:  "nimi/tts-kokoro",
			Repo:            "nimiplatform/kokoro-onnx",
			Revision:        "main",
			Capabilities:    []string{"audio.synthesize"},
			Engine:          "speech",
			Entry:           "model.onnx",
			Files:           []string{"model.onnx", "voices.json"},
			License:         "apache-2.0",
			Hashes:          map[string]string{},
			Endpoint:        "",
			FileCount:       2,
			TotalSizeBytes:  0,
			Tags:            []string{"tts", "verified"},
			ArtifactRoles:   []string{"tts_model", "tokenizer"},
			PreferredEngine: "speech",
		},
		{
			TemplateId:      "verified.voice.qwen3_tts",
			Title:           "Qwen3 TTS Voice Workflow",
			Description:     "Heavy local voice workflow family for synthesize, clone, and design flows",
			InstallKind:     "verified-hf-multi-file",
			AssetId:         "local/qwen3-tts",
			LogicalModelId:  "nimi/voice-qwen3-tts",
			Repo:            "Qwen/Qwen3-TTS-30B-A3B-Instruct",
			Revision:        "main",
			Capabilities:    []string{"audio.synthesize", "voice_workflow.tts_v2v", "voice_workflow.tts_t2v"},
			Engine:          "speech",
			Entry:           "model.safetensors",
			Files:           []string{"model.safetensors", "speech_tokenizer/model.safetensors"},
			License:         "apache-2.0",
			Hashes:          map[string]string{},
			Endpoint:        "",
			FileCount:       2,
			TotalSizeBytes:  0,
			Tags:            []string{"tts", "voice", "verified", "heavy"},
			ArtifactRoles:   []string{"voice_workflow_model", "speech_tokenizer", "tokenizer"},
			PreferredEngine: "speech",
		},
		{
			TemplateId:     "verified.image.z_image_turbo",
			Title:          "Z-Image Turbo (GGUF)",
			Description:    "Recommended verified local image main model for dynamic workflow assembly",
			InstallKind:    "download",
			AssetId:        "local/z_image_turbo",
			LogicalModelId: "nimi/image-z-image-turbo",
			Repo:           "leejet/Z-Image-Turbo-GGUF",
			Revision:       "main",
			Capabilities:   []string{"image.generate"},
			Engine:         imageEngine,
			Entry:          "z_image_turbo-Q4_K.gguf",
			Files:          []string{"z_image_turbo-Q4_K.gguf"},
			License:        "apache-2.0",
			Hashes: map[string]string{
				"z_image_turbo-Q4_K.gguf": "sha256:14b375ab4f226bc5378f68f37e899ef3c2242b8541e61e2bc1aff40976086fbd",
			},
			Endpoint:        "",
			FileCount:       1,
			TotalSizeBytes:  3864250304,
			Tags:            []string{"image", "verified", "recommended", "z-image"},
			ArtifactRoles:   []string{"diffusion_transformer"},
			PreferredEngine: "media",
			EngineConfig:    zImageDefaults,
		},
	}
	return append(runnable, defaultVerifiedPassiveAssets()...)
}

func defaultVerifiedPassiveAssets() []*runtimev1.LocalVerifiedAssetDescriptor {
	vaeMeta, _ := structpb.NewStruct(map[string]any{
		"family": "z-image",
		"format": "safetensors",
	})
	chatEncoderMeta, _ := structpb.NewStruct(map[string]any{
		"family": "z-image",
		"format": "gguf",
	})
	return []*runtimev1.LocalVerifiedAssetDescriptor{
		{
			TemplateId:     "verified.asset.z_image.vae",
			Title:          "Z-Image AE VAE",
			Description:    "Recommended verified VAE for local Z-Image workflows",
			AssetId:        "local/z_image_ae",
			Kind:           runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE,
			Engine:         "llama",
			Entry:          "ae.safetensors",
			Files:          []string{"ae.safetensors"},
			License:        "apache-2.0",
			Repo:           "black-forest-labs/FLUX.1-schnell",
			Revision:       "main",
			Hashes:         map[string]string{},
			FileCount:      1,
			TotalSizeBytes: 0,
			Tags:           []string{"image", "verified", "recommended", "z-image", "vae"},
			Metadata:       vaeMeta,
		},
		{
			TemplateId:     "verified.asset.z_image.qwen3_4b",
			Title:          "Qwen3 4B (text encoder)",
			Description:    "Recommended verified text encoder for local Z-Image workflows",
			AssetId:        "local/qwen3_4b",
			Kind:           runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT,
			Engine:         "llama",
			Entry:          "Qwen3-4B-Q4_K_M.gguf",
			Files:          []string{"Qwen3-4B-Q4_K_M.gguf"},
			License:        "qwen",
			Repo:           "Qwen/Qwen3-4B-GGUF",
			Revision:       "main",
			Hashes:         map[string]string{},
			FileCount:      1,
			TotalSizeBytes: 0,
			Tags:           []string{"image", "verified", "recommended", "z-image", "chat"},
			Metadata:       chatEncoderMeta,
		},
	}
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
