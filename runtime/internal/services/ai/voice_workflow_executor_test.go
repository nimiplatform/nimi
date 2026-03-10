package ai

import (
	"context"
	"encoding/json"
	"io"
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

func TestVoiceWorkflowViaNimillmCloneSuccess(t *testing.T) {
	providers := []string{"dashscope"}
	for _, provider := range providers {
		provider := provider
		t.Run(provider, func(t *testing.T) {
			t.Parallel()
			requestPaths := make([]string, 0, 2)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodPost {
					t.Fatalf("expected POST, got %s", r.Method)
				}
				requestPaths = append(requestPaths, r.URL.Path)
				if got := strings.TrimSpace(r.Header.Get("Authorization")); got == "" {
					t.Fatalf("authorization header must be set")
				}
				w.Header().Set("Content-Type", "application/json")
				_, _ = io.WriteString(w, `{"voice_id":"voice-123","job_id":"job-123"}`)
			}))
			defer server.Close()

			result, err := executeVoiceWorkflowViaNimillm(
				context.Background(),
				provider,
				voiceCloneRequest(),
				catalog.ResolveVoiceWorkflowResult{
					Provider:        provider,
					ModelID:         provider + "/model-a",
					WorkflowType:    "tts_v2v",
					WorkflowModelID: provider + "-wf-clone",
				},
				nimillm.MediaAdapterConfig{BaseURL: server.URL, APIKey: "test-key"},
			)
			if err != nil {
				t.Fatalf("Execute clone workflow: %v", err)
			}
			if strings.TrimSpace(result.ProviderVoiceRef) == "" {
				t.Fatalf("provider voice ref must be set")
			}
			if strings.TrimSpace(result.ProviderJobID) == "" {
				t.Fatalf("provider job id must be set")
			}
			if len(requestPaths) == 0 {
				t.Fatalf("expected at least one provider request")
			}
		})
	}
}

