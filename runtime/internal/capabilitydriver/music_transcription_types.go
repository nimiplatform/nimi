package capabilitydriver

import (
	"fmt"
	"path/filepath"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.music-transcription
type MusicTranscriptionInvocationInput struct {
	LoadoutID      string
	RecipeID       string
	PortableConfig *structpb.Struct
	ExactBindings  []InvocationExactBinding
	Package        AudioCppRuntimePackageInput
	Request        *runtimev1.MusicTranscribeScenarioSpec
	SourceInfo     *runtimev1.LocalAppAudioInfo
	SourcePath     string
	StagingDir     string
}

type MusicTranscriptionInvocationDriver interface {
	Driver
	PlanMusicTranscriptionInvocation(MusicTranscriptionInvocationInput) (*MusicInvocationPlan, error)
}

type MusicTranscriptionScoreOutput struct {
	Format runtimev1.MusicScoreFormat
	Part   runtimev1.MusicTranscriptionPart
	Bytes  []byte
}

// Private normalized bytes only. The service assigns references after the
// complete requested output set has entered owned artifact custody.
type MusicTranscriptionOutput struct {
	Scores       []MusicTranscriptionScoreOutput
	TimelineJSON []byte
	Completeness runtimev1.MusicTranscriptionCompleteness
}

type musicTranscriptionPlan struct {
	sourcePath string
	scorePath  string
	eventsPath string
	request    *runtimev1.MusicTranscribeScenarioSpec
	sourceInfo *runtimev1.LocalAppAudioInfo
	normalize  func([]byte, []byte) (*MusicTranscriptionOutput, error)
}

func (p *MusicInvocationPlan) IsTranscription() bool { return p != nil && p.transcription != nil }

func (p *MusicInvocationPlan) PrimaryStagingOutputPath() string {
	if p == nil {
		return ""
	}
	if p.transcription != nil {
		return p.transcription.scorePath
	}
	return p.stagingWAVPath
}

func (p *MusicInvocationPlan) StagingDirectory() string {
	if p == nil || p.PrimaryStagingOutputPath() == "" {
		return ""
	}
	return filepath.Dir(p.PrimaryStagingOutputPath())
}

func (p *MusicInvocationPlan) StagingOutputPaths() []string {
	if p == nil {
		return nil
	}
	if p.transcription != nil {
		return []string{p.transcription.scorePath, p.transcription.eventsPath}
	}
	paths := []string{p.stagingWAVPath}
	if p.stagingScorePath != "" {
		paths = append(paths, p.stagingScorePath)
	}
	return paths
}

func (p *MusicInvocationPlan) TranscriptionSourcePath() string {
	if !p.IsTranscription() {
		return ""
	}
	return p.transcription.sourcePath
}

func (p *MusicInvocationPlan) TranscriptionSourceInfo() *runtimev1.LocalAppAudioInfo {
	if !p.IsTranscription() {
		return nil
	}
	return proto.Clone(p.transcription.sourceInfo).(*runtimev1.LocalAppAudioInfo)
}

func (p *MusicInvocationPlan) TranscriptionRequest() *runtimev1.MusicTranscribeScenarioSpec {
	if !p.IsTranscription() {
		return nil
	}
	return proto.Clone(p.transcription.request).(*runtimev1.MusicTranscribeScenarioSpec)
}

func (p *MusicInvocationPlan) NormalizeTranscription(score, events []byte) (*MusicTranscriptionOutput, error) {
	if !p.IsTranscription() || p.transcription.normalize == nil {
		return nil, fmt.Errorf("music transcription normalizer is unavailable")
	}
	return p.transcription.normalize(score, events)
}
