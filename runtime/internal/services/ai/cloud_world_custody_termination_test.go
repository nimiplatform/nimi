package ai

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// Exercise the production Submit -> Driver -> Host -> HTTP stream -> custody path.
func TestWorldCustodyTerminationKeepsOwnerClassification(t *testing.T) {
	for _, mode := range []string{"cancel", "invalid"} {
		t.Run(mode, func(t *testing.T) {
			var endpoint string
			var downloads, cancels atomic.Int32
			started := make(chan struct{}, 1)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				switch r.URL.Path {
				case "/v1/worlds":
					_ = json.NewEncoder(w).Encode(map[string]any{"request_id": "req_custody"})
				case "/v1/worlds/requests/req_custody/status":
					state := "COMPLETED"
					if mode == "processing-deadline" {
						state = "PROCESSING"
					}
					_ = json.NewEncoder(w).Encode(map[string]any{"request_id": "req_custody", "status": state})
				case "/v1/worlds/requests/req_custody":
					_ = json.NewEncoder(w).Encode(map[string]any{"request_id": "req_custody", "status": "COMPLETED", "model": "default", "world": map[string]any{"id": "world_custody", "splat_format": "spz"}})
				case "/v1/worlds/requests/req_custody/splat":
					http.Redirect(w, r, endpoint+"/scene", http.StatusFound)
				case "/scene":
					downloads.Add(1)
					w.Header().Set("Content-Type", "application/octet-stream")
					w.WriteHeader(http.StatusOK)
					w.(http.Flusher).Flush()
					started <- struct{}{}
					if mode == "invalid" {
						_, _ = w.Write([]byte("not an SPZ archive"))
						return
					}
					<-r.Context().Done()
				case "/v1/worlds/requests/req_custody/cancel":
					cancels.Add(1)
					_ = json.NewEncoder(w).Encode(map[string]any{"accepted": true})
				default:
					http.NotFound(w, r)
				}
			}))
			defer server.Close()
			endpoint = server.URL
			f, ctx := worldPollServiceFixture(t, "spaitial", endpoint, nil)
			response, err := f.service.SubmitScenarioJob(ctx, worldPollJobRequest(0))
			if err != nil {
				t.Fatal(err)
			}
			id := response.GetJob().GetJobId()
			waitNativeReceiptHandoff(t, f.service, id)
			observed := make(chan *runtimev1.GetScenarioJobResponse, 1)
			go func() {
				result, err := f.service.GetScenarioJob(ctx, &runtimev1.GetScenarioJobRequest{JobId: id})
				if err != nil {
					t.Error(err)
				}
				observed <- result
			}()
			if mode == "cancel" {
				select {
				case <-started:
				case <-time.After(3 * time.Second):
					t.Fatal("fresh Get did not begin body")
				}
				if _, err := f.service.CancelScenarioJob(ctx, &runtimev1.CancelScenarioJobRequest{JobId: id}); err != nil {
					t.Fatal(err)
				}
			}
			var result *runtimev1.GetScenarioJobResponse
			select {
			case result = <-observed:
			case <-time.After(3 * time.Second):
				t.Fatal("body work did not exit")
			}
			job := result.GetJob()
			if mode == "cancel" {
				if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED || job.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED {
					t.Fatalf("cancel snapshot: %v", job)
				}
			} else {
				if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING || result.GetObservationIssue() == nil {
					t.Fatalf("invalid body terminalized remote task: %v", result)
				}
				f.service.CancelScenarioJob(ctx, &runtimev1.CancelScenarioJobRequest{JobId: id})
			}
			if len(job.GetArtifacts()) != 0 {
				t.Fatal("incomplete World set was publicly attached")
			}
			waitScenarioJobWorkExit(t, f.service.scenarioJobs, id)

			wantDownloads, wantCancels := int32(1), int32(0)
			if mode == "processing-deadline" {
				wantDownloads, wantCancels = 0, 1
			}
			if downloads.Load() != wantDownloads || cancels.Load() != wantCancels {
				t.Fatalf("downloads=%d cancels=%d; completed provider work must not be canceled", downloads.Load(), cancels.Load())
			}
		})
	}
}
