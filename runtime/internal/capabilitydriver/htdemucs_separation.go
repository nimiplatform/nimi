package capabilitydriver

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"path/filepath"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.audio-separation
const (
	HTDemucsImplementationID   = "local.audio.separate.htdemucs.audio-cpp"
	HTDemucsDriverID           = "nimi.runtime.driver.audio-cpp.htdemucs"
	HTDemucsDriverDialect      = "audio.cpp/htdemucs/audio-separate/v1"
	HTDemucsRecipeID           = "htdemucs.audio-cpp.v1"
	HTDemucsModelRequirementID = "separation.model"
	HTDemucsVerifiedContentID  = "sha256:b0f532ac6e5f373aeb11fa0df73253251e133832d9c8b9942dc58f50bc5b4388"
	HTDemucsModelBytes         = int64(61940768)
	HTDemucsRequiredRateHz     = 44100
)

type HTDemucsAudioCppDriver struct{}

var _ AudioSeparateInvocationDriver = HTDemucsAudioCppDriver{}

func (HTDemucsAudioCppDriver) ImplementationSupportedFeatures(recipe string) ([]string, runtimev1.LocalCapabilityReason) {
	if recipe != HTDemucsRecipeID {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED
	}
	return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}
func (d HTDemucsAudioCppDriver) ProjectRecipe(recipe string, options *structpb.Struct, features []string) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	return d.Interpret(InterpretInput{RecipeID: recipe, PortableConfig: options, SupportedFeatures: features})
}
func (HTDemucsAudioCppDriver) Interpret(input InterpretInput) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	if input.RecipeID != HTDemucsRecipeID || !musicStructIsEmpty(input.PortableConfig) {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	if len(input.SupportedFeatures) != 0 {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_FEATURE_UNSUPPORTED
	}
	constraints, _ := structpb.NewStruct(map[string]any{"asset_kind": "music", "model_family": "htdemucs", "artifact_role": "music_model", "format": "gguf"})
	return []*runtimev1.LocalCapabilityRequirement{{RequirementId: HTDemucsModelRequirementID,
		Role:         runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN,
		Presence:     runtimev1.LocalCapabilityRequirementPresence_LOCAL_CAPABILITY_REQUIREMENT_PRESENCE_REQUIRED,
		ResourceKind: "music", Policy: runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_STRICT,
		CompatibilityConstraints: constraints, DisplayLabel: "HTDemucs q8 GGUF"}}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}
