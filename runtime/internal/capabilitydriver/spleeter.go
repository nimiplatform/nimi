package capabilitydriver

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
	"io"
	"path/filepath"
)

const (
	SpleeterConsumerID       = "audio.spleeter.python"
	SpleeterProtocol         = "nimi-spleeter-tf-checkpoint/1"
	SpleeterImplementationID = "local.audio.separate.spleeter.tf-cpu"
	SpleeterDriverID         = "nimi.runtime.driver.python.spleeter"
	SpleeterDriverDialect    = "python/spleeter-tf/audio-separate/v1"
	SpleeterRecipe2          = "spleeter.2stems.tf-cpu.v1"
	SpleeterRecipe4          = "spleeter.4stems.tf-cpu.v1"
)

type SpleeterModelFacts struct {
	Group              int
	ContentID, MetaSHA string
	MetaBytes          int64
	Files              map[string]int64
}

func SpleeterFacts(group int) (SpleeterModelFacts, bool) {
	switch group {
	case 2:
		return SpleeterModelFacts{Group: 2, ContentID: "sha256:64f93fd4a6556b82033fcfd1eefd0352607544de66706eedcbfe77b396b47aee", MetaSHA: "6e1f6d86a22bb452a58cb20e3de87b416f8a79e626ca223e20f763ab2d21ec95", MetaBytes: 805575, Files: map[string]int64{"checkpoint": 67, "model.data-00000-of-00001": 78614080, "model.index": 5244, "model.meta": 805575}}, true
	case 4:
		return SpleeterModelFacts{Group: 4, ContentID: "sha256:45aa223901d7d2d1b614b896eab6d63da69a535c32cced32495974fc8a299a30", MetaSHA: "f2c2843e3c8c84c737d0ba642fef798d24056f8dbb0b2e2d58a19de55b20034e", MetaBytes: 1588447, Files: map[string]int64{"checkpoint": 67, "model.data-00000-of-00001": 157228152, "model.index": 10368, "model.meta": 1588447}}, true
	}
	return SpleeterModelFacts{}, false
}
func spleeterRecipeGroup(recipe string) int {
	if recipe == SpleeterRecipe2 {
		return 2
	}
	if recipe == SpleeterRecipe4 {
		return 4
	}
	return 0
}

// @nimi-authority: rule.nimi.runtime.ai-provider.spleeter-local-separation
type SpleeterDriver struct{}

var _ AudioSeparateInvocationDriver = SpleeterDriver{}

func (SpleeterDriver) ImplementationSupportedFeatures(recipe string) ([]string, runtimev1.LocalCapabilityReason) {
	if spleeterRecipeGroup(recipe) == 0 {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED
	}
	return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}
