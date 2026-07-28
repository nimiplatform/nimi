package nimillm

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
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

func loopbackProviderTestContext(ctx context.Context) context.Context {
	return mediaAdapterEndpointPolicyContext(ctx, MediaAdapterConfig{AllowLoopbackEndpoint: true})
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

func TestProviderPollContextErrorPreservesContextCauseWithoutLeakingDetails(t *testing.T) {
	tests := []struct {
		name        string
		contextErr  error
		wantCode    codes.Code
		wantReason  runtimev1.ReasonCode
		wantMessage string
	}{
		{
			name:        "canceled",
			contextErr:  context.Canceled,
			wantCode:    codes.Canceled,
			wantReason:  runtimev1.ReasonCode_ACTION_EXECUTED,
			wantMessage: "provider polling was canceled",
		},
		{
			name:        "deadline",
			contextErr:  context.DeadlineExceeded,
			wantCode:    codes.DeadlineExceeded,
			wantReason:  runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT,
			wantMessage: "provider polling timed out",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			const privateDetail = "private-provider-poll-detail"
			cause := errors.Join(tt.contextErr, errors.New(privateDetail))

			err := providerPollContextError(cause)
			if !errors.Is(err, tt.contextErr) {
				t.Fatalf("expected context cause %v to remain available in-process", tt.contextErr)
			}
			st, ok := status.FromError(err)
			if !ok {
				t.Fatal("expected gRPC status error")
			}
			if st.Code() != tt.wantCode {
				t.Fatalf("unexpected status code: got %v want %v", st.Code(), tt.wantCode)
			}
			if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != tt.wantReason {
				t.Fatalf("unexpected reason: ok=%v reason=%v err=%v", ok, reason, err)
			}
			if strings.Contains(st.Message(), privateDetail) {
				t.Fatalf("public status leaked private detail: %q", st.Message())
			}
			if message := structuredStatusMessage(t, st.Message()); message != tt.wantMessage {
				t.Fatalf("unexpected public message: got %q want %q", message, tt.wantMessage)
			}
		})
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
	defer func() { server.Close() }()

	ctx, cancel := context.WithCancel(loopbackProviderTestContext(context.Background()))
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
	defer func() { server.Close() }()

	if err := DeleteProviderAsyncTask(context.Background(), AdapterBytedanceARKTask, "task-1", MediaAdapterConfig{BaseURL: server.URL, AllowLoopbackEndpoint: true}); err != nil {
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
	defer func() { server.Close() }()

	ctx := WithProviderPollWait(loopbackProviderTestContext(context.Background()), immediateProviderPollWait)
	artifacts, usage, providerJobID, err := PollProviderTaskForArtifact(
		ctx,
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

func TestPollProviderTaskForArtifactFailedStatusUsesStructuredReason(t *testing.T) {
	const providerMessage = "opaque-provider-body-marker"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/contents/generations/tasks/task-failed-1" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id":     "task-failed-1",
			"status": "failed",
			"error": map[string]any{
				"message": providerMessage,
			},
		})
	}))
	defer func() { server.Close() }()

	_, _, providerJobID, err := PollProviderTaskForArtifact(
		loopbackProviderTestContext(context.Background()),
		noopJobStateUpdater{},
		"job-failed-detail",
		server.URL,
		"test-api-key",
		AdapterBytedanceARKTask,
		"task-failed-1",
		"/contents/generations/tasks",
		"/contents/generations/tasks/{task_id}",
		"video/mp4",
		420,
		"prompt",
		nil,
		nil,
	)
	if err == nil {
		t.Fatal("expected failed provider task to return an error")
	}
	if providerJobID != "task-failed-1" {
		t.Fatalf("unexpected providerJobID: %q", providerJobID)
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE {
		t.Fatalf("expected AI_PROVIDER_UNAVAILABLE, got %v (ok=%v)", reason, ok)
	}
	metadata, ok := grpcerr.ExtractReasonMetadata(err)
	if !ok {
		t.Fatalf("expected reason metadata, got err=%v", err)
	}
	if got := metadata["provider_task_status"]; got != "failed" {
		t.Fatalf("expected provider task status metadata, got=%q", got)
	}
	if got := metadata["action_hint"]; got != "check_provider_endpoint_or_live_task_status" {
		t.Fatalf("expected structured action hint, got=%q", got)
	}
	if _, exists := metadata["provider_message"]; exists {
		t.Fatalf("provider body must not be projected into reason metadata: %#v", metadata)
	}
}

