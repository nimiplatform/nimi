package ai

import (
	"context"
	"errors"
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/services/ai/catalog"
)

type speechVoiceCatalogSource string

const (
	speechVoiceSourceProviderLive    speechVoiceCatalogSource = "provider_live"
	speechVoiceSourceCatalogBuiltin  speechVoiceCatalogSource = "catalog_builtin_snapshot"
	speechVoiceSourceCatalogCustom   speechVoiceCatalogSource = "catalog_custom_dir"
	speechVoiceSourceCatalogRemote   speechVoiceCatalogSource = "catalog_remote_cache"
)

func mapCatalogSource(source catalog.CatalogSource) speechVoiceCatalogSource {
	switch source {
	case catalog.SourceCustomDir:
		return speechVoiceSourceCatalogCustom
	case catalog.SourceRemoteCache:
		return speechVoiceSourceCatalogRemote
	case catalog.SourceBuiltinSnapshot:
		fallthrough
	default:
		return speechVoiceSourceCatalogBuiltin
	}
}

func shouldUseDashScopeCatalog(providerType string, modelResolved string) bool {
	provider := strings.ToLower(strings.TrimSpace(providerType))
	if provider == "dashscope" {
		return true
	}
	model := strings.ToLower(strings.TrimSpace(modelResolved))
	model = strings.TrimPrefix(model, "cloud/")
	model = strings.TrimPrefix(model, "token/")
	model = strings.TrimPrefix(model, "local/")
	return strings.HasPrefix(model, "dashscope/") || strings.Contains(model, "qwen3-tts") || strings.Contains(model, "qwen-tts")
}

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
	voiceCatalog *catalog.Resolver,
) ([]*runtimev1.SpeechVoiceDescriptor, speechVoiceCatalogSource, string, error) {
	providerType := ""
	if remoteTarget != nil {
		providerType = strings.TrimSpace(remoteTarget.ProviderType)
	}
	return resolveSpeechVoicesForModelWithProviderType(ctx, modelResolved, providerType, backend, voiceCatalog)
}

func resolveSpeechVoicesForModelWithProviderType(
	ctx context.Context,
	modelResolved string,
	providerType string,
	backend *nimillm.Backend,
	voiceCatalog *catalog.Resolver,
) ([]*runtimev1.SpeechVoiceDescriptor, speechVoiceCatalogSource, string, error) {
	if shouldUseDashScopeCatalog(providerType, modelResolved) {
		return resolveCatalogVoices(modelResolved, providerType, voiceCatalog)
	}

	if backend != nil {
		voices, err := backend.ListSpeechVoices(ctx, modelResolved)
		if err == nil && len(voices) > 0 {
			return voices, speechVoiceSourceProviderLive, "", nil
		}
		if err != nil && (errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded)) {
			return nil, "", "", err
		}
	}

	return resolveCatalogVoices(modelResolved, providerType, voiceCatalog)
}

func resolveCatalogVoices(
	modelResolved string,
	providerType string,
	voiceCatalog *catalog.Resolver,
) ([]*runtimev1.SpeechVoiceDescriptor, speechVoiceCatalogSource, string, error) {
	provider := strings.ToLower(strings.TrimSpace(providerType))
	if provider == "" {
		provider = strings.ToLower(strings.TrimSpace(modelResolved))
	}
	if voiceCatalog == nil {
		return nil, "", "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	resolved, err := voiceCatalog.ResolveVoices(providerType, modelResolved)
	if err != nil {
		if errors.Is(err, catalog.ErrModelNotFound) {
			providerMessage := "model not found in provider voice catalog"
			return nil, "", "", grpcerr.WithReasonCodeOptions(codes.NotFound, runtimev1.ReasonCode_AI_MODEL_NOT_FOUND, grpcerr.ReasonOptions{
				ActionHint: "switch_tts_model_or_refresh_connector_models",
				Message:    providerMessage,
				Metadata: map[string]string{
					"provider_message": providerMessage,
					"provider_type":    provider,
				},
			})
		}
		if errors.Is(err, catalog.ErrVoiceSetEmpty) {
			providerMessage := "voice set is empty for selected model"
			return nil, "", "", grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED, grpcerr.ReasonOptions{
				ActionHint: "adjust_tts_voice_or_audio_options",
				Message:    providerMessage,
				Metadata: map[string]string{
					"provider_message": providerMessage,
					"provider_type":    provider,
				},
			})
		}
		return nil, "", "", err
	}

	voices := make([]*runtimev1.SpeechVoiceDescriptor, 0, len(resolved.Voices))
	for _, voice := range resolved.Voices {
		voices = append(voices, &runtimev1.SpeechVoiceDescriptor{
			VoiceId:        strings.TrimSpace(voice.VoiceID),
			Name:           strings.TrimSpace(voice.Name),
			Lang:           strings.TrimSpace(voice.Lang),
			SupportedLangs: append([]string(nil), voice.SupportedLangs...),
		})
	}
	if len(voices) == 0 {
		return nil, "", "", grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_MODEL_NOT_FOUND)
	}
	return voices, mapCatalogSource(resolved.Source), strings.TrimSpace(resolved.CatalogVersion), nil
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
