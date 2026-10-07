package capabilitydriver

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"path/filepath"
	"strconv"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

const (
	VoiceConvertCapabilityContract = "audio.voice.convert"
	VeVo2ImplementationID          = "local.audio.voice.convert.vevo2.audio-cpp"
	VeVo2DriverID                  = "nimi.runtime.driver.audio-cpp.vevo2"
	VeVo2DriverDialect             = "audio.cpp/vevo2/voice-convert/v1"
	VeVo2RecipeID                  = "vevo2.audio-cpp.v1"
	VeVo2RequirementID             = "voice.model"
	AudioCppMacOSPackageID         = "audio-cpp-0.8.1-darwin-arm64-cpu-metal"
	VeVo2VerifiedContentID         = "sha256:f80a70facaaecfcf1aa417ef16ef091318c5e789b24c16a741233c64a72fcee8"
	VeVo2ModelBytes                = int64(3242124800)
)

// @nimi-authority: rule.nimi.runtime.ai-provider.voice-conversion
type VeVo2AudioCppDriver struct{}

var _ VoiceConvertInvocationDriver = VeVo2AudioCppDriver{}

func (VeVo2AudioCppDriver) ImplementationSupportedFeatures(recipe string) ([]string, runtimev1.LocalCapabilityReason) {
	if recipe != VeVo2RecipeID {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED
	}
	return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}
func (d VeVo2AudioCppDriver) ProjectRecipe(recipe string, options *structpb.Struct, features []string) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	return d.Interpret(InterpretInput{RecipeID: recipe, PortableConfig: options, SupportedFeatures: features})
}

// @nimi-authority: rule.nimi.runtime.local-compute.vevo2-macos-cpu
func (d VeVo2AudioCppDriver) ProjectRecipeForHost(recipe string, options *structpb.Struct, features []string, platform string) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	if platform != "windows/amd64" && platform != "darwin/arm64" {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED
	}
	return d.ProjectRecipe(recipe, options, features)
}

func (VeVo2AudioCppDriver) Interpret(input InterpretInput) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	if input.RecipeID != VeVo2RecipeID || !musicStructIsEmpty(input.PortableConfig) {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	if len(input.SupportedFeatures) != 0 {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_FEATURE_UNSUPPORTED
	}
	constraints, _ := structpb.NewStruct(map[string]any{"asset_kind": "music", "model_family": "vevo2", "artifact_role": "music_model", "format": "gguf"})
	return []*runtimev1.LocalCapabilityRequirement{{RequirementId: VeVo2RequirementID,
		Role:         runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN,
		Presence:     runtimev1.LocalCapabilityRequirementPresence_LOCAL_CAPABILITY_REQUIREMENT_PRESENCE_REQUIRED,
		ResourceKind: "music", Policy: runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_STRICT,
		CompatibilityConstraints: constraints, DisplayLabel: "VeVo2 q8 GGUF"}}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}
