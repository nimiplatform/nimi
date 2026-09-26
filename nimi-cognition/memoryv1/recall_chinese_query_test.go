package memoryv1

import (
	"context"
	"fmt"
	"strings"
	"testing"
)

const chineseProjectRecallQuery = "请从你当前获准读取的长期记忆中，找出这轮开发验收项目的代号，保存一份标题为“已存测试项目名”的短 Markdown 新成果：第一行写找到的代号，第二行写依据来自哪条已提交的长期记忆。如未获得该信息，请明确写“未找到”，不要猜测。此次委托不提供代号本身；不读取规范聊天，不查询外部服务，不访问其他工作成果，也不改变任何已有记忆或旧成果。实际保存后简短说明。"

func TestFTSRecallChineseNaturalQuestionRanksLexicalTopicsWithinExactBank(t *testing.T) {
	ctx := context.Background()
	core := openTestCore(t, t.TempDir())
	bank := ensureTestBank(t, core, "binding-chinese-question")
	want := rememberText(t, core, bank, 1, "请记住：这轮开发验收项目的代号是银桥青叶。")
	rememberText(t, core, bank, 2, "请记住：项目启动仪式安排在周三。")
	rememberText(t, core, bank, 3, "请记住：我喜欢山间徒步。")
	other := ensureTestBank(t, core, "binding-other-question")
	foreign := testCommit(other, 1, "foreign-chinese-event", "foreign-chinese-commit", "请记住：开发验收项目的代号来自另一位伙伴。")
	if _, err := core.ReceiveCommittedEvent(ctx, foreign); err != nil {
		t.Fatal(err)
	}
	if _, err := core.ExecuteRemember(ctx, foreign.OperationID); err != nil {
		t.Fatal(err)
	}
	// The existing lexical index already contains Han bigrams. fts-2 changes
	// only query compilation, so its first Recall must reuse this ready version.
	var priorGeneration string
	var priorVersion uint64
	if err := core.db.QueryRowContext(ctx, `SELECT generation_ref, canonical_version FROM memory_derived_generations WHERE bank_ref = ? AND kind = 'fts' AND status = 'ready'`, bank.BankRef).Scan(&priorGeneration, &priorVersion); err != nil {
		t.Fatal(err)
	}
	caps := CapabilitySnapshot{Available: []Capability{CapabilityFTSIndex}}
	for index, query := range []string{chineseProjectRecallQuery, "找出本次开发验收项目代号", "开发验收项目代号"} {
		request := testRecallRequest(bank, fmt.Sprintf("chinese-natural-%d", index), query, 1, caps)
		result, err := core.Recall(ctx, request, nil)
		if err != nil || result.Outcome != OutcomeReady || result.Pipeline != PipelineRecallFTS || len(result.Hits) != 1 || result.Hits[0].MemoryRef != want || result.Hits[0].BankRef != bank.BankRef {
			t.Fatalf("natural Chinese query lost bounded relevance or bank isolation: result=%+v err=%v", result, err)
		}
	}
	wrongBank := testRecallRequest(bank, "chinese-wrong-bank", "开发验收项目代号", 8, caps)
	wrongBank.BankRef = other.BankRef
	if result, err := core.Recall(ctx, wrongBank, nil); err == nil || len(result.Hits) != 0 {
		t.Fatal("mismatched binding read another bank")
	}
	wrongLife := testRecallRequest(bank, "chinese-wrong-life", "开发验收项目代号", 8, caps)
	wrongLife.LifecycleRef = "old-lifecycle"
	if result, err := core.Recall(ctx, wrongLife, nil); !IsOutcome(err, OutcomeConflict) || len(result.Hits) != 0 {
		t.Fatal("stale lifecycle returned Chinese hits")
	}
	var revision string
	if err := core.db.QueryRowContext(ctx, `SELECT algorithm_revision FROM memory_operation_routes WHERE operation_id = 'chinese-natural-0'`).Scan(&revision); err != nil || revision != "fts-2" {
		t.Fatalf("query revision not bound: %q %v", revision, err)
	}
	var currentGeneration string
	var currentVersion, canonicalVersion uint64
	if err := core.db.QueryRowContext(ctx, `SELECT g.generation_ref, g.canonical_version, b.canonical_version FROM memory_derived_generations g JOIN memory_banks b ON b.bank_ref = g.bank_ref WHERE g.bank_ref = ? AND g.kind = 'fts' AND g.status = 'ready'`, bank.BankRef).Scan(&currentGeneration, &currentVersion, &canonicalVersion); err != nil || currentGeneration != priorGeneration || currentVersion != priorVersion || canonicalVersion != priorVersion {
		t.Fatalf("query revision rebuilt the ready index or changed canonical Memory: generation=%q version=%d canonical=%d err=%v", currentGeneration, currentVersion, canonicalVersion, err)
	}
}

func TestFTSRecallChineseNaturalQuestionKeepsEscapingBoundsAndForget(t *testing.T) {
	ctx := context.Background()
	core := openTestCore(t, t.TempDir())
	bank := ensureTestBank(t, core, "binding-chinese-escaping")
	want := rememberText(t, core, bank, 1, "请记住：开发验收项目代号是晨露。")
	caps := CapabilitySnapshot{Available: []Capability{CapabilityFTSIndex}}
	query := `请查询开发验收项目代号" OR * NOT (other) :^`
	result, err := core.Recall(ctx, testRecallRequest(bank, "chinese-quoted", query, 1, caps), nil)
	if err != nil || result.Outcome != OutcomeReady || len(result.Hits) != 1 || result.Hits[0].MemoryRef != want {
		t.Fatalf("query metacharacters escaped FTS compilation: %+v %v", result, err)
	}
	for index, unrelated := range []string{"冰川火山月球轨道", `"*()`, `OR NOT NEAR :^ *`} {
		result, err := core.Recall(ctx, testRecallRequest(bank, fmt.Sprintf("chinese-no-hits-%d", index), unrelated, 8, caps), nil)
		if err != nil || result.Outcome != OutcomeNoHits || len(result.Hits) != 0 {
			t.Fatalf("unrelated input manufactured ready hits: %+v %v", result, err)
		}
	}
	var long strings.Builder
	for index := range 5000 {
		long.WriteRune(rune(0x4e00 + index))
	}
	long.WriteString("，开发验收项目代号")
	result, err = core.Recall(ctx, testRecallRequest(bank, "chinese-bounded-long", long.String(), 1, caps), nil)
	if err != nil || len(result.Hits) != 1 || result.Hits[0].MemoryRef != want {
		t.Fatalf("bounded long query failed: %+v %v", result, err)
	}
	if _, err := core.ForgetExact(ctx, ForgetRequest{OperationID: "forget-chinese-question", BindingRef: bank.BindingRef, BankRef: bank.BankRef, LifecycleRef: bank.LifecycleRef, TargetMemoryRefs: []string{want}, Confirmed: true}); err != nil {
		t.Fatal(err)
	}
	if err := core.RebuildFTS(ctx, bank.BankRef); err != nil {
		t.Fatal(err)
	}
	result, err = core.Recall(ctx, testRecallRequest(bank, "chinese-after-forget", query, 8, caps), nil)
	if err != nil || result.Outcome != OutcomeNoHits || len(result.Hits) != 0 {
		t.Fatalf("forgotten Chinese memory returned: %+v %v", result, err)
	}
}
