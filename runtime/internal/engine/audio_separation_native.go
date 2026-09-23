package engine

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/audiomedia"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
)

type nativeStemFile struct {
	file *os.File
	path string
}

func (s *nativeStemFile) Read(target []byte) (int, error) { return s.file.Read(target) }
func (s *nativeStemFile) Close() error {
	err := s.file.Close()
	_ = os.Remove(s.path)
	return err
}

// nativeStemsPreserveSource rejects stems that do not keep the submitted
// source's rate, channel count and complete frame timeline; separation never
// trims, pads or retimes its outputs.
func nativeStemsPreserveSource(stems audiomedia.Facts, source *runtimev1.LocalAppAudioInfo) error {
	if source == nil || stems.SampleRateHz != source.GetSampleRateHz() || uint32(stems.Channels) != source.GetChannels() || stems.FrameCount != source.GetFrameCount() {
		return fmt.Errorf("native separation stems do not preserve the submitted source timeline")
	}
	return nil
}

// @nimi-authority: rule.nimi.runtime.ai-provider.audio-separation
func (host *SpeechExecutionHost) executeNativeAudioSeparation(ctx context.Context, plan *capabilitydriver.AudioSeparateInvocationPlan, onStart localexecution.SpeechExecutionStartFunc) (localexecution.AudioSeparationResult, error) {
	pkg := plan.NativeAudioCppPackage()
	outDir := plan.NativeOutDir()
	if !filepath.IsAbs(outDir) || !filepath.IsAbs(plan.NativeSourcePath()) || !filepath.IsAbs(pkg.AudioCppExecutablePath) {
		return localexecution.AudioSeparationResult{}, speechHostError(localexecution.FailureContentMismatch, fmt.Errorf("native separation plan is incomplete"))
	}
	if err := beginSpeechExecution(ctx, onStart); err != nil {
		return localexecution.AudioSeparationResult{}, err
	}
	if err := os.MkdirAll(outDir, 0o700); err != nil {
		return localexecution.AudioSeparationResult{}, speechHostError(localexecution.FailureLoad, fmt.Errorf("create native separation output: %w", err))
	}
	paths := map[string]string{
		"vocals": filepath.Join(outDir, "vocals.wav"),
		"drums":  filepath.Join(outDir, "drums.wav"),
		"bass":   filepath.Join(outDir, "bass.wav"),
		"other":  filepath.Join(outDir, "other.wav"),
	}
	backgroundPath := filepath.Join(outDir, "background.wav")
	cleanupAll := func() {
		for _, path := range paths {
			_ = os.Remove(path)
		}
		_ = os.Remove(backgroundPath)
	}
	outcome, err := runAudioCppProcess(ctx, audioCppProcessSpec{
		executablePath:    pkg.AudioCppExecutablePath,
		workingDir:        pkg.AudioCppRoot,
		cuda13Root:        pkg.CUDA13Root,
		args:              plan.NativeCLIArgs(),
		stagingOutputPath: paths["vocals"],
		modelBindings:     []capabilitydriver.InvocationExactBinding{plan.NativeModelBinding()},
	})
	if err != nil {
		cleanupAll()
		return localexecution.AudioSeparationResult{}, err
	}
	var facts audiomedia.Facts
	for _, name := range []string{"vocals", "drums", "bass", "other"} {
		stem, inspectErr := audiomedia.InspectCanonical(ctx, paths[name])
		if inspectErr != nil {
			cleanupAll()
			return localexecution.AudioSeparationResult{}, speechHostError(localexecution.FailureContentMismatch, fmt.Errorf("native separation stem is not canonical: %w", inspectErr))
		}
		if facts.SampleRateHz == 0 {
			facts = stem
		} else if stem.SampleRateHz != facts.SampleRateHz || stem.Channels != facts.Channels || stem.FrameCount != facts.FrameCount {
			cleanupAll()
			return localexecution.AudioSeparationResult{}, speechHostError(localexecution.FailureContentMismatch, fmt.Errorf("native separation stems do not share one timeline"))
		}
	}
	if err := nativeStemsPreserveSource(facts, plan.NativeSourceInfo()); err != nil {
		cleanupAll()
		return localexecution.AudioSeparationResult{}, speechHostError(localexecution.FailureContentMismatch, err)
	}
	sumFiles := make([]*os.File, 0, 3)
	for _, name := range []string{"drums", "bass", "other"} {
		file, openErr := os.Open(paths[name])
		if openErr != nil {
			for _, opened := range sumFiles {
				_ = opened.Close()
			}
			cleanupAll()
			return localexecution.AudioSeparationResult{}, speechHostError(localexecution.FailureInference, fmt.Errorf("open native separation stem: %w", openErr))
		}
		sumFiles = append(sumFiles, file)
	}
	sumSources := make([]io.ReadSeeker, len(sumFiles))
	for index, file := range sumFiles {
		sumSources[index] = file
	}
	_, sumErr := audiomedia.SumCanonical(ctx, sumSources, facts, backgroundPath)
	for _, file := range sumFiles {
		_ = file.Close()
	}
	if sumErr != nil {
		cleanupAll()
		return localexecution.AudioSeparationResult{}, speechHostError(localexecution.FailureInference, fmt.Errorf("build native separation background: %w", sumErr))
	}
	openStem := func(name string) (io.ReadCloser, error) {
		file, openErr := os.Open(paths[name])
		if openErr != nil {
			return nil, speechHostError(localexecution.FailureInference, fmt.Errorf("open native separation stem: %w", openErr))
		}
		return &nativeStemFile{file: file, path: paths[name]}, nil
	}
	vocals, err := openStem("vocals")
	if err != nil {
		cleanupAll()
		return localexecution.AudioSeparationResult{}, err
	}
	background, err := os.Open(backgroundPath)
	if err != nil {
		_ = vocals.Close()
		cleanupAll()
		return localexecution.AudioSeparationResult{}, speechHostError(localexecution.FailureInference, fmt.Errorf("open native separation background: %w", err))
	}
	result := localexecution.AudioSeparationResult{
		Vocals: vocals, Background: &nativeStemFile{file: background, path: backgroundPath},
		SampleRateHz: int32(facts.SampleRateHz), Channels: int32(facts.Channels), SampleCount: int64(facts.FrameCount),
		Usage: &runtimev1.UsageStats{ComputeMs: outcome.computeMS},
	}
	if plan.IncludeInstrumentParts() {
		for _, part := range []struct {
			name string
			kind runtimev1.AudioInstrumentPartKind
		}{{"drums", runtimev1.AudioInstrumentPartKind_AUDIO_INSTRUMENT_PART_KIND_DRUMS}, {"bass", runtimev1.AudioInstrumentPartKind_AUDIO_INSTRUMENT_PART_KIND_BASS}, {"other", runtimev1.AudioInstrumentPartKind_AUDIO_INSTRUMENT_PART_KIND_OTHER}} {
			file, openErr := openStem(part.name)
			if openErr != nil {
				_ = result.Vocals.Close()
				_ = result.Background.Close()
				for _, existing := range result.Instrument {
					_ = existing.Body.Close()
				}
				return localexecution.AudioSeparationResult{}, openErr
			}
			result.Instrument = append(result.Instrument, localexecution.AudioInstrumentPartBody{Kind: part.kind, Body: file})
		}
	} else {
		for _, name := range []string{"drums", "bass", "other"} {
			_ = os.Remove(paths[name])
		}
	}
	return result, nil
}
