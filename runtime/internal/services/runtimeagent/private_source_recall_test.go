package runtimeagent

import (
	"context"
	"errors"
	"math"
	"strings"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	cognitionservice "github.com/nimiplatform/nimi/runtime/internal/services/cognition"
)

func TestPrivateSourceRecallAPMLIsStrictAndBounded(t *testing.T) {
	request, present, err := parsePublicChatPrivateSourceRecall(`<message id="message-0"><query>Who is the recorded spouse?</query></message>`)
	if err != nil || !present || request.Query != "Who is the recorded spouse?" {
		t.Fatalf("valid recall = %#v present=%v err=%v", request, present, err)
	}
	if _, present, err := parsePublicChatPrivateSourceRecall(`<message id="message-0">done</message>`); err != nil || present {
		t.Fatalf("final message classified as recall: present=%v err=%v", present, err)
	}
	if _, present, err := parsePublicChatPrivateSourceRecall(`<message id="message-0"><query></query></message>`); !present || err == nil {
		t.Fatal("empty recall query was accepted")
	}
	if _, present, err := parsePublicChatPrivateSourceRecall(`<message id="message-0">reply<query>Find it.</query></message>`); !present || err == nil {
		t.Fatal("recall with public reply text was accepted")
	}
	if _, present, err := parsePublicChatPrivateSourceRecall(`<message id="message-0"><query>Find it.</query><activity>searching</activity></message>`); !present || err == nil {
		t.Fatal("recall with an extra message tag was accepted")
	}
	if _, present, err := parsePublicChatPrivateSourceRecall(`<message id="message-0">done<emotion>happy</emotion></message>`); err != nil || present {
		t.Fatalf("ordinary final message classified as recall: present=%v err=%v", present, err)
	}
	invalidShapes := []string{
		`<message id=" message-0 "><query>Find it.</query></message>`,
		`<message id="message-0" extra="x"><query>Find it.</query></message>`,
		`<message id="message-0"><query format="text">Find it.</query></message>`,
		`<message id="message-0"><query>Find <nested>it</nested>.</query></message>`,
		`<message id="message-0"><query>Find it.</query><query>Again.</query></message>`,
		`<message id="message-0"><unknown/><query>Find it.</query></message>`,
		`<message id="message-0"><query>Find it.</query><!-- hidden --></message>`,
		`<message id="message-0"><query>Find it.</query></message>trailing`,
		`<message id="message-0"><query>Find it.</query></message><message id="message-1">sibling</message>`,
	}
	for _, raw := range invalidShapes {
		if _, present, err := parsePublicChatPrivateSourceRecall(raw); !present || err == nil {
			t.Fatalf("non-exact private recall shape was accepted: present=%v err=%v raw=%s", present, err, raw)
		}
	}
}

func TestPrivateSourceRecallRoundTwoContextIsMandatoryAndPrivate(t *testing.T) {
	input := agentTurnContextTestInput(t, "worldCharacter")
	unit := sourceCognitionTestPartition(t, agentTurnContextTestSnapshot(t, "worldCharacter")).CognitionUnits[0]
	input.PrivateRecall = &agentTurnPrivateRecallInput{
		Query: "Who is the recorded spouse?", Status: "ready",
		Candidates: []agentTurnCognitionCandidateInput{{UnitID: unit.StableID, Category: unit.Category, SourcePath: unit.SourcePath, SourceRef: unit.SourceRef, Text: unit.Text, Priority: unit.Priority, Score: 0.9}},
	}
	input.OutputContract.Instruction = publicChatAPMLFinalOutputContractPrompt(publicChatAvailableActions{})
	compiled, err := compileAgentTurnContext(input)
	if err != nil {
		t.Fatal(err)
	}
	if compiled.Manifest.PrivateRecallCount != 1 || compiled.Summary.GetPrivateRecallCount() != 1 {
		t.Fatalf("private recall count = %d / %d", compiled.Manifest.PrivateRecallCount, compiled.Summary.GetPrivateRecallCount())
	}
	lane := agentTurnContextTestLane(t, compiled.PrivateLanes, agentTurnContextLanePrivateRecall)
	if lane.IncludedItemCount != 1 || !lane.Items[0].Mandatory || lane.Items[0].TruncationClass != agentTurnContextTruncationNone {
		t.Fatalf("private recall lane = %#v", lane)
	}
	prompt := agentTurnContextTestProviderText(compiled.ProviderPrompt)
	if !strings.Contains(prompt, "Runtime-private source recall exchange") || !strings.Contains(prompt, "request_apml") || !strings.Contains(prompt, "Who is the recorded spouse?") {
		t.Fatal("Round 2 provider context is missing private request/result")
	}
	contractLane := agentTurnContextTestLane(t, compiled.PrivateLanes, agentTurnContextLaneOutputContract)
	if len(contractLane.Items) != 1 || len(contractLane.Items[0].Segments) != 1 ||
		!strings.Contains(contractLane.Items[0].Segments[0].Content, "Round 2 final-only") ||
		strings.Contains(contractLane.Items[0].Segments[0].Content, "If essential source facts are missing") {
		t.Fatal("Round 2 reused the recall-capable Round 1 output contract")
	}
	for _, message := range compiled.ProviderPrompt.Messages {
		if message.Role == "tool" {
			t.Fatal("provider-neutral private recall used a provider-native tool role")
		}
	}
}

