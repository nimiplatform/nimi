package capabilitydriver

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.voice-conversion
type VoiceConvertInvocationInput struct {
	LoadoutID      string
	RecipeID       string
	PortableConfig *structpb.Struct
	ExactBindings  []InvocationExactBinding
	Package        AudioCppRuntimePackageInput
	Request        *runtimev1.AudioVoiceConvertScenarioSpec
	SourceInfo     *runtimev1.LocalAppAudioInfo
	TargetInfo     *runtimev1.LocalAppAudioInfo
	SourcePath     string
	TargetPath     string
	StagingDir     string
}

type VoiceConvertInvocationDriver interface {
	Driver
	PlanVoiceConvertInvocation(VoiceConvertInvocationInput) (*MusicInvocationPlan, error)
}

type voiceConvertPlan struct {
	sourcePath string
	targetPath string
	outPath    string
	request    *runtimev1.AudioVoiceConvertScenarioSpec
	sourceInfo *runtimev1.LocalAppAudioInfo
	targetInfo *runtimev1.LocalAppAudioInfo
}

func (p *MusicInvocationPlan) IsVoiceConvert() bool { return p != nil && p.voiceConvert != nil }

func (p *MusicInvocationPlan) VoiceConvertSourcePath() string {
	if !p.IsVoiceConvert() {
		return ""
	}
	return p.voiceConvert.sourcePath
}

func (p *MusicInvocationPlan) VoiceConvertTargetPath() string {
	if !p.IsVoiceConvert() {
		return ""
	}
	return p.voiceConvert.targetPath
}

func (p *MusicInvocationPlan) VoiceConvertOutPath() string {
	if !p.IsVoiceConvert() {
		return ""
	}
	return p.voiceConvert.outPath
}

func (p *MusicInvocationPlan) VoiceConvertSourceInfo() *runtimev1.LocalAppAudioInfo {
	if !p.IsVoiceConvert() {
		return nil
	}
	return proto.Clone(p.voiceConvert.sourceInfo).(*runtimev1.LocalAppAudioInfo)
}

func (p *MusicInvocationPlan) VoiceConvertTargetInfo() *runtimev1.LocalAppAudioInfo {
	if !p.IsVoiceConvert() || p.voiceConvert.targetInfo == nil {
		return nil
	}
	return proto.Clone(p.voiceConvert.targetInfo).(*runtimev1.LocalAppAudioInfo)
}

func (p *MusicInvocationPlan) VoiceConvertRequest() *runtimev1.AudioVoiceConvertScenarioSpec {
	if !p.IsVoiceConvert() {
		return nil
	}
	return proto.Clone(p.voiceConvert.request).(*runtimev1.AudioVoiceConvertScenarioSpec)
}

// VoiceConvertStagingPaths returns the private materialized inputs of a voice
// conversion for cleanup after execution.
func (p *MusicInvocationPlan) VoiceConvertStagingPaths() []string {
	if !p.IsVoiceConvert() {
		return nil
	}
	paths := []string{p.voiceConvert.outPath}
	if p.voiceConvert.sourcePath != "" {
		paths = append(paths, p.voiceConvert.sourcePath)
	}
	if p.voiceConvert.targetPath != "" {
		paths = append(paths, p.voiceConvert.targetPath)
	}
	return paths
}
