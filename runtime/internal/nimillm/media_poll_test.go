package nimillm

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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

	if _, err := DeleteProviderAsyncTask(context.Background(), AdapterBytedanceARKTask, "task-1", MediaAdapterConfig{BaseURL: server.URL, AllowLoopbackEndpoint: true}); err != nil {
		t.Fatalf("expected conflict to be treated as success, got %v", err)
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

func TestNativeTaskHandoffDoesNoPollingOrCleanup(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); w.WriteHeader(500) }))
	defer server.Close()
	var receipt *NativeTaskReceipt
	parent, cancel := context.WithCancel(context.Background())
	ctx := WithNativeTaskPublisher(parent, func(r *NativeTaskReceipt) error { receipt = CloneNativeTaskReceipt(r); return nil })
	artifacts, usage, id, err := PollProviderTaskForArtifact(ctx, noopJobStateUpdater{}, "job", server.URL, "key", AdapterBytedanceARKTask, "task-1", "/contents/generations/tasks", resolveBytedanceARKVideoQueryPathTemplate(), "video/mp4", nil, nil)
	cancel()
	if !errors.Is(err, ErrNativeTaskYielded) || receipt == nil || id != "task-1" || len(artifacts) != 0 || usage != nil || calls.Load() != 0 {
		t.Fatalf("receipt handoff performed IO or lost identity: %v %v calls=%d", receipt, err, calls.Load())
	}
	if _, _, _, err := PollProviderTaskForArtifact(context.Background(), noopJobStateUpdater{}, "job", server.URL, "key", AdapterBytedanceARKTask, "task-1", "/contents/generations/tasks", resolveBytedanceARKVideoQueryPathTemplate(), "video/mp4", nil, nil); err == nil || calls.Load() != 0 {
		t.Fatal("missing owner fell back to polling")
	}
}

func TestNativeTaskObservationIsOneQueryAndPreservesTerminalProvenance(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		httpStatus int
		terminal   bool
		reason     runtimev1.ReasonCode
	}{
		{name: "queued", body: `{"status":"queued"}`, httpStatus: 200},
		{name: "transient", body: `{"error":"temporarily unavailable"}`, httpStatus: 503, reason: runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE},
		{name: "auth", body: `{"error":"unauthorized"}`, httpStatus: 401, reason: runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED},
		{name: "canceled", body: `{"status":"canceled"}`, httpStatus: 200, terminal: true, reason: runtimev1.ReasonCode_AI_PROVIDER_TASK_CANCELED},
		{name: "expired", body: `{"status":"expired"}`, httpStatus: 200, terminal: true, reason: runtimev1.ReasonCode_AI_PROVIDER_TASK_EXPIRED},
		{name: "failed", body: `{"status":"failed","failure_reason":"temporary internal failure"}`, httpStatus: 200, terminal: true, reason: runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE},
		{name: "success", body: `{"status":"succeeded","b64_mp4":"dmlkZW8tYnl0ZXM="}`, httpStatus: 200, terminal: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var calls atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				if r.Method != http.MethodGet || r.URL.Path != "/contents/generations/tasks/original" {
					t.Errorf("non-original query %s %s", r.Method, r.URL.Path)
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(tc.httpStatus)
				w.Write([]byte(tc.body))
			}))
			defer server.Close()
			receipt := &NativeTaskReceipt{Version: 1, Adapter: AdapterBytedanceARKTask, TaskID: "original", QueryPathTemplate: resolveBytedanceARKVideoQueryPathTemplate(), Artifact: BinaryArtifact("video/mp4", nil, map[string]any{"adapter": AdapterBytedanceARKTask})}
			observation, terminal, err := ObserveNativeTask(context.Background(), MediaAdapterConfig{BaseURL: server.URL, AllowLoopbackEndpoint: true}, receipt)
			var artifacts []*runtimev1.ScenarioArtifact
			if observation != nil {
				artifacts = observation.Artifacts
			}
			if calls.Load() != 1 || terminal != tc.terminal {
				t.Fatalf("observation retried or misreported terminal: calls=%d terminal=%v err=%v", calls.Load(), terminal, err)
			}
			if tc.reason != 0 {
				reason, _ := grpcerr.ExtractReasonCode(err)
				if reason != tc.reason {
					t.Fatalf("reason=%v expected=%v err=%v", reason, tc.reason, err)
				}
			} else if err != nil {
				t.Fatal(err)
			}
			if tc.name == "success" {
				if len(artifacts) != 1 || string(artifacts[0].GetBytes()) != "video-bytes" || artifacts[0].Metadata.AsMap()["response"] != nil {
					t.Fatalf("invalid artifact: %v", artifacts)
				}
			}
			if tc.name == "failed" {
				metadata, _ := grpcerr.ExtractReasonMetadata(err)
				if metadata["provider_task_status"] != "failed" || metadata["provider_message"] != "" {
					t.Fatalf("failure provenance: %v", metadata)
				}
			}
		})
	}
}

func TestNativeObservationKeepsCompleteOutputSetWithoutAcquiringBodies(t *testing.T) {
	for _, tc := range []struct {
		adapter, path, payload string
		count                  int
	}{
		{AdapterAlibabaNative, "/api/v1/tasks/{task_id}", `{"output":{"task_id":"original","task_status":"SUCCEEDED","results":[{"url":"%s/one"},{"url":"%s/two"}]}}`, 2},
		{AdapterRunwayTask, "/v1/tasks/{task_id}", `{"id":"original","status":"SUCCEEDED","output":["%s/one","%s/two"]}`, 2},
		{AdapterBytedanceARKTask, "/contents/generations/tasks/{task_id}", `{"id":"original","status":"succeeded","content":{"video_url":"%s/one","last_frame_url":"%s/two"}}`, 2},
		{AdapterLumaTask, "/dream-machine/v1/generations/{task_id}", `{"id":"original","state":"completed","assets":{"video":"%s/one"},"ignored":"%s"}`, 1},
	} {
		t.Run(tc.adapter, func(t *testing.T) {
			var queries, bodies atomic.Int32
			var endpoint string
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != ResolveTaskQueryPath(tc.path, "original") {
					bodies.Add(1)
					w.Write([]byte("body"))
					return
				}
				queries.Add(1)
				w.Header().Set("Content-Type", "application/json")
				fmt.Fprintf(w, tc.payload, endpoint, endpoint)
			}))
			defer server.Close()
			endpoint = server.URL
			receipt := &NativeTaskReceipt{Version: 1, Adapter: tc.adapter, TaskID: "original", QueryPathTemplate: tc.path, Artifact: BinaryArtifact("video/mp4", nil, nil)}
			observation, terminal, err := ObserveNativeTask(context.Background(), MediaAdapterConfig{BaseURL: endpoint, AllowLoopbackEndpoint: true}, receipt)
			if err != nil || !terminal || len(observation.GetArtifacts()) != tc.count || queries.Load() != 1 || bodies.Load() != 0 {
				t.Fatalf("query fetched or lost a body: result=%v terminal=%v err=%v query=%d bodies=%d", observation, terminal, err, queries.Load(), bodies.Load())
			}
			ids := map[string]bool{}
			for _, artifact := range observation.Artifacts {
				if artifact.GetUri() == "" || ids[artifact.GetArtifactId()] {
					t.Fatalf("unstable/missing required slot: %v", artifact)
				}
				ids[artifact.GetArtifactId()] = true
			}
		})
	}
}
