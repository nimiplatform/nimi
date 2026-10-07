package nimillm

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestSpaitialOwnerTerminationAttemptsBoundedCleanup(t *testing.T) {
	for _, termination := range []string{"cancel", "deadline"} {
		for _, outcome := range []string{"confirmed", "unconfirmed", "failed"} {
			t.Run(termination+"/"+outcome, func(t *testing.T) {
				var posts, cancels atomic.Int32
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.Header().Set("Content-Type", "application/json")
					switch r.URL.Path {
					case "/v1/worlds":
						posts.Add(1)
						_ = json.NewEncoder(w).Encode(map[string]any{"request_id": "req_cleanup"})
					case "/v1/worlds/requests/req_cleanup/cancel":
						cancels.Add(1)
						if outcome == "failed" {
							w.WriteHeader(http.StatusServiceUnavailable)
							return
						}
						_ = json.NewEncoder(w).Encode(map[string]any{"accepted": true})
					case "/v1/worlds/requests/req_cleanup/status":
						state := "PROCESSING"
						if cancels.Load() > 0 && outcome == "confirmed" {
							state = "CANCELLED"
						}
						_ = json.NewEncoder(w).Encode(map[string]any{"request_id": "req_cleanup", "status": state})
					default:
						http.NotFound(w, r)
					}
				}))
				defer server.Close()
				ctx, cancel := context.WithTimeout(loopbackProviderTestContext(context.Background()), 300*time.Millisecond)
				defer cancel()
				ctx = WithProviderPollWait(ctx, func(ctx context.Context, _ time.Duration) error {
					if termination == "cancel" {
						cancel()
					}
					<-ctx.Done()
					return ctx.Err()
				})
				var observations []ProviderTaskCleanupObservation
				ctx = WithProviderTaskCleanupObserver(ctx, func(value ProviderTaskCleanupObservation) { observations = append(observations, value) })
				req := &runtimev1.SubmitScenarioJobRequest{Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_WorldGenerate{WorldGenerate: &runtimev1.WorldGenerateScenarioSpec{TextPrompt: "A room"}}}}
				_, err := ExecuteSpaitialWorld(ctx, MediaAdapterConfig{BaseURL: server.URL, APIKey: "test-key", AllowLoopbackEndpoint: true}, noopGeminiJobUpdater{}, "cleanup-job", req, "default")
				if err == nil || posts.Load() != 1 || cancels.Load() != 1 || len(observations) != 1 {
					t.Fatalf("err=%v posts=%d cancels=%d observations=%v", err, posts.Load(), cancels.Load(), observations)
				}
				want := ProviderTaskCleanupUnconfirmed
				if outcome == "confirmed" {
					want = ProviderTaskCleanupCanceled
				} else if outcome == "failed" {
					want = ProviderTaskCleanupFailed
				}
				if observations[0].Outcome != want {
					t.Fatalf("cleanup=%v want=%v", observations[0], want)
				}
			})
		}
	}
}

func TestSpaitialCompletedTaskResultDeadlineDoesNotCancel(t *testing.T) {
	var cancels, results atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/worlds":
			_ = json.NewEncoder(w).Encode(map[string]any{"request_id": "req_done"})
		case "/v1/worlds/requests/req_done/status":
			_ = json.NewEncoder(w).Encode(map[string]any{"request_id": "req_done", "status": "COMPLETED"})
		case "/v1/worlds/requests/req_done":
			results.Add(1)
			<-r.Context().Done()
		case "/v1/worlds/requests/req_done/cancel":
			cancels.Add(1)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(loopbackProviderTestContext(context.Background()), 300*time.Millisecond)
	defer cancel()
	req := &runtimev1.SubmitScenarioJobRequest{Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_WorldGenerate{WorldGenerate: &runtimev1.WorldGenerateScenarioSpec{TextPrompt: "A room"}}}}
	_, err := ExecuteSpaitialWorld(ctx, MediaAdapterConfig{BaseURL: server.URL, APIKey: "test-key", AllowLoopbackEndpoint: true}, noopGeminiJobUpdater{}, "completed-job", req, "default")
	if err == nil || results.Load() != 1 || cancels.Load() != 0 {
		t.Fatalf("err=%v result reads=%d completed-task cancel attempts=%d", err, results.Load(), cancels.Load())
	}
}
