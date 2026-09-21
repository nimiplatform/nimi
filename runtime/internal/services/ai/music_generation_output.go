package ai

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/musicscore"
	runtimeartifact "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"github.com/oklog/ulid/v2"
	"google.golang.org/protobuf/proto"
)

func cloneMusicGeneration(value *runtimev1.MusicGeneration) *runtimev1.MusicGeneration {
	if value == nil {
		return nil
	}
	return proto.Clone(value).(*runtimev1.MusicGeneration)
}

type musicGenerationPublication struct {
	WAV            validatedLocalMusicWAV
	ScorePath      string
	RequireScore   bool
	ActualSeed     *uint32
	Termination    runtimev1.MusicGenerationTermination
	ScoreTruncated bool
	Usage          *runtimev1.UsageStats
}

func (s *Service) commitLocalMusicGeneration(ctx context.Context, jobID string, effective *localMusicEffectiveInputs, result localexecution.MusicResult, wav validatedLocalMusicWAV) error {
	seed := uint32(effective.plan.Seed())
	termination := runtimev1.MusicGenerationTermination_MUSIC_GENERATION_TERMINATION_UNKNOWN
	switch result.InferenceFacts.Termination {
	case capabilitydriver.MusicTerminationModelEnd:
		termination = runtimev1.MusicGenerationTermination_MUSIC_GENERATION_TERMINATION_MODEL_END
	case capabilitydriver.MusicTerminationBudgetLimit:
		termination = runtimev1.MusicGenerationTermination_MUSIC_GENERATION_TERMINATION_BUDGET_LIMIT
	}
	return s.commitMusicGeneration(ctx, jobID, effective.head, musicGenerationPublication{WAV: wav, ScorePath: effective.plan.StagingScorePath(), RequireScore: effective.request.GetReturnGeneratedScore(), ActualSeed: &seed, Termination: termination, ScoreTruncated: result.InferenceFacts.GeneratedScoreTruncated, Usage: &runtimev1.UsageStats{ComputeMs: result.ComputeMS}})
}

// @nimi-authority: rule.nimi.runtime.ai-provider.music-generation
func (s *Service) commitMusicGeneration(ctx context.Context, jobID string, head *runtimev1.ScenarioRequestHead, output musicGenerationPublication) error {
	wav := output.WAV
	mix, body, err := localMusicArtifactBody(wav)
	if err != nil {
		return err
	}
	bodies := map[string]*capabilitydriver.ArtifactBody{mix.GetArtifactId(): body}
	defer capabilitydriver.CloseArtifactBodies(bodies)
	artifacts := []*runtimev1.ScenarioArtifact{mix}
	summary := &runtimev1.MusicGeneration{MixArtifactId: mix.GetArtifactId(), ActualSeed: output.ActualSeed, Termination: output.Termination, AudioInfo: &runtimev1.LocalAppAudioInfo{SampleRateHz: uint32(wav.SampleRate), Channels: uint32(wav.Channels), FrameCount: wav.FrameCount, DurationMs: wav.DurationMS}}
	if path := output.ScorePath; path != "" {
		file, err := os.Open(path)
		if err != nil {
			return fmt.Errorf("open generated music score: %w", err)
		}
		data, readErr := io.ReadAll(io.LimitReader(file, musicscore.MaxBytes+1))
		_ = file.Close()
		if readErr != nil {
			return readErr
		}
		if err := musicscore.ValidateABC(data, false); err != nil {
			return fmt.Errorf("generated score is invalid: %w", err)
		}
		digest := sha256.Sum256(data)
		score := &runtimev1.ScenarioArtifact{ArtifactId: ulid.Make().String(), MimeType: "text/vnd.abc", SizeBytes: int64(len(data)), Sha256: hex.EncodeToString(digest[:])}
		scoreBody, err := capabilitydriver.NewBoundedArtifactBody(data)
		if err != nil {
			return err
		}
		bodies[score.GetArtifactId()] = scoreBody
		artifacts = append(artifacts, score)
		summary.GeneratedScore = &runtimev1.MusicScoreArtifact{ArtifactId: score.GetArtifactId(), Format: runtimev1.MusicScoreFormat_MUSIC_SCORE_FORMAT_ABC, Origin: runtimev1.MusicScoreOrigin_MUSIC_SCORE_ORIGIN_GENERATED_PLAN, Truncated: output.ScoreTruncated}
	} else if output.RequireScore {
		return fmt.Errorf("requested generated score is missing")
	}
	bound, err := bindRuntimeJobArtifacts(jobID, head, artifacts)
	if err != nil {
		return err
	}
	stored := []string{}
	committed := false
	defer func() {
		if !committed {
			for _, id := range stored {
				s.deleteRuntimeArtifactCandidate(id, "music output set was not committed")
			}
		}
	}()
	for _, artifact := range bound {
		var info *runtimeartifact.CanonicalAudioInfo
		if artifact.GetArtifactId() == mix.GetArtifactId() {
			info = &runtimeartifact.CanonicalAudioInfo{SampleRateHz: uint32(wav.SampleRate), Channels: uint16(wav.Channels), FrameCount: wav.FrameCount, DataOffset: wav.DataOffset}
		}
		created, err := s.storeRuntimeJobArtifact(ctx, jobID, head, artifact, bodies[artifact.GetArtifactId()], info)
		if err != nil {
			return err
		}
		if created {
			stored = append(stored, artifact.GetArtifactId())
		}
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	_, ok, err := s.transitionScenarioJob(jobID, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED, func(job *runtimev1.ScenarioJob) {
		job.Artifacts = bound
		job.MusicGeneration = summary
		job.ReasonCode = runtimev1.ReasonCode_ACTION_EXECUTED
		job.Usage = output.Usage
		job.ProgressPercent = 0
		job.ProgressCurrentStep = 0
		job.ProgressTotalSteps = 0
	})
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("music output publication was interrupted")
	}
	committed = true
	return nil
}

