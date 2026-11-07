package nimillm

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestSoundverseOriginalTaskAndFileURLCustody(t *testing.T) {
	for _, model := range []string{"v6", "v7"} {
		for _, instrumental := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/%v", model, instrumental), func(t *testing.T) {
				creates, mints, downloads := 0, 0, 0
				var endpoint string
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if r.URL.Path == "/signed" {
						downloads++
						if r.Header.Get("Authorization") != "" || r.Header.Get("x-api-key") != "" || r.Header.Get("Idempotency-Key") != "" {
							t.Error("credential leak")
						}
						w.Header().Set("Content-Type", "application/octet-stream")
						_, _ = fmt.Fprint(w, "fixture body")
						return
					}
					if r.Header.Get("Authorization") != "Bearer test-key" {
						t.Error("native auth")
					}
					w.Header().Set("Content-Type", "application/json")
					operation := "song"
					if instrumental {
						operation = "music"
					}
					switch r.URL.Path {
					case "/proxy/v1/" + model + "/generate/" + operation:
						creates++
						if r.Method != "POST" || r.Header.Get("Idempotency-Key") != "runtime-job" {
							t.Error("create identity")
						}
						body := decodeMusicJSONBody(t, r)
						if body["prompt"] != "  original prompt\n" || body["parameters"].(map[string]any)["versions"] != float64(1) || body["duration"] != nil || body["model"] != nil || body["license"] != nil {
							t.Error("native payload", body)
						}
						if !instrumental && body["lyrics"] != "  original lyrics\n" {
							t.Error("lyrics changed")
						}
						w.WriteHeader(201)
						_, _ = fmt.Fprint(w, `{"job_id":"job-original","status":"queued"}`)
					case "/proxy/v1/" + model + "/status":
						if r.URL.Query().Get("job_id") != "job-original" {
							t.Error("wrong original query")
						}
						_, _ = fmt.Fprint(w, `{"job_id":"job-original","status":"completed","output":{"assets":[{"file_id":"file-original","blob_hash":"provider-hash-not-runtime-sha","url":"https://private.invalid/not-fetchable"}]}}`)
					case "/proxy/v1/v1/files/file-original/url":
						mints++
						_ = json.NewEncoder(w).Encode(map[string]any{"file_id": "file-original", "url": endpoint + "/signed", "mime_type": "audio/mpeg", "expires_at": time.Now().Add(time.Minute).UTC().Format(time.RFC3339)})
					default:
						t.Errorf("unexpected path %s", r.URL.Path)
						http.NotFound(w, r)
					}
				}))
				defer server.Close()
				endpoint = server.URL
				cfg := MediaAdapterConfig{BaseURL: endpoint + "/proxy/v1", APIKey: "test-key", AllowLoopbackEndpoint: true}
				request := newMusicJobRequest(model, "  original prompt\n")
				s := request.Spec.GetMusicGenerate()
				s.Title = ""
				s.DurationSeconds = 600
				s.Instrumental = instrumental
				if !instrumental {
					s.Lyrics = "  original lyrics\n"
				}
				var receipt *NativeTaskReceipt
				ctx := WithNativeTaskPublisher(context.Background(), func(r *NativeTaskReceipt) error { receipt = CloneNativeTaskReceipt(r); return nil })
				_, usage, id, err := ExecuteSoundverseMusic(ctx, cfg, request, model, "runtime-job")
				if !errors.Is(err, ErrNativeTaskYielded) || usage != nil || id != "job-original" || creates != 1 || mints != 0 || downloads != 0 {
					t.Fatal("create did more than handoff", err, id)
				}
				observation, terminal, err := ObserveNativeTask(context.Background(), cfg, receipt)
				if err != nil || !terminal || observation.Artifacts[0].Uri != "soundverse-file:file-original" || mints != 0 || downloads != 0 {
					t.Fatal(observation, terminal, err)
				}
				if observation.Artifacts[0].Sha256 != "" {
					t.Fatal("provider blob hash became Runtime digest")
				}
				bodies, err := OpenNativeTaskArtifacts(context.Background(), cfg, receipt, observation)
				if err != nil {
					t.Fatal(err)
				}
				body := bodies[receipt.Artifact.ArtifactId]
				data, err := io.ReadAll(body.Stream)
				_ = body.Stream.Close()
				if err != nil || string(data) != "fixture body" || observation.Artifacts[0].MimeType != "audio/mpeg" || mints != 1 || downloads != 1 {
					t.Fatal("original body", err)
				}
			})
		}
	}
}

