package nimillm

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"mime"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestExecuteStabilityMusicPromptOnly(t *testing.T) {
	var captured map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2beta/audio/stable-audio-2/text-to-audio" {
			http.NotFound(w, r)
			return
		}
		captured = decodeMusicJSONBody(t, r)
		w.Header().Set("Content-Type", "audio/mpeg")
		_, _ = w.Write([]byte("stable-audio-bytes"))
	}))
	defer server.Close()

	artifacts, _, _, err := ExecuteStabilityMusic(context.Background(), MediaAdapterConfig{
		BaseURL: server.URL,
		APIKey:  "token",
	}, newMusicJobRequest("stable-audio-2", "steady pulse"), "stability/stable-audio-2")
	if err != nil {
		t.Fatalf("ExecuteStabilityMusic failed: %v", err)
	}
	if got := strings.TrimSpace(ValueAsString(captured["prompt"])); got != "steady pulse" {
		t.Fatalf("unexpected prompt payload: %q", got)
	}
	if len(artifacts) != 1 || string(artifacts[0].GetBytes()) != "stable-audio-bytes" {
		t.Fatalf("unexpected artifacts: %#v", artifacts)
	}
}

func TestExecuteStabilityMusicIterationMultipart(t *testing.T) {
	var contentType string
	var prompt string
	var fileBytes []byte
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2beta/audio/stable-audio-2/audio-to-audio" {
			http.NotFound(w, r)
			return
		}
		contentType = r.Header.Get("Content-Type")
		reader, err := r.MultipartReader()
		if err != nil {
			t.Fatalf("MultipartReader: %v", err)
		}
		for {
			part, nextErr := reader.NextPart()
			if nextErr == io.EOF {
				break
			}
			if nextErr != nil {
				t.Fatalf("NextPart: %v", nextErr)
			}
			payload, readErr := io.ReadAll(part)
			if readErr != nil {
				t.Fatalf("ReadAll: %v", readErr)
			}
			switch part.FormName() {
			case "prompt":
				prompt = string(payload)
			case "audio":
				fileBytes = payload
			}
		}
		w.Header().Set("Content-Type", "audio/mpeg")
		_, _ = w.Write([]byte("stable-iteration"))
	}))
	defer server.Close()

	req := newMusicJobRequest("stable-audio-2", "continue this idea")
	req.Extensions = []*runtimev1.ScenarioExtension{musicIterationExtension(t, map[string]any{
		"mode":                "extend",
		"source_audio_base64": base64.StdEncoding.EncodeToString([]byte("seed-audio")),
		"source_mime_type":    "audio/wav",
	})}
	artifacts, _, _, err := ExecuteStabilityMusic(context.Background(), MediaAdapterConfig{
		BaseURL: server.URL,
		APIKey:  "token",
	}, req, "stability/stable-audio-2")
	if err != nil {
		t.Fatalf("ExecuteStabilityMusic iteration failed: %v", err)
	}
	if mediaType, _, _ := mime.ParseMediaType(contentType); mediaType != "multipart/form-data" {
		t.Fatalf("expected multipart content-type, got %q", contentType)
	}
	if prompt != "continue this idea" {
		t.Fatalf("unexpected multipart prompt: %q", prompt)
	}
	if string(fileBytes) != "seed-audio" {
		t.Fatalf("unexpected multipart audio bytes: %q", string(fileBytes))
	}
	if len(artifacts) != 1 || string(artifacts[0].GetBytes()) != "stable-iteration" {
		t.Fatalf("unexpected artifacts: %#v", artifacts)
	}
}