func TestPrivateSourceRecallUsesSameSnapshotGuardedCandidates(t *testing.T) {
	snapshot := agentTurnContextTestSnapshot(t, "worldCharacter")
	source := sourceCognitionTestTurnView(t, snapshot)
	partition := sourceCognitionTestPartition(t, snapshot)
	unit := partition.CognitionUnits[0]
	bridge := &sourceCognitionBridgeStub{search: cognitionservice.AgentSourceOutcome{Status: "ready", ScopeID: sourceCognitionScopeID(snapshot.LocalAgentRef), SnapshotIdentity: snapshot.SnapshotHash, PartitionIdentity: snapshot.Partition.PartitionHash, Generation: 2, UnitCount: snapshot.Partition.UnitCount, OmissionCount: snapshot.Partition.OmissionCount, Units: []cognitionservice.AgentSourceUnit{{
		UnitID: unit.StableID, Category: unit.Category, SourcePath: unit.SourcePath,
		SourceRef: cognitionservice.AgentSourceRef{Kind: unit.SourceRef.Kind, WorldID: unit.SourceRef.WorldID, RefID: unit.SourceRef.RefID, SchemaVersion: unit.SourceRef.SchemaVersion, ContentHash: unit.SourceRef.ContentHash},
		Text:      unit.Text, ProvenanceRefs: append([]string{}, unit.ProvenanceRefs...), Priority: unit.Priority, Score: 0.9,
	}}}}
	runtime := publicChatRuntime{svc: &Service{
		sourceCognitionBridge: bridge,
		agents: map[string]*agentEntry{snapshot.LocalAgentRef: {Agent: &runtimev1.LocalAgentRecord{
			LocalAgentRef: snapshot.LocalAgentRef, LifecycleStatus: runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE,
		}}},
		turnSourceViews: map[string]localAgentTurnSourceViewV1{snapshot.LocalAgentRef: source},
	}}
	result := runtime.executePublicChatPrivateSourceRecall(context.Background(), publicChatAnchorState{OwnerUserID: "owner-1", LocalAgentRef: snapshot.LocalAgentRef}, "identity")
	if result.Status != "ready" || len(result.Candidates) != 1 || result.Candidates[0].UnitID != unit.StableID {
		t.Fatalf("private recall result = %#v", result)
	}
}

func TestPrivateRecallSharesOneRequestAcrossSourceAndLongTermMemory(t *testing.T) {
	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	const sourceRef = "agent-private-memory-recall"
	localAgentRef := testRuntimeAgentLocalRef(sourceRef)
	if _, err := materializeRealmSourceTestAgent(t, svc, ctx, &realmSourceTestAgentInput{Context: testRuntimeAgentIdentityContext(sourceRef)}); err != nil {
		t.Fatalf("RealmSourceMaterialization: %v", err)
	}
	seedCognitionMemoryForTerminationTest(t, svc, localAgentRef, "I prefer jasmine tea in the afternoon")
	runtime := publicChatRuntime{svc: svc}
	result := runtime.executePublicChatPrivateSourceRecall(ctx, publicChatAnchorState{OwnerUserID: "user-1", LocalAgentRef: localAgentRef}, "jasmine tea")
	if result.Status != "ready" {
		t.Fatalf("shared private recall status = %q, want ready", result.Status)
	}
	if len(result.Memory) != 1 || !strings.Contains(result.Memory[0].Text, "jasmine tea") ||
		!strings.Contains(result.Memory[0].Text, "epistemic_status") || result.Memory[0].ProvenanceRef == "" {
		t.Fatalf("shared private recall lost the typed Memory lane: %+v", result.Memory)
	}
}

