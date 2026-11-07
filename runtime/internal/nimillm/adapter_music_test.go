package nimillm

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestExecuteMubertMusicUsesHeadersForSeparateCreateQueryAndBody(t *testing.T) {
	postSeen := false
	getSeen := false
	audioSeen := false
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/public/tracks":
			if strings.TrimSpace(r.Header.Get("customer-id")) != "cust-1" || strings.TrimSpace(r.Header.Get("access-token")) != "acc-1" {
				t.Fatalf("missing mubert submit headers: %#v", r.Header)
			}
			postSeen = true
			body := decodeMusicJSONBody(t, r)
			if body["duration"] != float64(8) || body["mode"] != "track" || body["format"] != "mp3" || body["prompt"] != "club groove" || len(body) != 4 {
				t.Error("native parameters changed", body)
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"id": "track-1", "generations": []any{map[string]any{"session_id": "wave-generation", "format": "wav", "status": "done"}, map[string]any{"session_id": "original-generation", "format": "mp3", "status": "processing"}}}})
		case "/public/tracks/track-1":
			if strings.TrimSpace(r.Header.Get("customer-id")) != "cust-1" || strings.TrimSpace(r.Header.Get("access-token")) != "acc-1" {
				t.Fatalf("missing mubert poll headers: %#v", r.Header)
			}
			getSeen = true
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"data": map[string]any{
					"id": "track-1",
					"generations": []map[string]any{{"session_id": "different-generation", "format": "mp3", "status": "done", "url": server.URL + "/wrong.mp3"}, {
						"session_id": "original-generation", "format": "mp3",
						"status": "done",
						"url":    server.URL + "/audio.mp3",
					}},
				},
			})
		case "/audio.mp3":
			audioSeen = true
			if r.Header.Get("customer-id") != "" || r.Header.Get("access-token") != "" || r.Header.Get("Authorization") != "" {
				t.Error("artifact credential leak")
			}
			w.Header().Set("Content-Type", "audio/mpeg")
			_, _ = w.Write([]byte("mubert-audio"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer func() { server.Close() }()

	var receipt *NativeTaskReceipt
	request := newMusicJobRequest("mubert-track-v3", "club groove")
	request.Spec.GetMusicGenerate().Title = ""
	request.Spec.GetMusicGenerate().DurationSeconds = 8
	ctx := WithNativeTaskPublisher(context.Background(), func(r *NativeTaskReceipt) error { receipt = CloneNativeTaskReceipt(r); return nil })
	_, _, providerJobID, err := ExecuteMubertMusic(ctx, MediaAdapterConfig{
		BaseURL:               server.URL,
		AllowLoopbackEndpoint: true,
		Headers: map[string]string{
			"customer-id":  "cust-1",
			"access-token": "acc-1",
		},
	}, request, "mubert-track-v3")
	if !errors.Is(err, ErrNativeTaskYielded) || !postSeen || getSeen || audioSeen {
		t.Fatalf("create did more than handoff: %v", err)
	}
	cfg := MediaAdapterConfig{BaseURL: server.URL, AllowLoopbackEndpoint: true, Headers: map[string]string{"customer-id": "cust-1", "access-token": "acc-1"}}
	observation, _, err := ObserveNativeTask(context.Background(), cfg, receipt)
	artifacts := observation.GetArtifacts()
	if err != nil || !getSeen || audioSeen {
		t.Fatalf("query acquired body before owner admission: %v", err)
	}
	bodies, err := OpenNativeTaskArtifacts(context.Background(), cfg, receipt, observation)
	if err == nil {
		for _, artifact := range artifacts {
			body := bodies[artifact.GetArtifactId()]
			artifact.Bytes, err = io.ReadAll(body.Stream)
			_ = body.Stream.Close()
			if err != nil {
				break
			}
		}
	}

	if err != nil {
		t.Fatalf("ExecuteMubertMusic failed: %v", err)
	}
	if !postSeen || !getSeen || !audioSeen {
		t.Fatalf("expected submit/poll/audio download, got post=%v get=%v audio=%v", postSeen, getSeen, audioSeen)
	}
	if providerJobID != "track-1" || receipt.MubertGenerationID != "original-generation" || receipt.Model != "mubert-track-v3" {
		t.Fatalf("unexpected provider job id: %q", providerJobID)
	}
	if len(artifacts) != 1 || string(artifacts[0].GetBytes()) != "mubert-audio" {
		t.Fatalf("unexpected artifacts: %#v", artifacts)
	}
}

func TestExecuteMubertMusicRejectsMissingJobOwnerBeforeDispatch(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/public/tracks":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "track-cancel-1"})
		default:
			http.NotFound(w, r)
		}
	}))
	defer func() { server.Close() }()

	_, _, providerJobID, err := ExecuteMubertMusic(context.Background(), MediaAdapterConfig{
		BaseURL:               server.URL,
		AllowLoopbackEndpoint: true,
		Headers: map[string]string{
			"customer-id":  "cust-1",
			"access-token": "acc-1",
		},
	}, newMusicJobRequest("mubert-track-v3", "cancel me"), "mubert-track-v3")
	if providerJobID != "" || err == nil {
		t.Fatalf("unowned create: id=%q err=%v", providerJobID, err)
	}
}

