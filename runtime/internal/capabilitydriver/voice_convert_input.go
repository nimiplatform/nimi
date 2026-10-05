package capabilitydriver

import (
	"fmt"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"path/filepath"
	"strings"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.voice-conversion
// validateNativeVoiceConvertInput shares the existing owned singing/reference,
// range and exact native-package checks across concrete conversion families.
func validateNativeVoiceConvertInput(input VoiceConvertInvocationInput, maxTargetSeconds uint64) (*runtimev1.AudioVoiceConvertScenarioSpec, *runtimev1.LocalAppAudioInfo, *runtimev1.LocalAppAudioInfo, error) {
	bad := func(kind InvocationFailureKind, message string) (*runtimev1.AudioVoiceConvertScenarioSpec, *runtimev1.LocalAppAudioInfo, *runtimev1.LocalAppAudioInfo, error) {
		return nil, nil, nil, invocationError(kind, fmt.Errorf("voice conversion %s", message))
	}
	pkg := input.Package
	if pkg.AudioCppVersion != AudioCppMusicPackageVersion || pkg.AudioCppPackageID != AudioCppWindowsCUDA13PackageID || pkg.CUDA13DependencyID != AudioCppCUDA13RuntimeDependencyID || strings.TrimSpace(pkg.AudioCppSelectedSourceRecordID) == "" || strings.TrimSpace(pkg.CUDA13SelectedSourceRecordID) == "" || !filepath.IsAbs(pkg.AudioCppRoot) || !filepath.IsAbs(pkg.AudioCppExecutablePath) || !filepath.IsAbs(pkg.CUDA13Root) || !musicPathWithin(pkg.AudioCppRoot, pkg.AudioCppExecutablePath) || !strings.EqualFold(filepath.Base(pkg.AudioCppExecutablePath), "audiocpp_cli.exe") {
		return bad(InvocationFailureInvalidConfig, "requires the captured audio.cpp 0.8.1 CUDA package")
	}
	if !filepath.IsAbs(input.StagingDir) || filepath.Clean(input.SourcePath) != filepath.Join(filepath.Clean(input.StagingDir), "source.wav") {
		return bad(InvocationFailureInvalidConfig, "requires a private canonical source.wav")
	}
	r := input.Request
	if r == nil || r.GetSourceVocal().GetArtifactId() == "" || r.GetSourceKind() != runtimev1.VoiceConvertSourceKind_VOICE_CONVERT_SOURCE_KIND_SINGING {
		return bad(InvocationFailureUnsupported, "requires an owned singing source vocal")
	}
	target := r.GetTargetVoice()
	if target == nil {
		return bad(InvocationFailureInvalidRequest, "target voice is required")
	}
	reference := target.GetReferenceAudio()
	switch {
	case reference != nil && target.GetPresetVoiceId() == "" && target.GetVoiceAssetId() == "":
		if reference.GetArtifactId() == "" || reference.GetArtifactId() == r.GetSourceVocal().GetArtifactId() {
			return bad(InvocationFailureInvalidRequest, "target reference must be a distinct artifact from the source vocal")
		}
		if filepath.Clean(input.TargetPath) != filepath.Join(filepath.Clean(input.StagingDir), "target.wav") {
			return bad(InvocationFailureInvalidConfig, "requires a private canonical target.wav")
		}
	case target.GetPresetVoiceId() != "" || target.GetVoiceAssetId() != "":
		return bad(InvocationFailureUnsupported, "this implementation requires a target reference audio carrier")
	default:
		return bad(InvocationFailureInvalidRequest, "exactly one target voice carrier is required")
	}
	shift := int32(0)
	if r.SemitoneShift != nil {
		shift = r.GetSemitoneShift()
	}
	if shift < -12 || shift > 12 {
		return bad(InvocationFailureInvalidRequest, "semitone shift is outside the supported range")
	}
	sourceInfo := input.SourceInfo
	if sourceInfo == nil || sourceInfo.GetSampleRateHz() < 8000 || sourceInfo.GetSampleRateHz() > 96000 || sourceInfo.GetChannels() < 1 || sourceInfo.GetChannels() > 2 || sourceInfo.GetFrameCount() == 0 || sourceInfo.GetFrameCount() > uint64(sourceInfo.GetSampleRateHz())*600 {
		return bad(InvocationFailureInvalidRequest, "source vocal facts are invalid")
	}
	request := proto.Clone(r).(*runtimev1.AudioVoiceConvertScenarioSpec)
	if request.SourceVocal.Range == nil {
		request.SourceVocal.Range = &runtimev1.AudioFrameRange{EndFrame: sourceInfo.GetFrameCount()}
	}
	rangeValue := request.SourceVocal.Range
	if rangeValue.GetEndFrame() <= rangeValue.GetStartFrame() || rangeValue.GetEndFrame() > sourceInfo.GetFrameCount() {
		return bad(InvocationFailureInvalidRequest, "source vocal range is invalid")
	}
	sourceInfo = proto.Clone(sourceInfo).(*runtimev1.LocalAppAudioInfo)
	var targetInfo *runtimev1.LocalAppAudioInfo
	if reference != nil {
		targetInfo = proto.Clone(input.TargetInfo).(*runtimev1.LocalAppAudioInfo)
		if targetInfo == nil || targetInfo.GetSampleRateHz() < 8000 || targetInfo.GetSampleRateHz() > 96000 || targetInfo.GetChannels() < 1 || targetInfo.GetChannels() > 2 || targetInfo.GetFrameCount() == 0 || targetInfo.GetFrameCount() > uint64(targetInfo.GetSampleRateHz())*maxTargetSeconds {
			return bad(InvocationFailureInvalidRequest, "target reference facts are invalid")
		}
	}
	return request, sourceInfo, targetInfo, nil
}
