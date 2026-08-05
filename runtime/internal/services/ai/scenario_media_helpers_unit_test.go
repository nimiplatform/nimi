package ai

import (
	"context"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	catalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func baseScenarioJobRequest() *runtimev1.SubmitScenarioJobRequest {
	return &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-1",
			ModelId:       "local/qwen",
			TargetRef:     localScenarioTargetRefForModel("local/qwen"),
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		},
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
	}
}

func TestScenarioModalFromType(t *testing.T) {
	cases := map[runtimev1.ScenarioType]runtimev1.Modal{
		runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE:    runtimev1.Modal_MODAL_IMAGE,
		runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE:    runtimev1.Modal_MODAL_VIDEO,
		runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE: runtimev1.Modal_MODAL_TTS,
		runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE: runtimev1.Modal_MODAL_STT,
		runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE:       runtimev1.Modal_MODAL_TTS,
		runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN:      runtimev1.Modal_MODAL_TTS,
		runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE:     runtimev1.Modal_MODAL_UNSPECIFIED,
	}
	for in, expect := range cases {
		if got := scenarioModalFromType(in); got != expect {
			t.Fatalf("scenario modal mismatch for %v: got=%v want=%v", in, got, expect)
		}
	}
}

func TestSanitizeScenarioJobReasonDetail_DropsProviderBodyForUnavailable(t *testing.T) {
	const providerMarker = "provider-body-marker"
	err := grpcerr.WithReasonCodeOptions(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, grpcerr.ReasonOptions{
		Message: "provider request failed",
		Metadata: map[string]string{
			"provider_message": providerMarker,
		},
	})
	if got := sanitizeScenarioJobReasonDetail(err, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE); got == "" || strings.Contains(got, providerMarker) {
		t.Fatalf("provider body leaked through stable reason detail: %q", got)
	}
}

func TestSanitizeScenarioJobReasonDetail_LocalSpeechReasonsIgnoreTransportText(t *testing.T) {
	const transportDetail = "legacy failure"
	for _, reasonCode := range []runtimev1.ReasonCode{
		runtimev1.ReasonCode_AI_LOCAL_SPEECH_DOWNLOAD_CONFIRMATION_REQUIRED,
		runtimev1.ReasonCode_AI_LOCAL_SPEECH_BUNDLE_DEGRADED,
	} {
		got := sanitizeScenarioJobReasonDetail(status.Error(codes.FailedPrecondition, transportDetail), reasonCode)
		if got == "" || strings.Contains(got, transportDetail) {
			t.Fatalf("transport text leaked for structured reason %v: %q", reasonCode, got)
		}
	}
}

