package ai

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	catalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestVoiceWorkflowFailCloseOnInvalidProviderResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{}`)
	}))
	defer func() { server.Close() }()

	_, err := executeVoiceWorkflowViaNimillm(
		context.Background(),
		"dashscope",
		voiceReferenceAudioRequest(),
		catalog.ResolveVoiceWorkflowResult{
			Provider:        "dashscope",
			ModelID:         "dashscope/qwen3-tts-vc",
			WorkflowType:    "reference_audio",
			WorkflowModelID: "qwen-voice-enrollment",
		},
		nimillm.MediaAdapterConfig{BaseURL: server.URL, AllowLoopbackEndpoint: true, APIKey: "test-key"},
	)
	if err == nil {
		t.Fatalf("expected fail-close error for invalid provider payload")
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_OUTPUT_INVALID {
		t.Fatalf("expected AI_OUTPUT_INVALID, got reason=%v ok=%v err=%v", reason, ok, err)
	}
}

func TestVoiceWorkflowRejectsJobOnlyProviderResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"job_id":"job-only"}`)
	}))
	defer func() { server.Close() }()

	_, err := executeVoiceWorkflowViaNimillm(
		context.Background(),
		"dashscope",
		voiceReferenceAudioRequest(),
		catalog.ResolveVoiceWorkflowResult{
			Provider:        "dashscope",
			ModelID:         "dashscope/qwen3-tts-vc",
			WorkflowType:    "reference_audio",
			WorkflowModelID: "qwen-voice-enrollment",
		},
		nimillm.MediaAdapterConfig{BaseURL: server.URL, AllowLoopbackEndpoint: true, APIKey: "test-key"},
	)
	if err == nil {
		t.Fatalf("expected fail-close error for provider payload without provider_voice_ref")
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_OUTPUT_INVALID {
		t.Fatalf("expected AI_OUTPUT_INVALID, got reason=%v ok=%v err=%v", reason, ok, err)
	}
}

func TestVoiceWorkflowDoesNotSynthesizeProviderJobID(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"voice_id":"voice-only"}`)
	}))
	defer func() { server.Close() }()

	result, err := executeVoiceWorkflowViaNimillm(
		context.Background(),
		"dashscope",
		voiceReferenceAudioRequest(),
		catalog.ResolveVoiceWorkflowResult{
			Provider:        "dashscope",
			ModelID:         "dashscope/qwen3-tts-vc",
			WorkflowType:    "reference_audio",
			WorkflowModelID: "qwen-voice-enrollment",
		},
		nimillm.MediaAdapterConfig{BaseURL: server.URL, AllowLoopbackEndpoint: true, APIKey: "test-key"},
	)
	if err != nil {
		t.Fatalf("Execute clone workflow without provider job id: %v", err)
	}
	if strings.TrimSpace(result.ProviderVoiceRef) != "voice-only" {
		t.Fatalf("unexpected provider voice ref: %q", result.ProviderVoiceRef)
	}
	if strings.TrimSpace(result.ProviderJobID) != "" {
		t.Fatalf("provider job id should stay empty when provider does not return one, got=%q", result.ProviderJobID)
	}
}

func TestExecuteVoiceWorkflowJobPersistsWorkflowFamilyAndHandlePolicyMetadata(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"voice_id":"voice-123","job_id":"job-123"}`)
	}))
	defer func() { server.Close() }()

	fixture := newManagedCloudScenarioTestFixture(t, "dashscope", "qwen3-tts-vc-2026-01-22", server.URL, Config{AllowLoopbackEndpoint: true})
	svc := fixture.service
	req := voiceReferenceAudioRequest()
	ctx := withCloudScenarioTestIntent(scenarioJobUserContext(req.GetHead().GetAppId(), "user-001"), "voice.create", fixture.targetRef)
	submitted, err := svc.SubmitScenarioJob(ctx, req)
	if err != nil {
		t.Fatalf("SubmitScenarioJob: %v", err)
	}
	job := submitted.GetJob()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		job, _ = svc.scenarioJobs.get(submitted.GetJob().GetJobId())
		if isTerminalScenarioJobStatus(job.GetStatus()) {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		t.Fatalf("voice workflow status=%s reason=%s detail=%s", job.GetStatus(), job.GetReasonCode(), job.GetReasonDetail())
	}
	terminal, err := svc.GetScenarioJob(ctx, &runtimev1.GetScenarioJobRequest{JobId: job.GetJobId()})
	if err != nil {
		t.Fatalf("GetScenarioJob terminal result: %v", err)
	}
	asset := terminal.GetAsset()
	stored, ok := svc.voiceAssets.getAsset(asset.GetVoiceAssetId())
	if !ok {
		t.Fatalf("expected stored asset")
	}
	if got := stored.GetMetadata().GetFields()["voice_handle_policy_id"].GetStringValue(); got != "dashscope_provider_persistent_default" {
		t.Fatalf("voice_handle_policy_id=%q", got)
	}
	if got := stored.GetMetadata().GetFields()["voice_handle_policy_delete_semantics"].GetStringValue(); got != "best_effort_provider_delete" {
		t.Fatalf("voice_handle_policy_delete_semantics=%q", got)
	}
	if !stored.GetMetadata().GetFields()["voice_handle_policy_runtime_reconciliation_required"].GetBoolValue() {
		t.Fatalf("expected runtime reconciliation flag")
	}
}

