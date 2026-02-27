package ai

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/modelregistry"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/providerhealth"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestCloudProviderPickBackend(t *testing.T) {
	p := nimillm.NewCloudProvider(nimillm.CloudConfig{
		NimiLLMBaseURL:   "http://nimillm",
		AlibabaBaseURL:   "http://alibaba",
		BytedanceBaseURL: "http://bytedance",
		GeminiBaseURL:    "http://gemini",
		MiniMaxBaseURL:   "http://minimax",
		KimiBaseURL:      "http://kimi",
		GLMBaseURL:       "http://glm",
		HTTPTimeout:      3 * time.Second,
	}, nil, nil)

	type tc struct {
		modelID       string
		wantModelID   string
		wantExplicit  bool
		wantAvailable bool
	}
	cases := []tc{
		{modelID: "nimillm/gpt-4o", wantModelID: "gpt-4o", wantExplicit: true, wantAvailable: true},
		{modelID: "aliyun/qwen-max", wantModelID: "qwen-max", wantExplicit: true, wantAvailable: true},
		{modelID: "alibaba/qwen-plus", wantModelID: "qwen-plus", wantExplicit: true, wantAvailable: true},
		{modelID: "bytedance/deepseek-v3", wantModelID: "deepseek-v3", wantExplicit: true, wantAvailable: true},
		{modelID: "gemini/veo-3", wantModelID: "veo-3", wantExplicit: true, wantAvailable: true},
		{modelID: "minimax/video-1", wantModelID: "video-1", wantExplicit: true, wantAvailable: true},
		{modelID: "kimi/kimi-k2", wantModelID: "kimi-k2", wantExplicit: true, wantAvailable: true},
		{modelID: "moonshot/kimi-k2", wantModelID: "kimi-k2", wantExplicit: true, wantAvailable: true},
		{modelID: "glm/glm-4.5v", wantModelID: "glm-4.5v", wantExplicit: true, wantAvailable: true},
		{modelID: "bigmodel/glm-4.5v", wantModelID: "glm-4.5v", wantExplicit: true, wantAvailable: true},
		{modelID: "gpt-4o-mini", wantModelID: "gpt-4o-mini", wantExplicit: false, wantAvailable: true},
	}

	for _, item := range cases {
		backend, resolved, explicit, available := p.PickBackend(item.modelID)
		if resolved != item.wantModelID {
			t.Fatalf("%s resolved model mismatch: got=%s want=%s", item.modelID, resolved, item.wantModelID)
		}
		if explicit != item.wantExplicit {
			t.Fatalf("%s explicit mismatch: got=%v want=%v", item.modelID, explicit, item.wantExplicit)
		}
		if available != item.wantAvailable {
			t.Fatalf("%s available mismatch: got=%v want=%v", item.modelID, available, item.wantAvailable)
		}
		if backend == nil {
			t.Fatalf("%s backend should not be nil", item.modelID)
		}
	}
}

