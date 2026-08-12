package capabilitydriver

import (
	"fmt"
	"path/filepath"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

const (
	Qwen3TTSImplementationID             = "local.audio.synthesize.qwen3-tts"
	Qwen3TTSDriverID                     = "nimi.runtime.driver.qwen3-tts"
	Qwen3TTSDriverDialect                = "qwen3-tts/audio-synthesize/v1"
	AudioSynthesizeContract              = "audio.synthesize"
	Qwen3TTSModelRequirementID           = "tts.model"
	Qwen3VoiceCreateImplementationID     = "local.voice.create.qwen3-tts"
	Qwen3VoiceCreateDriverDialect        = "qwen3-tts/voice-create/v1"
	VoiceCreateContract                  = "voice.create"
	Qwen3VoiceCreateModelRequirementID   = "voice.model"
	Qwen3VoiceCloneArtifactRole          = "tts_voice_clone_model"
	Qwen3VoiceDesignArtifactRole         = "tts_voice_design_model"
	Qwen3ASRImplementationID             = "local.audio.transcribe.qwen3-asr"
	Qwen3ASRDriverID                     = "nimi.runtime.driver.qwen3-asr"
	Qwen3ASRDriverDialect                = "qwen3-asr/audio-transcribe/v1"
	Qwen3ASRTransformersImplementationID = "local.audio.transcribe.qwen3-asr-transformers"
	Qwen3ASRTransformersDriverID         = "nimi.runtime.driver.qwen3-asr-transformers"
	Qwen3ASRTransformersDriverDialect    = "qwen3-asr-transformers/audio-transcribe/v1"
	AudioTranscribeContract              = "audio.transcribe"
	Qwen3ASRModelRequirementID           = "stt.model"
)

// SpeechSynthesizeInvocationInput is the complete Driver-owned plain speech
// synthesis input. The selected asset occurrence is already verified and the
// request contains no endpoint, process, route, or fallback facts.
type SpeechSynthesizeInvocationInput struct {
	PortableConfig *structpb.Struct
	ExactBindings  []InvocationExactBinding
	Request        *runtimev1.SpeechSynthesizeScenarioSpec
}

// SpeechTranscribeInvocationInput captures the normalized request and its
// bounded audio bytes before an asynchronous Job becomes visible.
type SpeechTranscribeInvocationInput struct {
	PortableConfig *structpb.Struct
	ExactBindings  []InvocationExactBinding
	Request        *runtimev1.SpeechTranscribeScenarioSpec
	AudioBytes     []byte
	MIMEType       string
}

// VoiceCreateInvocationInput is the implementation-neutral Driver input for
// one selected local voice.create configuration. SupportedFeatures is the
// immutable feature set captured from that configuration; the request never
// selects a different model, Driver, configuration, provider, or route.
type VoiceCreateInvocationInput struct {
	PortableConfig    *structpb.Struct
	ExactBindings     []InvocationExactBinding
	SupportedFeatures []string
	Request           *runtimev1.VoiceCreateScenarioSpec
}

type SpeechSynthesizeInvocationPlan struct {
	driverID     string
	modelAssetID string
	modelFiles   []InvocationExactBinding
	request      *runtimev1.SpeechSynthesizeScenarioSpec
}

func (p *SpeechSynthesizeInvocationPlan) DriverID() string {
	if p == nil {
		return ""
	}
	return p.driverID
}

func (p *SpeechSynthesizeInvocationPlan) ModelAssetID() string {
	if p == nil {
		return ""
	}
	return p.modelAssetID
}

func (p *SpeechSynthesizeInvocationPlan) ModelFiles() []InvocationExactBinding {
	if p == nil {
		return nil
	}
	return append([]InvocationExactBinding(nil), p.modelFiles...)
}

func (p *SpeechSynthesizeInvocationPlan) Request() *runtimev1.SpeechSynthesizeScenarioSpec {
	if p == nil {
		return nil
	}
	cloned, _ := proto.Clone(p.request).(*runtimev1.SpeechSynthesizeScenarioSpec)
	return cloned
}

type SpeechTranscribeInvocationPlan struct {
	driverID     string
	modelAssetID string
	modelFiles   []InvocationExactBinding
	request      *runtimev1.SpeechTranscribeScenarioSpec
	audioBytes   []byte
	mimeType     string
}

type VoiceCreateInvocationPlan struct {
	driverID        string
	modelAssetID    string
	modelFiles      []InvocationExactBinding
	request         *runtimev1.VoiceCreateScenarioSpec
	sourceFeature   string
	workflowModelID string
}

func (p *VoiceCreateInvocationPlan) DriverID() string {
	if p == nil {
		return ""
	}
	return p.driverID
}

func (p *VoiceCreateInvocationPlan) ModelAssetID() string {
	if p == nil {
		return ""
	}
	return p.modelAssetID
}

func (p *VoiceCreateInvocationPlan) ModelFiles() []InvocationExactBinding {
	if p == nil {
		return nil
	}
	return append([]InvocationExactBinding(nil), p.modelFiles...)
}

func (p *VoiceCreateInvocationPlan) Request() *runtimev1.VoiceCreateScenarioSpec {
	if p == nil {
		return nil
	}
	cloned, _ := proto.Clone(p.request).(*runtimev1.VoiceCreateScenarioSpec)
	return cloned
}

func (p *VoiceCreateInvocationPlan) SourceFeature() string {
	if p == nil {
		return ""
	}
	return p.sourceFeature
}

func (p *VoiceCreateInvocationPlan) WorkflowModelID() string {
	if p == nil {
		return ""
	}
	return p.workflowModelID
}

func (p *SpeechTranscribeInvocationPlan) DriverID() string {
	if p == nil {
		return ""
	}
	return p.driverID
}

func (p *SpeechTranscribeInvocationPlan) ModelAssetID() string {
	if p == nil {
		return ""
	}
	return p.modelAssetID
}

func (p *SpeechTranscribeInvocationPlan) ModelFiles() []InvocationExactBinding {
	if p == nil {
		return nil
	}
	return append([]InvocationExactBinding(nil), p.modelFiles...)
}

func (p *SpeechTranscribeInvocationPlan) Request() *runtimev1.SpeechTranscribeScenarioSpec {
	if p == nil {
		return nil
	}
	cloned, _ := proto.Clone(p.request).(*runtimev1.SpeechTranscribeScenarioSpec)
	return cloned
}

func (p *SpeechTranscribeInvocationPlan) AudioBytes() []byte {
	if p == nil {
		return nil
	}
	return append([]byte(nil), p.audioBytes...)
}

func (p *SpeechTranscribeInvocationPlan) MIMEType() string {
	if p == nil {
		return ""
	}
	return p.mimeType
}

type SpeechSynthesizeInvocationDriver interface {
	Driver
	PlanSpeechSynthesizeInvocation(SpeechSynthesizeInvocationInput) (*SpeechSynthesizeInvocationPlan, error)
	SpeechStreamMode() SpeechStreamMode
}

type SpeechTranscribeInvocationDriver interface {
	Driver
	PlanSpeechTranscribeInvocation(SpeechTranscribeInvocationInput) (*SpeechTranscribeInvocationPlan, error)
}

type VoiceCreateInvocationDriver interface {
	Driver
	PlanVoiceCreateInvocation(VoiceCreateInvocationInput) (*VoiceCreateInvocationPlan, error)
}

type SpeechStreamMode string

const (
	SpeechStreamUnsupported SpeechStreamMode = "unsupported"
	SpeechStreamSimulated   SpeechStreamMode = "simulated"
	SpeechStreamNative      SpeechStreamMode = "native"
)

// Qwen3TTSDriver owns the exact Qwen3-TTS plain synthesis dialect.
type Qwen3TTSDriver struct{}

func (Qwen3TTSDriver) EffectiveRequestDefaults(*structpb.Struct) map[string]string { return nil }

func (Qwen3TTSDriver) SpeechStreamMode() SpeechStreamMode { return SpeechStreamSimulated }

func (Qwen3TTSDriver) Interpret(input InterpretInput) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	return interpretQwen3Speech(input, Qwen3TTSModelRequirementID, "tts", "tts_model", "TTS model")
}