func TestExecuteLoudlyMusicUsesAPIKeyHeader(t *testing.T) {
	var apiKey string
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/ai/prompt/songs":
			apiKey = r.Header.Get("API-KEY")
			if err := r.ParseMultipartForm(1 << 20); err != nil {
				t.Error(err)
				return
			}
			defer r.MultipartForm.RemoveAll()
			if r.FormValue("model") != "VEGA_2" || r.FormValue("prompt") != "ad cue" || r.FormValue("duration") != "30" || r.FormValue("test") != "" || r.Header.Get("Authorization") != "" {
				t.Error("native request changed")
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "original-song", "model": "VEGA_2", "duration": 33000, "music_file_path_mp3": server.URL + "/audio.mp3"})
		case "/audio.mp3":
			if r.Header.Get("API-KEY") != "" || r.Header.Get("Authorization") != "" {
				t.Error("artifact credential leak")
			}
			w.Header().Set("Content-Type", "audio/mpeg")
			_, _ = w.Write([]byte("loudly-audio"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer func() { server.Close() }()

	request := newMusicJobRequest("VEGA_2", "ad cue")
	request.Spec.GetMusicGenerate().Title = ""
	request.Spec.GetMusicGenerate().DurationSeconds = 30
	artifacts, _, _, err := ExecuteLoudlyMusic(context.Background(), MediaAdapterConfig{
		BaseURL:               server.URL,
		AllowLoopbackEndpoint: true,
		APIKey:                "loud-token",
	}, request, "VEGA_2")
	if err != nil {
		t.Fatalf("ExecuteLoudlyMusic failed: %v", err)
	}
	if apiKey != "loud-token" {
		t.Fatalf("unexpected API-KEY header: %q", apiKey)
	}
	if len(artifacts) != 1 || string(artifacts[0].GetBytes()) != "loudly-audio" {
		t.Fatalf("unexpected artifacts: %#v", artifacts)
	}
}

func TestExecuteLlamaMusicFallsBackAcrossEndpoints(t *testing.T) {
	requestPaths := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestPaths = append(requestPaths, r.URL.Path)
		if r.URL.Path == "/v1/audio/speech" {
			http.NotFound(w, r)
			return
		}
		if r.URL.Path == "/sound" {
			w.Header().Set("Content-Type", "audio/mpeg")
			_, _ = w.Write([]byte("llama-music"))
			return
		}
		http.NotFound(w, r)
	}))
	defer func() { server.Close() }()

	artifacts, _, _, err := ExecuteLlamaMusic(context.Background(), MediaAdapterConfig{
		BaseURL:               server.URL,
		AllowLoopbackEndpoint: true,
	}, newMusicJobRequest("ace-step-local", "ambient loop"), "local/ace-step-local")
	if err != nil {
		t.Fatalf("ExecuteLlamaMusic failed: %v", err)
	}
	if strings.Join(requestPaths, ",") != "/v1/audio/speech,/sound" {
		t.Fatalf("unexpected fallback sequence: %v", requestPaths)
	}
	if len(artifacts) != 1 || string(artifacts[0].GetBytes()) != "llama-music" {
		t.Fatalf("unexpected artifacts: %#v", artifacts)
	}
}

func TestExecuteSidecarMusicUsesCanonicalPath(t *testing.T) {
	var captured map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/music/generate" {
			http.NotFound(w, r)
			return
		}
		captured = decodeMusicJSONBody(t, r)
		w.Header().Set("Content-Type", "audio/mpeg")
		_, _ = w.Write([]byte("sidecar-music"))
	}))
	defer func() { server.Close() }()

	artifacts, _, _, err := ExecuteSidecarMusic(context.Background(), MediaAdapterConfig{
		BaseURL:               server.URL,
		AllowLoopbackEndpoint: true,
	}, newMusicJobRequest("stable-audio-open-sidecar", "textured pulse"), "sidecar/stable-audio-open-sidecar")
	if err != nil {
		t.Fatalf("ExecuteSidecarMusic failed: %v", err)
	}
	if got := strings.TrimSpace(ValueAsString(captured["prompt"])); got != "textured pulse" {
		t.Fatalf("unexpected prompt payload: %q", got)
	}
	if len(artifacts) != 1 || string(artifacts[0].GetBytes()) != "sidecar-music" {
		t.Fatalf("unexpected artifacts: %#v", artifacts)
	}
}

func newMusicJobRequest(modelID string, prompt string) *runtimev1.SubmitScenarioJobRequest {
	return &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.test",
			SubjectUserId: "user-1",
			TimeoutMs:     int32((5 * time.Second) / time.Millisecond),
		},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_MusicGenerate{
				MusicGenerate: &runtimev1.MusicGenerateScenarioSpec{Prompt: prompt, Title: "Test Song"},
			},
		},
	}
}

func decodeMusicJSONBody(t *testing.T, r *http.Request) map[string]any {
	t.Helper()
	defer func() { _ = r.Body.Close() }()
	body := map[string]any{}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		t.Fatalf("Decode body: %v", err)
	}
	return body
}
