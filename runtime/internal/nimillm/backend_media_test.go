package nimillm

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
)

type fakeStreamingSpeechProvider struct{}

func (fakeStreamingSpeechProvider) StreamSynthesizeSpeech(
	_ context.Context,
	_ string,
	_ *runtimev1.SpeechSynthesizeScenarioSpec,
	_ map[string]any,
	onChunk func(SpeechStreamChunk) error,
) (*runtimev1.UsageStats, runtimev1.FinishReason, error) {
	if onChunk == nil {
		return nil, runtimev1.FinishReason_FINISH_REASON_UNSPECIFIED, errors.New("missing chunk callback")
	}
	if err := onChunk(SpeechStreamChunk{
		Sequence:     42,
		MIMEType:     "audio/mpeg",
		SampleRateHz: 24000,
		TraceID:      "trace-native-tts",
		Bytes:        []byte("native-audio"),
	}); err != nil {
		return nil, runtimev1.FinishReason_FINISH_REASON_UNSPECIFIED, err
	}
	return &runtimev1.UsageStats{OutputTokens: 7}, runtimev1.FinishReason_FINISH_REASON_STOP, nil
}

var _ StreamingSpeechProvider = fakeStreamingSpeechProvider{}

func TestSpeechStreamChunkContractCarriesNativeMetadata(t *testing.T) {
	var got SpeechStreamChunk
	usage, finish, err := fakeStreamingSpeechProvider{}.StreamSynthesizeSpeech(
		context.Background(),
		"tts-native",
		&runtimev1.SpeechSynthesizeScenarioSpec{Text: "hello"},
		map[string]any{"fixture": true},
		func(chunk SpeechStreamChunk) error {
			got = chunk
			return nil
		},
	)
	if err != nil {
		t.Fatalf("StreamSynthesizeSpeech: %v", err)
	}
	if usage.GetOutputTokens() != 7 || finish != runtimev1.FinishReason_FINISH_REASON_STOP {
		t.Fatalf("unexpected terminal metadata: usage=%v finish=%v", usage, finish)
	}
	if got.Sequence != 42 || got.MIMEType != "audio/mpeg" || got.SampleRateHz != 24000 || got.TraceID != "trace-native-tts" || string(got.Bytes) != "native-audio" {
		t.Fatalf("speech stream chunk metadata mismatch: %#v", got)
	}
}

func TestBackendGenerateImageForwardsScenarioExtensions(t *testing.T) {
	var captured map[string]any

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/images/generations" {
			http.NotFound(w, r)
			return
		}
		captured = decodeJSONBodyForBackendMediaTest(t, r)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": []map[string]any{
				{"b64_json": base64.StdEncoding.EncodeToString([]byte("image-generic"))},
			},
		})
	}))
	defer func() { server.Close() }()

	backend := NewBackend("openai", server.URL, "", time.Second)
	scenarioExtensions := map[string]any{
		"scheduler": "ddim",
		"strength":  0.35,
	}

	payload, _, err := backend.GenerateImage(context.Background(), "openai/image", &runtimev1.ImageGenerateScenarioSpec{
		Prompt: "make a skyline",
	}, scenarioExtensions)
	if err != nil {
		t.Fatalf("GenerateImage failed: %v", err)
	}
	if string(payload) != "image-generic" {
		t.Fatalf("unexpected payload: %q", string(payload))
	}
	capturedExtensions, ok := captured["extensions"].(map[string]any)
	if !ok {
		t.Fatalf("expected extensions map in request, got=%T", captured["extensions"])
	}
	if got := strings.TrimSpace(ValueAsString(capturedExtensions["scheduler"])); got != "ddim" {
		t.Fatalf("expected scheduler extension to be forwarded, got=%q", got)
	}
}

func TestProviderEndpointPathUsesAdapterOwnedCanonicalPath(t *testing.T) {
	got := firstProviderEndpointPath([]string{"/v1/canonical"})
	if got != "/v1/canonical" {
		t.Fatalf("endpoint path = %q, want adapter-owned canonical path", got)
	}
}

