package ai

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/runtimeidentity"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/structpb"
)

type localVoiceExecutionResolver struct {
	selections map[string]*localexecution.SelectedLocalExecution
}

func (r *localVoiceExecutionResolver) SelectedLocalCapabilityContracts() []string { return nil }

func (r *localVoiceExecutionResolver) ResolveSelectedLocalExecution(contract string) (*localexecution.SelectedLocalExecution, error) {
	if r == nil || r.selections[contract] == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_SELECTION_NOT_FOUND)
	}
	return r.selections[contract], nil
}

func TestLocalVoiceCreateTypedSourcesProduceReusableVoiceAssets(t *testing.T) {
	for _, test := range []struct {
		name    string
		feature string
		source  runtimev1.VoiceCreationSource
		request *runtimev1.VoiceCreateScenarioSpec
	}{
		{name: "reference-audio", feature: "input.audio", source: runtimev1.VoiceCreationSource_VOICE_CREATION_SOURCE_REFERENCE_AUDIO, request: &runtimev1.VoiceCreateScenarioSpec{Source: &runtimev1.VoiceCreateScenarioSpec_ReferenceAudio{ReferenceAudio: &runtimev1.VoiceV2VInput{ReferenceAudioBytes: []byte("RIFF-reference"), ReferenceAudioMime: "audio/wav", Text: "hello"}}}},
		{name: "text-description", feature: "input.text", source: runtimev1.VoiceCreationSource_VOICE_CREATION_SOURCE_TEXT_DESCRIPTION, request: &runtimev1.VoiceCreateScenarioSpec{Source: &runtimev1.VoiceCreateScenarioSpec_TextDescription{TextDescription: &runtimev1.VoiceT2VInput{InstructionText: "warm narrator", PreviewText: "hello"}}}},
	} {
		t.Run(test.name, func(t *testing.T) {
			voiceSelection := selectedLocalVoiceCreateExecutionForTest(t, "voice-"+test.name, test.feature)
			expectedVoiceIdentity := projectLoadoutEffectiveInputIdentity(voiceSelection)
			synthSelection := selectedSpeechExecutionForTest(t, capabilitydriver.AudioSynthesizeContract, "synth-"+test.name)
			synthSelection.ExecutionTarget = voiceSelection.ExecutionTarget.Clone()
			svc := newTestService(nil)
			svc.SetLocalExecutionResolver(&localVoiceExecutionResolver{selections: map[string]*localexecution.SelectedLocalExecution{
				capabilitydriver.VoiceCreateContract:     voiceSelection,
				capabilitydriver.AudioSynthesizeContract: synthSelection,
			}})
			host := &localSpeechHostStub{voiceCreateResult: &localexecution.VoiceCreateResult{ProviderVoiceRef: "opaque-" + test.name, Usage: &runtimev1.UsageStats{ComputeMs: 7}}}
			svc.SetLocalSpeechExecutionHost(host)
			ownerCtx := scenarioJobUserContext("app.local", "anonymous")
			voiceCtx := executionintent.WithIntent(ownerCtx, executionintent.Intent{CapabilityContract: capabilitydriver.VoiceCreateContract, Route: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL, RequiredFeatures: []string{test.feature}})
			response, err := svc.SubmitScenarioJob(voiceCtx, &runtimev1.SubmitScenarioJobRequest{
				Head:          &runtimev1.ScenarioRequestHead{AppId: "app.local", SubjectUserId: "anonymous"},
				ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE,
				ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
				Spec:          &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VoiceCreate{VoiceCreate: test.request}},
			})
			if err != nil {
				t.Fatalf("SubmitScenarioJob voice.create: %v", err)
			}
			assembly, captured := svc.scenarioJobs.resolvedAssembly(response.GetJob().GetJobId())
			if !captured || assembly.Request.Kind != "voice.create" || assembly.LoadPlan.Speech == nil || assembly.LoadPlan.Speech.Operation != "voice.create" {
				t.Fatalf("local voice.create ResolvedAssembly = %+v, captured=%v", assembly, captured)
			}
			assertEffectiveInputIdentityFields(t, response.GetJob().GetEffectiveInputIdentity(), expectedVoiceIdentity)
			job := waitLocalVoiceJobTerminal(t, svc, response.GetJob().GetJobId())
			if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
				t.Fatalf("voice.create status=%s reason=%s detail=%q", job.GetStatus(), job.GetReasonCode(), job.GetReasonDetail())
			}
			assertEffectiveInputIdentityFields(t, job.GetEffectiveInputIdentity(), expectedVoiceIdentity)
			result, err := svc.GetScenarioJob(ownerCtx, &runtimev1.GetScenarioJobRequest{JobId: job.GetJobId()})
			if err != nil {
				t.Fatalf("GetScenarioJob voice.create terminal result: %v", err)
			}
			asset, _, ok := svc.voiceAssets.getAssetBinding(result.GetAsset().GetVoiceAssetId())
			if !ok || asset.GetCreationSource() != test.source || asset.GetProvider() != "local" || asset.GetProviderVoiceRef() != "opaque-"+test.name || asset.GetPersistence() != runtimev1.VoiceAssetPersistence_VOICE_ASSET_PERSISTENCE_SESSION_EPHEMERAL {
				t.Fatalf("voice asset=%+v found=%v", asset, ok)
			}
			if asset.GetVoiceAssetId() != job.GetJobId() {
				t.Fatalf("local VoiceAsset id=%q, want canonical Job result id %q", asset.GetVoiceAssetId(), job.GetJobId())
			}
			if result.GetVoiceReference().GetVoiceAssetId() != asset.GetVoiceAssetId() {
				t.Fatalf("voice reference=%+v asset=%+v", result.GetVoiceReference(), asset)
			}

			synthCtx := executionintent.WithIntent(ownerCtx, executionintent.Intent{CapabilityContract: capabilitydriver.AudioSynthesizeContract, Route: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL})
			synthResponse, err := svc.SubmitScenarioJob(synthCtx, &runtimev1.SubmitScenarioJobRequest{
				Head:          &runtimev1.ScenarioRequestHead{AppId: "app.local", SubjectUserId: "anonymous"},
				ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
				ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
				Spec:          &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{Text: "synthesize", VoiceRef: voiceAssetReference(asset.GetVoiceAssetId())}}},
			})
			if err != nil {
				t.Fatalf("SubmitScenarioJob audio.synthesize: %v", err)
			}
			if got := waitLocalSpeechJobTerminal(t, svc, synthResponse.GetJob().GetJobId()); got.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
				t.Fatalf("audio.synthesize status=%s reason=%s detail=%q", got.GetStatus(), got.GetReasonCode(), got.GetReasonDetail())
			}
			host.mu.Lock()
			plan := host.synthesizePlan
			host.mu.Unlock()
			if plan == nil || plan.Request().GetVoiceRef().GetProviderVoiceRef() != "opaque-"+test.name {
				t.Fatalf("synthesis plan voice ref=%+v", plan)
			}
		})
	}
}