func (Qwen3TTSDriver) ValidateBinding(requirement *runtimev1.LocalCapabilityRequirement, binding *runtimev1.LocalAssetExactBinding, asset AssetDescriptor) runtimev1.LocalCapabilityReason {
	return validateQwen3SpeechBinding(requirement, binding, asset, Qwen3TTSModelRequirementID, runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_TTS, "tts_model")
}

func (driver Qwen3TTSDriver) ValidateCombination(requirements []*runtimev1.LocalCapabilityRequirement, bindings []*runtimev1.LocalAssetExactBinding, assets []AssetDescriptor) runtimev1.LocalCapabilityReason {
	return validateQwen3SpeechCombination(requirements, bindings, assets, driver.ValidateBinding)
}

func (Qwen3TTSDriver) PlanSpeechSynthesizeInvocation(input SpeechSynthesizeInvocationInput) (*SpeechSynthesizeInvocationPlan, error) {
	if !emptySpeechPortableConfig(input.PortableConfig) {
		return nil, invocationError(InvocationFailureInvalidConfig, fmt.Errorf("qwen3-tts portable config must be empty"))
	}
	binding, err := exactQwen3SpeechBinding(input.ExactBindings, Qwen3TTSModelRequirementID)
	if err != nil {
		return nil, invocationError(InvocationFailureInvalidBinding, err)
	}
	request, err := validateQwen3TTSRequest(input.Request)
	if err != nil {
		return nil, err
	}
	return &SpeechSynthesizeInvocationPlan{
		driverID:     Qwen3TTSDriverID,
		modelAssetID: binding.AssetID,
		modelFiles:   []InvocationExactBinding{binding},
		request:      request,
	}, nil
}

