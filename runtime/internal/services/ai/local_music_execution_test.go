package ai

import (
	"context"
	"encoding/binary"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
)

type localMusicHostStub struct {
	mu      sync.Mutex
	plans   []*capabilitydriver.MusicInvocationPlan
	entered chan struct{}
	block   bool
	write   func(string) error
}

func (h *localMusicHostStub) ExecuteMusic(ctx context.Context, plan *capabilitydriver.MusicInvocationPlan, onStart localexecution.MusicExecutionStartFunc) (localexecution.MusicResult, error) {
	h.mu.Lock()
	h.plans = append(h.plans, plan)
	h.mu.Unlock()
	if onStart != nil {
		if err := onStart(); err != nil {
			return localexecution.MusicResult{}, err
		}
	}
	if h.entered != nil {
		select {
		case h.entered <- struct{}{}:
		default:
		}
	}
	if h.block {
		<-ctx.Done()
		return localexecution.MusicResult{}, &localexecution.ExecutionError{Kind: localexecution.FailureCanceled, Err: ctx.Err()}
	}
	write := h.write
	if write == nil {
		write = func(path string) error { return writeLocalMusicTestWAV(path, 44100, 2, 1) }
	}
	if err := write(plan.StagingWAVPath()); err != nil {
		return localexecution.MusicResult{}, err
	}
	info, _ := os.Stat(plan.StagingWAVPath())
	return localexecution.MusicResult{StagingWAVPath: plan.StagingWAVPath(), SizeBytes: info.Size(), SampleRate: 44100, Channels: 2, BitsPerSample: 16, DurationMS: 1000, ComputeMS: 7}, nil
}

func selectedMusicExecutionForTest(t *testing.T) *localexecution.SelectedLocalExecution {
	t.Helper()
	driver := capabilitydriver.MiniMaxMusic3AudioCppDriver{}
	requirements, reason := driver.ProjectRecipe(capabilitydriver.MiniMaxMusic3RecipeID, nil, nil)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		t.Fatalf("ProjectRecipe: %s", reason)
	}
	root := t.TempDir()
	declared := []string{"LICENSE", "README.md", "config.json", "config/condition_encoder.json", "config/language_model.json", "config/rvq_depth_decoder.json", "config/transformer.json", "config/vocoder.json", "tokenizer/tokenizer.json", "tokenizer/tokenizer_config.json", "condition_encoder.gguf", "language_model_q4_0.gguf", "rvq_depth_decoder_q8_0.gguf", "transformer_q4_0.gguf", "vocoder.gguf"}
	audioRoot := filepath.Join(root, "audio-cpp")
	cudaRoot := filepath.Join(root, "cuda13")
	return &localexecution.SelectedLocalExecution{LoadoutID: "loadout-music3", CapabilityContract: capabilitydriver.MiniMaxMusic3CapabilityContract, DisplayName: "MiniMax-Music3", RecipeID: capabilitydriver.MiniMaxMusic3RecipeID, RecipeRevision: "1", DriverIdentity: (&capabilitydriver.Identity{ImplementationID: capabilitydriver.MiniMaxMusic3ImplementationID, DriverID: capabilitydriver.MiniMaxMusic3DriverID, DriverDialect: capabilitydriver.MiniMaxMusic3DriverDialect}).Proto(), Requirements: requirements, ExactBindings: []localexecution.ExactBinding{{RequirementID: capabilitydriver.MiniMaxMusic3RequirementID, RequirementRole: runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN, ModelAssetID: "asset-music3", AbsolutePath: filepath.Join(root, "model", "language_model_q4_0.gguf"), BundleDir: filepath.Join(root, "model"), DeclaredFiles: declared, VerifiedContentID: capabilitydriver.MiniMaxMusic3VerifiedContentID, EntrySHA256: "sha256:6f621dd636320403c03e9f755b3e2047f5754d055e0fcc6c0c444ae52ffbfa90"}}, ExactDependencySources: []localexecution.ExactDependencySource{{DependencyFamily: "native-engine-package.audio-cpp", DependencyID: "audio.cpp.package", ConsumerScope: "audio.cpp.cuda", SelectedSourceRecordID: "selected-audio", CanonicalRoot: audioRoot, Version: "release-0.6.1", VerifiedArtifacts: []string{filepath.Join(audioRoot, "audiocpp_cli.exe")}}, {DependencyFamily: "accelerator.cuda.runtime", DependencyID: capabilitydriver.MiniMaxMusic3CUDA13DependencyID, ConsumerScope: "audio.cpp.cuda", SelectedSourceRecordID: "selected-cuda13", CanonicalRoot: cudaRoot, Version: "cuda_major=13"}}, Configured: true}
}

func localMusicIntentContext(parent context.Context) context.Context {
	return executionintent.WithIntent(parent, executionintent.Intent{CapabilityContract: capabilitydriver.MiniMaxMusic3CapabilityContract, Route: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL})
}

func localMusicJobRequestForTest() *runtimev1.SubmitScenarioJobRequest {
	return &runtimev1.SubmitScenarioJobRequest{Head: &runtimev1.ScenarioRequestHead{AppId: "app.local", SubjectUserId: "anonymous"}, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE, ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_MusicGenerate{MusicGenerate: &runtimev1.MusicGenerateScenarioSpec{Prompt: "Bright synth-pop", Lyrics: "[Verse]\nCity lights are waking.\n[Chorus]\nWe rise together."}}}}
}

