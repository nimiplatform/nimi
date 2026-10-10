package nimillm

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestSpaitialExplicitStopRequiresFreshRequestAndTerminalProof(t *testing.T) {
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
				var receipt *NativeTaskReceipt
				ctx, cancel := context.WithTimeout(loopbackProviderTestContext(context.Background()), 60*time.Millisecond)
				defer cancel()
				ctx = WithNativeTaskPublisher(ctx, func(r *NativeTaskReceipt) error { receipt = CloneNativeTaskReceipt(r); return nil })
				req := &runtimev1.SubmitScenarioJobRequest{Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_WorldGenerate{WorldGenerate: &runtimev1.WorldGenerateScenarioSpec{TextPrompt: "A room"}}}}
				_, err := ExecuteSpaitialWorld(ctx, MediaAdapterConfig{BaseURL: server.URL, APIKey: "test-key", AllowLoopbackEndpoint: true}, noopGeminiJobUpdater{}, "cleanup-job", req, "default")
				if !errors.Is(err, ErrNativeTaskYielded) || posts.Load() != 1 || cancels.Load() != 0 {
					t.Fatalf("handoff: %v", err)
				}
				if termination == "cancel" {
					cancel()
				}
				<-ctx.Done()
				if cancels.Load() != 0 {
					t.Fatal("observer end canceled native work")
				}
				cfg := MediaAdapterConfig{BaseURL: server.URL, APIKey: "test-key", AllowLoopbackEndpoint: true}
				cleanup, err := DeleteProviderAsyncTask(loopbackProviderTestContext(context.Background()), AdapterSpaitialNative, receipt.TaskID, cfg)
				if posts.Load() != 1 || cancels.Load() != 1 {
					t.Fatalf("explicit stop IO: posts=%d cancels=%d", posts.Load(), cancels.Load())
				}

				want := ProviderTaskCleanupUnconfirmed
				if outcome == "confirmed" {
					want = ProviderTaskCleanupCanceled
				} else if outcome == "failed" {
					want = ProviderTaskCleanupFailed
				}
				if cleanup != want {
					t.Fatalf("cleanup=%v want=%v err=%v", cleanup, want, err)
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
	var receipt *NativeTaskReceipt
	createCtx := WithNativeTaskPublisher(loopbackProviderTestContext(context.Background()), func(r *NativeTaskReceipt) error { receipt = CloneNativeTaskReceipt(r); return nil })
	_, err := ExecuteSpaitialWorld(createCtx, MediaAdapterConfig{BaseURL: server.URL, APIKey: "test-key", AllowLoopbackEndpoint: true}, noopGeminiJobUpdater{}, "completed-job", req, "default")
	if !errors.Is(err, ErrNativeTaskYielded) {
		t.Fatalf("create: %v", err)
	}
	_, terminal, err := ObserveNativeTask(ctx, MediaAdapterConfig{BaseURL: server.URL, APIKey: "test-key", AllowLoopbackEndpoint: true}, receipt)
	if terminal {
		t.Fatal("result read timeout terminalized remote task")
	}

	if err == nil || results.Load() != 1 || cancels.Load() != 0 {
		t.Fatalf("err=%v result reads=%d completed-task cancel attempts=%d", err, results.Load(), cancels.Load())
	}
}
