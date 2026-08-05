package ai

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aicapabilities"
	catalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
)

const (
	speechSynthesizeRouteDescribeExtensionNamespace = "nimi.scenario.speech_synthesize.route_describe"
	speechTranscribeRouteDescribeExtensionNamespace = "nimi.scenario.speech_transcribe.route_describe"
)

type speechRouteDescribeProbe struct {
	version            string
	resolvedBindingRef string
}

type speechSynthesizeVoiceRenderHintsMetadataPayload struct {
	Stability       *catalog.NumericRange `json:"stability,omitempty"`
	SimilarityBoost *catalog.NumericRange `json:"similarityBoost,omitempty"`
	Style           *catalog.NumericRange `json:"style,omitempty"`
	Speed           *catalog.NumericRange `json:"speed,omitempty"`
	UseSpeakerBoost bool                  `json:"useSpeakerBoost,omitempty"`
}

type speechSynthesizeRouteDescribeMetadataPayload struct {
	SupportedAudioFormats          []string                                         `json:"supportedAudioFormats"`
	DefaultAudioFormat             string                                           `json:"defaultAudioFormat,omitempty"`
	SupportedTimingModes           []string                                         `json:"supportedTimingModes"`
	SupportsLanguage               bool                                             `json:"supportsLanguage"`
	SupportsEmotion                bool                                             `json:"supportsEmotion"`
	SupportsNativeStreamTTS        bool                                             `json:"supportsNativeStreamTts"`
	VoiceRenderHints               *speechSynthesizeVoiceRenderHintsMetadataPayload `json:"voiceRenderHints,omitempty"`
	ProviderExtensionNamespace     string                                           `json:"providerExtensionNamespace,omitempty"`
	ProviderExtensionSchemaVersion string                                           `json:"providerExtensionSchemaVersion,omitempty"`
}

type speechSynthesizeRouteDescribeResultPayload struct {
	Capability         string                                       `json:"capability"`
	MetadataVersion    string                                       `json:"metadataVersion"`
	ResolvedBindingRef string                                       `json:"resolvedBindingRef"`
	MetadataKind       string                                       `json:"metadataKind"`
	Metadata           speechSynthesizeRouteDescribeMetadataPayload `json:"metadata"`
}

type speechTranscribeRouteDescribeMetadataPayload struct {
	Tiers                          []string `json:"tiers"`
	SupportedResponseFormats       []string `json:"supportedResponseFormats"`
	SupportsLanguage               bool     `json:"supportsLanguage"`
	SupportsPrompt                 bool     `json:"supportsPrompt"`
	SupportsTimestamps             bool     `json:"supportsTimestamps"`
	SupportsDiarization            bool     `json:"supportsDiarization"`
	MaxSpeakerCount                int      `json:"maxSpeakerCount,omitempty"`
	ProviderExtensionNamespace     string   `json:"providerExtensionNamespace,omitempty"`
	ProviderExtensionSchemaVersion string   `json:"providerExtensionSchemaVersion,omitempty"`
}

type speechTranscribeRouteDescribeResultPayload struct {
	Capability         string                                       `json:"capability"`
	MetadataVersion    string                                       `json:"metadataVersion"`
	ResolvedBindingRef string                                       `json:"resolvedBindingRef"`
	MetadataKind       string                                       `json:"metadataKind"`
	Metadata           speechTranscribeRouteDescribeMetadataPayload `json:"metadata"`
}

func speechRouteDescribeExtensionNamespace(scenarioType runtimev1.ScenarioType) string {
	switch scenarioType {
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE:
		return speechSynthesizeRouteDescribeExtensionNamespace
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE:
		return speechTranscribeRouteDescribeExtensionNamespace
	default:
		return ""
	}
}

