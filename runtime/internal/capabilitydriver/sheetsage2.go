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

const (
	MusicTranscribeCapabilityContract = "music.transcribe"
	SheetSage2ImplementationID        = "local.music.transcribe.sheetsage2.audio-cpp"
	SheetSage2DriverID                = "nimi.runtime.driver.audio-cpp.sheetsage2"
	SheetSage2DriverDialect           = "audio.cpp/sheetsage2/music-transcribe/v1"
	SheetSage2RecipeID                = "sheetsage2.audio-cpp.v1"
	SheetSage2RequirementID           = "music.model"
	SheetSage2VerifiedContentID       = "sha256:52bb5846c452037d39931aa8050885b6c751b9c7afcc8ef6d6d3067d241731a4"
	SheetSage2ModelBytes              = int64(2708224512)
)

// @nimi-authority: rule.nimi.runtime.ai-provider.music-transcription
type SheetSage2AudioCppDriver struct{}

var _ MusicTranscriptionInvocationDriver = SheetSage2AudioCppDriver{}

func (SheetSage2AudioCppDriver) ImplementationSupportedFeatures(recipe string) ([]string, runtimev1.LocalCapabilityReason) {
	if recipe != SheetSage2RecipeID {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED
	}
	return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}
func (d SheetSage2AudioCppDriver) ProjectRecipe(recipe string, options *structpb.Struct, features []string) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	return d.Interpret(InterpretInput{RecipeID: recipe, PortableConfig: options, SupportedFeatures: features})
}
func (SheetSage2AudioCppDriver) Interpret(input InterpretInput) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	if input.RecipeID != SheetSage2RecipeID || !musicStructIsEmpty(input.PortableConfig) {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	if len(input.SupportedFeatures) != 0 {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_FEATURE_UNSUPPORTED
	}
	constraints, _ := structpb.NewStruct(map[string]any{"asset_kind": "music", "model_family": "sheetsage2", "artifact_role": "music_model", "format": "gguf"})
	return []*runtimev1.LocalCapabilityRequirement{{RequirementId: SheetSage2RequirementID,
		Role:         runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN,
		Presence:     runtimev1.LocalCapabilityRequirementPresence_LOCAL_CAPABILITY_REQUIREMENT_PRESENCE_REQUIRED,
		ResourceKind: "music", Policy: runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_STRICT,
		CompatibilityConstraints: constraints, DisplayLabel: "SheetSage2 original-dtype GGUF"}}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}
