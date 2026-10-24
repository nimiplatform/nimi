package ai

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// @nimi-authority: rule.nimi.runtime.service-operations.scenario-job-retention
func TestScenarioJobRetentionExactClassCrossings(t *testing.T) {
	for _, mode := range []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM, runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB} {
		t.Run(mode.String(), func(t *testing.T) {
			store := newScenarioJobStore()
			now := time.Now().UTC()
			otherMode := runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB
			if mode == otherMode {
				otherMode = runtimev1.ExecutionMode_EXECUTION_MODE_SYNC
			}
			// Both complete delivery classes retain their own 1024 slots.
			for i := 0; i < maxRetainedTerminalScenarioJobs; i++ {
				id := fmt.Sprintf("other-%04d", i)
				store.jobs[id] = terminalScenarioJobForEvictionTest(id, "app.other", otherMode, now.Add(-20*time.Minute).Add(time.Duration(i)*time.Millisecond))
			}
			for i := 0; i < maxRetainedTerminalScenarioJobs-1; i++ {
				id := fmt.Sprintf("selected-%04d", i)
				selectedMode := mode
				if mode != runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB && i%2 == 0 {
					selectedMode = runtimev1.ExecutionMode_EXECUTION_MODE_STREAM
				}
				store.jobs[id] = terminalScenarioJobForEvictionTest(id, "app.selected", selectedMode, now.Add(-10*time.Minute).Add(time.Duration(i)*time.Millisecond))
			}
			count := func(prefix string) int {
				result := 0
				for id := range store.jobs {
					if len(id) >= len(prefix) && id[:len(prefix)] == prefix {
						result++
					}
				}
				return result
			}
			if count("selected-") != 1023 {
				t.Fatal("fixture must start at exactly 1023")
			}
			for i := 1023; i < 1028; i++ {
				id := fmt.Sprintf("selected-%04d", i)
				store.jobs[id] = terminalScenarioJobForEvictionTest(id, "app.selected", mode, now.Add(-10*time.Minute).Add(time.Duration(i)*time.Millisecond))
				wantBefore := 1025
				if i == 1023 {
					wantBefore = 1024
				}
				if count("selected-") != wantBefore {
					t.Fatalf("pre-prune selected=%d want %d", count("selected-"), wantBefore)
				}
				store.pruneJobsLocked(now)
				if count("selected-") != 1024 || count("other-") != 1024 {
					t.Fatalf("after crossing: selected=%d other=%d", count("selected-"), count("other-"))
				}
				oldestRetained := i - 1023
				for n := 0; n <= oldestRetained; n++ {
					_, present := store.jobs[fmt.Sprintf("selected-%04d", n)]
					if present != (n == oldestRetained) {
						t.Fatalf("entry %d present=%v at crossing %d", n, present, i)
					}
				}
			}
		})
	}
}

// This is a real-file writer measurement, not a provider or App acceptance.
// It reports writer row encoding separately from successful content writes.
func BenchmarkScenarioJobStoreCachedRewrite(b *testing.B) {
	for _, mode := range []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM} {
		for _, payloadSize := range []int{1 << 10, 15 << 10, 256 << 10} {
			b.Run(fmt.Sprintf("%s/captured=%d", mode.String(), payloadSize), func(b *testing.B) {
				template, assembly := localScenarioJobForPersistenceTest(b, "job-template", "loadout-bench", "recipe-bench", "1")
				template.ExecutionMode = mode
				payload := make([]byte, payloadSize)
				for i := range payload {
					payload[i] = 'x'
				}
				assembly.Request.Payload = json.RawMessage(append(append([]byte(`{"text":"`), payload...), `"}`...))
				store := retainedScenarioJobStoreForBenchmark(b, 1024, template, assembly)
				var encoded, written, rows, waitNanos int64
				var signal, attempted chan struct{}
				store.durable.rowEncoded = func(_ string, bytes int) {
					encoded += int64(bytes)
					rows++
					if signal != nil {
						close(signal)
						signal = nil
						<-attempted
					}
				}
				store.durable.contentWritten = func(bytes int) { written += int64(bytes) }
				b.ResetTimer()
				for i := 0; i < b.N; i++ {
					ready := make(chan struct{})
					signal, attempted = ready, make(chan struct{})
					trying := attempted
					done := make(chan time.Duration, 1)
					go func() {
						<-ready
						started := time.Now()
						close(trying)
						store.mu.RLock()
						store.mu.RUnlock()
						done <- time.Since(started)
					}()
					store.mu.Lock()
					record := store.jobs["job-retained-00000"]
					record.job.ReasonDetail = fmt.Sprintf("changed-%d", i)
					store.markDurableJobChangedLocked(record.job.GetJobId())
					// A required rewrite is measured directly; retention thresholds
					// and full create-to-terminal IO are covered separately.
					err := store.rewriteDurableStoreLocked()
					store.mu.Unlock()
					if signal != nil {
						close(signal)
						signal = nil
					}
					if err != nil {
						b.Fatal(err)
					}
					waitNanos += int64(<-done)
				}
				b.StopTimer()
				var cached int
				for _, row := range store.durable.encodedRows {
					cached += len(row)
				}
				b.ReportMetric(float64(cached), "cache-B")
				b.ReportMetric(float64(encoded)/float64(b.N), "writer-encoded-B/op")
				b.ReportMetric(float64(rows)/float64(b.N), "writer-rows/op")
				b.ReportMetric(float64(written)/float64(b.N), "written-B/op")
				b.ReportMetric(float64(waitNanos)/float64(b.N), "reader-wait-ns/op")
			})
		}
	}
}
