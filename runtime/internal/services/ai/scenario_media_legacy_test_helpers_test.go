package ai

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aicapabilities"
	catalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
)

// These aliases retain existing test vocabulary while provider capability and
// dialect truth is asserted against the production Driver registry.
const (
	adapterOpenAICompat       = capabilitydriver.CloudMediaAdapterOpenAICompat
	adapterBytedanceARKTask   = capabilitydriver.CloudMediaAdapterBytedanceARKTask
	adapterAlibabaNative      = capabilitydriver.CloudMediaAdapterAlibabaNative
	adapterGeminiOperation    = capabilitydriver.CloudMediaAdapterGeminiOperation
	adapterDashScopeChatSTT   = capabilitydriver.CloudMediaAdapterDashScopeChatSTT
	adapterGeminiChatSTT      = capabilitydriver.CloudMediaAdapterGeminiChatSTT
	adapterMiniMaxTask        = capabilitydriver.CloudMediaAdapterMiniMaxTask
	adapterGLMTask            = capabilitydriver.CloudMediaAdapterGLMTask
	adapterGLMNative          = capabilitydriver.CloudMediaAdapterGLMNative
	adapterKlingTask          = capabilitydriver.CloudMediaAdapterKlingTask
	adapterLumaTask           = capabilitydriver.CloudMediaAdapterLumaTask
	adapterPikaTask           = capabilitydriver.CloudMediaAdapterPikaTask
	adapterRunwayTask         = capabilitydriver.CloudMediaAdapterRunwayTask
	adapterGoogleVeoOperation = capabilitydriver.CloudMediaAdapterGoogleVeoOperation
	adapterStabilityMusic     = capabilitydriver.CloudMediaAdapterStabilityMusic
	adapterSoundverseMusic    = capabilitydriver.CloudMediaAdapterSoundverseMusic
	adapterMubertMusic        = capabilitydriver.CloudMediaAdapterMubertMusic
	adapterLoudlyMusic        = capabilitydriver.CloudMediaAdapterLoudlyMusic
	adapterWorldLabsNative    = capabilitydriver.CloudMediaAdapterWorldLabsNative
)

func findProbeModelID(models []nimillm.ProbeModel, targetModelID string) (string, bool) {
	target := strings.TrimSpace(targetModelID)
	if target == "" || target != targetModelID {
		return "", false
	}
	for _, model := range models {
		if id := strings.TrimSpace(model.ModelID); id == target && id == model.ModelID {
			return id, true
		}
	}
	return "", false
}

func resolveConnectorTTSModelID(models []nimillm.ProbeModel, targetModelID string, providerType string, voiceCatalog *catalog.Resolver) (string, bool) {
	if resolved, ok := findProbeModelID(models, targetModelID); ok {
		return resolved, true
	}
	target := strings.TrimSpace(targetModelID)
	if target == "" || voiceCatalog == nil {
		return "", false
	}
	if _, err := voiceCatalog.ResolveModelEntry(strings.TrimSpace(providerType), target); err == nil {
		return target, true
	}
	return "", false
}

func supportsTTSCapability(capabilities []string) bool {
	for _, capability := range capabilities {
		normalized, err := aicapabilities.NormalizeCatalogCapability(capability)
		if err == nil && normalized == aicapabilities.AudioSynthesize {
			return true
		}
	}
	return false
}

func resolveMediaAdapterName(_ string, _ string, modal runtimev1.Modal, providerType string) string {
	capability := ""
	switch modal {
	case runtimev1.Modal_MODAL_IMAGE:
		capability = "image.generate"
	case runtimev1.Modal_MODAL_VIDEO:
		capability = "video.generate"
	case runtimev1.Modal_MODAL_TTS:
		capability = "audio.synthesize"
	case runtimev1.Modal_MODAL_STT:
		capability = "audio.transcribe"
	case runtimev1.Modal_MODAL_MUSIC:
		capability = "music.generate"
	case runtimev1.Modal_MODAL_WORLD:
		capability = "world.generate"
	}
	return capabilitydriver.ResolveCloudMediaAdapter(providerType, capability)
}

func stringSliceToAny(values []string) []any {
	output := make([]any, 0, len(values))
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			output = append(output, trimmed)
		}
	}
	if len(output) == 0 {
		return nil
	}
	return output
}

func (s *Service) resolveConfiguredProbeAdapterConfig(configKey string) nimillm.MediaAdapterConfig {
	allowLoopback := s != nil && s.allowLoopback
	creds := s.config.CloudProviders[configKey]
	return nimillm.MediaAdapterConfig{
		BaseURL: creds.BaseURL, APIKey: creds.APIKey, Headers: creds.Headers, AllowLoopbackEndpoint: allowLoopback,
	}
}