func TestPrivateRecallMemoryKeepsEpistemicProvenanceAndAdvisoryTrust(t *testing.T) {
	now := time.Date(2026, 8, 28, 10, 0, 0, 0, time.UTC)
	memory, err := publicChatCognitionMemoryInputs([]memoryv1.Memory{{
		MemoryRef: "memory-inferred", BankRef: "bank-private", Content: "The user may prefer quiet mornings",
		EpistemicStatus: memoryv1.EpistemicInferred, Lifecycle: memoryv1.LifecycleCurrent,
		OccurredAt: now, UpdatedAt: now.Add(time.Minute), SourceExplanation: "Committed activity inference", EventRef: "event-inferred",
		Subjects: []memoryv1.TypedRef{{Kind: "account_subject", Value: "subject-opaque"}},
		Sources:  []memoryv1.TypedRef{{Kind: "activity", Value: "activity-opaque"}},
	}})
	if err != nil || len(memory) != 1 {
		t.Fatalf("map inferred Memory: memory=%+v err=%v", memory, err)
	}
	input := agentTurnContextTestInput(t, "worldCharacter")
	duplicate := memory[0]
	duplicate.RelevanceRank = 99
	input.Memory = append(input.Memory, duplicate)
	input.PrivateRecall = &agentTurnPrivateRecallInput{Query: "morning preference", Status: "ready", Memory: memory}
	input.OutputContract.Instruction = publicChatAPMLFinalOutputContractPrompt(publicChatAvailableActions{})
	compiled, err := compileAgentTurnContext(input)
	if err != nil {
		t.Fatal(err)
	}
	memoryLane := agentTurnContextTestLane(t, compiled.PrivateLanes, agentTurnContextLaneCanonicalMemory)
	var recalled agentTurnContextItem
	recalledCount := 0
	for _, item := range memoryLane.Items {
		if item.StableID == "cognition.memory.memory-inferred" {
			recalled = item
			recalledCount++
		}
	}
	if memoryLane.TrustClass != agentTurnContextTrustCognitionScoped || recalledCount != 1 || len(recalled.Segments) != 1 ||
		!strings.Contains(recalled.Segments[0].Content, "epistemic_status") ||
		!strings.Contains(recalled.Segments[0].Content, "inferred") ||
		!strings.Contains(recalled.Segments[0].Content, "event-inferred") ||
		!strings.Contains(recalled.Segments[0].Content, "activity:activity-opaque") {
		t.Fatalf("private recalled Memory lost advisory trust or provenance: lane=%+v", memoryLane)
	}
	privateLane := agentTurnContextTestLane(t, compiled.PrivateLanes, agentTurnContextLanePrivateRecall)
	if privateLane.TrustClass != agentTurnContextTrustValidatedSource || strings.Contains(privateLane.Items[0].Segments[0].Content, "quiet mornings") {
		t.Fatalf("Memory was promoted into the validated source exchange: lane=%+v", privateLane)
	}
}

