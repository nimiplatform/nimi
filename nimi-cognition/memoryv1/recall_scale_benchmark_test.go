package memoryv1

import (
	"context"
	"fmt"
	"runtime/pprof"
	"slices"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// This measures the real Memory Core and temporary SQLite store. The synthetic
// port supplies deterministic dense stored vectors and a fixed query vector;
// its timing is NOT model inference, Runtime Job, or provider performance.
type recallScalePort struct {
	dimension int
	documents map[string][]float64
	query     []float64
	queryNS   int64
	queries   int
	onQuery   func()
}

func (p *recallScalePort) Embed(ctx context.Context, request AIEmbeddingRequest) (AIEmbeddingResult, error) {
	started := time.Now()
	if err := ctx.Err(); err != nil {
		return AIEmbeddingResult{}, err
	}
	result := AIEmbeddingResult{Dimension: p.dimension, SpaceID: request.EmbeddingSpaceRef}
	for _, input := range request.Inputs {
		vector, found := p.documents[input]
		if request.Purpose == "retrieval-query" {
			vector, found = p.query, true
		}
		if !found {
			return AIEmbeddingResult{}, fmt.Errorf("unknown synthetic embedding input")
		}
		result.Vectors = append(result.Vectors, append([]float64(nil), vector...))
	}
	if request.Purpose == "retrieval-query" {
		p.queryNS += time.Since(started).Nanoseconds()
		p.queries++
		if p.onQuery != nil {
			p.onQuery()
		}
	}
	return result, nil
}

func (*recallScalePort) AcknowledgeConsumed(context.Context, string) error { return nil }
func (*recallScalePort) FinalizeStale(context.Context, string) error       { return nil }

type recallScaleFixture struct {
	core        *Core
	bank        EnsureBankResult
	writer      EnsureBankResult
	writerRef   string
	writerSeq   uint64
	operations  atomic.Uint64
	port        *recallScalePort
	caps        CapabilitySnapshot
	expected    []string
	vectorBytes int64
}

func newRecallScaleFixture(tb testing.TB, count, dimension int) *recallScaleFixture {
	tb.Helper()
	ctx := context.Background()
	core, err := Open(tb.TempDir())
	if err != nil {
		tb.Fatal(err)
	}
	tb.Cleanup(func() {
		if err := core.Close(); err != nil {
			tb.Error(err)
		}
	})
	ensure := func(binding string) EnsureBankResult {
		bank, err := core.EnsureBank(ctx, EnsureBankRequest{ContractVersion: ContractVersion, BindingRef: binding, OperationID: "ensure-" + binding})
		if err != nil {
			tb.Fatal(err)
		}
		return bank
	}
	f := &recallScaleFixture{
		core: core, bank: ensure("scale-reader"), writer: ensure("scale-writer"), writerSeq: 1,
		port: &recallScalePort{dimension: dimension, documents: make(map[string][]float64), query: make([]float64, dimension)},
		caps: CapabilitySnapshot{ConfigRevision: 1, EmbeddingSpaceRef: "scale-space", Available: []Capability{CapabilityFTSIndex, CapabilityTextEmbed, CapabilityVectorIndex}},
	}
	f.port.query[0] = 1
	remember := func(bank EnsureBankResult, sequence uint64, text, operation string) string {
		request := testCommit(bank, sequence, "event-"+operation, operation, text)
		request.CommittedAt = time.Now().UTC()
		if _, err := core.ReceiveCommittedEvent(ctx, request); err != nil {
			tb.Fatal(err)
		}
		result, err := core.ExecuteRemember(ctx, operation)
		if err != nil || result.Outcome != OutcomeAdmitted || len(result.AffectedMemoryRefs) != 1 {
			tb.Fatalf("seed did not create one canonical Memory: %+v %v", result, err)
		}
		return result.AffectedMemoryRefs[0]
	}
	for index := 0; index < count; index++ {
		text := fmt.Sprintf("I prefer synthetic benchmark choice %04d for this isolated Memory experiment", index)
		ref := remember(f.bank, uint64(index+1), text, fmt.Sprintf("seed-%04d", index))
		vector := make([]float64, dimension)
		vector[0] = 1 + float64(index)/float64(count)
		for coordinate := 1; coordinate < dimension; coordinate++ {
			vector[coordinate] = (float64((coordinate*48271)%65521)/65521 - 0.5) / 12
		}
		if index%4 == 0 {
			vector[0] = -vector[0] // Below the positive similarity threshold.
		} else {
			// Other coordinates are identical, so larger first coordinates have
			// strictly higher cosine to the query. The expected top eight is
			// known without copying the production heap or cosine algorithm.
			f.expected = append(f.expected, ref)
		}
		f.port.documents[text] = vector
	}
	slices.Reverse(f.expected)
	if len(f.expected) < 8 {
		tb.Fatal("fixture needs eight positive matches")
	}
	f.expected = f.expected[:8]
	f.writerRef = remember(f.writer, 1, "I prefer the initial isolated writer choice", "writer-seed")
	if outcome, err := core.RebuildEmbedding(ctx, "scale-build", f.bank.BankRef, f.caps, f.port); err != nil || outcome != OutcomeReady {
		tb.Fatalf("build actual vector generation: %s %v", outcome, err)
	}
	var vectors int
	if err := core.db.QueryRowContext(ctx, `SELECT COUNT(*), SUM(length(vector_json)) FROM memory_vector_items WHERE generation_ref = ?`, "scale-build").Scan(&vectors, &f.vectorBytes); err != nil || vectors != count {
		tb.Fatalf("stored vector count=%d want=%d bytes=%d err=%v", vectors, count, f.vectorBytes, err)
	}
	if _, err := f.recall(ctx); err != nil {
		tb.Fatal(err)
	}
	return f
}

func (f *recallScaleFixture) nextOperation() string {
	return fmt.Sprintf("scale-operation-%d", f.operations.Add(1))
}

func (f *recallScaleFixture) recall(ctx context.Context) (time.Duration, error) {
	request := testRecallRequest(f.bank, f.nextOperation(), "synthetic scale query", 8, f.caps)
	started := time.Now()
	result, err := f.core.Recall(ctx, request, f.port)
	elapsed := time.Since(started)
	if err != nil {
		return elapsed, err
	}
	refs := make([]string, len(result.Hits))
	for index, hit := range result.Hits {
		if hit.BankRef != f.bank.BankRef || hit.Lifecycle != LifecycleCurrent {
			return elapsed, fmt.Errorf("Recall crossed bank or lifecycle")
		}
		refs[index] = hit.MemoryRef
	}
	if result.Outcome != OutcomeReady || result.Pipeline != PipelineRecallEmbedding || !slices.Equal(refs, f.expected) {
		return elapsed, fmt.Errorf("Recall did not return the known ordered top eight")
	}
	return elapsed, nil
}

func (f *recallScaleFixture) writeOtherBank(ctx context.Context) (time.Duration, error) {
	f.writerSeq++
	operation := f.nextOperation()
	request := testCorrectionCommit(f.writer, f.writerSeq, "event-"+operation, operation, f.writerRef,
		fmt.Sprintf("I prefer isolated writer choice %d", f.writerSeq))
	request.CommittedAt = time.Now().UTC()
	started := time.Now()
	if _, err := f.core.ReceiveCommittedEvent(ctx, request); err != nil {
		return time.Since(started), err
	}
	result, err := f.core.ExecuteRemember(ctx, operation)
	elapsed := time.Since(started)
	if err != nil {
		return elapsed, err
	}
	if result.Outcome != OutcomeAdmitted || len(result.AffectedMemoryRefs) != 1 {
		return elapsed, fmt.Errorf("other-bank correction was not committed")
	}
	f.writerRef = result.AffectedMemoryRefs[0]
	return elapsed, nil
}

func TestRecallScaleFixtureUsesActualCoreAndKnownRanking(t *testing.T) {
	f := newRecallScaleFixture(t, 16, 768)
	if _, err := f.writeOtherBank(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := f.recall(context.Background()); err != nil {
		t.Fatal(err)
	}
}

// A batch timer makes the small synthetic-port cost visible on clocks whose
// individual samples cannot resolve one 768-float copy. Still no model work.
func BenchmarkRecallSyntheticEmbeddingPort(b *testing.B) {
	port := &recallScalePort{dimension: 768, query: make([]float64, 768)}
	port.query[0] = 1
	request := AIEmbeddingRequest{Purpose: "retrieval-query", EmbeddingSpaceRef: "scale-space", Inputs: []string{"synthetic scale query"}}
	b.ReportAllocs()
	b.ResetTimer()
	for index := 0; index < b.N; index++ {
		result, err := port.Embed(context.Background(), request)
		if err != nil || len(result.Vectors) != 1 || result.Vectors[0][0] != 1 {
			b.Fatalf("synthetic query result: %v", err)
		}
	}
}

// Run with a bounded iteration count, e.g. -benchtime=10x -count=3. Construction,
// canonical seeding, vector publication and the initial warm read are untimed.
func BenchmarkRecallEmbeddingScale(b *testing.B) {
	for _, count := range []int{100, 1000} {
		b.Run(fmt.Sprintf("n=%d/d=768/k=8", count), func(b *testing.B) {
			setup := time.Now()
			f := newRecallScaleFixture(b, count, 768)
			b.Logf("temporary Core setup: rows=%d dimension=768 vector_json_bytes=%d elapsed=%s", count, f.vectorBytes, time.Since(setup))
			for _, mode := range []string{"recall", "write", "overlap"} {
				b.Run(mode, func(b *testing.B) { benchmarkRecallScaleMode(b, f, mode) })
			}
		})
	}
}

func benchmarkRecallScaleMode(b *testing.B, f *recallScaleFixture, mode string) {
	b.Helper()
	f.port.queryNS, f.port.queries = 0, 0
	f.port.onQuery = nil
	before := f.core.db.Stats()
	var recallTime, writeTime time.Duration
	var overlapped int
	b.ReportAllocs()
	b.ResetTimer()
	pprof.Do(context.Background(), pprof.Labels("cognition-benchmark", mode), func(ctx context.Context) {
		for index := 0; index < b.N; index++ {
			var err error
			switch mode {
			case "recall":
				var elapsed time.Duration
				elapsed, err = f.recall(ctx)
				recallTime += elapsed
			case "write":
				var elapsed time.Duration
				elapsed, err = f.writeOtherBank(ctx)
				writeTime += elapsed
			case "overlap":
				startWrite := make(chan struct{})
				release := sync.OnceFunc(func() { close(startWrite) })
				f.port.onQuery = release
				type writeOutcome struct {
					started time.Time
					elapsed time.Duration
					err     error
				}
				done := make(chan writeOutcome, 1)
				go func() {
					<-startWrite
					started := time.Now()
					elapsed, writeErr := f.writeOtherBank(ctx)
					done <- writeOutcome{started, elapsed, writeErr}
				}()
				elapsed, recallErr := f.recall(ctx)
				finished := time.Now()
				release() // Also release the writer if Recall fails before Embed.
				f.port.onQuery = nil
				write := <-done
				if write.started.Before(finished) {
					overlapped++
				}
				recallTime += elapsed
				writeTime += write.elapsed
				err = recallErr
				if err == nil {
					err = write.err
				}
			}
			if err != nil {
				b.Fatal(err)
			}
		}
	})
	b.StopTimer()
	after := f.core.db.Stats()
	operations := float64(b.N)
	b.ReportMetric(float64(recallTime.Nanoseconds())/operations, "recall-ns/op")
	b.ReportMetric(float64(f.port.queryNS)/operations, "synthetic-port-ns/op")
	b.ReportMetric(float64(f.port.queries)/operations, "query-embeddings/op")
	b.ReportMetric(float64(writeTime.Nanoseconds())/operations, "other-write-ns/op")
	// database/sql wait is summed over both operations, not a per-writer latency.
	b.ReportMetric(float64((after.WaitDuration-before.WaitDuration).Nanoseconds())/operations, "db-wait-ns/op")
	b.ReportMetric(float64(after.WaitCount-before.WaitCount)/operations, "db-waits/op")
	b.ReportMetric(float64(overlapped)/operations, "overlap-rounds/op")
	b.ReportMetric(float64(f.vectorBytes), "stored-vector-B")
}
