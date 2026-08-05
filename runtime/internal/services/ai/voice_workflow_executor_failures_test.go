package ai

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	catalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
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
		voiceCloneRequest(),
		catalog.ResolveVoiceWorkflowResult{
			Provider:        "dashscope",
			ModelID:         "dashscope/qwen3-tts-vc",
			WorkflowType:    "voice_clone",
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
		voiceCloneRequest(),
		catalog.ResolveVoiceWorkflowResult{
			Provider:        "dashscope",
			ModelID:         "dashscope/qwen3-tts-vc",
			WorkflowType:    "voice_clone",
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
		voiceCloneRequest(),
		catalog.ResolveVoiceWorkflowResult{
			Provider:        "dashscope",
			ModelID:         "dashscope/qwen3-tts-vc",
			WorkflowType:    "voice_clone",
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

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"dashscope": {BaseURL: server.URL, APIKey: "test-key"},
		},
		AllowLoopbackEndpoint: true,
	})
	req := voiceCloneRequest()
	resolution, err := svc.resolveVoiceWorkflow(context.Background(), "dashscope", "qwen3-tts-vc", "voice_clone")
	if err != nil {
		t.Fatalf("resolveVoiceWorkflow: %v", err)
	}
	job, asset := svc.voiceAssets.submit(&voiceWorkflowSubmitInput{
		Head:              req.GetHead(),
		ScenarioType:      req.GetScenarioType(),
		Spec:              req.GetSpec(),
		ModelResolved:     "qwen3-tts-vc",
		Provider:          "dashscope",
		WorkflowModelID:   resolution.WorkflowModelID,
		OutputPersistence: resolution.OutputPersistence,
	})
	if job == nil || asset == nil {
		t.Fatalf("submit should create workflow job and asset")
	}

	svc.executeVoiceWorkflowJob(
		context.Background(),
		job.GetJobId(),
		asset.GetVoiceAssetId(),
		resolution,
		req,
		svc.resolveNativeAdapterConfig("dashscope", &nimillm.RemoteTarget{
			ProviderType:    "dashscope",
			Endpoint:        server.URL,
			APIKey:          "test-key",
			ProviderModelID: "qwen3-tts-vc",
			AllowLoopback:   true,
		}),
	)

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

func TestVoiceWorkflowRejectsUndeclaredStrictExtensionField(t *testing.T) {
	payload, err := structpb.NewStruct(map[string]any{"unexpected_field": "value"})
	if err != nil {
		t.Fatalf("build extension payload: %v", err)
	}

	req := voiceCloneRequest()
	req.Extensions = []*runtimev1.ScenarioExtension{
		{
			Namespace: "nimi.scenario.voice_clone.request",
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
			WorkflowType:    "voice_clone",
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

	req := voiceCloneRequest()
	req.Extensions = []*runtimev1.ScenarioExtension{
		{
			Namespace: "nimi.scenario.voice_clone.request",
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
			WorkflowType:    "voice_clone",
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
	req := voiceCloneRequest()
	req.Spec.GetVoiceClone().Input.ReferenceAudioBytes = make([]byte, maxVoiceWorkflowReferenceAudioBytes+1)
	req.Spec.GetVoiceClone().Input.ReferenceAudioMime = "audio/wav"
	req.Spec.GetVoiceClone().Input.ReferenceAudioUri = ""

	_, err := executeVoiceWorkflowViaNimillm(
		context.Background(),
		"dashscope",
		req,
		catalog.ResolveVoiceWorkflowResult{
			Provider:        "dashscope",
			ModelID:         "dashscope/qwen3-tts-vc",
			WorkflowType:    "voice_clone",
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
	if nimillm.SupportsVoiceWorkflowProvider("local") {
		t.Fatalf("local should NOT have a voice workflow adapter; local must fail-close")
	}

	_, err := executeVoiceWorkflowViaNimillm(
		context.Background(),
		"local",
		voiceCloneRequest(),
		catalog.ResolveVoiceWorkflowResult{
			Provider:        "local",
			ModelID:         "local/qwen3-tts-local",
			WorkflowType:    "voice_clone",
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

func voiceCloneRequest() *runtimev1.SubmitScenarioJobRequest {
	return &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "app-1",
			SubjectUserId: "user-1",
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_VoiceClone{VoiceClone: &runtimev1.VoiceCloneScenarioSpec{
				TargetModelId: "qwen3-tts-vc",
				Input: &runtimev1.VoiceV2VInput{
					ReferenceAudioUri:  "https://example.com/reference.wav",
					ReferenceAudioMime: "audio/wav",
					LanguageHints:      []string{"en", "zh"},
					PreferredName:      "test-clone-voice",
					Text:               "",
				},
			}},
		},
	}
}

func voiceDesignRequest() *runtimev1.SubmitScenarioJobRequest {
	return &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "app-1",
			SubjectUserId: "user-1",
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_VoiceDesign{VoiceDesign: &runtimev1.VoiceDesignScenarioSpec{
				TargetModelId: "eleven_ttv_v3",
				Input: &runtimev1.VoiceT2VInput{
					InstructionText: "A warm, calm and natural female narrator voice.",
					PreviewText:     "Hello from Nimi voice design.",
					Language:        "en",
					PreferredName:   "narrator-test",
				},
			}},
		},
	}
}

func boolPtr(value bool) *bool {
	return &value
}
