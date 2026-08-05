package capabilitydriver

import (
	"net/http"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestCloudMediaDriverReasonNormalizationTables(t *testing.T) {
	cases := []struct {
		capability string
		status     int
		want       runtimev1.ReasonCode
	}{
		{"audio.synthesize", http.StatusUnauthorized, runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED},
		{"audio.synthesize", http.StatusForbidden, runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED},
		{"audio.synthesize", http.StatusTooManyRequests, runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED},
		{"audio.synthesize", http.StatusBadRequest, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED},
		{"audio.synthesize", http.StatusUnprocessableEntity, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED},
		{"audio.synthesize", http.StatusInternalServerError, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL},
		{"audio.synthesize", http.StatusServiceUnavailable, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL},
		{"audio.synthesize", http.StatusGatewayTimeout, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT},
		{"audio.synthesize", http.StatusNotFound, runtimev1.ReasonCode_AI_MODEL_NOT_FOUND},
		{"audio.synthesize", http.StatusUnsupportedMediaType, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED},
		{"audio.transcribe", http.StatusBadRequest, runtimev1.ReasonCode_AI_INPUT_INVALID},
		{"image.generate", http.StatusUnprocessableEntity, runtimev1.ReasonCode_AI_INPUT_INVALID},
		{"voice_workflow.voice_clone", http.StatusBadRequest, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID},
	}
	for _, tc := range cases {
		if got := CloudMediaReasonForHTTPStatus(tc.capability, tc.status); got != tc.want {
			t.Errorf("%s HTTP %d reason=%s, want=%s", tc.capability, tc.status, got, tc.want)
		}
	}
}

func TestCloudMediaDriverHTTPStatusOverridesGenericProviderClassification(t *testing.T) {
	driver, target := cloudMediaDriverTarget(t, "dashscope", "qwen3-tts-vc", "audio.synthesize")
	transportErr := grpcerr.WithReasonCodeOptions(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, grpcerr.ReasonOptions{
		Metadata: map[string]string{"provider_http_status": "503"},
	})
	normalized := driver.NormalizeReason(target, transportErr)
	if reason, ok := grpcerr.ExtractReasonCode(normalized); !ok || reason != runtimev1.ReasonCode_AI_PROVIDER_INTERNAL {
		t.Fatalf("503 normalized reason=%v present=%v err=%v", reason, ok, normalized)
	}
	optionAware := grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED, grpcerr.ReasonOptions{
		Metadata: map[string]string{"provider_http_status": "503"},
	})
	normalized = driver.NormalizeReason(target, optionAware)
	if reason, ok := grpcerr.ExtractReasonCode(normalized); !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
		t.Fatalf("body-aware 503 reason=%v present=%v err=%v", reason, ok, normalized)
	}

	bodyAware := grpcerr.WithReasonCodeOptions(codes.NotFound, runtimev1.ReasonCode_AI_MODEL_NOT_FOUND, grpcerr.ReasonOptions{
		Metadata: map[string]string{"provider_http_status": "400"},
	})
	normalized = driver.NormalizeReason(target, bodyAware)
	if reason, ok := grpcerr.ExtractReasonCode(normalized); !ok || reason != runtimev1.ReasonCode_AI_MODEL_NOT_FOUND {
		t.Fatalf("body-aware 400 reason=%v present=%v err=%v", reason, ok, normalized)
	}
}