func TestPrivateRecallRoundTwoFailuresPreserveObservedResultAndUsage(t *testing.T) {
	t.Parallel()
	input := agentTurnContextTestInput(t, "worldCharacter")
	input.PrivateRecall = &agentTurnPrivateRecallInput{Query: "bounded recall", Status: "unavailable"}
	input.OutputContract.Instruction = publicChatAPMLFinalOutputContractPrompt(publicChatAvailableActions{})
	compiled, err := compileAgentTurnContext(input)
	if err != nil {
		t.Fatal(err)
	}
	transportErr := errors.New("round two transport canary")
	testCases := []struct {
		name       string
		afterUsage func(func(*runtimev1.StreamScenarioEvent) error) error
		wantReason runtimev1.ReasonCode
		wantFailed bool
	}{
		{
			name: "scenario-failed",
			afterUsage: func(emit func(*runtimev1.StreamScenarioEvent) error) error {
				return emit(&runtimev1.StreamScenarioEvent{Payload: &runtimev1.StreamScenarioEvent_Failed{Failed: &runtimev1.ScenarioStreamFailed{
					ReasonCode: runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT, ActionHint: "retry_provider",
				}}})
			},
			wantReason: runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT,
			wantFailed: true,
		},
		{
			name:       "stream-error",
			afterUsage: func(func(*runtimev1.StreamScenarioEvent) error) error { return transportErr },
		},
		{
			name:       "missing-completion",
			afterUsage: func(func(*runtimev1.StreamScenarioEvent) error) error { return nil },
			wantReason: runtimev1.ReasonCode_AI_STREAM_BROKEN,
		},
		{
			name: "repeated-recall",
			afterUsage: func(emit func(*runtimev1.StreamScenarioEvent) error) error {
				if err := emit(&runtimev1.StreamScenarioEvent{Payload: &runtimev1.StreamScenarioEvent_Delta{Delta: runtimeAgentTextStreamDelta(
					`<message id="message-0"><query>repeat</query></message>`)}}); err != nil {
					return err
				}
				return emit(&runtimev1.StreamScenarioEvent{Payload: &runtimev1.StreamScenarioEvent_Completed{Completed: &runtimev1.ScenarioStreamCompleted{FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP}}})
			},
			wantReason: runtimev1.ReasonCode_AI_OUTPUT_INVALID,
		},
		{
			name: "invalid-recall-shape",
			afterUsage: func(emit func(*runtimev1.StreamScenarioEvent) error) error {
				if err := emit(&runtimev1.StreamScenarioEvent{Payload: &runtimev1.StreamScenarioEvent_Delta{Delta: runtimeAgentTextStreamDelta(
					`<message id="message-0"><query><nested>invalid</nested></query></message>`)}}); err != nil {
					return err
				}
				return emit(&runtimev1.StreamScenarioEvent{Payload: &runtimev1.StreamScenarioEvent_Completed{Completed: &runtimev1.ScenarioStreamCompleted{FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP}}})
			},
			wantReason: runtimev1.ReasonCode_AI_OUTPUT_INVALID,
		},
	}
	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			svc := &Service{}
			svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{stream: func(_ context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
				if err := emit(&runtimev1.StreamScenarioEvent{Payload: &runtimev1.StreamScenarioEvent_Usage{Usage: &runtimev1.UsageStats{
					InputTokens: 17, OutputTokens: 13, ComputeMs: 11, CachedInputTokens: 7, ReasoningOutputTokens: 5,
				}}}); err != nil {
					return err
				}
				return testCase.afterUsage(emit)
			}})
			result, roundErr := (publicChatRuntime{svc: svc}).executePublicChatPrivateRound(
				context.Background(),
				publicChatAnchorState{CallerAppID: "desktop.app", SubjectUserID: "user-1", Binding: publicChatExecutionBinding{ModelID: "round-two-model", RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD}},
				publicChatTurnState{},
				compiled,
			)
			if roundErr == nil || result == nil || result.Usage == nil || result.Usage.GetInputTokens() != 17 || result.Usage.GetOutputTokens() != 13 || result.Usage.GetComputeMs() != 11 || result.Usage.GetCachedInputTokens() != 7 || result.Usage.GetReasoningOutputTokens() != 5 {
				t.Fatalf("Round 2 failure lost observed result/usage: result=%+v err=%v", result, roundErr)
			}
			if testCase.wantFailed != (result.Failed != nil) {
				t.Fatalf("ScenarioStreamFailed preservation=%v want=%v", result.Failed != nil, testCase.wantFailed)
			}
			if testCase.name == "stream-error" {
				if !errors.Is(roundErr, transportErr) {
					t.Fatalf("transport error cause was not preserved: %v", roundErr)
				}
				return
			}
			if reason, ok := grpcerr.ExtractReasonCode(roundErr); !ok || reason != testCase.wantReason {
				t.Fatalf("Round 2 failure reason=%s ok=%v want=%s err=%v", reason, ok, testCase.wantReason, roundErr)
			}
		})
	}
}