func (d VeVo2AudioCppDriver) ProjectModelAssetBinding(input ModelAssetBindingInput) (ModelAssetBindingProjection, runtimev1.LocalCapabilityReason) {
	if len(input.Files) != 1 || input.Entry.SizeBytes != VeVo2ModelBytes || !musicGGUFProbe(input.Entry.FormatProbe) || input.Binding.GetVerifiedContentId() != VeVo2VerifiedContentID {
		return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_MISMATCH
	}
	return validatedModelAssetBindingProjection(input, ModelAssetDescriptor{Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_MUSIC,
		Family: "vevo2", Engine: "audio-cpp", ArtifactRoles: []string{"music_model"}, FormatProbe: input.Entry.FormatProbe}, 0, d.ValidateBinding)
}
func (VeVo2AudioCppDriver) ValidateBinding(requirement *runtimev1.LocalCapabilityRequirement, binding *runtimev1.ModelAssetExactBinding, asset ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	if requirement.GetRequirementId() != VeVo2RequirementID || binding.GetRequirementId() != VeVo2RequirementID || binding.GetVerifiedContentId() != VeVo2VerifiedContentID || asset.Kind != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_MUSIC || asset.Family != "vevo2" || asset.Engine != "audio-cpp" || !contains(asset.ArtifactRoles, "music_model") || !musicGGUFProbe(asset.FormatProbe) {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}
func (d VeVo2AudioCppDriver) ValidateCombination(requirements []*runtimev1.LocalCapabilityRequirement, bindings []*runtimev1.ModelAssetExactBinding, assets []ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	if len(requirements) != 1 || len(bindings) != 1 || len(assets) != 1 {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
	}
	return d.ValidateBinding(requirements[0], bindings[0], assets[0])
}
func (VeVo2AudioCppDriver) EffectiveRequestDefaults(string, *structpb.Struct) map[string]string {
	return nil
}
func (VeVo2AudioCppDriver) MusicInputCapabilities() *runtimev1.MusicInputCapabilities {
	return &runtimev1.MusicInputCapabilities{VoiceConvert: []*runtimev1.VoiceConvertInputProfile{{
		SourceKinds: []string{"singing"}, TargetKinds: []string{"reference-audio"},
		MaxSourceSeconds: 600, MaxTargetSeconds: 600, SupportsRange: true,
		SupportsSemitoneShift: true, MinSemitoneShift: -12, MaxSemitoneShift: 12,
		MaxSourceBytes: 512 << 20, MaxTargetBytes: 512 << 20,
	}}}
}

func (VeVo2AudioCppDriver) PlanVoiceConvertInvocation(input VoiceConvertInvocationInput) (*MusicInvocationPlan, error) {
	bad := func(kind InvocationFailureKind, message string) (*MusicInvocationPlan, error) {
		return nil, invocationError(kind, fmt.Errorf("VeVo2 %s", message))
	}
	if input.RecipeID != VeVo2RecipeID || !musicStructIsEmpty(input.PortableConfig) {
		return bad(InvocationFailureInvalidConfig, "recipe or configuration is invalid")
	}
	if len(input.ExactBindings) != 1 || input.ExactBindings[0].RequirementID != VeVo2RequirementID || input.ExactBindings[0].VerifiedContentID != VeVo2VerifiedContentID {
		return bad(InvocationFailureInvalidBinding, "requires the exact original-dtype model")
	}
	binding := cloneInvocationExactBindings(input.ExactBindings)[0]
	if !filepath.IsAbs(binding.AbsolutePath) || len(binding.DeclaredFiles) != 1 {
		return bad(InvocationFailureInvalidBinding, "model entry is invalid")
	}
	pkg := input.Package
	request, sourceInfo, targetInfo, err := validateNativeVoiceConvertInput(input, 600)
	if err != nil {
		return nil, err
	}
	shift := request.GetSemitoneShift()
	outPath := filepath.Join(input.StagingDir, "vocal.wav")
	hasher := sha256.New()
	for _, value := range append(invocationExactBindingIdentity(binding), pkg.AudioCppVersion, pkg.AudioCppPackageID, pkg.AudioCppSelectedSourceRecordID, pkg.CUDA13SelectedSourceRecordID, VeVo2DriverDialect) {
		_, _ = hasher.Write([]byte(value))
		_, _ = hasher.Write([]byte{0})
	}
	plan := &MusicInvocationPlan{processKey: hex.EncodeToString(hasher.Sum(nil)), loadoutID: input.LoadoutID, recipeID: VeVo2RecipeID,
		driverIdentity: Identity{ImplementationID: VeVo2ImplementationID, DriverID: VeVo2DriverID, DriverDialect: VeVo2DriverDialect},
		modelBinding:   binding, modelRoot: binding.AbsolutePath, audioCppPackageID: pkg.AudioCppPackageID, audioCppSelectedSourceRecordID: pkg.AudioCppSelectedSourceRecordID,
		audioCppRoot: pkg.AudioCppRoot, audioCppExecutablePath: pkg.AudioCppExecutablePath, cuda13DependencyID: pkg.CUDA13DependencyID,
		cuda13SelectedSourceRecordID: pkg.CUDA13SelectedSourceRecordID, cuda13Root: pkg.CUDA13Root,
		stagingWAVPath: outPath, expectedSampleRate: 24000, expectedChannels: 1, expectedBitsPerSample: 32}
	plan.voiceConvert = &voiceConvertPlan{sourcePath: input.SourcePath, targetPath: input.TargetPath, outPath: outPath, request: request, sourceInfo: sourceInfo, targetInfo: targetInfo}
	backend := "cuda"
	if pkg.AudioCppPackageID == AudioCppMacOSPackageID {
		backend = "cpu"
	}
	usePitchShift := shift != 0
	args := []string{"--task", "svc", "--family", "vevo2", "--task-route", "style_preserved_svc", "--model", binding.AbsolutePath, "--backend", backend,
		"--source-audio", input.SourcePath, "--target-voice", input.TargetPath, "--seed", "42", "--num-inference-steps", "32",
		"--request-option", "use_pitch_shift=" + strconv.FormatBool(usePitchShift),
		"--request-option", "source_shift_steps=" + strconv.FormatInt(int64(shift), 10),
		"--request-option", "audio_chunk_duration_sec=20",
		"--request-option", "cross_fade_duration_sec=0.25",
		"--out", outPath, "--out-format", "float32"}
	plan.cliArgs = args
	return plan, nil
}
