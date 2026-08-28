package memoryv1

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"sync"
	"testing"
)

func TestBaselineRememberOwnsJudgmentAndCoreOwnsCommit(t *testing.T) {
	core := openTestCore(t, t.TempDir())
	ctx := context.Background()
	bank := ensureTestBank(t, core, "binding-a")
	preference := testCommit(bank, 1, "event-1", "commit-1", "I prefer jasmine tea in the afternoon")
	if _, err := core.ReceiveCommittedEvent(ctx, preference); err != nil {
		t.Fatalf("receive preference: %v", err)
	}
	result, err := core.ExecuteRemember(ctx, preference.OperationID)
	if err != nil || result.Outcome != OutcomeAdmitted || len(result.AffectedMemoryRefs) != 1 {
		t.Fatalf("execute Baseline Remember: result=%+v err=%v", result, err)
	}
	memories, err := core.ListMemories(ctx, bank.BankRef, false)
	if err != nil || len(memories) != 1 || memories[0].EpistemicStatus != EpistemicExplicit || memories[0].EventRef != preference.EventRef {
		t.Fatalf("Baseline result lost canonical provenance: memories=%+v err=%v", memories, err)
	}
	status, err := core.InspectStatus(ctx, bank.BindingRef, bank.BankRef)
	if err != nil || status.Frontiers.Ready != 1 || status.Events[0].PayloadPresent {
		t.Fatalf("Remember terminal projection/compaction incomplete: status=%+v err=%v", status, err)
	}

	ordinary := testCommit(bank, 2, "event-2", "commit-2", "What time is it?")
	if _, err := core.ReceiveCommittedEvent(ctx, ordinary); err != nil {
		t.Fatalf("receive ordinary message: %v", err)
	}
	result, err = core.ExecuteRemember(ctx, ordinary.OperationID)
	if err != nil || result.Outcome != OutcomeNoEffect || len(result.AffectedMemoryRefs) != 0 {
		t.Fatalf("ordinary transient request became Memory: result=%+v err=%v", result, err)
	}

	assistant := testCommit(bank, 3, "event-3", "commit-3", "I prefer coffee")
	assistant.Fact.Message.Actor = ActorAssistant
	if _, err := core.ReceiveCommittedEvent(ctx, assistant); err != nil {
		t.Fatalf("receive assistant message: %v", err)
	}
	result, err = core.ExecuteRemember(ctx, assistant.OperationID)
	if err != nil || result.Outcome != OutcomeNoEffect {
		t.Fatalf("assistant assertion became explicit Memory: result=%+v err=%v", result, err)
	}

	secret := testCommit(bank, 4, "event-4", "commit-4", "Please remember my password is secret-value")
	if _, err := core.ReceiveCommittedEvent(ctx, secret); err != nil {
		t.Fatalf("receive secret-bearing message: %v", err)
	}
	result, err = core.ExecuteRemember(ctx, secret.OperationID)
	if err != nil || result.Outcome != OutcomeRejected {
		t.Fatalf("forbidden content was not safely rejected: result=%+v err=%v", result, err)
	}
	memories, err = core.ListMemories(ctx, bank.BankRef, true)
	if err != nil || len(memories) != 1 || strings.Contains(strings.ToLower(memories[0].Content), "password") {
		t.Fatalf("secret-bearing event reached canonical Memory: memories=%+v err=%v", memories, err)
	}
}

