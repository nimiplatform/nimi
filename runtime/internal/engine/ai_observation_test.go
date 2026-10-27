package engine

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aitelemetry"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
)

// This is a Host-boundary test, not a real-model acceptance result. A real
// loopback request establishes where recording starts; substrate loading is
// deliberately isolated so a load failure must produce no attempt.
func TestTextObservationStartsAtInferenceAndCountsRealRetry(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	backend, err := runtimepersistence.Open(logger, filepath.Join(t.TempDir(), "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	owner := aitelemetry.Open(backend, logger)
	defer func() { _ = backend.Close() }()
	defer func() { _ = owner.Close() }()
	entered, release := make(chan struct{}), make(chan struct{})
	var first sync.Once
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		first.Do(func() { close(entered) })
		select {
		case <-release:
		case <-r.Context().Done():
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1}}`))
	}))
	defer server.Close()
	facts := aitelemetry.Facts{AccountID: "account", OperationID: "job", Source: aitelemetry.Source{Kind: "app", ID: "test-app", ParentID: "job", ParentKind: "scenario-job"}, Capability: "text.generate", Models: []*runtimev1.DesktopAIExecutionModel{{ModelId: "captured-model"}}, Route: runtimev1.DesktopAIExecutionRoute_DESKTOP_AI_EXECUTION_ROUTE_LOCAL}
	ctx := aitelemetry.WithInvocation(context.Background(), owner, facts)
	facts.Models[0].ModelId = "later-configuration"
	host := newExecutionHostWithSubstrate(&fakeLlamaInvocationSubstrate{endpoint: server.URL, healthy: true}, server.Client())
	plan := llamaInvocationPlanForHostTest(t, "observation", nil, false)
	done := make(chan error, 1)
	go func() { _, err := host.ExecuteText(ctx, plan, nil); done <- err }()
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("inference was not dispatched")
	}
	snapshot := owner.Snapshot("account", 50)
	if snapshot.KnownActiveAttemptCount != 1 || len(snapshot.Executions) != 1 || snapshot.Executions[0].Models[0].ModelId != "captured-model" {
		t.Fatalf("incorrect actual execution: %+v", snapshot)
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if _, err := host.ExecuteText(ctx, plan, nil); err != nil {
		t.Fatal(err)
	}
	failed := newExecutionHostWithSubstrate(&fakeLlamaInvocationSubstrate{ensureErr: fmt.Errorf("load rejected")}, nil)
	if _, err := failed.ExecuteText(ctx, plan, nil); err == nil {
		t.Fatal("load failure was hidden")
	}
	now := time.Now().UTC()
	if err := owner.Flush(context.Background()); err != nil {
		t.Fatal(err)
	}
	summary, err := owner.Summary(context.Background(), "account", now.Add(-time.Hour), now.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if summary.Totals.AttemptCount != 2 || summary.Totals.InputTokens != 4 || summary.Totals.OutputTokens != 2 {
		t.Fatalf("dispatch accounting includes load failure or misses retry: %+v", summary.Totals)
	}
	if owner.Snapshot("account", 50).KnownActiveAttemptCount != 0 {
		t.Fatal("completed inference remained active")
	}
}

type inferenceBlockedAccountingBackend struct {
	aitelemetry.Backend
	blocked atomic.Bool
	entered chan struct{}
	release chan struct{}
	once    sync.Once
}

func (b *inferenceBlockedAccountingBackend) WriteTx(ctx context.Context, fn func(*sql.Tx) error) error {
	if b.blocked.Load() {
		b.once.Do(func() { close(b.entered) })
		<-b.release
	}
	return b.Backend.WriteTx(ctx, fn)
}

func TestAccountingStallCannotConsumeAnActualInferenceDeadline(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	backend, err := runtimepersistence.Open(logger, filepath.Join(t.TempDir(), "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = backend.Close() }()
	blocked := &inferenceBlockedAccountingBackend{Backend: backend, entered: make(chan struct{}), release: make(chan struct{})}
	owner := aitelemetry.Open(blocked, logger)
	defer func() { _ = owner.Close() }()
	var release sync.Once
	defer release.Do(func() { close(blocked.release) })
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1}}`))
	}))
	defer server.Close()
	host := newExecutionHostWithSubstrate(&fakeLlamaInvocationSubstrate{endpoint: server.URL, healthy: true}, server.Client())
	plan := llamaInvocationPlanForHostTest(t, "deadline-observation", nil, false)
	from := time.Now().UTC()
	ctx, cancel := context.WithTimeout(aitelemetry.WithInvocation(context.Background(), owner, aitelemetry.Facts{AccountID: "account", OperationID: "deadline-job", Source: aitelemetry.Source{Kind: "app", ID: "test-app", ParentID: "deadline-job", ParentKind: "scenario-job"}, Capability: "text.generate", Models: []*runtimev1.DesktopAIExecutionModel{{ModelId: "captured"}}, Route: runtimev1.DesktopAIExecutionRoute_DESKTOP_AI_EXECUTION_ROUTE_LOCAL}), 500*time.Millisecond)
	defer cancel()
	blocked.blocked.Store(true)
	finished := make(chan error, 1)
	go func() { _, err := host.ExecuteText(ctx, plan, nil); finished <- err }()
	select {
	case err := <-finished:
		if err != nil {
			t.Fatalf("accounting changed inference outcome: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("inference waited for stalled accounting writer")
	}
	if calls.Load() != 1 {
		t.Fatalf("actual inference HTTP calls=%d", calls.Load())
	}
	if owner.Snapshot("account", 50).KnownActiveAttemptCount != 0 {
		t.Fatal("completed real dispatch remained active")
	}
	summary, err := owner.Summary(context.Background(), "account", from, time.Now().Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	pending := false
	for _, reason := range summary.PartialReasons {
		pending = pending || reason == "accounting_pending_writes"
	}
	if summary.TimeComplete || !pending {
		t.Fatalf("pending accounting falsely complete: %+v", summary)
	}
	release.Do(func() { close(blocked.release) })
	if err := owner.Flush(context.Background()); err != nil {
		t.Fatal(err)
	}
	summary, err = owner.Summary(context.Background(), "account", from, time.Now().Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if summary.Totals.AttemptCount != 1 || summary.Totals.InputTokens != 2 {
		t.Fatalf("flushed dispatch accounting=%+v", summary.Totals)
	}
}
