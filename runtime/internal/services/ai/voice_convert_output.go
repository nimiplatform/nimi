package ai

import (
	"context"
	"fmt"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

func cloneVoiceConversion(value *runtimev1.VoiceConversion) *runtimev1.VoiceConversion {
	if value == nil {
		return nil
	}
	return proto.Clone(value).(*runtimev1.VoiceConversion)
}

// @nimi-authority: rule.nimi.runtime.ai-provider.voice-conversion-length
func voiceConversionLength(relationSourceRate uint32, relationSourceFrames uint64, outRate uint32, outFrames uint64) (runtimev1.VoiceConversionLengthRelation, int64) {
	if relationSourceRate == 0 || outRate == 0 {
		return runtimev1.VoiceConversionLengthRelation_VOICE_CONVERSION_LENGTH_RELATION_MODEL_FRAME_ROUNDING, 0
	}
	if outFrames*uint64(relationSourceRate) == relationSourceFrames*uint64(outRate) {
		return runtimev1.VoiceConversionLengthRelation_VOICE_CONVERSION_LENGTH_RELATION_EXACT, 0
	}
	return runtimev1.VoiceConversionLengthRelation_VOICE_CONVERSION_LENGTH_RELATION_MODEL_FRAME_ROUNDING, voiceConversionDeltaMs(relationSourceRate, relationSourceFrames, outRate, outFrames)
}

// voiceConversionDeltaMs is the reported vocal duration minus the analyzed
// range duration, both floored milliseconds of their frame counts: the same
// published facts every SDK and carrier projection re-derives and checks.
func voiceConversionDeltaMs(relationSourceRate uint32, relationSourceFrames uint64, outRate uint32, outFrames uint64) int64 {
	return int64(outFrames*1000/uint64(outRate)) - int64(relationSourceFrames*1000/uint64(relationSourceRate))
}

// @nimi-authority: rule.nimi.runtime.ai-provider.voice-conversion
func (s *Service) commitLocalVoiceConvert(ctx context.Context, jobID string, effective *localMusicEffectiveInputs, result localexecution.MusicResult) error {
	request := effective.voiceConvertRequest
	if request == nil || result.StagingWAVPath == "" {
		return fmt.Errorf("voice conversion result is missing")
	}
	wav, err := validateLocalMusicWAV(ctx, result, effective.plan)
	if err != nil {
		return err
	}
	sourceInfo := effective.plan.VoiceConvertSourceInfo()
	inputRange := proto.Clone(request.GetSourceVocal().GetRange()).(*runtimev1.AudioFrameRange)
	vocalInfo := &runtimev1.LocalAppAudioInfo{SampleRateHz: uint32(wav.SampleRate), Channels: uint32(wav.Channels), FrameCount: wav.FrameCount, DurationMs: wav.DurationMS}
	relation, deltaMs := voiceConversionLength(sourceInfo.GetSampleRateHz(), inputRange.GetEndFrame()-inputRange.GetStartFrame(), uint32(wav.SampleRate), wav.FrameCount)
	artifact, body, err := localMusicArtifactBody(wav)
	if err != nil {
		return err
	}
	bodies := map[string]*capabilitydriver.ArtifactBody{artifact.ArtifactId: body}
	defer capabilitydriver.CloseArtifactBodies(bodies)
	summary := &runtimev1.VoiceConversion{
		VocalArtifactId:  artifact.ArtifactId,
		SourceArtifactId: request.GetSourceVocal().GetArtifactId(),
		SourceInfo:       sourceInfo,
		InputRange:       inputRange,
		VocalInfo:        vocalInfo,
		LengthRelation:   relation,
		DurationDeltaMs:  deltaMs,
	}
	bound, err := bindRuntimeJobArtifacts(jobID, effective.head, []*runtimev1.ScenarioArtifact{artifact})
	if err != nil {
		return err
	}
	probe := &runtimev1.ScenarioJob{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_AUDIO_VOICE_CONVERT, Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED, Artifacts: bound, VoiceConversion: summary}
	if err := validateVoiceConvertResult(probe); err != nil {
		return err
	}
	stored, err := s.storeRuntimeJobArtifacts(ctx, jobID, effective.head, bound, bodies)
	if err != nil {
		return err
	}
	committed := false
	defer func() {
		if !committed {
			for _, id := range stored {
				s.deleteRuntimeArtifactCandidate(id, "voice conversion output was not committed")
			}
		}
	}()
	_, ok, err := s.transitionScenarioJob(jobID, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED, func(job *runtimev1.ScenarioJob) {
		job.Artifacts = bound
		job.VoiceConversion = summary
		job.ReasonCode = runtimev1.ReasonCode_ACTION_EXECUTED
		job.Usage = &runtimev1.UsageStats{ComputeMs: result.ComputeMS}
		job.ProgressPercent = 0
		job.ProgressCurrentStep = 0
		job.ProgressTotalSteps = 0
	})
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("voice conversion publication was interrupted")
	}
	committed = true
	return nil
}