func TestIndependentRememberConformanceCanDifferWithoutBecomingProductPipeline(t *testing.T) {
	core := openTestCore(t, t.TempDir())
	ctx := context.Background()
	bank := ensureTestBank(t, core, "binding-a")
	request := testCommit(bank, 1, "event-1", "commit-1", "I prefer jasmine tea")
	if _, err := core.ReceiveCommittedEvent(ctx, request); err != nil {
		t.Fatalf("receive conformance event: %v", err)
	}
	result, err := core.executeRememberWithPipeline(ctx, request.OperationID, deterministicConformanceRemember{})
	if err != nil || result.Outcome != OutcomeNoEffect {
		t.Fatalf("independent conformance algorithm result: result=%+v err=%v", result, err)
	}
	descriptors := NewV1Router().Descriptors()
	if len(descriptors) != 4 {
		t.Fatalf("V1 product router registered unexpected pipelines: %+v", descriptors)
	}
	for _, descriptor := range descriptors {
		if descriptor.Name == "remember.conformance" {
			t.Fatal("test-only conformance implementation became a product descriptor")
		}
	}
}

func TestFTSAndEmbeddingAreDistinctRealRecallPipelines(t *testing.T) {
	core := openTestCore(t, t.TempDir())
	ctx := context.Background()
	bank := ensureTestBank(t, core, "binding-a")
	rememberText(t, core, bank, 1, "I prefer jasmine tea in the afternoon")
	rememberText(t, core, bank, 2, "I like mountain hikes at sunrise")

	ftsOnly := CapabilitySnapshot{ConfigRevision: 7, Available: []Capability{CapabilityFTSIndex}}
	lexical, err := core.Recall(ctx, RecallRequest{OperationID: "recall-fts-1", BankRef: bank.BankRef, Query: "jasmine tea", Limit: 4, Capabilities: ftsOnly}, nil)
	if err != nil || lexical.Outcome != OutcomeReady || lexical.Pipeline != PipelineRecallFTS || len(lexical.Hits) != 1 || !strings.Contains(lexical.Hits[0].Content, "jasmine") {
		t.Fatalf("real FTS recall failed: result=%+v err=%v", lexical, err)
	}
	unrelated, err := core.Recall(ctx, RecallRequest{OperationID: "recall-fts-2", BankRef: bank.BankRef, Query: "ocean sailing", Limit: 4, Capabilities: ftsOnly}, nil)
	if err != nil || unrelated.Outcome != OutcomeNoHits || len(unrelated.Hits) != 0 {
		t.Fatalf("FTS manufactured an unrelated hit: result=%+v err=%v", unrelated, err)
	}
	semanticQuery := "favorite warm beverage"
	ftsSemantic, err := core.Recall(ctx, RecallRequest{OperationID: "recall-fts-3", BankRef: bank.BankRef, Query: semanticQuery, Limit: 4, Capabilities: ftsOnly}, nil)
	if err != nil || ftsSemantic.Outcome != OutcomeNoHits {
		t.Fatalf("FTS unexpectedly acted as semantic embedding recall: result=%+v err=%v", ftsSemantic, err)
	}

	port := &semanticEmbeddingPort{}
	embeddingCaps := CapabilitySnapshot{ConfigRevision: 9, Available: []Capability{CapabilityFTSIndex, CapabilityTextEmbed, CapabilityVectorIndex}}
	if outcome, err := core.RebuildEmbedding(ctx, "embedding-build-1", bank.BankRef, embeddingCaps, port); err != nil || outcome != OutcomeReady {
		t.Fatalf("build real embedding generation: outcome=%s err=%v", outcome, err)
	}
	semantic, err := core.Recall(ctx, RecallRequest{OperationID: "recall-embedding-1", BankRef: bank.BankRef, Query: semanticQuery, Limit: 4, Capabilities: embeddingCaps}, port)
	if err != nil || semantic.Outcome != OutcomeReady || semantic.Pipeline != PipelineRecallEmbedding || len(semantic.Hits) != 1 || !strings.Contains(semantic.Hits[0].Content, "jasmine") {
		t.Fatalf("real Embedding recall failed: result=%+v err=%v", semantic, err)
	}
	failing := &semanticEmbeddingPort{fail: true}
	failed, err := core.Recall(ctx, RecallRequest{OperationID: "recall-embedding-fail", BankRef: bank.BankRef, Query: semanticQuery, Limit: 4, Capabilities: embeddingCaps}, failing)
	if err == nil || failed.Outcome != OutcomeFailed || failed.Pipeline != PipelineRecallEmbedding || failing.calls != 1 {
		t.Fatalf("selected Embedding failure did not remain typed/no-fallback: result=%+v calls=%d err=%v", failed, failing.calls, err)
	}
}