func TestCloudVoiceResolvedAssemblyCapturesGeneratedPreferredNameBeforeWorkerRebuild(t *testing.T) {
	fixture := newManagedCloudScenarioTestFixture(t, "dashscope", "qwen3-tts-vc-2026-01-22", "https://example.com", Config{})
	req := voiceReferenceAudioRequest()
	req.GetSpec().GetVoiceCreate().GetReferenceAudio().PreferredName = ""
	ctx := withCloudScenarioTestIntent(scenarioJobUserContext(req.GetHead().GetAppId(), "user-001"), "voice.create", fixture.targetRef)
	effective, err := fixture.service.captureCloudVoiceWorkflowEffectiveInputs(ctx, req)
	if err != nil {
		t.Fatalf("capture Cloud voice inputs: %v", err)
	}
	defer effective.release()
	capturedPayload := effective.mapped.Payload()
	input, ok := capturedPayload["input"].(map[string]any)
	if !ok || strings.TrimSpace(nimillm.ValueAsString(input["preferred_name"])) == "" {
		t.Fatalf("captured mapped payload has no generated preferred_name: %#v", capturedPayload)
	}
	if strings.TrimSpace(effective.request.GetSpec().GetVoiceCreate().GetReferenceAudio().GetPreferredName()) == "" {
		t.Fatal("generated preferred_name was not written into the durable request capture")
	}
	if err := fixture.service.bindCloudCredentialCustody("job-voice-rebuild", effective.resolvedAssembly); err != nil {
		t.Fatalf("bind Cloud voice credential custody: %v", err)
	}
	custodyRef := effective.resolvedAssembly.CredentialCustodyRef
	t.Cleanup(func() {
		if err := fixture.service.releaseCloudCredentialCustody(custodyRef); err != nil {
			t.Errorf("release Cloud voice credential custody: %v", err)
		}
	})
	rebuilt, err := fixture.service.cloudVoiceWorkflowEffectiveInputsFromResolvedAssembly(effective.resolvedAssembly)
	if err != nil {
		t.Fatalf("rebuild Cloud voice inputs: %v", err)
	}
	defer rebuilt.release()
	if !reflect.DeepEqual(capturedPayload, rebuilt.mapped.Payload()) {
		t.Fatalf("worker remapped invocation changed: captured=%#v rebuilt=%#v", capturedPayload, rebuilt.mapped.Payload())
	}
}