func TestExecuteSoundverseMusicPromptOnly(t *testing.T) {
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v5/generate/song/sync":
			payload := decodeMusicJSONBody(t, r)
			if got := strings.TrimSpace(ValueAsString(payload["prompt"])); got != "anthemic cue" {
				t.Fatalf("unexpected prompt payload: %q", got)
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"audio_url": server.URL + "/audio.mp3",
			})
		case "/audio.mp3":
			w.Header().Set("Content-Type", "audio/mpeg")
			_, _ = w.Write([]byte("soundverse-audio"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	artifacts, _, _, err := ExecuteSoundverseMusic(context.Background(), MediaAdapterConfig{
		BaseURL: server.URL,
		APIKey:  "token",
	}, newMusicJobRequest("soundverse-song-v5", "anthemic cue"), "soundverse/soundverse-song-v5")
	if err != nil {
		t.Fatalf("ExecuteSoundverseMusic failed: %v", err)
	}
	if len(artifacts) != 1 || string(artifacts[0].GetBytes()) != "soundverse-audio" {
		t.Fatalf("unexpected artifacts: %#v", artifacts)
	}
}

func TestExecuteMubertMusicUsesHeadersAndPolling(t *testing.T) {
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
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "track-1"})
		case "/public/tracks/track-1":
			if strings.TrimSpace(r.Header.Get("customer-id")) != "cust-1" || strings.TrimSpace(r.Header.Get("access-token")) != "acc-1" {
				t.Fatalf("missing mubert poll headers: %#v", r.Header)
			}
			getSeen = true
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"data": map[string]any{
					"generations": []map[string]any{{
						"status": "done",
						"url":    server.URL + "/audio.mp3",
					}},
				},
			})
		case "/audio.mp3":
			audioSeen = true
			w.Header().Set("Content-Type", "audio/mpeg")
			_, _ = w.Write([]byte("mubert-audio"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	artifacts, _, providerJobID, err := ExecuteMubertMusic(context.Background(), MediaAdapterConfig{
		BaseURL: server.URL,
		Headers: map[string]string{
			"customer-id":  "cust-1",
			"access-token": "acc-1",
		},
	}, nil, "job-1", newMusicJobRequest("mubert-track-v3", "club groove"), "mubert/mubert-track-v3")
	if err != nil {
		t.Fatalf("ExecuteMubertMusic failed: %v", err)
	}
	if !postSeen || !getSeen || !audioSeen {
		t.Fatalf("expected submit/poll/audio download, got post=%v get=%v audio=%v", postSeen, getSeen, audioSeen)
	}
	if providerJobID != "track-1" {
		t.Fatalf("unexpected provider job id: %q", providerJobID)
	}
	if len(artifacts) != 1 || string(artifacts[0].GetBytes()) != "mubert-audio" {
		t.Fatalf("unexpected artifacts: %#v", artifacts)
	}
}

func TestExecuteLoudlyMusicUsesAPIKeyHeader(t *testing.T) {
	var apiKey string
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/ai/prompt/songs":
			apiKey = r.Header.Get("API-KEY")
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"audio_url": server.URL + "/audio.mp3"})
		case "/audio.mp3":
			w.Header().Set("Content-Type", "audio/mpeg")
			_, _ = w.Write([]byte("loudly-audio"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	artifacts, _, _, err := ExecuteLoudlyMusic(context.Background(), MediaAdapterConfig{
		BaseURL: server.URL,
		APIKey:  "loud-token",
	}, newMusicJobRequest("loudly-vega-2", "ad cue"), "loudly/loudly-vega-2")
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

func TestExecuteLocalAIMusicFallsBackAcrossEndpoints(t *testing.T) {
	requestPaths := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestPaths = append(requestPaths, r.URL.Path)
		if r.URL.Path == "/v1/audio/speech" {
			http.NotFound(w, r)
			return
		}
		if r.URL.Path == "/sound" {
			w.Header().Set("Content-Type", "audio/mpeg")
			_, _ = w.Write([]byte("localai-music"))
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	artifacts, _, _, err := ExecuteLocalAIMusic(context.Background(), MediaAdapterConfig{
		BaseURL: server.URL,
	}, newMusicJobRequest("ace-step-local", "ambient loop"), "localai/ace-step-local")
	if err != nil {
		t.Fatalf("ExecuteLocalAIMusic failed: %v", err)
	}
	if strings.Join(requestPaths, ",") != "/v1/audio/speech,/sound" {
		t.Fatalf("unexpected fallback sequence: %v", requestPaths)
	}
	if len(artifacts) != 1 || string(artifacts[0].GetBytes()) != "localai-music" {
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
	defer server.Close()

	artifacts, _, _, err := ExecuteSidecarMusic(context.Background(), MediaAdapterConfig{
		BaseURL: server.URL,
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
			ModelId:       modelID,
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
	defer r.Body.Close()
	body := map[string]any{}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		t.Fatalf("Decode body: %v", err)
	}
	return body
}

func musicIterationExtension(t *testing.T, payload map[string]any) *runtimev1.ScenarioExtension {
	t.Helper()
	value, err := structpb.NewStruct(payload)
	if err != nil {
		t.Fatalf("NewStruct: %v", err)
	}
	return &runtimev1.ScenarioExtension{
		Namespace: "nimi.scenario.music_generate.request",
		Payload:   value,
	}
}