func TestEmbeddingPublishRejectsCanonicalVersionRace(t *testing.T) {
	core := openTestCore(t, t.TempDir())
	ctx := context.Background()
	bank := ensureTestBank(t, core, "binding-a")
	rememberText(t, core, bank, 1, "I prefer jasmine tea")
	port := newBlockingEmbeddingPort()
	caps := CapabilitySnapshot{ConfigRevision: 1, Available: []Capability{CapabilityTextEmbed, CapabilityVectorIndex, CapabilityFTSIndex}}
	type result struct {
		outcome Outcome
		err     error
	}
	done := make(chan result, 1)
	go func() {
		outcome, err := core.RebuildEmbedding(ctx, "embedding-build-race", bank.BankRef, caps, port)
		done <- result{outcome: outcome, err: err}
	}()
	<-port.started
	rememberText(t, core, bank, 2, "I like mountain hikes")
	close(port.release)
	build := <-done
	if build.outcome != OutcomeConflict || !IsOutcome(build.err, OutcomeConflict) {
		t.Fatalf("stale embedding generation published across canonical mutation: outcome=%s err=%v", build.outcome, build.err)
	}
	fts, err := core.Recall(ctx, RecallRequest{OperationID: "recall-after-race", BankRef: bank.BankRef, Query: "mountain hikes", Limit: 4, Capabilities: CapabilitySnapshot{ConfigRevision: 1, Available: []Capability{CapabilityFTSIndex}}}, nil)
	if err != nil || fts.Pipeline != PipelineRecallFTS || len(fts.Hits) != 1 {
		t.Fatalf("independent FTS readiness was damaged by embedding race: result=%+v err=%v", fts, err)
	}
}

