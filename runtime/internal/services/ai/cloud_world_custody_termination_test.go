package ai

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// Exercise the production Submit -> Driver -> Host -> HTTP stream -> custody path.
func TestWorldCustodyTerminationKeepsOwnerClassification(t *testing.T) {
	for _, mode := range []string{"deadline", "cancel", "invalid", "processing-deadline"} {
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
			timeout := int32(0)
			if mode == "deadline" || mode == "processing-deadline" {
				timeout = 300
			}
			response, err := f.service.SubmitScenarioJob(ctx, worldPollJobRequest(timeout))
			if err != nil {
				t.Fatal(err)
			}
			if mode == "cancel" {
				<-started
				if _, err := f.service.CancelScenarioJob(ctx, &runtimev1.CancelScenarioJobRequest{JobId: response.GetJob().GetJobId()}); err != nil {
					t.Fatal(err)
				}
			}
			terminal := waitForScenarioJobTerminalForLocalTextTest(t, f.service, response.GetJob().GetJobId())
			wantStatus, wantReason := runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL
			if mode == "deadline" || mode == "processing-deadline" {
				wantStatus, wantReason = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_TIMEOUT, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT
			} else if mode == "cancel" {
				wantStatus, wantReason = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED, runtimev1.ReasonCode_ACTION_EXECUTED
			}
			if terminal.GetStatus() != wantStatus || terminal.GetReasonCode() != wantReason || len(terminal.GetArtifacts()) != 0 {
				t.Fatalf("terminal=%v", terminal)
			}
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
