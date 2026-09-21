package ai

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/musicscore"
	"github.com/oklog/ulid/v2"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

func cloneMusicTranscription(value *runtimev1.MusicTranscription) *runtimev1.MusicTranscription {
	if value == nil {
		return nil
	}
	return proto.Clone(value).(*runtimev1.MusicTranscription)
}

// @nimi-authority: rule.nimi.runtime.ai-provider.music-transcription
func (s *Service) commitLocalMusicTranscription(ctx context.Context, jobID string, effective *localMusicEffectiveInputs, result localexecution.MusicResult) error {
	output := result.Transcription
	request := effective.transcriptionRequest
	if output == nil || request == nil {
		return fmt.Errorf("music transcription result is missing")
	}
	requested := map[runtimev1.MusicTranscriptionFormat]bool{}
	for _, format := range request.GetRequestedFormats() {
		requested[format] = true
	}
	expected := map[[2]int32]bool{}
	for _, part := range request.GetRequestedParts() {
		for _, format := range request.GetRequestedFormats() {
			if format != runtimev1.MusicTranscriptionFormat_MUSIC_TRANSCRIPTION_FORMAT_TIMELINE {
				expected[[2]int32{int32(format), int32(part)}] = true
			}
		}
	}
	summary := &runtimev1.MusicTranscription{Origin: runtimev1.MusicScoreOrigin_MUSIC_SCORE_ORIGIN_TRANSCRIBED_ESTIMATE,
		SourceArtifactId: request.GetSourceAudio().GetArtifactId(), SourceInfo: effective.plan.TranscriptionSourceInfo(),
		InputRange: proto.Clone(request.GetSourceAudio().GetRange()).(*runtimev1.AudioFrameRange), Completeness: output.Completeness}
	var artifacts []*runtimev1.ScenarioArtifact
	bodies := map[string]*capabilitydriver.ArtifactBody{}
	defer capabilitydriver.CloseArtifactBodies(bodies)
	add := func(mime string, data []byte) (string, error) {
		digest := sha256.Sum256(data)
		id := ulid.Make().String()
		body, err := capabilitydriver.NewBoundedArtifactBody(data)
		if err != nil {
			return "", err
		}
		bodies[id] = body
		artifacts = append(artifacts, &runtimev1.ScenarioArtifact{ArtifactId: id, MimeType: mime, SizeBytes: int64(len(data)), Sha256: hex.EncodeToString(digest[:])})
		return id, nil
	}
	for _, score := range output.Scores {
		key := [2]int32{int32(score.Format), int32(score.Part)}
		if !expected[key] {
			return fmt.Errorf("music transcription score is duplicated or was not requested")
		}
		delete(expected, key)
		mime := ""
		switch score.Format {
		case runtimev1.MusicScoreFormat_MUSIC_SCORE_FORMAT_ABC:
			if err := musicscore.ValidateABC(score.Bytes, false); err != nil {
				return err
			}
			mime = "text/vnd.abc"
		case runtimev1.MusicScoreFormat_MUSIC_SCORE_FORMAT_MIDI:
			// No current Driver emits MIDI; admission cannot invent a conversion.
			return fmt.Errorf("MIDI transcription output validation has no admitted implementation")
		default:
			return fmt.Errorf("music transcription score format is invalid")
		}
		id, err := add(mime, score.Bytes)
		if err != nil {
			return err
		}
		summary.Scores = append(summary.Scores, &runtimev1.MusicTranscribedScore{ArtifactId: id, Format: score.Format, Part: score.Part})
	}
	if len(expected) != 0 {
		return fmt.Errorf("requested transcription score is missing")
	}
	if requested[runtimev1.MusicTranscriptionFormat_MUSIC_TRANSCRIPTION_FORMAT_TIMELINE] {
		timeline, err := musicscore.ParseTimeline(output.TimelineJSON)
		if err != nil {
			return err
		}
		info := summary.GetSourceInfo()
		if timeline.SourceArtifactID != summary.SourceArtifactId || timeline.AudioInfo.SampleRateHz != info.GetSampleRateHz() || timeline.AudioInfo.Channels != info.GetChannels() || timeline.AudioInfo.FrameCount != info.GetFrameCount() || timeline.InputRange.StartFrame != summary.InputRange.StartFrame || timeline.InputRange.EndFrame != summary.InputRange.EndFrame {
			return fmt.Errorf("music timeline source identity changed")
		}
		id, err := add(musicscore.TimelineMIME, output.TimelineJSON)
		if err != nil {
			return err
		}
		summary.TimelineArtifactId = id
	} else if len(output.TimelineJSON) != 0 {
		return fmt.Errorf("music timeline was not requested")
	}
	bound, err := bindRuntimeJobArtifacts(jobID, effective.head, artifacts)
	if err != nil {
		return err
	}
	probe := &runtimev1.ScenarioJob{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_TRANSCRIBE, Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED, Artifacts: bound, MusicTranscription: summary}
	if err := validateMusicTranscriptionResult(probe); err != nil {
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
				s.deleteRuntimeArtifactCandidate(id, "music transcription output set was not committed")
			}
		}
	}()
	_, ok, err := s.transitionScenarioJob(jobID, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED, func(job *runtimev1.ScenarioJob) {
		job.Artifacts = bound
		job.MusicTranscription = summary
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
		return fmt.Errorf("music transcription publication was interrupted")
	}
	committed = true
	return nil
}