func TestScenarioJobReasonMetadata_DropsProviderBodyWithoutStructuredRecoveryMetadata(t *testing.T) {
	err := grpcerr.WithReasonCodeOptions(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, grpcerr.ReasonOptions{
		Message: "provider request failed",
		Metadata: map[string]string{
			"provider_message": "provider-body-marker",
		},
	})
	out := scenarioJobReasonMetadata(err, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	if out == nil {
		t.Fatal("expected structured recovery metadata")
	}
	values := out.AsMap()
	if got := values["action_hint"]; got != "inspect_reason_code_and_retry_with_corrected_request" {
		t.Fatalf("unexpected action_hint: %#v", got)
	}
	if _, exists := values["retryable"]; exists {
		t.Fatalf("unexpected retryable metadata: %#v", values)
	}
	if _, exists := values["provider_message"]; exists {
		t.Fatalf("provider body must not be projected into scenario job metadata: %#v", values)
	}
}

func TestScenarioJobReasonMetadata_DropsProviderBodyForRateLimited(t *testing.T) {
	const providerMarker = "provider-body-marker"
	err := grpcerr.WithReasonCodeOptions(codes.ResourceExhausted, runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED, grpcerr.ReasonOptions{
		Message: "provider task failed",
		Metadata: map[string]string{
			"provider_message": providerMarker,
		},
	})
	if got := sanitizeScenarioJobReasonDetail(err, runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED); got == "" || strings.Contains(got, providerMarker) {
		t.Fatalf("provider body leaked through stable reason detail: %q", got)
	}
	out := scenarioJobReasonMetadata(err, runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED)
	if out == nil {
		t.Fatal("expected structured recovery metadata")
	}
	values := out.AsMap()
	if got := values["action_hint"]; got != "inspect_reason_code_and_retry_with_corrected_request" {
		t.Fatalf("unexpected action_hint: %#v", got)
	}
	if _, exists := values["retryable"]; exists {
		t.Fatalf("unexpected retryable metadata: %#v", values)
	}
	if _, exists := values["provider_message"]; exists {
		t.Fatalf("provider body must not be projected into scenario job metadata: %#v", values)
	}
}

func TestScenarioJobReasonMetadata_DropsCredentialBearingProviderMessage(t *testing.T) {
	const secret = "provider-secret-value"
	err := grpcerr.WithReasonCodeOptions(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, grpcerr.ReasonOptions{
		ActionHint: "check_provider_endpoint",
		Message:    "provider request failed",
		Metadata: map[string]string{
			"provider_message": "https://provider.invalid/v1?api_key=" + secret,
		},
	})
	out := scenarioJobReasonMetadata(err, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	if out == nil {
		t.Fatal("expected safe structured recovery metadata")
	}
	values := out.AsMap()
	if _, exists := values["provider_message"]; exists {
		t.Fatalf("credential-bearing provider_message must be dropped: %#v", values)
	}
	if got := values["action_hint"]; got != "check_provider_endpoint" {
		t.Fatalf("expected safe action_hint, got %#v", got)
	}
}

func TestValidateSubmitScenarioAsyncJobRequest(t *testing.T) {
	t.Run("image valid", func(t *testing.T) {
		req := baseScenarioJobRequest()
		req.ScenarioType = runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE
		req.Spec = &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{Prompt: "cat", N: 1}}}
		if err := validateSubmitScenarioAsyncJobRequest(req); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
	})

	t.Run("image invalid n", func(t *testing.T) {
		req := baseScenarioJobRequest()
		req.ScenarioType = runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE
		req.Spec = &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{Prompt: "cat", N: 99}}}
		err := validateSubmitScenarioAsyncJobRequest(req)
		reason, _ := grpcerr.ExtractReasonCode(err)
		if reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
			t.Fatalf("unexpected reason: %v", reason)
		}
	})

	t.Run("video valid t2v", func(t *testing.T) {
		req := baseScenarioJobRequest()
		req.ScenarioType = runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE
		req.Spec = &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VideoGenerate{VideoGenerate: &runtimev1.VideoGenerateScenarioSpec{
			Mode:    runtimev1.VideoMode_VIDEO_MODE_T2V,
			Content: []*runtimev1.VideoContentItem{{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT, Text: "a running cat"}},
			Options: &runtimev1.VideoGenerationOptions{DurationSec: 4, Ratio: "16:9"},
		}}}
		if err := validateSubmitScenarioAsyncJobRequest(req); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
	})

	t.Run("video valid multimodal reference inputs", func(t *testing.T) {
		req := baseScenarioJobRequest()
		req.ScenarioType = runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE
		req.Spec = &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VideoGenerate{VideoGenerate: &runtimev1.VideoGenerateScenarioSpec{
			Mode: runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE,
			Content: []*runtimev1.VideoContentItem{
				{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT, Text: "fruit tea"},
				{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_IMAGE_URL, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_IMAGE, ImageUrl: &runtimev1.VideoContentImageURL{Url: "https://example.com/ref.png"}},
				{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_VIDEO_URL, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_VIDEO, VideoUrl: &runtimev1.VideoContentVideoURL{Url: "https://example.com/ref.mp4"}},
				{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_AUDIO_URL, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_AUDIO, AudioUrl: &runtimev1.VideoContentAudioURL{Url: "https://example.com/ref.mp3"}},
			},
			Options: &runtimev1.VideoGenerationOptions{DurationSec: 11, Ratio: "16:9"},
		}}}
		if err := validateSubmitScenarioAsyncJobRequest(req); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
	})

	t.Run("video invalid mode", func(t *testing.T) {
		spec := &runtimev1.VideoGenerateScenarioSpec{Mode: runtimev1.VideoMode_VIDEO_MODE_UNSPECIFIED}
		err := validateVideoGenerateScenarioSpec(spec)
		reason, _ := grpcerr.ExtractReasonCode(err)
		if reason != runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID {
			t.Fatalf("unexpected reason: %v", reason)
		}
	})

	t.Run("stt valid bytes source", func(t *testing.T) {
		req := baseScenarioJobRequest()
		req.ScenarioType = runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE
		req.Spec = &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechTranscribe{SpeechTranscribe: &runtimev1.SpeechTranscribeScenarioSpec{
			AudioSource: &runtimev1.SpeechTranscriptionAudioSource{Source: &runtimev1.SpeechTranscriptionAudioSource_AudioBytes{AudioBytes: []byte("abc")}},
		}}}
		if err := validateSubmitScenarioAsyncJobRequest(req); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
	})

	t.Run("stt invalid speaker count", func(t *testing.T) {
		req := baseScenarioJobRequest()
		req.ScenarioType = runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE
		req.Spec = &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechTranscribe{SpeechTranscribe: &runtimev1.SpeechTranscribeScenarioSpec{
			SpeakerCount: 100,
			AudioSource:  &runtimev1.SpeechTranscriptionAudioSource{Source: &runtimev1.SpeechTranscriptionAudioSource_AudioUri{AudioUri: "https://example.com/a.wav"}},
		}}}
		err := validateSubmitScenarioAsyncJobRequest(req)
		reason, _ := grpcerr.ExtractReasonCode(err)
		if reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
			t.Fatalf("unexpected reason: %v", reason)
		}
	})

	t.Run("local text requires input", func(t *testing.T) {
		req := baseScenarioJobRequest()
		req.ScenarioType = runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE
		req.Spec = &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_TextGenerate{TextGenerate: &runtimev1.TextGenerateScenarioSpec{}}}
		err := validateSubmitScenarioAsyncJobRequest(req)
		reason, _ := grpcerr.ExtractReasonCode(err)
		if reason != runtimev1.ReasonCode_AI_INPUT_INVALID {
			t.Fatalf("unexpected reason: %v", reason)
		}
	})
}