// Qwen3VoiceCreateDriver is one concrete implementation of the generic local
// voice.create Driver contract. Its identity does not become the capability
// identity, and its selected feature set never chooses another configuration.
type Qwen3VoiceCreateDriver struct{}

func (Qwen3VoiceCreateDriver) EffectiveRequestDefaults(*structpb.Struct) map[string]string {
	return nil
}

func (Qwen3VoiceCreateDriver) Interpret(input InterpretInput) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	feature, role, ok := qwen3VoiceCreateFeatureRole(input.SupportedFeatures)
	if !ok {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_FEATURE_UNSUPPORTED
	}
	if !emptySpeechPortableConfig(input.PortableConfig) {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	constraints, _ := structpb.NewStruct(map[string]any{
		"engine": "speech", "artifact_role": role, "source_feature": feature,
	})
	return []*runtimev1.LocalCapabilityRequirement{{
		RequirementId:            Qwen3VoiceCreateModelRequirementID,
		Role:                     runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN,
		ResourceKind:             "tts",
		Policy:                   runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_SUBSTITUTABLE,
		CompatibilityConstraints: constraints,
		DisplayLabel:             "Voice creation model",
	}}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (Qwen3VoiceCreateDriver) ValidateBinding(requirement *runtimev1.LocalCapabilityRequirement, binding *runtimev1.LocalAssetExactBinding, asset AssetDescriptor) runtimev1.LocalCapabilityReason {
	if requirement == nil || requirement.GetRequirementId() != Qwen3VoiceCreateModelRequirementID || requirement.GetCompatibilityConstraints() == nil {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
	}
	role := strings.TrimSpace(requirement.GetCompatibilityConstraints().GetFields()["artifact_role"].GetStringValue())
	if role != Qwen3VoiceCloneArtifactRole && role != Qwen3VoiceDesignArtifactRole {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_FEATURE_UNSUPPORTED
	}
	return validateQwen3SpeechBinding(requirement, binding, asset, Qwen3VoiceCreateModelRequirementID, runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_TTS, role)
}

func (driver Qwen3VoiceCreateDriver) ValidateCombination(requirements []*runtimev1.LocalCapabilityRequirement, bindings []*runtimev1.LocalAssetExactBinding, assets []AssetDescriptor) runtimev1.LocalCapabilityReason {
	return validateQwen3SpeechCombination(requirements, bindings, assets, driver.ValidateBinding)
}

func (Qwen3VoiceCreateDriver) PlanVoiceCreateInvocation(input VoiceCreateInvocationInput) (*VoiceCreateInvocationPlan, error) {
	if !emptySpeechPortableConfig(input.PortableConfig) {
		return nil, invocationError(InvocationFailureInvalidConfig, fmt.Errorf("qwen3-tts voice.create portable config must be empty"))
	}
	feature, _, ok := qwen3VoiceCreateFeatureRole(input.SupportedFeatures)
	if !ok {
		return nil, invocationError(InvocationFailureUnsupported, fmt.Errorf("qwen3-tts voice.create requires exactly one supported source feature"))
	}
	binding, err := exactQwen3SpeechBinding(input.ExactBindings, Qwen3VoiceCreateModelRequirementID)
	if err != nil {
		return nil, invocationError(InvocationFailureInvalidBinding, err)
	}
	request, requestFeature, err := validateQwen3VoiceCreateRequest(input.Request)
	if err != nil {
		return nil, err
	}
	if requestFeature != feature {
		return nil, invocationError(InvocationFailureUnsupported, fmt.Errorf("qwen3-tts voice.create source is unsupported by the selected implementation"))
	}
	workflowModelID := "qwen3-local-voice-design"
	if feature == "input.audio" {
		workflowModelID = "qwen3-local-voice-clone"
	}
	return &VoiceCreateInvocationPlan{
		driverID: Qwen3TTSDriverID, modelAssetID: binding.AssetID,
		modelFiles: []InvocationExactBinding{binding}, request: request,
		sourceFeature: feature, workflowModelID: workflowModelID,
	}, nil
}

// Qwen3ASRDriver owns the exact Qwen3-ASR transcription dialect.
type Qwen3ASRDriver struct{}

func (Qwen3ASRDriver) EffectiveRequestDefaults(*structpb.Struct) map[string]string { return nil }

func (Qwen3ASRDriver) Interpret(input InterpretInput) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	return interpretQwen3Speech(input, Qwen3ASRModelRequirementID, "stt", "stt_model", "STT model")
}