func TestPrivateRecallTurnSuppressesProviderReasoningAndAggregatesBothRounds(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})

	svc.chatSurfaceMu.Lock()
	svc.chatAnchors[anchorID].Reasoning = &publicChatReasoningConfig{
		Activation:        runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED,
		Presentation:      runtimev1.ReasoningPresentation_REASONING_PRESENTATION_SUMMARY,
		ExactBudgetTokens: 128,
	}
	svc.chatSurfaceMu.Unlock()

	callCount := 0
	capturedReasoning := make([]publicChatReasoningConfig, 0, 2)
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(_ context.Context, req *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			callCount++
			captured := publicChatReasoningConfig{}
			if req.Reasoning != nil {
				captured = *req.Reasoning
			}
			capturedReasoning = append(capturedReasoning, captured)
			traceID := "trace-private-recall-round-1"
			output := `<message id="message-0"><query>private-query-canary</query></message>`
			reasoning := "round-one-private-recall-reasoning-canary"
			usage := &runtimev1.UsageStats{InputTokens: 11, OutputTokens: 7, ComputeMs: 13, CachedInputTokens: 5, ReasoningOutputTokens: 3}
			finishReason := runtimev1.FinishReason_FINISH_REASON_LENGTH
			if callCount == 2 {
				traceID = "trace-private-recall-round-2"
				output = publicChatStructuredEnvelopeAPML("message-private-recall-final", "final answer")
				reasoning = "round-two-private-result-reasoning-canary"
				usage = &runtimev1.UsageStats{InputTokens: 19, OutputTokens: 23, ComputeMs: 29, CachedInputTokens: 31, ReasoningOutputTokens: 37}
				finishReason = runtimev1.FinishReason_FINISH_REASON_STOP
			}
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   traceID,
				Payload: &runtimev1.StreamScenarioEvent_Started{Started: &runtimev1.ScenarioStreamStarted{
					ModelResolved: "private-recall-model", RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
				}},
			}); err != nil {
				return err
			}
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
				TraceId:   traceID,
				Payload: &runtimev1.StreamScenarioEvent_Delta{Delta: runtimeAgentReasoningSummaryStreamDelta(
					reasoning)},
			}); err != nil {
				return err
			}
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
				TraceId:   traceID,
				Payload: &runtimev1.StreamScenarioEvent_Delta{Delta: runtimeAgentTextStreamDeltaAt(
					1, true, output)},
			}); err != nil {
				return err
			}
			return emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
				TraceId:   traceID,
				Payload: &runtimev1.StreamScenarioEvent_Completed{Completed: &runtimev1.ScenarioStreamCompleted{
					FinishReason: finishReason, Usage: usage,
				}},
			})
		},
	})

	err := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"local_agent_ref":        testRuntimeAgentLocalRef("agent-alpha"),
			"owner_user_id":          "user-1",
			"runtime_source_ref":     testRuntimeAgentSourceRef("agent-alpha"),
			"conversation_anchor_id": anchorID,
			"request_id":             "private-recall-reasoning-boundary",
			"thread_id":              publicChatTestAnchorThreadID(t, svc, anchorID),
			"messages":               []any{map[string]any{"role": "user", "content": "answer with source help"}},
		}),
	})
	if err != nil {
		t.Fatalf("ConsumePublicChatAppMessage: %v", err)
	}
	_ = capture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = capture.waitForMessageType(t, publicChatTurnCompletedType)
	waitForPublicChatAgentIdle(t, svc, "agent-alpha")

	if callCount != 2 || len(capturedReasoning) != 2 {
		t.Fatalf("private recall provider rounds=%d reasoning captures=%d", callCount, len(capturedReasoning))
	}
	for round, reasoning := range capturedReasoning {
		if reasoning.Activation != runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED || reasoning.Presentation != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_SUMMARY || reasoning.ExactBudgetTokens != 128 {
			t.Fatalf("provider round %d changed captured reasoning config: %+v", round+1, reasoning)
		}
	}
	for _, messageType := range capture.messageTypes() {
		if messageType == "runtime.agent.turn.reasoning_delta" {
			t.Fatal("private recall turn projected provider reasoning")
		}
	}
	capture.mu.Lock()
	events := append([]*runtimev1.SendAppMessageRequest(nil), capture.items...)
	capture.mu.Unlock()
	for _, event := range events {
		payload := event.GetPayload().String()
		for _, privateCanary := range []string{"private-query-canary", "round-one-private-recall-reasoning-canary", "round-two-private-result-reasoning-canary"} {
			if strings.Contains(payload, privateCanary) {
				t.Fatalf("private recall material escaped through %s: %s", event.GetMessageType(), payload)
			}
		}
	}

	svc.chatSurfaceMu.Lock()
	lastTurn := clonePublicChatTurnProjectionState(svc.chatAnchors[anchorID].LastTurnSnapshot)
	svc.chatSurfaceMu.Unlock()
	if lastTurn == nil || lastTurn.ReasoningObserved || lastTurn.FinishReason != "stop" {
		t.Fatalf("private recall terminal projection is invalid: %+v", lastTurn)
	}
	usage := lastTurn.Usage
	if usage == nil || usage.GetInputTokens() != 30 || usage.GetOutputTokens() != 30 || usage.GetComputeMs() != 42 || usage.GetCachedInputTokens() != 36 || usage.GetReasoningOutputTokens() != 40 {
		t.Fatalf("private recall usage was not aggregated across both rounds: %+v", usage)
	}
	if budget := lastTurn.ContextSummary.GetBudget(); budget.GetReservedReasoningTokens() != 128 {
		t.Fatalf("effective reasoning reserve was not projected: %+v", budget)
	}
}