func validateVoiceConvertResult(job *runtimev1.ScenarioJob) error {
	value := job.GetVoiceConversion()
	if job.GetScenarioType() != runtimev1.ScenarioType_SCENARIO_TYPE_AUDIO_VOICE_CONVERT || job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		if value != nil {
			return fmt.Errorf("voice conversion result is not terminal success")
		}
		return nil
	}
	if value == nil || !localAppBoundedIdentifier(value.GetVocalArtifactId()) || !localAppBoundedIdentifier(value.GetSourceArtifactId()) {
		return fmt.Errorf("voice conversion provenance is invalid")
	}
	i := value.GetSourceInfo()
	r := value.GetInputRange()
	if i.GetSampleRateHz() < 8000 || i.GetSampleRateHz() > 96000 || i.GetChannels() < 1 || i.GetChannels() > 2 || i.GetFrameCount() == 0 || i.GetFrameCount() > uint64(i.GetSampleRateHz())*600 || i.GetDurationMs() != int64(i.GetFrameCount()*1000/uint64(i.GetSampleRateHz())) || r.GetEndFrame() <= r.GetStartFrame() || r.GetEndFrame() > i.GetFrameCount() {
		return fmt.Errorf("voice conversion source facts are invalid")
	}
	v := value.GetVocalInfo()
	if v.GetSampleRateHz() != 24000 || v.GetChannels() != 1 || v.GetFrameCount() == 0 || v.GetDurationMs() != int64(v.GetFrameCount()*1000/uint64(v.GetSampleRateHz())) {
		return fmt.Errorf("voice conversion vocal facts are invalid")
	}
	delta := value.GetDurationDeltaMs()
	if delta != voiceConversionDeltaMs(i.GetSampleRateHz(), r.GetEndFrame()-r.GetStartFrame(), v.GetSampleRateHz(), v.GetFrameCount()) {
		return fmt.Errorf("voice conversion duration delta is inconsistent")
	}
	switch value.GetLengthRelation() {
	case runtimev1.VoiceConversionLengthRelation_VOICE_CONVERSION_LENGTH_RELATION_EXACT:
		if delta != 0 {
			return fmt.Errorf("voice conversion length relation is invalid")
		}
	case runtimev1.VoiceConversionLengthRelation_VOICE_CONVERSION_LENGTH_RELATION_MODEL_FRAME_ROUNDING:
		if delta <= -1000 || delta >= 1000 {
			return fmt.Errorf("voice conversion length relation is invalid")
		}
	default:
		return fmt.Errorf("voice conversion length relation is invalid")
	}
	expected := map[string]string{value.GetVocalArtifactId(): "audio/wav"}
	if len(expected) != len(job.GetArtifacts()) {
		return fmt.Errorf("voice conversion artifact set is incomplete")
	}
	for _, artifact := range job.GetArtifacts() {
		mime, ok := expected[artifact.GetArtifactId()]
		if !ok || artifact.GetMimeType() != mime || artifact.GetSizeBytes() <= 0 || artifact.GetSizeBytes() > 512<<20 {
			return fmt.Errorf("voice conversion artifact facts are invalid")
		}
		delete(expected, artifact.GetArtifactId())
	}
	return nil
}

func validateCapturedVoiceConvert(job *runtimev1.ScenarioJob, assembly *localResolvedAssembly) error {
	if err := validateVoiceConvertResult(job); err != nil {
		return err
	}
	if job.GetVoiceConversion() == nil {
		return nil
	}
	if assembly == nil || assembly.LoadPlan.Music == nil || assembly.Request.Kind != capabilitydriver.VoiceConvertCapabilityContract {
		return fmt.Errorf("voice conversion lost its captured source")
	}
	request := &runtimev1.AudioVoiceConvertScenarioSpec{}
	if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(assembly.Request.Payload, request); err != nil {
		return err
	}
	result := job.GetVoiceConversion()
	if result.GetSourceArtifactId() != request.GetSourceVocal().GetArtifactId() || !proto.Equal(result.GetSourceInfo(), assembly.LoadPlan.Music.SourceInfo) || !proto.Equal(result.GetInputRange(), request.GetSourceVocal().GetRange()) {
		return fmt.Errorf("voice conversion differs from captured source facts")
	}
	return nil
}
