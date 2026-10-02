package nimillm

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestAlibabaTaskCancellationRequiresTerminalConfirmation(t *testing.T) {
	for _, tc := range []struct {
		name       string
		postStatus int
		postBody   string
		getBody    string
		outcome    ProviderTaskCleanupOutcome
		wantErr    bool
	}{
		{"pending canceled", 200, `{"request_id":"request"}`, `{"output":{"task_id":"task-1","task_status":"CANCELED"}}`, ProviderTaskCleanupCanceled, false},
		{"running cannot cancel", 400, `{"code":"UnsupportedOperation","message":"Failed to cancel the task"}`, "", ProviderTaskCleanupNotCancelable, true},
		{"acknowledged still running", 200, `{"request_id":"request"}`, `{"output":{"task_id":"task-1","task_status":"RUNNING"}}`, ProviderTaskCleanupUnconfirmed, true},
		{"wrong task", 200, `{"request_id":"request"}`, `{"output":{"task_id":"other","task_status":"CANCELED"}}`, ProviderTaskCleanupUnconfirmed, true},
		{"malformed response", 200, `{`, "", ProviderTaskCleanupUnconfirmed, true},
		{"provider failure", 503, `{"code":"Unavailable"}`, "", ProviderTaskCleanupFailed, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var posts, gets int
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") != "Bearer scoped-secret" {
					t.Error("missing dispatch-scoped credential")
				}
				switch {
				case r.Method == http.MethodPost && r.URL.Path == "/api/v1/tasks/task-1/cancel":
					posts++
					w.WriteHeader(tc.postStatus)
					fmt.Fprint(w, tc.postBody)
				case r.Method == http.MethodGet && r.URL.Path == "/api/v1/tasks/task-1":
					gets++
					fmt.Fprint(w, tc.getBody)
				default:
					t.Errorf("unexpected cancel transport: %s %s", r.Method, r.URL.Path)
					http.NotFound(w, r)
				}
			}))
			defer server.Close()
			outcome, err := DeleteProviderAsyncTask(context.Background(), AdapterAlibabaNative, "task-1", MediaAdapterConfig{
				BaseURL: server.URL + "/compatible-mode/v1", APIKey: "scoped-secret", AllowLoopbackEndpoint: true,
			})
			if outcome != tc.outcome || (err != nil) != tc.wantErr || posts != 1 || gets > 1 {
				t.Fatalf("outcome=%s err=%v posts=%d gets=%d", outcome, err, posts, gets)
			}
		})
	}
}

func TestAlibabaTaskCancellationTransportFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	server.Close()
	outcome, err := DeleteProviderAsyncTask(context.Background(), AdapterAlibabaNative, "task-1", MediaAdapterConfig{BaseURL: server.URL, AllowLoopbackEndpoint: true})
	if outcome != ProviderTaskCleanupFailed || err == nil {
		t.Fatalf("outcome=%s err=%v", outcome, err)
	}
}

func TestAlibabaPollDeadlineCancelsInFlightRequestAndObservesCleanup(t *testing.T) {
	var polls, cancels atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && r.URL.Path == "/api/v1/tasks/task-1/cancel" {
			cancels.Add(1)
			fmt.Fprint(w, `{"request_id":"cancel-request"}`)
			return
		}
		if r.Method == http.MethodGet && r.URL.Path == "/api/v1/tasks/task-1" {
			if polls.Add(1) == 1 {
				<-r.Context().Done()
				return
			}
			fmt.Fprint(w, `{"output":{"task_id":"task-1","task_status":"CANCELED"}}`)
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(loopbackProviderTestContext(context.Background()), 100*time.Millisecond)
	defer cancel()
	var observed []ProviderTaskCleanupObservation
	ctx = WithProviderTaskCleanupObserver(ctx, func(o ProviderTaskCleanupObservation) { observed = append(observed, o) })
	_, _, _, err := PollProviderTaskForArtifact(ctx, noopJobStateUpdater{}, "job", server.URL, "key", AdapterAlibabaNative, "task-1", "/unused", "/api/v1/tasks/{task_id}", "video/mp4", 0, "prompt", nil, nil)
	if status.Code(err) != codes.DeadlineExceeded || cancels.Load() != 1 || polls.Load() != 2 || len(observed) != 1 || observed[0].Outcome != ProviderTaskCleanupCanceled {
		t.Fatalf("err=%v cancels=%d polls=%d observed=%+v", err, cancels.Load(), polls.Load(), observed)
	}
}