func TestSoundverseIncompleteAndMismatchedObservationsNeverSubstitute(t *testing.T) {
	r := &NativeTaskReceipt{Version: 1, Adapter: AdapterSoundverseMusic, TaskID: "original", Model: "v7", QueryPathTemplate: soundverseQueryPath("v7"), Artifact: BinaryArtifact("application/octet-stream", nil, nil)}
	body := `{"job_id":"original","status":"processing"}`
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		calls++
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprint(w, body)
	}))
	defer server.Close()
	cfg := MediaAdapterConfig{BaseURL: server.URL, APIKey: "test-key", AllowLoopbackEndpoint: true}
	if got, done, err := ObserveNativeTask(context.Background(), cfg, r); got != nil || done || err != nil {
		t.Fatal(got, done, err)
	}
	for _, sample := range []string{`{"job_id":"other","status":"failed"}`, `{"job_id":"original","status":"mystery"}`, `{"job_id":"original","status":"completed","output":{"assets":[]}}`, `{"job_id":"original","status":"completed","output":{"assets":[{"file_id":"one"},{"file_id":"two"}]}}`, `{"job_id":"original","status":"completed","output":{"assets":[{"file_id":"../private"}]}}`} {
		body = sample
		if _, done, err := ObserveNativeTask(context.Background(), cfg, r); err == nil || done {
			t.Fatal("unconfirmed observation became terminal", sample, done, err)
		}
	}
	body = `{"job_id":"original","status":"failed"}`
	if _, done, err := ObserveNativeTask(context.Background(), cfg, r); err == nil || !done {
		t.Fatal("original failure lost", done, err)
	}
	previous := calls
	if outcome, err := DeleteProviderAsyncTask(context.Background(), AdapterSoundverseMusic, r.TaskID, cfg); err != nil || outcome != ProviderTaskCleanupUnsupported || calls != previous {
		t.Fatal("remote delete guessed", outcome, err)
	}
	if _, err := soundverseBackend(context.Background(), MediaAdapterConfig{BaseURL: "https://api.soundverse.ai", APIKey: "old-key"}); err == nil {
		t.Fatal("old domain silently used")
	}
}

func TestSoundverseNativeAccountCheckAndRejectedCreate(t *testing.T) {
	code, body := 200, `{"total_effective":0,"base_effective":0,"extra_tokens":0}`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(code)
		_, _ = fmt.Fprint(w, body)
	}))
	defer server.Close()
	p := &CloudProvider{allowLoopbackEndpoint: true}
	if err := p.ProbeConnector(context.Background(), "soundverse", server.URL, "test-key", nil); err != nil {
		t.Fatal(err)
	}
	code = 401
	if err := p.ProbeConnector(context.Background(), "soundverse", server.URL, "test-key", nil); err == nil {
		t.Fatal("unauthorized passed")
	}
	code = 201
	body = `{"job_id":"accepted","status":"processing"}`
	published := false
	ctx := WithNativeTaskPublisher(context.Background(), func(*NativeTaskReceipt) error { published = true; return nil })
	_, _, _, err := ExecuteSoundverseMusic(ctx, MediaAdapterConfig{BaseURL: server.URL, APIKey: "test-key", AllowLoopbackEndpoint: true}, newMusicJobRequest("v7", "prompt"), "v7", "job-original")
	if !IsNativeCreateResponseUnavailable(err) || published {
		t.Fatal("incomplete native create fabricated receipt", err)
	}
	code = 422
	body = `{"error":"InvalidGenerationInput","message":"private provider error"}`
	_, _, _, err = ExecuteSoundverseMusic(ctx, MediaAdapterConfig{BaseURL: server.URL, APIKey: "test-key", AllowLoopbackEndpoint: true}, newMusicJobRequest("v7", "prompt"), "v7", "job-original")
	if err == nil || IsNativeCreateResponseUnavailable(err) || strings.Contains(err.Error(), "private provider") {
		t.Fatal("explicit rejection changed", err)
	}
}

func TestSoundverseFileMintFailsClosedWithoutFetchingUnownedContent(t *testing.T) {
	r := &NativeTaskReceipt{Version: 1, Adapter: AdapterSoundverseMusic, TaskID: "original", Model: "v7", QueryPathTemplate: soundverseQueryPath("v7"), Artifact: BinaryArtifact("application/octet-stream", nil, nil)}
	downloads := 0
	var body map[string]any
	var endpoint string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if req.URL.Path == "/signed" {
			downloads++
			_, _ = fmt.Fprint(w, "unexpected")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(body)
	}))
	defer server.Close()
	endpoint = server.URL
	for name, change := range map[string]func(map[string]any){"expired": func(b map[string]any) { b["expires_at"] = time.Now().Add(-time.Minute).Format(time.RFC3339) }, "identity": func(b map[string]any) { b["file_id"] = "other" }, "mime": func(b map[string]any) { b["mime_type"] = "text/html" }, "userinfo": func(b map[string]any) { b["url"] = "https://secret@example.com/file" }} {
		t.Run(name, func(t *testing.T) {
			body = map[string]any{"file_id": "file-original", "url": endpoint + "/signed", "mime_type": "audio/mpeg", "expires_at": time.Now().Add(time.Minute).Format(time.RFC3339)}
			change(body)
			a := CloneNativeTaskReceipt(r).Artifact
			a.Uri = "soundverse-file:file-original"
			if _, err := OpenNativeTaskArtifacts(context.Background(), MediaAdapterConfig{BaseURL: endpoint, APIKey: "test-key", AllowLoopbackEndpoint: true}, r, &NativeTaskObservation{Artifacts: []*runtimev1.ScenarioArtifact{a}}); err == nil || downloads != 0 {
				t.Fatal("invalid mint fetched body", err, downloads)
			}
		})
	}
}
