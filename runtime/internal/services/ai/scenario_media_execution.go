package ai

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	catalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localrouting"
	"github.com/nimiplatform/nimi/runtime/internal/modelregistry"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
)

type localModalMediaProvider interface {
	resolveMediaBackendForModal(modelID string, modal runtimev1.Modal) (*nimillm.Backend, string, string)
}

// executeBackendSyncMedia routes sync media operations through the underlying
// Backend (via MediaBackendProvider) rather than the Provider interface.
func executeBackendSyncMedia(
	ctx context.Context,
	s *Service,
	logger *slog.Logger,
	req *runtimev1.SubmitScenarioJobRequest,
	selectedProvider provider,
	modelResolved string,
	adapterName string,
	remoteTarget *nimillm.RemoteTarget,
	cloudProvider *nimillm.CloudProvider,
	voiceCatalog *catalog.Resolver,
) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	var backend *nimillm.Backend
	var backendModelID string
	modal := scenarioModalFromType(req.GetScenarioType())
	if remoteTarget != nil && cloudProvider != nil {
		backend, backendModelID = cloudProvider.ResolveMediaBackendWithTarget(modelResolved, remoteTarget)
	} else if modalProvider, ok := selectedProvider.(localModalMediaProvider); ok {
		var providerType string
		backend, backendModelID, providerType = modalProvider.resolveMediaBackendForModal(modelResolved, modal)
		if providerType != "" && !localrouting.ProviderSupportsCapability(providerType, localRoutingCapabilityForModal(modal)) {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
		}
		if adapterName == "" && providerType != "" {
			adapterName = resolveMediaAdapterName(req.GetHead().GetModelId(), modelResolved, modal, providerType)
		}
	} else {
		mbp, ok := selectedProvider.(nimillm.MediaBackendProvider)
		if !ok || mbp == nil {
			return nil, nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
		}
		backend, backendModelID = mbp.ResolveMediaBackend(modelResolved)
	}
	if backend == nil {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	if backendModelID == "" {
		backendModelID = modelResolved
	}
	scenarioExtensions := nimillm.ScenarioExtensionPayloadForType(req.GetScenarioType(), req.GetExtensions())
	if req.GetScenarioType() == runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE {
		normalizedExtensions, _, resolveErr := resolveMusicGenerateExtensionPayload(req)
		if resolveErr != nil {
			return nil, nil, "", resolveErr
		}
		scenarioExtensions = normalizedExtensions
	}

	switch req.GetScenarioType() {
	case runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE:
		spec := req.GetSpec().GetImageGenerate()
		if spec == nil {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		var (
			payload []byte
			usage   *runtimev1.UsageStats
			err     error
			diag    *nimillm.ManagedMediaImageDiagnostics
		)
		managedMediaResolved := false
		var imageSelection engine.ImageSupervisedMatrixSelection
		if s != nil && s.localImageProfile != nil {
			resolvedSelection, resolveErr := s.localImageProfile.ResolveCanonicalImageSelection(ctx, backendModelID)
			if resolveErr != nil {
				return nil, nil, "", resolveErr
			}
			imageSelection = resolvedSelection
			if !imageSelection.Matched || imageSelection.Conflict || imageSelection.Entry == nil {
				return nil, nil, "", grpcerr.WithReasonCodeOptions(
					codes.FailedPrecondition,
					runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE,
					grpcerr.ReasonOptions{Message: strings.TrimSpace(imageSelection.CompatibilityDetail)},
				)
			}
			if imageSelection.ProductState != engine.ImageProductStateSupported {
				return nil, nil, "", grpcerr.WithReasonCodeOptions(
					codes.FailedPrecondition,
					runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE,
					grpcerr.ReasonOptions{Message: strings.TrimSpace(imageSelection.CompatibilityDetail)},
				)
			}
			switch {
			case imageSelection.ControlPlane == engine.EngineLlama &&
				imageSelection.ExecutionPlane == engine.EngineMedia &&
				imageSelection.BackendClass == engine.ImageBackendClassNativeBinary:
				alias, profile, forwardedExtensions, managedErr := s.localImageProfile.ResolveManagedMediaImageProfile(ctx, backendModelID, scenarioExtensions)
				if managedErr != nil {
					return nil, nil, "", managedErr
				}
				if alias == "" || len(profile) == 0 {
					return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
				}
				if err := backend.ImportManagedMediaModelConfig(ctx, profile); err != nil {
					return nil, nil, "", err
				}
				backendModelID = alias
				scenarioExtensions = forwardedExtensions
				managedMediaResolved = true
				adapterName = adapterLlamaNative
			case imageSelection.ControlPlane == engine.EngineMedia &&
				imageSelection.ExecutionPlane == engine.EngineMedia &&
				imageSelection.BackendClass == engine.ImageBackendClassPythonPipeline:
				managedMediaResolved = false
			default:
				detail := strings.TrimSpace(imageSelection.CompatibilityDetail)
				if detail == "" {
					detail = "canonical image resolver returned an unsupported execution path"
				}
				return nil, nil, "", grpcerr.WithReasonCodeOptions(
					codes.FailedPrecondition,
					runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE,
					grpcerr.ReasonOptions{Message: detail},
				)
			}
		}
		if managedMediaResolved {
			payload, usage, diag, err = backend.GenerateImageManagedMedia(ctx, backendModelID, spec, scenarioExtensions)
		} else {
			payload, usage, err = backend.GenerateImage(ctx, backendModelID, spec, scenarioExtensions)
		}
		if err != nil {
			return nil, nil, "", err
		}
		artifactMeta := map[string]any{
			"adapter":          adapterName,
			"prompt":           strings.TrimSpace(spec.GetPrompt()),
			"negative_prompt":  strings.TrimSpace(spec.GetNegativePrompt()),
			"size":             strings.TrimSpace(spec.GetSize()),
			"aspect_ratio":     strings.TrimSpace(spec.GetAspectRatio()),
			"quality":          strings.TrimSpace(spec.GetQuality()),
			"style":            strings.TrimSpace(spec.GetStyle()),
			"response_format":  strings.TrimSpace(spec.GetResponseFormat()),
			"reference_images": stringSliceToAny(spec.GetReferenceImages()),
			"mask":             strings.TrimSpace(spec.GetMask()),
		}
		if len(scenarioExtensions) > 0 {
			artifactMeta["extensions"] = scenarioExtensions
		}
		if diag != nil {
			artifactMeta["local_prompt"] = diag.LocalPrompt
			artifactMeta["source_image"] = diag.SourceImage
			artifactMeta["ref_images_count"] = diag.RefImagesCount
		}
		artifact := nimillm.BinaryArtifact(nimillm.ResolveImageArtifactMIME(spec, payload), payload, artifactMeta)
		nimillm.ApplyImageSpecMetadata(artifact, spec)
		return []*runtimev1.ScenarioArtifact{artifact}, usage, "", nil

	case runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE:
		spec := req.GetSpec().GetVideoGenerate()
		if spec == nil {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		payload, usage, err := backend.GenerateVideo(ctx, backendModelID, spec, scenarioExtensions)
		if err != nil {
			return nil, nil, "", err
		}
		artifactMeta := map[string]any{
			"adapter":                     adapterName,
			"prompt":                      nimillm.VideoPrompt(spec),
			"negative_prompt":             nimillm.VideoNegativePrompt(spec),
			"mode":                        spec.GetMode().String(),
			"content":                     nimillm.VideoContentPayload(spec),
			"duration_sec":                nimillm.VideoDurationSec(spec),
			"frames":                      nimillm.VideoFrames(spec),
			"fps":                         nimillm.VideoFPS(spec),
			"resolution":                  nimillm.VideoResolution(spec),
			"aspect_ratio":                nimillm.VideoRatio(spec),
			"seed":                        nimillm.VideoSeed(spec),
			"camera_fixed":                nimillm.VideoCameraFixed(spec),
			"watermark":                   nimillm.VideoWatermark(spec),
			"generate_audio":              nimillm.VideoGenerateAudio(spec),
			"draft":                       nimillm.VideoDraft(spec),
			"service_tier":                nimillm.VideoServiceTier(spec),
			"execution_expires_after_sec": nimillm.VideoExecutionExpiresAfterSec(spec),
			"return_last_frame":           nimillm.VideoReturnLastFrame(spec),
		}
		if len(scenarioExtensions) > 0 {
			artifactMeta["extensions"] = scenarioExtensions
		}
		artifact := nimillm.BinaryArtifact(nimillm.ResolveVideoArtifactMIME(spec, payload), payload, artifactMeta)
		nimillm.ApplyVideoSpecMetadata(artifact, spec)
		return []*runtimev1.ScenarioArtifact{artifact}, usage, "", nil

	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE:
		spec := req.GetSpec().GetSpeechSynthesize()
		if spec == nil {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		if err := validateConnectorTTSModelSupport(ctx, logger, req, backendModelID, remoteTarget, cloudProvider, voiceCatalog); err != nil {
			return nil, nil, "", err
		}
		payload, usage, err := backend.SynthesizeSpeech(ctx, backendModelID, spec, scenarioExtensions)
		if err != nil {
			return nil, nil, "", err
		}
		artifactMeta := map[string]any{
			"adapter":      adapterName,
			"voice_ref":    resolveScenarioVoiceRef(spec),
			"language":     strings.TrimSpace(spec.GetLanguage()),
			"audio_format": strings.TrimSpace(spec.GetAudioFormat()),
			"emotion":      strings.TrimSpace(spec.GetEmotion()),
		}
		if len(scenarioExtensions) > 0 {
			artifactMeta["extensions"] = scenarioExtensions
		}
		artifact := nimillm.BinaryArtifact(nimillm.ResolveSpeechArtifactMIME(spec, payload), payload, artifactMeta)
		nimillm.ApplySpeechSpecMetadata(artifact, spec)
		return []*runtimev1.ScenarioArtifact{artifact}, usage, "", nil

	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE:
		spec := req.GetSpec().GetSpeechTranscribe()
		if spec == nil {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		audioBytes, mimeType, audioURI, err := nimillm.ResolveTranscriptionAudioSource(ctx, spec)
		if err != nil {
			return nil, nil, "", err
		}
		text, usage, err := backend.Transcribe(ctx, backendModelID, spec, audioBytes, mimeType, scenarioExtensions)
		if err != nil {
			return nil, nil, "", err
		}
		artifactMeta := map[string]any{
			"text":            text,
			"adapter":         adapterName,
			"language":        strings.TrimSpace(spec.GetLanguage()),
			"timestamps":      spec.GetTimestamps(),
			"diarization":     spec.GetDiarization(),
			"speaker_count":   spec.GetSpeakerCount(),
			"response_format": strings.TrimSpace(spec.GetResponseFormat()),
			"mime_type":       mimeType,
			"audio_uri":       audioURI,
		}
		if len(scenarioExtensions) > 0 {
			artifactMeta["extensions"] = scenarioExtensions
		}
		artifact := nimillm.BinaryArtifact(nimillm.ResolveTranscriptionArtifactMIME(spec), []byte(text), artifactMeta)
		nimillm.ApplyTranscriptionSpecMetadata(artifact, spec, audioURI)
		return []*runtimev1.ScenarioArtifact{artifact}, usage, "", nil

	case runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE:
		spec := req.GetSpec().GetMusicGenerate()
		if spec == nil {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		payload, usage, err := backend.GenerateMusic(ctx, backendModelID, spec, scenarioExtensions)
		if err != nil {
			return nil, nil, "", err
		}
		artifactMeta := map[string]any{
			"adapter":          adapterName,
			"prompt":           strings.TrimSpace(spec.GetPrompt()),
			"negative_prompt":  strings.TrimSpace(spec.GetNegativePrompt()),
			"lyrics":           strings.TrimSpace(spec.GetLyrics()),
			"style":            strings.TrimSpace(spec.GetStyle()),
			"title":            strings.TrimSpace(spec.GetTitle()),
			"duration_seconds": spec.GetDurationSeconds(),
			"instrumental":     spec.GetInstrumental(),
		}
		if len(scenarioExtensions) > 0 {
			artifactMeta["extensions"] = scenarioExtensions
		}
		artifact := nimillm.BinaryArtifact("audio/mpeg", payload, artifactMeta)
		nimillm.ApplyMusicSpecMetadata(artifact, spec)
		return []*runtimev1.ScenarioArtifact{artifact}, usage, "", nil

	default:
		return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
}

func validateConnectorTTSModelSupport(
	ctx context.Context,
	logger *slog.Logger,
	req *runtimev1.SubmitScenarioJobRequest,
	resolvedModelID string,
	remoteTarget *nimillm.RemoteTarget,
	cloudProvider *nimillm.CloudProvider,
	voiceCatalog *catalog.Resolver,
) error {
	if req == nil || req.GetScenarioType() != runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE {
		return nil
	}
	if strings.TrimSpace(req.GetHead().GetConnectorId()) == "" {
		return nil
	}
	if remoteTarget == nil {
		return nil
	}

	requestedVoice := resolveScenarioVoiceRef(req.GetSpec().GetSpeechSynthesize())
	if cloudProvider == nil {
		return nil
	}

	probeBackend, _, err := cloudProvider.ResolveProbeBackend(remoteTarget.ProviderType, remoteTarget.Endpoint, remoteTarget.APIKey)
	if err != nil {
		return err
	}
	models, err := probeBackend.ListModels(ctx)
	if err != nil {
		return err
	}

	matchedModelID, ok := resolveConnectorTTSModelID(models, resolvedModelID, remoteTarget.ProviderType, voiceCatalog)
	if !ok {
		providerMessage := fmt.Sprintf("connector model %q not listed by provider", strings.TrimSpace(resolvedModelID))
		return grpcerr.WithReasonCodeOptions(codes.NotFound, runtimev1.ReasonCode_AI_MODEL_NOT_FOUND, grpcerr.ReasonOptions{
			ActionHint: "switch_tts_model_or_refresh_connector_models",
			Message:    providerMessage,
			Metadata: map[string]string{
				"provider_message": providerMessage,
			},
		})
	}

	capabilities := modelregistry.InferCapabilities(matchedModelID)
	if !supportsTTSCapability(capabilities) {
		providerMessage := fmt.Sprintf("model %q does not advertise tts capability", strings.TrimSpace(matchedModelID))
		return grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_MODALITY_NOT_SUPPORTED, grpcerr.ReasonOptions{
			ActionHint: "select_model_with_audio_synthesize_capability",
			Message:    providerMessage,
			Metadata: map[string]string{
				"provider_message": providerMessage,
			},
		})
	}

	voices, source, catalogVersion, err := resolveCatalogVoicesForSubject(
		ctx,
		strings.TrimSpace(matchedModelID),
		strings.TrimSpace(remoteTarget.ProviderType),
		voiceCatalog,
	)
	if err != nil {
		return err
	}
	if catalogVersion == "" {
		catalogVersion = "n/a"
	}
	if logger != nil {
		logger.Debug(
			"voice-list-resolved",
			"source", string(source),
			"catalog_version", catalogVersion,
			"model_resolved", strings.TrimSpace(matchedModelID),
			"provider_type", strings.TrimSpace(remoteTarget.ProviderType),
			"connector_id", strings.TrimSpace(req.GetHead().GetConnectorId()),
		)
	}

	if !isSpeechVoiceSupported(requestedVoice, voices) {
		providerMessage := fmt.Sprintf("voice %q is not supported by model %q", requestedVoice, strings.TrimSpace(matchedModelID))
		return grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED, grpcerr.ReasonOptions{
			ActionHint: "adjust_tts_voice_or_audio_options",
			Message:    providerMessage,
			Metadata: map[string]string{
				"provider_message":     providerMessage,
				"voice_catalog_source": string(source),
				"catalog_version":      catalogVersion,
				"requested_voice":      requestedVoice,
			},
		})
	}

	return nil
}
