package capabilitydriver

import (
	"bytes"
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
	BasicPitchConsumerID        = "music.basic-pitch.python"
	BasicPitchProtocol          = "nimi-basic-pitch-onnx/1"
	BasicPitchImplementationID  = "local.music.transcribe.basic-pitch.onnx-cpu"
	BasicPitchDriverID          = "nimi.runtime.driver.python.basic-pitch"
	BasicPitchDriverDialect     = "python/basic-pitch-onnx/music-transcribe/v1"
	BasicPitchRecipeID          = "basic-pitch.onnx-cpu.v1"
	BasicPitchRequirementID     = "music.model"
	BasicPitchEntry             = "basic_pitch/saved_models/icassp_2022/nmp.onnx"
	BasicPitchModelSHA256       = "2c3c1d144bfa61ad236e92e169c13535c880469a12a047d4e73451f2c059a0ec" // pragma: allowlist secret -- public official ONNX file digest
	BasicPitchVerifiedContentID = "sha256:24b5e2a22dbb7575cb3cdd999ac96f24eb5cac6a38df6fc32446fe3a5c96763a"
)

var basicPitchFiles = map[string]int64{"LICENSE": 11384, "NOTICE": 1034, BasicPitchEntry: 230444}

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
	return []*runtimev1.LocalCapabilityRequirement{{RequirementId: BasicPitchRequirementID, Role: runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN, Presence: runtimev1.LocalCapabilityRequirementPresence_LOCAL_CAPABILITY_REQUIREMENT_PRESENCE_REQUIRED, ResourceKind: "music", Policy: runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_STRICT, CompatibilityConstraints: constraints, DisplayLabel: "Basic Pitch ONNX with license and NOTICE"}}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}
func (BasicPitchDriver) ProjectModelAssetBinding(input ModelAssetBindingInput) (ModelAssetBindingProjection, runtimev1.LocalCapabilityReason) {
	if input.Binding == nil || input.Binding.GetVerifiedContentId() != BasicPitchVerifiedContentID || input.Entry.RelativePath != BasicPitchEntry || len(input.Files) != len(basicPitchFiles) {
		return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_MISMATCH
	}
	for _, file := range input.Files {
		if basicPitchFiles[file.RelativePath] != file.SizeBytes || file.SizeBytes <= 0 {
			return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_MISMATCH
		}
	}
	var model onnxModel
	if err := json.Unmarshal(input.Entry.FormatProbe, &model); err != nil || !basicPitchModelInterface(model) {
		return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	descriptor := ModelAssetDescriptor{Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_MUSIC, Family: "basic-pitch", Engine: "python", ArtifactRoles: []string{"music_model"}, FormatProbe: append([]byte(nil), input.Entry.FormatProbe...)}
	return validatedModelAssetBindingProjection(input, descriptor, 0, (BasicPitchDriver{}).ValidateBinding)
}
func (BasicPitchDriver) ValidateBinding(requirement *runtimev1.LocalCapabilityRequirement, binding *runtimev1.ModelAssetExactBinding, asset ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	if requirement == nil || binding == nil || requirement.GetRequirementId() != BasicPitchRequirementID || binding.GetRequirementId() != BasicPitchRequirementID || binding.GetVerifiedContentId() != BasicPitchVerifiedContentID || asset.Kind != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_MUSIC || asset.Family != "basic-pitch" || asset.Engine != "python" {
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
	if input.Entry && input.RelativePath == BasicPitchEntry {
		return 230444
	}
	// The common owner admits a positive bounded probe for every declared file,
	// including retained rights files which need no tensor-structure metadata.
	return 4
}
func (BasicPitchDriver) ProbeModelAsset(input ModelAssetFormatProbeInput, source io.ReaderAt, size int64) ([]byte, error) {
	if !input.Entry || input.RelativePath != BasicPitchEntry {
		return nil, nil
	}
	if size != 230444 {
		return nil, fmt.Errorf("Basic Pitch ONNX size is not admitted")
	}
	data := make([]byte, size)
	if _, err := source.ReadAt(data, 0); err != nil {
		return nil, err
	}
	hash := sha256.Sum256(data)
	if hex.EncodeToString(hash[:]) != BasicPitchModelSHA256 {
		return nil, fmt.Errorf("Basic Pitch ONNX content is not admitted")
	}
	return probeONNXModel(bytes.NewReader(data), int64(len(data)))
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
	if len(input.ExactBindings) != 1 || input.ExactBindings[0].RequirementID != BasicPitchRequirementID || input.ExactBindings[0].VerifiedContentID != BasicPitchVerifiedContentID || strings.TrimPrefix(input.ExactBindings[0].EntrySHA256, "sha256:") != BasicPitchModelSHA256 {
		return bad(InvocationFailureInvalidBinding, "requires the exact ONNX and rights bundle")
	}
	binding := cloneInvocationExactBindings(input.ExactBindings)[0]
	if !filepath.IsAbs(binding.BundleDir) || filepath.Clean(binding.AbsolutePath) != filepath.Join(binding.BundleDir, filepath.FromSlash(BasicPitchEntry)) || len(binding.DeclaredFiles) != 3 {
		return bad(InvocationFailureInvalidBinding, "model entry or declaration is invalid")
	}
	for _, name := range binding.DeclaredFiles {
		if _, ok := basicPitchFiles[name]; !ok {
			return bad(InvocationFailureInvalidBinding, "model declaration is invalid")
		}
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
	plan.cliArgs = []string{pythonPlan.ScriptPath, "--model", binding.AbsolutePath, "--audio", input.SourcePath, "--output", plan.transcription.eventsPath}
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
