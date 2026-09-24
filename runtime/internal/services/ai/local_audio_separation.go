package ai

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/audiomedia"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/structpb"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.audio-separation
func (s *Service) captureNativeSeparationInput(ctx context.Context, head *runtimev1.ScenarioRequestHead, spec *runtimev1.AudioSeparateScenarioSpec, packageInput capabilitydriver.AudioCppRuntimePackageInput, portable *structpb.Struct, exactBindings []capabilitydriver.InvocationExactBinding, driver capabilitydriver.AudioSeparateInvocationDriver, effective *localSpeechEffectiveInputs) error {
	owned := spec.GetSourceAudio()
	source, err := s.openMusicInputSource(ctx, head, owned.GetArtifactId())
	if err != nil {
		return err
	}
	defer func() { _ = source.Body.Close() }()
	canonical := source.Record.CanonicalAudio
	if canonical == nil || source.Record.MimeType != "audio/wav" || source.Record.SizeBytes <= 0 || source.Record.SizeBytes > audiomedia.MaxInputBytes {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	if canonical.SampleRateHz != 44100 || canonical.Channels != 2 {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	root := filepath.Clean(s.localSpeechStagingRoot)
	if root == "" || !filepath.IsAbs(root) {
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_NOT_CONFIGURED)
	}
	if err := os.MkdirAll(root, 0o700); err != nil {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	stagingDir, err := os.MkdirTemp(root, "sep-")
	if err != nil {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	effective.stagingPaths = append(effective.stagingPaths, filepath.Join(stagingDir, "source.wav"), filepath.Join(stagingDir, "stems"), stagingDir)
	sourcePath := filepath.Join(stagingDir, "source.wav")
	rangeValue := owned.GetRange()
	start, end := uint64(0), canonical.FrameCount
	if rangeValue != nil {
		if rangeValue.GetEndFrame() <= rangeValue.GetStartFrame() || rangeValue.GetEndFrame() > canonical.FrameCount {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		start, end = rangeValue.GetStartFrame(), rangeValue.GetEndFrame()
	}
	if _, err := audiomedia.CopyCanonicalRange(ctx, source.Body, audiomedia.Facts{SampleRateHz: canonical.SampleRateHz, Channels: canonical.Channels, FrameCount: canonical.FrameCount, SizeBytes: source.Record.SizeBytes, DataOffset: canonical.DataOffset}, start, end, sourcePath); err != nil {
		return grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID, err, grpcerr.ReasonOptions{})
	}
	if err := source.Body.Close(); err != nil {
		return err
	}
	info := &runtimev1.LocalAppAudioInfo{SampleRateHz: canonical.SampleRateHz, Channels: uint32(canonical.Channels), FrameCount: end - start, DurationMs: int64((end - start) * 1000 / uint64(canonical.SampleRateHz))}
	plan, err := driver.PlanAudioSeparateInvocation(capabilitydriver.AudioSeparateInvocationInput{PortableConfig: portable, ExactBindings: exactBindings, Request: spec, Package: packageInput, SourcePath: sourcePath, SourceInfo: info, StagingDir: stagingDir})
	if err != nil {
		return localSpeechInvocationError(err)
	}
	effective.separatePlan = plan
	return nil
}

func (s *Service) executeCapturedAudioSeparation(ctx context.Context, effective *localSpeechEffectiveInputs, onStart localexecution.SpeechExecutionStartFunc) ([]*runtimev1.ScenarioArtifact, map[string]*capabilitydriver.ArtifactBody, *runtimev1.UsageStats, error) {
	host, ok := s.localSpeechHost.(localexecution.AudioSeparationExecutionHost)
	if !ok {
		return nil, nil, nil, localExecutionError(&localexecution.ExecutionError{Kind: localexecution.FailureLoad, Err: fmt.Errorf("audio separation Host is unavailable")})
	}
	result, err := host.ExecuteAudioSeparation(ctx, effective.separatePlan, onStart)
	if err != nil {
		return nil, nil, nil, localExecutionError(err)
	}
	if result.Vocals == nil || result.Background == nil || result.SampleRateHz != 44100 || result.Channels != 2 || result.SampleCount <= 0 || result.SampleCount > 600*44100 {
		if result.Vocals != nil {
			_ = result.Vocals.Close()
		}
		if result.Background != nil {
			_ = result.Background.Close()
		}
		for _, part := range result.Instrument {
			_ = part.Body.Close()
		}
		return nil, nil, nil, localExecutionError(&localexecution.ExecutionError{Kind: localexecution.FailureInference, Err: fmt.Errorf("audio separation returned an incomplete pair")})
	}
	artifacts := make([]*runtimev1.ScenarioArtifact, 0, 2+len(result.Instrument))
	bodies := make(map[string]*capabilitydriver.ArtifactBody, 2+len(result.Instrument))
	sources := []io.ReadCloser{result.Vocals, result.Background}
	for _, part := range result.Instrument {
		sources = append(sources, part.Body)
	}
	for _, source := range sources {
		body, err := capabilitydriver.NewIncrementalArtifactBody(source)
		if err != nil {
			_ = result.Vocals.Close()
			_ = result.Background.Close()
			for _, part := range result.Instrument {
				_ = part.Body.Close()
			}
			return nil, nil, nil, err
		}
		id := ulid.Make().String()
		// Exact frames are the stem timeline; DurationMs alone is a floored projection.
		artifacts = append(artifacts, &runtimev1.ScenarioArtifact{ArtifactId: id, MimeType: "audio/wav", SampleRateHz: result.SampleRateHz, Channels: result.Channels, DurationMs: result.SampleCount * 1000 / int64(result.SampleRateHz), FrameCount: uint64(result.SampleCount)})
		bodies[id] = body
	}
	return artifacts, bodies, result.Usage, nil
}