func TestNormalTurnProjectsBoundedReasoningStatusWithoutReasoningContent(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})

	svc.chatSurfaceMu.Lock()
	svc.chatAnchors[anchorID].Reasoning = &publicChatReasoningConfig{
		Activation:        runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED,
		Presentation:      runtimev1.ReasoningPresentation_REASONING_PRESENTATION_SUMMARY,
		ExactBudgetTokens: 128,
	}
	svc.chatSurfaceMu.Unlock()

	const privateReasoningCanary = "normal-turn-private-reasoning-canary"
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(_ context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   "trace-normal-reasoning",
				Payload: &runtimev1.StreamScenarioEvent_Started{Started: &runtimev1.ScenarioStreamStarted{
					ModelResolved: "normal-reasoning-model", RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
				}},
			}); err != nil {
				return err
			}
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
				TraceId:   "trace-normal-reasoning",
				Payload: &runtimev1.StreamScenarioEvent_Delta{Delta: runtimeAgentReasoningSummaryStreamDelta(
					privateReasoningCanary)},
			}); err != nil {
				return err
			}
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
				TraceId:   "trace-normal-reasoning",
				Payload: &runtimev1.StreamScenarioEvent_Delta{Delta: runtimeAgentTextStreamDeltaAt(
					1, true, publicChatStructuredEnvelopeAPML("message-normal-reasoning", "normal answer"))},
			}); err != nil {
				return err
			}
			return emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
				TraceId:   "trace-normal-reasoning",
				Payload: &runtimev1.StreamScenarioEvent_Completed{Completed: &runtimev1.ScenarioStreamCompleted{
					FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
				}},
			})
		},
	})

	err := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"local_agent_ref":        testRuntimeAgentLocalRef("agent-alpha"),
			"owner_user_id":          "user-1",
			"runtime_source_ref":     testRuntimeAgentSourceRef("agent-alpha"),
			"conversation_anchor_id": anchorID,
			"request_id":             "normal-reasoning-status",
			"thread_id":              publicChatTestAnchorThreadID(t, svc, anchorID),
			"messages":               []any{map[string]any{"role": "user", "content": "answer normally"}},
		}),
	})
	if err != nil {
		t.Fatalf("ConsumePublicChatAppMessage: %v", err)
	}
	_ = capture.waitForMessageType(t, publicChatTurnAcceptedType)
	states := []string{"started", "active", "completed"}
	for _, want := range states {
		event := capture.waitForMessageType(t, publicChatTurnReasoningStatusType)
		if got := publicChatTurnDetail(t, event)["state"]; got != want {
			t.Fatalf("reasoning status=%v want=%s", got, want)
		}
	}
	_ = capture.waitForMessageType(t, publicChatTurnTextDeltaType)
	_ = capture.waitForMessageType(t, publicChatTurnMessageCommittedType)
	_ = capture.waitForMessageType(t, publicChatTurnCompletedType)
	waitForPublicChatAgentIdle(t, svc, "agent-alpha")

	capture.mu.Lock()
	events := append([]*runtimev1.SendAppMessageRequest(nil), capture.items...)
	capture.mu.Unlock()
	for _, event := range events {
		if strings.Contains(event.GetPayload().String(), privateReasoningCanary) {
			t.Fatalf("reasoning content escaped through %s", event.GetMessageType())
		}
		if event.GetMessageType() == "runtime.agent.turn.reasoning_delta" {
			t.Fatal("normal turn projected forbidden reasoning content event")
		}
	}
	svc.chatSurfaceMu.Lock()
	lastTurn := clonePublicChatTurnProjectionState(svc.chatAnchors[anchorID].LastTurnSnapshot)
	svc.chatSurfaceMu.Unlock()
	if lastTurn == nil || !lastTurn.ReasoningObserved || lastTurn.Status != publicChatTurnStatusCompleted {
		t.Fatalf("normal reasoning terminal projection is invalid: %+v", lastTurn)
	}
}