func TestIsDetachedPollContext(t *testing.T) {
	if isDetachedPollContext(nil) {
		t.Fatal("nil context should not be detached")
	}
	if !isDetachedPollContext(context.Background()) {
		t.Fatal("background context (no deadline) should be detached")
	}
	cancelCtx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if !isDetachedPollContext(cancelCtx) {
		t.Fatal("cancel-only context (no deadline) should be detached")
	}
	deadlineCtx, deadlineCancel := context.WithTimeout(context.Background(), time.Minute)
	defer deadlineCancel()
	if isDetachedPollContext(deadlineCtx) {
		t.Fatal("context with deadline should NOT be detached")
	}
}

// TestPollProviderTaskForArtifactRetriesTransientErrorsWhenDetached verifies
// that in detached polling mode (cancel-only context), a transient HTTP failure
// during a poll tick is retried rather than immediately terminating the job.
// The provider returns errors for the first 2 poll attempts, then succeeds.
func TestPollProviderTaskForArtifactRetriesTransientErrorsWhenDetached(t *testing.T) {
	var requestCount int32
	updater := &recordingJobStateUpdater{}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/contents/generations/tasks/task-retry-1" {
			http.NotFound(w, r)
			return
		}
		current := atomic.AddInt32(&requestCount, 1)
		if current <= 2 {
			// Simulate transient server error on first 2 poll requests.
			w.WriteHeader(http.StatusInternalServerError)
			_ = json.NewEncoder(w).Encode(map[string]any{"error": "temporary failure"})
			return
		}
		if current == 3 {
			// Third poll: still running.
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "task-retry-1", "status": "running"})
			return
		}
		// Fourth poll: succeeded with artifact.
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id":      "task-retry-1",
			"status":  "succeeded",
			"b64_mp4": base64.StdEncoding.EncodeToString([]byte("video-bytes-retry")),
		})
	}))
	defer func() { server.Close() }()

	// Cancel-only context: no deadline → detached polling.
	ctx, cancel := context.WithCancel(loopbackProviderTestContext(context.Background()))
	defer cancel()
	ctx = WithProviderPollWait(ctx, immediateProviderPollWait)

	artifacts, _, providerJobID, err := PollProviderTaskForArtifact(
		ctx,
		updater,
		"job-retry-1",
		server.URL,
		"",
		AdapterBytedanceARKTask,
		"task-retry-1",
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
	if providerJobID != "task-retry-1" {
		t.Fatalf("unexpected provider job id: %q", providerJobID)
	}
	if len(artifacts) != 1 || string(artifacts[0].GetBytes()) != "video-bytes-retry" {
		t.Fatalf("unexpected artifacts: %#v", artifacts)
	}
	totalRequests := atomic.LoadInt32(&requestCount)
	if totalRequests < 4 {
		t.Fatalf("expected at least 4 requests (2 errors + running + success), got=%d", totalRequests)
	}
	// Verify that poll state updates include error entries from the transient failures.
	hasErrorEntry := false
	for _, call := range updater.calls {
		if strings.Contains(call.lastError, "500") || strings.Contains(call.lastError, "Internal Server Error") || call.lastError != "" {
			hasErrorEntry = true
			break
		}
	}
	if !hasErrorEntry {
		t.Fatal("expected at least one poll state update with error from transient failure")
	}
}

func immediateProviderPollWait(ctx context.Context, _ time.Duration) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
		return nil
	}
}

