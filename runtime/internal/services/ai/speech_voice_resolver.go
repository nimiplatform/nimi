package ai

import (
	"context"
	"errors"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
)

type speechVoiceCatalogSource string

const (
	speechVoiceSourceProviderLive    speechVoiceCatalogSource = "provider_live"
	speechVoiceSourceCatalogFallback speechVoiceCatalogSource = "catalog_fallback"
)

func resolveSpeechVoiceBackend(
	modelResolved string,
	remoteTarget *nimillm.RemoteTarget,
	selectedProvider provider,
	cloudProvider *nimillm.CloudProvider,
) *nimillm.Backend {
	if cloudProvider != nil {
		if remoteTarget != nil {
			backend, _ := cloudProvider.ResolveMediaBackendWithTarget(modelResolved, remoteTarget)
			if backend != nil {
				return backend
			}
		} else {
			backend, _ := cloudProvider.ResolveMediaBackend(modelResolved)
			if backend != nil {
				return backend
			}
		}
	}

	mediaProvider, ok := selectedProvider.(nimillm.MediaBackendProvider)
	if !ok || mediaProvider == nil {
		return nil
	}
	backend, _ := mediaProvider.ResolveMediaBackend(modelResolved)
	return backend
}

func resolveSpeechVoicesForModel(
	ctx context.Context,
	modelResolved string,
	remoteTarget *nimillm.RemoteTarget,
	backend *nimillm.Backend,
) ([]*runtimev1.SpeechVoiceDescriptor, speechVoiceCatalogSource, error) {
	providerType := ""
	if remoteTarget != nil {
		providerType = strings.TrimSpace(remoteTarget.ProviderType)
	}
	return resolveSpeechVoicesForModelWithProviderType(ctx, modelResolved, providerType, backend)
}

func resolveSpeechVoicesForModelWithProviderType(
	ctx context.Context,
	modelResolved string,
	providerType string,
	backend *nimillm.Backend,
) ([]*runtimev1.SpeechVoiceDescriptor, speechVoiceCatalogSource, error) {
	if backend != nil {
		voices, err := backend.ListSpeechVoices(ctx, modelResolved)
		if err == nil && len(voices) > 0 {
			return voices, speechVoiceSourceProviderLive, nil
		}
		if err != nil && (errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded)) {
			return nil, "", err
		}
	}

	return resolveVoicePresets(modelResolved, providerType), speechVoiceSourceCatalogFallback, nil
}

func isSpeechVoiceSupported(requestedVoice string, voices []*runtimev1.SpeechVoiceDescriptor) bool {
	normalizedRequested := strings.TrimSpace(requestedVoice)
	if normalizedRequested == "" {
		return true
	}
	normalizedRequestedLower := strings.ToLower(normalizedRequested)
	for _, voice := range voices {
		voiceID := strings.TrimSpace(voice.GetVoiceId())
		if voiceID == "" {
			continue
		}
		if voiceID == normalizedRequested || strings.ToLower(voiceID) == normalizedRequestedLower {
			return true
		}
	}
	return false
}

// resolveVoicePresets returns runtime-maintained fallback voice descriptors.
func resolveVoicePresets(modelResolved string, providerType string) []*runtimev1.SpeechVoiceDescriptor {
	lowerProvider := strings.ToLower(strings.TrimSpace(providerType))
	switch lowerProvider {
	case "dashscope":
		return dashScopeVoicePresets()
	case "volcengine", "volcengine_openspeech":
		return volcengineVoicePresets()
	}

	lower := strings.ToLower(strings.TrimSpace(modelResolved))

	switch {
	case strings.HasPrefix(lower, "dashscope/"):
		return dashScopeVoicePresets()
	case strings.Contains(lower, "qwen3-tts"), strings.Contains(lower, "qwen-tts"):
		return dashScopeVoicePresets()
	case strings.HasPrefix(lower, "volcengine/") || strings.HasPrefix(lower, "volcengine_openspeech/"):
		return volcengineVoicePresets()
	default:
		return openAIVoicePresets()
	}
}

func dashScopeVoicePresets() []*runtimev1.SpeechVoiceDescriptor {
	return []*runtimev1.SpeechVoiceDescriptor{
		{VoiceId: "Cherry", Name: "Cherry", Lang: "zh", SupportedLangs: []string{"zh", "en", "ja", "ko"}},
		{VoiceId: "Serena", Name: "Serena", Lang: "zh", SupportedLangs: []string{"zh", "en", "ja", "ko"}},
		{VoiceId: "Ethan", Name: "Ethan", Lang: "en", SupportedLangs: []string{"zh", "en", "ja", "ko"}},
		{VoiceId: "Chelsie", Name: "Chelsie", Lang: "en", SupportedLangs: []string{"zh", "en", "ja", "ko"}},
		{VoiceId: "Aura", Name: "Aura", Lang: "zh", SupportedLangs: []string{"zh", "en", "ja", "ko"}},
		{VoiceId: "Breeze", Name: "Breeze", Lang: "zh", SupportedLangs: []string{"zh", "en"}},
		{VoiceId: "Haruto", Name: "Haruto", Lang: "ja", SupportedLangs: []string{"zh", "en", "ja", "ko"}},
		{VoiceId: "Maple", Name: "Maple", Lang: "zh", SupportedLangs: []string{"zh", "en"}},
		{VoiceId: "Sierra", Name: "Sierra", Lang: "en", SupportedLangs: []string{"zh", "en"}},
		{VoiceId: "River", Name: "River", Lang: "zh", SupportedLangs: []string{"zh", "en", "ja", "ko"}},
	}
}

func volcengineVoicePresets() []*runtimev1.SpeechVoiceDescriptor {
	return []*runtimev1.SpeechVoiceDescriptor{
		{VoiceId: "BV001_streaming", Name: "BV001", Lang: "zh", SupportedLangs: []string{"zh"}},
		{VoiceId: "BV002_streaming", Name: "BV002", Lang: "zh", SupportedLangs: []string{"zh"}},
	}
}

func openAIVoicePresets() []*runtimev1.SpeechVoiceDescriptor {
	return []*runtimev1.SpeechVoiceDescriptor{
		{VoiceId: "alloy", Name: "Alloy", Lang: "en", SupportedLangs: []string{"en", "zh", "ja", "ko", "es", "fr", "de"}},
		{VoiceId: "nova", Name: "Nova", Lang: "en", SupportedLangs: []string{"en", "zh", "ja", "ko", "es", "fr", "de"}},
		{VoiceId: "shimmer", Name: "Shimmer", Lang: "en", SupportedLangs: []string{"en", "zh", "ja", "ko", "es", "fr", "de"}},
	}
}
