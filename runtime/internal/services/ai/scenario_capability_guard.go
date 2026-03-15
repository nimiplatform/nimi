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

func inferScenarioProviderType(modelResolved string, remoteTarget *nimillm.RemoteTarget, selected provider) string {
	if remoteTarget != nil {
		providerType := strings.TrimSpace(strings.ToLower(remoteTarget.ProviderType))
		if providerType != "" {
			return providerType
		}
	}
	if providerType := inferMediaProviderTypeFromSelectedBackend(selected, modelResolved); providerType != "" {
		return strings.ToLower(strings.TrimSpace(providerType))
	}
	normalized := strings.ToLower(strings.TrimSpace(modelResolved))
	if idx := strings.Index(normalized, "/"); idx > 0 {
		candidate := strings.TrimSpace(normalized[:idx])
		if providerregistry.Contains(candidate) {
			return candidate
		}
	}
	return ""
}

func unsupportedCapabilityReasonCode(scenarioType runtimev1.ScenarioType) runtimev1.ReasonCode {
	switch scenarioType {
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
		runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE,
		runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE,
		runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE:
		return runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED
	case runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE,
		runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN:
		return runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED
	default:
		return runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED
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
	scenarioType runtimev1.ScenarioType,
	modelResolved string,
	remoteTarget *nimillm.RemoteTarget,
	selected provider,
) error {
	providerType := inferScenarioProviderType(modelResolved, remoteTarget, selected)
	if providerType == "" {
		return nil
	}
	if !providerregistry.Contains(providerType) {
		return nil
	}
	if s == nil || s.speechCatalog == nil {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	supported, err := s.speechCatalog.SupportsScenarioForSubject(catalogSubjectUserIDFromContext(ctx), providerType, modelResolved, scenarioType)
	if err != nil {
		if errors.Is(err, aicatalog.ErrModelNotFound) {
			return grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_MODEL_NOT_FOUND)
		}
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	if supported {
		return nil
	}
	return grpcerr.WithReasonCode(codes.InvalidArgument, unsupportedCapabilityReasonCode(scenarioType))
}

func requiredTextGenerateCapabilities(input []*runtimev1.ChatMessage) []string {
	required := map[string]struct{}{}
	for _, msg := range input {
		for _, part := range msg.GetParts() {
			switch part.GetType() {
			case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL:
				required[aicapabilities.TextGenerateVision] = struct{}{}
			case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_AUDIO_URL:
				required[aicapabilities.TextGenerateAudio] = struct{}{}
			case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_VIDEO_URL:
				required[aicapabilities.TextGenerateVideo] = struct{}{}
			}
		}
	}
	if len(required) == 0 {
		return nil
	}
	out := make([]string, 0, len(required))
	for capability := range required {
		out = append(out, capability)
	}
	return out
}

func localTextGenerateCapabilityAliases(capability string) []string {
	switch capability {
	case aicapabilities.TextGenerateVision:
		return []string{"vision", "vl", "multimodal"}
	case aicapabilities.TextGenerateAudio:
		return []string{"audio_chat", "multimodal"}
	case aicapabilities.TextGenerateVideo:
		return []string{"video_chat", "multimodal"}
	default:
		return nil
	}
}

func localModelSupportsTextGenerateCapability(model *runtimev1.LocalModelRecord, capability string) bool {
	if model == nil {
		return false
	}
	for _, value := range model.GetCapabilities() {
		normalized := strings.ToLower(strings.TrimSpace(value))
		if normalized == "" {
			continue
		}
		if aicapabilities.NormalizeCatalogCapability(normalized) == capability {
			return true
		}
		for _, alias := range localTextGenerateCapabilityAliases(capability) {
			if normalized == alias {
				return true
			}
		}
	}
	modelID := strings.ToLower(strings.TrimSpace(model.GetModelId()))
	if strings.Contains(modelID, "omni") {
		return capability == aicapabilities.TextGenerateVision ||
			capability == aicapabilities.TextGenerateAudio ||
			capability == aicapabilities.TextGenerateVideo
	}
	return false
}

func (s *Service) validateLocalTextGenerateInputCapabilities(
	ctx context.Context,
	modelResolved string,
	input []*runtimev1.ChatMessage,
) error {
	required := requiredTextGenerateCapabilities(input)
	if len(required) == 0 || s == nil || s.localModel == nil {
		return nil
	}
	models, err := s.listAllLocalModels(ctx, runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNSPECIFIED)
	if err != nil {
		return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}
	selected, reason, detail := selectRunnableLocalModel(models, parseLocalModelSelector(modelResolved))
	if reason != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		if detail != "" {
			return grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, reason, grpcerr.ReasonOptions{
				ActionHint: "inspect_local_runtime_model_health",
				Message:    detail,
			})
		}
		return grpcerr.WithReasonCode(codes.FailedPrecondition, reason)
	}
	for _, capability := range required {
		if !localModelSupportsTextGenerateCapability(selected, capability) {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MODALITY_NOT_SUPPORTED)
		}
	}
	return nil
}

func (s *Service) validateRemoteTextGenerateInputCapabilities(
	ctx context.Context,
	modelResolved string,
	remoteTarget *nimillm.RemoteTarget,
	selected provider,
	input []*runtimev1.ChatMessage,
) error {
	required := requiredTextGenerateCapabilities(input)
	if len(required) == 0 {
		return nil
	}
	providerType := inferScenarioProviderType(modelResolved, remoteTarget, selected)
	if providerType == "" {
		return nil
	}
	if !providerregistry.Contains(providerType) {
		return nil
	}
	if s == nil || s.speechCatalog == nil {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	for _, capability := range required {
		supported, err := s.speechCatalog.SupportsCapabilityForSubject(catalogSubjectUserIDFromContext(ctx), providerType, modelResolved, capability)
		if err != nil {
			if errors.Is(err, aicatalog.ErrModelNotFound) {
				continue
			}
			return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
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
	if selected != nil && selected.Route() == runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL && remoteTarget == nil {
		return s.validateLocalTextGenerateInputCapabilities(ctx, modelResolved, input)
	}
	return s.validateRemoteTextGenerateInputCapabilities(ctx, modelResolved, remoteTarget, selected, input)
}
