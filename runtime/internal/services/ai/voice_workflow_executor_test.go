package ai

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
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
			var requestPathsMu sync.Mutex
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodPost {
					t.Fatalf("expected POST, got %s", r.Method)
				}
				requestPathsMu.Lock()
				requestPaths = append(requestPaths, r.URL.Path)
				requestPathsMu.Unlock()
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
			requestPathsMu.Lock()
			if len(requestPaths) == 0 {
				requestPathsMu.Unlock()
				t.Fatalf("expected at least one provider request")
			}
			requestPathsMu.Unlock()
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

func TestEstimateVoiceWorkflowUsageIsDeterministic(t *testing.T) {
	req := voiceCloneRequest()
	first := estimateVoiceWorkflowUsage(req)
	second := estimateVoiceWorkflowUsage(req)
	if first == nil || second == nil {
		t.Fatalf("expected usage estimate")
	}
	if first.GetComputeMs() != second.GetComputeMs() {
		t.Fatalf("expected deterministic compute estimate, got %d vs %d", first.GetComputeMs(), second.GetComputeMs())
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

func TestVoiceWorkflowMetadataValidationRejectsUnsupportedReferenceAudioMIME(t *testing.T) {
	req := voiceCloneRequest()
	req.Head.ModelId = "stepfun/step-tts-2"
	req.Spec.GetVoiceClone().TargetModelId = "stepfun/step-tts-2"
	req.Spec.GetVoiceClone().Input.ReferenceAudioBytes = []byte("voice-audio")
	req.Spec.GetVoiceClone().Input.ReferenceAudioMime = "audio/ogg"
	req.Spec.GetVoiceClone().Input.ReferenceAudioUri = ""
	req.Spec.GetVoiceClone().Input.Text = "Hello from the source clip."

	_, err := executeVoiceWorkflowViaNimillm(
		context.Background(),
		"stepfun",
		req,
		catalog.ResolveVoiceWorkflowResult{
			Provider:        "stepfun",
			ModelID:         "stepfun/step-tts-2",
			WorkflowType:    "tts_v2v",
			WorkflowModelID: "stepfun-voice-clone",
			RequestOptions: &catalog.VoiceWorkflowRequestOptions{
				TextPromptMode:                 "required",
				SupportsLanguageHints:          boolPtr(false),
				SupportsPreferredName:          boolPtr(false),
				ReferenceAudioURIInput:         boolPtr(true),
				ReferenceAudioBytesInput:       boolPtr(true),
				AllowedReferenceAudioMimeTypes: []string{"audio/wav", "audio/mpeg"},
			},
		},
		nimillm.MediaAdapterConfig{BaseURL: "https://example.invalid", APIKey: "test-key"},
	)
	if err == nil {
		t.Fatalf("expected unsupported MIME rejection")
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
		t.Fatalf("expected AI_MEDIA_OPTION_UNSUPPORTED, got reason=%v ok=%v err=%v", reason, ok, err)
	}
}

func TestVoiceWorkflowMetadataValidationRejectsMissingRequiredInstruction(t *testing.T) {
	req := voiceDesignRequest()
	req.Head.ModelId = "dashscope/qwen3-tts-vd"
	req.Spec.GetVoiceDesign().TargetModelId = "dashscope/qwen3-tts-vd"
	req.Spec.GetVoiceDesign().Input.InstructionText = ""
	req.Spec.GetVoiceDesign().Input.PreviewText = "preview only"

	_, err := executeVoiceWorkflowViaNimillm(
		context.Background(),
		"dashscope",
		req,
		catalog.ResolveVoiceWorkflowResult{
			Provider:        "dashscope",
			ModelID:         "dashscope/qwen3-tts-vd",
			WorkflowType:    "tts_t2v",
			WorkflowModelID: "qwen-voice-design",
			RequestOptions: &catalog.VoiceWorkflowRequestOptions{
				InstructionTextMode:   "required",
				PreviewTextMode:       "optional",
				SupportsLanguage:      boolPtr(true),
				SupportsPreferredName: boolPtr(true),
			},
		},
		nimillm.MediaAdapterConfig{BaseURL: "https://example.invalid", APIKey: "test-key"},
	)
	if err == nil {
		t.Fatalf("expected missing instruction rejection")
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

func TestBuildVoiceWorkflowPayloadCloneUsesCanonicalInputShape(t *testing.T) {
	req := voiceCloneRequest()
	payload := buildVoiceWorkflowPayload(req, catalog.ResolveVoiceWorkflowResult{
		Provider:        "dashscope",
		ModelID:         "dashscope/qwen3-tts-vc",
		WorkflowType:    "tts_v2v",
		WorkflowModelID: "qwen-voice-enrollment",
	}, nil)

	if got := strings.TrimSpace(nimillm.ValueAsString(payload["target_model_id"])); got != "dashscope/qwen3-tts-vc" {
		t.Fatalf("unexpected target_model_id: %q", got)
	}
	input, ok := payload["input"].(map[string]any)
	if !ok {
		t.Fatalf("expected canonical input map, got=%T", payload["input"])
	}
	if got := strings.TrimSpace(nimillm.ValueAsString(input["preferred_name"])); got == "" {
		t.Fatalf("expected canonical preferred_name in input")
	}
	for _, legacyKey := range []string{"model", "name", "voice_name", "preferred_name", "reference_audio_uri", "audio_url", "reference_audio_mime", "reference_audio_base64", "text"} {
		if _, ok := payload[legacyKey]; ok {
			t.Fatalf("unexpected legacy top-level key %q in canonical payload", legacyKey)
		}
	}
}

func TestBuildVoiceWorkflowPayloadDesignUsesCanonicalInputShape(t *testing.T) {
	req := voiceDesignRequest()
	payload := buildVoiceWorkflowPayload(req, catalog.ResolveVoiceWorkflowResult{
		Provider:        "elevenlabs",
		ModelID:         "elevenlabs/eleven_ttv_v3",
		WorkflowType:    "tts_t2v",
		WorkflowModelID: "elevenlabs-voice-design",
	}, nil)

	if got := strings.TrimSpace(nimillm.ValueAsString(payload["target_model_id"])); got != "elevenlabs/eleven_ttv_v3" {
		t.Fatalf("unexpected target_model_id: %q", got)
	}
	input, ok := payload["input"].(map[string]any)
	if !ok {
		t.Fatalf("expected canonical input map, got=%T", payload["input"])
	}
	if got := strings.TrimSpace(nimillm.ValueAsString(input["instruction_text"])); got == "" {
		t.Fatalf("expected canonical instruction_text in input")
	}
	for _, legacyKey := range []string{"model", "model_id", "name", "voice_name", "instruction_text", "description", "preview_text", "text", "preferred_name", "language"} {
		if _, ok := payload[legacyKey]; ok {
			t.Fatalf("unexpected legacy top-level key %q in canonical payload", legacyKey)
		}
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
	resolution, err := svc.resolveVoiceWorkflow(context.Background(), "dashscope", "dashscope/qwen3-tts-vc", "tts_v2v")
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

	resolution, err := svc.resolveVoiceWorkflow(context.Background(), "local", "speech/qwen3tts", "tts_v2v")
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

	resolution, err := svc.resolveVoiceWorkflow(context.Background(), "local", "speech/qwen3tts", "tts_v2v")
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
