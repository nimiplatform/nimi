package nimillm

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type noopJobStateUpdater struct{}

func (noopJobStateUpdater) UpdatePollState(_ string, _ string, _ int32, _ *timestamppb.Timestamp, _ string) {
}

type recordingJobStateUpdater struct {
	calls []recordedPollState
}

type recordedPollState struct {
	providerJobID string
	retryCount    int32
	nextPollAt    *timestamppb.Timestamp
	lastError     string
}

func (r *recordingJobStateUpdater) UpdatePollState(_ string, providerJobID string, retryCount int32, nextPollAt *timestamppb.Timestamp, lastError string) {
	r.calls = append(r.calls, recordedPollState{
		providerJobID: providerJobID,
		retryCount:    retryCount,
		nextPollAt:    nextPollAt,
		lastError:     lastError,
	})
}

func TestProviderPollRetryLimitReached(t *testing.T) {
	deadlineCtx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	if providerPollRetryLimitReached(deadlineCtx, maxProviderPollAttempts-1) {
		t.Fatalf("retry count below limit should not trip cap")
	}
	if !providerPollRetryLimitReached(deadlineCtx, maxProviderPollAttempts) {
		t.Fatalf("retry count at limit should trip cap")
	}
	if providerPollRetryLimitReached(context.Background(), maxProviderPollAttempts) {
		t.Fatalf("context without deadline should not trip fixed poll cap")
	}
}

func TestProviderPollTimeoutError(t *testing.T) {
	err := providerPollTimeoutError()
	st, ok := status.FromError(err)
	if !ok {
		t.Fatal("expected gRPC status error")
	}
	if st.Code() != codes.DeadlineExceeded {
		t.Fatalf("unexpected status code: %v", st.Code())
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT {
		t.Fatalf("unexpected reason: ok=%v reason=%v err=%v", ok, reason, err)
	}
}

func TestProviderPollDelayBackoff(t *testing.T) {
	if got := providerPollDelay(0); got != 2*time.Second {
		t.Fatalf("providerPollDelay(0)=%s want=%s", got, 2*time.Second)
	}
	if got := providerPollDelay(2); got != 5*time.Second {
		t.Fatalf("providerPollDelay(2)=%s want=%s", got, 5*time.Second)
	}
	if got := providerPollDelay(6); got != 10*time.Second {
		t.Fatalf("providerPollDelay(6)=%s want=%s", got, 10*time.Second)
	}
	if got := providerPollDelay(20); got != 30*time.Second {
		t.Fatalf("providerPollDelay(20)=%s want=%s", got, 30*time.Second)
	}
}

func TestPollProviderTaskForArtifactCancelsVolcengineTaskOnContextCancel(t *testing.T) {
	var deleteCount int32

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/contents/generations/tasks/task-1":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "task-1", "status": "queued"})
		case r.Method == http.MethodDelete && r.URL.Path == "/contents/generations/tasks/task-1":
			atomic.AddInt32(&deleteCount, 1)
			w.WriteHeader(http.StatusNoContent)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(50 * time.Millisecond)
		cancel()
	}()

	_, _, _, err := PollProviderTaskForArtifact(
		ctx,
		noopJobStateUpdater{},
		"job-1",
		server.URL,
		"",
		AdapterBytedanceARKTask,
		"task-1",
		"/contents/generations/tasks",
		"/contents/generations/tasks/{task_id}",
		"video/mp4",
		420,
		"prompt",
		nil,
		nil,
	)
	if status.Code(err) != codes.Canceled {
		t.Fatalf("expected canceled status, got %v err=%v", status.Code(err), err)
	}
	if got := atomic.LoadInt32(&deleteCount); got != 1 {
		t.Fatalf("expected one provider delete request, got=%d", got)
	}
}

func TestDeleteBytedanceARKTaskTreatsConflictAsSuccess(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete || r.URL.Path != "/contents/generations/tasks/task-1" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"error": map[string]any{
				"message": "task is already running",
			},
		})
	}))
	defer server.Close()

	if err := DeleteProviderAsyncTask(context.Background(), AdapterBytedanceARKTask, "task-1", MediaAdapterConfig{BaseURL: server.URL}); err != nil {
		t.Fatalf("expected conflict to be treated as success, got %v", err)
	}
}

func TestPollProviderTaskForArtifactCompletesAfterQueuedStates(t *testing.T) {
	var pollCount int32
	updater := &recordingJobStateUpdater{}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/contents/generations/tasks/task-1" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		current := atomic.AddInt32(&pollCount, 1)
		if current < 3 {
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "task-1", "status": "queued"})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id":      "task-1",
			"status":  "succeeded",
			"b64_mp4": base64.StdEncoding.EncodeToString([]byte("video-bytes")),
		})
	}))
	defer server.Close()

	artifacts, usage, providerJobID, err := PollProviderTaskForArtifact(
		context.Background(),
		updater,
		"job-1",
		server.URL,
		"",
		AdapterBytedanceARKTask,
		"task-1",
		"/contents/generations/tasks",
		"/contents/generations/tasks/{task_id}",
		"video/mp4",
		420,
		"prompt",
		nil,
		nil,
	)
	if err != nil {
		t.Fatalf("PollProviderTaskForArtifact failed: %v", err)
	}
	if providerJobID != "task-1" {
		t.Fatalf("unexpected provider job id: %q", providerJobID)
	}
	if len(artifacts) != 1 || string(artifacts[0].GetBytes()) != "video-bytes" {
		t.Fatalf("unexpected artifacts: %#v", artifacts)
	}
	if usage == nil || usage.GetComputeMs() <= 0 {
		t.Fatalf("expected usage stats, got=%v", usage)
	}
	if len(updater.calls) < 3 {
		t.Fatalf("expected multiple poll state updates, got=%d", len(updater.calls))
	}
	if updater.calls[0].retryCount != 0 || updater.calls[0].nextPollAt == nil {
		t.Fatalf("expected initial poll state with nextPollAt, got=%#v", updater.calls[0])
	}
	last := updater.calls[len(updater.calls)-1]
	if last.retryCount < 2 {
		t.Fatalf("expected retry count to advance, got=%d", last.retryCount)
	}
	if last.nextPollAt != nil {
		t.Fatalf("expected terminal poll state to clear nextPollAt, got=%v", last.nextPollAt)
	}
	for _, call := range updater.calls {
		if strings.TrimSpace(call.providerJobID) != "task-1" {
			t.Fatalf("unexpected provider job id in poll state: %#v", call)
		}
	}
}