func TestCloudMediaDriverMapsDefaultsAndKeepsCaptureImmutable(t *testing.T) {
	driver, target := cloudMediaDriverTarget(t, "openai", "gpt-image-1.5", "image.generate")
	request := &runtimev1.SubmitScenarioJobRequest{
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{
			Prompt: "captured image",
		}}},
	}
	defaults, _ := structpb.NewStruct(map[string]any{"size": "1024x1024", "n": 1.0, "quality": "high"})
	mapped, err := driver.MapRequest(target, request, defaults, CloudMediaStreamNone)
	if err != nil {
		t.Fatalf("MapRequest: %v", err)
	}
	request.GetSpec().GetImageGenerate().Prompt = "mutated"
	defaults.Fields["size"] = structpb.NewStringValue("1x1")
	got := mapped.Request().GetSpec().GetImageGenerate()
	if got.GetPrompt() != "captured image" || got.GetSize() != "1024x1024" || got.GetN() != 1 || got.GetQuality() != "high" {
		t.Fatalf("mapped request mutated or defaults missing: %+v", got)
	}
	if mapped.Adapter() != CloudMediaAdapterOpenAICompat {
		t.Fatalf("adapter=%q", mapped.Adapter())
	}
	unsupported, _ := structpb.NewStruct(map[string]any{"model": "must-not-be-a-default"})
	if _, err := driver.MapRequest(target, request, unsupported, CloudMediaStreamNone); err == nil {
		t.Fatal("Driver accepted model routing truth in defaults")
	}
}

func TestCloudVoiceWorkflowDriverMapsRequestAndNormalizesResponse(t *testing.T) {
	driver, target := cloudMediaDriverTarget(t, "dashscope", "qwen3-tts-vc", "voice_workflow.voice_clone")
	request := &runtimev1.SubmitScenarioJobRequest{
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VoiceClone{VoiceClone: &runtimev1.VoiceCloneScenarioSpec{
			TargetModelId: "qwen3-tts-vc",
			Input: &runtimev1.VoiceV2VInput{
				ReferenceAudioBytes: []byte("voice"), ReferenceAudioMime: "audio/wav", LanguageHints: []string{"zh"},
			},
		}}},
	}
	mapped, err := driver.MapVoiceWorkflowRequest(target, request, nil, CloudVoiceWorkflowConfig{
		WorkflowType: "voice_clone", WorkflowModelID: "qwen-voice-enrollment", CatalogModelID: "qwen3-tts-vc",
	})
	if err != nil {
		t.Fatalf("MapVoiceWorkflowRequest: %v", err)
	}
	if mapped.Provider() != "dashscope" || mapped.Adapter() != CloudMediaAdapterDashScopeVoiceWorkflow || mapped.WorkflowType() != "voice_clone" || mapped.Payload()["target_model_id"] != "qwen3-tts-vc" {
		t.Fatalf("mapped voice workflow=%+v", mapped.Payload())
	}
	metadata, _ := structpb.NewStruct(map[string]any{"provider": "dashscope"})
	result, err := driver.NormalizeVoiceWorkflowResponse(CloudVoiceWorkflowTransportResponse{
		ProviderVoiceRef: "voice-ref", Metadata: metadata,
	})
	if err != nil || result.ProviderVoiceRef != "voice-ref" || result.Metadata["provider"] != "dashscope" {
		t.Fatalf("NormalizeVoiceWorkflowResponse=%+v err=%v", result, err)
	}
}

func TestCloudVoiceDeleteDriverMapsExactDialect(t *testing.T) {
	// Lifecycle deletion reuses the exact voice-workflow AIConfig intent that
	// created the durable provider handle; it never fabricates a delete intent.
	driver, target := cloudMediaDriverTarget(t, "elevenlabs", "eleven_turbo_v2_5", "voice_workflow.voice_clone")
	mapped, err := driver.MapVoiceDeleteRequest(target, "voice-private")
	if err != nil {
		t.Fatalf("MapVoiceDeleteRequest: %v", err)
	}
	if mapped.Provider() != "elevenlabs" || mapped.Adapter() != CloudMediaAdapterElevenLabsVoiceDelete || mapped.ProviderVoiceRef() != "voice-private" {
		t.Fatalf("mapped voice delete provider=%q adapter=%q", mapped.Provider(), mapped.Adapter())
	}
	if CloudVoiceDeleteSupported("dashscope") {
		t.Fatal("DashScope unexpectedly gained a provider voice delete dialect")
	}
}