func TestVoiceWorkflowRejectsUndeclaredStrictExtensionField(t *testing.T) {
	payload, err := structpb.NewStruct(map[string]any{"unexpected_field": "value"})
	if err != nil {
		t.Fatalf("build extension payload: %v", err)
	}

	req := voiceReferenceAudioRequest()
	req.Extensions = []*runtimev1.ScenarioExtension{
		{
			Namespace: "nimi.scenario.voice_create.request",
			Payload:   payload,
		},
	}

	_, err = executeVoiceWorkflowViaNimillm(
		context.Background(),
		"dashscope",
		req,
		catalog.ResolveVoiceWorkflowResult{
			Provider:        "dashscope",
			ModelID:         "dashscope/qwen3-tts-vc",
			WorkflowType:    "reference_audio",
			WorkflowModelID: "qwen-voice-enrollment",
		},
		nimillm.MediaAdapterConfig{BaseURL: "https://example.invalid", APIKey: "test-key"},
	)
	if err == nil {
		t.Fatalf("expected strict extension whitelist rejection")
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED {
		t.Fatalf("expected AI_VOICE_WORKFLOW_UNSUPPORTED, got reason=%v ok=%v err=%v", reason, ok, err)
	}
}

func TestVoiceWorkflowRejectsLegacyExtensionKeys(t *testing.T) {
	payload, err := structpb.NewStruct(map[string]any{"endpoint": "https://legacy.example"})
	if err != nil {
		t.Fatalf("build extension payload: %v", err)
	}

	req := voiceReferenceAudioRequest()
	req.Extensions = []*runtimev1.ScenarioExtension{
		{
			Namespace: "nimi.scenario.voice_create.request",
			Payload:   payload,
		},
	}

	_, err = executeVoiceWorkflowViaNimillm(
		context.Background(),
		"dashscope",
		req,
		catalog.ResolveVoiceWorkflowResult{
			Provider:        "dashscope",
			ModelID:         "dashscope/qwen3-tts-vc",
			WorkflowType:    "reference_audio",
			WorkflowModelID: "qwen-voice-enrollment",
		},
		nimillm.MediaAdapterConfig{BaseURL: "https://example.invalid", APIKey: "test-key"},
	)
	if err == nil {
		t.Fatalf("expected legacy extension key rejection")
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED {
		t.Fatalf("expected AI_VOICE_WORKFLOW_UNSUPPORTED, got reason=%v ok=%v err=%v", reason, ok, err)
	}
}

func TestVoiceWorkflowRejectsOversizedReferenceAudio(t *testing.T) {
	req := voiceReferenceAudioRequest()
	req.Spec.GetVoiceCreate().GetReferenceAudio().ReferenceAudioBytes = make([]byte, maxVoiceWorkflowReferenceAudioBytes+1)
	req.Spec.GetVoiceCreate().GetReferenceAudio().ReferenceAudioMime = "audio/wav"
	req.Spec.GetVoiceCreate().GetReferenceAudio().ReferenceAudioUri = ""

	_, err := executeVoiceWorkflowViaNimillm(
		context.Background(),
		"dashscope",
		req,
		catalog.ResolveVoiceWorkflowResult{
			Provider:        "dashscope",
			ModelID:         "dashscope/qwen3-tts-vc",
			WorkflowType:    "reference_audio",
			WorkflowModelID: "qwen-voice-enrollment",
		},
		nimillm.MediaAdapterConfig{BaseURL: "https://example.invalid", APIKey: "test-key"},
	)
	if err == nil {
		t.Fatalf("expected oversized reference audio rejection")
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID {
		t.Fatalf("expected AI_VOICE_INPUT_INVALID, got reason=%v ok=%v err=%v", reason, ok, err)
	}
}

func TestLocalVoiceWorkflowFailClose(t *testing.T) {
	// local voice workflow must fail-close since there is no real local engine.
	if capabilitydriver.ResolveCloudMediaAdapter("local", "voice.create") != "" {
		t.Fatalf("local should NOT have a voice workflow adapter; local must fail-close")
	}

	_, err := executeVoiceWorkflowViaNimillm(
		context.Background(),
		"local",
		voiceReferenceAudioRequest(),
		catalog.ResolveVoiceWorkflowResult{
			Provider:        "local",
			ModelID:         "local/qwen3-tts-local",
			WorkflowType:    "reference_audio",
			WorkflowModelID: "qwen3-local-voice-clone-prompt",
		},
		nimillm.MediaAdapterConfig{},
	)
	if err == nil {
		t.Fatalf("expected local voice workflow to fail-close")
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED {
		t.Fatalf("expected AI_VOICE_WORKFLOW_UNSUPPORTED for local, got reason=%v ok=%v", reason, ok)
	}
}

func voiceReferenceAudioRequest() *runtimev1.SubmitScenarioJobRequest {
	return &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "app-1",
			SubjectUserId: "user-1",
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_VoiceCreate{VoiceCreate: &runtimev1.VoiceCreateScenarioSpec{
				TargetModelId: "qwen3-tts-vc",
				Source: &runtimev1.VoiceCreateScenarioSpec_ReferenceAudio{ReferenceAudio: &runtimev1.VoiceV2VInput{
					ReferenceAudioUri:  "https://example.com/reference.wav",
					ReferenceAudioMime: "audio/wav",
					LanguageHints:      []string{"en", "zh"},
					PreferredName:      "test-clone-voice",
					Text:               "",
				}},
			}},
		},
	}
}

func voiceTextDescriptionRequest() *runtimev1.SubmitScenarioJobRequest {
	return &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "app-1",
			SubjectUserId: "user-1",
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_VoiceCreate{VoiceCreate: &runtimev1.VoiceCreateScenarioSpec{
				TargetModelId: "eleven_ttv_v3",
				Source: &runtimev1.VoiceCreateScenarioSpec_TextDescription{TextDescription: &runtimev1.VoiceT2VInput{
					InstructionText: "A warm, calm and natural female narrator voice.",
					PreviewText:     "Hello from Nimi voice design.",
					Language:        "en",
					PreferredName:   "narrator-test",
				}},
			}},
		},
	}
}

func boolPtr(value bool) *bool {
	return &value
}