func (d SheetSage2AudioCppDriver) ProjectModelAssetBinding(input ModelAssetBindingInput) (ModelAssetBindingProjection, runtimev1.LocalCapabilityReason) {
	if len(input.Files) != 1 || input.Entry.SizeBytes != SheetSage2ModelBytes || !musicGGUFProbe(input.Entry.FormatProbe) || input.Binding.GetVerifiedContentId() != SheetSage2VerifiedContentID {
		return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_MISMATCH
	}
	return validatedModelAssetBindingProjection(input, ModelAssetDescriptor{Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_MUSIC,
		Family: "sheetsage2", Engine: "audio-cpp", ArtifactRoles: []string{"music_model"}, FormatProbe: input.Entry.FormatProbe}, 5120, d.ValidateBinding)
}
func (SheetSage2AudioCppDriver) ValidateBinding(requirement *runtimev1.LocalCapabilityRequirement, binding *runtimev1.ModelAssetExactBinding, asset ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	if requirement.GetRequirementId() != SheetSage2RequirementID || binding.GetRequirementId() != SheetSage2RequirementID || binding.GetVerifiedContentId() != SheetSage2VerifiedContentID || asset.Kind != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_MUSIC || asset.Family != "sheetsage2" || asset.Engine != "audio-cpp" || !contains(asset.ArtifactRoles, "music_model") || !musicGGUFProbe(asset.FormatProbe) {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}
func (d SheetSage2AudioCppDriver) ValidateCombination(requirements []*runtimev1.LocalCapabilityRequirement, bindings []*runtimev1.ModelAssetExactBinding, assets []ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	if len(requirements) != 1 || len(bindings) != 1 || len(assets) != 1 {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
	}
	return d.ValidateBinding(requirements[0], bindings[0], assets[0])
}
func (SheetSage2AudioCppDriver) EffectiveRequestDefaults(string, *structpb.Struct) map[string]string {
	return nil
}
func (SheetSage2AudioCppDriver) MusicInputCapabilities() *runtimev1.MusicInputCapabilities {
	return &runtimev1.MusicInputCapabilities{Transcription: []*runtimev1.MusicTranscriptionInputProfile{{
		Formats: []string{"abc", "timeline"}, Parts: []string{"lead-sheet"}, MaxDurationSeconds: 600, MaxSourceBytes: 512 << 20, SupportsRange: true,
	}}}
}

func (SheetSage2AudioCppDriver) PlanMusicTranscriptionInvocation(input MusicTranscriptionInvocationInput) (*MusicInvocationPlan, error) {
	bad := func(kind InvocationFailureKind, message string) (*MusicInvocationPlan, error) {
		return nil, invocationError(kind, fmt.Errorf("SheetSage2 %s", message))
	}
	if input.RecipeID != SheetSage2RecipeID || !musicStructIsEmpty(input.PortableConfig) {
		return bad(InvocationFailureInvalidConfig, "recipe or configuration is invalid")
	}
	if len(input.ExactBindings) != 1 || input.ExactBindings[0].RequirementID != SheetSage2RequirementID || input.ExactBindings[0].VerifiedContentID != SheetSage2VerifiedContentID {
		return bad(InvocationFailureInvalidBinding, "requires the exact original-dtype model")
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
	r := input.Request
	if r == nil || r.GetSourceAudio().GetArtifactId() == "" || len(r.GetRequestedFormats()) < 1 || len(r.GetRequestedFormats()) > 2 || len(r.GetRequestedParts()) != 1 || r.GetRequestedParts()[0] != runtimev1.MusicTranscriptionPart_MUSIC_TRANSCRIPTION_PART_LEAD_SHEET {
		return bad(InvocationFailureUnsupported, "only lead-sheet ABC and timeline estimates are supported")
	}
	seen := map[runtimev1.MusicTranscriptionFormat]bool{}
	for _, format := range r.GetRequestedFormats() {
		if seen[format] || (format != runtimev1.MusicTranscriptionFormat_MUSIC_TRANSCRIPTION_FORMAT_ABC && format != runtimev1.MusicTranscriptionFormat_MUSIC_TRANSCRIPTION_FORMAT_TIMELINE) {
			return bad(InvocationFailureUnsupported, "requested format is unsupported or duplicated")
		}
		seen[format] = true
	}
	info := input.SourceInfo
	if info == nil || info.GetSampleRateHz() < 8000 || info.GetSampleRateHz() > 96000 || info.GetChannels() < 1 || info.GetChannels() > 2 || info.GetFrameCount() == 0 || info.GetFrameCount() > uint64(info.GetSampleRateHz())*600 {
		return bad(InvocationFailureInvalidRequest, "source audio facts are invalid")
	}
	request := proto.Clone(r).(*runtimev1.MusicTranscribeScenarioSpec)
	if request.SourceAudio.Range == nil {
		request.SourceAudio.Range = &runtimev1.AudioFrameRange{EndFrame: info.GetFrameCount()}
	}
	rangeValue := request.SourceAudio.Range
	if rangeValue.GetEndFrame() <= rangeValue.GetStartFrame() || rangeValue.GetEndFrame() > info.GetFrameCount() {
		return bad(InvocationFailureInvalidRequest, "source range is invalid")
	}
	info = proto.Clone(info).(*runtimev1.LocalAppAudioInfo)
	hasher := sha256.New()
	for _, value := range append(invocationExactBindingIdentity(binding), pkg.AudioCppVersion, pkg.AudioCppSelectedSourceRecordID, pkg.CUDA13SelectedSourceRecordID, SheetSage2DriverDialect) {
		_, _ = hasher.Write([]byte(value))
		_, _ = hasher.Write([]byte{0})
	}
	plan := &MusicInvocationPlan{processKey: hex.EncodeToString(hasher.Sum(nil)), loadoutID: input.LoadoutID, recipeID: SheetSage2RecipeID,
		driverIdentity: Identity{ImplementationID: SheetSage2ImplementationID, DriverID: SheetSage2DriverID, DriverDialect: SheetSage2DriverDialect},
		modelBinding:   binding, modelRoot: binding.AbsolutePath, audioCppPackageID: pkg.AudioCppPackageID, audioCppSelectedSourceRecordID: pkg.AudioCppSelectedSourceRecordID,
		audioCppRoot: pkg.AudioCppRoot, audioCppExecutablePath: pkg.AudioCppExecutablePath, cuda13DependencyID: pkg.CUDA13DependencyID,
		cuda13SelectedSourceRecordID: pkg.CUDA13SelectedSourceRecordID, cuda13Root: pkg.CUDA13Root}
	plan.transcription = &musicTranscriptionPlan{sourcePath: input.SourcePath, scorePath: filepath.Join(input.StagingDir, "score.abc"), eventsPath: filepath.Join(input.StagingDir, "events.json"), request: request, sourceInfo: info,
		normalize: func(score, events []byte) (*MusicTranscriptionOutput, error) {
			return normalizeSheetSage2Output(request, info, score, events)
		}}
	plan.cliArgs = []string{"--task", "midi", "--family", "sheetsage2", "--model", binding.AbsolutePath, "--audio", input.SourcePath, "--backend", "cuda", "--out-dir", input.StagingDir, "--metrics", "--log"}
	return plan, nil
}
