package ai

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	catalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/modelregistry"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
)

// executeBackendSyncMedia routes sync media operations through the underlying
// Backend (via MediaBackendProvider) rather than the Provider interface.
func executeBackendSyncMedia(
	ctx context.Context,
	s *Service,
	logger *slog.Logger,
	req *runtimev1.SubmitScenarioJobRequest,
	_ provider,
	modelResolved string,
	adapterName string,
	remoteTarget *nimillm.RemoteTarget,
	cloudProvider *nimillm.CloudProvider,
	voiceCatalog *catalog.Resolver,
) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	if remoteTarget == nil {
		return nil, nil, "", localExactMediaUnsupportedError(req.GetScenarioType())
	}
	if cloudProvider == nil {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	backend, backendModelID := cloudProvider.ResolveMediaBackendWithTarget(modelResolved, remoteTarget)
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
			if logger != nil {
				logger.Warn("managed image request missing image_generate spec",
					"model_id", strings.TrimSpace(backendModelID),
				)
			}
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		payload, usage, err := backend.GenerateImage(ctx, backendModelID, spec, scenarioExtensions)
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
		for key, value := range managedImageProfileOverrideMetadata(scenarioExtensions) {
			artifactMeta[key] = value
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
		effectiveSpec, err := s.resolveSynthesizeSpeechSpecVoiceRef(ctx, req.GetHead(), modelResolved, spec)
		if err != nil {
			return nil, nil, "", err
		}
		if err := validateConnectorTTSModelSupport(ctx, logger, req, effectiveSpec, backendModelID, remoteTarget, cloudProvider, voiceCatalog); err != nil {
			return nil, nil, "", err
		}
		payload, usage, err := backend.SynthesizeSpeech(ctx, backendModelID, effectiveSpec, scenarioExtensions)
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
		if resolvedVoiceRef := resolveScenarioVoiceRef(effectiveSpec); resolvedVoiceRef != "" && resolvedVoiceRef != artifactMeta["voice_ref"] {
			artifactMeta["resolved_voice_ref"] = resolvedVoiceRef
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

func scenarioExecutionProviderMessage(err error) string {
	if err == nil {
		return ""
	}
	if st, ok := status.FromError(err); ok {
		if message := strings.TrimSpace(st.Message()); message != "" {
			return message
		}
	}
	return strings.TrimSpace(err.Error())
}

func managedImageProfileOverrideMetadata(scenarioExtensions map[string]any) map[string]any {
	if len(scenarioExtensions) == 0 {
		return nil
	}
	metadata := make(map[string]any)
	if step, ok := scenarioExtensions["step"]; ok {
		metadata["profile_override_step"] = step
	}
	if cfgScale, ok := scenarioExtensions["cfg_scale"]; ok {
		metadata["profile_override_cfg_scale"] = cfgScale
	} else if guidanceScale, ok := scenarioExtensions["guidance_scale"]; ok {
		metadata["profile_override_cfg_scale"] = guidanceScale
	}
	if sampler, ok := scenarioExtensions["sampler"]; ok && strings.TrimSpace(fmt.Sprint(sampler)) != "" {
		metadata["profile_override_sampler"] = sampler
	} else if mode, ok := scenarioExtensions["mode"]; ok && strings.TrimSpace(fmt.Sprint(mode)) != "" {
		metadata["profile_override_sampler"] = mode
	}
	if scheduler, ok := scenarioExtensions["scheduler"]; ok && strings.TrimSpace(fmt.Sprint(scheduler)) != "" {
		metadata["profile_override_scheduler"] = scheduler
	}
	if len(metadata) == 0 {
		return nil
	}
	return metadata
}

func validateConnectorTTSModelSupport(
	ctx context.Context,
	logger *slog.Logger,
	req *runtimev1.SubmitScenarioJobRequest,
	effectiveSpec *runtimev1.SpeechSynthesizeScenarioSpec,
	resolvedModelID string,
	remoteTarget *nimillm.RemoteTarget,
	cloudProvider *nimillm.CloudProvider,
	voiceCatalog *catalog.Resolver,
) error {
	if req == nil || req.GetScenarioType() != runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE {
		return nil
	}
	if remoteTarget == nil {
		return nil
	}

	requestedSpec := req.GetSpec().GetSpeechSynthesize()
	if effectiveSpec == nil {
		effectiveSpec = requestedSpec
	}
	if cloudProvider == nil {
		return nil
	}

	probeBackend, _, err := cloudProvider.ResolveProbeBackend(remoteTarget.ProviderType, remoteTarget.Endpoint, remoteTarget.APIKey, remoteTarget.Headers)
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

	switch requestedKind := requestedVoiceReferenceKind(requestedSpec); requestedKind {
	case runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_UNSPECIFIED:
		return nil
	case runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET:
		requestedVoice := resolveScenarioVoiceRef(requestedSpec)
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
				"connector_id", strings.TrimSpace(remoteTarget.ConnectorID),
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
	case runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_VOICE_ASSET:
		if strings.TrimSpace(resolveScenarioVoiceRef(requestedSpec)) == "" || strings.TrimSpace(resolveScenarioVoiceRef(effectiveSpec)) == "" {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
		}
		if err := validateConnectorTTSVoiceRefKindSupport(ctx, strings.TrimSpace(remoteTarget.ProviderType), strings.TrimSpace(matchedModelID), requestedKind, voiceCatalog); err != nil {
			return err
		}
	case runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PROVIDER_VOICE_REF:
		if strings.TrimSpace(resolveScenarioVoiceRef(effectiveSpec)) == "" {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
		}
		if err := validateConnectorTTSVoiceRefKindSupport(ctx, strings.TrimSpace(remoteTarget.ProviderType), strings.TrimSpace(matchedModelID), requestedKind, voiceCatalog); err != nil {
			return err
		}
	default:
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
	}

	return nil
}

func requestedVoiceReferenceKind(spec *runtimev1.SpeechSynthesizeScenarioSpec) runtimev1.VoiceReferenceKind {
	if spec == nil || spec.GetVoiceRef() == nil {
		return runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_UNSPECIFIED
	}
	return spec.GetVoiceRef().GetKind()
}

func validateConnectorTTSVoiceRefKindSupport(
	ctx context.Context,
	providerType string,
	modelID string,
	kind runtimev1.VoiceReferenceKind,
	voiceCatalog *catalog.Resolver,
) error {
	catalogKind := catalogVoiceReferenceKind(kind)
	if catalogKind == "" {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
	}
	if voiceCatalog == nil {
		return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	model, err := voiceCatalog.ResolveModelEntryForSubject(catalogSubjectUserIDFromContext(ctx), providerType, modelID)
	if err != nil {
		if errors.Is(err, catalog.ErrModelNotFound) {
			providerMessage := "model not found in provider voice catalog"
			return grpcerr.WrapWithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_MODEL_NOT_FOUND, err, grpcerr.ReasonOptions{
				ActionHint: "switch_tts_model_or_refresh_connector_models",
				Message:    providerMessage,
				Metadata: map[string]string{
					"provider_message": providerMessage,
					"provider_type":    strings.ToLower(strings.TrimSpace(providerType)),
				},
			})
		}
		return err
	}
	for _, supported := range model.VoiceRefKinds {
		if strings.EqualFold(strings.TrimSpace(supported), catalogKind) {
			return nil
		}
	}
	providerMessage := fmt.Sprintf("voice reference kind %q is not supported by model %q", catalogKind, strings.TrimSpace(model.ModelID))
	return grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED, grpcerr.ReasonOptions{
		ActionHint: "select_model_supporting_custom_voice_reference",
		Message:    providerMessage,
		Metadata: map[string]string{
			"provider_message": providerMessage,
			"provider_type":    strings.ToLower(strings.TrimSpace(providerType)),
			"model_id":         strings.TrimSpace(model.ModelID),
			"voice_ref_kind":   catalogKind,
		},
	})
}

func catalogVoiceReferenceKind(kind runtimev1.VoiceReferenceKind) string {
	switch kind {
	case runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET:
		return "preset_voice_id"
	case runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_VOICE_ASSET:
		return "voice_asset_id"
	case runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PROVIDER_VOICE_REF:
		return "provider_voice_ref"
	default:
		return ""
	}
}