func TestNormalizeImageResponseFormatRejectsUnsupportedValue(t *testing.T) {
	_, err := normalizeImageResponseFormat("signed_url")
	if err == nil {
		t.Fatal("expected unsupported response format error")
	}
}

func TestBackendGenerateImageNormalizesBase64ResponseFormat(t *testing.T) {
	var captured map[string]any

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/images/generations" {
			http.NotFound(w, r)
			return
		}
		captured = decodeJSONBodyForBackendMediaTest(t, r)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": []map[string]any{
				{"b64_json": base64.StdEncoding.EncodeToString([]byte("image-generic"))},
			},
		})
	}))
	defer func() { server.Close() }()

	backend := NewBackend("openai", server.URL, "", time.Second)
	_, _, err := backend.GenerateImage(context.Background(), "openai/image", &runtimev1.ImageGenerateScenarioSpec{
		Prompt:         "make a skyline",
		ResponseFormat: "base64",
	}, nil)
	if err != nil {
		t.Fatalf("GenerateImage failed: %v", err)
	}
	if got := strings.TrimSpace(ValueAsString(captured["response_format"])); got != "b64_json" {
		t.Fatalf("expected normalized response format, got=%q", got)
	}
}

func TestBackendGenerateImageRejectsNilSpec(t *testing.T) {
	backend := NewBackend("openai", "http://127.0.0.1", "", time.Second)
	_, _, err := backend.GenerateImage(context.Background(), "openai/image", nil, nil)
	if err == nil {
		t.Fatal("expected nil spec error")
	}
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("unexpected code: %v", status.Code(err))
	}
}

func TestBackendGenerateImageChatGPTPlanFailsBeforeDispatch(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Errorf("unsupported ChatGPT plan image request reached provider: %s %s", r.Method, r.URL.Path)
		http.Error(w, "unexpected request", http.StatusBadRequest)
	}))
	defer server.Close()

	backend := NewBackendWithHeaders("cloud-openai_chatgpt_plan", server.URL, "token-123", nil, time.Second)
	payload, _, err := backend.GenerateImage(context.Background(), "gpt-image-2", &runtimev1.ImageGenerateScenarioSpec{Prompt: "make a skyline"}, nil)
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED || payload != nil {
		t.Fatalf("unsupported ChatGPT plan image target did not fail typed before dispatch: payload=%d reason=%v present=%v err=%v", len(payload), reason, ok, err)
	}
}

func TestBackendEmbedUsesOpenAICompatiblePathResolver(t *testing.T) {
	var capturedPath string
	var captured map[string]any

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedPath = r.URL.Path
		if r.Method != http.MethodPost || r.URL.Path != "/v1beta/openai/embeddings" {
			http.NotFound(w, r)
			return
		}
		captured = decodeJSONBodyForBackendMediaTest(t, r)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": []map[string]any{
				{"embedding": []float64{0.1, 0.2, 0.3}},
			},
			"usage": map[string]any{"prompt_tokens": 3, "total_tokens": 3},
		})
	}))
	defer func() { server.Close() }()

	backend := NewBackend("cloud-gemini", server.URL+"/v1beta/openai", "", time.Second)
	vectors, _, err := backend.Embed(context.Background(), "gemini-embedding-001", []string{"hello"}, nil)
	if err != nil {
		t.Fatalf("Embed failed through OpenAI-compatible path resolver: %v; path=%q", err, capturedPath)
	}
	if capturedPath != "/v1beta/openai/embeddings" {
		t.Fatalf("embedding path = %q, want /v1beta/openai/embeddings", capturedPath)
	}
	if got := strings.TrimSpace(ValueAsString(captured["model"])); got != "gemini-embedding-001" {
		t.Fatalf("provider request model = %q", got)
	}
	if len(vectors) != 1 {
		t.Fatalf("expected one embedding vector, got %d", len(vectors))
	}
}

