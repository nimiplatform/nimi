package ai

import (
	"context"
	"errors"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aicapabilities"
	aicatalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/providerregistry"
	"google.golang.org/grpc/codes"
)

func scenarioProviderTypeFromTarget(_ string, remoteTarget *nimillm.RemoteTarget, _ provider, _ runtimev1.Modal) string {
	if remoteTarget == nil {
		return ""
	}
	return strings.TrimSpace(strings.ToLower(remoteTarget.ProviderType))
}

func unsupportedCapabilityReasonCode(scenarioType runtimev1.ScenarioType) runtimev1.ReasonCode {
	switch scenarioType {
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
		runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE,
		runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE,
		runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE,
		runtimev1.ScenarioType_SCENARIO_TYPE_WORLD_GENERATE:
		return runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED
	case runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE:
		return runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED
	default:
		return runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED
	}
}

func localScenarioCapability(scenarioType runtimev1.ScenarioType) (string, bool) {
	switch scenarioType {
	case runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE:
		return "text.generate", true
	case runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_EMBED:
		return "text.embed", true
	case runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE:
		return "image.generate", true
	case runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE:
		return "video.generate", true
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE:
		return "audio.synthesize", true
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE:
		return "audio.transcribe", true
	case runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE:
		return "music.generate", true
	case runtimev1.ScenarioType_SCENARIO_TYPE_WORLD_GENERATE:
		return "world.generate", true
	case runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE:
		return "voice.create", true
	default:
		return "", false
	}
}

func unsupportedTextGeneratePartType(input []*runtimev1.ChatMessage) (runtimev1.ChatContentPartType, bool) {
	for _, msg := range input {
		for _, part := range msg.GetParts() {
			switch part.GetType() {
			case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT,
				runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL,
				runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_VIDEO_URL,
				runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_AUDIO_URL:
				continue
			default:
				return part.GetType(), true
			}
		}
	}
	return runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_UNSPECIFIED, false
}

func (s *Service) validateScenarioCapability(
	ctx context.Context,
	req scenarioRequestLike,
	modelResolved string,
	remoteTarget *nimillm.RemoteTarget,
	selected provider,
) error {
	scenarioType := req.GetScenarioType()
	providerType := scenarioProviderTypeFromTarget(modelResolved, remoteTarget, selected, scenarioModalFromType(scenarioType))
	if providerType == "" {
		return nil
	}
	if isRetiredAmbientLocalProvider(providerType) {
		return localExactMediaUnsupportedError(scenarioType)
	}
	catalogProviderType := scenarioCapabilityCatalogProviderType(providerType, scenarioType)
	if catalogProviderType == "" && !isVoiceWorkflowScenario(scenarioType) {
		return nil
	}
	if s == nil || s.speechCatalog == nil {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	supported, err := s.speechCatalog.SupportsScenarioForSubject(catalogSubjectUserIDFromContext(ctx), catalogProviderType, modelResolved, scenarioType)
	if err != nil {
		if errors.Is(err, aicatalog.ErrModelNotFound) {
			return grpcerr.WrapWithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_MODEL_NOT_FOUND, err, grpcerr.ReasonOptions{
				Message: "model was not found in the AI catalog",
			})
		}
		return grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, err, grpcerr.ReasonOptions{
			Message: "failed to read AI catalog scenario capabilities",
		})
	}
	if supported {
		if scenarioType == runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE {
			feature := requiredVoiceCreationFeature(req.GetSpec())
			if feature == "" {
				return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
			}
			featureSupported, featureErr := s.speechCatalog.SupportsFeatureForSubject(catalogSubjectUserIDFromContext(ctx), catalogProviderType, modelResolved, feature)
			if featureErr != nil {
				if errors.Is(featureErr, aicatalog.ErrModelNotFound) {
					return grpcerr.WrapWithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_MODEL_NOT_FOUND, featureErr, grpcerr.ReasonOptions{Message: "model was not found in the AI catalog"})
				}
				return grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, featureErr, grpcerr.ReasonOptions{Message: "failed to read voice creation source support"})
			}
			if !featureSupported {
				return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED)
			}
		}
		return s.validateCatalogAwareScenarioSupport(ctx, scenarioType, providerType, modelResolved, req.GetSpec())
	}
	return grpcerr.WithReasonCode(codes.InvalidArgument, unsupportedCapabilityReasonCode(scenarioType))
}

