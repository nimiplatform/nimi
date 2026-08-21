package capabilitydriver

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"path/filepath"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

const (
	MiniMaxMusic3ImplementationID   = "local.music.generate.minimax-music3.audio-cpp"
	MiniMaxMusic3DriverID           = "nimi.runtime.driver.audio-cpp.minimax-music3"
	MiniMaxMusic3DriverDialect      = "audio.cpp/minimax-music3/music-generate/v1"
	MiniMaxMusic3CapabilityContract = "music.generate"
	MiniMaxMusic3RecipeID           = "minimax-music3.audio-cpp.v1"
	MiniMaxMusic3RequirementID      = "music.bundle"
	MiniMaxMusic3VerifiedContentID  = "sha256:8a5968a86caff38d531a7b2d19ddbdc270dd38cb3395b66bc8386bf554c29353"
	MiniMaxMusic3AudioCppPackageID  = AudioCppWindowsCUDA13PackageID
	MiniMaxMusic3CUDA13DependencyID = AudioCppCUDA13RuntimeDependencyID
)

var miniMaxMusic3Files = map[string]int64{
	"LICENSE": 7373, "README.md": 3575, "config.json": 107,
	"config/condition_encoder.json": 292, "config/language_model.json": 1596,
	"config/rvq_depth_decoder.json": 274, "config/transformer.json": 294, "config/vocoder.json": 251,
	"tokenizer/tokenizer.json": 11423801, "tokenizer/tokenizer_config.json": 377,
	"condition_encoder.gguf": 100677184, "language_model_q4_0.gguf": 6006866496,
	"rvq_depth_decoder_q8_0.gguf": 714028960, "transformer_q4_0.gguf": 1396392768, "vocoder.gguf": 216704192,
}

type MiniMaxMusic3AudioCppDriver struct{}

func (MiniMaxMusic3AudioCppDriver) Interpret(input InterpretInput) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	if input.RecipeID != MiniMaxMusic3RecipeID || !musicStructIsEmpty(input.PortableConfig) {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	if len(input.SupportedFeatures) != 0 {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_FEATURE_UNSUPPORTED
	}
	constraints, _ := structpb.NewStruct(map[string]any{"asset_kind": "music", "model_family": "minimax-music3", "artifact_role": "music_model", "format": "gguf-bundle"})
	return []*runtimev1.LocalCapabilityRequirement{{RequirementId: MiniMaxMusic3RequirementID, Role: runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN, ResourceKind: "music", Policy: runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_STRICT, CompatibilityConstraints: constraints, DisplayLabel: "MiniMax-Music3 Q4/Q8/Q4 bundle"}}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (d MiniMaxMusic3AudioCppDriver) ProjectRecipe(recipeID string, options *structpb.Struct, supportedFeatures []string) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	return d.Interpret(InterpretInput{RecipeID: recipeID, PortableConfig: options, SupportedFeatures: supportedFeatures})
}

