package memoryv1

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"
)

type recordingDeltaPort struct {
	semanticEmbeddingPort
	batches [][]string
}

func (p *recordingDeltaPort) Embed(ctx context.Context, req AIEmbeddingRequest) (AIEmbeddingResult, error) {
	p.batches = append(p.batches, append([]string(nil), req.Inputs...))
	return p.semanticEmbeddingPort.Embed(ctx, req)
}

func TestMemoryDeltaReusesOnlyCurrentSameBankSpaceVectors(t *testing.T) {
	c := openTestCore(t, t.TempDir())
	ctx := context.Background()
	bank := ensureTestBank(t, c, "delta-a")
	first := rememberText(t, c, bank, 1, "I prefer jasmine tea")
	caps := CapabilitySnapshot{ConfigRevision: 1, EmbeddingSpaceRef: "embedding-space-1", Available: []Capability{CapabilityFTSIndex, CapabilityTextEmbed, CapabilityVectorIndex}}
	port := &recordingDeltaPort{}
	build := func(op string) {
		t.Helper()
		if outcome, err := c.RebuildEmbedding(ctx, op, bank.BankRef, caps, port); err != nil || outcome != OutcomeReady {
			t.Fatalf("build %s: %s %v", op, outcome, err)
		}
	}
	build("delta-build-1")
	var firstRow int64
	if err := c.db.QueryRow(`SELECT rowid FROM memory_fts WHERE memory_ref=?`, first).Scan(&firstRow); err != nil {
		t.Fatal(err)
	}
	rememberText(t, c, bank, 2, "I like mountain hikes")
	var retainedRow int64
	if err := c.db.QueryRow(`SELECT rowid FROM memory_fts WHERE memory_ref=?`, first).Scan(&retainedRow); err != nil || retainedRow != firstRow {
		t.Fatalf("unchanged FTS row replaced: %d %d %v", firstRow, retainedRow, err)
	}
	build("delta-build-2")
	if len(port.batches) != 2 || len(port.batches[1]) != 1 || port.batches[1][0] != "I like mountain hikes" {
		t.Fatalf("re-embedded unchanged text: %v", port.batches)
	}
	request := testCorrectionCommit(bank, 3, "delta-correct-event", "delta-correct", first, "I prefer green tea")
	if _, err := c.ReceiveCommittedEvent(ctx, request); err != nil {
		t.Fatal(err)
	}
	if _, err := c.ExecuteRemember(ctx, request.OperationID); err != nil {
		t.Fatal(err)
	}
	// Forget must not promote an older, now incomplete generation to ready.
	if _, err := c.ForgetExact(ctx, ForgetRequest{OperationID: "delta-forget", BindingRef: bank.BindingRef, BankRef: bank.BankRef, LifecycleRef: bank.LifecycleRef, TargetMemoryRefs: []string{first}, Confirmed: true}); err != nil {
		t.Fatal(err)
	}
	if needs, err := c.NeedsEmbeddingRebuild(ctx, bank.BankRef, caps); err != nil || !needs {
		t.Fatalf("stale generation promoted: needs=%v %v", needs, err)
	}
	build("delta-build-3")
	if len(port.batches[2]) != 1 || port.batches[2][0] != "I prefer green tea" {
		t.Fatalf("correction reused obsolete text: %v", port.batches)
	}
	other := ensureTestBank(t, c, "delta-b")
	otherRequest := testCommit(other, 1, "other-event", "other-operation", "I prefer green tea")
	if _, err := c.ReceiveCommittedEvent(ctx, otherRequest); err != nil {
		t.Fatal(err)
	}
	if _, err := c.ExecuteRemember(ctx, otherRequest.OperationID); err != nil {
		t.Fatal(err)
	}
	if _, err := c.RebuildEmbedding(ctx, "delta-other", other.BankRef, caps, port); err != nil {
		t.Fatal(err)
	}
	if len(port.batches) != 4 || len(port.batches[3]) != 1 {
		t.Fatalf("cross-bank reuse: %v", port.batches)
	}
}

func TestStoredVectorDecoderPreservesNumbersAndRejectsMalformedState(t *testing.T) {
	expected := []float64{0, -0.5, 1.5, 1e-300, 1e100}
	raw, err := json.Marshal(expected)
	if err != nil {
		t.Fatal(err)
	}
	scratch := make([]float64, 0, len(expected))
	got, valid := decodeMemoryVector(raw, scratch, len(expected))
	if !valid || !reflect.DeepEqual(got, expected) {
		t.Fatalf("decoded=%v valid=%v", got, valid)
	}
	for _, raw := range []string{`[NaN]`, `[Infinity]`, `[1,]`, `[01]`, `[0x1p0]`, `[1e999]`, `[null]`, `[true]`, `["1"]`, `{"0":1}`, `[[1]]`, `[1,2]`, `[]`, "\u00a0[1]"} {
		if _, valid := decodeMemoryVector([]byte(raw), scratch, 1); valid {
			t.Fatalf("accepted invalid vector %s", raw)
		}
	}
	if got, valid := decodeMemoryVector([]byte(" [ 1.25e+2 ] \n"), scratch, 1); !valid || got[0] != 125 {
		t.Fatalf("whitespace/number grammar: %v %v", got, valid)
	}
}
