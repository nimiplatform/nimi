package engine

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

type idleReleaseSubstrate struct {
	fakeLlamaInvocationSubstrate
	stopMu sync.Mutex
	stops  int
}

func (s *idleReleaseSubstrate) Stop() error {
	s.stopMu.Lock()
	s.stops++
	s.stopMu.Unlock()
	s.mu.Lock()
	s.currentKey = ""
	s.healthy = false
	s.mu.Unlock()
	return nil
}

func (s *idleReleaseSubstrate) stopCount() int {
	s.stopMu.Lock()
	defer s.stopMu.Unlock()
	return s.stops
}

func idleReleaseHostForTest(t *testing.T, after time.Duration, handler http.HandlerFunc) (*ExecutionHost, *idleReleaseSubstrate) {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	substrate := &idleReleaseSubstrate{fakeLlamaInvocationSubstrate: fakeLlamaInvocationSubstrate{endpoint: server.URL, healthy: true}}
	host := newExecutionHostWithSubstrate(substrate, server.Client())
	host.idle.after = after
	return host, substrate
}

func okCompletion(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1}}`))
}

func TestIdleLlamaWorkerIsReleasedAfterItsLastRequestAndLoadsAgainOnUse(t *testing.T) {
	host, substrate := idleReleaseHostForTest(t, 100*time.Millisecond, okCompletion)
	plan := llamaInvocationPlanForHostTest(t, "main", nil, false)
	host.residentModelAssets.capture([]capabilitydriver.InvocationExactBinding{{ModelAssetID: "model-a"}})
	if _, err := host.ExecuteText(context.Background(), plan, nil); err != nil {
		t.Fatal(err)
	}
	if !waitForCondition(2*time.Second, func() bool { return substrate.stopCount() == 1 }) {
		t.Fatalf("idle worker was not released, stops=%d", substrate.stopCount())
	}
	if host.residentModelAssets.uses("model-a") {
		t.Fatal("a released worker still claims its model files")
	}
	if _, err := host.ExecuteText(context.Background(), plan, nil); err != nil {
		t.Fatal(err)
	}
	if substrate.starts != 2 {
		t.Fatalf("the next request must load a fresh worker, starts=%d", substrate.starts)
	}
}

func TestIdleReleaseWaitsWhileRequestsKeepTheWorkerInUse(t *testing.T) {
	host, substrate := idleReleaseHostForTest(t, 300*time.Millisecond, okCompletion)
	plan := llamaInvocationPlanForHostTest(t, "main", nil, false)
	for range 5 {
		if _, err := host.ExecuteText(context.Background(), plan, nil); err != nil {
			t.Fatal(err)
		}
		time.Sleep(150 * time.Millisecond)
	}
	if substrate.stopCount() != 0 || substrate.starts != 1 {
		t.Fatalf("a worker in use was released: stops=%d starts=%d", substrate.stopCount(), substrate.starts)
	}
}

func TestIdleReleaseNeverInterruptsARequestInFlight(t *testing.T) {
	release := make(chan struct{})
	host, substrate := idleReleaseHostForTest(t, 50*time.Millisecond, func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(readAll(r.Body), "slow") {
			<-release
		}
		okCompletion(w, r)
	})
	quick := llamaInvocationPlanForHostTest(t, "main", nil, false)
	if _, err := host.ExecuteText(context.Background(), quick, nil); err != nil {
		t.Fatal(err)
	}
	// Hold the lease as a long request would, across the idle deadline.
	<-host.lease
	time.Sleep(200 * time.Millisecond)
	if substrate.stopCount() != 0 {
		t.Fatalf("idle release stopped the worker under a request in flight")
	}
	host.lease <- struct{}{}
	close(release)
}

func readAll(body io.Reader) string {
	raw, _ := io.ReadAll(body)
	return string(raw)
}

func TestLlamaRequestsPresentTheRunningWorkersPrivateKey(t *testing.T) {
	var mu sync.Mutex
	var seen []string
	host, substrate := idleReleaseHostForTest(t, time.Hour, func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		seen = append(seen, r.Header.Get("Authorization"))
		mu.Unlock()
		okCompletion(w, r)
	})
	substrate.accessKey = strings.Repeat("ab", 32)
	if _, err := host.ExecuteText(context.Background(), llamaInvocationPlanForHostTest(t, "main", nil, false), nil); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(seen) != 1 || seen[0] != "Bearer "+strings.Repeat("ab", 32) {
		t.Fatalf("Authorization headers = %q", seen)
	}
}

func TestEachLlamaWorkerStartGetsItsOwnPrivateKeyThroughItsEnvironment(t *testing.T) {
	manager := &fakeLlamaExecutionManager{status: StatusStopped, endpoint: "http://127.0.0.1:1234"}
	substrate := newManagerLlamaInvocationSubstrate(nil)
	substrate.manager = manager
	for _, key := range []string{"plan-a", "plan-b"} {
		if _, _, err := substrate.Ensure(context.Background(), key, []string{"--model", "/exact/" + key + ".gguf"}, nil, nil); err != nil {
			t.Fatalf("Ensure %s: %v", key, err)
		}
	}
	manager.mu.Lock()
	configs := append([]EngineConfig(nil), manager.startedConfigs...)
	manager.mu.Unlock()
	if len(configs) != 2 {
		t.Fatalf("starts = %d, want 2", len(configs))
	}
	first, second := configs[0].CommandEnv["LLAMA_API_KEY"], configs[1].CommandEnv["LLAMA_API_KEY"]
	for _, key := range []string{first, second} {
		if len(key) != 64 || strings.Trim(key, "0123456789abcdef") != "" {
			t.Fatalf("worker key %q is not a private 32-byte hex key", key)
		}
	}
	if first == second {
		t.Fatal("a new worker must not reuse the previous worker's key")
	}
	for _, cfg := range configs {
		for _, arg := range cfg.CommandArgs {
			if strings.Contains(arg, cfg.CommandEnv["LLAMA_API_KEY"]) {
				t.Fatal("the key must never appear in process arguments")
			}
		}
	}
	if substrate.AccessKey() != second {
		t.Fatal("requests must present the running worker's key")
	}
	if err := substrate.Stop(); err != nil {
		t.Fatal(err)
	}
	if substrate.AccessKey() != "" {
		t.Fatal("a stopped worker's key must be forgotten")
	}
}
