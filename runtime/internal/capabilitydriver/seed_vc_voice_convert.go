package capabilitydriver

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

// @nimi-authority: rule.nimi.runtime.local-compute.seed-vc-svc-driver
const (
	SeedVCImplementationID  = "local.audio.voice.convert.seed-vc.audio-cpp"
	SeedVCDriverID          = "nimi.runtime.driver.audio-cpp.seed-vc"
	SeedVCDriverDialect     = "audio.cpp/seed-vc/voice-convert/v1"
	SeedVCRecipeID          = "seed-vc.v1-svc.audio-cpp.v1"
	SeedVCRequirementID     = "voice.model"
	SeedVCVerifiedContentID = "sha256:576e4f61cb28432d202b9d017528532269f817dbcae4e562bd4e82c548eec0f3" // pragma: allowlist secret -- public complete distribution content identity
	SeedVCEntrySHA          = "fcef6e11137eb5c9b5ec0deebee3aa5f283cd6eee2210152a2e5391f32c97e06"        // pragma: allowlist secret -- public imported bundle entry digest
)

// The fixed package opens every component before choosing v1_svc. All files,
// including the other routes and notices, belong to one captured ModelAsset.
func seedVCDeclaredFiles() []string {
	return []string{
		"LICENSE.txt", "README.md", "astral/bsq2048.json", "astral/bsq2048.safetensors", "astral/bsq32.json", "astral/bsq32.safetensors",
		"bigvgan/v2_22khz_80band_256x/config.json", "bigvgan/v2_22khz_80band_256x/model.safetensors",
		"bigvgan/v2_44khz_128band_512x/config.json", "bigvgan/v2_44khz_128band_512x/model.safetensors",
		"campplus/model.safetensors", "hift/config.json", "hift/model.safetensors", "hubert-large-ll60k/config.json", "hubert-large-ll60k/model.safetensors",
		"rmvpe/model.safetensors", "seed_vc_manifest.json", "v1/svc.json", "v1/svc.safetensors", "v1/whisper_bigvgan.json", "v1/whisper_bigvgan.safetensors",
		"v1/xlsr_hift.json", "v1/xlsr_hift.safetensors", "v2/ar.safetensors", "v2/cfm.safetensors", "v2/vc_wrapper.json",
		"wav2vec2-xls-r-300m/config.json", "wav2vec2-xls-r-300m/model.safetensors", "whisper-small/config.json", "whisper-small/model.safetensors",
	}
}

type SeedVCAudioCppDriver struct{}

var _ VoiceConvertInvocationDriver = SeedVCAudioCppDriver{}

func (SeedVCAudioCppDriver) EffectiveRequestDefaults(string, *structpb.Struct) map[string]string {
	return nil
}
func (SeedVCAudioCppDriver) ImplementationSupportedFeatures(recipe string) ([]string, runtimev1.LocalCapabilityReason) {
	if recipe != SeedVCRecipeID {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED
	}
	return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}
