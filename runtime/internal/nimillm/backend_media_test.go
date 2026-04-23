package nimillm

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

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
	defer server.Close()

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
	defer server.Close()

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

func TestBackendGenerateImageUsesCodexResponsesTool(t *testing.T) {
	var captured map[string]any

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/backend-api/codex/responses" {
			http.NotFound(w, r)
			return
		}
		captured = decodeJSONBodyForBackendMediaTest(t, r)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"output": []map[string]any{
				{
					"type":   "image_generation_call",
					"result": base64.StdEncoding.EncodeToString([]byte("image-codex")),
				},
			},
		})
	}))
	defer server.Close()

	backend := NewBackendWithHeaders("cloud-openai_codex", server.URL+"/backend-api/codex", "token-123", map[string]string{
		"originator": "codex_cli_rs",
	}, time.Second)
	payload, _, err := backend.GenerateImage(context.Background(), "gpt-image-2", &runtimev1.ImageGenerateScenarioSpec{
		Prompt:  "make a skyline",
		Quality: "high",
	}, nil)
	if err != nil {
		t.Fatalf("GenerateImage failed: %v", err)
	}
	if string(payload) != "image-codex" {
		t.Fatalf("unexpected payload: %q", string(payload))
	}
	if got := strings.TrimSpace(ValueAsString(captured["model"])); got != "gpt-5.4" {
		t.Fatalf("expected codex host model, got=%q", got)
	}
	tools, ok := captured["tools"].([]any)
	if !ok || len(tools) != 1 {
		t.Fatalf("expected image tool payload, got=%T", captured["tools"])
	}
	tool, _ := tools[0].(map[string]any)
	if got := strings.TrimSpace(ValueAsString(tool["type"])); got != "image_generation" {
		t.Fatalf("expected image_generation tool, got=%q", got)
	}
	if got := strings.TrimSpace(ValueAsString(tool["model"])); got != "gpt-image-2" {
		t.Fatalf("expected gpt-image-2 tool model, got=%q", got)
	}
	if got := strings.TrimSpace(ValueAsString(tool["quality"])); got != "high" {
		t.Fatalf("expected forwarded image quality, got=%q", got)
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
	defer server.Close()

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

func TestBackendGenerateImageUsesMediaCanonicalPath(t *testing.T) {
	var captured map[string]any

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/media/image/generate" {
			http.NotFound(w, r)
			return
		}
		captured = decodeJSONBodyForBackendMediaTest(t, r)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"artifact": map[string]any{
				"mime_type":   "image/png",
				"data_base64": base64.StdEncoding.EncodeToString([]byte("image-media")),
			},
		})
	}))
	defer server.Close()

	backend := NewBackend("local-media", server.URL, "", time.Second)
	payload, _, err := backend.GenerateImage(context.Background(), "media/flux.1-schnell", &runtimev1.ImageGenerateScenarioSpec{
		Prompt: "make a skyline",
	}, map[string]any{"scheduler": "ddim"})
	if err != nil {
		t.Fatalf("GenerateImage failed: %v", err)
	}
	if string(payload) != "image-media" {
		t.Fatalf("unexpected payload: %q", string(payload))
	}
	spec, ok := captured["spec"].(map[string]any)
	if !ok {
		t.Fatalf("expected canonical spec payload, got=%T", captured["spec"])
	}
	if got := strings.TrimSpace(ValueAsString(spec["prompt"])); got != "make a skyline" {
		t.Fatalf("expected prompt in canonical spec, got=%q", got)
	}
}

func TestBackendGenerateVideoUsesMediaCanonicalPath(t *testing.T) {
	var captured map[string]any

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/media/video/generate" {
			http.NotFound(w, r)
			return
		}
		captured = decodeJSONBodyForBackendMediaTest(t, r)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"artifact": map[string]any{
				"mime_type":   "video/mp4",
				"data_base64": base64.StdEncoding.EncodeToString([]byte("video-media")),
			},
		})
	}))
	defer server.Close()

	backend := NewBackend("local-media", server.URL, "", time.Second)
	payload, _, err := backend.GenerateVideo(context.Background(), "media/wan2.1-video", &runtimev1.VideoGenerateScenarioSpec{
		Prompt: "a sunrise over water",
		Mode:   runtimev1.VideoMode_VIDEO_MODE_T2V,
		Content: []*runtimev1.VideoContentItem{
			{
				Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT,
				Text: "a sunrise over water",
			},
		},
		Options: &runtimev1.VideoGenerationOptions{},
	}, map[string]any{"seed_mode": "locked"})
	if err != nil {
		t.Fatalf("GenerateVideo failed: %v", err)
	}
	if string(payload) != "video-media" {
		t.Fatalf("unexpected payload: %q", string(payload))
	}
	spec, ok := captured["spec"].(map[string]any)
	if !ok {
		t.Fatalf("expected canonical spec payload, got=%T", captured["spec"])
	}
	if got := strings.TrimSpace(ValueAsString(spec["prompt"])); got != "a sunrise over water" {
		t.Fatalf("expected prompt in canonical spec, got=%q", got)
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
	defer server.Close()

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
	if text != "transcribed text" {
		t.Fatalf("unexpected transcription text: %q", text)
	}
	if capturedFilename != "audio.wav" {
		t.Fatalf("expected transcribe upload filename to preserve audio extension, got=%q", capturedFilename)
	}
	if got := strings.TrimSpace(ValueAsString(capturedExtensions["segment_mode"])); got != "detailed" {
		t.Fatalf("expected transcription extension to be forwarded, got=%q", got)
	}
}

func TestBackendGenerateMusicNormalizesIterationExtensions(t *testing.T) {
	var captured map[string]any

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/music/generations" {
			http.NotFound(w, r)
			return
		}
		captured = decodeJSONBodyForBackendMediaTest(t, r)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": []map[string]any{
				{"b64_audio": base64.StdEncoding.EncodeToString([]byte("music-generic"))},
			},
		})
	}))
	defer server.Close()

	backend := NewBackend("cloud-stability", server.URL, "", time.Second)
	_, _, err := backend.GenerateMusic(context.Background(), "stable-audio-2", &runtimev1.MusicGenerateScenarioSpec{
		Prompt: "continue this idea",
		Title:  "Continuation",
	}, map[string]any{
		"mode":                "extend",
		"source_audio_base64": "aGVsbG8=",
		"trim_start_sec":      3.25,
	})
	if err != nil {
		t.Fatalf("GenerateMusic failed: %v", err)
	}

	capturedExtensions, ok := captured["extensions"].(map[string]any)
	if !ok {
		t.Fatalf("expected music extensions map, got=%T", captured["extensions"])
	}
	if got := strings.TrimSpace(ValueAsString(capturedExtensions["mode"])); got != "extend" {
		t.Fatalf("expected normalized music mode, got=%q", got)
	}
	if got := capturedExtensions["trim_start_sec"]; got != 3.25 {
		t.Fatalf("expected normalized trim_start_sec, got=%#v", got)
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
	defer r.Body.Close()

	var payload map[string]any
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		t.Fatalf("decode request body: %v", err)
	}
	return payload
}

func decodeMultipartExtensionsForBackendMediaTest(t *testing.T, r *http.Request) map[string]any {
	t.Helper()
	defer r.Body.Close()

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