func (d SpleeterDriver) ProjectRecipe(recipe string, options *structpb.Struct, features []string) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	return d.Interpret(InterpretInput{RecipeID: recipe, PortableConfig: options, SupportedFeatures: features})
}
func (d SpleeterDriver) ProjectRecipeForHost(recipe string, options *structpb.Struct, features []string, host string) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	if host != "windows/amd64" {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED
	}
	return d.ProjectRecipe(recipe, options, features)
}
func (SpleeterDriver) Interpret(input InterpretInput) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	group := spleeterRecipeGroup(input.RecipeID)
	if group == 0 || !musicStructIsEmpty(input.PortableConfig) {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	if len(input.SupportedFeatures) != 0 {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_FEATURE_UNSUPPORTED
	}
	constraints, _ := structpb.NewStruct(map[string]any{"asset_kind": "music", "model_family": "spleeter", "artifact_role": "music_model", "format": "tensorflow-checkpoint", "model_group": group})
	return []*runtimev1.LocalCapabilityRequirement{{RequirementId: DemucsModelRequirementID, Role: runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN, Presence: runtimev1.LocalCapabilityRequirementPresence_LOCAL_CAPABILITY_REQUIREMENT_PRESENCE_REQUIRED, ResourceKind: "music", Policy: runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_STRICT, CompatibilityConstraints: constraints, DisplayLabel: fmt.Sprintf("Spleeter %d stems checkpoint", group)}}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

type spleeterProbe struct {
	Format    string `json:"format"`
	Group     int    `json:"group"`
	Variables int    `json:"variables"`
}

func (d SpleeterDriver) ProjectModelAssetBinding(input ModelAssetBindingInput) (ModelAssetBindingProjection, runtimev1.LocalCapabilityReason) {
	var probe spleeterProbe
	if json.Unmarshal(input.Entry.FormatProbe, &probe) != nil || probe.Format != "tensorflow-checkpoint" {
		return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	facts, ok := SpleeterFacts(probe.Group)
	if !ok || len(input.Files) != 4 || input.Binding.GetVerifiedContentId() != facts.ContentID {
		return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	for _, file := range input.Files {
		size, ok := facts.Files[file.RelativePath]
		if !ok || file.SizeBytes != size {
			return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
		}
	}
	descriptor := ModelAssetDescriptor{Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_MUSIC, Family: "spleeter", Engine: "python", ArtifactRoles: []string{"music_model"}, FormatProbe: append([]byte(nil), input.Entry.FormatProbe...)}
	return validatedModelAssetBindingProjection(input, descriptor, 0, d.ValidateBinding)
}
func (SpleeterDriver) ValidateBinding(req *runtimev1.LocalCapabilityRequirement, binding *runtimev1.ModelAssetExactBinding, asset ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	if req == nil || binding == nil || req.GetRequirementId() != DemucsModelRequirementID || binding.GetRequirementId() != DemucsModelRequirementID || asset.Kind != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_MUSIC || asset.Family != "spleeter" || asset.Engine != "python" {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	group := int(req.GetCompatibilityConstraints().GetFields()["model_group"].GetNumberValue())
	facts, ok := SpleeterFacts(group)
	var probe spleeterProbe
	if !ok || binding.GetVerifiedContentId() != facts.ContentID || json.Unmarshal(asset.FormatProbe, &probe) != nil || probe.Group != group || probe.Format != "tensorflow-checkpoint" || probe.Variables != 1+group*74 {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}
func (d SpleeterDriver) ValidateCombination(req []*runtimev1.LocalCapabilityRequirement, b []*runtimev1.ModelAssetExactBinding, a []ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	if len(req) != 1 || len(b) != 1 || len(a) != 1 {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
	}
	return d.ValidateBinding(req[0], b[0], a[0])
}
func (SpleeterDriver) EffectiveRequestDefaults(string, *structpb.Struct) map[string]string {
	return nil
}
func (SpleeterDriver) ModelAssetFormatProbeBytes(input ModelAssetFormatProbeInput) int64 {
	if input.Entry && input.RelativePath == "model.meta" {
		return 1588447
	}
	return 4
}
func (SpleeterDriver) ProbeModelAsset(input ModelAssetFormatProbeInput, source io.ReaderAt, size int64) ([]byte, error) {
	if !input.Entry || input.RelativePath != "model.meta" {
		return nil, nil
	}
	for _, group := range []int{2, 4} {
		facts, _ := SpleeterFacts(group)
		if size != facts.MetaBytes {
			continue
		}
		data := make([]byte, size)
		if _, e := source.ReadAt(data, 0); e != nil {
			return nil, e
		}
		sum := sha256.Sum256(data)
		if hex.EncodeToString(sum[:]) != facts.MetaSHA {
			return nil, fmt.Errorf("Spleeter MetaGraph hash is not reviewed")
		}
		vars := 149
		if group == 4 {
			vars = 297
		}
		return json.Marshal(spleeterProbe{Format: "tensorflow-checkpoint", Group: group, Variables: vars})
	}
	return nil, fmt.Errorf("Spleeter MetaGraph size is not reviewed")
}
func (SpleeterDriver) PlanAudioSeparateInvocation(input AudioSeparateInvocationInput) (*AudioSeparateInvocationPlan, error) {
	bad := func(kind InvocationFailureKind, s string) (*AudioSeparateInvocationPlan, error) {
		return nil, invocationError(kind, fmt.Errorf("Spleeter %s", s))
	}
	group := spleeterRecipeGroup(input.RecipeID)
	facts, ok := SpleeterFacts(group)
	if !ok || !musicStructIsEmpty(input.PortableConfig) {
		return bad(InvocationFailureInvalidConfig, "recipe is invalid")
	}
	if input.Request == nil {
		return bad(InvocationFailureInvalidRequest, "request is missing")
	}
	if group == 2 && input.Request.GetIncludeInstrumentParts() {
		return bad(InvocationFailureUnsupported, "2 stems cannot provide instrument parts")
	}
	if len(input.ExactBindings) != 1 {
		return bad(InvocationFailureInvalidBinding, "binding is not exact")
	}
	binding := input.ExactBindings[0]
	if binding.RequirementID != DemucsModelRequirementID || binding.VerifiedContentID != facts.ContentID || binding.EntrySHA256 != facts.MetaSHA || !filepath.IsAbs(binding.BundleDir) || binding.AbsolutePath != filepath.Join(binding.BundleDir, "model.meta") || len(binding.DeclaredFiles) != 4 {
		return bad(InvocationFailureInvalidBinding, "checkpoint identity differs")
	}
	seenFiles := map[string]bool{}
	for _, path := range binding.DeclaredFiles {
		if seenFiles[path] {
			return bad(InvocationFailureInvalidBinding, "checkpoint file set repeats")
		}
		seenFiles[path] = true
		if _, ok := facts.Files[path]; !ok {
			return bad(InvocationFailureInvalidBinding, "checkpoint file set differs")
		}
	}
	info := input.SourceInfo
	if info == nil || info.GetSampleRateHz() != 44100 || info.GetChannels() != 2 || info.GetFrameCount() == 0 || info.GetFrameCount() > 600*44100 || !filepath.IsAbs(input.StagingDir) || input.SourcePath != filepath.Join(input.StagingDir, "source.wav") {
		return bad(InvocationFailureUnsupported, "requires captured 44100 Hz stereo canonical source")
	}
	var profile *InvocationExactDependencySource
	for i := range input.DependencySources {
		p := &input.DependencySources[i]
		if p.DependencyFamily == "python.package-set" && p.ConsumerScope == SpleeterConsumerID {
			if profile != nil {
				return bad(InvocationFailureInvalidConfig, "profile is ambiguous")
			}
			profile = p
		}
	}
	if profile == nil || !filepath.IsAbs(profile.CanonicalRoot) || profile.SelectedSourceRecordID == "" || profile.Version == "" || profile.Version != profile.Hashes["profile_digest"] || len(profile.Hashes["driver_bundle_sha256"]) != 64 {
		return bad(InvocationFailureInvalidConfig, "captured CPU profile is missing")
	}
	python := &PythonInvocationPlan{ConsumerID: SpleeterConsumerID, ProfileRoot: profile.CanonicalRoot, ProfileDigest: profile.Version, DriverBundleDigest: profile.Hashes["driver_bundle_sha256"], SelectedSourceRecordID: profile.SelectedSourceRecordID, InterpreterPath: filepath.Join(profile.CanonicalRoot, "Scripts", "python.exe"), ScriptPath: filepath.Join(profile.CanonicalRoot, "spleeter_driver.py")}
	h := sha256.New()
	for _, value := range append(invocationExactBindingIdentity(binding), input.RecipeID, profile.SelectedSourceRecordID, profile.Version, python.DriverBundleDigest, SpleeterDriverDialect) {
		_, _ = h.Write([]byte(value))
		_, _ = h.Write([]byte{0})
	}
	request, _ := proto.Clone(input.Request).(*runtimev1.AudioSeparateScenarioSpec)
	request.AudioSource = nil
	out := filepath.Join(input.StagingDir, "stems")
	return &AudioSeparateInvocationPlan{modelFiles: []InvocationExactBinding{binding}, request: request, mimeType: "audio/wav", nativeProcessKey: hex.EncodeToString(h.Sum(nil)), nativeDriverIdentity: Identity{ImplementationID: SpleeterImplementationID, DriverID: SpleeterDriverID, DriverDialect: SpleeterDriverDialect}, nativeModelRoot: binding.BundleDir, sourcePath: input.SourcePath, sourceInfo: proto.Clone(info).(*runtimev1.LocalAppAudioInfo), nativeOutDir: out, includeInstrument: request.GetIncludeInstrumentParts(), python: python, spleeterGroup: group, nativeCLIArgs: []string{python.ScriptPath, "--model-root", binding.BundleDir, "--group", fmt.Sprint(group), "--audio", input.SourcePath, "--output-dir", out}}, nil
}
