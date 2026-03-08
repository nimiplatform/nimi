package ai

import (
	"strings"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aicapabilities"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/providerregistry"
)

func findProbeModelID(models []nimillm.ProbeModel, targetModelID string) (string, bool) {
	targetComparable := normalizeComparableModelID(targetModelID)
	targetBase := modelIDBase(targetModelID)
	for _, model := range models {
		id := strings.TrimSpace(model.ModelID)
		if id == "" {
			continue
		}
		if normalizeComparableModelID(id) == targetComparable {
			return id, true
		}
		if modelIDBase(id) == targetBase {
			return id, true
		}
	}
	return "", false
}

func normalizeComparableModelID(value string) string {
	comparable := strings.ToLower(strings.TrimSpace(value))
	comparable = strings.TrimPrefix(comparable, "models/")
	comparable = strings.TrimPrefix(comparable, "model/")
	return comparable
}

func modelIDBase(value string) string {
	trimmed := strings.TrimSpace(value)
	if idx := strings.Index(trimmed, "@"); idx > 0 {
		return strings.ToLower(strings.TrimSpace(trimmed[:idx]))
	}
	return strings.ToLower(trimmed)
}

func supportsTTSCapability(capabilities []string) bool {
	for _, capability := range capabilities {
		if aicapabilities.NormalizeCatalogCapability(capability) == aicapabilities.AudioSynthesize {
			return true
		}
	}
	return false
}

func resolveMediaAdapterName(modelID string, modelResolved string, modal runtimev1.Modal, providerType string) string {
	resolvedLower := strings.ToLower(strings.TrimSpace(modelResolved))
	providerLower := strings.ToLower(strings.TrimSpace(providerType))
	lowerModel := strings.ToLower(strings.TrimSpace(modelID))
	if providerLower == "" {
		if idx := strings.Index(resolvedLower, "/"); idx > 0 {
			candidate := strings.TrimSpace(resolvedLower[:idx])
			if providerregistry.Contains(candidate) {
				providerLower = candidate
			}
		}
	}

	switch {
	case strings.HasPrefix(lowerModel, "localai/"):
		return adapterLocalAINative
	case strings.HasPrefix(lowerModel, "nexa/"):
		return adapterNexaNative
	}

	if strategy, ok := mediaAdapterStrategiesByProvider[providerLower]; ok {
		if adapter := strategy.forModal(modal); adapter != "" {
			return adapter
		}
	}
	if strings.HasPrefix(lowerModel, "gemini-") || strings.HasPrefix(resolvedLower, "gemini-") {
		if strategy, ok := mediaAdapterStrategiesByProvider["gemini"]; ok {
			if adapter := strategy.forModal(modal); adapter != "" {
				return adapter
			}
		}
	}
	if providerLower != "" {
		if record, ok := providerregistry.Lookup(providerLower); ok {
			if mediaScenarioSupportedByProviderRecord(record, modal) {
				return adapterOpenAICompat
			}
		}
	}

	if modal == runtimev1.Modal_MODAL_VIDEO && strings.Contains(resolvedLower, "glm") {
		return adapterGLMTask
	}
	if modal == runtimev1.Modal_MODAL_IMAGE && strings.Contains(resolvedLower, "kimi") {
		return adapterKimiChatMultimodal
	}
	return adapterOpenAICompat
}

func mediaScenarioSupportedByProviderRecord(record providerregistry.ProviderRecord, modal runtimev1.Modal) bool {
	switch modal {
	case runtimev1.Modal_MODAL_IMAGE:
		return record.SupportsImage
	case runtimev1.Modal_MODAL_VIDEO:
		return record.SupportsVideo
	case runtimev1.Modal_MODAL_TTS:
		return record.SupportsTTS
	case runtimev1.Modal_MODAL_STT:
		return record.SupportsSTT
	default:
		return false
	}
}