func TestTranscriptionAudioSourceHelpers(t *testing.T) {
	if hasTranscriptionAudioSource(nil) {
		t.Fatalf("nil spec should be false")
	}
	if !hasTranscriptionAudioSource(&runtimev1.SpeechTranscribeScenarioSpec{
		AudioSource: &runtimev1.SpeechTranscriptionAudioSource{Source: &runtimev1.SpeechTranscriptionAudioSource_AudioUri{AudioUri: "https://example.com/a.wav"}},
	}) {
		t.Fatalf("uri source should be true")
	}
	if !hasTranscriptionAudioSource(&runtimev1.SpeechTranscribeScenarioSpec{
		AudioSource: &runtimev1.SpeechTranscriptionAudioSource{Source: &runtimev1.SpeechTranscriptionAudioSource_AudioChunks{AudioChunks: &runtimev1.AudioChunks{Chunks: [][]byte{{}, {1}}}}},
	}) {
		t.Fatalf("chunk source should be true when any chunk non-empty")
	}
}

func TestScenarioJobIdempotencyAndTimeoutHelpers(t *testing.T) {
	req := baseScenarioJobRequest()
	req.IdempotencyKey = "idem-1"
	req.ScenarioType = runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE
	req.Spec = &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{Prompt: "p"}}}

	scope1, err := buildScenarioJobIdempotencyScope(req)
	if err != nil || scope1 == "" {
		t.Fatalf("expected non-empty scope, err=%v scope=%q", err, scope1)
	}
	scope2, err := buildScenarioJobIdempotencyScope(req)
	if err != nil || scope2 != scope1 {
		t.Fatalf("idempotency scope should be stable: %q vs %q err=%v", scope1, scope2, err)
	}

	hash, err := hashSubmitScenarioSpec(req)
	if err != nil || hash == "" {
		t.Fatalf("hash should be non-empty, err=%v", err)
	}

	if defaultScenarioJobTimeout(runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE) != defaultGenerateImageTimeout {
		t.Fatalf("unexpected image timeout")
	}
	if defaultScenarioJobTimeout(runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE) != defaultGenerateVideoTimeout {
		t.Fatalf("unexpected video timeout")
	}
	if defaultScenarioJobTimeout(runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE) != defaultSynthesizeTimeout {
		t.Fatalf("unexpected synth timeout")
	}
	if defaultScenarioJobTimeout(runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE) != defaultTranscribeTimeout {
		t.Fatalf("unexpected transcribe timeout")
	}
	if defaultScenarioJobTimeout(runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE) != defaultGenerateTimeout {
		t.Fatalf("unexpected default timeout")
	}
}

