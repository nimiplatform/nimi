package memoryv1

import (
	"context"
	"fmt"
	"testing"
)

func TestLocalPreparationPreferencesThroughCore(t *testing.T) {
	ctx := context.Background()
	for _, example := range []struct{ habit, preference, opposite string }{
		{"我喝咖啡一向不加糖。", "我喜欢喝不加糖的咖啡。", "我喝咖啡一向加糖。"},
		{"我吃粥通常不放盐。", "我喜欢吃不加盐的粥。", "我吃粥通常放盐。"},
		{"I usually have my tea with no milk.", "I prefer tea without milk.", "I like my tea with milk."},
	} {
		for _, reverse := range []bool{false, true} {
			core := openTestCore(t, t.TempDir())
			bank := ensureTestBank(t, core, "preparer")
			first, second := example.habit, example.preference
			if reverse {
				first, second = second, first
			}
			for i, text := range []string{first, second, example.opposite} {
				req := testCommit(bank, uint64(i+1), fmt.Sprintf("event-%d", i), fmt.Sprintf("prep-%d", i), text)
				if _, err := core.ReceiveCommittedEvent(ctx, req); err != nil {
					t.Fatal(err)
				}
				result, err := core.ExecuteRemember(ctx, req.OperationID)
				want := []Outcome{OutcomeAdmitted, OutcomeNoEffect, OutcomeAdmitted}[i]
				if err != nil || result.Outcome != want {
					t.Fatalf("%q: %+v %v", text, result, err)
				}
				current, err := core.ListMemories(ctx, bank.BankRef, false)
				if err != nil {
					t.Fatal(err)
				}
				if i < 2 && (len(current) != 1 || current[0].Content != first || current[0].EventRef != "event-0") {
					t.Fatalf("lost original wording/provenance: %+v", current)
				}
				if i == 2 && len(current) != 0 {
					t.Fatalf("asserted unresolved preference: %+v", current)
				}
			}
		}
	}
}
func TestPreviouslyBoundRememberKeepsBaselineRevision(t *testing.T) {
	core := openTestCore(t, t.TempDir())
	ctx := context.Background()
	bank := ensureTestBank(t, core, "old-remember")
	req := testCommit(bank, 1, "event-old", "op-old", "我喝咖啡一向不加糖。")
	if _, err := core.ReceiveCommittedEvent(ctx, req); err != nil {
		t.Fatal(err)
	}
	if _, err := core.bindRoute(ctx, routeBindingRequest{OperationID: req.OperationID, OperationKind: "remember", BankRef: bank.BankRef, Pipeline: PipelineRememberBaseline, AlgorithmRevision: "baseline-2", Snapshot: CapabilitySnapshot{Available: []Capability{}}}); err != nil {
		t.Fatal(err)
	}
	if result, err := core.ExecuteRemember(ctx, req.OperationID); err != nil || result.Outcome != OutcomeNoEffect {
		t.Fatalf("old route: %+v %v", result, err)
	}
	for _, text := range []string{"我喝咖啡今天不加糖。", "我喝咖啡一向不加糖吗？", "如果我喝咖啡一向不加糖呢？"} {
		if _, ok := preparationMeaning(text); ok {
			t.Fatalf("transient or uncertain preparation: %s", text)
		}
	}
}