func (d SeedVCAudioCppDriver) ProjectRecipe(recipe string, opts *structpb.Struct, features []string) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	return d.Interpret(InterpretInput{RecipeID: recipe, PortableConfig: opts, SupportedFeatures: features})
}
func (SeedVCAudioCppDriver) Interpret(input InterpretInput) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	if input.RecipeID != SeedVCRecipeID || !musicStructIsEmpty(input.PortableConfig) {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	if len(input.SupportedFeatures) != 0 {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_FEATURE_UNSUPPORTED
	}
	constraints, _ := structpb.NewStruct(map[string]any{"asset_kind": "music", "model_family": "seed-vc", "artifact_role": "music_model", "format": "safetensors-bundle"})
	return []*runtimev1.LocalCapabilityRequirement{{RequirementId: SeedVCRequirementID, Role: runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN,
		Presence: runtimev1.LocalCapabilityRequirementPresence_LOCAL_CAPABILITY_REQUIREMENT_PRESENCE_REQUIRED, ResourceKind: "music", Policy: runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_STRICT,
		CompatibilityConstraints: constraints, DisplayLabel: "Seed-VC v1_svc complete native assets"}}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (SeedVCAudioCppDriver) ProbeModelAsset(input ModelAssetFormatProbeInput, source io.ReaderAt, size int64) ([]byte, error) {
	if input.RecipeID != SeedVCRecipeID || input.RequirementID != SeedVCRequirementID || size <= 0 {
		return nil, fmt.Errorf("Seed-VC probe has invalid immutable file facts")
	}
	if strings.HasSuffix(input.RelativePath, ".safetensors") {
		prefix := make([]byte, 8)
		if _, err := source.ReadAt(prefix, 0); err != nil {
			return nil, err
		}
		n := binary.LittleEndian.Uint64(prefix)
		if n < 2 || n > MaxSafetensorsHeaderBytes || n > uint64(size-8) {
			return nil, fmt.Errorf("Seed-VC tensor header exceeds its bound")
		}
		data := make([]byte, 8+n)
		copy(data, prefix)
		if _, err := source.ReadAt(data[8:], 8); err != nil {
			return nil, err
		}
		facts, ok := safetensorsTensorFacts(data)
		if !ok {
			return nil, fmt.Errorf("Seed-VC tensor interface is invalid")
		}
		for _, tensor := range facts {
			if tensor.DataOffsets[1] > size-int64(n)-8 {
				return nil, fmt.Errorf("Seed-VC tensor exceeds its file")
			}
		}
		return data, nil
	}
	if strings.HasSuffix(input.RelativePath, ".json") {
		if size > MaxAssetFormatProbeBytes {
			return nil, fmt.Errorf("Seed-VC config exceeds its bound")
		}
		data := make([]byte, size)
		if _, err := source.ReadAt(data, 0); err != nil {
			return nil, err
		}
		if !json.Valid(data) {
			return nil, fmt.Errorf("Seed-VC config is invalid")
		}
		return data, nil
	}
	return nil, nil
}

func seedVCDeclaredFilesMatch(files []string) bool {
	actual := append([]string(nil), files...)
	sort.Strings(actual)
	return len(actual) == len(seedVCDeclaredFiles()) && strings.Join(actual, "\x00") == strings.Join(seedVCDeclaredFiles(), "\x00")
}

func (d SeedVCAudioCppDriver) ProjectModelAssetBinding(input ModelAssetBindingInput) (ModelAssetBindingProjection, runtimev1.LocalCapabilityReason) {
	invalid := runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	if input.RecipeID != SeedVCRecipeID || input.Binding.GetVerifiedContentId() != SeedVCVerifiedContentID || input.Entry.RelativePath != "astral/bsq2048.safetensors" {
		return ModelAssetBindingProjection{}, invalid
	}
	names := make([]string, 0, len(input.Files))
	for _, file := range input.Files {
		names = append(names, file.RelativePath)
		if strings.HasSuffix(file.RelativePath, ".safetensors") {
			if _, ok := safetensorsTensorFacts(file.FormatProbe); !ok {
				return ModelAssetBindingProjection{}, invalid
			}
		}
		if strings.HasSuffix(file.RelativePath, ".json") && !json.Valid(file.FormatProbe) {
			return ModelAssetBindingProjection{}, invalid
		}
	}
	if !seedVCDeclaredFilesMatch(names) {
		return ModelAssetBindingProjection{}, invalid
	}
	weights, ok := modelAssetFileFact(input, "v1/svc.safetensors")
	if !ok {
		return ModelAssetBindingProjection{}, invalid
	}
	tensors, ok := safetensorsTensorFacts(weights.FormatProbe)
	if !ok {
		return ModelAssetBindingProjection{}, invalid
	}
	for name, shape := range map[string][]int64{"length_regulator.f0_embedding.weight": {256, 768}, "cfm.estimator.cond_embedder.weight": {1024, 768}} {
		tensor, ok := tensors[name]
		if !ok || tensor.DType != "F32" || !int64SlicesEqual(tensor.Shape, shape) {
			return ModelAssetBindingProjection{}, invalid
		}
	}
	cfg, ok := modelAssetFileFact(input, "v1/svc.json")
	if !ok {
		return ModelAssetBindingProjection{}, invalid
	}
	var config struct {
		Preprocess struct {
			SR    int `json:"sr"`
			Spect struct {
				Hop  int `json:"hop_length"`
				Mels int `json:"n_mels"`
			} `json:"spect_params"`
		} `json:"preprocess_params"`
		Model struct {
			DiT struct {
				Hidden int  `json:"hidden_dim"`
				Depth  int  `json:"depth"`
				F0     bool `json:"f0_condition"`
			} `json:"DiT"`
			LR struct {
				F0       bool `json:"f0_condition"`
				Channels int  `json:"channels"`
			} `json:"length_regulator"`
		} `json:"model_params"`
	}
	if json.Unmarshal(cfg.FormatProbe, &config) != nil || config.Preprocess.SR != 44100 || config.Preprocess.Spect.Hop != 512 || config.Preprocess.Spect.Mels != 128 || config.Model.DiT.Hidden != 768 || config.Model.DiT.Depth != 17 || !config.Model.DiT.F0 || !config.Model.LR.F0 || config.Model.LR.Channels != 768 {
		return ModelAssetBindingProjection{}, invalid
	}
	return validatedModelAssetBindingProjection(input, ModelAssetDescriptor{Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_MUSIC, Family: "seed-vc", Engine: "audio-cpp", ArtifactRoles: []string{"music_model"}, FormatProbe: input.Entry.FormatProbe}, 0, d.ValidateBinding)
}
func (SeedVCAudioCppDriver) ValidateBinding(req *runtimev1.LocalCapabilityRequirement, b *runtimev1.ModelAssetExactBinding, a ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	if req.GetRequirementId() != SeedVCRequirementID || b.GetRequirementId() != SeedVCRequirementID || b.GetModelAssetId() == "" || b.GetModelAssetId() != a.ModelAssetID || b.GetVerifiedContentId() != SeedVCVerifiedContentID || b.GetVerifiedContentId() != a.VerifiedContentID || b.GetEntrySha256() != SeedVCEntrySHA || b.GetEntrySha256() != a.EntrySHA256 || a.Kind != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_MUSIC || a.Family != "seed-vc" || a.Engine != "audio-cpp" || !contains(a.ArtifactRoles, "music_model") {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	if _, ok := safetensorsTensorFacts(a.FormatProbe); !ok {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}
func (d SeedVCAudioCppDriver) ValidateCombination(r []*runtimev1.LocalCapabilityRequirement, b []*runtimev1.ModelAssetExactBinding, a []ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	if len(r) != 1 || len(b) != 1 || len(a) != 1 {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
	}
	return d.ValidateBinding(r[0], b[0], a[0])
}
func (SeedVCAudioCppDriver) MusicInputCapabilities() *runtimev1.MusicInputCapabilities {
	return &runtimev1.MusicInputCapabilities{VoiceConvert: []*runtimev1.VoiceConvertInputProfile{{SourceKinds: []string{"singing"}, TargetKinds: []string{"reference-audio"}, MaxSourceSeconds: 600, MaxTargetSeconds: 25, SupportsRange: true, SupportsSemitoneShift: true, MinSemitoneShift: -12, MaxSemitoneShift: 12, MaxSourceBytes: 512 << 20, MaxTargetBytes: 512 << 20}}}
}

func (SeedVCAudioCppDriver) PlanVoiceConvertInvocation(input VoiceConvertInvocationInput) (*MusicInvocationPlan, error) {
	bad := func(message string) (*MusicInvocationPlan, error) {
		return nil, invocationError(InvocationFailureInvalidBinding, fmt.Errorf("Seed-VC %s", message))
	}
	if input.RecipeID != SeedVCRecipeID || !musicStructIsEmpty(input.PortableConfig) {
		return nil, invocationError(InvocationFailureInvalidConfig, fmt.Errorf("Seed-VC recipe or configuration is invalid"))
	}
	if len(input.ExactBindings) != 1 {
		return bad("requires one complete exact bundle")
	}
	binding := cloneInvocationExactBindings(input.ExactBindings)[0]
	if binding.RequirementID != SeedVCRequirementID || binding.VerifiedContentID != SeedVCVerifiedContentID || binding.EntrySHA256 != SeedVCEntrySHA || !seedVCDeclaredFilesMatch(binding.DeclaredFiles) || !filepath.IsAbs(binding.BundleDir) || filepath.Clean(binding.AbsolutePath) != filepath.Join(filepath.Clean(binding.BundleDir), "astral", "bsq2048.safetensors") {
		return bad("captured complete resource identity is invalid")
	}
	request, sourceInfo, targetInfo, err := validateNativeVoiceConvertInput(input, 25)
	if err != nil {
		return nil, err
	}
	pkg := input.Package
	outPath := filepath.Join(input.StagingDir, "vocal.wav")
	hasher := sha256.New()
	for _, value := range append(invocationExactBindingIdentity(binding), pkg.AudioCppVersion, pkg.AudioCppSelectedSourceRecordID, pkg.CUDA13SelectedSourceRecordID, SeedVCDriverDialect) {
		_, _ = hasher.Write([]byte(value))
		_, _ = hasher.Write([]byte{0})
	}
	plan := &MusicInvocationPlan{processKey: hex.EncodeToString(hasher.Sum(nil)), loadoutID: input.LoadoutID, recipeID: SeedVCRecipeID, driverIdentity: Identity{ImplementationID: SeedVCImplementationID, DriverID: SeedVCDriverID, DriverDialect: SeedVCDriverDialect}, modelBinding: binding, modelRoot: filepath.Clean(binding.BundleDir),
		audioCppPackageID: pkg.AudioCppPackageID, audioCppSelectedSourceRecordID: pkg.AudioCppSelectedSourceRecordID, audioCppRoot: pkg.AudioCppRoot, audioCppExecutablePath: pkg.AudioCppExecutablePath, cuda13DependencyID: pkg.CUDA13DependencyID, cuda13SelectedSourceRecordID: pkg.CUDA13SelectedSourceRecordID, cuda13Root: pkg.CUDA13Root,
		stagingWAVPath: outPath, expectedSampleRate: 44100, expectedChannels: 1, expectedBitsPerSample: 32}
	plan.voiceConvert = &voiceConvertPlan{sourcePath: input.SourcePath, targetPath: input.TargetPath, outPath: outPath, request: request, sourceInfo: sourceInfo, targetInfo: targetInfo}
	plan.cliArgs = []string{"--task", "svc", "--family", "seed_vc", "--task-route", "v1_svc", "--model", plan.modelRoot, "--backend", "cuda", "--audio", input.SourcePath, "--voice-ref", input.TargetPath, "--seed", "42", "--num-inference-steps", "30",
		"--request-option", "f0_condition=true", "--request-option", "auto_f0_adjust=false", "--request-option", "length_adjust=1", "--request-option", "semitone_shift=" + strconv.FormatInt(int64(request.GetSemitoneShift()), 10), "--out", outPath, "--out-format", "float32"}
	return plan, nil
}