func TestCloudMediaDriverPreservesTypedStreamFailure(t *testing.T) {
	driver, _ := cloudMediaDriverTarget(t, "openai", "tts-1", "audio.synthesize")
	_, err := driver.NormalizeStreamChunk(CloudMediaStreamChunk{FailureReason: runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED})
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED {
		t.Fatalf("stream failure reason=%v ok=%v err=%v", reason, ok, err)
	}
}

func TestCloudMediaDriverRejectsRegistryCapabilityWithoutImplementedDialect(t *testing.T) {
	registry := NewProductionCloudMediaRegistry()
	target, _ := structpb.NewStruct(map[string]any{
		"provider": "elevenlabs", "providerModelId": "scribe_v1", "remoteModelCatalogId": "catalog-scribe-v1",
	})
	if _, _, err := registry.Resolve(Identity{ImplementationID: "cloud.stt.elevenlabs", DriverID: "driver.elevenlabs", DriverDialect: "elevenlabs/stt/v1"}, target, "audio.transcribe"); err == nil {
		t.Fatal("Driver admitted ElevenLabs STT without an implemented transport dialect")
	}
}

func TestCloudMediaDriverRejectsUncustodiedRemoteArtifact(t *testing.T) {
	driver, _ := cloudMediaDriverTarget(t, "openai", "gpt-image-1.5", "image.generate")
	_, err := driver.NormalizeResponse(CloudMediaTransportResponse{Artifacts: []*runtimev1.ScenarioArtifact{{
		ArtifactId: "remote-only", MimeType: "image/png", Uri: "https://provider.invalid/image.png",
	}}})
	if err == nil {
		t.Fatal("Driver accepted a remote URI without Runtime-owned bytes")
	}
}

func TestCloudMediaDriverHidesProviderURLsAndPollingMetadata(t *testing.T) {
	driver, _ := cloudMediaDriverTarget(t, "openai", "gpt-image-1.5", "image.generate")
	metadata, _ := structpb.NewStruct(map[string]any{
		"provider_job_id": "provider-job", "uri": "https://provider.invalid/image.png", "adapter": "openai_compat",
		"response": map[string]any{"task_id": "provider-task", "status": "done"},
	})
	result, err := driver.NormalizeResponse(CloudMediaTransportResponse{Artifacts: []*runtimev1.ScenarioArtifact{{
		ArtifactId: "runtime-artifact", MimeType: "image/png", Bytes: []byte("owned"), Uri: "https://provider.invalid/image.png", Metadata: metadata,
	}}})
	if err != nil {
		t.Fatalf("NormalizeResponse: %v", err)
	}
	artifact := result.Artifacts[0]
	if artifact.GetUri() != "" {
		t.Fatalf("provider URI escaped Driver: %q", artifact.GetUri())
	}
	values := artifact.GetMetadata().AsMap()
	if _, ok := values["provider_job_id"]; ok {
		t.Fatalf("provider polling id escaped Driver: %+v", values)
	}
	if _, ok := values["response"]; ok {
		t.Fatalf("provider response envelope escaped Driver: %+v", values)
	}
	if values["adapter"] != "openai_compat" {
		t.Fatalf("safe dialect metadata was not preserved: %+v", values)
	}
}

func cloudMediaDriverTarget(t *testing.T, provider string, model string, capability string) (CloudMediaDriver, CloudMediaTarget) {
	t.Helper()
	raw, _ := structpb.NewStruct(map[string]any{
		"provider": provider, "providerModelId": model, "remoteModelCatalogId": "catalog-" + model,
	})
	driver, target, err := NewProductionCloudMediaRegistry().Resolve(Identity{
		ImplementationID: "cloud." + capability + "." + provider,
		DriverID:         "nimi.runtime.driver." + provider,
		DriverDialect:    "provider/media-v1",
	}, raw, capability)
	if err != nil {
		t.Fatalf("Resolve(%s/%s): %v", provider, capability, err)
	}
	return driver, target
}
