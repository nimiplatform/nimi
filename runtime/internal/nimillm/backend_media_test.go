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
)

func TestBackendGenerateImageManagedMediaForwardsScenarioExtensions(t *testing.T) {
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
				{"b64_json": base64.StdEncoding.EncodeToString([]byte("image-managed-media"))},
			},
		})
	}))
	defer server.Close()

	backend := NewBackend("llama", server.URL, "", time.Second)
	spec := &runtimev1.ImageGenerateScenarioSpec{
		Prompt: "make a forest",
	}
	scenarioExtensions := map[string]any{
		"steps":          12,
		"method":         "edit",
		"guidance_scale": 7.5,
	}

	payload, _, compat, err := backend.GenerateImageManagedMedia(context.Background(), "local/image", spec, scenarioExtensions)
	if err != nil {
		t.Fatalf("GenerateImageManagedMedia failed: %v", err)
	}
	if string(payload) != "image-managed-media" {
		t.Fatalf("unexpected payload: %q", string(payload))
	}
	if compat == nil {
		t.Fatal("expected managed media compatibility diagnostics")
	}
	if got := ValueAsInt32(captured["step"]); got != 12 {
		t.Fatalf("expected step override from scenario extension, got=%d", got)
	}
	if got := strings.TrimSpace(ValueAsString(captured["mode"])); got != "edit" {
		t.Fatalf("expected mode override from scenario extension, got=%q", got)
	}
	capturedExtensions, ok := captured["extensions"].(map[string]any)
	if !ok {
		t.Fatalf("expected extensions map in request, got=%T", captured["extensions"])
	}
	if got := ValueAsInt32(capturedExtensions["steps"]); got != 12 {
		t.Fatalf("expected steps extension to be forwarded, got=%d", got)
	}
	if got := strings.TrimSpace(ValueAsString(capturedExtensions["method"])); got != "edit" {
		t.Fatalf("expected method extension to be forwarded, got=%q", got)
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

func TestBackendGenerateImageManagedMediaRejectsUnsupportedResponseFormat(t *testing.T) {
	backend := NewBackend("llama", "http://127.0.0.1", "", time.Second)
	_, _, _, err := backend.GenerateImageManagedMedia(context.Background(), "local/image", &runtimev1.ImageGenerateScenarioSpec{
		Prompt:         "make a forest",
		ResponseFormat: "signed_url",
	}, nil)
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

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/audio/transcriptions" {
			http.NotFound(w, r)
			return
		}
		capturedExtensions = decodeMultipartExtensionsForBackendMediaTest(t, r)
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

	backend := NewBackend("cloud-suno", server.URL, "", time.Second)
	_, _, err := backend.GenerateMusic(context.Background(), "suno-v4", &runtimev1.MusicGenerateScenarioSpec{
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
