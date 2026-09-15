package capabilitydriver

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"path"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.faster-whisper-transcription
const (
	FasterWhisperImplementationID = "local.audio.transcribe.faster-whisper"
	FasterWhisperDriverID         = "nimi.runtime.driver.faster-whisper"
	FasterWhisperDriverDialect    = "faster-whisper/audio-transcribe/v1"
	FasterWhisperRecipeID         = "faster-whisper-vad"
	FasterWhisperVADRequirementID = "stt.vad"
)

type FasterWhisperDriver struct{}

func (FasterWhisperDriver) EffectiveRequestDefaults(string, *structpb.Struct) map[string]string {
	return nil
}

func (FasterWhisperDriver) ImplementationSupportedFeatures(recipe string) ([]string, runtimev1.LocalCapabilityReason) {
	if recipe != FasterWhisperRecipeID {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED
	}
	return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (FasterWhisperDriver) Interpret(input InterpretInput) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	if !emptySpeechPortableConfig(input.PortableConfig) {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	if len(input.SupportedFeatures) != 0 {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_FEATURE_UNSUPPORTED
	}
	var result []*runtimev1.LocalCapabilityRequirement
	for _, id := range []string{Qwen3ASRModelRequirementID, FasterWhisperVADRequirementID} {
		kind, role, format, label := fasterWhisperSlot(id)
		constraints, _ := structpb.NewStruct(map[string]any{"engine": "speech", "format": format, "artifact_role": role})
		resourceKind := "stt"
		position := runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN
		if kind == runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_AUXILIARY {
			resourceKind = "auxiliary"
			position = runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_COMPANION
		}
		result = append(result, &runtimev1.LocalCapabilityRequirement{RequirementId: id, Role: position,
			Presence:     runtimev1.LocalCapabilityRequirementPresence_LOCAL_CAPABILITY_REQUIREMENT_PRESENCE_REQUIRED,
			ResourceKind: resourceKind, Policy: runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_SUBSTITUTABLE,
			CompatibilityConstraints: constraints, DisplayLabel: label})
	}
	return result, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (driver FasterWhisperDriver) ProjectRecipe(recipe string, options *structpb.Struct, features []string) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	if recipe != FasterWhisperRecipeID {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	return driver.Interpret(InterpretInput{PortableConfig: options, SupportedFeatures: features})
}

func fasterWhisperSlot(id string) (runtimev1.LocalAssetKind, string, string, string) {
	if id == Qwen3ASRModelRequirementID {
		return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_STT, "whisper_ct2_model", "ctranslate2", "Whisper recognition model"
	}
	if id == FasterWhisperVADRequirementID {
		return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_AUXILIARY, "silero_vad_model", "onnx", "Voice activity detection model"
	}
	return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_UNSPECIFIED, "", "", ""
}

func (FasterWhisperDriver) ProbeModelAsset(input ModelAssetFormatProbeInput, source io.ReaderAt, size int64) ([]byte, error) {
	if input.Entry && input.RequirementID == FasterWhisperVADRequirementID {
		return probeONNXModel(source, size)
	}
	if size <= 0 {
		return nil, fmt.Errorf("empty Whisper model file")
	}
	length := min(size, int64(MaxAssetFormatProbeBytes))
	data := make([]byte, length)
	_, err := source.ReadAt(data, 0)
	return data, err
}

func whisperCT2Header(probe []byte) bool {
	if len(probe) < 6 || binary.LittleEndian.Uint32(probe[:4]) != 6 {
		return false
	}
	n := int(binary.LittleEndian.Uint16(probe[4:6]))
	return n == len("WhisperSpec")+1 && len(probe) >= 6+n+8 && bytes.Equal(probe[6:6+n], []byte("WhisperSpec\x00")) && binary.LittleEndian.Uint32(probe[6+n:]) == 3 && binary.LittleEndian.Uint32(probe[10+n:]) > 0
}

func sileroONNXInterface(probe []byte) bool {
	var model onnxModel
	if json.Unmarshal(probe, &model) != nil || model.IRVersion == 0 || len(model.Inputs) != 3 || len(model.Outputs) != 2 {
		return false
	}
	inputs := map[string]uint64{"input": 1, "state": 1, "sr": 7}
	outputs := map[string]uint64{"output": 1, "stateN": 1}
	for _, tensor := range model.Inputs {
		if inputs[tensor.Name] != tensor.Type {
			return false
		}
		delete(inputs, tensor.Name)
	}
	for _, tensor := range model.Outputs {
		if outputs[tensor.Name] != tensor.Type {
			return false
		}
		delete(outputs, tensor.Name)
	}
	return len(inputs) == 0 && len(outputs) == 0
}

func (driver FasterWhisperDriver) ProjectModelAssetBinding(input ModelAssetBindingInput) (ModelAssetBindingProjection, runtimev1.LocalCapabilityReason) {
	id := input.Requirement.GetRequirementId()
	kind, role, _, _ := fasterWhisperSlot(id)
	valid := false
	if id == Qwen3ASRModelRequirementID && path.Base(input.Entry.RelativePath) == "model.bin" && whisperCT2Header(input.Entry.FormatProbe) {
		valid = true
		for _, name := range []string{"config.json", "tokenizer.json", "preprocessor_config.json"} {
			if _, ok := modelAssetFileFact(input, name); !ok {
				valid = false
			}
		}
	} else if id == FasterWhisperVADRequirementID {
		valid = path.Ext(input.Entry.RelativePath) == ".onnx" && sileroONNXInterface(input.Entry.FormatProbe)
	}
	if !valid || role == "" {
		return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	return validatedModelAssetBindingProjection(input, ModelAssetDescriptor{Kind: kind, Engine: "speech", ArtifactRoles: []string{role}, FormatProbe: input.Entry.FormatProbe}, 0, driver.ValidateBinding)
}

func (FasterWhisperDriver) ValidateBinding(requirement *runtimev1.LocalCapabilityRequirement, binding *runtimev1.ModelAssetExactBinding, asset ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	id := requirement.GetRequirementId()
	kind, role, _, _ := fasterWhisperSlot(id)
	if role == "" {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
	}
	return validateQwen3SpeechBinding(requirement, binding, asset, id, kind, role)
}

func (driver FasterWhisperDriver) ValidateCombination(requirements []*runtimev1.LocalCapabilityRequirement, bindings []*runtimev1.ModelAssetExactBinding, assets []ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	if len(requirements) != 2 || len(bindings) != 2 || len(assets) != 2 {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_REQUIRED_BINDING_MISSING
	}
	seen := map[string]bool{}
	for _, requirement := range requirements {
		id := requirement.GetRequirementId()
		_, role, _, _ := fasterWhisperSlot(id)
		if seen[id] || role == "" {
			return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
		}
		seen[id] = true
		var match *runtimev1.ModelAssetExactBinding
		for _, candidate := range bindings {
			if candidate.GetRequirementId() == id {
				if match != nil {
					return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
				}
				match = candidate
			}
		}
		if match == nil {
			return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_REQUIRED_BINDING_MISSING
		}
		found := false
		for _, asset := range assets {
			if asset.ModelAssetID == match.GetModelAssetId() {
				found = true
				if reason := driver.ValidateBinding(requirement, match, asset); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
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

func (FasterWhisperDriver) PlanSpeechTranscribeInvocation(input SpeechTranscribeInvocationInput) (*SpeechTranscribeInvocationPlan, error) {
	if !emptySpeechPortableConfig(input.PortableConfig) || len(input.ExactBindings) != 2 {
		return nil, invocationError(InvocationFailureInvalidConfig, fmt.Errorf("Whisper requires captured recognition and VAD bindings"))
	}
	var ordered []InvocationExactBinding
	for _, id := range []string{Qwen3ASRModelRequirementID, FasterWhisperVADRequirementID} {
		var selected []InvocationExactBinding
		for _, binding := range input.ExactBindings {
			if binding.RequirementID == id {
				selected = append(selected, binding)
			}
		}
		binding, err := exactQwen3SpeechBinding(selected, id)
		if err != nil {
			return nil, invocationError(InvocationFailureInvalidBinding, err)
		}
		ordered = append(ordered, binding)
	}
	request, _ := proto.Clone(input.Request).(*runtimev1.SpeechTranscribeScenarioSpec)
	if request == nil || len(input.AudioBytes) == 0 {
		return nil, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("Whisper requires audio"))
	}
	format := strings.ToLower(strings.TrimSpace(request.GetResponseFormat()))
	if (format != "" && format != "text" && format != "json") || request.GetDiarization() || request.GetSpeakerCount() != 0 || strings.TrimSpace(request.GetPrompt()) != "" {
		return nil, invocationError(InvocationFailureUnsupported, fmt.Errorf("Whisper transcription options are unsupported"))
	}
	return &SpeechTranscribeInvocationPlan{driverID: FasterWhisperDriverID, modelAssetID: ordered[0].ModelAssetID, modelFiles: ordered, request: request, audioBytes: append([]byte(nil), input.AudioBytes...), mimeType: strings.TrimSpace(input.MIMEType)}, nil
}