func TestCloudProviderExplicitBackendMissing(t *testing.T) {
	p := nimillm.NewCloudProvider(nimillm.CloudConfig{}, nil, nil)

	_, _, _, err := p.GenerateText(context.Background(), "aliyun/qwen-max", &runtimev1.GenerateRequest{
		Input: []*runtimev1.ChatMessage{
			{Role: "user", Content: "hello"},
		},
	}, "hello")
	if err == nil {
		t.Fatalf("expected explicit backend missing error")
	}

	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("expected grpc status error")
	}
	if st.Code() != codes.Unavailable || st.Message() != runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String() {
		t.Fatalf("unexpected error: code=%v message=%s", st.Code(), st.Message())
	}

	if _, _, err := p.Embed(context.Background(), "aliyun/text-embedding-1", []string{"hello"}); status.Code(err) != codes.Unavailable {
		t.Fatalf("embed explicit backend missing code mismatch: %v", status.Code(err))
	}
	if _, _, err := p.GenerateImage(context.Background(), "aliyun/image-1", &runtimev1.ImageGenerationSpec{
		Prompt: "sunrise",
	}); status.Code(err) != codes.Unavailable {
		t.Fatalf("generateImage explicit backend missing code mismatch: %v", status.Code(err))
	}
	if _, _, err := p.GenerateVideo(context.Background(), "aliyun/video-1", &runtimev1.VideoGenerationSpec{
		Prompt: "sunrise",
	}); status.Code(err) != codes.Unavailable {
		t.Fatalf("generateVideo explicit backend missing code mismatch: %v", status.Code(err))
	}
	if _, _, err := p.SynthesizeSpeech(context.Background(), "aliyun/tts-1", &runtimev1.SpeechSynthesisSpec{
		Text: "hello",
	}); status.Code(err) != codes.Unavailable {
		t.Fatalf("synthesizeSpeech explicit backend missing code mismatch: %v", status.Code(err))
	}
	if _, _, err := p.Transcribe(context.Background(), "aliyun/stt-1", &runtimev1.SpeechTranscriptionSpec{
		MimeType: "audio/wav",
	}, []byte("audio"), "audio/wav"); status.Code(err) != codes.Unavailable {
		t.Fatalf("transcribe explicit backend missing code mismatch: %v", status.Code(err))
	}
	_, _, err = p.StreamGenerateText(context.Background(), "aliyun/gpt-4o", &runtimev1.StreamGenerateRequest{
		Input: []*runtimev1.ChatMessage{
			{Role: "user", Content: "hello"},
		},
	}, nil)
	if status.Code(err) != codes.Unavailable {
		t.Fatalf("streamGenerateText explicit backend missing code mismatch: %v", status.Code(err))
	}
}

func TestCloudProviderFailCloseWithoutBackend(t *testing.T) {
	p := nimillm.NewCloudProvider(nimillm.CloudConfig{}, nil, nil)

	if _, _, _, err := p.GenerateText(context.Background(), "fallback-text", &runtimev1.GenerateRequest{
		Input: []*runtimev1.ChatMessage{
			{Role: "user", Content: "hello"},
		},
	}, "hello"); status.Code(err) != codes.Unavailable {
		t.Fatalf("generateText should fail-close: %v", status.Code(err))
	}

	vectors, usage, err := p.Embed(context.Background(), "fallback-embed", []string{"hello", "world"})
	if err != nil {
		t.Fatalf("embed fallback: %v", err)
	}
	if len(vectors) != 2 {
		t.Fatalf("embed fallback vectors mismatch: %d", len(vectors))
	}
	if usage != nil {
		t.Fatalf("embed fallback usage should be nil")
	}

	if _, _, err := p.GenerateImage(context.Background(), "fallback-image", &runtimev1.ImageGenerationSpec{
		Prompt: "image prompt",
	}); status.Code(err) != codes.Unavailable {
		t.Fatalf("generateImage should fail-close: %v", status.Code(err))
	}

	if _, _, err := p.GenerateVideo(context.Background(), "fallback-video", &runtimev1.VideoGenerationSpec{
		Prompt: "video prompt",
	}); status.Code(err) != codes.Unavailable {
		t.Fatalf("generateVideo should fail-close: %v", status.Code(err))
	}

	if _, _, err := p.SynthesizeSpeech(context.Background(), "fallback-tts", &runtimev1.SpeechSynthesisSpec{
		Text: "speak this",
	}); status.Code(err) != codes.Unavailable {
		t.Fatalf("synthesizeSpeech should fail-close: %v", status.Code(err))
	}

	if _, _, err := p.Transcribe(context.Background(), "fallback-stt", &runtimev1.SpeechTranscriptionSpec{
		MimeType: "audio/wav",
	}, []byte("abcdefg"), "audio/wav"); status.Code(err) != codes.Unavailable {
		t.Fatalf("transcribe should fail-close: %v", status.Code(err))
	}

	_, finishReason, err := p.StreamGenerateText(context.Background(), "fallback-text", &runtimev1.StreamGenerateRequest{
		SystemPrompt: "system",
		Input: []*runtimev1.ChatMessage{
			{Role: "user", Content: "hello"},
		},
	}, nil)
	if status.Code(err) != codes.Unavailable {
		t.Fatalf("streamGenerateText should fail-close: %v", status.Code(err))
	}
	if finishReason != runtimev1.FinishReason_FINISH_REASON_ERROR {
		t.Fatalf("stream finish reason mismatch: %v", finishReason)
	}
}

