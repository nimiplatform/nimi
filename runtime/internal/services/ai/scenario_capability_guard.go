package ai

import (
	"errors"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/providerregistry"
	"github.com/nimiplatform/nimi/runtime/internal/services/ai/catalog"
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
		runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE:
		return runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED
	case runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE,
		runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN:
		return runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED
	default:
		return runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED
	}
}

func (s *Service) validateScenarioCapability(
	scenarioType runtimev1.ScenarioType,
	modelResolved string,
	remoteTarget *nimillm.RemoteTarget,
	selected provider,
) error {
	if s == nil || s.speechCatalog == nil {
		return nil
	}
	providerType := inferScenarioProviderType(modelResolved, remoteTarget, selected)
	if providerType == "" {
		return nil
	}
	if !providerregistry.Contains(providerType) {
		return nil
	}
	supported, err := s.speechCatalog.SupportsScenario(providerType, modelResolved, scenarioType)
	if err != nil {
		if errors.Is(err, catalog.ErrModelNotFound) {
			return grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_MODEL_NOT_FOUND)
		}
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	if supported {
		return nil
	}
	return grpcerr.WithReasonCode(codes.InvalidArgument, unsupportedCapabilityReasonCode(scenarioType))
}