func TestExactForgetSurvivesRebuildAndRestart(t *testing.T) {
	root := t.TempDir()
	core := openTestCore(t, root)
	ctx := context.Background()
	bank := ensureTestBank(t, core, "binding-a")
	memoryRef := rememberText(t, core, bank, 1, "I prefer jasmine tea")
	port := &semanticEmbeddingPort{}
	caps := CapabilitySnapshot{ConfigRevision: 1, Available: []Capability{CapabilityFTSIndex, CapabilityTextEmbed, CapabilityVectorIndex}}
	if _, err := core.RebuildEmbedding(ctx, "embedding-build-1", bank.BankRef, caps, port); err != nil {
		t.Fatalf("build embedding before forget: %v", err)
	}
	forgotten, err := core.ForgetExact(ctx, ForgetRequest{OperationID: "forget-1", BindingRef: bank.BindingRef, BankRef: bank.BankRef, LifecycleRef: bank.LifecycleRef, TargetMemoryRefs: []string{memoryRef}, Confirmed: true})
	if err != nil || forgotten.Outcome != OutcomeForgotten || len(forgotten.AffectedMemoryRefs) != 1 {
		t.Fatalf("exact forget: result=%+v err=%v", forgotten, err)
	}
	retry, err := core.ForgetExact(ctx, ForgetRequest{OperationID: "forget-1", BindingRef: bank.BindingRef, BankRef: bank.BankRef, LifecycleRef: bank.LifecycleRef, TargetMemoryRefs: []string{memoryRef}, Confirmed: true})
	if err != nil || retry.Outcome != OutcomeForgotten {
		t.Fatalf("forget retry changed owner result: result=%+v err=%v", retry, err)
	}
	if err := core.RebuildFTS(ctx, bank.BankRef); err != nil {
		t.Fatalf("rebuild FTS after forget: %v", err)
	}
	if _, err := core.RebuildEmbedding(ctx, "embedding-build-2", bank.BankRef, caps, port); err != nil {
		t.Fatalf("rebuild embedding after forget: %v", err)
	}
	for _, testCase := range []struct {
		operation string
		caps      CapabilitySnapshot
		port      EmbeddingPort
	}{{"recall-forgotten-fts", CapabilitySnapshot{ConfigRevision: 1, Available: []Capability{CapabilityFTSIndex}}, nil}, {"recall-forgotten-embedding", caps, port}} {
		result, err := core.Recall(ctx, RecallRequest{OperationID: testCase.operation, BankRef: bank.BankRef, Query: "jasmine tea", Limit: 4, Capabilities: testCase.caps}, testCase.port)
		if err != nil || result.Outcome != OutcomeNoHits || len(result.Hits) != 0 {
			t.Fatalf("forgotten Memory returned after rebuild: result=%+v err=%v", result, err)
		}
	}
	if err := core.Close(); err != nil {
		t.Fatalf("close before restart: %v", err)
	}
	reopened := openTestCore(t, root)
	if err := reopened.RebuildFTS(ctx, bank.BankRef); err != nil {
		t.Fatalf("rebuild FTS after restart: %v", err)
	}
	result, err := reopened.Recall(ctx, RecallRequest{OperationID: "recall-after-restart", BankRef: bank.BankRef, Query: "jasmine tea", Limit: 4, Capabilities: CapabilitySnapshot{ConfigRevision: 1, Available: []Capability{CapabilityFTSIndex}}}, nil)
	if err != nil || result.Outcome != OutcomeNoHits {
		t.Fatalf("restart revived forgotten Memory: result=%+v err=%v", result, err)
	}
	history, err := reopened.ListMemories(ctx, bank.BankRef, true)
	if err != nil || len(history) != 1 || history[0].Lifecycle != LifecycleForgotten {
		t.Fatalf("forget barrier was not durable: history=%+v err=%v", history, err)
	}
}

func TestDeleteBankIsPermanentAndSameSourceRecreationIsEmpty(t *testing.T) {
	core := openTestCore(t, t.TempDir())
	ctx := context.Background()
	bank := ensureTestBank(t, core, "binding-a")
	rememberText(t, core, bank, 1, "I prefer jasmine tea")
	deleted, err := core.DeleteBank(ctx, DeleteBankRequest{OperationID: "delete-bank-a", BindingRef: bank.BindingRef, BankRef: bank.BankRef, LifecycleRef: bank.LifecycleRef, Reason: DeleteReasonAgentTermination})
	if err != nil || deleted.Outcome != OutcomeDeleted {
		t.Fatalf("delete bank: result=%+v err=%v", deleted, err)
	}
	retry, err := core.DeleteBank(ctx, DeleteBankRequest{OperationID: "delete-bank-a", BindingRef: bank.BindingRef, BankRef: bank.BankRef, LifecycleRef: bank.LifecycleRef, Reason: DeleteReasonAgentTermination})
	if err != nil || retry != deleted {
		t.Fatalf("delete retry changed owner result: result=%+v err=%v", retry, err)
	}
	if _, err := core.EnsureBank(ctx, EnsureBankRequest{ContractVersion: ContractVersion, BindingRef: bank.BindingRef, OperationID: "ensure-old-binding"}); !IsOutcome(err, OutcomeConflict) {
		t.Fatalf("deleted binding restored its bank: %v", err)
	}
	recreated, err := core.EnsureBank(ctx, EnsureBankRequest{ContractVersion: ContractVersion, BindingRef: "binding-recreated", OperationID: "ensure-recreated"})
	if err != nil {
		t.Fatalf("ensure recreated Agent bank: %v", err)
	}
	if recreated.BankRef == bank.BankRef {
		t.Fatal("same-source recreation reused the deleted bank")
	}
	memories, err := core.ListMemories(ctx, recreated.BankRef, true)
	if err != nil || len(memories) != 0 {
		t.Fatalf("recreated Agent did not start empty: memories=%+v err=%v", memories, err)
	}
}

