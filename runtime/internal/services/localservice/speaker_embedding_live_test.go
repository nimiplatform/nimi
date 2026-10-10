package localservice

import (
	"context"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"reflect"
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

// Opt-in real model integration: actual imported content, Driver admission,
// saved Loadout, dependency plan/materialization and public Scenario Job.
// The in-process caller identity/intent does not establish a protected App session.
func TestSpeakerEncoderActualLoadoutAndScenarioJob(t *testing.T) {
	root, model, audio := os.Getenv("NIMI_TEST_SPEAKER_LIVE_ROOT"), os.Getenv("NIMI_TEST_SPEAKER_ONNX_PATH"), os.Getenv("NIMI_TEST_SPEAKER_AUDIO_PATH")
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
	asset := importModelAssetForTest(t, svc, model, "Actual speaker encoder")
	prepare, err := svc.PrepareLoadout(ctx, &runtimev1.PrepareLoadoutRequest{
		CapabilityContract: capabilitydriver.SpeakerEmbedContract, RecipeId: capabilitydriver.SherpaSpeakerEmbedRecipeID, DisplayName: "Actual speaker encoder",
		ModelAxes: []*runtimev1.LoadoutModelAxisInput{{SlotId: capabilitydriver.SpeakerEncoderSlot, ModelAssetId: asset.GetModelAssetId(), ExpectedContentId: asset.GetContentId()}},
	})
	if err != nil {
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
		if dependency.GetConsumerScope() != engine.SpeakerEncoderConsumerID || dependency.GetDependencyFamily() == localEnvironmentFamilyPythonTorchWheel || dependency.GetDependencyFamily() == localEnvironmentFamilyCUDA {
			t.Fatalf("speaker plan expanded into unrelated dependencies: %+v", dependency)
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
	if _, err := svc.SelectLoadout(ctx, &runtimev1.SelectLoadoutRequest{CapabilityContract: capabilitydriver.SpeakerEmbedContract, LoadoutId: loadout.GetLoadoutId(), ConfirmedMachineImpact: true}); err != nil {
		t.Fatal(err)
	}
	execution, err := svc.ResolveSelectedLocalExecution(capabilitydriver.SpeakerEmbedContract)
	if err != nil {
		t.Fatal(err)
	}
	if execution.EmbeddingDimension != 512 || len(execution.ExactDependencySources) != 1 {
		t.Fatalf("actual model/dependency projection: %+v", execution)
	}
	aiState := filepath.Join(stateRoot, "ai.json")
	aiSvc, err := ai.New(logger, nil, nil, config.Config{LocalStatePath: aiState})
	if err != nil {
		t.Fatal(err)
	}
	aiSvc.SetLocalExecutionResolver(svc)
	aiSvc.SetLocalSpeakerEmbeddingExecutionHost(engine.NewSpeakerEmbeddingExecutionHost(manager))
	owner := authn.WithIdentity(metadata.NewIncomingContext(ctx, metadata.Pairs("x-nimi-app-id", "actual-speaker-test")), &authn.Identity{SubjectUserID: "actual-speaker-test-user"})
	intentCtx := executionintent.WithIntent(owner, executionintent.Intent{CapabilityContract: capabilitydriver.SpeakerEmbedContract, LocalLoadoutRef: loadout.GetLoadoutId(), Route: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL})
	media, err := os.ReadFile(audio)
	if err != nil {
		t.Fatal(err)
	}
	submitted, err := aiSvc.SubmitScenarioJob(intentCtx, &runtimev1.SubmitScenarioJobRequest{
		Head:         &runtimev1.ScenarioRequestHead{AppId: "actual-speaker-test", SubjectUserId: "actual-speaker-test-user"},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_AUDIO_SPEAKER_EMBED, ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_AudioSpeakerEmbed{AudioSpeakerEmbed: &runtimev1.AudioSpeakerEmbedScenarioSpec{MimeType: "audio/wav", AudioSource: &runtimev1.SpeechTranscriptionAudioSource{Source: &runtimev1.SpeechTranscriptionAudioSource_AudioBytes{AudioBytes: media}}}}},
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
			t.Fatalf("actual inference failed: %+v", terminal)
		}
		select {
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		case <-time.After(100 * time.Millisecond):
		}
	}
	if err := localexecution.ValidateSpeakerEmbeddingResult(terminal.GetSpeakerEmbedding(), 512, true); err != nil {
		t.Fatal(err)
	}
	if terminal.GetEffectiveInputIdentity() == nil || len(terminal.GetArtifacts()) != 0 {
		t.Fatal("completed Job omitted its captured identity or emitted unrelated artifacts")
	}
	reopened, err := ai.New(logger, nil, nil, config.Config{LocalStatePath: aiState})
	if err != nil {
		t.Fatal(err)
	}
	read, err := reopened.GetScenarioJob(owner, &runtimev1.GetScenarioJobRequest{JobId: terminal.GetJobId()})
	if err != nil || !reflect.DeepEqual(read.GetJob().GetSpeakerEmbedding().GetVector().GetValues(), terminal.GetSpeakerEmbedding().GetVector().GetValues()) || read.GetJob().GetSpeakerEmbedding().GetSpaceId() != terminal.GetSpeakerEmbedding().GetSpaceId() {
		t.Fatalf("actual result did not survive service reopen: %v", err)
	}
	t.Logf("actual completed Job=%s width=%d space=%s", terminal.GetJobId(), len(terminal.GetSpeakerEmbedding().GetVector().GetValues()), terminal.GetSpeakerEmbedding().GetSpaceId())
}