func inferMediaProviderTypeFromSelectedBackend(selectedProvider provider, modelResolved string) string {
	if cloud, ok := selectedProvider.(*nimillm.CloudProvider); ok && cloud != nil {
		if backend, _, _, _ := cloud.PickBackend(modelResolved); backend != nil {
			return inferMediaProviderTypeFromBackendName(backend)
		}
	}
	if backendProvider, ok := selectedProvider.(nimillm.MediaBackendProvider); ok && backendProvider != nil {
		if backend, _ := backendProvider.ResolveMediaBackend(modelResolved); backend != nil {
			return inferMediaProviderTypeFromBackendName(backend)
		}
	}
	return ""
}

func inferMediaProviderTypeFromBackendName(backend *nimillm.Backend) string {
	if backend == nil {
		return ""
	}
	name := strings.ToLower(strings.TrimSpace(backend.Name))
	switch {
	case strings.HasPrefix(name, "local-"):
		return strings.TrimSpace(strings.TrimPrefix(name, "local-"))
	case strings.HasPrefix(name, "cloud-"):
		return strings.TrimSpace(strings.TrimPrefix(name, "cloud-"))
	default:
		return ""
	}
}

func stringSliceToAny(values []string) []any {
	if len(values) == 0 {
		return nil
	}
	output := make([]any, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		output = append(output, trimmed)
	}
	if len(output) == 0 {
		return nil
	}
	return output
}

// resolveNativeAdapterConfig returns adapter credentials from remoteTarget when
// available (connector path), falling back to the config-based cloud provider entry.
func (s *Service) resolveNativeAdapterConfig(configKey string, remoteTarget *nimillm.RemoteTarget) nimillm.MediaAdapterConfig {
	if remoteTarget != nil && remoteTarget.APIKey != "" {
		return nimillm.MediaAdapterConfig{BaseURL: remoteTarget.Endpoint, APIKey: remoteTarget.APIKey}
	}
	creds := s.config.CloudProviders[configKey]
	return nimillm.MediaAdapterConfig{BaseURL: creds.BaseURL, APIKey: creds.APIKey}
}

func reasonCodeFromMediaError(err error) runtimev1.ReasonCode {
	if err == nil {
		return runtimev1.ReasonCode_ACTION_EXECUTED
	}
	if reasonCode, ok := grpcerr.ExtractReasonCode(err); ok {
		return reasonCode
	}
	st, ok := status.FromError(err)
	if !ok {
		return runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE
	}
	if value, exists := runtimev1.ReasonCode_value[strings.TrimSpace(st.Message())]; exists {
		return runtimev1.ReasonCode(value)
	}
	switch st.Code() {
	case codes.Canceled:
		return runtimev1.ReasonCode_ACTION_EXECUTED
	case codes.DeadlineExceeded:
		return runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT
	case codes.NotFound:
		return runtimev1.ReasonCode_AI_MODEL_NOT_FOUND
	case codes.FailedPrecondition:
		return runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED
	case codes.InvalidArgument:
		return runtimev1.ReasonCode_AI_INPUT_INVALID
	default:
		return runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE
	}
}

func resolveScenarioVoiceRef(spec *runtimev1.SpeechSynthesizeScenarioSpec) string {
	if spec == nil || spec.GetVoiceRef() == nil {
		return ""
	}
	ref := spec.GetVoiceRef()
	switch ref.GetKind() {
	case runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PROVIDER_VOICE_REF:
		return strings.TrimSpace(ref.GetProviderVoiceRef())
	case runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET:
		return strings.TrimSpace(ref.GetPresetVoiceId())
	case runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_VOICE_ASSET:
		return strings.TrimSpace(ref.GetVoiceAssetId())
	default:
		return ""
	}
}

func (s *Service) UpdatePollState(
	jobID string,
	providerJobID string,
	retryCount int32,
	nextPollAt *timestamppb.Timestamp,
	lastError string,
) {
	if _, ok := s.scenarioJobs.transition(
		jobID,
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_UNSPECIFIED,
		runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_TYPE_UNSPECIFIED,
		func(job *runtimev1.ScenarioJob) {
			job.ProviderJobId = strings.TrimSpace(providerJobID)
			job.RetryCount = retryCount
			job.NextPollAt = nextPollAt
			job.ReasonDetail = strings.TrimSpace(lastError)
		},
	); !ok {
		s.logger.Warn("scenario job poll state update failed", "job_id", jobID)
	}
}