func TestBackendEmbedPlacesVectorsByProviderIndex(t *testing.T) {
	respond := func(data []map[string]any) *httptest.Server {
		return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"data": data, "usage": map[string]any{"prompt_tokens": 4, "total_tokens": 4}})
		}))
	}
	// Items arrive out of input order; each vector goes to the input it names.
	server := respond([]map[string]any{
		{"index": 1, "embedding": []float64{0.2}},
		{"index": 0, "embedding": []float64{0.1}},
	})
	defer server.Close()
	vectors, _, err := NewBackend("cloud-openai", server.URL+"/v1", "", time.Second).Embed(context.Background(), "text-embedding-3-small", []string{"first", "second"}, nil)
	if err != nil {
		t.Fatalf("Embed: %v", err)
	}
	if len(vectors) != 2 || vectors[0].GetValues()[0].GetNumberValue() != 0.1 || vectors[1].GetValues()[0].GetNumberValue() != 0.2 {
		t.Fatalf("vectors were not placed by index: %v", vectors)
	}

	for name, data := range map[string][]map[string]any{
		"duplicate index":    {{"index": 0, "embedding": []float64{0.1}}, {"index": 0, "embedding": []float64{0.2}}},
		"index out of range": {{"index": 0, "embedding": []float64{0.1}}, {"index": 2, "embedding": []float64{0.2}}},
		"missing vector":     {{"index": 0, "embedding": []float64{0.1}}},
	} {
		bad := respond(data)
		_, _, err := NewBackend("cloud-openai", bad.URL+"/v1", "", time.Second).Embed(context.Background(), "text-embedding-3-small", []string{"first", "second"}, nil)
		bad.Close()
		if err == nil {
			t.Fatalf("%s: a response that does not map one vector to each input was accepted", name)
		}
	}
}

func TestBackendEmbedPreservesNativeDimensionsAndReportedUsage(t *testing.T) {
	for _, tc := range []struct {
		name          string
		usage         any
		wantUsage     bool
		input, output int64
	}{
		{"missing", nil, false, 0, 0},
		{"empty", map[string]any{}, false, 0, 0},
		{"prompt only", map[string]any{"prompt_tokens": 7}, false, 0, 0},
		{"zero", map[string]any{"prompt_tokens": 0, "total_tokens": 0}, true, 0, 0},
		{"reported", map[string]any{"prompt_tokens": 7, "total_tokens": 9}, true, 7, 2},
		{"negative", map[string]any{"prompt_tokens": -1, "total_tokens": 9}, false, 0, 0},
		{"inconsistent", map[string]any{"prompt_tokens": 7, "total_tokens": 3}, false, 0, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var body map[string]any
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
				}
				if body["dimensions"] != float64(2) {
					t.Errorf("native dimensions = %v", body["dimensions"])
				}
				response := map[string]any{"data": []any{map[string]any{"embedding": []float64{0.25, 0.75}, "index": 0}}}
				if tc.usage != nil {
					response["usage"] = tc.usage
				}
				_ = json.NewEncoder(w).Encode(response)
			}))
			defer server.Close()
			dimensions := uint32(2)
			vectors, usage, err := NewBackend("cloud-openai", server.URL+"/v1", "", time.Second).Embed(context.Background(), "text-embedding-3-small", []string{"hello"}, &dimensions)
			if err != nil || len(vectors) != 1 {
				t.Fatalf("Embed = %+v %v", vectors, err)
			}
			if (usage != nil) != tc.wantUsage || usage.GetInputTokens() != tc.input || usage.GetOutputTokens() != tc.output || usage.GetComputeMs() != 0 {
				t.Fatalf("provider usage = %+v", usage)
			}
		})
	}
}

