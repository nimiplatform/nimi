package capabilitydriver

import (
	"encoding/json"
	"fmt"
	"io"
	"path/filepath"
	"strconv"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.faster-whisper-sherpa-diarization
const (
	FasterWhisperSherpaImplementationID = "local.audio.transcribe.faster-whisper-sherpa"
	FasterWhisperSherpaDriverID         = "nimi.runtime.driver.faster-whisper-sherpa"
	FasterWhisperSherpaDriverDialect    = "faster-whisper-sherpa/audio-transcribe/v1"
	FasterWhisperSherpaRecipeID         = "faster-whisper-sherpa-diarized"
	SpeechSegmenterSlot                 = "stt.segmenter"
	SpeechSpeakerEncoderSlot            = "stt.speaker.encoder"
	WhisperDiarizationConsumerID        = "speech.faster-whisper-sherpa.python"
)

type FasterWhisperSherpaDriver struct{}

func (FasterWhisperSherpaDriver) EffectiveRequestDefaults(string, *structpb.Struct) map[string]string {
	return nil
}
func (FasterWhisperSherpaDriver) ImplementationSupportedFeatures(recipe string) ([]string, runtimev1.LocalCapabilityReason) {
	if recipe != FasterWhisperSherpaRecipeID {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED
	}
	return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}
func (driver FasterWhisperSherpaDriver) Interpret(input InterpretInput) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	return driver.ProjectRecipe(input.RecipeID, input.PortableConfig, input.SupportedFeatures)
}
func (FasterWhisperSherpaDriver) ProjectRecipe(recipe string, options *structpb.Struct, features []string) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	if recipe != FasterWhisperSherpaRecipeID {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	requirements, reason := (FasterWhisperDriver{}).ProjectRecipe(FasterWhisperRecipeID, options, features)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return nil, reason
	}
	for _, entry := range []struct{ id, role, label string }{{SpeechSegmenterSlot, "speech_speaker_segmenter", "Speaker segmentation model"}, {SpeechSpeakerEncoderSlot, "speaker_representation_encoder", "Speaker representation encoder"}} {
		constraints, _ := structpb.NewStruct(map[string]any{"format": "onnx", "artifact_role": entry.role})
		requirements = append(requirements, &runtimev1.LocalCapabilityRequirement{RequirementId: entry.id, DisplayLabel: entry.label, ResourceKind: "auxiliary", Role: runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_COMPANION, Presence: runtimev1.LocalCapabilityRequirementPresence_LOCAL_CAPABILITY_REQUIREMENT_PRESENCE_REQUIRED, Policy: runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_SUBSTITUTABLE, CompatibilityConstraints: constraints})
	}
	return requirements, reason
}
func (FasterWhisperSherpaDriver) ProbeModelAsset(input ModelAssetFormatProbeInput, source io.ReaderAt, size int64) ([]byte, error) {
	if input.RequirementID == SpeechSegmenterSlot || input.RequirementID == SpeechSpeakerEncoderSlot {
		if !input.Entry {
			return nil, fmt.Errorf("speaker models require their exact ONNX entry")
		}
		return probeONNXModel(source, size)
	}
	return (FasterWhisperDriver{}).ProbeModelAsset(input, source, size)
}
func speakerSegmentationFacts(probe []byte) bool {
	var model onnxModel
	if json.Unmarshal(probe, &model) != nil || model.IRVersion == 0 || len(model.Inputs) != 1 || len(model.Outputs) != 1 {
		return false
	}
	m := model.Metadata
	if m["model_type"] != "pyannote-segmentation-3.0" || m["version"] != "1" || m["sample_rate"] != "16000" {
		return false
	}
	values := map[string]int{}
	for _, key := range []string{"window_size", "receptive_field_size", "receptive_field_shift", "num_speakers", "num_classes", "powerset_max_classes"} {
		value, err := strconv.Atoi(m[key])
		if err != nil || value < 1 {
			return false
		}
		values[key] = value
	}
	speakers, classes, powerset := values["num_speakers"], values["num_classes"], values["powerset_max_classes"]
	if speakers > 16 || (powerset != 1 && powerset != 2) || classes != 1+speakers+func() int {
		if powerset == 2 {
			return speakers * (speakers - 1) / 2
		}
		return 0
	}() {
		return false
	}
	if values["window_size"] > 16000*30 || values["receptive_field_size"] > values["window_size"] || values["receptive_field_shift"] > values["window_size"] {
		return false
	}
	in, out := model.Inputs[0], model.Outputs[0]
	if in.Type != 1 || out.Type != 1 || len(in.Shape) != 3 || len(out.Shape) != 3 || in.Shape[1] != 1 || in.Shape[2] != -1 || out.Shape[1] != -1 || out.Shape[2] != int64(classes) || (in.Shape[0] != 1 && in.Shape[0] != -1) || (out.Shape[0] != 1 && out.Shape[0] != -1) {
		return false
	}
	// The official export retains unused converter opset declarations. Only
	// domains actually used by graph nodes determine executable compatibility.
	if model.Opsets[""] == 0 {
		return false
	}
	for _, domain := range model.NodeDomains {
		if domain != "" {
			return false
		}
	}
	return true
}
func (driver FasterWhisperSherpaDriver) ProjectModelAssetBinding(input ModelAssetBindingInput) (ModelAssetBindingProjection, runtimev1.LocalCapabilityReason) {
	id := input.Requirement.GetRequirementId()
	if id == Qwen3ASRModelRequirementID || id == FasterWhisperVADRequirementID {
		return (FasterWhisperDriver{}).ProjectModelAssetBinding(input)
	}
	role, valid := "", false
	if id == SpeechSegmenterSlot {
		role = "speech_speaker_segmenter"
		valid = speakerSegmentationFacts(input.Entry.FormatProbe)
	}
	if id == SpeechSpeakerEncoderSlot {
		role = "speaker_representation_encoder"
		_, valid = speakerEncoderDimension(input.Entry.FormatProbe)
	}
	if !valid {
		return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	return validatedModelAssetBindingProjection(input, ModelAssetDescriptor{Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_AUXILIARY, Engine: "speech", ArtifactRoles: []string{role}, FormatProbe: input.Entry.FormatProbe}, 0, driver.ValidateBinding)
}
func (FasterWhisperSherpaDriver) ValidateBinding(requirement *runtimev1.LocalCapabilityRequirement, binding *runtimev1.ModelAssetExactBinding, asset ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	id := requirement.GetRequirementId()
	if id == Qwen3ASRModelRequirementID || id == FasterWhisperVADRequirementID {
		return (FasterWhisperDriver{}).ValidateBinding(requirement, binding, asset)
	}
	role, valid := "", false
	if id == SpeechSegmenterSlot {
		role = "speech_speaker_segmenter"
		valid = speakerSegmentationFacts(asset.FormatProbe)
	}
	if id == SpeechSpeakerEncoderSlot {
		role = "speaker_representation_encoder"
		_, valid = speakerEncoderDimension(asset.FormatProbe)
	}
	if !valid {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	return validateQwen3SpeechBinding(requirement, binding, asset, id, runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_AUXILIARY, role)
}
func (driver FasterWhisperSherpaDriver) ValidateCombination(requirements []*runtimev1.LocalCapabilityRequirement, bindings []*runtimev1.ModelAssetExactBinding, assets []ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	if len(requirements) != 4 || len(bindings) != 4 || len(assets) != 4 {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_REQUIRED_BINDING_MISSING
	}
	seen := map[string]bool{}
	for _, requirement := range requirements {
		id := requirement.GetRequirementId()
		if seen[id] {
			return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
		}
		seen[id] = true
		var matched *runtimev1.ModelAssetExactBinding
		for _, binding := range bindings {
			if binding.GetRequirementId() == id {
				if matched != nil {
					return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
				}
				matched = binding
			}
		}
		if matched == nil {
			return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_REQUIRED_BINDING_MISSING
		}
		found := false
		for _, asset := range assets {
			if asset.ModelAssetID == matched.GetModelAssetId() {
				found = true
				if reason := driver.ValidateBinding(requirement, matched, asset); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
					return reason
				}
			}
		}
		if !found {
			return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_NOT_FOUND
		}
	}
	return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}
func (FasterWhisperSherpaDriver) PlanSpeechTranscribeInvocation(input SpeechTranscribeInvocationInput) (*SpeechTranscribeInvocationPlan, error) {
	if len(input.ExactBindings) != 4 || input.Request == nil {
		return nil, invocationError(InvocationFailureInvalidConfig, fmt.Errorf("diarized Whisper requires four exact captured bindings"))
	}
	request := proto.Clone(input.Request).(*runtimev1.SpeechTranscribeScenarioSpec)
	if request.GetSpeakerCount() < 0 || request.GetSpeakerCount() > 32 || (!request.GetDiarization() && request.GetSpeakerCount() != 0) {
		return nil, invocationError(InvocationFailureUnsupported, fmt.Errorf("speaker count requires admitted diarization"))
	}
	var ordered []InvocationExactBinding
	for _, id := range []string{Qwen3ASRModelRequirementID, FasterWhisperVADRequirementID, SpeechSegmenterSlot, SpeechSpeakerEncoderSlot} {
		var matching []InvocationExactBinding
		for _, binding := range input.ExactBindings {
			if binding.RequirementID == id {
				matching = append(matching, binding)
			}
		}
		binding, err := exactQwen3SpeechBinding(matching, id)
		if err != nil {
			return nil, invocationError(InvocationFailureInvalidBinding, err)
		}
		ordered = append(ordered, binding)
	}
	plain := proto.Clone(request).(*runtimev1.SpeechTranscribeScenarioSpec)
	plain.Diarization = nil
	plain.SpeakerCount = nil
	baseInput := input
	baseInput.ExactBindings = ordered[:2]
	baseInput.Request = plain
	plan, err := (FasterWhisperDriver{}).PlanSpeechTranscribeInvocation(baseInput)
	if err != nil {
		return nil, err
	}
	plan.driverID = FasterWhisperSherpaDriverID
	plan.modelFiles = ordered
	plan.request = request
	var profile *InvocationExactDependencySource
	for i := range input.DependencySources {
		source := &input.DependencySources[i]
		if source.DependencyFamily == "python.package-set" && source.ConsumerScope == WhisperDiarizationConsumerID {
			if profile != nil {
				return nil, invocationError(InvocationFailureInvalidConfig, fmt.Errorf("captured diarized Whisper profile is ambiguous"))
			}
			profile = source
		}
	}
	if profile == nil || !filepath.IsAbs(profile.CanonicalRoot) || profile.SelectedSourceRecordID == "" || profile.Version != profile.Hashes["profile_digest"] || profile.Hashes["profile_digest"] == "" || profile.Hashes["driver_bundle_sha256"] == "" {
		return nil, invocationError(InvocationFailureInvalidConfig, fmt.Errorf("diarized Whisper requires its exact captured managed CPU profile"))
	}
	plan.dependencySources = cloneInvocationExactDependencySources([]InvocationExactDependencySource{*profile})
	return plan, nil
}
