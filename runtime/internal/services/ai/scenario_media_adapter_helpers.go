package ai

import (
	"context"
	"strconv"
	"strings"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/runtimeidentity"
)

func isRetiredAmbientLocalProvider(providerID string) bool {
	switch strings.TrimSpace(strings.ToLower(providerID)) {
	case "media", "speech", "sidecar":
		return true
	default:
		return false
	}
}

func scenarioModalFromType(scenarioType runtimev1.ScenarioType) runtimev1.Modal {
	switch scenarioType {
	case runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE:
		return runtimev1.Modal_MODAL_IMAGE
	case runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE:
		return runtimev1.Modal_MODAL_VIDEO
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE:
		return runtimev1.Modal_MODAL_TTS
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE:
		return runtimev1.Modal_MODAL_STT
	case runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE:
		// Voice creation targets a synthesis model while remaining separate
		// from the audio.synthesize contract.
		return runtimev1.Modal_MODAL_TTS
	case runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE:
		return runtimev1.Modal_MODAL_MUSIC
	case runtimev1.ScenarioType_SCENARIO_TYPE_WORLD_GENERATE:
		return runtimev1.Modal_MODAL_WORLD
	default:
		return runtimev1.Modal_MODAL_UNSPECIFIED
	}
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
	case codes.ResourceExhausted:
		return runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED
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

func sanitizeScenarioJobReasonDetail(err error, reasonCode runtimev1.ReasonCode) string {
	if detail := stableScenarioJobReasonDetail(reasonCode); detail != "" {
		return detail
	}
	if err == nil {
		return "provider request failed"
	}
	st, ok := status.FromError(err)
	if !ok {
		return "provider request failed"
	}
	switch st.Code() {
	case codes.Canceled:
		return "request canceled"
	case codes.DeadlineExceeded:
		return "provider request timed out"
	case codes.ResourceExhausted:
		return "provider rate limit reached"
	case codes.NotFound:
		return "requested model not found"
	case codes.InvalidArgument, codes.FailedPrecondition:
		return "provider rejected request parameters"
	case codes.Unauthenticated, codes.PermissionDenied:
		return "provider authentication failed"
	default:
		return "provider request failed"
	}
}

func stableScenarioJobReasonDetail(reasonCode runtimev1.ReasonCode) string {
	switch reasonCode {
	case runtimev1.ReasonCode_ACTION_EXECUTED:
		return "request canceled"
	case runtimev1.ReasonCode_AI_LOCAL_SPEECH_PREFLIGHT_BLOCKED:
		return "local speech preflight is blocked on this host"
	case runtimev1.ReasonCode_AI_LOCAL_SPEECH_DOWNLOAD_CONFIRMATION_REQUIRED:
		return "explicit download confirmation is required before local speech setup can continue"
	case runtimev1.ReasonCode_AI_LOCAL_SPEECH_ENV_INIT_FAILED:
		return "local speech environment initialization failed"
	case runtimev1.ReasonCode_AI_LOCAL_SPEECH_HOST_INIT_FAILED:
		return "local speech host startup or probe failed"
	case runtimev1.ReasonCode_AI_LOCAL_SPEECH_CAPABILITY_DOWNLOAD_FAILED:
		return "required local speech capability must be downloaded"
	case runtimev1.ReasonCode_AI_LOCAL_SPEECH_BUNDLE_DEGRADED:
		return "local speech bundle is degraded and needs repair"
	case runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT:
		return "provider request timed out"
	case runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED:
		return "provider rate limit reached"
	case runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
		runtimev1.ReasonCode_AI_PROVIDER_INTERNAL:
		return "provider request failed"
	case runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED:
		return "provider authentication failed"
	case runtimev1.ReasonCode_AI_MODEL_NOT_FOUND:
		return "requested model not found"
	case runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED:
		return "requested route is unsupported"
	case runtimev1.ReasonCode_AI_LOCAL_EXECUTION_LOAD_FAILED:
		return "local execution model load failed"
	case runtimev1.ReasonCode_AI_LOCAL_EXECUTION_INFERENCE_FAILED:
		return "local inference failed"
	case runtimev1.ReasonCode_AI_LOCAL_EXECUTION_CANCELED:
		return "local execution canceled"
	case runtimev1.ReasonCode_AI_LOCAL_EXECUTION_PROCESS_CRASHED:
		return "local execution process crashed"
	case runtimev1.ReasonCode_AI_STREAM_BROKEN:
		return "stream delivery failed"
	case runtimev1.ReasonCode_AI_INPUT_INVALID,
		runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED:
		return "provider rejected request parameters"
	case runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED:
		return "voice workflow is unsupported"
	case runtimev1.ReasonCode_AI_OUTPUT_INVALID:
		return "provider returned invalid output"
	}
	return ""
}

func scenarioJobReasonMetadata(err error, reasonCode runtimev1.ReasonCode) *structpb.Struct {
	if err == nil {
		return nil
	}
	metadata, ok := grpcerr.ExtractReasonMetadata(err)
	if !ok {
		return nil
	}
	values := scenarioJobReasonMetadataValues(metadata, reasonCode)
	if len(values) == 0 {
		return nil
	}
	out, buildErr := structpb.NewStruct(values)
	if buildErr != nil {
		return nil
	}
	return out
}

func scenarioJobReasonMetadataValues(metadata map[string]string, _ runtimev1.ReasonCode) map[string]any {
	if len(metadata) == 0 {
		return nil
	}
	values := map[string]any{}
	if actionHint := safeScenarioReasonMetadataToken(metadata["action_hint"], maxScenarioJobReasonMetadataTokenLength); actionHint != "" {
		values["action_hint"] = actionHint
	}
	if retryable, err := strconv.ParseBool(strings.TrimSpace(metadata["retryable"])); err == nil {
		values["retryable"] = retryable
	}
	if len(values) == 0 {
		return nil
	}
	return values
}

func safeScenarioReasonMetadataToken(input string, maxLen int) string {
	value := strings.TrimSpace(input)
	if value == "" || len(value) > maxLen {
		return ""
	}
	for _, r := range value {
		if (r >= 'a' && r <= 'z') ||
			(r >= 'A' && r <= 'Z') ||
			(r >= '0' && r <= '9') ||
			r == '_' || r == '-' || r == '.' {
			continue
		}
		return ""
	}
	return value
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

func (s *Service) resolveSynthesizeSpeechSpecVoiceRefForTarget(
	ctx context.Context,
	head *runtimev1.ScenarioRequestHead,
	requestTarget *runtimeidentity.Target,
	spec *runtimev1.SpeechSynthesizeScenarioSpec,
) (*runtimev1.SpeechSynthesizeScenarioSpec, error) {
	if spec == nil || spec.GetVoiceRef() == nil {
		return spec, nil
	}
	ref := spec.GetVoiceRef()
	if ref.GetKind() != runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_VOICE_ASSET {
		return spec, nil
	}
	voiceAssetID := strings.TrimSpace(ref.GetVoiceAssetId())
	if voiceAssetID == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
	}
	if s == nil || s.voiceAssets == nil {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_VOICE_ASSET_NOT_FOUND)
	}
	asset, assetTarget, ok := s.voiceAssets.getAssetBinding(voiceAssetID)
	if !ok || asset == nil || assetTarget == nil || asset.GetStatus() == runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_DELETED {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_VOICE_ASSET_NOT_FOUND)
	}
	if asset.GetStatus() != runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_ACTIVE {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
	}
	if head == nil ||
		strings.TrimSpace(head.GetAppId()) != strings.TrimSpace(asset.GetAppId()) ||
		strings.TrimSpace(head.GetSubjectUserId()) != strings.TrimSpace(asset.GetSubjectUserId()) {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_AI_VOICE_ASSET_SCOPE_FORBIDDEN)
	}
	if identity := authn.IdentityFromContext(ctx); identity != nil &&
		strings.TrimSpace(identity.SubjectUserID) != strings.TrimSpace(asset.GetSubjectUserId()) {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_AI_VOICE_ASSET_SCOPE_FORBIDDEN)
	}
	if callerAppID := voiceAssetCallerAppID(ctx); callerAppID != "" &&
		callerAppID != strings.TrimSpace(asset.GetAppId()) {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_AI_VOICE_ASSET_SCOPE_FORBIDDEN)
	}
	if requestTarget == nil || !runtimeidentity.Equal(requestTarget, assetTarget) {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_TARGET_MODEL_MISMATCH)
	}
	providerVoiceRef := strings.TrimSpace(asset.GetProviderVoiceRef())
	if providerVoiceRef == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
	}
	cloned, ok := proto.Clone(spec).(*runtimev1.SpeechSynthesizeScenarioSpec)
	if !ok || cloned == nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	cloned.VoiceRef = &runtimev1.VoiceReference{
		Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PROVIDER_VOICE_REF,
		Reference: &runtimev1.VoiceReference_ProviderVoiceRef{
			ProviderVoiceRef: providerVoiceRef,
		},
	}
	return cloned, nil
}
