package ai

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

func TestLocalSpeechJobsPersistCompleteEffectiveInputIdentity(t *testing.T) {
	tests := []struct {
		name     string
		contract string
		typeID   runtimev1.ScenarioType
		spec     *runtimev1.ScenarioSpec
	}{
		{
			name:     "speech_synthesize",
			contract: capabilitydriver.AudioSynthesizeContract,
			typeID:   runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
			spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{
				SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{Text: "persist exact synthesis assembly"},
			}},
		},
		{
			name:     "speech_transcribe",
			contract: capabilitydriver.AudioTranscribeContract,
			typeID:   runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE,
			spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechTranscribe{
				SpeechTranscribe: &runtimev1.SpeechTranscribeScenarioSpec{
					MimeType: "audio/wav",
					AudioSource: &runtimev1.SpeechTranscriptionAudioSource{Source: &runtimev1.SpeechTranscriptionAudioSource_AudioBytes{
						AudioBytes: []byte("persist exact transcription assembly"),
					}},
				},
			}},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			localStatePath := filepath.Join(t.TempDir(), "local-state.json")
			store, err := newScenarioJobStoreForLocalStatePath(localStatePath)
			if err != nil {
				t.Fatal(err)
			}
			selected := selectedSpeechExecutionForTest(t, test.contract, "durable-"+test.name)
			expected := projectLoadoutEffectiveInputIdentity(selected)
			svc := newTestService(nil)
			svc.scenarioJobs = store
			svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selected})
			svc.SetLocalSpeechExecutionHost(&localSpeechHostStub{})
			ctx := executionintent.WithIntent(context.Background(), executionintent.Intent{
				CapabilityContract: test.contract,
				LocalLoadoutRef:    "test-loadout:" + test.contract,
				Route:              runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			})
			response, err := svc.SubmitScenarioJob(ctx, &runtimev1.SubmitScenarioJobRequest{
				Head:          &runtimev1.ScenarioRequestHead{AppId: "app.local", SubjectUserId: "anonymous"},
				ScenarioType:  test.typeID,
				ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
				Spec:          test.spec,
			})
			if err != nil {
				t.Fatalf("SubmitScenarioJob: %v", err)
			}
			assertEffectiveInputIdentityFields(t, response.GetJob().GetEffectiveInputIdentity(), expected)

			terminal := waitLocalSpeechJobTerminal(t, svc, response.GetJob().GetJobId())
			if terminal.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
				t.Fatalf("terminal status=%s reason=%s detail=%q", terminal.GetStatus(), terminal.GetReasonCode(), terminal.GetReasonDetail())
			}
			assertEffectiveInputIdentityFields(t, terminal.GetEffectiveInputIdentity(), expected)

			raw, err := os.ReadFile(scenarioJobStorePathForLocalStatePath(localStatePath))
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(string(raw), `"effective_input_identity"`) {
				t.Fatalf("terminal scenario-jobs.json omitted effective_input_identity: %s", raw)
			}
			if !strings.Contains(string(raw), `"resolved_assembly"`) {
				t.Fatalf("terminal scenario-jobs.json omitted private ResolvedAssembly: %s", raw)
			}
			reopened, err := newScenarioJobStoreForLocalStatePath(localStatePath)
			if err != nil {
				t.Fatal(err)
			}
			persisted, ok := reopened.get(response.GetJob().GetJobId())
			if !ok || persisted.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
				t.Fatalf("persisted terminal Job=%+v found=%v", persisted, ok)
			}
			assertEffectiveInputIdentityFields(t, persisted.GetEffectiveInputIdentity(), expected)
			assembly, ok := reopened.resolvedAssembly(response.GetJob().GetJobId())
			if !ok || len(assembly.ModelAxes) != 1 || assembly.ModelAxes[0].AbsolutePath != selected.ExactBindings[0].AbsolutePath {
				t.Fatalf("reopened private ResolvedAssembly = %+v, visible=%v", assembly, ok)
			}
			publicRaw, err := protojson.Marshal(persisted)
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(string(publicRaw), selected.ExactBindings[0].AbsolutePath) {
				t.Fatal("private ResolvedAssembly path leaked into public ScenarioJob")
			}
		})
	}
}