func TestCloudProviderNimiLLMAllModalities(t *testing.T) {
	imageBytes := []byte("nimillm-image-bytes")
	imageBase64 := jsonBase64(imageBytes)
	videoBytes := []byte("nimillm-video-bytes")
	videoBase64 := jsonBase64(videoBytes)
	audioBytes := []byte("nimillm-audio-bytes")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/chat/completions":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"choices": []map[string]any{
					{
						"finish_reason": "stop",
						"message": map[string]any{
							"content": "nimillm text",
						},
					},
				},
				"usage": map[string]any{
					"prompt_tokens":     8,
					"completion_tokens": 4,
				},
			})
			return
		case r.Method == http.MethodPost && r.URL.Path == "/v1/embeddings":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"data": []map[string]any{
					{"embedding": []float64{0.1, 0.2}},
				},
				"usage": map[string]any{
					"prompt_tokens": 4,
					"total_tokens":  6,
				},
			})
			return
		case r.Method == http.MethodPost && r.URL.Path == "/v1/images/generations":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"data": []map[string]any{
					{"b64_json": imageBase64},
				},
			})
			return
		case r.Method == http.MethodPost && r.URL.Path == "/v1/video/generations":
			http.NotFound(w, r)
			return
		case r.Method == http.MethodPost && r.URL.Path == "/v1/videos/generations":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"data": []map[string]any{
					{"b64_mp4": videoBase64},
				},
			})
			return
		case r.Method == http.MethodPost && r.URL.Path == "/v1/audio/speech":
			w.Header().Set("Content-Type", "audio/mpeg")
			_, _ = w.Write(audioBytes)
			return
		case r.Method == http.MethodPost && r.URL.Path == "/v1/audio/transcriptions":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"text": "nimillm stt text",
			})
			return
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	p := nimillm.NewCloudProvider(nimillm.CloudConfig{
		NimiLLMBaseURL: server.URL,
		HTTPTimeout:    3 * time.Second,
	}, nil, nil)

	text, _, finishReason, err := p.GenerateText(context.Background(), "nimillm/gpt-4o-mini", &runtimev1.GenerateRequest{
		Input: []*runtimev1.ChatMessage{
			{Role: "user", Content: "hello"},
		},
	}, "hello")
	if err != nil {
		t.Fatalf("nimillm text generate: %v", err)
	}
	if text != "nimillm text" || finishReason != runtimev1.FinishReason_FINISH_REASON_STOP {
		t.Fatalf("nimillm text output mismatch: text=%s finish=%v", text, finishReason)
	}

	vectors, _, err := p.Embed(context.Background(), "nimillm/text-embedding-3", []string{"hello"})
	if err != nil {
		t.Fatalf("nimillm embed: %v", err)
	}
	if len(vectors) != 1 || len(vectors[0].GetValues()) != 2 {
		t.Fatalf("nimillm embed vector mismatch")
	}

	imagePayload, _, err := p.GenerateImage(context.Background(), "nimillm/image-1", &runtimev1.ImageGenerationSpec{
		Prompt: "skyline",
	})
	if err != nil {
		t.Fatalf("nimillm generateImage: %v", err)
	}
	if string(imagePayload) != string(imageBytes) {
		t.Fatalf("nimillm image payload mismatch: got=%q", string(imagePayload))
	}

	videoPayload, _, err := p.GenerateVideo(context.Background(), "nimillm/video-1", &runtimev1.VideoGenerationSpec{
		Prompt: "ocean",
	})
	if err != nil {
		t.Fatalf("nimillm generateVideo: %v", err)
	}
	if string(videoPayload) != string(videoBytes) {
		t.Fatalf("nimillm video payload mismatch: got=%q", string(videoPayload))
	}

	speechPayload, _, err := p.SynthesizeSpeech(context.Background(), "nimillm/tts-1", &runtimev1.SpeechSynthesisSpec{
		Text: "speak",
	})
	if err != nil {
		t.Fatalf("nimillm synthesizeSpeech: %v", err)
	}
	if string(speechPayload) != string(audioBytes) {
		t.Fatalf("nimillm speech payload mismatch: got=%q", string(speechPayload))
	}

	transcribedText, _, err := p.Transcribe(context.Background(), "nimillm/stt-1", &runtimev1.SpeechTranscriptionSpec{
		MimeType: "audio/wav",
	}, []byte("audio-bytes"), "audio/wav")
	if err != nil {
		t.Fatalf("nimillm transcribe: %v", err)
	}
	if transcribedText != "nimillm stt text" {
		t.Fatalf("nimillm transcribe mismatch: %s", transcribedText)
	}
}