func speechRouteDescribeProbeFromExtensions(
	scenarioType runtimev1.ScenarioType,
	extensions []*runtimev1.ScenarioExtension,
) (*speechRouteDescribeProbe, bool, error) {
	namespace := speechRouteDescribeExtensionNamespace(scenarioType)
	if namespace == "" {
		return nil, false, nil
	}
	for _, item := range extensions {
		if strings.TrimSpace(item.GetNamespace()) != namespace {
			continue
		}
		payload := nimillm.StructToMap(item.GetPayload())
		version := strings.TrimSpace(stringValue(payload["version"]))
		resolvedBindingRef := strings.TrimSpace(stringValue(payload["resolvedBindingRef"]))
		if version != "v1" || resolvedBindingRef == "" {
			return nil, true, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		return &speechRouteDescribeProbe{
			version:            version,
			resolvedBindingRef: resolvedBindingRef,
		}, true, nil
	}
	return nil, false, nil
}

func speechCatalogProviderType(
	scenarioType runtimev1.ScenarioType,
	modelResolved string,
	remoteTarget *nimillm.RemoteTarget,
	selected provider,
) string {
	return scenarioProviderTypeFromTarget(modelResolved, remoteTarget, selected, scenarioModalFromType(scenarioType))
}

func validateSpeechRouteDescribeSpec(scenarioType runtimev1.ScenarioType, spec *runtimev1.ScenarioSpec) error {
	if spec == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	switch scenarioType {
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE:
		synthesize := spec.GetSpeechSynthesize()
		if synthesize == nil || strings.TrimSpace(synthesize.GetText()) == "" {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
		}
		if synthesize.GetSampleRateHz() < 0 || synthesize.GetSampleRateHz() > 192000 {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
		}
		if synthesize.GetSpeed() < 0 || synthesize.GetSpeed() > 4 {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
		}
		if synthesize.GetPitch() < -24 || synthesize.GetPitch() > 24 {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
		}
		if synthesize.GetVolume() < 0 || synthesize.GetVolume() > 4 {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
		}
		return nil
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE:
		transcribe := spec.GetSpeechTranscribe()
		if transcribe == nil || !hasTranscriptionAudioSource(transcribe) {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
		}
		if transcribe.GetSpeakerCount() < 0 || transcribe.GetSpeakerCount() > 32 {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
		}
		return nil
	default:
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
}

func (s *Service) writeSpeechRouteDescribeHeader(
	ctx context.Context,
	scenarioType runtimev1.ScenarioType,
	probe *speechRouteDescribeProbe,
	modelResolved string,
	remoteTarget *nimillm.RemoteTarget,
	selected provider,
) error {
	if probe == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}

	var (
		payload any
		err     error
	)
	switch scenarioType {
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE:
		payload, err = s.describeSpeechSynthesizeRouteMetadata(ctx, modelResolved, remoteTarget, selected, probe)
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE:
		payload, err = s.describeSpeechTranscribeRouteMetadata(ctx, modelResolved, remoteTarget, selected, probe)
	default:
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	if err != nil {
		return err
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return routeDescribeEncodingError(err)
	}
	encoded := base64.StdEncoding.EncodeToString(raw)
	if setErr := grpc.SetHeader(ctx, metadata.Pairs(routeDescribeResponseHeaderKey, encoded)); setErr != nil && s.logger != nil {
		s.logger.Warn("set speech route describe header failed", "error", setErr, "scenario_type", scenarioType.String())
	}
	if setErr := grpc.SetTrailer(ctx, metadata.Pairs(routeDescribeResponseHeaderKey, encoded)); setErr != nil && s.logger != nil {
		s.logger.Warn("set speech route describe trailer failed", "error", setErr, "scenario_type", scenarioType.String())
	}
	return nil
}

func (s *Service) describeSpeechSynthesizeRouteMetadata(
	ctx context.Context,
	modelResolved string,
	remoteTarget *nimillm.RemoteTarget,
	selected provider,
	probe *speechRouteDescribeProbe,
) (*speechSynthesizeRouteDescribeResultPayload, error) {
	if probe == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if s == nil || s.speechCatalog == nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	providerType := speechCatalogProviderType(runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE, modelResolved, remoteTarget, selected)
	model, err := s.speechCatalog.ResolveModelEntryForSubject(catalogSubjectUserIDFromContext(ctx), providerType, modelResolved)
	if err != nil {
		if errors.Is(err, catalog.ErrModelNotFound) {
			return nil, grpcerr.WrapWithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_MODEL_NOT_FOUND, err, grpcerr.ReasonOptions{
				Message: "speech synthesis route catalog model could not be resolved",
			})
		}
		return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, err, grpcerr.ReasonOptions{
			Message: "speech synthesis route catalog metadata could not be read",
		})
	}
	if model.VoiceRequestOptions == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}

	metadataPayload := speechSynthesizeRouteDescribeMetadataPayload{
		SupportedAudioFormats:   append([]string(nil), model.VoiceRequestOptions.AudioFormats...),
		SupportedTimingModes:    append([]string(nil), model.VoiceRequestOptions.TimingModes...),
		SupportsLanguage:        model.VoiceRequestOptions.SupportsLanguage,
		SupportsEmotion:         model.VoiceRequestOptions.SupportsEmotion,
		SupportsNativeStreamTTS: model.VoiceRequestOptions.SupportsNativeStreamTTS,
	}
	if len(metadataPayload.SupportedAudioFormats) > 0 {
		metadataPayload.DefaultAudioFormat = strings.TrimSpace(metadataPayload.SupportedAudioFormats[0])
	}
	if hints := model.VoiceRequestOptions.VoiceRenderHints; hints != nil {
		metadataPayload.VoiceRenderHints = &speechSynthesizeVoiceRenderHintsMetadataPayload{
			Stability:       hints.Stability,
			SimilarityBoost: hints.SimilarityBoost,
			Style:           hints.Style,
			Speed:           hints.Speed,
			UseSpeakerBoost: hints.UseSpeakerBoost,
		}
	}
	if ext := model.VoiceRequestOptions.ProviderExtensions; ext != nil {
		metadataPayload.ProviderExtensionNamespace = strings.TrimSpace(ext.Namespace)
		metadataPayload.ProviderExtensionSchemaVersion = strings.TrimSpace(ext.SchemaVersion)
	}

	return &speechSynthesizeRouteDescribeResultPayload{
		Capability:         aicapabilities.AudioSynthesize,
		MetadataVersion:    "v1",
		ResolvedBindingRef: probe.resolvedBindingRef,
		MetadataKind:       aicapabilities.AudioSynthesize,
		Metadata:           metadataPayload,
	}, nil
}

