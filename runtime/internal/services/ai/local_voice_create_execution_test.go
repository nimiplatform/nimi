package ai

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	runtimeconfig "github.com/nimiplatform/nimi/runtime/internal/config"
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

func (r *localVoiceExecutionResolver) ProjectSelectedLocalLoadout(contract string) (localexecution.LoadoutOption, bool, error) {
	return selectedLoadoutOptionForTest(r.selections[contract])
}

func (r *localVoiceExecutionResolver) ResolveSelectedLocalExecution(contract string) (*localexecution.SelectedLocalExecution, error) {
	return r.ResolveLocalExecution(contract, "")
}

func (r *localVoiceExecutionResolver) ResolveLocalExecution(contract string, _ string) (*localexecution.SelectedLocalExecution, error) {
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
			voiceCtx := executionintent.WithIntent(ownerCtx, executionintent.Intent{CapabilityContract: capabilitydriver.VoiceCreateContract, LocalLoadoutRef: "test-loadout:voice.create", Route: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL, RequiredFeatures: []string{test.feature}})
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

			synthCtx := executionintent.WithIntent(ownerCtx, executionintent.Intent{CapabilityContract: capabilitydriver.AudioSynthesizeContract, LocalLoadoutRef: "test-loadout:audio.synthesize", Route: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL})
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

func TestAudioCppReferenceVoiceCreatePublishesAndDeletesPrivateWAV(t *testing.T) {
	selection := selectedAudioCppReferenceVoiceExecutionForTest(t, "glm_tts")
	svc := newTestService(nil)
	svc.localSpeechStagingRoot = t.TempDir()
	svc.SetLocalExecutionResolver(&localVoiceExecutionResolver{selections: map[string]*localexecution.SelectedLocalExecution{capabilitydriver.VoiceCreateContract: selection}})
	host := &localSpeechHostStub{voiceCreateResultFn: func(plan *capabilitydriver.VoiceCreateInvocationPlan) (localexecution.VoiceCreateResult, error) {
		id := strings.TrimPrefix(plan.AudioCppProviderVoiceRef(), capabilitydriver.AudioCppReferenceVoicePrefix)
		if id == plan.AudioCppProviderVoiceRef() || !filepath.IsAbs(plan.AudioCppReferenceRoot()) {
			return localexecution.VoiceCreateResult{}, fmt.Errorf("invalid reference plan")
		}
		if err := os.MkdirAll(plan.AudioCppReferenceRoot(), 0o700); err != nil {
			return localexecution.VoiceCreateResult{}, err
		}
		if err := os.WriteFile(filepath.Join(plan.AudioCppReferenceRoot(), id+".wav"), plan.AudioCppReferenceWAV(), 0o600); err != nil {
			return localexecution.VoiceCreateResult{}, err
		}
		if err := os.WriteFile(filepath.Join(plan.AudioCppReferenceRoot(), id+".json"), plan.AudioCppReferenceMetadata(), 0o600); err != nil {
			return localexecution.VoiceCreateResult{}, err
		}
		return localexecution.VoiceCreateResult{ProviderVoiceRef: plan.AudioCppProviderVoiceRef()}, nil
	}}
	svc.SetLocalSpeechExecutionHost(host)
	wavPath := filepath.Join(t.TempDir(), "reference.wav")
	if err := writeLocalMusicTestWAV(wavPath, 16000, 1, 1); err != nil {
		t.Fatal(err)
	}
	wav, err := os.ReadFile(wavPath)
	if err != nil {
		t.Fatal(err)
	}
	ownerCtx := scenarioJobUserContext("app.local", "anonymous")
	ctx := executionintent.WithIntent(ownerCtx, executionintent.Intent{CapabilityContract: capabilitydriver.VoiceCreateContract, LocalLoadoutRef: "audio-cpp-glm-voice", Route: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL, RequiredFeatures: []string{"input.audio"}})
	response, err := svc.SubmitScenarioJob(ctx, &runtimev1.SubmitScenarioJobRequest{Head: &runtimev1.ScenarioRequestHead{AppId: "app.local", SubjectUserId: "anonymous"}, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE, ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VoiceCreate{VoiceCreate: &runtimev1.VoiceCreateScenarioSpec{Source: &runtimev1.VoiceCreateScenarioSpec_ReferenceAudio{ReferenceAudio: &runtimev1.VoiceV2VInput{ReferenceAudioBytes: wav, ReferenceAudioMime: "audio/wav", Text: "reference words"}}}}}})
	if err != nil {
		t.Fatal(err)
	}
	job := waitLocalVoiceJobTerminal(t, svc, response.GetJob().GetJobId())
	asset, ok := svc.voiceAssets.getAsset(job.GetJobId())
	if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || !ok || !strings.HasPrefix(asset.GetProviderVoiceRef(), capabilitydriver.AudioCppReferenceVoicePrefix) {
		t.Fatalf("Job=%+v asset=%+v found=%v", job, asset, ok)
	}
	id := strings.TrimPrefix(asset.GetProviderVoiceRef(), capabilitydriver.AudioCppReferenceVoicePrefix)
	root, err := svc.audioCppReferenceVoiceRoot()
	if err != nil {
		t.Fatal(err)
	}
	for _, suffix := range []string{".wav", ".json"} {
		if _, err := os.Stat(filepath.Join(root, id+suffix)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := svc.DeleteVoiceAsset(ownerCtx, &runtimev1.DeleteVoiceAssetRequest{VoiceAssetId: asset.GetVoiceAssetId()}); err != nil {
		t.Fatal(err)
	}
	for _, suffix := range []string{".wav", ".json"} {
		if _, err := os.Stat(filepath.Join(root, id+suffix)); !os.IsNotExist(err) {
			t.Fatalf("private reference %s cleanup err=%v", suffix, err)
		}
	}
}

func TestAudioCppReferenceVoiceCreateDoesNotPublishAfterTimeout(t *testing.T) {
	selection := selectedAudioCppReferenceVoiceExecutionForTest(t, "glm_tts")
	svc := newTestService(nil)
	svc.localSpeechStagingRoot = t.TempDir()
	svc.SetLocalExecutionResolver(&localVoiceExecutionResolver{selections: map[string]*localexecution.SelectedLocalExecution{capabilitydriver.VoiceCreateContract: selection}})
	host := &localSpeechHostStub{voiceCreateResultCtxFn: func(ctx context.Context, plan *capabilitydriver.VoiceCreateInvocationPlan) (localexecution.VoiceCreateResult, error) {
		<-ctx.Done()
		id := strings.TrimPrefix(plan.AudioCppProviderVoiceRef(), capabilitydriver.AudioCppReferenceVoicePrefix)
		if err := os.MkdirAll(plan.AudioCppReferenceRoot(), 0o700); err != nil {
			return localexecution.VoiceCreateResult{}, err
		}
		if err := os.WriteFile(filepath.Join(plan.AudioCppReferenceRoot(), id+".wav"), plan.AudioCppReferenceWAV(), 0o600); err != nil {
			return localexecution.VoiceCreateResult{}, err
		}
		if err := os.WriteFile(filepath.Join(plan.AudioCppReferenceRoot(), id+".json"), plan.AudioCppReferenceMetadata(), 0o600); err != nil {
			return localexecution.VoiceCreateResult{}, err
		}
		return localexecution.VoiceCreateResult{ProviderVoiceRef: plan.AudioCppProviderVoiceRef()}, nil
	}}
	svc.SetLocalSpeechExecutionHost(host)

	wavPath := filepath.Join(t.TempDir(), "reference.wav")
	if err := writeLocalMusicTestWAV(wavPath, 16000, 1, 1); err != nil {
		t.Fatal(err)
	}
	wav, err := os.ReadFile(wavPath)
	if err != nil {
		t.Fatal(err)
	}
	ownerCtx := scenarioJobUserContext("app.local", "anonymous")
	ctx := executionintent.WithIntent(ownerCtx, executionintent.Intent{CapabilityContract: capabilitydriver.VoiceCreateContract, LocalLoadoutRef: "audio-cpp-glm-voice-timeout", Route: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL, RequiredFeatures: []string{"input.audio"}})
	response, err := svc.SubmitScenarioJob(ctx, &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{AppId: "app.local", SubjectUserId: "anonymous", TimeoutMs: 10}, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE, ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VoiceCreate{VoiceCreate: &runtimev1.VoiceCreateScenarioSpec{Source: &runtimev1.VoiceCreateScenarioSpec_ReferenceAudio{ReferenceAudio: &runtimev1.VoiceV2VInput{ReferenceAudioBytes: wav, ReferenceAudioMime: "audio/wav", Text: "reference words"}}}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	job := waitLocalVoiceJobTerminal(t, svc, response.GetJob().GetJobId())
	if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_TIMEOUT {
		t.Fatalf("voice.create status=%s reason=%s detail=%q", job.GetStatus(), job.GetReasonCode(), job.GetReasonDetail())
	}
	if _, ok := svc.voiceAssets.getAsset(job.GetJobId()); ok {
		t.Fatal("timed-out audio.cpp voice.create published a VoiceAsset")
	}
	host.mu.Lock()
	plan := host.voiceCreatePlan
	host.mu.Unlock()
	if plan == nil {
		t.Fatal("audio.cpp voice.create plan was not executed")
	}
	id := strings.TrimPrefix(plan.AudioCppProviderVoiceRef(), capabilitydriver.AudioCppReferenceVoicePrefix)
	for _, suffix := range []string{".wav", ".json"} {
		if _, err := os.Stat(filepath.Join(plan.AudioCppReferenceRoot(), id+suffix)); !os.IsNotExist(err) {
			t.Fatalf("timed-out private reference %s cleanup err=%v", suffix, err)
		}
	}
}

func TestAudioCppReferenceVoiceRequiresOwnedVoiceAsset(t *testing.T) {
	selection := selectedGenericAudioCppSpeechExecutionForTest(t, capabilitydriver.AudioSynthesizeContract, "glm_tts")
	target := &runtimeidentity.Target{Local: &runtimeidentity.LocalTarget{ReadinessRef: "model-asset://model-glm_tts"}}
	selection.ExecutionTarget = target.Clone()
	svc := newTestService(nil)
	svc.localSpeechStagingRoot = t.TempDir()
	svc.SetLocalExecutionResolver(&localVoiceExecutionResolver{selections: map[string]*localexecution.SelectedLocalExecution{
		capabilitydriver.AudioSynthesizeContract: selection,
	}})
	host := &localSpeechHostStub{synthesisResultFn: func(plan capabilitydriver.SpeechSynthesizePlan) (localexecution.SpeechSynthesisResult, error) {
		exact, ok := plan.(*capabilitydriver.AudioCppTTSSynthesizePlan)
		if !ok {
			return localexecution.SpeechSynthesisResult{}, fmt.Errorf("unexpected synthesis plan %T", plan)
		}
		if err := writeLocalMusicTestWAV(exact.StagingWAVPath(), 24000, 1, 1); err != nil {
			return localexecution.SpeechSynthesisResult{}, err
		}
		return localexecution.SpeechSynthesisResult{StagingWAVPath: exact.StagingWAVPath(), MIMEType: "audio/wav"}, nil
	}}
	svc.SetLocalSpeechExecutionHost(host)

	wavPath := filepath.Join(t.TempDir(), "reference.wav")
	if err := writeLocalMusicTestWAV(wavPath, 16000, 1, 1); err != nil {
		t.Fatal(err)
	}
	wav, err := os.ReadFile(wavPath)
	if err != nil {
		t.Fatal(err)
	}
	handle := capabilitydriver.AudioCppReferenceVoicePrefix + "01HZZZZZZZZZZZZZZZZZZZZZZZ"
	if err := writeAudioCppReferenceVoiceTestFiles(svc, handle, wav, `{"mime_type":"audio/wav","reference_text":"reference words"}`); err != nil {
		t.Fatal(err)
	}
	assetID := "voice-asset-owned-reference"
	draft := &runtimev1.VoiceAsset{
		VoiceAssetId: assetID, AppId: "app.local", SubjectUserId: "anonymous", Provider: "local",
		Persistence: runtimev1.VoiceAssetPersistence_VOICE_ASSET_PERSISTENCE_SESSION_EPHEMERAL,
	}
	if _, published := svc.voiceAssets.publishResult(draft, target, nil, handle, nil, func(*runtimev1.VoiceAsset, *runtimev1.VoiceReference) bool { return true }); !published {
		t.Fatal("publish owned audio.cpp VoiceAsset")
	}

	ownerCtx := scenarioJobUserContext("app.local", "anonymous")
	synthCtx := executionintent.WithIntent(ownerCtx, executionintent.Intent{CapabilityContract: capabilitydriver.AudioSynthesizeContract, LocalLoadoutRef: selection.LoadoutID, Route: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL})
	submit := func(reference *runtimev1.VoiceReference) (*runtimev1.SubmitScenarioJobResponse, error) {
		return svc.SubmitScenarioJob(synthCtx, &runtimev1.SubmitScenarioJobRequest{
			Head: &runtimev1.ScenarioRequestHead{AppId: "app.local", SubjectUserId: "anonymous"}, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE, ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
			Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{Text: "synthesize", AudioFormat: "wav", VoiceRef: reference}}},
		})
	}

	direct := &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PROVIDER_VOICE_REF, Reference: &runtimev1.VoiceReference_ProviderVoiceRef{ProviderVoiceRef: handle}}
	directResponse, directErr := submit(direct)
	if directErr == nil {
		if directResponse != nil && directResponse.GetJob() != nil {
			_ = waitLocalSpeechJobTerminal(t, svc, directResponse.GetJob().GetJobId())
		}
		t.Errorf("direct private provider handle returned response=%+v", directResponse)
	} else if reason, ok := grpcerr.ExtractReasonCode(directErr); !ok || reason != runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID {
		t.Errorf("direct private provider handle error=%v reason=%s found=%v", directErr, reason, ok)
	}

	assetResponse, err := submit(voiceAssetReference(assetID))
	if err != nil {
		t.Fatalf("owned VoiceAsset synthesis: %v", err)
	}
	if job := waitLocalSpeechJobTerminal(t, svc, assetResponse.GetJob().GetJobId()); job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		t.Fatalf("owned VoiceAsset synthesis Job=%+v", job)
	}
	host.mu.Lock()
	plan, _ := host.synthesizePlan.(*capabilitydriver.AudioCppTTSSynthesizePlan)
	host.mu.Unlock()
	if plan == nil || !bytes.Equal(plan.ReferenceWAVBytes(), wav) || plan.ReferenceText() != "reference words" || plan.Request().GetVoiceRef().GetProviderVoiceRef() != handle {
		t.Fatalf("owned VoiceAsset synthesis plan=%+v", plan)
	}
}