func assertEffectiveInputIdentityFields(t *testing.T, got *runtimev1.LoadoutEffectiveInputIdentity, want *runtimev1.LoadoutEffectiveInputIdentity) {
	t.Helper()
	if got == nil || want == nil {
		t.Fatalf("effective input identity: got=%+v want=%+v", got, want)
	}
	if got.GetLoadoutId() != want.GetLoadoutId() {
		t.Fatalf("loadout_id=%q want=%q", got.GetLoadoutId(), want.GetLoadoutId())
	}
	if got.GetCapabilityContract() != want.GetCapabilityContract() {
		t.Fatalf("capability_contract=%q want=%q", got.GetCapabilityContract(), want.GetCapabilityContract())
	}
	gotImplementation, wantImplementation := got.GetImplementation(), want.GetImplementation()
	if gotImplementation.GetImplementationId() != wantImplementation.GetImplementationId() {
		t.Fatalf("implementation_id=%q want=%q", gotImplementation.GetImplementationId(), wantImplementation.GetImplementationId())
	}
	if gotImplementation.GetDriverId() != wantImplementation.GetDriverId() {
		t.Fatalf("driver_id=%q want=%q", gotImplementation.GetDriverId(), wantImplementation.GetDriverId())
	}
	if gotImplementation.GetDriverDialect() != wantImplementation.GetDriverDialect() {
		t.Fatalf("driver_dialect=%q want=%q", gotImplementation.GetDriverDialect(), wantImplementation.GetDriverDialect())
	}
	if got.GetRecipeId() != want.GetRecipeId() {
		t.Fatalf("recipe_id=%q want=%q", got.GetRecipeId(), want.GetRecipeId())
	}
	if got.GetRecipeRevision() != want.GetRecipeRevision() {
		t.Fatalf("recipe_revision=%q want=%q", got.GetRecipeRevision(), want.GetRecipeRevision())
	}
	if !proto.Equal(got.GetOptions(), want.GetOptions()) {
		t.Fatalf("options=%v want=%v", got.GetOptions(), want.GetOptions())
	}
	if strings.Join(got.GetAdmittedFeatures(), "\x00") != strings.Join(want.GetAdmittedFeatures(), "\x00") {
		t.Fatalf("admitted_features=%v want=%v", got.GetAdmittedFeatures(), want.GetAdmittedFeatures())
	}
	if len(got.GetModelAxes()) != len(want.GetModelAxes()) {
		t.Fatalf("model_axes length=%d want=%d", len(got.GetModelAxes()), len(want.GetModelAxes()))
	}
	for index, wantAxis := range want.GetModelAxes() {
		gotAxis := got.GetModelAxes()[index]
		if gotAxis.GetSlotId() != wantAxis.GetSlotId() {
			t.Fatalf("model_axes[%d].slot_id=%q want=%q", index, gotAxis.GetSlotId(), wantAxis.GetSlotId())
		}
		if gotAxis.GetModelAssetId() != wantAxis.GetModelAssetId() {
			t.Fatalf("model_axes[%d].model_asset_id=%q want=%q", index, gotAxis.GetModelAssetId(), wantAxis.GetModelAssetId())
		}
		if gotAxis.GetContentId() != wantAxis.GetContentId() {
			t.Fatalf("model_axes[%d].content_id=%q want=%q", index, gotAxis.GetContentId(), wantAxis.GetContentId())
		}
		if gotAxis.GetPresence() != wantAxis.GetPresence() {
			t.Fatalf("model_axes[%d].presence=%s want=%s", index, gotAxis.GetPresence(), wantAxis.GetPresence())
		}
	}
}