func (s *Service) describeSpeechTranscribeRouteMetadata(
	ctx context.Context,
	modelResolved string,
	remoteTarget *nimillm.RemoteTarget,
	selected provider,
	probe *speechRouteDescribeProbe,
) (*speechTranscribeRouteDescribeResultPayload, error) {
	if probe == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if s == nil || s.speechCatalog == nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	providerType := speechCatalogProviderType(runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE, modelResolved, remoteTarget, selected)
	model, err := s.speechCatalog.ResolveModelEntryForSubject(catalogSubjectUserIDFromContext(ctx), providerType, modelResolved)
	if err != nil {
		if errors.Is(err, catalog.ErrModelNotFound) {
			return nil, grpcerr.WrapWithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_MODEL_NOT_FOUND, err, grpcerr.ReasonOptions{
				Message: "speech transcription route catalog model could not be resolved",
			})
		}
		return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, err, grpcerr.ReasonOptions{
			Message: "speech transcription route catalog metadata could not be read",
		})
	}
	if model.Transcription == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}

	metadataPayload := speechTranscribeRouteDescribeMetadataPayload{
		Tiers:                    append([]string(nil), model.Transcription.Tiers...),
		SupportedResponseFormats: append([]string(nil), model.Transcription.ResponseFormats...),
		SupportsLanguage:         model.Transcription.SupportsLanguage,
		SupportsPrompt:           model.Transcription.SupportsPrompt,
		SupportsTimestamps:       model.Transcription.SupportsTimestamps,
		SupportsDiarization:      model.Transcription.SupportsDiarization,
		MaxSpeakerCount:          model.Transcription.MaxSpeakerCount,
	}
	if ext := model.Transcription.ProviderExtensions; ext != nil {
		metadataPayload.ProviderExtensionNamespace = strings.TrimSpace(ext.Namespace)
		metadataPayload.ProviderExtensionSchemaVersion = strings.TrimSpace(ext.SchemaVersion)
	}

	return &speechTranscribeRouteDescribeResultPayload{
		Capability:         aicapabilities.AudioTranscribe,
		MetadataVersion:    "v1",
		ResolvedBindingRef: probe.resolvedBindingRef,
		MetadataKind:       aicapabilities.AudioTranscribe,
		Metadata:           metadataPayload,
	}, nil
}

func executeSpeechRouteDescribeScenario(
	ctx context.Context,
	s *Service,
	req *runtimev1.ExecuteScenarioRequest,
	ignored []*runtimev1.IgnoredScenarioExtension,
	probe *speechRouteDescribeProbe,
) (*runtimev1.ExecuteScenarioResponse, error) {
	if req == nil || req.GetHead() == nil || req.GetSpec() == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if err := validateSpeechRouteDescribeSpec(req.GetScenarioType(), req.GetSpec()); err != nil {
		return nil, err
	}

	intent, err := scenarioExecutionIntentFromContext(ctx, scenarioTargetCapability(req.GetScenarioType()))
	if err != nil {
		return nil, err
	}
	if intent.IsLocal() {
		return nil, localExactMediaUnsupportedError(req.GetScenarioType())
	}
	effective, err := s.captureCloudMediaEffectiveInputs(
		ctx,
		req.GetHead(),
		routeDescribeJobRequest(req),
		runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
	)
	if err != nil {
		return nil, err
	}
	defer effective.release()

	release, acquireResult, acquireErr := s.scheduler.Acquire(ctx, req.GetHead().GetAppId())
	if acquireErr != nil {
		return nil, schedulerAcquireError(acquireErr)
	}
	defer release()
	s.attachQueueWaitUnary(ctx, acquireResult)
	s.logQueueWait("execute_scenario_speech_route_describe", req.GetHead().GetAppId(), acquireResult)

	if err := s.writeSpeechRouteDescribeHeader(
		ctx,
		req.GetScenarioType(),
		probe,
		effective.modelResolved(),
		effective.catalogTarget,
		s.cloudTextProvider,
	); err != nil {
		return nil, err
	}

	response := &runtimev1.ExecuteScenarioResponse{
		FinishReason:      runtimev1.FinishReason_FINISH_REASON_STOP,
		RouteDecision:     runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
		ModelResolved:     effective.modelResolved(),
		TraceId:           effective.traceID,
		IgnoredExtensions: ignored,
	}
	switch req.GetScenarioType() {
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE:
		response.Output = &runtimev1.ScenarioOutput{
			Output: &runtimev1.ScenarioOutput_SpeechSynthesize{
				SpeechSynthesize: &runtimev1.SpeechSynthesizeResult{},
			},
		}
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE:
		response.Output = &runtimev1.ScenarioOutput{
			Output: &runtimev1.ScenarioOutput_SpeechTranscribe{
				SpeechTranscribe: &runtimev1.SpeechTranscribeResult{Text: ""},
			},
		}
	default:
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	return response, nil
}