func TestLocalVoiceCreateFailsClosedOnUnsupportedSelectedSource(t *testing.T) {
	svc := newTestService(nil)
	svc.SetLocalExecutionResolver(&localVoiceExecutionResolver{selections: map[string]*localexecution.SelectedLocalExecution{
		capabilitydriver.VoiceCreateContract: selectedLocalVoiceCreateExecutionForTest(t, "voice-text-only", "input.text"),
	}})
	svc.SetLocalSpeechExecutionHost(&localSpeechHostStub{})
	ctx := executionintent.WithIntent(scenarioJobUserContext("app.local", "anonymous"), executionintent.Intent{CapabilityContract: capabilitydriver.VoiceCreateContract, Route: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL, RequiredFeatures: []string{"input.audio"}})
	response, err := svc.SubmitScenarioJob(ctx, &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{AppId: "app.local", SubjectUserId: "anonymous"}, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE, ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VoiceCreate{VoiceCreate: &runtimev1.VoiceCreateScenarioSpec{Source: &runtimev1.VoiceCreateScenarioSpec_ReferenceAudio{ReferenceAudio: &runtimev1.VoiceV2VInput{ReferenceAudioBytes: []byte("audio"), ReferenceAudioMime: "audio/wav"}}}}},
	})
	if response != nil {
		t.Fatalf("unsupported source returned response=%+v", response)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_LOCAL_CAPABILITY_MISMATCH {
		t.Fatalf("unsupported source error=%v reason=%s found=%v", err, reason, ok)
	}
}

func selectedLocalVoiceCreateExecutionForTest(t *testing.T, configurationID string, feature string) *localexecution.SelectedLocalExecution {
	t.Helper()
	driver := capabilitydriver.Qwen3VoiceCreateDriver{}
	requirements, reason := driver.Interpret(capabilitydriver.InterpretInput{SupportedFeatures: []string{feature}})
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || len(requirements) != 1 {
		t.Fatalf("voice Interpret reason=%v requirements=%+v", reason, requirements)
	}
	path := filepath.Join(t.TempDir(), "model.safetensors")
	payload := []byte(configurationID)
	if err := os.WriteFile(path, payload, 0o600); err != nil {
		t.Fatal(err)
	}
	digestBytes := sha256.Sum256(payload)
	digest := hex.EncodeToString(digestBytes[:])
	options, err := structpb.NewStruct(map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	modelAssetID := fmt.Sprintf("%s-model", configurationID)
	recipeID := capabilitydriver.Qwen3VoiceDesignRecipeID
	if feature == "input.audio" {
		recipeID = capabilitydriver.Qwen3VoiceCloneRecipeID
	}
	return &localexecution.SelectedLocalExecution{
		LoadoutID: configurationID, CapabilityContract: capabilitydriver.VoiceCreateContract, DisplayName: configurationID,
		RecipeID: recipeID, RecipeRevision: "1",
		DriverIdentity:    (&capabilitydriver.Identity{ImplementationID: capabilitydriver.Qwen3VoiceCreateImplementationID, DriverID: capabilitydriver.Qwen3TTSDriverID, DriverDialect: capabilitydriver.Qwen3VoiceCreateDriverDialect}).Proto(),
		PortableConfig:    options,
		Requirements:      requirements,
		ExactBindings:     []localexecution.ExactBinding{{RequirementID: requirements[0].GetRequirementId(), ModelAssetID: modelAssetID, AbsolutePath: path, VerifiedContentID: "sha256:" + digest, EntrySHA256: digest}},
		SupportedFeatures: []string{feature},
		ExecutionTarget: &runtimeidentity.Target{Local: &runtimeidentity.LocalTarget{
			ReadinessRef: "model-asset://" + modelAssetID,
		}},
		Configured: true,
	}
}

func waitLocalVoiceJobTerminal(t *testing.T, svc *Service, jobID string) *runtimev1.ScenarioJob {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if job, ok := svc.scenarioJobs.get(jobID); ok && isTerminalScenarioJobStatus(job.GetStatus()) {
			return job
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("local voice.create job %s did not reach a terminal state", jobID)
	return nil
}

var _ localexecution.Resolver = (*localVoiceExecutionResolver)(nil)