func TestStepFunVoiceCloneWorkflowSuccess(t *testing.T) {
	requestPaths := make([]string, 0, 2)
	requestBodies := make([]map[string]any, 0, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestPaths = append(requestPaths, r.URL.Path)
		if got := strings.TrimSpace(r.Header.Get("Authorization")); got != "Bearer test-key" {
			t.Fatalf("expected Authorization header, got=%q", got)
		}
		switch r.URL.Path {
		case "/files":
			if !strings.HasPrefix(strings.TrimSpace(r.Header.Get("Content-Type")), "multipart/form-data;") {
				t.Fatalf("expected multipart upload request, got content-type=%q", r.Header.Get("Content-Type"))
			}
			if err := r.ParseMultipartForm(1 << 20); err != nil {
				t.Fatalf("ParseMultipartForm(upload): %v", err)
			}
			if got := strings.TrimSpace(r.FormValue("purpose")); got != "storage" {
				t.Fatalf("unexpected upload purpose: %q", got)
			}
			file, header, err := r.FormFile("file")
			if err != nil {
				t.Fatalf("FormFile(file): %v", err)
			}
			defer file.Close()
			payload, err := io.ReadAll(file)
			if err != nil {
				t.Fatalf("ReadAll(file): %v", err)
			}
			if string(payload) != "voice-audio" {
				t.Fatalf("unexpected uploaded audio payload: %q", string(payload))
			}
			if header == nil || strings.TrimSpace(header.Filename) == "" {
				t.Fatalf("expected uploaded filename")
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"id":"file-stepfun-001","object":"file"}`)
		case "/audio/voices":
			if got := strings.TrimSpace(r.Header.Get("Content-Type")); got != "application/json" {
				t.Fatalf("expected application/json create request, got content-type=%q", got)
			}
			rawBody, err := io.ReadAll(r.Body)
			if err != nil {
				t.Fatalf("ReadAll(body): %v", err)
			}
			body := map[string]any{}
			if err := json.Unmarshal(rawBody, &body); err != nil {
				t.Fatalf("Unmarshal(body): %v", err)
			}
			requestBodies = append(requestBodies, body)
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"id":"voice-stepfun-001","object":"audio.voice"}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	req := voiceCloneRequest()
	req.Head.ModelId = "stepfun/step-tts-2"
	req.Spec.GetVoiceClone().TargetModelId = "stepfun/step-tts-2"
	req.Spec.GetVoiceClone().Input.ReferenceAudioBytes = []byte("voice-audio")
	req.Spec.GetVoiceClone().Input.ReferenceAudioMime = "audio/wav"
	req.Spec.GetVoiceClone().Input.ReferenceAudioUri = ""
	req.Spec.GetVoiceClone().Input.Text = "Hello from the source clip."

	result, err := executeVoiceWorkflowViaNimillm(
		context.Background(),
		"stepfun",
		req,
		catalog.ResolveVoiceWorkflowResult{
			Provider:        "stepfun",
			ModelID:         "stepfun/step-tts-2",
			WorkflowType:    "tts_v2v",
			WorkflowModelID: "stepfun-voice-clone",
		},
		nimillm.MediaAdapterConfig{BaseURL: server.URL, APIKey: "test-key"},
	)
	if err != nil {
		t.Fatalf("Execute StepFun clone workflow: %v", err)
	}
	if got := strings.TrimSpace(result.ProviderVoiceRef); got != "voice-stepfun-001" {
		t.Fatalf("unexpected provider voice ref: %q", got)
	}
	if len(requestPaths) != 2 || requestPaths[0] != "/files" || requestPaths[1] != "/audio/voices" {
		t.Fatalf("unexpected request paths: %v", requestPaths)
	}
	if len(requestBodies) != 1 {
		t.Fatalf("expected one create voice request body, got=%d", len(requestBodies))
	}
	if got := strings.TrimSpace(nimillm.ValueAsString(requestBodies[0]["model"])); got != "step-tts-2" {
		t.Fatalf("unexpected StepFun model: %q", got)
	}
	if got := strings.TrimSpace(nimillm.ValueAsString(requestBodies[0]["file_id"])); got != "file-stepfun-001" {
		t.Fatalf("unexpected StepFun file_id: %q", got)
	}
	if got := strings.TrimSpace(nimillm.ValueAsString(requestBodies[0]["text"])); got != "Hello from the source clip." {
		t.Fatalf("unexpected StepFun transcript text: %q", got)
	}
}

func TestStepFunVoiceCloneWorkflowRequiresText(t *testing.T) {
	req := voiceCloneRequest()
	req.Head.ModelId = "stepfun/step-tts-2"
	req.Spec.GetVoiceClone().TargetModelId = "stepfun/step-tts-2"
	req.Spec.GetVoiceClone().Input.Text = ""

	_, err := executeVoiceWorkflowViaNimillm(
		context.Background(),
		"stepfun",
		req,
		catalog.ResolveVoiceWorkflowResult{
			Provider:        "stepfun",
			ModelID:         "stepfun/step-tts-2",
			WorkflowType:    "tts_v2v",
			WorkflowModelID: "stepfun-voice-clone",
		},
		nimillm.MediaAdapterConfig{BaseURL: "https://example.invalid", APIKey: "test-key"},
	)
	if err == nil {
		t.Fatalf("expected StepFun missing transcript rejection")
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID {
		t.Fatalf("expected AI_VOICE_INPUT_INVALID, got reason=%v ok=%v err=%v", reason, ok, err)
	}
}

func TestFishAudioVoiceCloneWorkflowSuccess(t *testing.T) {
	var requestPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestPath = r.URL.Path
		if got := strings.TrimSpace(r.Header.Get("Authorization")); got != "Bearer test-key" {
			t.Fatalf("expected Authorization header, got=%q", got)
		}
		if !strings.HasPrefix(strings.TrimSpace(r.Header.Get("Content-Type")), "multipart/form-data;") {
			t.Fatalf("expected multipart form request, got content-type=%q", r.Header.Get("Content-Type"))
		}
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			t.Fatalf("ParseMultipartForm: %v", err)
		}
		if got := strings.TrimSpace(r.FormValue("title")); got != "test-clone-voice" {
			t.Fatalf("unexpected title: %q", got)
		}
		file, header, err := r.FormFile("voices")
		if err != nil {
			t.Fatalf("FormFile(voices): %v", err)
		}
		defer file.Close()
		payload, err := io.ReadAll(file)
		if err != nil {
			t.Fatalf("ReadAll(file): %v", err)
		}
		if string(payload) != "voice-audio" {
			t.Fatalf("unexpected uploaded audio payload: %q", string(payload))
		}
		if header == nil || strings.TrimSpace(header.Filename) == "" {
			t.Fatalf("expected uploaded filename")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"_id":"fish-model-001"}`)
	}))
	defer server.Close()

	req := voiceCloneRequest()
	req.Head.ModelId = "fish_audio/s1"
	req.Spec.GetVoiceClone().TargetModelId = "fish_audio/s1"
	req.Spec.GetVoiceClone().Input.ReferenceAudioBytes = []byte("voice-audio")
	req.Spec.GetVoiceClone().Input.ReferenceAudioMime = "audio/wav"
	req.Spec.GetVoiceClone().Input.ReferenceAudioUri = ""

	result, err := executeVoiceWorkflowViaNimillm(
		context.Background(),
		"fish_audio",
		req,
		catalog.ResolveVoiceWorkflowResult{
			Provider:        "fish_audio",
			ModelID:         "fish_audio/s1",
			WorkflowType:    "tts_v2v",
			WorkflowModelID: "fish-audio-create-model",
		},
		nimillm.MediaAdapterConfig{BaseURL: server.URL, APIKey: "test-key"},
	)
	if err != nil {
		t.Fatalf("Execute Fish Audio clone workflow: %v", err)
	}
	if got := strings.TrimSpace(result.ProviderVoiceRef); got != "fish-model-001" {
		t.Fatalf("unexpected provider voice ref: %q", got)
	}
	if requestPath != "/model" {
		t.Fatalf("unexpected request path: %q", requestPath)
	}
}