func TestBackendGenerateVideoForwardsScenarioExtensions(t *testing.T) {
	var captured map[string]any

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/video/generations" {
			http.NotFound(w, r)
			return
		}
		captured = decodeJSONBodyForBackendMediaTest(t, r)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": []map[string]any{
				{"b64_mp4": base64.StdEncoding.EncodeToString([]byte("video-generic"))},
			},
		})
	}))
	defer func() { server.Close() }()

	backend := NewBackend("openai", server.URL, "", time.Second)
	scenarioExtensions := map[string]any{
		"seed_mode": "locked",
	}

	payload, _, err := backend.GenerateVideo(context.Background(), "openai/video", &runtimev1.VideoGenerateScenarioSpec{
		Prompt: "a sunrise over water",
		Mode:   runtimev1.VideoMode_VIDEO_MODE_T2V,
		Content: []*runtimev1.VideoContentItem{
			{
				Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT,
				Text: "a sunrise over water",
			},
		},
		Options: &runtimev1.VideoGenerationOptions{},
	}, scenarioExtensions)
	if err != nil {
		t.Fatalf("GenerateVideo failed: %v", err)
	}
	if string(payload) != "video-generic" {
		t.Fatalf("unexpected payload: %q", string(payload))
	}
	capturedExtensions, ok := captured["extensions"].(map[string]any)
	if !ok {
		t.Fatalf("expected extensions map in request, got=%T", captured["extensions"])
	}
	if got := strings.TrimSpace(ValueAsString(capturedExtensions["seed_mode"])); got != "locked" {
		t.Fatalf("expected video extension to be forwarded, got=%q", got)
	}
}

func TestBackendSynthesizeSpeechRejectsNilSpec(t *testing.T) {
	backend := NewBackend("openai", "http://127.0.0.1", "", time.Second)
	_, _, err := backend.SynthesizeSpeech(context.Background(), "openai/tts", nil, nil)
	if err == nil {
		t.Fatal("expected nil spec error")
	}
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("unexpected code: %v", status.Code(err))
	}
}

func TestBackendTranscribeForwardsScenarioExtensions(t *testing.T) {
	var capturedExtensions map[string]any
	var capturedFilename string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/audio/transcriptions" {
			http.NotFound(w, r)
			return
		}
		reader, err := r.MultipartReader()
		if err != nil {
			t.Fatalf("MultipartReader: %v", err)
		}
		for {
			part, err := reader.NextPart()
			if err == io.EOF {
				break
			}
			if err != nil {
				t.Fatalf("NextPart: %v", err)
			}
			payload, err := io.ReadAll(part)
			if err != nil {
				t.Fatalf("ReadAll(%s): %v", part.FormName(), err)
			}
			if part.FormName() == "file" {
				capturedFilename = part.FileName()
				continue
			}
			if part.FormName() == "extensions" {
				if err := json.Unmarshal(payload, &capturedExtensions); err != nil {
					t.Fatalf("json.Unmarshal(extensions): %v", err)
				}
			}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"text": "transcribed text",
		})
	}))
	defer func() { server.Close() }()

	backend := NewBackend("openai", server.URL, "", time.Second)
	scenarioExtensions := map[string]any{
		"temperature":  0.2,
		"segment_mode": "detailed",
	}

	text, _, err := backend.Transcribe(
		context.Background(),
		"openai/stt",
		&runtimev1.SpeechTranscribeScenarioSpec{
			Language: "en",
			Prompt:   "transcribe cleanly",
		},
		[]byte("audio-bytes"),
		"audio/wav",
		scenarioExtensions,
	)
	if err != nil {
		t.Fatalf("Transcribe failed: %v", err)
	}
	if text.GetText() != "transcribed text" {
		t.Fatalf("unexpected transcription text: %q", text)
	}
	if capturedFilename != "audio.wav" {
		t.Fatalf("expected transcribe upload filename to preserve audio extension, got=%q", capturedFilename)
	}
	if got := strings.TrimSpace(ValueAsString(capturedExtensions["segment_mode"])); got != "detailed" {
		t.Fatalf("expected transcription extension to be forwarded, got=%q", got)
	}
}

