package localservice

import (
	"context"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"io"
	"log/slog"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/services/ai"
	"google.golang.org/grpc/metadata"
)

type observedDiarizedSpeechMaterializer struct {
	*Service
	t *testing.T
}

type observedDiarizedSpeechHost struct {
	localexecution.SpeechExecutionHost
	t *testing.T
}

func (owner observedDiarizedSpeechHost) ExecuteSpeechTranscription(ctx context.Context, plan capabilitydriver.SpeechTranscribePlan, start localexecution.SpeechExecutionStartFunc) (localexecution.SpeechTranscriptionResult, error) {
	result, err := owner.SpeechExecutionHost.ExecuteSpeechTranscription(ctx, plan, start)
	if err != nil {
		owner.t.Logf("actual private execution cause: %v", err)
	}
	return result, err
}

func (owner observedDiarizedSpeechMaterializer) MaterializeSpeechExecutionHost(ctx context.Context, capability, driver string, port int) (string, error) {
	endpoint, err := owner.Service.MaterializeSpeechExecutionHost(ctx, capability, driver, port)
	if err != nil {
		owner.t.Logf("actual private materializer error: %v", err)
	}
	return endpoint, err
}
func (owner observedDiarizedSpeechMaterializer) RegisterSpeechExecutionModel(ctx context.Context, endpoint string, model engine.SpeechExecutionModelRegistration) error {
	err := owner.Service.RegisterSpeechExecutionModel(ctx, endpoint, model)
	if err != nil {
		owner.t.Logf("actual private registration error: %v", err)
	}
	return err
}