func isVoiceWorkflowScenario(scenarioType runtimev1.ScenarioType) bool {
	return scenarioType == runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE
}

func requiredVoiceCreationFeature(spec *runtimev1.ScenarioSpec) string {
	if spec == nil || spec.GetVoiceCreate() == nil {
		return ""
	}
	switch spec.GetVoiceCreate().GetSource().(type) {
	case *runtimev1.VoiceCreateScenarioSpec_ReferenceAudio:
		return aicapabilities.FeatureInputAudio
	case *runtimev1.VoiceCreateScenarioSpec_TextDescription:
		return aicapabilities.FeatureInputText
	default:
		return ""
	}
}

func scenarioCapabilityCatalogProviderType(providerType string, scenarioType runtimev1.ScenarioType) string {
	normalized := strings.ToLower(strings.TrimSpace(providerType))
	if isRetiredAmbientLocalProvider(normalized) {
		return ""
	}
	if providerregistry.Contains(normalized) {
		return normalized
	}
	if isVoiceWorkflowScenario(scenarioType) {
		return ""
	}
	return ""
}

func requiredTextGenerateFeatures(input []*runtimev1.ChatMessage) []string {
	seen := map[string]struct{}{}
	var required []string
	add := func(feature string) {
		if _, ok := seen[feature]; ok {
			return
		}
		seen[feature] = struct{}{}
		required = append(required, feature)
	}
	for _, msg := range input {
		for _, part := range msg.GetParts() {
			switch part.GetType() {
			case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL:
				add(aicapabilities.FeatureInputImage)
			case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_AUDIO_URL:
				add(aicapabilities.FeatureInputAudio)
			case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_VIDEO_URL:
				add(aicapabilities.FeatureInputVideo)
			}
		}
	}
	return required
}

func (s *Service) validateRemoteTextGenerateInputCapabilities(
	ctx context.Context,
	modelResolved string,
	remoteTarget *nimillm.RemoteTarget,
	selected provider,
	input []*runtimev1.ChatMessage,
) error {
	required := requiredTextGenerateFeatures(input)
	if len(required) == 0 {
		return nil
	}
	providerType := scenarioProviderTypeFromTarget(modelResolved, remoteTarget, selected, runtimev1.Modal_MODAL_UNSPECIFIED)
	if providerType == "" {
		return grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_MODEL_NOT_FOUND)
	}
	if !providerregistry.Contains(providerType) {
		return grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_MODEL_NOT_FOUND)
	}
	if s == nil || s.speechCatalog == nil {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	for _, feature := range required {
		supported, err := s.speechCatalog.SupportsFeatureForSubject(catalogSubjectUserIDFromContext(ctx), providerType, modelResolved, feature)
		if err != nil {
			if errors.Is(err, aicatalog.ErrModelNotFound) {
				return grpcerr.WrapWithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_MODEL_NOT_FOUND, err, grpcerr.ReasonOptions{
					Message: "model was not found in the AI catalog",
				})
			}
			return grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, err, grpcerr.ReasonOptions{
				Message: "failed to read AI catalog model features",
			})
		}
		if !supported {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MODALITY_NOT_SUPPORTED)
		}
	}
	return nil
}

func (s *Service) validateTextGenerateInputParts(
	ctx context.Context,
	modelResolved string,
	remoteTarget *nimillm.RemoteTarget,
	selected provider,
	input []*runtimev1.ChatMessage,
) error {
	if _, unsupported := unsupportedTextGeneratePartType(input); unsupported {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	return s.validateRemoteTextGenerateInputCapabilities(ctx, modelResolved, remoteTarget, selected, input)
}
