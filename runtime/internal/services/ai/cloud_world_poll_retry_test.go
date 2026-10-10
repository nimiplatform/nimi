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
func TestWorldFreshGetKeepsOriginalTaskAcrossTransientObservation(t *testing.T) {
	for _, provider := range []string{"spaitial", "worldlabs"} {
		t.Run(provider, func(t *testing.T) {
			var stage, creates, queries, results, downloads atomic.Int32
			scene := worldPollSPZFixture(t)
			var endpoint string
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				switch r.URL.Path {
				case "/v1/worlds", "/marble/v1/worlds:generate":
					creates.Add(1)
					json.NewEncoder(w).Encode(map[string]any{"request_id": "req_original", "operation_id": "operation-original"})
				case "/v1/worlds/requests/req_original/status", "/marble/v1/operations/operation-original":
					queries.Add(1)
					if stage.Load() == 0 {
						w.WriteHeader(503)
						w.Write([]byte(`{"error":"temporarily unavailable"}`))
						return
					}
					if provider == "spaitial" {
						state := "PROCESSING"
						if stage.Load() == 2 {
							state = "COMPLETED"
						}
						json.NewEncoder(w).Encode(map[string]any{"request_id": "req_original", "status": state})
					} else {
						json.NewEncoder(w).Encode(map[string]any{"done": stage.Load() == 2, "metadata": map[string]any{"world_id": "world-original"}})
					}
				case "/v1/worlds/requests/req_original", "/marble/v1/worlds/world-original":
					results.Add(1)
					if provider == "spaitial" {
						json.NewEncoder(w).Encode(map[string]any{"request_id": "req_original", "status": "COMPLETED", "model": "default", "world": map[string]any{"id": "world-original", "splat_format": "spz"}})
					} else {
						json.NewEncoder(w).Encode(map[string]any{"world_id": "world-original", "assets": map[string]any{"splats": map[string]any{"spz_urls": map[string]any{"500k": endpoint + "/scene"}, "semantics_metadata": map[string]any{"metric_scale_factor": 1.0, "ground_plane_offset": 0.0}}}})
					}
				case "/v1/worlds/requests/req_original/splat":
					http.Redirect(w, r, endpoint+"/scene", 302)
				case "/scene":
					downloads.Add(1)
					if r.Header.Get("Authorization") != "" || r.Header.Get("WLT-Api-Key") != "" {
						t.Error("credential reached asset")
					}
					w.Header().Set("Content-Type", "application/octet-stream")
					w.Write(scene)
				default:
					t.Errorf("unexpected original-task IO %s", r.URL.Path)
					http.NotFound(w, r)
				}
			}))
			defer server.Close()
			endpoint = server.URL
			f, ctx := worldPollServiceFixture(t, provider, endpoint, nil)
			submitted, err := f.service.SubmitScenarioJob(ctx, worldPollJobRequest(0))
			if err != nil {
				t.Fatal(err)
			}
			id := submitted.GetJob().GetJobId()
			waitNativeReceiptHandoff(t, f.service, id)
			if creates.Load() != 1 || queries.Load() != 0 {
				t.Fatalf("create polled: %d/%d", creates.Load(), queries.Load())
			}
			first, err := f.service.GetScenarioJob(ctx, &runtimev1.GetScenarioJobRequest{JobId: id})
			if err != nil || first.GetJob().GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING || first.GetObservationIssue().GetReasonCode() != runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE || queries.Load() != 1 {
				t.Fatalf("transient query terminalized/retried: %v %v queries=%d", first, err, queries.Load())
			}
			stage.Store(1)
			pending, err := f.service.GetScenarioJob(ctx, &runtimev1.GetScenarioJobRequest{JobId: id})
			if err != nil || pending.GetObservationIssue() != nil || pending.GetJob().GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING || results.Load() != 0 || downloads.Load() != 0 {
				t.Fatalf("pending observation: %v %v", pending, err)
			}
			stage.Store(2)
			completed, err := f.service.GetScenarioJob(ctx, &runtimev1.GetScenarioJobRequest{JobId: id})
			if err != nil || completed.GetJob().GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || len(completed.GetJob().GetArtifacts()) != 2 || downloads.Load() != 1 || creates.Load() != 1 {
				t.Fatalf("complete original World: %v %v downloads=%d creates=%d", completed, err, downloads.Load(), creates.Load())
			}
			if completed.GetJob().GetUsage() != nil {
				t.Fatal("World completion invented token usage")
			}
		})
	}
}

func waitNativeReceiptHandoff(t *testing.T, svc *Service, id string) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for svc.scenarioJobs.originalNativeReceipt(id) == nil {
		if time.Now().After(deadline) {
			job, _ := svc.scenarioJobs.get(id)
			t.Fatalf("native receipt not handed off: %v", job)
		}
		time.Sleep(time.Millisecond)
	}
	waitScenarioJobWorkExit(t, svc.scenarioJobs, id)
}