func validateMusicTranscriptionResult(job *runtimev1.ScenarioJob) error {
	value := job.GetMusicTranscription()
	if job.GetScenarioType() != runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_TRANSCRIBE || job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		if value != nil {
			return fmt.Errorf("music transcription result is not terminal success")
		}
		return nil
	}
	if value == nil || value.GetOrigin() != runtimev1.MusicScoreOrigin_MUSIC_SCORE_ORIGIN_TRANSCRIBED_ESTIMATE || !localAppBoundedIdentifier(value.GetSourceArtifactId()) {
		return fmt.Errorf("music transcription provenance is invalid")
	}
	i := value.GetSourceInfo()
	r := value.GetInputRange()
	if i.GetSampleRateHz() < 8000 || i.GetSampleRateHz() > 96000 || i.GetChannels() < 1 || i.GetChannels() > 2 || i.GetFrameCount() == 0 || i.GetFrameCount() > uint64(i.GetSampleRateHz())*600 || i.GetDurationMs() != int64(i.GetFrameCount()*1000/uint64(i.GetSampleRateHz())) || r.GetEndFrame() <= r.GetStartFrame() || r.GetEndFrame() > i.GetFrameCount() {
		return fmt.Errorf("music transcription source facts are invalid")
	}
	switch value.GetCompleteness() {
	case runtimev1.MusicTranscriptionCompleteness_MUSIC_TRANSCRIPTION_COMPLETENESS_UNKNOWN, runtimev1.MusicTranscriptionCompleteness_MUSIC_TRANSCRIPTION_COMPLETENESS_COMPLETE, runtimev1.MusicTranscriptionCompleteness_MUSIC_TRANSCRIPTION_COMPLETENESS_TRUNCATED:
	default:
		return fmt.Errorf("music transcription completeness is invalid")
	}
	expected := map[string]string{}
	parts := map[[2]int32]bool{}
	for _, score := range value.GetScores() {
		key := [2]int32{int32(score.GetFormat()), int32(score.GetPart())}
		if !localAppBoundedIdentifier(score.GetArtifactId()) || expected[score.GetArtifactId()] != "" || parts[key] || score.GetPart() < runtimev1.MusicTranscriptionPart_MUSIC_TRANSCRIPTION_PART_VOCAL_MELODY || score.GetPart() > runtimev1.MusicTranscriptionPart_MUSIC_TRANSCRIPTION_PART_FULL_ARRANGEMENT {
			return fmt.Errorf("music transcription score identity is invalid")
		}
		parts[key] = true
		switch score.GetFormat() {
		case runtimev1.MusicScoreFormat_MUSIC_SCORE_FORMAT_ABC:
			expected[score.ArtifactId] = "text/vnd.abc"
		case runtimev1.MusicScoreFormat_MUSIC_SCORE_FORMAT_MIDI:
			expected[score.ArtifactId] = "audio/midi"
		default:
			return fmt.Errorf("music transcription score format is invalid")
		}
	}
	if id := value.GetTimelineArtifactId(); id != "" {
		if !localAppBoundedIdentifier(id) || expected[id] != "" {
			return fmt.Errorf("music timeline identity is invalid")
		}
		expected[id] = musicscore.TimelineMIME
	}
	if len(expected) < 1 || len(expected) != len(job.GetArtifacts()) {
		return fmt.Errorf("music transcription artifact set is incomplete")
	}
	for _, artifact := range job.GetArtifacts() {
		mime, ok := expected[artifact.GetArtifactId()]
		if !ok || artifact.GetMimeType() != mime || artifact.GetSizeBytes() <= 0 || artifact.GetSizeBytes() > 16<<20 || (mime == "text/vnd.abc" && artifact.GetSizeBytes() > 1<<20) {
			return fmt.Errorf("music transcription artifact facts are invalid")
		}
		delete(expected, artifact.GetArtifactId())
	}
	return nil
}

func validateCapturedMusicTranscription(job *runtimev1.ScenarioJob, assembly *localResolvedAssembly) error {
	if err := validateMusicTranscriptionResult(job); err != nil {
		return err
	}
	if job.GetMusicTranscription() == nil {
		return nil
	}
	if assembly == nil || assembly.LoadPlan.Music == nil || assembly.Request.Kind != capabilitydriver.MusicTranscribeCapabilityContract {
		return fmt.Errorf("music transcription lost its captured source")
	}
	request := &runtimev1.MusicTranscribeScenarioSpec{}
	if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(assembly.Request.Payload, request); err != nil {
		return err
	}
	result := job.GetMusicTranscription()
	if result.GetSourceArtifactId() != request.GetSourceAudio().GetArtifactId() || !proto.Equal(result.GetSourceInfo(), assembly.LoadPlan.Music.SourceInfo) || !proto.Equal(result.GetInputRange(), request.GetSourceAudio().GetRange()) {
		return fmt.Errorf("music transcription differs from captured source facts")
	}
	expected := map[[2]int32]bool{}
	timeline := false
	for _, format := range request.GetRequestedFormats() {
		if format == runtimev1.MusicTranscriptionFormat_MUSIC_TRANSCRIPTION_FORMAT_TIMELINE {
			timeline = true
			continue
		}
		for _, part := range request.GetRequestedParts() {
			expected[[2]int32{int32(format), int32(part)}] = true
		}
	}
	for _, score := range result.GetScores() {
		key := [2]int32{int32(score.GetFormat()), int32(score.GetPart())}
		if !expected[key] {
			return fmt.Errorf("music transcription score was not requested")
		}
		delete(expected, key)
	}
	if len(expected) != 0 || timeline != (result.GetTimelineArtifactId() != "") {
		return fmt.Errorf("music transcription requested outputs are incomplete")
	}
	return nil
}