func (Qwen3ASRDriver) ValidateBinding(requirement *runtimev1.LocalCapabilityRequirement, binding *runtimev1.LocalAssetExactBinding, asset AssetDescriptor) runtimev1.LocalCapabilityReason {
	return validateQwen3SpeechBinding(requirement, binding, asset, Qwen3ASRModelRequirementID, runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_STT, "stt_model")
}

func (driver Qwen3ASRDriver) ValidateCombination(requirements []*runtimev1.LocalCapabilityRequirement, bindings []*runtimev1.LocalAssetExactBinding, assets []AssetDescriptor) runtimev1.LocalCapabilityReason {
	return validateQwen3SpeechCombination(requirements, bindings, assets, driver.ValidateBinding)
}

func (Qwen3ASRDriver) PlanSpeechTranscribeInvocation(input SpeechTranscribeInvocationInput) (*SpeechTranscribeInvocationPlan, error) {
	return planQwen3ASRInvocation(input, "qwen3-asr", Qwen3ASRDriverID)
}

// Qwen3ASRTransformersDriver owns the separate Transformers-native Qwen3-ASR dialect.
type Qwen3ASRTransformersDriver struct{}

func (Qwen3ASRTransformersDriver) EffectiveRequestDefaults(*structpb.Struct) map[string]string {
	return nil
}

func (Qwen3ASRTransformersDriver) Interpret(input InterpretInput) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	return interpretQwen3Speech(input, Qwen3ASRModelRequirementID, "stt", "stt_transformers_model", "Transformers-native STT model")
}

func (Qwen3ASRTransformersDriver) ValidateBinding(requirement *runtimev1.LocalCapabilityRequirement, binding *runtimev1.LocalAssetExactBinding, asset AssetDescriptor) runtimev1.LocalCapabilityReason {
	return validateQwen3SpeechBinding(requirement, binding, asset, Qwen3ASRModelRequirementID, runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_STT, "stt_transformers_model")
}

func (driver Qwen3ASRTransformersDriver) ValidateCombination(requirements []*runtimev1.LocalCapabilityRequirement, bindings []*runtimev1.LocalAssetExactBinding, assets []AssetDescriptor) runtimev1.LocalCapabilityReason {
	return validateQwen3SpeechCombination(requirements, bindings, assets, driver.ValidateBinding)
}

func (Qwen3ASRTransformersDriver) PlanSpeechTranscribeInvocation(input SpeechTranscribeInvocationInput) (*SpeechTranscribeInvocationPlan, error) {
	return planQwen3ASRInvocation(input, "qwen3-asr-transformers", Qwen3ASRTransformersDriverID)
}

func planQwen3ASRInvocation(input SpeechTranscribeInvocationInput, family string, driverID string) (*SpeechTranscribeInvocationPlan, error) {
	if !emptySpeechPortableConfig(input.PortableConfig) {
		return nil, invocationError(InvocationFailureInvalidConfig, fmt.Errorf("%s portable config must be empty", family))
	}
	binding, err := exactQwen3SpeechBinding(input.ExactBindings, Qwen3ASRModelRequirementID)
	if err != nil {
		return nil, invocationError(InvocationFailureInvalidBinding, err)
	}
	request, err := validateQwen3ASRRequest(input.Request)
	if err != nil {
		return nil, err
	}
	if len(input.AudioBytes) == 0 {
		return nil, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("%s audio bytes are required", family))
	}
	return &SpeechTranscribeInvocationPlan{
		driverID:     driverID,
		modelAssetID: binding.AssetID,
		modelFiles:   []InvocationExactBinding{binding},
		request:      request,
		audioBytes:   append([]byte(nil), input.AudioBytes...),
		mimeType:     strings.TrimSpace(input.MIMEType),
	}, nil
}

