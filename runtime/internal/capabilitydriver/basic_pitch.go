package capabilitydriver

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"path/filepath"
	"runtime"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

const (
	BasicPitchConsumerID       = "music.basic-pitch.python"
	BasicPitchProtocol         = "nimi-basic-pitch-onnx/1"
	BasicPitchImplementationID = "local.music.transcribe.basic-pitch.onnx-cpu"
	BasicPitchDriverID         = "nimi.runtime.driver.python.basic-pitch"
	BasicPitchDriverDialect    = "python/basic-pitch-onnx/music-transcribe/v2"
	BasicPitchRecipeID         = "basic-pitch.onnx-cpu.v1"
	BasicPitchRequirementID    = "music.model"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.basic-pitch-onnx-note-events
type BasicPitchDriver struct{}

var _ MusicTranscriptionInvocationDriver = BasicPitchDriver{}

func (BasicPitchDriver) MusicPythonConsumerID() string { return BasicPitchConsumerID }

func (BasicPitchDriver) ImplementationSupportedFeatures(recipe string) ([]string, runtimev1.LocalCapabilityReason) {
	if recipe != BasicPitchRecipeID {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED
	}
	return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}
func (d BasicPitchDriver) ProjectRecipe(recipe string, options *structpb.Struct, features []string) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	return d.Interpret(InterpretInput{RecipeID: recipe, PortableConfig: options, SupportedFeatures: features})
}

func (d BasicPitchDriver) ProjectRecipeForHost(recipe string, options *structpb.Struct, features []string, platformTuple string) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	if platformTuple != "windows/amd64" && platformTuple != "darwin/arm64" {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED
	}
	return d.ProjectRecipe(recipe, options, features)
}
func (BasicPitchDriver) Interpret(input InterpretInput) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	if input.RecipeID != BasicPitchRecipeID || !musicStructIsEmpty(input.PortableConfig) {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	if len(input.SupportedFeatures) != 0 {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_FEATURE_UNSUPPORTED
	}
	constraints, _ := structpb.NewStruct(map[string]any{"asset_kind": "music", "model_family": "basic-pitch", "artifact_role": "music_model", "format": "onnx"})
	return []*runtimev1.LocalCapabilityRequirement{{RequirementId: BasicPitchRequirementID, Role: runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN, Presence: runtimev1.LocalCapabilityRequirementPresence_LOCAL_CAPABILITY_REQUIREMENT_PRESENCE_REQUIRED, ResourceKind: "music", Policy: runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_SUBSTITUTABLE, CompatibilityConstraints: constraints, DisplayLabel: "Basic Pitch ONNX model"}}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func basicPitchUniqueONNXFileFact(input ModelAssetBindingInput) (ModelAssetFileFact, bool) {
	files := input.Files
	if len(files) == 0 && strings.TrimSpace(input.Entry.RelativePath) != "" {
		files = []ModelAssetFileFact{input.Entry}
	}
	var match ModelAssetFileFact
	found := false
	for _, file := range files {
		if strings.ToLower(filepath.Ext(file.RelativePath)) != ".onnx" {
			continue
		}
		if found || file.SizeBytes <= 0 {
			return ModelAssetFileFact{}, false
		}
		match, found = file, true
	}
	return match, found
}

func basicPitchResolveONNXModelPath(binding InvocationExactBinding) (string, error) {
	if !filepath.IsAbs(binding.BundleDir) || filepath.Clean(binding.BundleDir) != binding.BundleDir {
		return "", fmt.Errorf("model bundle directory is invalid")
	}
	var match string
	if len(binding.DeclaredFiles) > 0 {
		for _, relative := range binding.DeclaredFiles {
			if strings.ToLower(filepath.Ext(relative)) != ".onnx" {
				continue
			}
			if match != "" {
				return "", fmt.Errorf("model bundle contains multiple ONNX files")
			}
			cleanRel := filepath.Clean(filepath.FromSlash(relative))
			if filepath.IsAbs(cleanRel) || cleanRel == "." || cleanRel == ".." || strings.HasPrefix(cleanRel, ".."+string(filepath.Separator)) {
				return "", fmt.Errorf("model ONNX relative path is unsafe")
			}
			match = filepath.Join(binding.BundleDir, cleanRel)
		}
	} else if filepath.IsAbs(binding.AbsolutePath) && strings.ToLower(filepath.Ext(binding.AbsolutePath)) == ".onnx" {
		match = filepath.Clean(binding.AbsolutePath)
	}
	if match == "" {
		return "", fmt.Errorf("model bundle does not contain a unique ONNX file")
	}
	rel, err := filepath.Rel(binding.BundleDir, match)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("resolved ONNX path escapes bundle root")
	}
	return match, nil
}