func (MiniMaxMusic3AudioCppDriver) ProjectModelAssetBinding(input ModelAssetBindingInput) (ModelAssetBindingProjection, runtimev1.LocalCapabilityReason) {
	if input.Requirement == nil || input.Binding == nil || input.Requirement.GetRequirementId() != MiniMaxMusic3RequirementID || input.Binding.GetRequirementId() != MiniMaxMusic3RequirementID {
		return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	if input.Binding.GetVerifiedContentId() != MiniMaxMusic3VerifiedContentID || !miniMaxMusic3FileFactsMatch(input.Files) {
		return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_MISMATCH
	}
	entry, ok := modelAssetFileFact(input, "language_model_q4_0.gguf")
	if !ok || !musicGGUFProbe(entry.FormatProbe) {
		return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	descriptor := ModelAssetDescriptor{Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_MUSIC, Family: "minimax-music3", Engine: "audio-cpp", ArtifactRoles: []string{"music_model"}, FormatProbe: append([]byte(nil), entry.FormatProbe...)}
	return validatedModelAssetBindingProjection(input, descriptor, 5000, (MiniMaxMusic3AudioCppDriver{}).ValidateBinding)
}

func (MiniMaxMusic3AudioCppDriver) ValidateBinding(requirement *runtimev1.LocalCapabilityRequirement, binding *runtimev1.ModelAssetExactBinding, asset ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	if requirement == nil || binding == nil || requirement.GetRequirementId() != MiniMaxMusic3RequirementID || binding.GetRequirementId() != MiniMaxMusic3RequirementID || binding.GetVerifiedContentId() != MiniMaxMusic3VerifiedContentID || asset.Kind != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_MUSIC || asset.Family != "minimax-music3" || asset.Engine != "audio-cpp" || !contains(asset.ArtifactRoles, "music_model") || !musicGGUFProbe(asset.FormatProbe) {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (d MiniMaxMusic3AudioCppDriver) ValidateCombination(requirements []*runtimev1.LocalCapabilityRequirement, bindings []*runtimev1.ModelAssetExactBinding, assets []ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	if len(requirements) != 1 || len(bindings) != 1 || len(assets) != 1 {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
	}
	return d.ValidateBinding(requirements[0], bindings[0], assets[0])
}

func (MiniMaxMusic3AudioCppDriver) EffectiveRequestDefaults(string, *structpb.Struct) map[string]string {
	return nil
}

func (MiniMaxMusic3AudioCppDriver) PlanMusicInvocation(input MusicInvocationInput) (*MusicInvocationPlan, error) {
	if input.RecipeID != MiniMaxMusic3RecipeID || !musicStructIsEmpty(input.PortableConfig) {
		return nil, invocationError(InvocationFailureInvalidConfig, fmt.Errorf("MiniMax-Music3 recipe or portable config is invalid"))
	}
	if len(input.ExactBindings) != 1 || input.ExactBindings[0].RequirementID != MiniMaxMusic3RequirementID || input.ExactBindings[0].VerifiedContentID != MiniMaxMusic3VerifiedContentID {
		return nil, invocationError(InvocationFailureInvalidBinding, fmt.Errorf("MiniMax-Music3 requires one exact verified bundle"))
	}
	binding := cloneInvocationExactBindings(input.ExactBindings)[0]
	if !miniMaxMusic3DeclaredFilesMatch(binding.DeclaredFiles) {
		return nil, invocationError(InvocationFailureInvalidBinding, fmt.Errorf("MiniMax-Music3 bundle manifest is incomplete"))
	}
	modelRoot := strings.TrimSpace(binding.BundleDir)
	if modelRoot == "" || !filepath.IsAbs(modelRoot) {
		return nil, invocationError(InvocationFailureInvalidBinding, fmt.Errorf("MiniMax-Music3 bundle root must be absolute"))
	}
	if err := validateMiniMaxMusic3Request(input.Request, input.Extensions); err != nil {
		return nil, err
	}
	if input.Package.AudioCppPackageID != MiniMaxMusic3AudioCppPackageID || input.Package.CUDA13DependencyID != MiniMaxMusic3CUDA13DependencyID || strings.TrimSpace(input.Package.AudioCppSelectedSourceRecordID) == "" || strings.TrimSpace(input.Package.CUDA13SelectedSourceRecordID) == "" || !filepath.IsAbs(input.Package.AudioCppRoot) || !filepath.IsAbs(input.Package.AudioCppExecutablePath) || !filepath.IsAbs(input.Package.CUDA13Root) {
		return nil, invocationError(InvocationFailureInvalidConfig, fmt.Errorf("MiniMax-Music3 package selected-source composition is incomplete"))
	}
	if !musicPathWithin(input.Package.AudioCppRoot, input.Package.AudioCppExecutablePath) || !strings.EqualFold(filepath.Base(input.Package.AudioCppExecutablePath), "audiocpp_cli.exe") {
		return nil, invocationError(InvocationFailureInvalidConfig, fmt.Errorf("MiniMax-Music3 executable is outside the captured package root"))
	}
	staging := strings.TrimSpace(input.StagingWAVPath)
	if !filepath.IsAbs(staging) || !strings.EqualFold(filepath.Ext(staging), ".wav") {
		return nil, invocationError(InvocationFailureInvalidConfig, fmt.Errorf("MiniMax-Music3 staging WAV path is invalid"))
	}
	language := filepath.Join(modelRoot, "language_model_q4_0.gguf")
	rvq := filepath.Join(modelRoot, "rvq_depth_decoder_q8_0.gguf")
	transformer := filepath.Join(modelRoot, "transformer_q4_0.gguf")
	hasher := sha256.New()
	for _, value := range append(invocationExactBindingIdentity(binding), input.Package.AudioCppPackageID, input.Package.AudioCppSelectedSourceRecordID, input.Package.CUDA13DependencyID, input.Package.CUDA13SelectedSourceRecordID, MiniMaxMusic3DriverDialect) {
		_, _ = hasher.Write([]byte(value))
		_, _ = hasher.Write([]byte{0})
	}
	return &MusicInvocationPlan{processKey: hex.EncodeToString(hasher.Sum(nil)), loadoutID: strings.TrimSpace(input.LoadoutID), recipeID: MiniMaxMusic3RecipeID, driverIdentity: Identity{ImplementationID: MiniMaxMusic3ImplementationID, DriverID: MiniMaxMusic3DriverID, DriverDialect: MiniMaxMusic3DriverDialect}, modelBinding: binding, modelRoot: modelRoot, languageModelPath: language, rvqDepthDecoderPath: rvq, flowTransformerPath: transformer, audioCppPackageID: input.Package.AudioCppPackageID, audioCppSelectedSourceRecordID: input.Package.AudioCppSelectedSourceRecordID, audioCppRoot: filepath.Clean(input.Package.AudioCppRoot), audioCppExecutablePath: filepath.Clean(input.Package.AudioCppExecutablePath), cuda13DependencyID: input.Package.CUDA13DependencyID, cuda13SelectedSourceRecordID: input.Package.CUDA13SelectedSourceRecordID, cuda13Root: filepath.Clean(input.Package.CUDA13Root), prompt: input.Request.GetPrompt(), lyrics: input.Request.GetLyrics(), durationBudgetSeconds: 20, numInferenceSteps: 30, guidanceScale: 1.7, arGuidanceScale: 1.5, topK: 50, seed: 0, memorySaver: true, stagingWAVPath: filepath.Clean(staging), expectedSampleRate: 44100, expectedChannels: 2, expectedBitsPerSample: 16}, nil
}

func musicStructIsEmpty(value *structpb.Struct) bool {
	return value == nil || len(value.GetFields()) == 0
}

func musicPathWithin(root, path string) bool {
	relative, err := filepath.Rel(filepath.Clean(root), filepath.Clean(path))
	return err == nil && relative != "." && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}
func musicGGUFProbe(value []byte) bool {
	return len(value) >= 4 && bytes.Equal(value[:4], []byte("GGUF"))
}
func miniMaxMusic3FileFactsMatch(files []ModelAssetFileFact) bool {
	if len(files) != len(miniMaxMusic3Files) {
		return false
	}
	seen := map[string]struct{}{}
	for _, file := range files {
		expected, ok := miniMaxMusic3Files[file.RelativePath]
		if !ok || file.SizeBytes != expected || (strings.HasSuffix(file.RelativePath, ".gguf") && !musicGGUFProbe(file.FormatProbe)) {
			return false
		}
		seen[file.RelativePath] = struct{}{}
	}
	return len(seen) == len(miniMaxMusic3Files)
}
func miniMaxMusic3DeclaredFilesMatch(files []string) bool {
	if len(files) != len(miniMaxMusic3Files) {
		return false
	}
	actual := append([]string(nil), files...)
	sort.Strings(actual)
	want := make([]string, 0, len(miniMaxMusic3Files))
	for name := range miniMaxMusic3Files {
		want = append(want, name)
	}
	sort.Strings(want)
	return strings.Join(actual, "\x00") == strings.Join(want, "\x00")
}
func validateMiniMaxMusic3Request(request *runtimev1.MusicGenerateScenarioSpec, extensions []*runtimev1.ScenarioExtension) error {
	if request == nil || strings.TrimSpace(request.GetPrompt()) == "" || strings.TrimSpace(request.GetLyrics()) == "" {
		return invocationError(InvocationFailureInvalidRequest, fmt.Errorf("MiniMax-Music3 prompt and lyrics are required"))
	}
	if request.GetNegativePrompt() != "" || request.GetStyle() != "" || request.GetTitle() != "" || request.GetInstrumental() || request.GetDurationSeconds() != 0 || len(extensions) != 0 {
		return invocationError(InvocationFailureUnsupported, fmt.Errorf("MiniMax-Music3 request contains unsupported fields"))
	}
	for _, line := range strings.Split(strings.ReplaceAll(request.GetLyrics(), "\r\n", "\n"), "\n") {
		trimmed := strings.TrimLeft(line, " \t")
		if strings.HasPrefix(trimmed, "[") {
			if close := strings.Index(trimmed, "]"); close >= 0 && strings.TrimSpace(trimmed[close+1:]) != "" {
				return invocationError(InvocationFailureUnsupported, fmt.Errorf("MiniMax-Music3 release-0.6.1 requires section tags on their own line"))
			}
		}
	}
	return nil
}
