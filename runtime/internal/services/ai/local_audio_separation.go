package ai

import (
	"context"
	"fmt"
	"io"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/oklog/ulid/v2"
)

func (s *Service) executeCapturedAudioSeparation(ctx context.Context, effective *localSpeechEffectiveInputs, onStart localexecution.SpeechExecutionStartFunc) ([]*runtimev1.ScenarioArtifact, map[string]*capabilitydriver.ArtifactBody, *runtimev1.UsageStats, error) {
	host, ok := s.localSpeechHost.(localexecution.AudioSeparationExecutionHost)
	if !ok {
		return nil, nil, nil, localExecutionError(&localexecution.ExecutionError{Kind: localexecution.FailureLoad, Err: fmt.Errorf("audio separation Host is unavailable")})
	}
	result, err := host.ExecuteAudioSeparation(ctx, effective.separatePlan, onStart)
	if err != nil {
		return nil, nil, nil, localExecutionError(err)
	}
	if result.Vocals == nil || result.Background == nil || result.SampleRateHz != 44100 || result.Channels != 2 || result.SampleCount <= 0 || result.SampleCount > 300*44100 {
		if result.Vocals != nil {
			_ = result.Vocals.Close()
		}
		if result.Background != nil {
			_ = result.Background.Close()
		}
		return nil, nil, nil, localExecutionError(&localexecution.ExecutionError{Kind: localexecution.FailureInference, Err: fmt.Errorf("audio separation returned an incomplete pair")})
	}
	artifacts := make([]*runtimev1.ScenarioArtifact, 0, 2)
	bodies := make(map[string]*capabilitydriver.ArtifactBody, 2)
	for _, source := range []io.ReadCloser{result.Vocals, result.Background} {
		body, err := capabilitydriver.NewIncrementalArtifactBody(source)
		if err != nil {
			_ = result.Vocals.Close()
			_ = result.Background.Close()
			return nil, nil, nil, err
		}
		id := ulid.Make().String()
		artifacts = append(artifacts, &runtimev1.ScenarioArtifact{ArtifactId: id, MimeType: "audio/wav", SampleRateHz: result.SampleRateHz, Channels: result.Channels, DurationMs: result.SampleCount * 1000 / int64(result.SampleRateHz)})
		bodies[id] = body
	}
	return artifacts, bodies, result.Usage, nil
}