func validateMusicGenerationResult(job *runtimev1.ScenarioJob) error {
	value := job.GetMusicGeneration()
	completed := job.GetScenarioType() == runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE && job.GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED
	if !completed {
		if value != nil {
			return fmt.Errorf("music generation result is not terminal success")
		}
		return nil
	}
	if value == nil || value.GetAudioInfo() == nil {
		return fmt.Errorf("music generation requires its typed result")
	}
	info := value.GetAudioInfo()
	if info.GetSampleRateHz() < 8000 || info.GetSampleRateHz() > 96000 || info.GetChannels() < 1 || info.GetChannels() > 2 || info.GetFrameCount() == 0 || info.GetFrameCount() > uint64(info.GetSampleRateHz())*600 || info.GetDurationMs() != int64(info.GetFrameCount()*1000/uint64(info.GetSampleRateHz())) {
		return fmt.Errorf("music output audio facts are inconsistent")
	}
	switch value.GetTermination() {
	case runtimev1.MusicGenerationTermination_MUSIC_GENERATION_TERMINATION_UNKNOWN, runtimev1.MusicGenerationTermination_MUSIC_GENERATION_TERMINATION_MODEL_END, runtimev1.MusicGenerationTermination_MUSIC_GENERATION_TERMINATION_BUDGET_LIMIT:
	default:
		return fmt.Errorf("music termination is invalid")
	}
	expected := 1
	if value.GetGeneratedScore() != nil {
		expected = 2
	}
	if len(job.GetArtifacts()) != expected {
		return fmt.Errorf("music result artifact set is incomplete")
	}
	var mix, score *runtimev1.ScenarioArtifact
	for _, artifact := range job.GetArtifacts() {
		if artifact.GetArtifactId() == value.GetMixArtifactId() {
			if mix != nil {
				return fmt.Errorf("duplicate music mix")
			}
			mix = artifact
		} else if value.GetGeneratedScore() != nil && artifact.GetArtifactId() == value.GetGeneratedScore().GetArtifactId() {
			if score != nil {
				return fmt.Errorf("duplicate generated score")
			}
			score = artifact
		} else {
			return fmt.Errorf("unexpected music output artifact")
		}
	}
	if mix == nil || mix.GetMimeType() != "audio/wav" || mix.GetFrameCount() != info.GetFrameCount() || mix.GetSampleRateHz() != int32(info.GetSampleRateHz()) || mix.GetChannels() != int32(info.GetChannels()) || mix.GetDurationMs() != info.GetDurationMs() {
		return fmt.Errorf("music mix reference or format is invalid")
	}
	if generated := value.GetGeneratedScore(); generated != nil {
		if score == nil || generated.GetFormat() != runtimev1.MusicScoreFormat_MUSIC_SCORE_FORMAT_ABC || generated.GetOrigin() != runtimev1.MusicScoreOrigin_MUSIC_SCORE_ORIGIN_GENERATED_PLAN || score.GetMimeType() != "text/vnd.abc" || score.GetSizeBytes() < 1 || score.GetSizeBytes() > musicscore.MaxBytes {
			return fmt.Errorf("generated music score reference is invalid")
		}
	}
	return nil
}
