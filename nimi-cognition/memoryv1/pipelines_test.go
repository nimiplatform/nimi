package memoryv1

import (
	"context"
	"errors"
	"fmt"
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

func TestSecretShapedValueIsRejectedBeforeCustodyWhileSafeCategoryTextRemainsEligible(t *testing.T) {
	core := openTestCore(t, t.TempDir())
	ctx := context.Background()
	bank := ensureTestBank(t, core, "binding-secret-shape")
	secret := testCommit(bank, 1, "event-secret-shape", "operation-secret-shape", "Please remember sk_live_1234567890abcdef")
	received, err := core.ReceiveCommittedEvent(ctx, secret)
	if err != nil || received.Outcome != OutcomeReceived {
		t.Fatalf("receive secret-shaped event as sanitized custody: result=%+v err=%v", received, err)
	}
	var payloadPresent bool
	if err := core.db.QueryRowContext(ctx, `SELECT payload IS NOT NULL FROM memory_receipts WHERE operation_id = ?`, secret.OperationID).Scan(&payloadPresent); err != nil || payloadPresent {
		t.Fatalf("secret-shaped event was retained in Cognition custody: present=%v err=%v", payloadPresent, err)
	}
	rejected, err := core.ExecuteRemember(ctx, secret.OperationID)
	if err != nil || rejected.Outcome != OutcomeRejected {
		t.Fatalf("secret-shaped event was not terminally rejected: result=%+v err=%v", rejected, err)
	}

	safe := testCommit(bank, 2, "event-safe-category", "operation-safe-category", "I prefer password managers with local vaults")
	if _, err := core.ReceiveCommittedEvent(ctx, safe); err != nil {
		t.Fatalf("receive safe category preference: %v", err)
	}
	admitted, err := core.ExecuteRemember(ctx, safe.OperationID)
	if err != nil || admitted.Outcome != OutcomeAdmitted {
		t.Fatalf("safe category preference was rejected by a keyword: result=%+v err=%v", admitted, err)
	}
}

func TestUnlabelledOpaqueCredentialIsRejectedBeforeCustody(t *testing.T) {
	core := openTestCore(t, t.TempDir())
	ctx := context.Background()
	bank := ensureTestBank(t, core, "binding-opaque-secret")
	request := testCommit(bank, 1, "event-opaque-secret", "operation-opaque-secret", "Please remember q8Nv2KpL4Zx7Wd3Hr9Ts6YcB1m")
	if _, err := core.ReceiveCommittedEvent(ctx, request); err != nil {
		t.Fatalf("receive opaque secret: %v", err)
	}
	var payloadPresent bool
	if err := core.db.QueryRowContext(ctx, `SELECT payload IS NOT NULL FROM memory_receipts WHERE operation_id = ?`, request.OperationID).Scan(&payloadPresent); err != nil || payloadPresent {
		t.Fatalf("opaque credential remained in custody: present=%v err=%v", payloadPresent, err)
	}
	result, err := core.ExecuteRemember(ctx, request.OperationID)
	if err != nil || result.Outcome != OutcomeRejected {
		t.Fatalf("opaque credential was not rejected: result=%+v err=%v", result, err)
	}
}

func TestBaselineRememberAdmitsStableAndEpisodicFactsWithoutMagicPreferenceCue(t *testing.T) {
	core := openTestCore(t, t.TempDir())
	ctx := context.Background()
	bank := ensureTestBank(t, core, "binding-stable-facts")
	for index, text := range []string{
		"Call me Alice.",
		"My birthday is May 4.",
		"I am allergic to peanuts.",
		"We completed our first game together today.",
		"我的职业是建筑师。",
	} {
		request := testCommit(bank, uint64(index+1), fmt.Sprintf("event-stable-%d", index+1), fmt.Sprintf("operation-stable-%d", index+1), text)
		if _, err := core.ReceiveCommittedEvent(ctx, request); err != nil {
			t.Fatalf("receive stable fact %q: %v", text, err)
		}
		result, err := core.ExecuteRemember(ctx, request.OperationID)
		if err != nil || result.Outcome != OutcomeAdmitted || len(result.AffectedMemoryRefs) != 1 {
			t.Fatalf("stable fact was not admitted by Baseline: text=%q result=%+v err=%v", text, result, err)
		}
	}
	transient := testCommit(bank, 6, "event-transient-command", "operation-transient-command", "Open settings and show me the theme picker.")
	if _, err := core.ReceiveCommittedEvent(ctx, transient); err != nil {
		t.Fatalf("receive transient command: %v", err)
	}
	if result, err := core.ExecuteRemember(ctx, transient.OperationID); err != nil || result.Outcome != OutcomeNoEffect {
		t.Fatalf("transient command became long-term Memory: result=%+v err=%v", result, err)
	}
}

func TestBaselineRememberSuppressesExactSemanticDuplicate(t *testing.T) {
	core := openTestCore(t, t.TempDir())
	ctx := context.Background()
	bank := ensureTestBank(t, core, "binding-baseline-dedupe")
	rememberText(t, core, bank, 1, "I prefer jasmine tea")
	duplicate := testCommit(bank, 2, "event-baseline-duplicate", "operation-baseline-duplicate", "I   PREFER jasmine tea")
	if _, err := core.ReceiveCommittedEvent(ctx, duplicate); err != nil {
		t.Fatalf("receive duplicate preference: %v", err)
	}
	result, err := core.ExecuteRemember(ctx, duplicate.OperationID)
	if err != nil || result.Outcome != OutcomeNoEffect {
		t.Fatalf("duplicate preference was not suppressed: result=%+v err=%v", result, err)
	}
	memories, err := core.ListMemories(ctx, bank.BankRef, false)
	if err != nil || len(memories) != 1 {
		t.Fatalf("duplicate preference changed canonical Memory: memories=%+v err=%v", memories, err)
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
	embeddingCaps := CapabilitySnapshot{ConfigRevision: 9, EmbeddingSpaceRef: "embedding-space-9", Available: []Capability{CapabilityFTSIndex, CapabilityTextEmbed, CapabilityVectorIndex}}
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
	caps := CapabilitySnapshot{ConfigRevision: 1, EmbeddingSpaceRef: "embedding-space-1", Available: []Capability{CapabilityTextEmbed, CapabilityVectorIndex, CapabilityFTSIndex}}
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
	caps := CapabilitySnapshot{ConfigRevision: 1, EmbeddingSpaceRef: "embedding-space-1", Available: []Capability{CapabilityFTSIndex, CapabilityTextEmbed, CapabilityVectorIndex}}
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
	if err != nil || len(history) != 0 {
		t.Fatalf("forgotten Memory was returned from owner history: history=%+v err=%v", history, err)
	}
	status, err := reopened.InspectStatus(ctx, bank.BindingRef, bank.BankRef)
	if err != nil || status.Forgotten != 1 {
		t.Fatalf("forget barrier count was not durable: status=%+v err=%v", status, err)
	}
}

func TestTerminalRememberRetryCompletesDerivedStateAndFrontierAfterRestart(t *testing.T) {
	root := t.TempDir()
	core := openTestCore(t, root)
	ctx := context.Background()
	bank := ensureTestBank(t, core, "binding-terminal-recovery")
	request := testCommit(bank, 1, "event-terminal-recovery", "operation-terminal-recovery", "I prefer jasmine tea")
	if _, err := core.ReceiveCommittedEvent(ctx, request); err != nil {
		t.Fatalf("receive terminal recovery event: %v", err)
	}
	if _, err := core.bindRoute(ctx, routeBindingRequest{
		OperationID: request.OperationID, OperationKind: "remember", BankRef: request.BankRef,
		Pipeline: PipelineRememberBaseline, AlgorithmRevision: "baseline-1", Snapshot: CapabilitySnapshot{},
	}); err != nil {
		t.Fatalf("bind terminal recovery route: %v", err)
	}
	if _, err := core.MarkProcessing(ctx, request.OperationID); err != nil {
		t.Fatalf("mark terminal recovery event processing: %v", err)
	}
	committed, err := core.CommitDecision(ctx, request.OperationID, MutationPlan{Outcome: OutcomeAdmitted, Mutations: []MemoryMutation{{
		Kind: MutationRemember, Content: request.Fact.Message.Parts[0].Text, EpistemicStatus: EpistemicExplicit,
		SourceExplanation: "Committed user message",
	}}})
	if err != nil || committed.Outcome != OutcomeAdmitted {
		t.Fatalf("commit terminal recovery decision: result=%+v err=%v", committed, err)
	}
	if err := core.Close(); err != nil {
		t.Fatalf("close before terminal recovery: %v", err)
	}

	reopened := openTestCore(t, root)
	recovered, err := reopened.ExecuteRemember(ctx, request.OperationID)
	if err != nil || recovered.Outcome != OutcomeAdmitted {
		t.Fatalf("recover terminal Remember: result=%+v err=%v", recovered, err)
	}
	status, err := reopened.InspectStatus(ctx, bank.BindingRef, bank.BankRef)
	if err != nil || status.Frontiers.Ready != 1 || status.Events[0].PayloadPresent {
		t.Fatalf("terminal recovery did not close custody/frontier: status=%+v err=%v", status, err)
	}
	result, err := reopened.Recall(ctx, RecallRequest{
		OperationID: "recall-terminal-recovery", BankRef: bank.BankRef, Query: "jasmine tea", Limit: 4,
		Capabilities: CapabilitySnapshot{Available: []Capability{CapabilityFTSIndex}},
	}, nil)
	if err != nil || result.Outcome != OutcomeReady || len(result.Hits) != 1 {
		t.Fatalf("terminal recovery did not restore FTS: result=%+v err=%v", result, err)
	}
}

func TestForgetKeepsUnaffectedMemoryImmediatelyRecallable(t *testing.T) {
	core := openTestCore(t, t.TempDir())
	ctx := context.Background()
	bank := ensureTestBank(t, core, "binding-forget-continuity")
	forgottenRef := rememberText(t, core, bank, 1, "I prefer jasmine tea")
	rememberText(t, core, bank, 2, "I like mountain hikes")
	port := &semanticEmbeddingPort{}
	caps := CapabilitySnapshot{ConfigRevision: 4, EmbeddingSpaceRef: "embedding-space-4", Available: []Capability{CapabilityFTSIndex, CapabilityTextEmbed, CapabilityVectorIndex}}
	if outcome, err := core.RebuildEmbedding(ctx, "embedding-before-forget", bank.BankRef, caps, port); err != nil || outcome != OutcomeReady {
		t.Fatalf("build embedding before continuity forget: outcome=%s err=%v", outcome, err)
	}
	if result, err := core.ForgetExact(ctx, ForgetRequest{
		OperationID: "forget-continuity", BindingRef: bank.BindingRef, BankRef: bank.BankRef,
		LifecycleRef: bank.LifecycleRef, TargetMemoryRefs: []string{forgottenRef}, Confirmed: true,
	}); err != nil || result.Outcome != OutcomeForgotten {
		t.Fatalf("forget continuity target: result=%+v err=%v", result, err)
	}
	for _, testCase := range []struct {
		operation string
		caps      CapabilitySnapshot
		port      EmbeddingPort
	}{
		{"recall-unaffected-fts", CapabilitySnapshot{Available: []Capability{CapabilityFTSIndex}}, nil},
		{"recall-unaffected-embedding", caps, port},
	} {
		result, err := core.Recall(ctx, RecallRequest{OperationID: testCase.operation, BankRef: bank.BankRef, Query: "mountain hikes", Limit: 4, Capabilities: testCase.caps}, testCase.port)
		if err != nil || result.Outcome != OutcomeReady || len(result.Hits) != 1 || !strings.Contains(result.Hits[0].Content, "mountain") {
			t.Fatalf("unaffected Memory unavailable after exact forget: operation=%s result=%+v err=%v", testCase.operation, result, err)
		}
	}
}

func TestEmbeddingGenerationRequiresExactSpaceIdentity(t *testing.T) {
	core := openTestCore(t, t.TempDir())
	ctx := context.Background()
	bank := ensureTestBank(t, core, "binding-embedding-space")
	rememberText(t, core, bank, 1, "I prefer jasmine tea")
	port := &semanticEmbeddingPort{}
	spaceA := CapabilitySnapshot{ConfigRevision: 11, EmbeddingSpaceRef: "embedding-space-a", Available: []Capability{CapabilityTextEmbed, CapabilityVectorIndex}}
	if outcome, err := core.RebuildEmbedding(ctx, "embedding-space-build-a", bank.BankRef, spaceA, port); err != nil || outcome != OutcomeReady {
		t.Fatalf("build embedding space A: outcome=%s err=%v", outcome, err)
	}
	spaceB := CapabilitySnapshot{ConfigRevision: 12, EmbeddingSpaceRef: "embedding-space-b", Available: []Capability{CapabilityTextEmbed, CapabilityVectorIndex}}
	result, err := core.Recall(ctx, RecallRequest{OperationID: "recall-space-b", BankRef: bank.BankRef, Query: "favorite warm beverage", Limit: 4, Capabilities: spaceB}, port)
	if err == nil || (result.Outcome != OutcomePending && result.Outcome != OutcomeUnavailable) || len(result.Hits) != 0 {
		t.Fatalf("incompatible embedding space reused ready generation: result=%+v err=%v", result, err)
	}
}

func TestConcurrentEmbeddingRebuildsLeaveOneReadyGeneration(t *testing.T) {
	core := openTestCore(t, t.TempDir())
	ctx := context.Background()
	bank := ensureTestBank(t, core, "binding-concurrent-embedding")
	rememberText(t, core, bank, 1, "I prefer jasmine tea")
	port := newBarrierEmbeddingPort(2)
	caps := CapabilitySnapshot{ConfigRevision: 21, EmbeddingSpaceRef: "embedding-space-concurrent", Available: []Capability{CapabilityTextEmbed, CapabilityVectorIndex}}
	type buildResult struct {
		outcome Outcome
		err     error
	}
	results := make(chan buildResult, 2)
	for _, operationID := range []string{"embedding-concurrent-a", "embedding-concurrent-b"} {
		go func(operationID string) {
			outcome, err := core.RebuildEmbedding(ctx, operationID, bank.BankRef, caps, port)
			results <- buildResult{outcome: outcome, err: err}
		}(operationID)
	}
	<-port.allStarted
	close(port.release)
	for range 2 {
		result := <-results
		if result.err != nil || result.outcome != OutcomeReady {
			t.Fatalf("concurrent embedding rebuild failed: outcome=%s err=%v", result.outcome, result.err)
		}
	}
	var ready int
	if err := core.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM memory_derived_generations WHERE bank_ref = ? AND kind = 'embedding' AND status = 'ready'`, bank.BankRef).Scan(&ready); err != nil {
		t.Fatalf("count ready embedding generations: %v", err)
	}
	if ready != 1 {
		t.Fatalf("concurrent rebuilds left %d ready generations, want exactly one", ready)
	}
}

func TestEmbeddingPublishRejectsLifecycleCutoff(t *testing.T) {
	core := openTestCore(t, t.TempDir())
	ctx := context.Background()
	bank := ensureTestBank(t, core, "binding-embedding-cutoff")
	rememberText(t, core, bank, 1, "I prefer jasmine tea")
	port := newBlockingEmbeddingPort()
	caps := CapabilitySnapshot{ConfigRevision: 31, EmbeddingSpaceRef: "embedding-space-cutoff", Available: []Capability{CapabilityTextEmbed, CapabilityVectorIndex}}
	type buildResult struct {
		outcome Outcome
		err     error
	}
	done := make(chan buildResult, 1)
	go func() {
		outcome, err := core.RebuildEmbedding(ctx, "embedding-cutoff-build", bank.BankRef, caps, port)
		done <- buildResult{outcome: outcome, err: err}
	}()
	<-port.started
	if _, err := core.ApplyCutoff(ctx, CutoffRequest{
		ContractVersion: ContractVersion, BindingRef: bank.BindingRef, BankRef: bank.BankRef,
		OperationID: "embedding-cutoff", CurrentLifecycleRef: bank.LifecycleRef,
		NewLifecycleRef: "lifecycle-after-embedding-cutoff", ReplacementBindingRef: "binding-after-embedding-cutoff",
	}); err != nil {
		t.Fatalf("apply lifecycle cutoff during embedding: %v", err)
	}
	close(port.release)
	result := <-done
	if result.outcome != OutcomeConflict || !IsOutcome(result.err, OutcomeConflict) {
		t.Fatalf("pre-cut embedding published after lifecycle rotation: outcome=%s err=%v", result.outcome, result.err)
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
func (deterministicConformanceRemember) Plan(CommitRequest, []Memory) (MutationPlan, error) {
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

type barrierEmbeddingPort struct {
	started    int
	required   int
	mu         sync.Mutex
	allStarted chan struct{}
	release    chan struct{}
}

func newBarrierEmbeddingPort(required int) *barrierEmbeddingPort {
	return &barrierEmbeddingPort{required: required, allStarted: make(chan struct{}), release: make(chan struct{})}
}

func (p *barrierEmbeddingPort) Embed(ctx context.Context, request AIEmbeddingRequest) (AIEmbeddingResult, error) {
	p.mu.Lock()
	p.started++
	if p.started == p.required {
		close(p.allStarted)
	}
	p.mu.Unlock()
	select {
	case <-p.release:
	case <-ctx.Done():
		return AIEmbeddingResult{}, ctx.Err()
	}
	return (&semanticEmbeddingPort{}).Embed(ctx, request)
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
