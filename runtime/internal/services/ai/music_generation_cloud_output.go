package ai

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/audiomedia"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

type musicContextReader struct {
	ctx    context.Context
	source io.Reader
}

func (r musicContextReader) Read(buffer []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.source.Read(buffer)
}

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
	staging, err := s.createLocalMusicStagingWAVPath()
	if err != nil {
		return err
	}
	defer cleanupAudioMusicStaging(staging)
	directory := filepath.Dir(staging)
	input, err := os.CreateTemp(directory, "input-")
	if err != nil {
		return err
	}
	defer func() { _ = os.Remove(input.Name()) }()
	defer func() { _ = input.Close() }()
	var source io.ReadCloser
	body := result.ArtifactBodies[artifact.GetArtifactId()]
	switch {
	case body == nil && len(artifact.GetBytes()) > 0:
		source = io.NopCloser(bytes.NewReader(artifact.GetBytes()))
	case body != nil && body.Kind() == capabilitydriver.ArtifactBodyBoundedBytes:
		source = io.NopCloser(bytes.NewReader(body.BoundedBytes()))
	case body != nil && body.Kind() == capabilitydriver.ArtifactBodyIncrementalStream:
		source = body.TakeIncrementalStream()
	case body != nil && body.Kind() == capabilitydriver.ArtifactBodyCommittedReference:
		owner := s.runtimeArtifactOwnerForJob(jobID, effective.request.GetHead())
		if _, err := s.resolveRuntimeCustodyReference(ctx, body.CommittedReference(), owner, runtimeCustodyOperationScenarioOutputAttach); err != nil {
			return err
		}
		opened, ok := s.runtimeArtifacts.Open(ctx, body.CommittedReference().ArtifactID())
		if !ok {
			return fmt.Errorf("provider music custody is unavailable")
		}
		source = opened.Body
	}
	if source == nil {
		return fmt.Errorf("provider music body is missing")
	}
	defer func() { _ = source.Close() }()
	count, err := io.CopyBuffer(input, io.LimitReader(musicContextReader{ctx: ctx, source: source}, audiomedia.MaxInputBytes+1), make([]byte, 64<<10))
	_ = source.Close()
	if err != nil {
		return err
	}
	if count <= 0 || count > audiomedia.MaxInputBytes {
		return fmt.Errorf("provider music exceeds the admitted body bound")
	}
	if err := input.Close(); err != nil {
		return err
	}
	prepared, err := s.canonicalAudio.Prepare(ctx, audiomedia.Input{Path: input.Name(), MIMEType: artifact.GetMimeType()}, directory)
	if err != nil {
		return err
	}
	defer func() { _ = os.Remove(prepared.Path) }()
	wav, err := inspectMusicWAV(ctx, prepared.Path)
	if err != nil {
		return err
	}
	if err := validateCloudMusicMeasuredDuration(effective.mapped.Adapter(), effective.request.GetSpec().GetMusicGenerate().GetDurationSeconds(), wav.DurationMS); err != nil {
		return err
	}
	return s.commitMusicGeneration(ctx, jobID, effective.request.GetHead(), musicGenerationPublication{WAV: wav, Termination: runtimev1.MusicGenerationTermination_MUSIC_GENERATION_TERMINATION_UNKNOWN, Usage: result.Usage})
}

// @nimi-authority: rule.nimi.runtime.ai-provider.music-generation
func validateCloudMusicMeasuredDuration(adapter string, budgetSeconds int32, durationMS int64) error {
	switch adapter {
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