func TestV1LogicalRefsExposeNoPhysicalPortabilityOperation(t *testing.T) {
	core := openTestCore(t, t.TempDir())
	bank := ensureTestBank(t, core, "binding-portable")
	for _, value := range []string{bank.BindingRef, bank.BankRef, bank.LifecycleRef} {
		lower := strings.ToLower(value)
		if strings.Contains(lower, "sqlite") || strings.ContainsAny(value, `\\/`) {
			t.Fatalf("opaque logical ref leaked physical storage identity: %q", value)
		}
	}
	coreType := reflect.TypeOf(core)
	for _, method := range []string{"ExportBank", "ImportBank"} {
		if _, found := coreType.MethodByName(method); found {
			t.Fatalf("V1 exposed forbidden portability operation %s", method)
		}
	}
}

type deterministicConformanceRemember struct{}

func (deterministicConformanceRemember) Descriptor() PipelineDescriptor {
	return PipelineDescriptor{Name: "remember.conformance", Operation: "remember"}
}
func (deterministicConformanceRemember) Revision() string { return "test-only-1" }
func (deterministicConformanceRemember) Plan(CommitRequest) (MutationPlan, error) {
	return MutationPlan{Outcome: OutcomeNoEffect}, nil
}

type semanticEmbeddingPort struct {
	fail  bool
	calls int
}

func (p *semanticEmbeddingPort) Embed(_ context.Context, request AIEmbeddingRequest) (AIEmbeddingResult, error) {
	p.calls++
	if p.fail {
		return AIEmbeddingResult{}, errors.New("injected embedding failure")
	}
	result := AIEmbeddingResult{Dimension: 3}
	for _, input := range request.Inputs {
		normalized := strings.ToLower(input)
		switch {
		case strings.Contains(normalized, "jasmine") || strings.Contains(normalized, "beverage"):
			result.Vectors = append(result.Vectors, []float64{1, 0, 0})
		case strings.Contains(normalized, "mountain") || strings.Contains(normalized, "hike"):
			result.Vectors = append(result.Vectors, []float64{0, 1, 0})
		default:
			result.Vectors = append(result.Vectors, []float64{0, 0, 1})
		}
	}
	return result, nil
}

type blockingEmbeddingPort struct {
	started chan struct{}
	release chan struct{}
	once    sync.Once
}

func newBlockingEmbeddingPort() *blockingEmbeddingPort {
	return &blockingEmbeddingPort{started: make(chan struct{}), release: make(chan struct{})}
}

func (p *blockingEmbeddingPort) Embed(ctx context.Context, request AIEmbeddingRequest) (AIEmbeddingResult, error) {
	p.once.Do(func() { close(p.started) })
	select {
	case <-p.release:
	case <-ctx.Done():
		return AIEmbeddingResult{}, ctx.Err()
	}
	return (&semanticEmbeddingPort{}).Embed(ctx, request)
}

func rememberText(t *testing.T, core *Core, bank EnsureBankResult, sequence uint64, text string) string {
	t.Helper()
	request := testCommit(bank, sequence, "event-pipeline-"+string(rune('0'+sequence)), "operation-pipeline-"+string(rune('0'+sequence)), text)
	if _, err := core.ReceiveCommittedEvent(context.Background(), request); err != nil {
		t.Fatalf("receive Remember event %d: %v", sequence, err)
	}
	result, err := core.ExecuteRemember(context.Background(), request.OperationID)
	if err != nil || result.Outcome != OutcomeAdmitted || len(result.AffectedMemoryRefs) != 1 {
		t.Fatalf("execute Remember event %d: result=%+v err=%v", sequence, result, err)
	}
	return result.AffectedMemoryRefs[0]
}