func TestBackendTranscribeRejectsEmptyTextByDefault(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/audio/transcriptions" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"text": ""})
	}))
	defer func() { server.Close() }()

	backend := NewBackend("openai", server.URL, "", time.Second)
	_, _, err := backend.Transcribe(
		context.Background(),
		"openai/stt",
		&runtimev1.SpeechTranscribeScenarioSpec{},
		[]byte("audio-bytes"),
		"audio/wav",
		nil,
	)
	if err == nil {
		t.Fatal("expected empty transcription text to fail closed")
	}
	if status.Code(err) != codes.Internal {
		t.Fatalf("unexpected status code: %v", status.Code(err))
	}
	got, ok := grpcerr.ExtractReasonCode(err)
	if !ok || got != runtimev1.ReasonCode_AI_OUTPUT_INVALID {
		t.Fatalf("unexpected reason code: %s", got)
	}
}

func TestBackendTranscribeProbeFlagsCannotTurnEmptyTextIntoNoSpeech(t *testing.T) {
	var capturedExtensions map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/audio/transcriptions" {
			http.NotFound(w, r)
			return
		}
		reader, err := r.MultipartReader()
		if err != nil {
			t.Fatalf("MultipartReader: %v", err)
		}
		for {
			part, err := reader.NextPart()
			if err == io.EOF {
				break
			}
			if err != nil {
				t.Fatalf("NextPart: %v", err)
			}
			if part.FormName() != "extensions" {
				continue
			}
			payload, err := io.ReadAll(part)
			if err != nil {
				t.Fatalf("ReadAll(extensions): %v", err)
			}
			if err := json.Unmarshal(payload, &capturedExtensions); err != nil {
				t.Fatalf("json.Unmarshal(extensions): %v", err)
			}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"text": ""})
	}))
	defer func() { server.Close() }()

	backend := NewBackend("openai", server.URL, "", time.Second)
	text, _, err := backend.Transcribe(
		context.Background(),
		"openai/stt",
		&runtimev1.SpeechTranscribeScenarioSpec{},
		[]byte("audio-bytes"),
		"audio/wav",
		map[string]any{
			"nimi_first_run_baseline_probe": true,
			"nimi_allow_empty_transcript":   true,
		},
	)
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_OUTPUT_INVALID || text != nil {
		t.Fatalf("empty output invented no_speech: %+v err=%v", text, err)
	}
	if !ValueAsBool(capturedExtensions["nimi_allow_empty_transcript"]) {
		t.Fatalf("expected first-run allow-empty extension to be forwarded, got %#v", capturedExtensions)
	}
}

func TestGenericTranscriptionPreservesParsedFactsAndAbsentUsage(t *testing.T) {
	for _, tc := range []struct {
		name    string
		payload string
		timing  bool
		valid   bool
	}{
		{"reported language and real zero", `{"text":"  Hello,  世界!\n","language":"zh","words":[{"text":"Hello","start_seconds":0,"end_seconds":0},{"text":"世界","start_seconds":0.2,"end_seconds":0.9}]}`, true, true},
		{"language hint is not report", `{"text":"Hello."}`, false, true},
		{"explicit no speech", `{"text":"","no_speech":true}`, true, true},
		{"requested times missing", `{"text":"Hello."}`, true, false},
		{"missing start is not zero", `{"text":"Hello","words":[{"text":"Hello","end_seconds":0}]}`, true, false},
		{"missing end is not zero", `{"text":"Hello","words":[{"text":"Hello","start_seconds":0}]}`, true, false},
		{"empty is not silence", `{"text":""}`, false, false},
		{"contradictory silence", `{"text":"Hello","no_speech":true}`, false, false},
		{"invalid interval", `{"text":"Hello","words":[{"text":"Hello","start_seconds":0.2,"end_seconds":0.1}]}`, true, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_, _ = io.WriteString(w, tc.payload)
			}))
			defer server.Close()
			provider, target := openAITranscriptionTestTarget(server.URL, "compat-transcribe")
			timestamps := tc.timing
			req := openAITranscriptionTestRequest(&runtimev1.SpeechTranscribeScenarioSpec{Language: "en", Timestamps: &timestamps})
			artifacts, usage, _, err := provider.executeGenericMediaWithTarget(context.Background(), req, "compat-transcribe", target, "openai_compat_adapter")
			if !tc.valid {
				if err == nil || len(artifacts) != 0 || usage != nil {
					t.Fatalf("invalid response published: artifacts=%+v usage=%+v err=%v", artifacts, usage, err)
				}
				return
			}
			if err != nil || usage != nil || len(artifacts) != 1 || artifacts[0].GetMimeType() != localexecution.SpeechTranscriptMIME {
				t.Fatalf("honest typed result artifacts=%+v usage=%+v err=%v", artifacts, usage, err)
			}
			transcript := &runtimev1.SpeechTranscript{}
			if err := protojson.Unmarshal(artifacts[0].GetBytes(), transcript); err != nil {
				t.Fatal(err)
			}
			switch tc.name {
			case "reported language and real zero":
				if transcript.GetText() != "Hello,  世界!" || transcript.GetLanguage() != "zh" || len(transcript.GetWords()) != 2 || transcript.Words[0].GetEndSeconds() != 0 || transcript.Words[1].GetEndSeconds() != 0.9 {
					t.Fatalf("parsed facts lost: %+v", transcript)
				}
			case "language hint is not report":
				if transcript.GetLanguage() != "" {
					t.Fatalf("language invented from request: %+v", transcript)
				}
			case "explicit no speech":
				if transcript.GetStatus() != runtimev1.SpeechTranscriptStatus_SPEECH_TRANSCRIPT_STATUS_NO_SPEECH || transcript.GetText() != "" || len(transcript.GetWords()) != 0 {
					t.Fatalf("explicit silence lost: %+v", transcript)
				}
			}
		})
	}
}

