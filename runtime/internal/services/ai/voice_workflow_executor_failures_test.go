package ai

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestVoiceWorkflowFailCloseOnInvalidProviderResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{}`)
	}))
	defer server.Close()

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
		nimillm.MediaAdapterConfig{BaseURL: server.URL, APIKey: "test-key"},
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
	defer server.Close()

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
		nimillm.MediaAdapterConfig{BaseURL: server.URL, APIKey: "test-key"},
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
	defer server.Close()

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
		nimillm.MediaAdapterConfig{BaseURL: server.URL, APIKey: "test-key"},
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
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"dashscope": {BaseURL: server.URL, APIKey: "test-key"},
		},
	})
	req := voiceCloneRequest()
	resolution, err := svc.resolveVoiceWorkflow(context.Background(), "dashscope", "dashscope/qwen3-tts-vc", "voice_clone")
	if err != nil {
		t.Fatalf("resolveVoiceWorkflow: %v", err)
	}
	job, asset := svc.voiceAssets.submit(&voiceWorkflowSubmitInput{
		Head:              req.GetHead(),
		ScenarioType:      req.GetScenarioType(),
		Spec:              req.GetSpec(),
		ModelResolved:     "dashscope/qwen3-tts-vc",
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
		svc.resolveNativeAdapterConfig("dashscope", nil),
	)

	stored, ok := svc.voiceAssets.getAsset(asset.GetVoiceAssetId())
	if !ok {
		t.Fatalf("expected stored asset")
	}
	if got := stored.GetMetadata().GetFields()["workflow_family"].GetStringValue(); got != "dashscope" {
		t.Fatalf("workflow_family=%q, want dashscope", got)
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

func TestSubmitScenarioJobLocalQwenWorkflowReturnsAssetWithHandlePolicyMetadata(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, `{"ok":true}`)
	}))
	defer server.Close()
	svc.SetLocalProviderEndpoint("speech", server.URL+"/v1", "")
	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalAssetsResponse{{
		Assets: []*runtimev1.LocalAssetRecord{{
			LocalAssetId: "local-qwen3-tts-001",
			AssetId:      "speech/qwen3tts",
			Engine:       "speech",
			Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
			Endpoint:     server.URL + "/v1",
		}},
	}}}

	resp, err := svc.SubmitScenarioJob(context.Background(), &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "speech/qwen3tts",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_VoiceClone{
				VoiceClone: &runtimev1.VoiceCloneScenarioSpec{
					TargetModelId: "speech/qwen3tts",
					Input: &runtimev1.VoiceV2VInput{
						ReferenceAudioBytes: []byte("voice-audio"),
						ReferenceAudioMime:  "audio/wav",
						Text:                "clone me",
					},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("SubmitScenarioJob(local qwen3): %v", err)
	}
	if resp.GetAsset() == nil {
		t.Fatalf("expected workflow asset")
	}
	metadata := resp.GetAsset().GetMetadata().GetFields()
	if got := metadata["workflow_family"].GetStringValue(); got != "qwen3_tts" {
		t.Fatalf("workflow_family=%q, want qwen3_tts", got)
	}
	if got := metadata["voice_handle_policy_id"].GetStringValue(); got != "local_runtime_session_ephemeral_default" {
		t.Fatalf("voice_handle_policy_id=%q", got)
	}
	if got := metadata["voice_handle_policy_persistence"].GetStringValue(); got != "session_ephemeral" {
		t.Fatalf("voice_handle_policy_persistence=%q", got)
	}
	if got := metadata["voice_handle_policy_delete_semantics"].GetStringValue(); got != "runtime_authoritative_delete" {
		t.Fatalf("voice_handle_policy_delete_semantics=%q", got)
	}
}

func TestExecuteVoiceWorkflowJobLocalQwenFailCloseUsesFamilySpecificDetail(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	req := voiceCloneRequest()
	req.Head.ModelId = "speech/qwen3tts"
	req.Head.RoutePolicy = runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL
	req.Spec.GetVoiceClone().TargetModelId = "speech/qwen3tts"
	req.Spec.GetVoiceClone().Input.ReferenceAudioBytes = []byte("voice-audio")
	req.Spec.GetVoiceClone().Input.ReferenceAudioMime = "audio/wav"
	req.Spec.GetVoiceClone().Input.ReferenceAudioUri = ""

	resolution, err := svc.resolveVoiceWorkflow(context.Background(), "local", "speech/qwen3tts", "voice_clone")
	if err != nil {
		t.Fatalf("resolveVoiceWorkflow(local qwen3): %v", err)
	}
	job, asset := svc.voiceAssets.submit(&voiceWorkflowSubmitInput{
		Head:              req.GetHead(),
		ScenarioType:      req.GetScenarioType(),
		Spec:              req.GetSpec(),
		ModelResolved:     "speech/qwen3tts",
		Provider:          "local",
		WorkflowModelID:   resolution.WorkflowModelID,
		WorkflowFamily:    resolution.WorkflowFamily,
		OutputPersistence: resolution.OutputPersistence,
		HandlePolicyID:    resolution.HandlePolicyID,
		HandlePersistence: resolution.HandlePolicyPersistence,
		HandleScope:       resolution.HandlePolicyScope,
		HandleDefaultTTL:  resolution.HandlePolicyDefaultTTL,
		HandleDeleteSem:   resolution.HandlePolicyDeleteSemantics,
		RuntimeReconcile:  resolution.RuntimeReconciliationRequired,
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
		nimillm.MediaAdapterConfig{},
	)

	storedJob, ok := svc.voiceAssets.getJob(job.GetJobId())
	if !ok {
		t.Fatalf("expected stored job")
	}
	if got := storedJob.GetReasonDetail(); !strings.Contains(got, "execution plane not materialized: qwen3_tts") {
		t.Fatalf("reason detail mismatch: %q", got)
	}
	storedAsset, ok := svc.voiceAssets.getAsset(asset.GetVoiceAssetId())
	if !ok {
		t.Fatalf("expected stored asset")
	}
	if got := storedAsset.GetMetadata().GetFields()["voice_handle_policy_id"].GetStringValue(); got != "local_runtime_session_ephemeral_default" {
		t.Fatalf("stored asset voice_handle_policy_id=%q", got)
	}
}

func TestExecuteVoiceWorkflowJobLocalQwenSucceedsViaSpeechHost(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/voice/clone" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatalf("read body: %v", err)
		}
		payload := map[string]any{}
		if err := json.Unmarshal(body, &payload); err != nil {
			t.Fatalf("unmarshal body: %v", err)
		}
		if got := strings.TrimSpace(nimillm.ValueAsString(payload["target_model_id"])); got != "speech/qwen3tts" {
			t.Fatalf("unexpected target_model_id: %q", got)
		}
		input, ok := payload["input"].(map[string]any)
		if !ok {
			t.Fatalf("expected canonical input map")
		}
		if got := strings.TrimSpace(nimillm.ValueAsString(input["preferred_name"])); got != "test-clone-voice" {
			t.Fatalf("unexpected preferred_name: %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"voice_id":"voice-local-qwen3-001","job_id":"job-local-qwen3-001","metadata":{"host_family":"qwen3_tts"}}`)
	}))
	defer server.Close()

	svc.SetLocalProviderEndpoint("speech", server.URL+"/v1", "")
	req := voiceCloneRequest()
	req.Head.ModelId = "speech/qwen3tts"
	req.Head.RoutePolicy = runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL
	req.Spec.GetVoiceClone().TargetModelId = "speech/qwen3tts"
	req.Spec.GetVoiceClone().Input.ReferenceAudioBytes = []byte("voice-audio")
	req.Spec.GetVoiceClone().Input.ReferenceAudioMime = "audio/wav"
	req.Spec.GetVoiceClone().Input.ReferenceAudioUri = ""

	resolution, err := svc.resolveVoiceWorkflow(context.Background(), "local", "speech/qwen3tts", "voice_clone")
	if err != nil {
		t.Fatalf("resolveVoiceWorkflow(local qwen3): %v", err)
	}
	job, asset := svc.voiceAssets.submit(&voiceWorkflowSubmitInput{
		Head:              req.GetHead(),
		ScenarioType:      req.GetScenarioType(),
		Spec:              req.GetSpec(),
		ModelResolved:     "speech/qwen3tts",
		Provider:          "local",
		WorkflowModelID:   resolution.WorkflowModelID,
		WorkflowFamily:    resolution.WorkflowFamily,
		OutputPersistence: resolution.OutputPersistence,
		HandlePolicyID:    resolution.HandlePolicyID,
		HandlePersistence: resolution.HandlePolicyPersistence,
		HandleScope:       resolution.HandlePolicyScope,
		HandleDefaultTTL:  resolution.HandlePolicyDefaultTTL,
		HandleDeleteSem:   resolution.HandlePolicyDeleteSemantics,
		RuntimeReconcile:  resolution.RuntimeReconciliationRequired,
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
		nimillm.MediaAdapterConfig{},
	)

	storedJob, ok := svc.voiceAssets.getJob(job.GetJobId())
	if !ok {
		t.Fatalf("expected stored job")
	}
	if got := storedJob.GetStatus(); got != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		t.Fatalf("job status = %v", got)
	}
	storedAsset, ok := svc.voiceAssets.getAsset(asset.GetVoiceAssetId())
	if !ok {
		t.Fatalf("expected stored asset")
	}
	if got := storedAsset.GetProviderVoiceRef(); got != "voice-local-qwen3-001" {
		t.Fatalf("provider voice ref = %q", got)
	}
	if got := storedAsset.GetMetadata().GetFields()["host_family"].GetStringValue(); got != "qwen3_tts" {
		t.Fatalf("host_family metadata = %q", got)
	}
	if got := storedAsset.GetMetadata().GetFields()["voice_handle_policy_delete_semantics"].GetStringValue(); got != "runtime_authoritative_delete" {
		t.Fatalf("voice_handle_policy_delete_semantics = %q", got)
	}
}

func voiceCloneRequest() *runtimev1.SubmitScenarioJobRequest {
	return &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "app-1",
			SubjectUserId: "user-1",
			ModelId:       "dashscope/qwen3-tts-vc",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_VoiceClone{VoiceClone: &runtimev1.VoiceCloneScenarioSpec{
				TargetModelId: "dashscope/qwen3-tts-vc",
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
			ModelId:       "elevenlabs/eleven_ttv_v3",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_VoiceDesign{VoiceDesign: &runtimev1.VoiceDesignScenarioSpec{
				TargetModelId: "elevenlabs/eleven_ttv_v3",
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