func TestCloudProviderRoutesByPrefix(t *testing.T) {
	nimiCalls := int32(0)
	aliCalls := int32(0)
	byteCalls := int32(0)

	nimiServer := newChatServer(t, "from-nimillm", &nimiCalls)
	defer nimiServer.Close()
	aliServer := newChatServer(t, "from-alibaba", &aliCalls)
	defer aliServer.Close()
	byteServer := newChatServer(t, "from-bytedance", &byteCalls)
	defer byteServer.Close()

	p := nimillm.NewCloudProvider(nimillm.CloudConfig{
		NimiLLMBaseURL:   nimiServer.URL,
		AlibabaBaseURL:   aliServer.URL,
		BytedanceBaseURL: byteServer.URL,
		HTTPTimeout:      3 * time.Second,
	}, nil, nil)

	req := &runtimev1.GenerateRequest{
		Input: []*runtimev1.ChatMessage{
			{Role: "user", Content: "hello"},
		},
	}

	text, _, _, err := p.GenerateText(context.Background(), "aliyun/qwen-max", req, "hello")
	if err != nil {
		t.Fatalf("generate aliyun: %v", err)
	}
	if text != "from-alibaba" {
		t.Fatalf("unexpected aliyun text: %s", text)
	}

	text, _, _, err = p.GenerateText(context.Background(), "bytedance/deepseek-v3", req, "hello")
	if err != nil {
		t.Fatalf("generate bytedance: %v", err)
	}
	if text != "from-bytedance" {
		t.Fatalf("unexpected bytedance text: %s", text)
	}

	text, _, _, err = p.GenerateText(context.Background(), "gpt-4o-mini", req, "hello")
	if err != nil {
		t.Fatalf("generate nimillm default: %v", err)
	}
	if text != "from-nimillm" {
		t.Fatalf("unexpected nimillm text: %s", text)
	}

	if got := atomic.LoadInt32(&nimiCalls); got != 1 {
		t.Fatalf("nimillm calls mismatch: got=%d want=1", got)
	}
	if got := atomic.LoadInt32(&aliCalls); got != 1 {
		t.Fatalf("alibaba calls mismatch: got=%d want=1", got)
	}
	if got := atomic.LoadInt32(&byteCalls); got != 1 {
		t.Fatalf("bytedance calls mismatch: got=%d want=1", got)
	}
}