// Opt-in real model integration: actual imported content, Driver admission,
// saved Loadout, dependency plan/materialization and actual ASR/interval Job.
// The in-process caller identity/intent does not establish a protected App session.
func TestWhisperDiarizationActualLoadoutAndScenarioJob(t *testing.T) {
	root, model, audio := os.Getenv("NIMI_TEST_DIARIZATION_LIVE_ROOT"), os.Getenv("NIMI_TEST_WHISPER_MODEL_ROOT"), os.Getenv("NIMI_TEST_DIARIZATION_AUDIO_PATH")
	if root == "" || model == "" || audio == "" {
		t.Skip("isolated real speaker inputs not supplied")
	}
	for _, input := range []string{root, model, audio} {
		if !filepath.IsAbs(input) {
			t.Fatal("live inputs must be absolute")
		}
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	stateRoot := t.TempDir()
	svc, err := NewWithProductControlDataRoot(logger, nil, filepath.Join(stateRoot, "local.json"), 0, filepath.Join(root, "models"), root)
	if err != nil {
		t.Fatal(err)
	}
	defer svc.Close()
	if err := svc.SetProductControlRoot(filepath.Join(stateRoot, ".nimi")); err != nil {
		t.Fatal(err)
	}
	manager, err := engine.NewManager(logger, engine.ManagedRoots{Environments: filepath.Join(root, "environments"), Dependencies: filepath.Join(root, "dependencies")}, nil)
	if err != nil {
		t.Fatal(err)
	}
	manager.SetRuntimeWorkRoot(filepath.Join(root, "work"))
	defer manager.StopAll(context.Background())
	svc.SetEngineManager(engine.NewServiceAdapter(manager))
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	assets := map[string]*runtimev1.ModelAssetRecord{}
	for slot, source := range map[string]string{capabilitydriver.Qwen3ASRModelRequirementID: model, capabilitydriver.FasterWhisperVADRequirementID: os.Getenv("NIMI_TEST_DIARIZATION_VAD_ROOT"), capabilitydriver.SpeechSegmenterSlot: os.Getenv("NIMI_TEST_DIARIZATION_SEGMENTER_ROOT"), capabilitydriver.SpeechSpeakerEncoderSlot: os.Getenv("NIMI_TEST_DIARIZATION_ENCODER_ROOT")} {
		if !filepath.IsAbs(source) {
			t.Fatal("actual model sources must be absolute")
		}
		assets[slot] = importModelAssetForTest(t, svc, source, "Actual diarized Whisper "+slot)
		t.Logf("actual imported slot=%s entry=%s fileCount=%d", slot, assets[slot].GetEntry(), len(assets[slot].GetFiles()))
	}
	var axes []*runtimev1.LoadoutModelAxisInput
	for _, slot := range []string{capabilitydriver.Qwen3ASRModelRequirementID, capabilitydriver.FasterWhisperVADRequirementID, capabilitydriver.SpeechSegmenterSlot, capabilitydriver.SpeechSpeakerEncoderSlot} {
		asset := assets[slot]
		axes = append(axes, &runtimev1.LoadoutModelAxisInput{SlotId: slot, ModelAssetId: asset.GetModelAssetId(), ExpectedContentId: asset.GetContentId()})
	}
	prepare, err := svc.PrepareLoadout(ctx, &runtimev1.PrepareLoadoutRequest{
		CapabilityContract: capabilitydriver.AudioTranscribeContract, RecipeId: capabilitydriver.FasterWhisperSherpaRecipeID, DisplayName: "Actual diarized Whisper",
		ModelAxes: axes,
	})
	if err != nil {
		driver := capabilitydriver.FasterWhisperSherpaDriver{}
		requirements, _ := driver.ProjectRecipe(capabilitydriver.FasterWhisperSherpaRecipeID, nil, nil)
		candidate := &runtimev1.Loadout{CapabilityContract: capabilitydriver.AudioTranscribeContract, RecipeId: capabilitydriver.FasterWhisperSherpaRecipeID}
		for _, axis := range axes {
			candidate.ModelAxes = append(candidate.ModelAxes, &runtimev1.LoadoutModelAxis{SlotId: axis.SlotId, ModelAssetId: axis.ModelAssetId, ExpectedContentId: axis.ExpectedContentId})
		}
		validation := svc.validateLoadoutCurrent(candidate, driver, requirements)
		t.Logf("actual admission reasons=%v axes=%v", validation.reasons, validation.axisReasons)
		t.Fatal(err)
	}
	loadout := commitLoadoutForTest(t, svc, ctx, prepare.GetPrepareId(), true)
	resolution := &runtimev1.ResolveLocalEnvironmentPlanRequest{CandidateLoadoutId: loadout.GetLoadoutId()}
	resolvedPlan, err := svc.ResolveLocalEnvironmentPlan(ctx, resolution)
	if err != nil {
		t.Fatal(err)
	}
	plan := resolvedPlan.GetPlan()
	for _, dependency := range plan.GetDependencies() {
		if (dependency.GetConsumerScope() != capabilitydriver.WhisperDiarizationConsumerID && dependency.GetConsumerScope() != capabilitydriver.WhisperDiarizationConsumerID+".cpu") || dependency.GetDependencyFamily() == localEnvironmentFamilyCUDA {
			t.Fatalf("diarized Whisper plan expanded into unrelated dependencies: %+v", dependency)
		}
	}
	applied, err := svc.ApplyLocalEnvironmentPlan(ctx, &runtimev1.ApplyLocalEnvironmentPlanRequest{Resolution: resolution, ExpectedPlanId: plan.GetPlanId(), Confirmed: true})
	if err != nil {
		t.Fatal(err)
	}
	for _, job := range applied.GetJobs() {
		for {
			current, ok := svc.localEnvironmentDependencyJob(job.GetJobId())
			if !ok {
				t.Fatal("dependency Job disappeared")
			}
			if current.State == localEnvironmentStateReadyManaged || current.State == localEnvironmentStateReadySystem {
				break
			}
			if current.State == localEnvironmentStateFailed || current.State == localEnvironmentStateCancelled || current.State == localEnvironmentStateUnsupported {
				t.Fatalf("actual dependency materialization failed: %+v", current)
			}
			select {
			case <-ctx.Done():
				t.Fatal(ctx.Err())
			case <-time.After(100 * time.Millisecond):
			}
		}
	}
	if _, err := svc.SelectLoadout(ctx, &runtimev1.SelectLoadoutRequest{CapabilityContract: capabilitydriver.AudioTranscribeContract, LoadoutId: loadout.GetLoadoutId(), ConfirmedMachineImpact: true}); err != nil {
		t.Fatal(err)
	}
	execution, err := svc.ResolveSelectedLocalExecution(capabilitydriver.AudioTranscribeContract)
	if err != nil {
		t.Fatal(err)
	}
	if len(execution.ExactBindings) != 4 || len(execution.ExactDependencySources) != 1 {
		t.Fatalf("actual model/dependency projection: %+v", execution)
	}
	aiState := filepath.Join(stateRoot, "ai.json")
	aiSvc, err := ai.New(logger, nil, nil, config.Config{LocalStatePath: aiState})
	if err != nil {
		t.Fatal(err)
	}
	aiSvc.SetLocalExecutionResolver(svc)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	if err := listener.Close(); err != nil {
		t.Fatal(err)
	}
	aiSvc.SetLocalSpeechExecutionHost(observedDiarizedSpeechHost{SpeechExecutionHost: engine.NewSpeechExecutionHost(observedDiarizedSpeechMaterializer{Service: svc, t: t}, port, 0), t: t})
	owner := authn.WithIdentity(metadata.NewIncomingContext(ctx, metadata.Pairs("x-nimi-app-id", "actual-speaker-test")), &authn.Identity{SubjectUserID: "actual-speaker-test-user"})
	intentCtx := executionintent.WithIntent(owner, executionintent.Intent{CapabilityContract: capabilitydriver.AudioTranscribeContract, LocalLoadoutRef: loadout.GetLoadoutId(), Route: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL})
	media, err := os.ReadFile(audio)
	if err != nil {
		t.Fatal(err)
	}
	count := int32(0)
	if value := os.Getenv("NIMI_TEST_DIARIZATION_SPEAKER_COUNT"); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil {
			t.Fatal(err)
		}
		count = int32(parsed)
	}
	submitted, err := aiSvc.SubmitScenarioJob(intentCtx, &runtimev1.SubmitScenarioJobRequest{
		Head:         &runtimev1.ScenarioRequestHead{AppId: "actual-speaker-test", SubjectUserId: "actual-speaker-test-user"},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE, ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechTranscribe{SpeechTranscribe: &runtimev1.SpeechTranscribeScenarioSpec{MimeType: "audio/wav", Timestamps: proto.Bool(true), Diarization: proto.Bool(true), SpeakerCount: proto.Int32(count), Prompt: "Nimi，词典", AudioSource: &runtimev1.SpeechTranscriptionAudioSource{Source: &runtimev1.SpeechTranscriptionAudioSource_AudioBytes{AudioBytes: media}}}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	var terminal *runtimev1.ScenarioJob
	for {
		response, err := aiSvc.GetScenarioJob(owner, &runtimev1.GetScenarioJobRequest{JobId: submitted.GetJob().GetJobId()})
		if err != nil {
			t.Fatal(err)
		}
		terminal = response.GetJob()
		if terminal.GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
			break
		}
		if terminal.GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED || terminal.GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED {
			if os.Getenv("NIMI_TEST_DIARIZATION_EXPECT_UNSUPPORTED") == "1" {
				if terminal.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED || terminal.GetReasonCode() != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED || terminal.GetTranscription() != nil {
					t.Fatalf("unsupported exact combination misclassified: %s %s", terminal.GetStatus(), terminal.GetReasonCode())
				}
				t.Logf("actual exact short/count request refused: Job=%s reason=%s", terminal.GetJobId(), terminal.GetReasonCode())
				return
			}
			t.Fatalf("actual inference failed: %+v", terminal)
		}
		select {
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		case <-time.After(100 * time.Millisecond):
		}
	}
	if os.Getenv("NIMI_TEST_DIARIZATION_EXPECT_UNSUPPORTED") == "1" {
		t.Fatal("short-window explicit count was silently ignored")
	}
	if err := localexecution.ValidateSpeechTranscript(terminal.GetTranscription(), true); err != nil {
		t.Fatal(err)
	}
	if terminal.GetEffectiveInputIdentity() == nil {
		t.Fatal("completed Job omitted its captured identity or emitted unrelated artifacts")
	}
	reopened, err := ai.New(logger, nil, nil, config.Config{LocalStatePath: aiState})
	if err != nil {
		t.Fatal(err)
	}
	read, err := reopened.GetScenarioJob(owner, &runtimev1.GetScenarioJobRequest{JobId: terminal.GetJobId()})
	if err != nil || !proto.Equal(read.GetJob().GetTranscription(), terminal.GetTranscription()) {
		t.Fatalf("actual transcript and diarization did not survive reopen: %v", err)
	}
	if terminal.GetTranscription().GetDiarization() == nil {
		t.Fatal("real Job lost requested diarization")
	}
	body, err := protojson.Marshal(terminal.GetTranscription())
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "actual-diarized-transcript.json"), body, 0600); err != nil {
		t.Fatal(err)
	}
	t.Logf("actual completed diarized Job=%s transcript=%s words=%d speaker intervals=%d", terminal.GetJobId(), terminal.GetTranscription().GetText(), len(terminal.GetTranscription().GetWords()), len(terminal.GetTranscription().GetDiarization().GetIntervals()))

}