func TestMediaRoutingHelpers(t *testing.T) {
	if got := resolveMediaAdapterName("", "", runtimev1.Modal_MODAL_VIDEO, "volcengine"); got != adapterBytedanceARKTask {
		t.Fatalf("unexpected adapter: %s", got)
	}
	if got := resolveMediaAdapterName("", "", runtimev1.Modal_MODAL_TTS, "dashscope"); got != adapterAlibabaNative {
		t.Fatalf("unexpected adapter: %s", got)
	}
	if got := resolveMediaAdapterName("", "", runtimev1.Modal_MODAL_STT, "dashscope"); got != adapterDashScopeChatSTT {
		t.Fatalf("unexpected dashscope stt adapter: %s", got)
	}
	if got := resolveMediaAdapterName("", "", runtimev1.Modal_MODAL_STT, "gemini"); got != adapterGeminiChatSTT {
		t.Fatalf("unexpected gemini stt adapter: %s", got)
	}
	if got := resolveMediaAdapterName("", "", runtimev1.Modal_MODAL_STT, "glm"); got != adapterGLMNative {
		t.Fatalf("unexpected glm stt adapter: %s", got)
	}
	if got := resolveMediaAdapterName("", "", runtimev1.Modal_MODAL_STT, "openai"); got != adapterOpenAICompat {
		t.Fatalf("unexpected openai stt adapter: %s", got)
	}
	if got := resolveMediaAdapterName("", "", runtimev1.Modal_MODAL_MUSIC, "stability"); got != adapterStabilityMusic {
		t.Fatalf("unexpected stability music adapter: %s", got)
	}
	if got := resolveMediaAdapterName("", "", runtimev1.Modal_MODAL_MUSIC, "soundverse"); got != adapterSoundverseMusic {
		t.Fatalf("unexpected soundverse music adapter: %s", got)
	}
	if got := resolveMediaAdapterName("", "", runtimev1.Modal_MODAL_MUSIC, "mubert"); got != adapterMubertMusic {
		t.Fatalf("unexpected mubert music adapter: %s", got)
	}
	if got := resolveMediaAdapterName("", "", runtimev1.Modal_MODAL_MUSIC, "loudly"); got != adapterLoudlyMusic {
		t.Fatalf("unexpected loudly music adapter: %s", got)
	}
	if got := resolveMediaAdapterName("", "", runtimev1.Modal_MODAL_STT, "groq"); got != adapterOpenAICompat {
		t.Fatalf("unexpected groq stt adapter: %s", got)
	}
	if got := resolveMediaAdapterName("flux.1-schnell", "", runtimev1.Modal_MODAL_IMAGE, "media"); got != adapterMediaNative {
		t.Fatalf("unexpected media provider adapter: %s", got)
	}
	if got := resolveMediaAdapterName("ace-step-local", "", runtimev1.Modal_MODAL_MUSIC, "sidecar"); got != adapterSidecarMusic {
		t.Fatalf("unexpected sidecar music adapter: %s", got)
	}
	if got := resolveMediaAdapterName("sidecar/stable-audio-open-sidecar", "", runtimev1.Modal_MODAL_MUSIC, "sidecar"); got != adapterSidecarMusic {
		t.Fatalf("unexpected sidecar music adapter: %s", got)
	}
	if got := resolveMediaAdapterName("speech/qwen3-tts-30b", "", runtimev1.Modal_MODAL_TTS, ""); got != adapterSpeechNative {
		t.Fatalf("unexpected speech tts adapter: %s", got)
	}
	if got := resolveMediaAdapterName("", "kimi/k1", runtimev1.Modal_MODAL_IMAGE, ""); got != adapterKimiChatMultimodal {
		t.Fatalf("unexpected adapter: %s", got)
	}
	// Gemini model name heuristic: gemini-* models should use native adapter even
	// when the connector providerType is not set to "gemini".
	if got := resolveMediaAdapterName("gemini-3.1-flash-image-preview", "gemini-3.1-flash-image-preview", runtimev1.Modal_MODAL_IMAGE, ""); got != adapterGeminiOperation {
		t.Fatalf("unexpected adapter for gemini model with empty providerType: %s", got)
	}
	if got := resolveMediaAdapterName("gemini-3.1-flash-image-preview", "gemini-3.1-flash-image-preview", runtimev1.Modal_MODAL_IMAGE, "openai"); got != adapterGeminiOperation {
		t.Fatalf("unexpected adapter for gemini model with openai providerType: %s", got)
	}

	if got := inferMediaProviderTypeFromBackendName(nil); got != "" {
		t.Fatalf("nil backend should infer empty provider")
	}
	if got := inferMediaProviderTypeFromBackendName(&nimillm.Backend{Name: "cloud-openai"}); got != "openai" {
		t.Fatalf("unexpected cloud provider type: %q", got)
	}
	if got := stringSliceToAny([]string{"  a ", "", "b"}); len(got) != 2 {
		t.Fatalf("unexpected trimmed slice length: %d", len(got))
	}
	if got := stringSliceToAny([]string{"", "  "}); got != nil {
		t.Fatalf("expected nil for empty trimmed values")
	}

	if got := normalizeComparableModelID("models/ABC"); got != "abc" {
		t.Fatalf("unexpected comparable model id: %q", got)
	}
	if got := modelIDBase("gpt-4o@2024-11-01"); got != "gpt-4o" {
		t.Fatalf("unexpected model base: %q", got)
	}
	if got := modelIDBase("plain-model"); got != "plain-model" {
		t.Fatalf("unexpected plain model base: %q", got)
	}
	if !supportsTTSCapability([]string{"text.generate", "audio.synthesize"}) {
		t.Fatalf("tts capability should be detected from audio.synthesize")
	}
	if supportsTTSCapability([]string{"text.generate", "image.generate"}) {
		t.Fatalf("tts capability should be false for non-tts capabilities")
	}

	models := []nimillm.ProbeModel{
		{ModelID: "models/gpt-4o"},
		{ModelID: "gpt-4o-mini@latest"},
	}
	if resolved, ok := findProbeModelID(models, "gpt-4o"); !ok || resolved != "models/gpt-4o" {
		t.Fatalf("findProbeModelID exact comparable mismatch: ok=%v resolved=%q", ok, resolved)
	}
	if resolved, ok := findProbeModelID(models, "gpt-4o-mini"); !ok || resolved != "gpt-4o-mini@latest" {
		t.Fatalf("findProbeModelID base fallback mismatch: ok=%v resolved=%q", ok, resolved)
	}
	voiceCatalog, err := catalog.NewResolver(catalog.ResolverConfig{})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}
	if resolved, ok := resolveConnectorTTSModelID(models, "qwen3-tts-instruct-flash", "dashscope", voiceCatalog); !ok || resolved != "qwen3-tts-instruct-flash" {
		t.Fatalf("resolveConnectorTTSModelID catalog fallback mismatch: ok=%v resolved=%q", ok, resolved)
	}
	if resolved, ok := resolveConnectorTTSModelID(models, "qwen3-tts-non-existent", "dashscope", voiceCatalog); ok || resolved != "" {
		t.Fatalf("resolveConnectorTTSModelID should reject missing catalog model: ok=%v resolved=%q", ok, resolved)
	}

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"gemini": {BaseURL: "https://example.test/v1", APIKey: "k"},
		},
	})
	cfg := svc.resolveNativeAdapterConfig("gemini", nil)
	if cfg.BaseURL == "" {
		t.Fatalf("resolveNativeAdapterConfig should fallback to configured base url")
	}
	cfg = svc.resolveNativeAdapterConfig("gemini", &nimillm.RemoteTarget{Endpoint: "https://remote.test/v1", APIKey: "remote-key"})
	if cfg.BaseURL != "https://remote.test/v1" || cfg.APIKey != "remote-key" {
		t.Fatalf("resolveNativeAdapterConfig should prefer remote target: %#v", cfg)
	}

	jobID := "poll-state-job"
	svc.scenarioJobs.create(&runtimev1.ScenarioJob{
		JobId:        jobID,
		Head:         &runtimev1.ScenarioRequestHead{AppId: "app", SubjectUserId: "user", ModelId: "local/qwen", RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		Status:       runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING,
		CreatedAt:    timestamppb.Now(),
		UpdatedAt:    timestamppb.Now(),
		TraceId:      "trace-poll",
	}, func() {})
	next := timestamppb.Now()
	svc.UpdatePollState(jobID, "provider-job", 3, next, "last-error")
	updated, ok := svc.scenarioJobs.get(jobID)
	if !ok {
		t.Fatalf("expected poll-updated scenario job")
	}
	if updated.GetProviderJobId() != "provider-job" || updated.GetRetryCount() != 3 || updated.GetReasonDetail() != "last-error" {
		t.Fatalf("unexpected poll state update: %#v", updated)
	}

	req := baseScenarioJobRequest()
	req.ScenarioType = runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE
	req.Extensions = []*runtimev1.ScenarioExtension{
		{
			Namespace: "nimi.scenario.image.request",
			Payload: mustStructPB(t, map[string]any{
				"quality_hint": "high",
			}),
		},
	}
	extracted := extractScenarioExtensions(req)
	if extracted == nil {
		t.Fatalf("extractScenarioExtensions should return the scenario namespace payload")
	}
	if got := extracted.GetFields()["quality_hint"].GetStringValue(); got != "high" {
		t.Fatalf("unexpected extracted extension payload: %q", got)
	}
}