func (d HTDemucsAudioCppDriver) ProjectModelAssetBinding(input ModelAssetBindingInput) (ModelAssetBindingProjection, runtimev1.LocalCapabilityReason) {
	if len(input.Files) != 1 || input.Entry.SizeBytes != HTDemucsModelBytes || !musicGGUFProbe(input.Entry.FormatProbe) || input.Binding.GetVerifiedContentId() != HTDemucsVerifiedContentID {
		return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_MISMATCH
	}
	return validatedModelAssetBindingProjection(input, ModelAssetDescriptor{Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_MUSIC,
		Family: "htdemucs", Engine: "audio-cpp", ArtifactRoles: []string{"music_model"}, FormatProbe: input.Entry.FormatProbe}, 0, d.ValidateBinding)
}
func (HTDemucsAudioCppDriver) ValidateBinding(requirement *runtimev1.LocalCapabilityRequirement, binding *runtimev1.ModelAssetExactBinding, asset ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	if requirement.GetRequirementId() != HTDemucsModelRequirementID || binding.GetRequirementId() != HTDemucsModelRequirementID || binding.GetVerifiedContentId() != HTDemucsVerifiedContentID || asset.Kind != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_MUSIC || asset.Family != "htdemucs" || asset.Engine != "audio-cpp" || !contains(asset.ArtifactRoles, "music_model") || !musicGGUFProbe(asset.FormatProbe) {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}
func (d HTDemucsAudioCppDriver) ValidateCombination(requirements []*runtimev1.LocalCapabilityRequirement, bindings []*runtimev1.ModelAssetExactBinding, assets []ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	if len(requirements) != 1 || len(bindings) != 1 || len(assets) != 1 {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
	}
	return d.ValidateBinding(requirements[0], bindings[0], assets[0])
}
func (HTDemucsAudioCppDriver) EffectiveRequestDefaults(string, *structpb.Struct) map[string]string {
	return nil
}

func (HTDemucsAudioCppDriver) PlanAudioSeparateInvocation(input AudioSeparateInvocationInput) (*AudioSeparateInvocationPlan, error) {
	bad := func(kind InvocationFailureKind, message string) (*AudioSeparateInvocationPlan, error) {
		return nil, invocationError(kind, fmt.Errorf("HTDemucs %s", message))
	}
	if !musicStructIsEmpty(input.PortableConfig) {
		return bad(InvocationFailureInvalidConfig, "does not admit portable options")
	}
	if len(input.ExactBindings) != 1 || input.ExactBindings[0].RequirementID != HTDemucsModelRequirementID || input.ExactBindings[0].VerifiedContentID != HTDemucsVerifiedContentID {
		return bad(InvocationFailureInvalidBinding, "requires the exact native q8 model")
	}
	binding := cloneInvocationExactBindings(input.ExactBindings)[0]
	if !filepath.IsAbs(binding.AbsolutePath) || len(binding.DeclaredFiles) != 1 {
		return bad(InvocationFailureInvalidBinding, "model entry is invalid")
	}
	pkg := input.Package
	if pkg.AudioCppVersion != AudioCppMusicPackageVersion || pkg.AudioCppPackageID != AudioCppWindowsCUDA13PackageID || pkg.CUDA13DependencyID != AudioCppCUDA13RuntimeDependencyID || strings.TrimSpace(pkg.AudioCppSelectedSourceRecordID) == "" || strings.TrimSpace(pkg.CUDA13SelectedSourceRecordID) == "" || !filepath.IsAbs(pkg.AudioCppRoot) || !filepath.IsAbs(pkg.AudioCppExecutablePath) || !filepath.IsAbs(pkg.CUDA13Root) || !musicPathWithin(pkg.AudioCppRoot, pkg.AudioCppExecutablePath) || !strings.EqualFold(filepath.Base(pkg.AudioCppExecutablePath), "audiocpp_cli.exe") {
		return bad(InvocationFailureInvalidConfig, "requires the captured audio.cpp 0.8.1 CUDA package")
	}
	if !filepath.IsAbs(input.StagingDir) || filepath.Clean(input.SourcePath) != filepath.Join(filepath.Clean(input.StagingDir), "source.wav") {
		return bad(InvocationFailureInvalidConfig, "requires a private canonical source.wav")
	}
	info := input.SourceInfo
	if info == nil || info.GetSampleRateHz() != HTDemucsRequiredRateHz || info.GetChannels() != 2 || info.GetFrameCount() == 0 || info.GetFrameCount() > uint64(info.GetSampleRateHz())*600 {
		return bad(InvocationFailureInvalidRequest, "source must be an owned canonical 44100 Hz stereo input")
	}
	request, _ := proto.Clone(input.Request).(*runtimev1.AudioSeparateScenarioSpec)
	if request == nil {
		return bad(InvocationFailureInvalidRequest, "separation request is required")
	}
	request.AudioSource = nil
	outDir := filepath.Join(input.StagingDir, "stems")
	hasher := sha256.New()
	for _, value := range append(invocationExactBindingIdentity(binding), pkg.AudioCppVersion, pkg.AudioCppSelectedSourceRecordID, pkg.CUDA13SelectedSourceRecordID, HTDemucsDriverDialect) {
		_, _ = hasher.Write([]byte(value))
		_, _ = hasher.Write([]byte{0})
	}
	// The CLI writes 16-bit PCM stems unless float32 is requested; Runtime
	// custody admits only canonical float32 stems.
	args := []string{"--task", "sep", "--family", "htdemucs", "--model", binding.AbsolutePath, "--backend", "cuda", "--audio", input.SourcePath, "--out-dir", outDir, "--out-format", "float32"}
	return &AudioSeparateInvocationPlan{
		modelFiles: []InvocationExactBinding{binding}, request: request,
		native: true, nativeProcessKey: hex.EncodeToString(hasher.Sum(nil)),
		nativeDriverIdentity: Identity{ImplementationID: HTDemucsImplementationID, DriverID: HTDemucsDriverID, DriverDialect: HTDemucsDriverDialect},
		nativeModelRoot:      binding.AbsolutePath, nativeAudioCppPackage: pkg,
		nativeCLIArgs: args, nativeSourcePath: input.SourcePath,
		nativeSourceInfo: proto.Clone(info).(*runtimev1.LocalAppAudioInfo), nativeOutDir: outDir,
		includeInstrument: request.GetIncludeInstrumentParts(),
	}, nil
}