func TestPrivateRecallRoundTwoScenarioFailureAggregatesUsageAndKeepsCanonicalFailure(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	callCount := 0
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{stream: func(_ context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
		callCount++
		if callCount == 1 {
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
				TraceId:   "trace-private-failure-round-1",
				Payload: &runtimev1.StreamScenarioEvent_Delta{Delta: runtimeAgentTextStreamDelta(
					`<message id="message-0"><query>failure recall</query></message>`)},
			}); err != nil {
				return err
			}
			return emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
				TraceId:   "trace-private-failure-round-1",
				Payload: &runtimev1.StreamScenarioEvent_Completed{Completed: &runtimev1.ScenarioStreamCompleted{
					FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
					Usage:        &runtimev1.UsageStats{InputTokens: 3, OutputTokens: 5, ComputeMs: 7, CachedInputTokens: 11, ReasoningOutputTokens: 13},
				}},
			})
		}
		if err := emit(&runtimev1.StreamScenarioEvent{
			EventType: runtimev1.StreamEventType_STREAM_EVENT_USAGE,
			TraceId:   "trace-private-failure-round-2",
			Payload: &runtimev1.StreamScenarioEvent_Usage{Usage: &runtimev1.UsageStats{
				InputTokens: 17, OutputTokens: 19, ComputeMs: 23, CachedInputTokens: 29, ReasoningOutputTokens: 31,
			}},
		}); err != nil {
			return err
		}
		return emit(&runtimev1.StreamScenarioEvent{
			EventType: runtimev1.StreamEventType_STREAM_EVENT_FAILED,
			TraceId:   "trace-private-failure-round-2",
			Payload: &runtimev1.StreamScenarioEvent_Failed{Failed: &runtimev1.ScenarioStreamFailed{
				ReasonCode: runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT,
				ActionHint: "retry_provider",
			}},
		})
	}})

	err := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"local_agent_ref":        testRuntimeAgentLocalRef("agent-alpha"),
			"owner_user_id":          "user-1",
			"runtime_source_ref":     testRuntimeAgentSourceRef("agent-alpha"),
			"conversation_anchor_id": anchorID,
			"request_id":             "private-recall-round-two-failure",
			"thread_id":              publicChatTestAnchorThreadID(t, svc, anchorID),
			"messages":               []any{map[string]any{"role": "user", "content": "trigger recall failure"}},
		}),
	})
	if err != nil {
		t.Fatalf("ConsumePublicChatAppMessage: %v", err)
	}
	_ = capture.waitForMessageType(t, publicChatTurnAcceptedType)
	failedEvent := capture.waitForMessageType(t, publicChatTurnFailedType)
	waitForPublicChatAgentIdle(t, svc, "agent-alpha")
	failedDetail := publicChatTurnDetail(t, failedEvent)
	if failedDetail["reason_code"] != runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT.String() {
		t.Fatalf("public failure lost canonical ScenarioStreamFailed reason: %+v", failedDetail)
	}
	if _, leaked := failedDetail["action_hint"]; leaked {
		t.Fatalf("turn.failed widened beyond its admitted event schema: %+v", failedDetail)
	}
	svc.chatSurfaceMu.Lock()
	lastTurn := clonePublicChatTurnProjectionState(svc.chatAnchors[anchorID].LastTurnSnapshot)
	svc.chatSurfaceMu.Unlock()
	if lastTurn == nil || lastTurn.Status != publicChatTurnStatusFailed || lastTurn.ReasonCode != runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT || lastTurn.ActionHint != "retry_provider" || lastTurn.TraceID != "trace-private-failure-round-2" {
		t.Fatalf("Round 2 terminal failure projection = %+v", lastTurn)
	}
	usage := lastTurn.Usage
	if usage == nil || usage.GetInputTokens() != 20 || usage.GetOutputTokens() != 24 || usage.GetComputeMs() != 30 || usage.GetCachedInputTokens() != 40 || usage.GetReasoningOutputTokens() != 44 {
		t.Fatalf("Round 2 failure usage was not aggregated with Round 1: %+v", usage)
	}
}

