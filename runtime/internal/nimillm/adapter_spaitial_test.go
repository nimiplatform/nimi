package nimillm

import (
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/binary"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestSpaitialCapturedImageUploadAndPrivateRequest(t *testing.T) {
	for _, projection := range []runtimev1.WorldImageProjection{runtimev1.WorldImageProjection_WORLD_IMAGE_PROJECTION_ORDINARY, runtimev1.WorldImageProjection_WORLD_IMAGE_PROJECTION_EQUIRECTANGULAR_360} {
		t.Run(projection.String(), func(t *testing.T) {
			spec, ref := worldImageFixture(t, projection)
			original := bytes.Clone(ref.Bytes)
			ctx := WithImageReference(loopbackProviderTestContext(context.Background()), ref)
			ref.Bytes[0] ^= 0xff
			uploads, submits, polls := 0, 0, 0
			var providerURL string
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if strings.HasPrefix(r.URL.Path, "/v1/") && r.Header.Get("Authorization") != "Bearer test-key" {
					t.Error("missing API authentication")
				}
				switch r.URL.Path {
				case "/v1/files":
					uploads++
					if err := r.ParseMultipartForm(1 << 20); err != nil {
						t.Error(err)
						return
					}
					defer func() { _ = r.MultipartForm.RemoveAll() }()
					file, _, err := r.FormFile("file")
					if err != nil {
						t.Error(err)
						return
					}
					defer func() { _ = file.Close() }()
					body, _ := io.ReadAll(file)
					if !bytes.Equal(body, original) {
						t.Error("immutable source capture changed")
					}
					_ = json.NewEncoder(w).Encode(map[string]any{"file_id": "file_owned"})
				case "/v1/worlds":
					submits++
					if r.Header.Get("Idempotency-Key") != "nimi-world-job-owned" {
						t.Error("missing stable captured submission identity")
					}
					var payload map[string]any
					_ = json.NewDecoder(r.Body).Decode(&payload)
					input, _ := payload["input"].(map[string]any)
					visibility, _ := payload["visibility"].(map[string]any)
					if input["type"] != "file_id" || input["file_id"] != "file_owned" || input["is_pano"] != (projection == runtimev1.WorldImageProjection_WORLD_IMAGE_PROJECTION_EQUIRECTANGULAR_360) || input["prompt"] != nil || payload["model"] != "default" || visibility["is_public"] != false || visibility["is_listed"] != false {
						t.Errorf("incorrect mapping: %+v", payload)
					}
					_ = json.NewEncoder(w).Encode(map[string]any{"request_id": "req_owned"})
				case "/v1/worlds/requests/req_owned/status":
					polls++
					_ = json.NewEncoder(w).Encode(map[string]any{"request_id": "req_owned", "status": "COMPLETED"})
				case "/v1/worlds/requests/req_owned/splat":
					http.Redirect(w, r, providerURL+"/signed-scene", http.StatusFound)
				case "/signed-scene":
					if r.Header.Get("Authorization") != "" {
						t.Error("credential reached signed scene")
					}
					_, _ = w.Write(spaitialSPZFixture(t))
				case "/v1/worlds/requests/req_owned":
					_ = json.NewEncoder(w).Encode(map[string]any{"request_id": "req_owned", "status": "COMPLETED", "model": "default", "world": map[string]any{"id": "world_owned", "splat_format": "spz", "camera": map[string]any{"hfov_deg": 100, "roll_deg": 0, "pitch_deg": 0}}})
				default:
					t.Error("unexpected provider request")
					http.NotFound(w, r)
				}
			}))
			defer server.Close()
			providerURL = server.URL
			req := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_WORLD_GENERATE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_WorldGenerate{WorldGenerate: spec}}}
			result, err := ExecuteSpaitialWorld(ctx, MediaAdapterConfig{BaseURL: server.URL, APIKey: "test-key", AllowLoopbackEndpoint: true}, noopJobStateUpdater{}, "job-owned", req, "default")
			if result.ProviderJobID != "req_owned" || len(result.Artifacts) != 2 || result.Usage != nil || err != nil || uploads != 1 || submits != 1 || polls != 1 {
				t.Fatalf("result=%+v err=%v requests=%d/%d/%d", result, err, uploads, submits, polls)
			}
			body := result.ArtifactBodies[result.Artifacts[1].GetArtifactId()].Stream
			data, err := io.ReadAll(body)
			_ = body.Close()
			if err != nil {
				t.Fatal(err)
			}
			archive, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
			if err != nil || len(archive.File) != 2 {
				t.Fatalf("archive: %v", err)
			}
			metadata, err := archive.File[0].Open()
			if err != nil {
				t.Fatal(err)
			}
			var value map[string]any
			err = json.NewDecoder(metadata).Decode(&value)
			_ = metadata.Close()
			if err != nil || value["calibrationState"] != "uncalibrated" || value["splatCoordinateSystem"] != "opencv" || value["metricScaleFactor"] != nil || value["groundPlaneOffset"] != nil {
				t.Fatalf("spatial facts=%v err=%v", value, err)
			}
			scene, err := archive.File[1].Open()
			if err != nil {
				t.Fatal(err)
			}
			sceneBytes, err := io.ReadAll(scene)
			_ = scene.Close()
			if err != nil || !bytes.Equal(sceneBytes, spaitialSPZFixture(t)) {
				t.Fatal("axis declaration changed the original compressed scene bytes")
			}

		})
	}
}

