package ai

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/binary"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"google.golang.org/protobuf/types/known/structpb"
)

func worldPollSPZFixture(t *testing.T) []byte {
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

func worldPollServiceFixture(t *testing.T, provider, endpoint string, wait func(context.Context, time.Duration) error) (managedCloudScenarioTestFixture, context.Context) {
	t.Helper()
	model := "default"
	if provider == "worldlabs" {
		model = "marble-1.1"
	}
	f := newManagedCloudScenarioTestFixture(t, provider, model, endpoint, Config{AllowLoopbackEndpoint: true, providerPollWait: wait})
	target, err := structpb.NewStruct(map[string]any{
		"provider": provider, "providerModelId": model, "remoteModelCatalogId": f.descriptor.GetRemoteModelCatalogId(),
	})
	if err != nil {
		t.Fatal(err)
	}
	ctx := executionintent.WithIntent(f.context, executionintent.Intent{
		CapabilityContract: "world.generate", Route: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD, ConnectorRef: f.connectorID,
		CloudImplementation: &runtimev1.CapabilityImplementationIdentity{ImplementationId: provider, DriverId: "nimillm", DriverDialect: provider},
		ProviderModelTarget: target,
	})
	return f, ctx
}

func worldPollJobRequest(timeoutMS int32) *runtimev1.SubmitScenarioJobRequest {
	return &runtimev1.SubmitScenarioJobRequest{
		Head:         &runtimev1.ScenarioRequestHead{AppId: "nimi.desktop", SubjectUserId: "user-001", TimeoutMs: timeoutMS},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_WORLD_GENERATE,
		Spec:         &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_WorldGenerate{WorldGenerate: &runtimev1.WorldGenerateScenarioSpec{TextPrompt: "A fictional reading room."}}},
	}
}

// This traverses SubmitScenarioJob's real WithTimeout context, production
// Driver/Remote Host, HTTP transport, normalization and Runtime custody.
// The scheduling seam removes backoff delays, never the owner deadline.
func TestWorldJobDeadlineSurvivesTransientStatusAndResultEOF(t *testing.T) {
	for _, provider := range []string{"spaitial", "worldlabs"} {
		t.Run(provider, func(t *testing.T) {
			var posts, polls, results, downloads, waits atomic.Int32
			scene := worldPollSPZFixture(t)
			var endpoint string
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				switch r.URL.Path {
				case "/v1/worlds", "/marble/v1/worlds:generate":
					posts.Add(1)
					w.WriteHeader(http.StatusAccepted)
					_ = json.NewEncoder(w).Encode(map[string]any{"request_id": "req_original", "operation_id": "operation-original"})
				case "/v1/worlds/requests/req_original/status", "/marble/v1/operations/operation-original":
					n := polls.Add(1)
					if n == 2 {
						closeWorldPollHTTPConnection(t, w)
						return
					}
					state := "PROCESSING"
					if n > 2 {
						state = "COMPLETED"
					}
					_ = json.NewEncoder(w).Encode(map[string]any{"request_id": "req_original", "status": state, "done": n > 2, "metadata": map[string]any{"world_id": "world-original"}})
				case "/v1/worlds/requests/req_original", "/marble/v1/worlds/world-original":
					if results.Add(1) == 1 {
						closeWorldPollHTTPConnection(t, w)
						return
					}
					result := map[string]any{"request_id": "req_original", "status": "COMPLETED", "model": "default", "world": map[string]any{"id": "world-original", "splat_format": "spz"}}
					if provider == "worldlabs" {
						result = map[string]any{"world_id": "world-original", "assets": map[string]any{"splats": map[string]any{"spz_urls": map[string]any{"500k": endpoint + "/signed-scene"}, "semantics_metadata": map[string]any{"metric_scale_factor": 1.2, "ground_plane_offset": 0.0}}}}
					}
					_ = json.NewEncoder(w).Encode(result)
				case "/v1/worlds/requests/req_original/splat":
					http.Redirect(w, r, endpoint+"/signed-scene", http.StatusFound)
				case "/signed-scene":
					downloads.Add(1)
					if r.Header.Get("Authorization") != "" || r.Header.Get("WLT-Api-Key") != "" {
						t.Error("credential escaped to signed asset")
					}
					_, _ = w.Write(scene)
				default:
					t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
					http.NotFound(w, r)
				}
			}))
			defer server.Close()
			endpoint = server.URL
			f, ctx := worldPollServiceFixture(t, provider, endpoint, func(ctx context.Context, _ time.Duration) error {
				waits.Add(1)
				deadline, ok := ctx.Deadline()
				if !ok || time.Until(deadline) < 14*time.Minute || ctx.Err() != nil {
					t.Error("production World Job lost its unexpired default deadline")
				}
				return ctx.Err()
			})
			response, err := f.service.SubmitScenarioJob(ctx, worldPollJobRequest(0))
			if err != nil {
				t.Fatal(err)
			}
			terminal := waitForScenarioJobTerminalForLocalTextTest(t, f.service, response.GetJob().GetJobId())
			if terminal.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
				t.Fatalf("unexpired World Job ended after a recoverable read error: %v", terminal)
			}
			if posts.Load() != 1 || polls.Load() != 3 || results.Load() != 2 || downloads.Load() != 1 || waits.Load() != 3 {
				t.Fatalf("requests posts=%d polls=%d results=%d downloads=%d waits=%d", posts.Load(), polls.Load(), results.Load(), downloads.Load(), waits.Load())
			}
			if terminal.GetProviderJobId() != "" || terminal.GetRetryCount() != 0 || terminal.GetNextPollAt() != nil {
				t.Fatal("private provider polling state escaped into public Job")
			}
			if len(terminal.GetArtifacts()) != 2 {
				t.Fatal("production Runtime custody did not publish the complete manifest and archive")
			}
			for _, artifact := range terminal.GetArtifacts() {
				if artifact.GetSizeBytes() == 0 || artifact.GetSha256() == "" || artifact.GetArtifactId() == "" {
					t.Fatal("Runtime custody artifact is incomplete")
				}
			}
		})
	}
}