func TestBackendGenerateMusicRejectsRetiredExtensionsBeforeTransport(t *testing.T) {
	backend := NewBackend("cloud-stability", "http://127.0.0.1", "", time.Second)
	_, _, err := backend.GenerateMusic(context.Background(), "stable-audio-2", &runtimev1.MusicGenerateScenarioSpec{Prompt: "new reference request"}, map[string]any{"mode": "reference", "source_audio_base64": "aGVsbG8="})
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
		t.Fatalf("retired input reached transport: %v", err)
	}
}

func TestBackendGenerateMusicRejectsIterationForUnsupportedBackend(t *testing.T) {
	backend := NewBackend("cloud-openai", "http://127.0.0.1", "", time.Second)
	_, _, err := backend.GenerateMusic(context.Background(), "music-model", &runtimev1.MusicGenerateScenarioSpec{
		Prompt: "continue this idea",
	}, map[string]any{
		"mode":                "extend",
		"source_audio_base64": "aGVsbG8=",
	})
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
		t.Fatalf("expected AI_MEDIA_OPTION_UNSUPPORTED, got reason=%v ok=%v err=%v", reason, ok, err)
	}
}

func decodeJSONBodyForBackendMediaTest(t *testing.T, r *http.Request) map[string]any {
	t.Helper()
	defer func() { _ = r.Body.Close() }()

	var payload map[string]any
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		t.Fatalf("decode request body: %v", err)
	}
	return payload
}

func decodeMultipartExtensionsForBackendMediaTest(t *testing.T, r *http.Request) map[string]any {
	t.Helper()
	defer func() { _ = r.Body.Close() }()

	reader, err := r.MultipartReader()
	if err != nil {
		t.Fatalf("MultipartReader: %v", err)
	}
	var raw string
	for {
		part, nextErr := reader.NextPart()
		if nextErr != nil {
			if nextErr == io.EOF {
				break
			}
			t.Fatalf("NextPart: %v", nextErr)
		}
		if part.FormName() != "extensions" {
			continue
		}
		payload, copyErr := io.ReadAll(part)
		if copyErr != nil {
			t.Fatalf("read extensions part: %v", copyErr)
		}
		raw = string(payload)
	}
	if strings.TrimSpace(raw) == "" {
		t.Fatal("expected multipart extensions field")
	}
	out := map[string]any{}
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		t.Fatalf("unmarshal extensions: %v", err)
	}
	return out
}
