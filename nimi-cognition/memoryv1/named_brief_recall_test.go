package memoryv1

import (
	"context"
	"testing"
	"time"
)

func TestSessionPointerContentFreeAndSlotKeyFilteredRecallIsolation(t *testing.T) {
	ctx := context.Background()
	core := openTestCore(t, t.TempDir())
	bank := ensureTestBank(t, core, "binding-named-brief")
	now := time.Date(2026, 11, 25, 10, 0, 0, 0, time.UTC)

	commitPointer := func(seq uint64, opID, ref, summary string) {
		t.Helper()
		req := CommitRequest{
			ContractVersion:  ContractVersion,
			BindingRef:       bank.BindingRef,
			BankRef:          bank.BankRef,
			EventRef:         "ev-" + opID,
			DeliverySequence: seq,
			OperationID:      opID,
			LifecycleRef:     bank.LifecycleRef,
			Subjects:         []TypedRef{{Kind: "account_subject", Value: "acct-1"}},
			Sources:          []TypedRef{{Kind: "session", Value: ref}},
			CommittedAt:      now.Add(time.Duration(seq) * time.Minute),
			Fact: CommittedFact{
				Kind: EventKindSessionPointer,
				SessionPointer: &SessionPointerFact{
					WorkSessionRef: ref,
					ScopeTag:       ScopeTagSessionPointer,
					SlotKey:        "session_ref:" + ref,
					TopicSummary:   summary,
					BodyKind:       "os.pc.workspace",
				},
			},
		}
		res, err := core.ReceiveCommittedEvent(ctx, req)
		if err != nil || res.Outcome != OutcomeReceived {
			t.Fatalf("commit %s failed: res=%+v err=%v", opID, res, err)
		}
		if _, err := core.ExecuteRemember(ctx, opID); err != nil {
			t.Fatalf("remember %s failed: %v", opID, err)
		}
	}

	// 1. New named-handoff session pointer with EMPTY topic summary must succeed
	//    and store a content-free opaque session reference without polluting FTS.
	commitPointer(1, "op-ptr-empty", "ws_named_new", "")

	// 2. Seed two normal session pointers + one legacy pre-upgrade restricted pointer
	//    that contains a private word ("琥珀密钥") AND high term frequency for a shared word ("发布计划").
	commitPointer(2, "op-ptr-norm-1", "ws_norm_1", "整理 Q3 发布计划与里程碑检查清单")
	commitPointer(3, "op-ptr-norm-2", "ws_norm_2", "核对 发布计划 风险与回滚脚本")
	commitPointer(4, "op-ptr-legacy-hidden", "ws_legacy_restricted", "琥珀密钥 发布计划 发布计划 发布计划 机密发布计划")

	caps := CapabilitySnapshot{Available: []Capability{CapabilityFTSIndex}}
	allowed := []string{"session_ref:ws_norm_1", "session_ref:ws_norm_2"}

	// 3. Querying ONLY the private word with FilterSlotKeys=true must return OutcomeNoHits.
	privReq := testRecallRequest(bank, "recall-private-word", "琥珀密钥", 4, caps)
	privReq.ScopeTags = []string{ScopeTagSessionPointer}
	privReq.FilterSlotKeys = true
	privReq.AllowedSlotKeys = allowed
	privRes, err := core.Recall(ctx, privReq, nil)
	if err != nil {
		t.Fatalf("private recall errored: %v", err)
	}
	if privRes.Outcome != OutcomeNoHits || len(privRes.Hits) != 0 {
		t.Fatalf("private word from hidden legacy pointer must produce OutcomeNoHits, got %+v", privRes)
	}

	// 4. Querying a shared term with Limit=2 MUST return both eligible normal pointers;
	//    the hidden high-TF legacy pointer must NOT consume a result quota slot or leak.
	sharedReq := testRecallRequest(bank, "recall-shared-quota", "发布计划", 2, caps)
	sharedReq.ScopeTags = []string{ScopeTagSessionPointer}
	sharedReq.FilterSlotKeys = true
	sharedReq.AllowedSlotKeys = allowed
	sharedRes, err := core.Recall(ctx, sharedReq, nil)
	if err != nil {
		t.Fatalf("shared recall errored: %v", err)
	}
	if sharedRes.Outcome != OutcomeReady || len(sharedRes.Hits) != 2 {
		t.Fatalf("expected 2 eligible hits without hidden quota interference, got %+v", sharedRes)
	}
	for _, hit := range sharedRes.Hits {
		if hit.SlotKey == "session_ref:ws_legacy_restricted" {
			t.Fatalf("hidden legacy pointer leaked into filtered recall: %+v", hit)
		}
	}

	// 5. Empty AllowedSlotKeys with FilterSlotKeys=true returns OutcomeNoHits cleanly.
	emptyAllow := testRecallRequest(bank, "recall-empty-allowed", "发布计划", 2, caps)
	emptyAllow.ScopeTags = []string{ScopeTagSessionPointer}
	emptyAllow.FilterSlotKeys = true
	emptyAllow.AllowedSlotKeys = nil
	emptyRes, err := core.Recall(ctx, emptyAllow, nil)
	if err != nil || emptyRes.Outcome != OutcomeNoHits || len(emptyRes.Hits) != 0 {
		t.Fatalf("expected OutcomeNoHits for empty allowed slot set, got res=%+v err=%v", emptyRes, err)
	}
}