// TestPollProviderTaskForArtifactImmediateExitOnErrorWithDeadline verifies
// that when a deadline-based context is used (non-detached), a poll HTTP error
// still immediately terminates the poll loop — existing behavior preserved.
func TestPollProviderTaskForArtifactImmediateExitOnErrorWithDeadline(t *testing.T) {
	var requestCount int32

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/contents/generations/tasks/task-deadline-1" {
			http.NotFound(w, r)
			return
		}
		atomic.AddInt32(&requestCount, 1)
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": "server error"})
	}))
	defer func() { server.Close() }()

	// Context with deadline: NOT detached → immediate exit on error.
	ctx, cancel := context.WithTimeout(loopbackProviderTestContext(context.Background()), 30*time.Second)
	defer cancel()

	_, _, _, err := PollProviderTaskForArtifact(
		ctx,
		noopJobStateUpdater{},
		"job-deadline-1",
		server.URL,
		"",
		AdapterBytedanceARKTask,
		"task-deadline-1",
		"/contents/generations/tasks",
		"/contents/generations/tasks/{task_id}",
		"video/mp4",
		420,
		"prompt",
		nil,
		nil,
	)
	if err == nil {
		t.Fatal("expected error from poll with deadline context")
	}
	if got := atomic.LoadInt32(&requestCount); got != 1 {
		t.Fatalf("expected exactly 1 request (immediate exit), got=%d", got)
	}
}

func TestIsTransientPollError(t *testing.T) {
	transient := []runtimev1.ReasonCode{
		runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT,
		runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
		runtimev1.ReasonCode_AI_PROVIDER_INTERNAL,
	}
	for _, rc := range transient {
		err := grpcerr.WithReasonCode(codes.Unavailable, rc)
		if !isTransientPollError(err) {
			t.Errorf("isTransientPollError(%s) = false, want true", rc.String())
		}
	}

	permanent := []runtimev1.ReasonCode{
		runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED,
		runtimev1.ReasonCode_AI_MODEL_NOT_FOUND,
		runtimev1.ReasonCode_AI_INPUT_INVALID,
		runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED,
		runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED,
		runtimev1.ReasonCode_AI_OUTPUT_INVALID,
		runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID,
		runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED,
	}
	for _, rc := range permanent {
		err := grpcerr.WithReasonCode(codes.InvalidArgument, rc)
		if isTransientPollError(err) {
			t.Errorf("isTransientPollError(%s) = true, want false", rc.String())
		}
	}

	if isTransientPollError(nil) {
		t.Error("isTransientPollError(nil) = true, want false")
	}
	if isTransientPollError(errors.New("plain error without reason code")) {
		t.Error("isTransientPollError(plain error) = true, want false")
	}
}

// TestPollProviderTaskForArtifactPermanentErrorFailsFastWhenDetached verifies
// that permanent provider errors (e.g. 401 auth failure) immediately terminate
// the job even in detached polling mode — no retry.
func TestPollProviderTaskForArtifactPermanentErrorFailsFastWhenDetached(t *testing.T) {
	var requestCount int32

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/contents/generations/tasks/task-perm-1" {
			http.NotFound(w, r)
			return
		}
		atomic.AddInt32(&requestCount, 1)
		// Permanent auth failure on first poll request.
		w.WriteHeader(http.StatusUnauthorized)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": "invalid api key"})
	}))
	defer func() { server.Close() }()

	// Cancel-only context: detached mode.
	ctx, cancel := context.WithCancel(loopbackProviderTestContext(context.Background()))
	defer cancel()

	_, _, _, err := PollProviderTaskForArtifact(
		ctx,
		noopJobStateUpdater{},
		"job-perm-1",
		server.URL,
		"bad-key",
		AdapterBytedanceARKTask,
		"task-perm-1",
		"/contents/generations/tasks",
		"/contents/generations/tasks/{task_id}",
		"video/mp4",
		420,
		"prompt",
		nil,
		nil,
	)
	if err == nil {
		t.Fatal("expected error from permanent auth failure")
	}
	// Must exit after exactly 1 request — no retry on permanent error.
	if got := atomic.LoadInt32(&requestCount); got != 1 {
		t.Fatalf("permanent error must fail fast with 1 request, got=%d", got)
	}
	// Verify the error carries a permanent reason code, not transient.
	if reason, ok := grpcerr.ExtractReasonCode(err); ok {
		if reason == runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT ||
			reason == runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE ||
			reason == runtimev1.ReasonCode_AI_PROVIDER_INTERNAL {
			t.Fatalf("permanent auth error should not map to transient reason, got=%s", reason.String())
		}
	}
}
