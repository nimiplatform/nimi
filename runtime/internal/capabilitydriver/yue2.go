package capabilitydriver

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/musicscore"
	"google.golang.org/protobuf/types/known/structpb"
)

const (
	YuE2ImplementationID        = "local.music.generate.yue2.audio-cpp"
	YuE2DriverID                = "nimi.runtime.driver.audio-cpp.yue2"
	YuE2DriverDialect           = "audio.cpp/yue2/music-generate/v1"
	YuE2RecipeID                = "yue2.audio-cpp.v1"
	YuE2RequirementID           = "music.bundle"
	YuE2VerifiedContentID       = "sha256:5c23e6c01d468f3cd18068fd94bff0a6b22cca62846ae15015e7400754f65e94"
	AudioCppMusicPackageVersion = "0.8.1"
)

var yue2Files = map[string]int64{
	"yue2-3b-q8_0.gguf":                    4264186432,
	"yue2-vae-f16.gguf":                    265218656,
	"sidecars/yue2-generation-config.json": 466,
	"sidecars/yue2-model-config.json":      959,
	"sidecars/yue2-qwen.tiktoken":          2561218,
	"sidecars/yue2-vae-config.json":        1378,
}

// YuE2AudioCppDriver admits only the verified Q8/F16 bundle. It requires the
// typed result carrier and exact v0.8.1 executable cohort; registration does
// not imply commercial permission or subjective music-quality acceptance.
// @nimi-authority: definition.nimi.runtime.ai-provider.multimodal-provider-plane
type YuE2AudioCppDriver struct{}

var _ MusicInvocationDriver = YuE2AudioCppDriver{}

func (YuE2AudioCppDriver) ImplementationSupportedFeatures(recipe string) ([]string, runtimev1.LocalCapabilityReason) {
	if recipe != YuE2RecipeID {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED
	}
	return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (d YuE2AudioCppDriver) ProjectRecipe(recipe string, options *structpb.Struct, features []string) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	return d.Interpret(InterpretInput{RecipeID: recipe, PortableConfig: options, SupportedFeatures: features})
}