func TestPrivateRecallReplanFailurePreservesRoundOneUsage(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	localAgentRef := testRuntimeAgentLocalRef("agent-alpha")
	executorCalls := 0
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{stream: func(
		_ context.Context,
		_ *PublicChatTurnExecutionRequest,
		emit func(*runtimev1.StreamScenarioEvent) error,
	) error {
		executorCalls++
		if err := emit(&runtimev1.StreamScenarioEvent{
			EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
			Payload: &runtimev1.StreamScenarioEvent_Delta{Delta: runtimeAgentTextStreamDelta(
				`<message id="message-0"><query>replan usage</query></message>`)},
		}); err != nil {
			return err
		}
		if err := emit(&runtimev1.StreamScenarioEvent{
			EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
			Payload: &runtimev1.StreamScenarioEvent_Completed{Completed: &runtimev1.ScenarioStreamCompleted{
				FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
				Usage: &runtimev1.UsageStats{
					InputTokens: 41, OutputTokens: 43, ComputeMs: 47, CachedInputTokens: 53, ReasoningOutputTokens: 59,
				},
			}},
		}); err != nil {
			return err
		}
		svc.mu.Lock()
		view := svc.turnSourceViews[localAgentRef]
		view.Partition.Lorebook.Character.Identity = ""
		svc.turnSourceViews[localAgentRef] = view
		svc.mu.Unlock()
		return nil
	}})

	if err := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"local_agent_ref":        testRuntimeAgentLocalRef("agent-alpha"),
			"owner_user_id":          "user-1",
			"runtime_source_ref":     testRuntimeAgentSourceRef("agent-alpha"),
			"conversation_anchor_id": anchorID,
			"request_id":             "private-recall-replan-usage",
			"thread_id":              publicChatTestAnchorThreadID(t, svc, anchorID),
			"messages":               []any{map[string]any{"role": "user", "content": "trigger replan failure"}},
		}),
	}); err != nil {
		t.Fatal(err)
	}
	_ = capture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = capture.waitForMessageType(t, publicChatTurnFailedType)
	waitForPublicChatAgentIdle(t, svc, "agent-alpha")
	if executorCalls != 1 {
		t.Fatalf("provider calls = %d, want Round 1 only", executorCalls)
	}
	svc.chatSurfaceMu.Lock()
	lastTurn := clonePublicChatTurnProjectionState(svc.chatAnchors[anchorID].LastTurnSnapshot)
	svc.chatSurfaceMu.Unlock()
	if lastTurn == nil || lastTurn.Status != publicChatTurnStatusFailed {
		t.Fatalf("replan failure terminal = %+v", lastTurn)
	}
	usage := lastTurn.Usage
	if usage == nil || usage.GetInputTokens() != 41 || usage.GetOutputTokens() != 43 || usage.GetComputeMs() != 47 || usage.GetCachedInputTokens() != 53 || usage.GetReasoningOutputTokens() != 59 {
		t.Fatalf("replan failure lost Round 1 usage: %+v", usage)
	}
}

func TestPrivateRecallUsageAggregationIsNonNegativeAndOverflowSafe(t *testing.T) {
	t.Parallel()
	usage := aggregatePublicChatPrivateRoundUsage(
		&runtimev1.UsageStats{InputTokens: -1, OutputTokens: math.MaxInt64 - 1, ComputeMs: 7, CachedInputTokens: math.MaxInt64, ReasoningOutputTokens: -9},
		&runtimev1.UsageStats{InputTokens: 5, OutputTokens: 10, ComputeMs: -3, CachedInputTokens: 1, ReasoningOutputTokens: math.MaxInt64},
	)
	if usage.GetInputTokens() != 5 || usage.GetOutputTokens() != math.MaxInt64 || usage.GetComputeMs() != 7 || usage.GetCachedInputTokens() != math.MaxInt64 || usage.GetReasoningOutputTokens() != math.MaxInt64 {
		t.Fatalf("bounded private recall usage aggregation = %+v", usage)
	}
}