func interpretQwen3Speech(input InterpretInput, requirementID string, resourceKind string, artifactRole string, displayLabel string) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	if len(input.SupportedFeatures) != 0 {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_FEATURE_UNSUPPORTED
	}
	if !emptySpeechPortableConfig(input.PortableConfig) {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	constraints, _ := structpb.NewStruct(map[string]any{"engine": "speech", "artifact_role": artifactRole})
	return []*runtimev1.LocalCapabilityRequirement{{
		RequirementId:            requirementID,
		Role:                     runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN,
		ResourceKind:             resourceKind,
		Policy:                   runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_SUBSTITUTABLE,
		CompatibilityConstraints: constraints,
		DisplayLabel:             displayLabel,
	}}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func emptySpeechPortableConfig(value *structpb.Struct) bool {
	return value == nil || len(value.GetFields()) == 0
}

func validateQwen3SpeechBinding(requirement *runtimev1.LocalCapabilityRequirement, binding *runtimev1.LocalAssetExactBinding, asset AssetDescriptor, requirementID string, kind runtimev1.LocalAssetKind, artifactRole string) runtimev1.LocalCapabilityReason {
	if requirement == nil || binding == nil || requirement.GetRequirementId() != requirementID || binding.GetRequirementId() != requirementID {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
	}
	if binding.GetLocalAssetId() == "" || asset.LocalAssetID == "" {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_NOT_FOUND
	}
	if binding.GetVerifiedContentId() == "" || binding.GetEntrySha256() == "" || asset.VerifiedContentID == "" || asset.EntrySHA256 == "" {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_UNVERIFIED
	}
	if binding.GetLocalAssetId() != asset.LocalAssetID || binding.GetVerifiedContentId() != asset.VerifiedContentID || binding.GetEntrySha256() != asset.EntrySHA256 {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_MISMATCH
	}
	if asset.Kind != kind || asset.Engine != "speech" || !contains(asset.ArtifactRoles, artifactRole) {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func validateQwen3SpeechCombination(requirements []*runtimev1.LocalCapabilityRequirement, bindings []*runtimev1.LocalAssetExactBinding, assets []AssetDescriptor, validate func(*runtimev1.LocalCapabilityRequirement, *runtimev1.LocalAssetExactBinding, AssetDescriptor) runtimev1.LocalCapabilityReason) runtimev1.LocalCapabilityReason {
	if len(requirements) != 1 || len(bindings) != 1 || len(assets) != 1 {
		if len(requirements) == 0 || len(bindings) == 0 {
			return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_REQUIRED_BINDING_MISSING
		}
		if len(assets) == 0 {
			return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_NOT_FOUND
		}
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
	}
	return validate(requirements[0], bindings[0], assets[0])
}

func exactQwen3SpeechBinding(values []InvocationExactBinding, requirementID string) (InvocationExactBinding, error) {
	if len(values) != 1 {
		return InvocationExactBinding{}, fmt.Errorf("speech invocation requires exactly one binding")
	}
	binding := values[0]
	if binding.RequirementID != requirementID || binding.AssetID == "" || binding.AssetID != strings.TrimSpace(binding.AssetID) ||
		binding.LocalAssetID == "" || binding.LocalAssetID != strings.TrimSpace(binding.LocalAssetID) ||
		binding.VerifiedContentID == "" || binding.VerifiedContentID != strings.TrimSpace(binding.VerifiedContentID) ||
		binding.EntrySHA256 == "" || binding.EntrySHA256 != strings.TrimSpace(binding.EntrySHA256) ||
		!canonicalInvocationSHA256(binding.VerifiedContentID, binding.EntrySHA256) ||
		!filepath.IsAbs(binding.AbsolutePath) || filepath.Clean(binding.AbsolutePath) != binding.AbsolutePath {
		return InvocationExactBinding{}, fmt.Errorf("speech invocation binding is not exact")
	}
	return binding, nil
}

func validateQwen3TTSRequest(value *runtimev1.SpeechSynthesizeScenarioSpec) (*runtimev1.SpeechSynthesizeScenarioSpec, error) {
	request, _ := proto.Clone(value).(*runtimev1.SpeechSynthesizeScenarioSpec)
	if request == nil || strings.TrimSpace(request.GetText()) == "" {
		return nil, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("qwen3-tts text is required"))
	}
	format := strings.ToLower(strings.TrimSpace(request.GetAudioFormat()))
	if format != "" && format != "wav" && format != "wave" {
		return nil, invocationError(InvocationFailureUnsupported, fmt.Errorf("qwen3-tts supports only wav output"))
	}
	timingMode := request.GetTimingMode()
	if request.SampleRateHz != nil || request.Speed != nil || request.Pitch != nil || request.Volume != nil ||
		(timingMode != runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_UNSPECIFIED &&
			timingMode != runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_NONE) ||
		request.GetVoiceRenderHints() != nil {
		return nil, invocationError(InvocationFailureUnsupported, fmt.Errorf("qwen3-tts request contains unsupported synthesis options"))
	}
	if ref := request.GetVoiceRef(); ref != nil {
		switch ref.GetKind() {
		case runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_UNSPECIFIED:
		case runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET:
			if strings.TrimSpace(ref.GetPresetVoiceId()) == "" {
				return nil, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("qwen3-tts preset voice is empty"))
			}
		case runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PROVIDER_VOICE_REF:
			if strings.TrimSpace(ref.GetProviderVoiceRef()) == "" {
				return nil, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("qwen3-tts provider voice ref is empty"))
			}
		default:
			return nil, invocationError(InvocationFailureUnsupported, fmt.Errorf("qwen3-tts voice reference kind is unsupported"))
		}
	}
	return request, nil
}