func TestAudioCppReferenceVoiceStartupCleansPreviousSessionFiles(t *testing.T) {
	base := t.TempDir()
	localStatePath := filepath.Join(base, "local-state.json")
	daemonConfig := runtimeconfig.Config{LocalStatePath: localStatePath}
	first, err := newService(nil, nil, nil, Config{}.normalized(), daemonConfig, "")
	if err != nil {
		t.Fatal(err)
	}
	root, err := first.audioCppReferenceVoiceRoot()
	if err != nil {
		t.Fatal(err)
	}
	handle := capabilitydriver.AudioCppReferenceVoicePrefix + "01HYYYYYYYYYYYYYYYYYYYYYYYYY"
	id := strings.TrimPrefix(handle, capabilitydriver.AudioCppReferenceVoicePrefix)
	wavPath := filepath.Join(t.TempDir(), "reference.wav")
	if err := writeLocalMusicTestWAV(wavPath, 16000, 1, 1); err != nil {
		t.Fatal(err)
	}
	wav, err := os.ReadFile(wavPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := writeAudioCppReferenceVoiceTestFiles(first, handle, wav, `{"mime_type":"audio/wav"}`); err != nil {
		t.Fatal(err)
	}
	for _, suffix := range []string{".wav.tmp", ".json.tmp"} {
		if err := os.WriteFile(filepath.Join(root, id+suffix), []byte("partial"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	assetID := "previous-session-voice-asset"
	target := &runtimeidentity.Target{Local: &runtimeidentity.LocalTarget{ReadinessRef: "model-asset://previous-session"}}
	if _, published := first.voiceAssets.publishResult(&runtimev1.VoiceAsset{VoiceAssetId: assetID, AppId: "app.local", SubjectUserId: "anonymous", Provider: "local", Persistence: runtimev1.VoiceAssetPersistence_VOICE_ASSET_PERSISTENCE_SESSION_EPHEMERAL}, target, nil, handle, nil, func(*runtimev1.VoiceAsset, *runtimev1.VoiceReference) bool { return true }); !published {
		t.Fatal("publish previous-session VoiceAsset")
	}
	foreignPath := filepath.Join(root, "keep.txt")
	if err := os.WriteFile(foreignPath, []byte("keep"), 0o600); err != nil {
		t.Fatal(err)
	}
	directoryID := "01HXXXXXXXXXXXXXXXXXXXXXXXXX"
	foreignDirectory := filepath.Join(root, directoryID+".json")
	if err := os.Mkdir(foreignDirectory, 0o700); err != nil {
		t.Fatal(err)
	}
	outsidePath := filepath.Join(base, "outside.wav")
	if err := os.WriteFile(outsidePath, []byte("outside"), 0o600); err != nil {
		t.Fatal(err)
	}
	symlinkPath := filepath.Join(root, "01HWWWWWWWWWWWWWWWWWWWWWWW.wav")
	symlinkCreated := os.Symlink(outsidePath, symlinkPath) == nil

	second, err := newService(nil, nil, nil, Config{}.normalized(), daemonConfig, "")
	if err != nil {
		t.Fatal(err)
	}
	for _, suffix := range []string{".wav", ".json", ".wav.tmp", ".json.tmp"} {
		if _, err := os.Lstat(filepath.Join(root, id+suffix)); !os.IsNotExist(err) {
			t.Errorf("previous-session private file %s cleanup err=%v", suffix, err)
		}
	}
	if _, ok := second.voiceAssets.getAsset(assetID); ok {
		t.Error("session-ephemeral VoiceAsset was restored")
	}
	if _, err := second.captureAudioCppReferenceVoice(handle, filepath.Join(base, "captured.wav")); err == nil {
		t.Error("previous-session private handle remained usable")
	}
	for _, path := range []string{foreignPath, foreignDirectory, outsidePath} {
		if _, err := os.Lstat(path); err != nil {
			t.Errorf("non-product path %s was changed: %v", path, err)
		}
	}
	if symlinkCreated {
		if info, err := os.Lstat(symlinkPath); err != nil || info.Mode()&os.ModeSymlink == 0 {
			t.Errorf("private-root symlink was followed or removed: info=%v err=%v", info, err)
		}
	}
}

func writeAudioCppReferenceVoiceTestFiles(svc *Service, handle string, wav []byte, metadata string) error {
	id, err := audioCppReferenceVoiceID(handle)
	if err != nil {
		return err
	}
	root, err := svc.audioCppReferenceVoiceRoot()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(root, 0o700); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(root, id+".wav"), wav, 0o600); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(root, id+".json"), []byte(metadata), 0o600)
}

func selectedAudioCppReferenceVoiceExecutionForTest(t *testing.T, family string) *localexecution.SelectedLocalExecution {
	t.Helper()
	var registration capabilitydriver.AudioCppSpeechRegistration
	for _, candidate := range capabilitydriver.AudioCppReferenceVoiceRegistrations() {
		if candidate.Family == family {
			registration = candidate
			break
		}
	}
	driver, reason := capabilitydriver.NewProductionRegistry().Resolve(capabilitydriver.VoiceCreateContract, registration.Identity)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || driver == nil {
		t.Fatalf("reference Driver reason=%v", reason)
	}
	requirements, reason := driver.Interpret(capabilitydriver.InterpretInput{RecipeID: registration.RecipeID, SupportedFeatures: []string{"input.audio"}})
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || len(requirements) != 1 {
		t.Fatalf("reference requirements=%+v reason=%v", requirements, reason)
	}
	root := t.TempDir()
	path := filepath.Join(root, family+".gguf")
	payload := []byte("audio-cpp-reference-model-" + family)
	if err := os.WriteFile(path, payload, 0o600); err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(payload)
	digestText := hex.EncodeToString(digest[:])
	return &localexecution.SelectedLocalExecution{LoadoutID: "voice-" + family, CapabilityContract: capabilitydriver.VoiceCreateContract, DisplayName: registration.DisplayName, RecipeID: registration.RecipeID, RecipeRevision: "1", DriverIdentity: registration.Identity.Proto(), PortableConfig: &structpb.Struct{}, Requirements: requirements, ExactBindings: []localexecution.ExactBinding{{RequirementID: capabilitydriver.AudioCppTTSModelRequirementID, RequirementRole: runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN, ModelAssetID: "model-" + family, AbsolutePath: path, BundleDir: root, DeclaredFiles: []string{filepath.Base(path)}, VerifiedContentID: "sha256:" + digestText, EntrySHA256: digestText}}, SupportedFeatures: []string{"input.audio"}, ExecutionTarget: &runtimeidentity.Target{Local: &runtimeidentity.LocalTarget{ReadinessRef: "model-asset://model-" + family}}, Configured: true}
}

func TestLocalVoiceCreateFailsClosedOnUnsupportedSelectedSource(t *testing.T) {
	svc := newTestService(nil)
	svc.SetLocalExecutionResolver(&localVoiceExecutionResolver{selections: map[string]*localexecution.SelectedLocalExecution{
		capabilitydriver.VoiceCreateContract: selectedLocalVoiceCreateExecutionForTest(t, "voice-text-only", "input.text"),
	}})
	svc.SetLocalSpeechExecutionHost(&localSpeechHostStub{})
	ctx := executionintent.WithIntent(scenarioJobUserContext("app.local", "anonymous"), executionintent.Intent{CapabilityContract: capabilitydriver.VoiceCreateContract, LocalLoadoutRef: "test-loadout:voice.create", Route: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL, RequiredFeatures: []string{"input.audio"}})
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