func (BasicPitchDriver) ProjectModelAssetBinding(input ModelAssetBindingInput) (ModelAssetBindingProjection, runtimev1.LocalCapabilityReason) {
	invalid := runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	if input.RecipeID != BasicPitchRecipeID || input.Binding == nil {
		return ModelAssetBindingProjection{}, invalid
	}
	onnxFile, ok := basicPitchUniqueONNXFileFact(input)
	if !ok {
		return ModelAssetBindingProjection{}, invalid
	}
	var model onnxModel
	if err := json.Unmarshal(onnxFile.FormatProbe, &model); err != nil || !basicPitchModelInterface(model) {
		return ModelAssetBindingProjection{}, invalid
	}
	descriptor := ModelAssetDescriptor{Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_MUSIC, Family: "basic-pitch", Engine: "python", ArtifactRoles: []string{"music_model"}, FormatProbe: append([]byte(nil), onnxFile.FormatProbe...)}
	return validatedModelAssetBindingProjection(input, descriptor, 0, (BasicPitchDriver{}).ValidateBinding)
}
func (BasicPitchDriver) ValidateBinding(requirement *runtimev1.LocalCapabilityRequirement, binding *runtimev1.ModelAssetExactBinding, asset ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	if requirement == nil || binding == nil || requirement.GetRequirementId() != BasicPitchRequirementID || binding.GetRequirementId() != BasicPitchRequirementID ||
		binding.GetModelAssetId() == "" || binding.GetModelAssetId() != asset.ModelAssetID ||
		binding.GetVerifiedContentId() == "" || binding.GetVerifiedContentId() != asset.VerifiedContentID ||
		binding.GetEntrySha256() == "" || binding.GetEntrySha256() != asset.EntrySHA256 ||
		asset.Kind != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_MUSIC || asset.Family != "basic-pitch" || asset.Engine != "python" {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	var model onnxModel
	if err := json.Unmarshal(asset.FormatProbe, &model); err != nil || !basicPitchModelInterface(model) {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}
func (d BasicPitchDriver) ValidateCombination(requirements []*runtimev1.LocalCapabilityRequirement, bindings []*runtimev1.ModelAssetExactBinding, assets []ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	if len(requirements) != 1 || len(bindings) != 1 || len(assets) != 1 {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
	}
	return d.ValidateBinding(requirements[0], bindings[0], assets[0])
}
func (BasicPitchDriver) EffectiveRequestDefaults(string, *structpb.Struct) map[string]string {
	return nil
}
func (BasicPitchDriver) MusicInputCapabilities() *runtimev1.MusicInputCapabilities {
	return &runtimev1.MusicInputCapabilities{Transcription: []*runtimev1.MusicTranscriptionInputProfile{{Formats: []string{"midi", "timeline"}, Parts: []string{"note-events"}, MaxDurationSeconds: 600, MaxSourceBytes: 512 << 20, SupportsRange: true}}}
}
func (BasicPitchDriver) ModelAssetFormatProbeBytes(input ModelAssetFormatProbeInput) int64 {
	if strings.ToLower(filepath.Ext(input.RelativePath)) == ".onnx" {
		return MaxAssetFormatProbeBytes
	}
	// Non-ONNX companion files (such as LICENSE/NOTICE) need no tensor metadata.
	return 4
}
func (BasicPitchDriver) ProbeModelAsset(input ModelAssetFormatProbeInput, source io.ReaderAt, size int64) ([]byte, error) {
	if strings.ToLower(filepath.Ext(input.RelativePath)) != ".onnx" {
		return nil, nil
	}
	return probeONNXModel(source, size)
}

func basicPitchModelInterface(model onnxModel) bool {
	if model.IRVersion != 8 || len(model.Inputs) != 1 || len(model.Outputs) != 3 {
		return false
	}
	input := model.Inputs[0]
	if input.Name != "serving_default_input_2:0" || input.Type != 1 || len(input.Shape) != 3 || input.Shape[0] != -1 || input.Shape[1] != 43844 || input.Shape[2] != 1 {
		return false
	}
	expected := map[string]int64{"StatefulPartitionedCall:0": 264, "StatefulPartitionedCall:1": 88, "StatefulPartitionedCall:2": 88}
	for _, output := range model.Outputs {
		width, ok := expected[output.Name]
		if !ok || output.Type != 1 || len(output.Shape) != 3 || output.Shape[0] != -1 || output.Shape[1] != 172 || output.Shape[2] != width {
			return false
		}
		delete(expected, output.Name)
	}
	return len(expected) == 0
}

func (BasicPitchDriver) PlanMusicTranscriptionInvocation(input MusicTranscriptionInvocationInput) (*MusicInvocationPlan, error) {
	bad := func(kind InvocationFailureKind, message string) (*MusicInvocationPlan, error) {
		return nil, invocationError(kind, fmt.Errorf("Basic Pitch %s", message))
	}
	if input.RecipeID != BasicPitchRecipeID || !musicStructIsEmpty(input.PortableConfig) {
		return bad(InvocationFailureInvalidConfig, "recipe or options are invalid")
	}
	if len(input.ExactBindings) != 1 || input.ExactBindings[0].RequirementID != BasicPitchRequirementID ||
		strings.TrimSpace(input.ExactBindings[0].VerifiedContentID) == "" || strings.TrimSpace(input.ExactBindings[0].EntrySHA256) == "" {
		return bad(InvocationFailureInvalidBinding, "requires a verified ONNX model binding")
	}
	binding := cloneInvocationExactBindings(input.ExactBindings)[0]
	modelPath, err := basicPitchResolveONNXModelPath(binding)
	if err != nil {
		return bad(InvocationFailureInvalidBinding, err.Error())
	}
	r := input.Request
	if r == nil || len(r.GetRequestedParts()) != 1 || r.GetRequestedParts()[0] != runtimev1.MusicTranscriptionPart_MUSIC_TRANSCRIPTION_PART_NOTE_EVENTS || len(r.GetRequestedFormats()) < 1 || len(r.GetRequestedFormats()) > 2 {
		return bad(InvocationFailureUnsupported, "only note-events MIDI and timeline are supported")
	}
	seen := map[runtimev1.MusicTranscriptionFormat]bool{}
	for _, format := range r.GetRequestedFormats() {
		if seen[format] || (format != runtimev1.MusicTranscriptionFormat_MUSIC_TRANSCRIPTION_FORMAT_MIDI && format != runtimev1.MusicTranscriptionFormat_MUSIC_TRANSCRIPTION_FORMAT_TIMELINE) {
			return bad(InvocationFailureUnsupported, "requested format is unsupported or duplicated")
		}
		seen[format] = true
	}
	info := input.SourceInfo
	if info == nil || info.GetSampleRateHz() < 8000 || info.GetSampleRateHz() > 96000 || info.GetChannels() < 1 || info.GetChannels() > 2 || info.GetFrameCount() == 0 || info.GetFrameCount() > uint64(info.GetSampleRateHz())*600 || !filepath.IsAbs(input.StagingDir) || input.SourcePath != filepath.Join(input.StagingDir, "source.wav") {
		return bad(InvocationFailureInvalidRequest, "canonical source facts or staging are invalid")
	}
	request := proto.Clone(r).(*runtimev1.MusicTranscribeScenarioSpec)
	if request.SourceAudio == nil || request.SourceAudio.ArtifactId == "" {
		return bad(InvocationFailureInvalidRequest, "source identity is missing")
	}
	if request.SourceAudio.Range == nil {
		request.SourceAudio.Range = &runtimev1.AudioFrameRange{EndFrame: info.GetFrameCount()}
	}
	span := request.SourceAudio.Range
	if span.GetEndFrame() <= span.GetStartFrame() || span.GetEndFrame() > info.GetFrameCount() {
		return bad(InvocationFailureInvalidRequest, "source range is invalid")
	}
	var profile *InvocationExactDependencySource
	for index := range input.DependencySources {
		source := &input.DependencySources[index]
		if source.DependencyFamily == "python.package-set" && source.ConsumerScope == BasicPitchConsumerID {
			if profile != nil {
				return bad(InvocationFailureInvalidConfig, "profile capture is ambiguous")
			}
			profile = source
		}
	}
	if profile == nil || !filepath.IsAbs(profile.CanonicalRoot) || filepath.Clean(profile.CanonicalRoot) != profile.CanonicalRoot || profile.SelectedSourceRecordID == "" || profile.Version == "" || profile.Version != profile.Hashes["profile_digest"] || len(profile.Hashes["driver_bundle_sha256"]) != 64 {
		return bad(InvocationFailureInvalidConfig, "requires the captured cp312 ONNX CPU profile")
	}
	interpreterPath, err := basicPitchInterpreterPath(profile.CanonicalRoot, runtime.GOOS+"/"+runtime.GOARCH)
	if err != nil {
		return bad(InvocationFailureUnsupported, err.Error())
	}
	pythonPlan := &PythonInvocationPlan{ConsumerID: BasicPitchConsumerID, ProfileRoot: profile.CanonicalRoot, ProfileDigest: profile.Version, DriverBundleDigest: profile.Hashes["driver_bundle_sha256"], SelectedSourceRecordID: profile.SelectedSourceRecordID, InterpreterPath: interpreterPath, ScriptPath: filepath.Join(profile.CanonicalRoot, "basic_pitch_driver.py")}
	hasher := sha256.New()
	for _, value := range append(invocationExactBindingIdentity(binding), profile.SelectedSourceRecordID, profile.Version, pythonPlan.DriverBundleDigest, BasicPitchDriverDialect) {
		_, _ = hasher.Write([]byte(value))
		_, _ = hasher.Write([]byte{0})
	}
	plan := &MusicInvocationPlan{processKey: hex.EncodeToString(hasher.Sum(nil)), loadoutID: input.LoadoutID, recipeID: BasicPitchRecipeID, driverIdentity: Identity{ImplementationID: BasicPitchImplementationID, DriverID: BasicPitchDriverID, DriverDialect: BasicPitchDriverDialect}, modelBinding: binding, modelRoot: binding.BundleDir, musicPython: pythonPlan}
	capturedInfo := proto.Clone(info).(*runtimev1.LocalAppAudioInfo)
	plan.transcription = &musicTranscriptionPlan{sourcePath: input.SourcePath, scorePath: filepath.Join(input.StagingDir, "notes.mid"), eventsPath: filepath.Join(input.StagingDir, "notes.json"), request: request, sourceInfo: capturedInfo, normalize: func(_ []byte, events []byte) (*MusicTranscriptionOutput, error) {
		return normalizeBasicPitchNotes(request, capturedInfo, events)
	}}
	plan.cliArgs = []string{pythonPlan.ScriptPath, "--model", modelPath, "--audio", input.SourcePath, "--output", plan.transcription.eventsPath}
	return plan, nil
}

func basicPitchInterpreterPath(profileRoot, platformTuple string) (string, error) {
	switch platformTuple {
	case "windows/amd64":
		return filepath.Join(profileRoot, "Scripts", "python.exe"), nil
	case "darwin/arm64":
		return filepath.Join(profileRoot, "bin", "python"), nil
	default:
		return "", fmt.Errorf("ONNX CPU execution is unsupported on %s", platformTuple)
	}
}