func TestLocalMusicScenarioJobUsesWaistAndRuntimeArtifactCustody(t *testing.T) {
	svc := newTestService(nil)
	svc.localMusicStagingRoot = t.TempDir()
	host := &localMusicHostStub{entered: make(chan struct{}, 1)}
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selectedMusicExecutionForTest(t)})
	svc.SetLocalMusicExecutionHost(host)
	response, err := svc.SubmitScenarioJob(localMusicIntentContext(context.Background()), localMusicJobRequestForTest())
	if err != nil {
		t.Fatalf("SubmitScenarioJob: %v", err)
	}
	job := waitForMusicJobTerminal(t, svc, response.GetJob().GetJobId())
	if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || len(job.GetArtifacts()) != 1 {
		t.Fatalf("music job = %+v", job)
	}
	artifact := job.GetArtifacts()[0]
	if artifact.GetMimeType() != "audio/wav" || artifact.GetSizeBytes() <= 44 || artifact.GetSampleRateHz() != 44100 || artifact.GetChannels() != 2 || len(artifact.GetBytes()) != 0 {
		t.Fatalf("music artifact = %+v", artifact)
	}
	if job.GetProgressPercent() != 0 || job.GetProgressCurrentStep() != 0 || job.GetProgressTotalSteps() != 0 {
		t.Fatalf("music progress must be unavailable: %+v", job)
	}
	host.mu.Lock()
	defer host.mu.Unlock()
	if len(host.plans) != 1 || host.plans[0].AudioCppSelectedSourceRecordID() != "selected-audio" || host.plans[0].CUDA13SelectedSourceRecordID() != "selected-cuda13" {
		t.Fatalf("captured plan = %+v", host.plans)
	}
}

func TestLocalMusicUnsupportedFieldsFailBeforePublication(t *testing.T) {
	svc := newTestService(nil)
	svc.localMusicStagingRoot = t.TempDir()
	host := &localMusicHostStub{}
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selectedMusicExecutionForTest(t)})
	svc.SetLocalMusicExecutionHost(host)
	request := localMusicJobRequestForTest()
	request.Spec.GetMusicGenerate().DurationSeconds = 20
	_, err := svc.SubmitScenarioJob(localMusicIntentContext(context.Background()), request)
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
		t.Fatalf("unsupported field error=%v reason=%v", err, reason)
	}
	svc.scenarioJobs.mu.Lock()
	published := len(svc.scenarioJobs.jobs)
	svc.scenarioJobs.mu.Unlock()
	if published != 0 {
		t.Fatal("unsupported request published a ScenarioJob")
	}
}

func TestLocalMusicScenarioJobRejectsInvalidAndPartialWAV(t *testing.T) {
	tests := []struct {
		name  string
		write func(string) error
	}{
		{name: "invalid", write: func(path string) error { return writeLocalMusicTestBytes(path, []byte("not-a-wave")) }},
		{name: "partial", write: func(path string) error {
			payload := make([]byte, 44)
			copy(payload[:4], "RIFF")
			binary.LittleEndian.PutUint32(payload[4:8], 1024)
			copy(payload[8:12], "WAVE")
			return writeLocalMusicTestBytes(path, payload)
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			svc := newTestService(nil)
			svc.localMusicStagingRoot = t.TempDir()
			host := &localMusicHostStub{write: test.write}
			svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selectedMusicExecutionForTest(t)})
			svc.SetLocalMusicExecutionHost(host)
			response, err := svc.SubmitScenarioJob(localMusicIntentContext(context.Background()), localMusicJobRequestForTest())
			if err != nil {
				t.Fatalf("SubmitScenarioJob: %v", err)
			}
			job := waitForMusicJobTerminal(t, svc, response.GetJob().GetJobId())
			if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED || job.GetReasonCode() != runtimev1.ReasonCode_AI_OUTPUT_INVALID || len(job.GetArtifacts()) != 0 {
				t.Fatalf("invalid WAV job = %+v", job)
			}
			host.mu.Lock()
			staging := host.plans[0].StagingWAVPath()
			host.mu.Unlock()
			if _, statErr := os.Stat(staging); !os.IsNotExist(statErr) {
				t.Fatalf("invalid staging remains: %v", statErr)
			}
		})
	}
}

func waitForMusicJobTerminal(t *testing.T, svc *Service, jobID string) *runtimev1.ScenarioJob {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if job, ok := svc.scenarioJobs.get(jobID); ok && isTerminalScenarioJobStatus(job.GetStatus()) {
			return job
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("music job %s did not terminate", jobID)
	return nil
}

func writeLocalMusicTestWAV(path string, sampleRate, channels, seconds int) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	dataBytes := sampleRate * channels * 2 * seconds
	payload := make([]byte, 44+dataBytes)
	copy(payload[0:4], "RIFF")
	binary.LittleEndian.PutUint32(payload[4:8], uint32(len(payload)-8))
	copy(payload[8:12], "WAVE")
	copy(payload[12:16], "fmt ")
	binary.LittleEndian.PutUint32(payload[16:20], 16)
	binary.LittleEndian.PutUint16(payload[20:22], 1)
	binary.LittleEndian.PutUint16(payload[22:24], uint16(channels))
	binary.LittleEndian.PutUint32(payload[24:28], uint32(sampleRate))
	binary.LittleEndian.PutUint32(payload[28:32], uint32(sampleRate*channels*2))
	binary.LittleEndian.PutUint16(payload[32:34], uint16(channels*2))
	binary.LittleEndian.PutUint16(payload[34:36], 16)
	copy(payload[36:40], "data")
	binary.LittleEndian.PutUint32(payload[40:44], uint32(dataBytes))
	return os.WriteFile(path, payload, 0o600)
}

func writeLocalMusicTestBytes(path string, payload []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	return os.WriteFile(path, payload, 0o600)
}

var _ localexecution.MusicExecutionHost = (*localMusicHostStub)(nil)