func TestCloudProviderUsesRegistryHintForDefaultModel(t *testing.T) {
	nimiCalls := int32(0)
	aliCalls := int32(0)

	nimiServer := newChatServer(t, "from-nimillm", &nimiCalls)
	defer nimiServer.Close()
	aliServer := newChatServer(t, "from-alibaba", &aliCalls)
	defer aliServer.Close()

	registry := modelregistry.New()
	registry.Upsert(modelregistry.Entry{
		ModelID:      "qwen-max",
		Version:      "latest",
		Status:       runtimev1.ModelStatus_MODEL_STATUS_INSTALLED,
		Capabilities: []string{"text.generate"},
		ProviderHint: modelregistry.ProviderHintAlibaba,
	})

	p := nimillm.NewCloudProvider(nimillm.CloudConfig{
		NimiLLMBaseURL: nimiServer.URL,
		AlibabaBaseURL: aliServer.URL,
		HTTPTimeout:    3 * time.Second,
	}, registry, nil)

	req := &runtimev1.GenerateRequest{
		Input: []*runtimev1.ChatMessage{
			{Role: "user", Content: "hello"},
		},
	}

	text, _, _, err := p.GenerateText(context.Background(), "qwen-max", req, "hello")
	if err != nil {
		t.Fatalf("generate with registry hint: %v", err)
	}
	if text != "from-alibaba" {
		t.Fatalf("unexpected text: %s", text)
	}
	if got := atomic.LoadInt32(&aliCalls); got != 1 {
		t.Fatalf("alibaba calls mismatch: got=%d want=1", got)
	}
	if got := atomic.LoadInt32(&nimiCalls); got != 0 {
		t.Fatalf("nimillm should not be called: got=%d want=0", got)
	}
}

func TestCloudProviderSkipsUnhealthyBackend(t *testing.T) {
	nimiCalls := int32(0)
	aliCalls := int32(0)

	nimiServer := newChatServer(t, "from-nimillm", &nimiCalls)
	defer nimiServer.Close()
	aliServer := newChatServer(t, "from-alibaba", &aliCalls)
	defer aliServer.Close()

	healthTracker := providerhealth.New()
	healthTracker.Mark("cloud-nimillm", false, "timeout")
	healthTracker.Mark("cloud-alibaba", true, "")

	p := nimillm.NewCloudProvider(nimillm.CloudConfig{
		NimiLLMBaseURL: nimiServer.URL,
		AlibabaBaseURL: aliServer.URL,
		HTTPTimeout:    3 * time.Second,
	}, nil, healthTracker)

	req := &runtimev1.GenerateRequest{
		Input: []*runtimev1.ChatMessage{
			{Role: "user", Content: "hello"},
		},
	}

	text, _, _, err := p.GenerateText(context.Background(), "gpt-4o-mini", req, "hello")
	if err != nil {
		t.Fatalf("generate with unhealthy nimillm: %v", err)
	}
	if text != "from-alibaba" {
		t.Fatalf("unexpected text: %s", text)
	}
	if got := atomic.LoadInt32(&aliCalls); got != 1 {
		t.Fatalf("alibaba calls mismatch: got=%d want=1", got)
	}
	if got := atomic.LoadInt32(&nimiCalls); got != 0 {
		t.Fatalf("nimillm should be skipped: got=%d want=0", got)
	}
}

func newChatServer(t *testing.T, text string, counter *int32) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			http.NotFound(w, r)
			return
		}
		atomic.AddInt32(counter, 1)
		payload := map[string]any{
			"choices": []map[string]any{
				{
					"finish_reason": "stop",
					"message": map[string]any{
						"content": text,
					},
				},
			},
			"usage": map[string]any{
				"prompt_tokens":     12,
				"completion_tokens": 8,
			},
		}
		if err := json.NewEncoder(w).Encode(payload); err != nil {
			t.Fatalf("encode payload: %v", err)
		}
	}))
}

func jsonBase64(input []byte) string {
	return base64.StdEncoding.EncodeToString(input)
}