func TestSpaitialCannotSilentlyDropImagePromptOrUnsupportedOptions(t *testing.T) {
	spec, ref := worldImageFixture(t, runtimev1.WorldImageProjection_WORLD_IMAGE_PROJECTION_ORDINARY)
	spec.TextPrompt = "keep this instruction"
	if err := ValidateCloudWorldImageReference("spaitial", spec, ref); err == nil {
		t.Fatal("image prompt silently discarded")
	}
	if err := ValidateCloudWorldImageReference("worldlabs", spec, ref); err != nil {
		t.Fatalf("Marble combination regressed: %v", err)
	}
	spec.TextPrompt = ""
	spec.Seed = 1
	if err := ValidateCloudWorldRequestFields("spaitial", spec); err == nil {
		t.Fatal("seed silently discarded")
	}
	spec.Seed = 0
	spec.DisplayName = strings.Repeat("世", 201)
	if err := ValidateCloudWorldRequestFields("spaitial", spec); err == nil {
		t.Fatal("unsupported title accepted")
	}
}

func TestSpaitialControlCredentialNeverFollowsRedirect(t *testing.T) {
	hits := 0
	destination := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits++; t.Error("control request followed redirect") }))
	defer destination.Close()
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, destination.URL, http.StatusFound) }))
	defer proxy.Close()
	var out map[string]any
	err := spaitialJSON(loopbackProviderTestContext(context.Background()), MediaAdapterConfig{BaseURL: proxy.URL, APIKey: "test-key"}, http.MethodGet, "/v1/models", nil, "", &out)
	if err == nil || hits != 0 {
		t.Fatalf("redirect err=%v hits=%d", err, hits)
	}
	for _, raw := range []string{"https://api.spaitial.ai.evil.example", "https://api.spaitial.ai:8443", "https://api.spaitial.ai/path", "https://key@api.spaitial.ai", "http://api.spaitial.ai"} {
		if _, err := spaitialControlOrigin(context.Background(), raw); err == nil {
			t.Errorf("uncontrolled origin accepted: %s", raw)
		}
	}
}

func TestSpaitialCancelAcknowledgmentIsNotConfirmedStop(t *testing.T) {
	for _, state := range []string{"PROCESSING", "CANCELLED"} {
		t.Run(state, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if strings.HasSuffix(r.URL.Path, "/cancel") {
					_ = json.NewEncoder(w).Encode(map[string]any{"request_id": "req_owned", "accepted": true})
					return
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"request_id": "req_owned", "status": state})
			}))
			defer server.Close()
			outcome, err := DeleteProviderAsyncTask(loopbackProviderTestContext(context.Background()), AdapterSpaitialNative, "req_owned", MediaAdapterConfig{BaseURL: server.URL, APIKey: "test-key", AllowLoopbackEndpoint: true})
			want := ProviderTaskCleanupUnconfirmed
			if state == "CANCELLED" {
				want = ProviderTaskCleanupCanceled
			}
			if err != nil || outcome != want {
				t.Fatalf("outcome=%v err=%v", outcome, err)
			}
		})
	}
}

