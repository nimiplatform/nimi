package engine

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/nimiplatform/nimi/runtime/internal/audiomedia"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
)

func validateLocalMusicPlan(plan *capabilitydriver.MusicInvocationPlan) error {
	if plan == nil {
		return fmt.Errorf("music invocation is missing")
	}
	if plan.PythonTranscription() == nil {
		return validateAudioCppMusicPlan(plan)
	}
	p := plan.PythonTranscription()
	if !plan.IsTranscription() || plan.RecipeID() != capabilitydriver.BasicPitchRecipeID || p.ConsumerID != BasicPitchConsumerID || p.InterpreterPath != managedPythonPath(p.ProfileRoot) || p.ScriptPath != filepath.Join(p.ProfileRoot, "basic_pitch_driver.py") || !filepath.IsAbs(p.ProfileRoot) || p.SelectedSourceRecordID == "" || p.ProfileDigest == "" || p.DriverBundleDigest == "" || plan.ProcessKey() == "" || !filepath.IsAbs(plan.TranscriptionSourcePath()) || !filepath.IsAbs(plan.PrimaryStagingOutputPath()) {
		return fmt.Errorf("Python music capture is incomplete")
	}
	return nil
}

func runLocalMusicProcess(ctx context.Context, plan *capabilitydriver.MusicInvocationPlan) (localexecution.MusicResult, error) {
	if plan.PythonTranscription() == nil {
		return runAudioCppCLIProcess(ctx, plan)
	}
	return runBasicPitchProcess(ctx, plan)
}

// @nimi-authority: rule.nimi.runtime.ai-provider.basic-pitch-onnx-note-events
func runBasicPitchProcess(ctx context.Context, plan *capabilitydriver.MusicInvocationPlan) (localexecution.MusicResult, error) {
	if err := validateLocalMusicPlan(plan); err != nil {
		return localexecution.MusicResult{}, executionFailure(localexecution.FailureContentMismatch, err)
	}
	p := plan.PythonTranscription()
	identity, err := ResolvePythonDependencyProfileIdentity(p.ConsumerID, "windows/amd64", "cpu")
	if err != nil {
		return localexecution.MusicResult{}, executionFailure(localexecution.FailureLoad, err)
	}
	manifest, err := ReadPythonDependencyProfileManifest(p.ProfileRoot)
	if err != nil || manifest.Identity != identity || identity.ProfileDigest != p.ProfileDigest || identity.DriverBundleDigest != p.DriverBundleDigest {
		return localexecution.MusicResult{}, executionFailure(localexecution.FailureContentMismatch, fmt.Errorf("captured Basic Pitch profile identity changed"))
	}
	if err := VerifyPythonDependencyProfileStaticContent(p.ProfileRoot, p.ConsumerID, identity); err != nil {
		return localexecution.MusicResult{}, executionFailure(localexecution.FailureContentMismatch, err)
	}
	for _, output := range plan.StagingOutputPaths() {
		if _, err := os.Lstat(output); err == nil {
			return localexecution.MusicResult{}, executionFailure(localexecution.FailureContentMismatch, fmt.Errorf("Python music output already exists"))
		} else if !os.IsNotExist(err) {
			return localexecution.MusicResult{}, executionFailure(localexecution.FailureLoad, err)
		}
	}
	facts, err := audiomedia.InspectCanonical(ctx, plan.TranscriptionSourcePath())
	info, r := plan.TranscriptionSourceInfo(), plan.TranscriptionRequest().GetSourceAudio().GetRange()
	if err != nil || facts.SampleRateHz != info.GetSampleRateHz() || uint32(facts.Channels) != info.GetChannels() || facts.FrameCount != r.GetEndFrame()-r.GetStartFrame() {
		return localexecution.MusicResult{}, executionFailure(localexecution.FailureContentMismatch, fmt.Errorf("Python music canonical source differs from the captured range"))
	}
	outcome, err := runAudioCppProcess(ctx, audioCppProcessSpec{executablePath: p.InterpreterPath, workingDir: p.ProfileRoot, pythonProfileRoot: p.ProfileRoot, args: plan.CLIArgs(), stagingOutputPath: plan.PrimaryStagingOutputPath(), modelBindings: []capabilitydriver.InvocationExactBinding{plan.ModelBinding()}})
	if err != nil {
		cleanupAudioCppStaging(plan.StagingOutputPaths()...)
		return localexecution.MusicResult{}, err
	}
	if err := ctx.Err(); err != nil {
		cleanupAudioCppStaging(plan.StagingOutputPaths()...)
		return localexecution.MusicResult{}, musicContextFailure(err)
	}
	native, err := readAudioCppBoundedFile(plan.PrimaryStagingOutputPath(), 16<<20)
	if err != nil {
		cleanupAudioCppStaging(plan.StagingOutputPaths()...)
		return localexecution.MusicResult{}, executionFailure(localexecution.FailureInference, err)
	}
	output, err := plan.NormalizeTranscription(nil, native)
	if err != nil {
		cleanupAudioCppStaging(plan.StagingOutputPaths()...)
		return localexecution.MusicResult{}, executionFailure(localexecution.FailureInference, err)
	}
	return localexecution.MusicResult{Transcription: output, ComputeMS: outcome.computeMS}, nil
}