func closeWorldPollHTTPConnection(t *testing.T, w http.ResponseWriter) {
	t.Helper()
	conn, _, err := w.(http.Hijacker).Hijack()
	if err != nil {
		t.Error(err)
		return
	}
	_ = conn.Close()
}

func TestWorldJobReadRetriesRespectOwnerTerminationAndPermanentErrors(t *testing.T) {
	for _, provider := range []string{"spaitial", "worldlabs"} {
		for _, mode := range []string{"auth", "input", "unsupported-status", "status-identity", "result-identity", "result-format", "exhausted", "deadline", "cancel"} {
			t.Run(provider+"/"+mode, func(t *testing.T) {
				var posts, polls, results, waits atomic.Int32
				var canceled atomic.Bool
				waiting := make(chan struct{}, 1)
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.Header().Set("Content-Type", "application/json")
					switch r.URL.Path {
					case "/v1/worlds", "/marble/v1/worlds:generate":
						posts.Add(1)
						w.WriteHeader(http.StatusAccepted)
						_ = json.NewEncoder(w).Encode(map[string]any{"request_id": "req_original", "operation_id": "operation-original"})
					case "/v1/worlds/requests/req_original/cancel":
						canceled.Store(true)
						_ = json.NewEncoder(w).Encode(map[string]any{"request_id": "req_original", "accepted": true})
					case "/v1/worlds/requests/req_original/status", "/marble/v1/operations/operation-original":
						if canceled.Load() {
							_ = json.NewEncoder(w).Encode(map[string]any{"request_id": "req_original", "status": "CANCELLED"})
							return
						}
						polls.Add(1)
						switch mode {
						case "auth":
							w.WriteHeader(http.StatusUnauthorized)
						case "input":
							w.WriteHeader(http.StatusBadRequest)
						case "unsupported-status":
							w.WriteHeader(http.StatusNotImplemented)
						case "status-identity":
							_ = json.NewEncoder(w).Encode(map[string]any{"request_id": "another-request", "status": "COMPLETED", "done": true, "metadata": map[string]any{"world_id": "world-original"}, "response": map[string]any{"id": "another-world"}})
						case "result-identity", "result-format":
							_ = json.NewEncoder(w).Encode(map[string]any{"request_id": "req_original", "status": "COMPLETED", "done": true, "metadata": map[string]any{"world_id": "world-original"}})
						case "exhausted", "deadline", "cancel":
							w.WriteHeader(http.StatusServiceUnavailable)
						}
					case "/v1/worlds/requests/req_original", "/marble/v1/worlds/world-original":
						results.Add(1)
						result := map[string]any{"request_id": "another-request", "world_id": "another-world", "status": "COMPLETED"}
						if mode == "result-format" {
							result = map[string]any{"request_id": "req_original", "status": "COMPLETED", "model": "default", "world": map[string]any{"id": "world-original", "splat_format": "sog"}}
							if provider == "worldlabs" {
								result = map[string]any{"world_id": "world-original", "assets": map[string]any{"splats": map[string]any{"spz_urls": map[string]any{"500k": "not-an-asset"}, "semantics_metadata": map[string]any{"metric_scale_factor": "invalid", "ground_plane_offset": 0}}}}
							}
						}
						_ = json.NewEncoder(w).Encode(result)
					default:
						t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
						http.NotFound(w, r)
					}
				}))
				defer server.Close()
				wait := func(ctx context.Context, _ time.Duration) error {
					waits.Add(1)
					if _, ok := ctx.Deadline(); !ok {
						t.Error("formal Job read retry lost deadline")
					}
					if mode == "cancel" {
						waiting <- struct{}{}
						<-ctx.Done()
					}
					return ctx.Err()
				}
				if mode == "deadline" {
					// The production backoff timer must yield to the actual owner
					// deadline, rather than a synthetic timeout returned by a seam.
					wait = nil
				}
				f, ctx := worldPollServiceFixture(t, provider, server.URL, wait)
				timeoutMS := int32(0)
				if mode == "deadline" {
					timeoutMS = 100
				}
				response, err := f.service.SubmitScenarioJob(ctx, worldPollJobRequest(timeoutMS))
				if err != nil {
					t.Fatal(err)
				}
				if mode == "cancel" {
					select {
					case <-waiting:
					case <-time.After(time.Second):
						t.Fatal("World Job did not enter retry backoff")
					}
					if _, err := f.service.CancelScenarioJob(ctx, &runtimev1.CancelScenarioJobRequest{JobId: response.GetJob().GetJobId(), Reason: "cancel in retry backoff"}); err != nil {
						t.Fatal(err)
					}
				}
				terminal := waitForScenarioJobTerminalForLocalTextTest(t, f.service, response.GetJob().GetJobId())
				wantStatus, wantPolls, wantWaits, wantResults := runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED, int32(1), int32(0), int32(0)
				switch mode {
				case "result-identity", "result-format":
					wantResults = 1
				case "exhausted":
					wantPolls, wantWaits = 10, 9
				case "deadline":
					wantStatus = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_TIMEOUT
				case "cancel":
					wantStatus, wantWaits = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED, 1
				}
				if terminal.GetStatus() != wantStatus || len(terminal.GetArtifacts()) != 0 {
					t.Fatalf("unexpected terminal semantics or late output: %v", terminal)
				}
				if posts.Load() != 1 || polls.Load() != wantPolls || waits.Load() != wantWaits || results.Load() != wantResults {
					t.Fatalf("requests posts=%d polls=%d waits=%d results=%d; expected 1/%d/%d/%d", posts.Load(), polls.Load(), waits.Load(), results.Load(), wantPolls, wantWaits, wantResults)
				}
			})
		}
	}
}