func TestReasonCodeFromMediaErrorAndVoiceRef(t *testing.T) {
	if got := reasonCodeFromMediaError(nil); got != runtimev1.ReasonCode_ACTION_EXECUTED {
		t.Fatalf("unexpected nil-error reason: %v", got)
	}
	if got := reasonCodeFromMediaError(grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_MODEL_NOT_FOUND)); got != runtimev1.ReasonCode_AI_MODEL_NOT_FOUND {
		t.Fatalf("unexpected grpcerr reason: %v", got)
	}
	if got := reasonCodeFromMediaError(status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED.String())); got != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
		t.Fatalf("unexpected message-mapped reason: %v", got)
	}
	if got := reasonCodeFromMediaError(status.Error(codes.DeadlineExceeded, "timeout")); got != runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT {
		t.Fatalf("unexpected deadline reason: %v", got)
	}
	if got := reasonCodeFromMediaError(status.Error(codes.ResourceExhausted, "balance")); got != runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED {
		t.Fatalf("unexpected resource exhausted reason: %v", got)
	}
	if got := reasonCodeFromMediaError(status.Error(codes.Canceled, "cancel")); got != runtimev1.ReasonCode_ACTION_EXECUTED {
		t.Fatalf("unexpected canceled reason: %v", got)
	}
	const credentialMarker = "provider-secret-marker"
	if got := sanitizeScenarioJobReasonDetail(status.Error(codes.InvalidArgument, "https://secret.invalid/path?api_key="+credentialMarker), runtimev1.ReasonCode_AI_INPUT_INVALID); got == "" || strings.Contains(got, credentialMarker) {
		t.Fatalf("credential marker leaked through reason detail: %q", got)
	}
	const providerMarker = "provider-rate-marker"
	if got := sanitizeScenarioJobReasonDetail(status.Error(codes.ResourceExhausted, providerMarker), runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED); got == "" || strings.Contains(got, providerMarker) {
		t.Fatalf("provider marker leaked through rate-limit reason detail: %q", got)
	}

	spec := &runtimev1.SpeechSynthesizeScenarioSpec{VoiceRef: &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PROVIDER_VOICE_REF, Reference: &runtimev1.VoiceReference_ProviderVoiceRef{ProviderVoiceRef: "voice-1"}}}
	if got := resolveScenarioVoiceRef(spec); got != "voice-1" {
		t.Fatalf("unexpected provider voice ref: %q", got)
	}
	spec.VoiceRef = &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET, Reference: &runtimev1.VoiceReference_PresetVoiceId{PresetVoiceId: "preset-1"}}
	if got := resolveScenarioVoiceRef(spec); got != "preset-1" {
		t.Fatalf("unexpected preset voice ref: %q", got)
	}
	spec.VoiceRef = &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_VOICE_ASSET, Reference: &runtimev1.VoiceReference_VoiceAssetId{VoiceAssetId: "asset-1"}}
	if got := resolveScenarioVoiceRef(spec); got != "asset-1" {
		t.Fatalf("unexpected asset voice ref: %q", got)
	}
	if got := resolveScenarioVoiceRef(nil); got != "" {
		t.Fatalf("nil spec should resolve empty voice ref")
	}
}