func TestElevenLabsVoiceCloneWorkflowSuccess(t *testing.T) {
	var requestPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestPath = r.URL.Path
		if got := strings.TrimSpace(r.Header.Get("xi-api-key")); got != "test-key" {
			t.Fatalf("expected xi-api-key header, got=%q", got)
		}
		if got := strings.TrimSpace(r.Header.Get("Authorization")); got != "" {
			t.Fatalf("unexpected Authorization header: %q", got)
		}
		if !strings.HasPrefix(strings.TrimSpace(r.Header.Get("Content-Type")), "multipart/form-data;") {
			t.Fatalf("expected multipart form request, got content-type=%q", r.Header.Get("Content-Type"))
		}
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			t.Fatalf("ParseMultipartForm: %v", err)
		}
		if got := strings.TrimSpace(r.FormValue("name")); got != "test-clone-voice" {
			t.Fatalf("unexpected clone name: %q", got)
		}
		if got := strings.TrimSpace(r.FormValue("remove_background_noise")); got != "false" {
			t.Fatalf("unexpected remove_background_noise value: %q", got)
		}
		file, header, err := r.FormFile("files")
		if err != nil {
			t.Fatalf("FormFile(files): %v", err)
		}
		defer file.Close()
		payload, err := io.ReadAll(file)
		if err != nil {
			t.Fatalf("ReadAll(file): %v", err)
		}
		if string(payload) != "voice-audio" {
			t.Fatalf("unexpected uploaded audio payload: %q", string(payload))
		}
		if header == nil || strings.TrimSpace(header.Filename) == "" {
			t.Fatalf("expected uploaded filename")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"voice_id":"voice-elevenlabs-clone-001"}`)
	}))
	defer server.Close()

	req := voiceCloneRequest()
	req.Head.ModelId = "elevenlabs/eleven_multilingual_sts_v2"
	req.Spec.GetVoiceClone().TargetModelId = "elevenlabs/eleven_multilingual_sts_v2"
	req.Spec.GetVoiceClone().Input.ReferenceAudioBytes = []byte("voice-audio")
	req.Spec.GetVoiceClone().Input.ReferenceAudioMime = "audio/wav"
	req.Spec.GetVoiceClone().Input.ReferenceAudioUri = ""

	result, err := executeVoiceWorkflowViaNimillm(
		context.Background(),
		"elevenlabs",
		req,
		catalog.ResolveVoiceWorkflowResult{
			Provider:        "elevenlabs",
			ModelID:         "elevenlabs/eleven_multilingual_sts_v2",
			WorkflowType:    "tts_v2v",
			WorkflowModelID: "elevenlabs-voice-clone",
		},
		nimillm.MediaAdapterConfig{BaseURL: server.URL, APIKey: "test-key"},
	)
	if err != nil {
		t.Fatalf("Execute ElevenLabs clone workflow: %v", err)
	}
	if got := strings.TrimSpace(result.ProviderVoiceRef); got != "voice-elevenlabs-clone-001" {
		t.Fatalf("unexpected provider voice ref: %q", got)
	}
	if requestPath != "/v1/voices/add" {
		t.Fatalf("unexpected request path: %q", requestPath)
	}
}

func TestElevenLabsVoiceDesignWorkflowSuccess(t *testing.T) {
	requestPaths := make([]string, 0, 4)
	requestBodies := make([]map[string]any, 0, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestPaths = append(requestPaths, r.URL.Path)
		if got := strings.TrimSpace(r.Header.Get("xi-api-key")); got != "test-key" {
			t.Fatalf("expected xi-api-key header, got=%q", got)
		}
		if got := strings.TrimSpace(r.Header.Get("Authorization")); got != "" {
			t.Fatalf("unexpected Authorization header: %q", got)
		}
		rawBody, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatalf("ReadAll(body): %v", err)
		}
		body := map[string]any{}
		if err := json.Unmarshal(rawBody, &body); err != nil {
			t.Fatalf("Unmarshal(body): %v", err)
		}
		requestBodies = append(requestBodies, body)
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/text-to-voice/design":
			_, _ = io.WriteString(w, `{"previews":[{"generated_voice_id":"preview-001"}]}`)
		case "/v1/text-to-voice":
			_, _ = io.WriteString(w, `{"voice_id":"voice-elevenlabs-001","task_id":"job-elevenlabs-001"}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	result, err := executeVoiceWorkflowViaNimillm(
		context.Background(),
		"elevenlabs",
		voiceDesignRequest(),
		catalog.ResolveVoiceWorkflowResult{
			Provider:        "elevenlabs",
			ModelID:         "elevenlabs/eleven_ttv_v3",
			WorkflowType:    "tts_t2v",
			WorkflowModelID: "elevenlabs-voice-design",
		},
		nimillm.MediaAdapterConfig{BaseURL: server.URL, APIKey: "test-key"},
	)
	if err != nil {
		t.Fatalf("Execute design workflow: %v", err)
	}
	if got := strings.TrimSpace(result.ProviderVoiceRef); got != "voice-elevenlabs-001" {
		t.Fatalf("unexpected provider voice ref: %q", got)
	}
	if len(requestPaths) != 2 {
		t.Fatalf("expected preview+create two-step requests, got=%d paths=%v", len(requestPaths), requestPaths)
	}
	if requestPaths[0] != "/v1/text-to-voice/design" || requestPaths[1] != "/v1/text-to-voice" {
		t.Fatalf("unexpected request paths: %v", requestPaths)
	}
	if _, ok := requestBodies[0]["model_id"]; ok {
		t.Fatalf("design preview payload must not send model_id")
	}
	if got := strings.TrimSpace(nimillm.ValueAsString(requestBodies[0]["voice_description"])); got == "" {
		t.Fatalf("preview payload must include voice_description")
	}
	if got := strings.TrimSpace(nimillm.ValueAsString(requestBodies[1]["generated_voice_id"])); got != "preview-001" {
		t.Fatalf("unexpected generated_voice_id: %q", got)
	}
	if got := strings.TrimSpace(nimillm.ValueAsString(requestBodies[1]["voice_name"])); got != "narrator-test" {
		t.Fatalf("unexpected voice_name: %q", got)
	}
	if _, ok := requestBodies[1]["name"]; ok {
		t.Fatalf("design create payload must not use legacy name field")
	}
}

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
			WorkflowType:    "tts_v2v",
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
			WorkflowType:    "tts_v2v",
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
			WorkflowType:    "tts_v2v",
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
			WorkflowType:    "tts_v2v",
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
			WorkflowType:    "tts_v2v",
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
			WorkflowType:    "tts_v2v",
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
			WorkflowType:    "tts_v2v",
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
