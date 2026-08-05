package ai

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	catalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
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
			defer func() { server.Close() }()

			result, err := executeVoiceWorkflowViaNimillm(
				context.Background(),
				provider,
				voiceCloneRequest(),
				catalog.ResolveVoiceWorkflowResult{
					Provider:        provider,
					ModelID:         provider + "/model-a",
					WorkflowType:    "voice_clone",
					WorkflowModelID: provider + "-wf-clone",
				},
				nimillm.MediaAdapterConfig{BaseURL: server.URL, AllowLoopbackEndpoint: true, APIKey: "test-key"},
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
			defer func() { _ = file.Close() }()
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
	defer func() { server.Close() }()

	req := voiceCloneRequest()
	req.Spec.GetVoiceClone().TargetModelId = "step-tts-2"
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
			ModelID:         "step-tts-2",
			WorkflowType:    "voice_clone",
			WorkflowModelID: "stepfun-voice-clone",
		},
		nimillm.MediaAdapterConfig{BaseURL: server.URL, AllowLoopbackEndpoint: true, APIKey: "test-key"},
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
	req.Spec.GetVoiceClone().TargetModelId = "step-tts-2"
	req.Spec.GetVoiceClone().Input.Text = ""

	_, err := executeVoiceWorkflowViaNimillm(
		context.Background(),
		"stepfun",
		req,
		catalog.ResolveVoiceWorkflowResult{
			Provider:        "stepfun",
			ModelID:         "step-tts-2",
			WorkflowType:    "voice_clone",
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
	req.Spec.GetVoiceClone().TargetModelId = "step-tts-2"
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
			ModelID:         "step-tts-2",
			WorkflowType:    "voice_clone",
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
	req.Spec.GetVoiceDesign().TargetModelId = "qwen3-tts-vd"
	req.Spec.GetVoiceDesign().Input.InstructionText = ""
	req.Spec.GetVoiceDesign().Input.PreviewText = "preview only"

	_, err := executeVoiceWorkflowViaNimillm(
		context.Background(),
		"dashscope",
		req,
		catalog.ResolveVoiceWorkflowResult{
			Provider:        "dashscope",
			ModelID:         "dashscope/qwen3-tts-vd",
			WorkflowType:    "voice_design",
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
		defer func() { _ = file.Close() }()
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
	defer func() { server.Close() }()

	req := voiceCloneRequest()
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
			WorkflowType:    "voice_clone",
			WorkflowModelID: "fish-audio-create-model",
		},
		nimillm.MediaAdapterConfig{BaseURL: server.URL, AllowLoopbackEndpoint: true, APIKey: "test-key"},
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
		defer func() { _ = file.Close() }()
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
	defer func() { server.Close() }()

	req := voiceCloneRequest()
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
			WorkflowType:    "voice_clone",
			WorkflowModelID: "elevenlabs-voice-clone",
		},
		nimillm.MediaAdapterConfig{BaseURL: server.URL, AllowLoopbackEndpoint: true, APIKey: "test-key"},
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
	defer func() { server.Close() }()

	result, err := executeVoiceWorkflowViaNimillm(
		context.Background(),
		"elevenlabs",
		voiceDesignRequest(),
		catalog.ResolveVoiceWorkflowResult{
			Provider:        "elevenlabs",
			ModelID:         "elevenlabs/eleven_ttv_v3",
			WorkflowType:    "voice_design",
			WorkflowModelID: "elevenlabs-voice-design",
		},
		nimillm.MediaAdapterConfig{BaseURL: server.URL, AllowLoopbackEndpoint: true, APIKey: "test-key"},
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
		ModelID:         "qwen3-tts-vc",
		APIModelID:      "qwen3-tts-vc-2026-01-22",
		WorkflowType:    "voice_clone",
		WorkflowModelID: "qwen-voice-enrollment",
	}, nil)

	if got := strings.TrimSpace(nimillm.ValueAsString(payload["target_model_id"])); got != "qwen3-tts-vc-2026-01-22" {
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
		ModelID:         "eleven_ttv_v3",
		WorkflowType:    "voice_design",
		WorkflowModelID: "elevenlabs-voice-design",
	}, nil)

	if got := strings.TrimSpace(nimillm.ValueAsString(payload["target_model_id"])); got != "eleven_ttv_v3" {
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

func TestBuildVoiceWorkflowPayloadDesignUsesAPIModelIDForProviderTarget(t *testing.T) {
	req := voiceDesignRequest()
	req.Spec.GetVoiceDesign().TargetModelId = "qwen3-tts-vd"
	payload := buildVoiceWorkflowPayload(req, catalog.ResolveVoiceWorkflowResult{
		Provider:        "dashscope",
		ModelID:         "qwen3-tts-vd",
		APIModelID:      "qwen3-tts-vd-2026-01-26",
		WorkflowType:    "voice_design",
		WorkflowModelID: "qwen-voice-design",
	}, nil)

	if got := strings.TrimSpace(nimillm.ValueAsString(payload["target_model_id"])); got != "qwen3-tts-vd-2026-01-26" {
		t.Fatalf("unexpected target_model_id: %q", got)
	}
}

func TestNormalizeVoiceWorkflowTargetModelID(t *testing.T) {
	cases := []struct {
		name     string
		provider string
		target   string
		resolved string
		api      string
		want     string
	}{
		{
			name:     "exact catalog design target",
			provider: "dashscope",
			target:   "qwen3-tts-vd",
			resolved: "qwen3-tts-vd",
			api:      "qwen3-tts-vd-2026-01-26",
			want:     "qwen3-tts-vd-2026-01-26",
		},
		{
			name:     "route-prefixed target is not interpreted",
			provider: "dashscope",
			target:   "cloud/dashscope/qwen3-tts-vd-2026-01-26",
			resolved: "qwen3-tts-vd",
			api:      "qwen3-tts-vd-2026-01-26",
			want:     "cloud/dashscope/qwen3-tts-vd-2026-01-26",
		},
		{
			name:     "local speech engine prefix is semantic",
			provider: "local",
			target:   "speech/qwen3tts",
			resolved: "speech/qwen3tts",
			want:     "speech/qwen3tts",
		},
		{
			name:     "empty target falls back to resolved catalog model",
			provider: "dashscope",
			target:   "",
			resolved: "qwen3-tts-vd",
			api:      "qwen3-tts-vd-2026-01-26",
			want:     "qwen3-tts-vd-2026-01-26",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := normalizeVoiceWorkflowTargetModelID(tc.target, catalog.ResolveVoiceWorkflowResult{
				Provider:   tc.provider,
				ModelID:    tc.resolved,
				APIModelID: tc.api,
			})
			if got != tc.want {
				t.Fatalf("normalizeVoiceWorkflowTargetModelID()=%q, want=%q", got, tc.want)
			}
		})
	}
}