func TestResolveSynthesizeSpeechSpecVoiceRefRejectsExpiredVoiceAsset(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{})
	const assetID = "voice-asset-expired"
	svc.voiceAssets.assets[assetID] = &runtimev1.VoiceAsset{
		VoiceAssetId:     assetID,
		AppId:            "nimi.desktop",
		SubjectUserId:    "user-1",
		Provider:         "dashscope",
		TargetModelId:    "dashscope/qwen3-tts-vc",
		ProviderVoiceRef: "dashscope-provider-voice-ref",
		Persistence:      runtimev1.VoiceAssetPersistence_VOICE_ASSET_PERSISTENCE_PROVIDER_PERSISTENT,
		Status:           runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_EXPIRED,
	}

	_, err := svc.resolveSynthesizeSpeechSpecVoiceRef(context.Background(), &runtimev1.ScenarioRequestHead{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-1",
	}, "dashscope/qwen3-tts-vc", &runtimev1.SpeechSynthesizeScenarioSpec{
		Text: "should not synthesize with expired voice asset",
		VoiceRef: &runtimev1.VoiceReference{
			Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_VOICE_ASSET,
			Reference: &runtimev1.VoiceReference_VoiceAssetId{
				VoiceAssetId: assetID,
			},
		},
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expired voice asset resolve code=%v err=%v, want InvalidArgument", status.Code(err), err)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID {
		t.Fatalf("expired voice asset reason=%v ok=%v err=%v, want AI_VOICE_INPUT_INVALID", reason, ok, err)
	}
}

func init() {
	// Compile-time guard for timeout constants to ensure tests cover helper defaults.
	_ = []time.Duration{defaultGenerateTimeout, defaultGenerateImageTimeout, defaultGenerateVideoTimeout, defaultSynthesizeTimeout, defaultTranscribeTimeout}
}

func mustStructPB(t *testing.T, values map[string]any) *structpb.Struct {
	t.Helper()
	out, err := structpb.NewStruct(values)
	if err != nil {
		t.Fatalf("structpb.NewStruct: %v", err)
	}
	return out
}
