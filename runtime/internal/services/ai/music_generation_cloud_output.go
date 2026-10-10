package ai

import (
	"context"
	"errors"
	"fmt"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/audiomedia"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"google.golang.org/grpc/codes"
)

func (s *Service) commitCloudMusicGeneration(ctx context.Context, jobID string, effective *cloudMediaEffectiveInputs, result capabilitydriver.CloudMediaResult) error {
	defer capabilitydriver.CloseArtifactBodies(result.ArtifactBodies)
	if len(result.Artifacts) != 1 {
		return fmt.Errorf("music generation requires one provider mix")
	}
	artifact := result.Artifacts[0]
	if artifact == nil {
		return fmt.Errorf("provider music mix is missing")
	}
	if artifact.GetMimeType() != "audio/wav" && artifact.GetMimeType() != "audio/mpeg" && artifact.GetMimeType() != "audio/flac" {
		return fmt.Errorf("provider music container is unsupported")
	}
	store, ok := s.runtimeArtifacts.(runtimeartifact.JobBodyStore)
	if !ok {
		return fmt.Errorf("music codec has no admitted file custody")
	}
	// The transport has already filled its original private raw slot. Release
	// stream read locks before borrowing exact files for the codec process.
	capabilitydriver.CloseArtifactBodies(result.ArtifactBodies)
	inputPath, releaseInput, err := store.BorrowJobBodyFile(ctx, jobID, artifact.GetArtifactId())
	if err != nil {
		return err
	}
	defer releaseInput()
	mixID := jobID + "-music-mix"
	if _, complete := store.JobBodyStat(jobID, mixID); !complete {
		err = store.WriteCanonicalJobBody(ctx, mixID, runtimeartifact.ArtifactRecord{ProducerJobID: jobID, Owner: s.runtimeArtifactOwnerForJob(jobID, effective.request.GetHead()), MimeType: "audio/wav"}, func(writer runtimeartifact.CanonicalJobBodyWriter) (*runtimeartifact.CanonicalAudioInfo, error) {
			facts, err := s.canonicalAudio.PrepareInto(ctx, audiomedia.Input{Path: inputPath, MIMEType: artifact.GetMimeType()}, writer)
			if err != nil {
				return nil, err
			}
			return &runtimeartifact.CanonicalAudioInfo{SampleRateHz: facts.SampleRateHz, Channels: facts.Channels, FrameCount: facts.FrameCount, DataOffset: facts.DataOffset}, nil
		})
		if err != nil {
			if ctx.Err() == nil && errors.Is(err, audiomedia.ErrCodecUnavailable) {
				return grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_MEDIA_CODEC_UNAVAILABLE, err, grpcerr.ReasonOptions{})
			}
			return err
		}
	}
	preparedPath, releaseMix, err := store.BorrowJobBodyFile(ctx, jobID, mixID)
	if err != nil {
		return err
	}
	defer releaseMix()
	wav, err := inspectMusicWAV(ctx, preparedPath)
	if err != nil {
		return err
	}
	if err := validateCloudMusicMeasuredDuration(effective.mapped.Adapter(), effective.request.GetSpec().GetMusicGenerate().GetDurationSeconds(), wav.DurationMS); err != nil {
		return err
	}
	releaseMix()
	releaseInput()
	return s.commitMusicGeneration(ctx, jobID, effective.request.GetHead(), musicGenerationPublication{WAV: wav, Termination: runtimev1.MusicGenerationTermination_MUSIC_GENERATION_TERMINATION_UNKNOWN, Usage: result.Usage})
}

// @nimi-authority: rule.nimi.runtime.ai-provider.music-generation
func validateCloudMusicMeasuredDuration(adapter string, budgetSeconds int32, durationMS int64) error {
	switch adapter {
	case capabilitydriver.CloudMediaAdapterElevenLabsMusic:
		if budgetSeconds < 3 || budgetSeconds > 600 || durationMS <= 0 || durationMS > int64(budgetSeconds)*1000 {
			return grpcerr.WithReasonCodeOptions(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, grpcerr.ReasonOptions{
				Message: "ElevenLabs music exceeded its captured output budget", ActionHint: "review_music_output_duration",
			})
		}
	case capabilitydriver.CloudMediaAdapterGeminiLyriaClipGenerateContent:
		if budgetSeconds != 35 || durationMS <= 0 || durationMS > int64(budgetSeconds)*1000 {
			return grpcerr.WithReasonCodeOptions(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, grpcerr.ReasonOptions{
				Message: "Lyria clip exceeded its captured output duration budget", ActionHint: "review_lyria_clip_duration_and_model",
			})
		}
	case capabilitydriver.CloudMediaAdapterGeminiLyria35GenerateContent:
		if budgetSeconds != 300 || durationMS <= 0 || durationMS > int64(budgetSeconds)*1000 {
			return grpcerr.WithReasonCodeOptions(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, grpcerr.ReasonOptions{
				Message: "Lyria 3.5 exceeded the captured song output budget", ActionHint: "review_lyria35_duration_and_model",
			})
		}
	}
	return nil
}