func qwen3VoiceCreateFeatureRole(features []string) (string, string, bool) {
	if len(features) != 1 {
		return "", "", false
	}
	switch strings.TrimSpace(features[0]) {
	case "input.audio":
		return "input.audio", Qwen3VoiceCloneArtifactRole, true
	case "input.text":
		return "input.text", Qwen3VoiceDesignArtifactRole, true
	default:
		return "", "", false
	}
}

func validateQwen3VoiceCreateRequest(value *runtimev1.VoiceCreateScenarioSpec) (*runtimev1.VoiceCreateScenarioSpec, string, error) {
	request, _ := proto.Clone(value).(*runtimev1.VoiceCreateScenarioSpec)
	if request == nil || strings.TrimSpace(request.GetTargetModelId()) != "" {
		return nil, "", invocationError(InvocationFailureInvalidRequest, fmt.Errorf("local qwen3-tts voice.create does not accept request target selection"))
	}
	switch source := request.GetSource().(type) {
	case *runtimev1.VoiceCreateScenarioSpec_ReferenceAudio:
		input := source.ReferenceAudio
		if input == nil || len(input.GetReferenceAudioBytes()) == 0 || strings.TrimSpace(input.GetReferenceAudioUri()) != "" ||
			strings.TrimSpace(input.GetReferenceAudioMime()) == "" {
			return nil, "", invocationError(InvocationFailureInvalidRequest, fmt.Errorf("local qwen3-tts reference audio must be captured as typed bytes"))
		}
		return request, "input.audio", nil
	case *runtimev1.VoiceCreateScenarioSpec_TextDescription:
		input := source.TextDescription
		if input == nil || strings.TrimSpace(input.GetInstructionText()) == "" {
			return nil, "", invocationError(InvocationFailureInvalidRequest, fmt.Errorf("local qwen3-tts voice design instruction is required"))
		}
		return request, "input.text", nil
	default:
		return nil, "", invocationError(InvocationFailureInvalidRequest, fmt.Errorf("local qwen3-tts voice.create source is required"))
	}
}

func validateQwen3ASRRequest(value *runtimev1.SpeechTranscribeScenarioSpec) (*runtimev1.SpeechTranscribeScenarioSpec, error) {
	request, _ := proto.Clone(value).(*runtimev1.SpeechTranscribeScenarioSpec)
	if request == nil {
		return nil, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("qwen3-asr request is required"))
	}
	format := strings.ToLower(strings.TrimSpace(request.GetResponseFormat()))
	if format != "" && format != "text" {
		return nil, invocationError(InvocationFailureUnsupported, fmt.Errorf("qwen3-asr response format is unsupported"))
	}
	if request.GetTimestamps() || request.GetDiarization() || request.GetSpeakerCount() != 0 || strings.TrimSpace(request.GetPrompt()) != "" {
		return nil, invocationError(InvocationFailureUnsupported, fmt.Errorf("qwen3-asr request contains unsupported transcription options"))
	}
	return request, nil
}