func (YuE2AudioCppDriver) Interpret(input InterpretInput) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	if input.RecipeID != YuE2RecipeID || !musicStructIsEmpty(input.PortableConfig) {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	if len(input.SupportedFeatures) != 0 {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_FEATURE_UNSUPPORTED
	}
	constraints, _ := structpb.NewStruct(map[string]any{"asset_kind": "music", "model_family": "yue2", "artifact_role": "music_model", "format": "gguf-bundle"})
	return []*runtimev1.LocalCapabilityRequirement{{RequirementId: YuE2RequirementID, Role: runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN, Presence: runtimev1.LocalCapabilityRequirementPresence_LOCAL_CAPABILITY_REQUIREMENT_PRESENCE_REQUIRED, ResourceKind: "music", Policy: runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_STRICT, CompatibilityConstraints: constraints, DisplayLabel: "YuE2 Q8 with F16 VAE"}}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (d YuE2AudioCppDriver) ProjectModelAssetBinding(input ModelAssetBindingInput) (ModelAssetBindingProjection, runtimev1.LocalCapabilityReason) {
	if input.Requirement.GetRequirementId() != YuE2RequirementID || input.Binding.GetRequirementId() != YuE2RequirementID {
		return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	if input.Binding.GetVerifiedContentId() != YuE2VerifiedContentID || len(input.Files) != len(yue2Files) {
		return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_MISMATCH
	}
	seen := map[string]bool{}
	for _, file := range input.Files {
		size, ok := yue2Files[file.RelativePath]
		if !ok || seen[file.RelativePath] || file.SizeBytes != size || (strings.HasSuffix(file.RelativePath, ".gguf") && !musicGGUFProbe(file.FormatProbe)) {
			return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_MISMATCH
		}
		seen[file.RelativePath] = true
	}
	entry, ok := modelAssetFileFact(input, "yue2-3b-q8_0.gguf")
	if !ok || !musicGGUFProbe(entry.FormatProbe) {
		return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	return validatedModelAssetBindingProjection(input, ModelAssetDescriptor{Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_MUSIC, Family: "yue2", Engine: "audio-cpp", ArtifactRoles: []string{"music_model"}, FormatProbe: append([]byte(nil), entry.FormatProbe...)}, 5000, d.ValidateBinding)
}

func (YuE2AudioCppDriver) ValidateBinding(requirement *runtimev1.LocalCapabilityRequirement, binding *runtimev1.ModelAssetExactBinding, asset ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	if requirement.GetRequirementId() != YuE2RequirementID || binding.GetRequirementId() != YuE2RequirementID || binding.GetVerifiedContentId() != YuE2VerifiedContentID || asset.Kind != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_MUSIC || asset.Family != "yue2" || asset.Engine != "audio-cpp" || !contains(asset.ArtifactRoles, "music_model") || !musicGGUFProbe(asset.FormatProbe) {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (d YuE2AudioCppDriver) ValidateCombination(requirements []*runtimev1.LocalCapabilityRequirement, bindings []*runtimev1.ModelAssetExactBinding, assets []ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	if len(requirements) != 1 || len(bindings) != 1 || len(assets) != 1 {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
	}
	return d.ValidateBinding(requirements[0], bindings[0], assets[0])
}

func (YuE2AudioCppDriver) EffectiveRequestDefaults(string, *structpb.Struct) map[string]string {
	return nil
}

func (YuE2AudioCppDriver) PlanMusicInvocation(input MusicInvocationInput) (*MusicInvocationPlan, error) {
	bad := func(kind InvocationFailureKind, message string) (*MusicInvocationPlan, error) {
		return nil, invocationError(kind, fmt.Errorf("YuE2 %s", message))
	}
	if input.RecipeID != YuE2RecipeID || !musicStructIsEmpty(input.PortableConfig) {
		return bad(InvocationFailureInvalidConfig, "recipe or portable config is invalid")
	}
	if len(input.ExactBindings) != 1 || input.ExactBindings[0].RequirementID != YuE2RequirementID || input.ExactBindings[0].VerifiedContentID != YuE2VerifiedContentID {
		return bad(InvocationFailureInvalidBinding, "requires the exact verified Q8/F16 bundle")
	}
	binding := cloneInvocationExactBindings(input.ExactBindings)[0]
	if len(binding.DeclaredFiles) != len(yue2Files) {
		return bad(InvocationFailureInvalidBinding, "bundle manifest is incomplete")
	}
	seen := map[string]bool{}
	for _, file := range binding.DeclaredFiles {
		if _, ok := yue2Files[file]; !ok || seen[file] {
			return bad(InvocationFailureInvalidBinding, "bundle manifest is invalid")
		}
		seen[file] = true
	}
	if !filepath.IsAbs(binding.BundleDir) || filepath.Clean(binding.AbsolutePath) != filepath.Join(filepath.Clean(binding.BundleDir), "yue2-3b-q8_0.gguf") {
		return bad(InvocationFailureInvalidBinding, "bundle entry is invalid")
	}
	pkg := input.Package
	if pkg.AudioCppVersion != AudioCppMusicPackageVersion || pkg.AudioCppPackageID != AudioCppWindowsCUDA13PackageID || pkg.CUDA13DependencyID != AudioCppCUDA13RuntimeDependencyID || strings.TrimSpace(pkg.AudioCppSelectedSourceRecordID) == "" || strings.TrimSpace(pkg.CUDA13SelectedSourceRecordID) == "" || !filepath.IsAbs(pkg.AudioCppRoot) || !filepath.IsAbs(pkg.AudioCppExecutablePath) || !filepath.IsAbs(pkg.CUDA13Root) || !musicPathWithin(pkg.AudioCppRoot, pkg.AudioCppExecutablePath) || !strings.EqualFold(filepath.Base(pkg.AudioCppExecutablePath), "audiocpp_cli.exe") {
		return bad(InvocationFailureInvalidConfig, "requires the captured audio.cpp 0.8.1 CUDA package")
	}
	r := input.Request
	if r == nil || strings.TrimSpace(r.GetPrompt()) == "" || strings.TrimSpace(r.GetLyrics()) == "" || !utf8.ValidString(r.GetPrompt()) || !utf8.ValidString(r.GetLyrics()) || strings.ContainsRune(r.GetPrompt()+r.GetLyrics(), 0) {
		return bad(InvocationFailureInvalidRequest, "style prompt and lyrics are required")
	}
	if r.GetNegativePrompt() != "" || r.GetStyle() != "" || r.GetTitle() != "" || r.GetInstrumental() || r.GetAudioReference() != nil || len(input.Extensions) != 0 || r.GetDurationSeconds() < 0 || r.GetDurationSeconds() > 600 {
		return bad(InvocationFailureUnsupported, "request contains unsupported fields")
	}
	if !filepath.IsAbs(input.StagingWAVPath) || filepath.Base(input.StagingWAVPath) != "music.wav" {
		return bad(InvocationFailureInvalidConfig, "requires a private Job directory containing music.wav")
	}
	duration := int(r.GetDurationSeconds())
	if duration == 0 {
		duration = 20
	}
	generatedScore := r.GetScore() == nil
	cot := "full"
	if !generatedScore {
		if r.GetScore().GetFormat() != runtimev1.MusicScoreFormat_MUSIC_SCORE_FORMAT_ABC || r.GetReturnGeneratedScore() {
			return bad(InvocationFailureUnsupported, "does not generate another score from a provided ABC input")
		}
		if r.GetScoreConditioning() == runtimev1.MusicScoreConditioning_MUSIC_SCORE_CONDITIONING_MELODY_ONLY {
			cot = "melody"
		} else if r.GetScoreConditioning() != runtimev1.MusicScoreConditioning_MUSIC_SCORE_CONDITIONING_MELODY_AND_HARMONY {
			return bad(InvocationFailureInvalidRequest, "score conditioning is required")
		}
		if err := musicscore.ValidateABC(input.ScoreABC, cot == "melody"); err != nil {
			return bad(InvocationFailureInvalidRequest, err.Error())
		}
	} else if len(input.ScoreABC) != 0 || r.GetScoreConditioning() != runtimev1.MusicScoreConditioning_MUSIC_SCORE_CONDITIONING_UNSPECIFIED {
		return bad(InvocationFailureInvalidRequest, "score content has no declared reference")
	}
	// Every UTF-8 byte can be at most one tokenizer token. This deliberately
	// conservative bound includes generated tokens and avoids silent context cuts.
	planningTokens := 0
	if generatedScore {
		planningTokens = 4096
	}
	if len(r.GetPrompt())+len(r.GetLyrics())+len(input.ScoreABC)+duration*25+planningTokens+128 > 24576 {
		return bad(InvocationFailureUnsupported, "input and duration exceed the admitted context budget")
	}
	hasher := sha256.New()
	for _, value := range append(invocationExactBindingIdentity(binding), pkg.AudioCppVersion, pkg.AudioCppSelectedSourceRecordID, pkg.CUDA13SelectedSourceRecordID, YuE2DriverDialect) {
		_, _ = hasher.Write([]byte(value))
		_, _ = hasher.Write([]byte{0})
	}
	plan := &MusicInvocationPlan{processKey: hex.EncodeToString(hasher.Sum(nil)), loadoutID: input.LoadoutID, recipeID: YuE2RecipeID, driverIdentity: Identity{ImplementationID: YuE2ImplementationID, DriverID: YuE2DriverID, DriverDialect: YuE2DriverDialect}, modelBinding: binding, modelRoot: filepath.Clean(binding.BundleDir), audioCppPackageID: pkg.AudioCppPackageID, audioCppSelectedSourceRecordID: pkg.AudioCppSelectedSourceRecordID, audioCppRoot: pkg.AudioCppRoot, audioCppExecutablePath: pkg.AudioCppExecutablePath, cuda13DependencyID: pkg.CUDA13DependencyID, cuda13SelectedSourceRecordID: pkg.CUDA13SelectedSourceRecordID, cuda13Root: pkg.CUDA13Root, prompt: r.GetPrompt(), lyrics: r.GetLyrics(), durationBudgetSeconds: duration, seed: 1234, stagingWAVPath: input.StagingWAVPath, expectedSampleRate: 48000, expectedChannels: 2, expectedBitsPerSample: 32, outputObserver: func() MusicOutputObserver { return &yue2OutputObserver{expectGeneratedScore: generatedScore} }}
	if r.Seed != nil {
		plan.seed = uint64(r.GetSeed())
	}
	directory := filepath.Dir(plan.stagingWAVPath)
	options := map[string]string{"style": plan.prompt, "cot": cot, "seed": strconv.FormatUint(plan.seed, 10), "abc_max_tokens": "4096", "semantic_max_tokens": strconv.Itoa(duration * 25)}
	if generatedScore {
		plan.stagingScorePath = filepath.Join(directory, "music", "score.abc")
	} else {
		plan.scoreInputPath = filepath.Join(directory, "input.abc")
		plan.scoreInput = append([]byte(nil), input.ScoreABC...)
		options["abc_file"] = plan.scoreInputPath
	}
	plan.requestJSONPath = filepath.Join(directory, "request.json")
	var encodeErr error
	plan.requestJSON, encodeErr = json.Marshal(map[string]any{"requests": []any{map[string]any{"id": "music", "lyrics": plan.lyrics, "options": options}}})
	if encodeErr != nil {
		return bad(InvocationFailureInvalidRequest, "request could not be encoded")
	}
	// Native YuE2 generates 25 semantic tokens per second. The decoded waveform
	// can round slightly; this is a budget, never a requested exact endpoint.
	plan.cliArgs = []string{"--task", "gen", "--family", "yue2", "--model", plan.modelRoot, "--backend", "cuda", "--request-sequence", plan.requestJSONPath, "--out-dir", directory, "--out-format", "float32", "--metrics", "--log"}
	return plan, nil
}

func yue2DeclaredFiles() []string {
	files := make([]string, 0, len(yue2Files))
	for file := range yue2Files {
		files = append(files, file)
	}
	sort.Strings(files)
	return files
}