func TestSpaitialLostReceiptUsesOneCapturedIdempotentProviderOperation(t *testing.T) {
	var mu sync.Mutex
	var firstBody []byte
	posts, creations, waits := 0, 0, 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/worlds" || r.Method != http.MethodPost || r.Header.Get("Idempotency-Key") != "nimi-world-captured" {
			t.Error("changed operation identity or attempted another endpoint")
		}
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		posts++
		first := posts == 1
		if first {
			firstBody = bytes.Clone(body)
			creations++
		} else if !bytes.Equal(firstBody, body) {
			t.Error("receipt replay changed captured body")
		}
		mu.Unlock()
		if first {
			// The handler records one operation before dropping its HTTP receipt.
			conn, _, err := w.(http.Hijacker).Hijack()
			if err != nil {
				t.Error(err)
				return
			}
			_ = conn.Close()
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"request_id": "req_original"})
	}))
	defer server.Close()
	ctx := WithProviderPollWait(loopbackProviderTestContext(context.Background()), func(context.Context, time.Duration) error { waits++; return nil })
	payload := map[string]any{"model": "default", "input": map[string]any{"type": "file_id", "file_id": "file_captured", "is_pano": true}}
	var result map[string]any
	err := submitSpaitialWorld(ctx, MediaAdapterConfig{BaseURL: server.URL, APIKey: "test-key"}, payload, "nimi-world-captured", &result)
	if err != nil || result["request_id"] != "req_original" || posts != 2 || creations != 1 || waits != 1 {
		t.Fatalf("receipt result=%v err=%v posts=%d creations=%d waits=%d", result, err, posts, creations, waits)
	}
}

func TestSpaitialReceiptRetrievalIsBoundedAndDoesNotRetryAdmissionRejection(t *testing.T) {
	for _, code := range []int{http.StatusUnauthorized, http.StatusBadRequest, http.StatusConflict, http.StatusServiceUnavailable} {
		t.Run(http.StatusText(code), func(t *testing.T) {
			posts := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				posts++
				w.WriteHeader(code)
				_, _ = w.Write([]byte(`{"error":{"code":"rejected","message":"rejected"}}`))
			}))
			defer server.Close()
			ctx := WithProviderPollWait(loopbackProviderTestContext(context.Background()), func(context.Context, time.Duration) error { return nil })
			var result map[string]any
			err := submitSpaitialWorld(ctx, MediaAdapterConfig{BaseURL: server.URL, APIKey: "test-key"}, map[string]any{"input": map[string]any{"type": "text", "prompt": "captured"}}, "nimi-world-captured", &result)
			want := 1
			if code == http.StatusServiceUnavailable {
				want = 3
			}
			if err == nil || posts != want {
				t.Fatalf("err=%v attempts=%d want=%d", err, posts, want)
			}
		})
	}
}

func spaitialSPZFixture(t *testing.T) []byte {
	t.Helper()
	raw := make([]byte, 36)
	binary.LittleEndian.PutUint32(raw, 0x5053474e)
	binary.LittleEndian.PutUint32(raw[4:], 3)
	binary.LittleEndian.PutUint32(raw[8:], 1)
	raw[13] = 12
	var buffer bytes.Buffer
	writer := gzip.NewWriter(&buffer)
	if _, err := writer.Write(raw); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func TestSpaitialSceneStreamRejectsTruncationAndCRCFailure(t *testing.T) {
	valid := spaitialSPZFixture(t)
	corrupted := bytes.Clone(valid)
	corrupted[len(corrupted)-8] ^= 1
	for _, data := range [][]byte{valid[:len(valid)-5], corrupted, []byte("not-spz")} {
		body := verifiedSpaitialSPZStream(io.NopCloser(bytes.NewReader(data)))
		_, err := io.ReadAll(body)
		_ = body.Close()
		if err == nil {
			t.Fatal("incomplete or invalid scene accepted")
		}
	}
}
