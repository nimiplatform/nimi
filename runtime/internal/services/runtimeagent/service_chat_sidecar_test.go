package runtimeagent

import (
	"context"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/durationpb"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestRuntimeAgentApplyChatTrackSidecarPersistsBehavioralPosture(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		Context: testRuntimeAgentIdentityContext("agent-chat-sidecar-posture"),
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}

	err := svc.ApplyChatTrackSidecar(ctx, testRuntimeAgentLocalRef("agent-chat-sidecar-posture"), "chat-turn-posture", ChatTrackSidecarResult{
		PosturePatch: &BehavioralPosturePatch{
			PostureClass:     "careful_support",
			ActionFamily:     "support",
			InterruptMode:    "cautious",
			TransitionReason: "chat sidecar alignment",
			TruthBasisIDs:    []string{"truth-1", "truth-1", "truth-2"},
			StatusText:       "staying close and careful",
		},
	})
	if err != nil {
		t.Fatalf("ApplyChatTrackSidecar: %v", err)
	}

	posture, err := svc.GetBehavioralPosture(ctx, testRuntimeAgentLocalRef("agent-chat-sidecar-posture"))
	if err != nil {
		t.Fatalf("GetBehavioralPosture: %v", err)
	}
	if posture == nil {
		t.Fatal("expected persisted posture")
	}
	if posture.PostureClass != "careful_support" || posture.ActionFamily != "support" || posture.InterruptMode != "cautious" || posture.ModeID != "support" {
		t.Fatalf("unexpected posture values: %#v", posture)
	}
	if len(posture.TruthBasisIDs) != 2 || posture.TruthBasisIDs[0] != "truth-1" || posture.TruthBasisIDs[1] != "truth-2" {
		t.Fatalf("unexpected truth basis ids: %#v", posture.TruthBasisIDs)
	}
	stateResp, err := svc.GetAgentState(ctx, &runtimev1.GetAgentStateRequest{
		Context: testRuntimeAgentIdentityContext("agent-chat-sidecar-posture"), AgentId: "agent-chat-sidecar-posture"})
	if err != nil {
		t.Fatalf("GetAgentState: %v", err)
	}
	if stateResp.GetState().GetStatusText() != "staying close and careful" {
		t.Fatalf("expected status_text projection update, got %#v", stateResp.GetState())
	}
}

func TestRuntimeAgentApplyChatTrackSidecarOmitsUnprovenOriginLinkage(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		Context: testRuntimeAgentIdentityContext("agent-chat-sidecar-origin"),
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}

	svc.mu.RLock()
	cursor := svc.sequence
	svc.mu.RUnlock()

	err := svc.ApplyChatTrackSidecar(ctx, testRuntimeAgentLocalRef("agent-chat-sidecar-origin"), "uncommitted-source-event", ChatTrackSidecarResult{
		PosturePatch: &BehavioralPosturePatch{
			PostureClass:     "careful_support",
			ActionFamily:     "support",
			InterruptMode:    "cautious",
			TransitionReason: "chat sidecar without committed provenance",
			TruthBasisIDs:    []string{"truth-1"},
			StatusText:       "staying close and careful",
		},
	})
	if err != nil {
		t.Fatalf("ApplyChatTrackSidecar: %v", err)
	}

	streamCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	stream := newAgentEventCaptureStreamLimit(streamCtx, 2)
	if err := svc.SubscribeAgentEvents(&runtimev1.SubscribeAgentEventsRequest{
		Context: testRuntimeAgentIdentityContext("agent-chat-sidecar-origin"),
		AgentId: "agent-chat-sidecar-origin",
		Cursor:  encodeCursor(cursor),
		EventFilters: []runtimev1.AgentEventType{
			runtimev1.AgentEventType_AGENT_EVENT_TYPE_STATE,
		},
	}, stream); err != context.Canceled && err != context.DeadlineExceeded {
		t.Fatalf("SubscribeAgentEvents: %v", err)
	}
	if len(stream.events) < 2 {
		t.Fatalf("expected posture/state projection events, got %d", len(stream.events))
	}
	for _, event := range stream.events {
		detail := event.GetState()
		if detail == nil {
			t.Fatalf("expected state event detail, got %#v", event)
		}
		if strings.TrimSpace(detail.GetOriginatingTurnId()) != "" {
			t.Fatalf("unproven source_event_id must not fabricate originating_turn_id, got %#v", detail)
		}
		if strings.TrimSpace(detail.GetConversationAnchorId()) != "" || strings.TrimSpace(detail.GetOriginatingStreamId()) != "" {
			t.Fatalf("unproven source_event_id must not fabricate anchor/stream linkage, got %#v", detail)
		}
	}
}

func TestRuntimeAgentApplyChatTrackSidecarRejectsInvalidBehavioralPosture(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		Context: testRuntimeAgentIdentityContext("agent-chat-sidecar-invalid"),
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}

	err := svc.ApplyChatTrackSidecar(ctx, testRuntimeAgentLocalRef("agent-chat-sidecar-invalid"), "chat-turn-invalid", ChatTrackSidecarResult{
		PosturePatch: &BehavioralPosturePatch{
			PostureClass:  "bad",
			ActionFamily:  "freestyle",
			InterruptMode: "welcome",
			StatusText:    "bad",
		},
	})
	if err == nil {
		t.Fatal("expected invalid posture patch to fail")
	}

	posture, err := svc.GetBehavioralPosture(ctx, testRuntimeAgentLocalRef("agent-chat-sidecar-invalid"))
	if err != nil {
		t.Fatalf("GetBehavioralPosture: %v", err)
	}
	if posture != nil {
		t.Fatalf("expected no committed posture after invalid sidecar, got %#v", posture)
	}
}

func TestRuntimeAgentApplyChatTrackSidecarCancelsHooksAddsFollowUpAndWritesMemory(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		Context: testRuntimeAgentIdentityContext("agent-chat-sidecar-combined"),
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}

	now := time.Now()
	scheduledFor := now.Add(10 * time.Minute)
	if err := svc.admitPendingHook(testRuntimeAgentLocalRef("agent-chat-sidecar-combined"), newTestTimePendingHook(t, "hook-chat-sidecar-old", "agent-chat-sidecar-combined", scheduledFor, now)); err != nil {
		t.Fatalf("admitPendingHook: %v", err)
	}

	err := svc.ApplyChatTrackSidecar(ctx, testRuntimeAgentLocalRef("agent-chat-sidecar-combined"), "chat-turn-combined", ChatTrackSidecarResult{
		CancelPendingHookIDs: []string{"hook-chat-sidecar-old"},
		NextHookIntent: &runtimev1.HookIntent{
			IntentId:      "hook-chat-sidecar-new",
			AgentId:       "agent-chat-sidecar-combined",
			TriggerFamily: runtimev1.HookTriggerFamily_HOOK_TRIGGER_FAMILY_TIME,
			TriggerDetail: &runtimev1.HookTriggerDetail{
				Detail: &runtimev1.HookTriggerDetail_Time{
					Time: &runtimev1.HookTriggerTimeDetail{Delay: durationpb.New(15 * time.Minute)},
				},
			},
			Effect:         runtimev1.HookEffect_HOOK_EFFECT_FOLLOW_UP_TURN,
			AdmissionState: runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PROPOSED,
		},
		CanonicalMemoryCandidates: []*runtimev1.CanonicalMemoryCandidate{
			{
				CanonicalClass: runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_PUBLIC_SHARED,
				TargetBank: &runtimev1.MemoryBankLocator{
					Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
					Owner: &runtimev1.MemoryBankLocator_AgentCore{
						AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: testRuntimeAgentLocalRef("agent-chat-sidecar-combined")},
					},
				},
				Record: &runtimev1.MemoryRecordInput{
					Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
					Payload: &runtimev1.MemoryRecordInput_Observational{
						Observational: &runtimev1.ObservationalMemoryRecord{Observation: "chat sidecar memory note"},
					},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("ApplyChatTrackSidecar: %v", err)
	}

	canceledResp, err := svc.ListPendingHooks(ctx, &runtimev1.ListPendingHooksRequest{
		Context:              testRuntimeAgentIdentityContext("agent-chat-sidecar-combined"),
		AgentId:              "agent-chat-sidecar-combined",
		AdmissionStateFilter: runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_CANCELED,
	})
	if err != nil {
		t.Fatalf("ListPendingHooks(canceled): %v", err)
	}
	if len(canceledResp.GetHooks()) != 1 || canceledResp.GetHooks()[0].GetIntent().GetIntentId() != "hook-chat-sidecar-old" {
		t.Fatalf("expected original hook canceled, got %#v", canceledResp.GetHooks())
	}
	pendingResp, err := svc.ListPendingHooks(ctx, &runtimev1.ListPendingHooksRequest{
		Context:              testRuntimeAgentIdentityContext("agent-chat-sidecar-combined"),
		AgentId:              "agent-chat-sidecar-combined",
		AdmissionStateFilter: runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PENDING,
	})
	if err != nil {
		t.Fatalf("ListPendingHooks(pending): %v", err)
	}
	if len(pendingResp.GetHooks()) != 1 {
		t.Fatalf("expected one follow-up pending hook, got %#v", pendingResp.GetHooks())
	}
	if pendingResp.GetHooks()[0].GetIntent().GetIntentId() == "hook-chat-sidecar-old" {
		t.Fatal("expected follow-up hook to have a distinct id")
	}

	queryResp, err := svc.QueryAgentMemory(ctx, &runtimev1.QueryAgentMemoryRequest{
		Context:          testRuntimeAgentIdentityContext("agent-chat-sidecar-combined"),
		AgentId:          "agent-chat-sidecar-combined",
		Query:            "chat sidecar memory",
		Limit:            5,
		CanonicalClasses: []runtimev1.MemoryCanonicalClass{runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_PUBLIC_SHARED},
	})
	if err != nil {
		t.Fatalf("QueryAgentMemory: %v", err)
	}
	if len(queryResp.GetMemories()) == 0 {
		t.Fatalf("expected sidecar memory write, got %#v", queryResp.GetMemories())
	}
}

func TestRuntimeAgentExecuteChatTrackSidecarWithAIBackedExecutorAppliesOutputs(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		Context: testRuntimeAgentIdentityContext("agent-chat-exec"),
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}

	now := time.Now()
	scheduledFor := now.Add(5 * time.Minute)
	if err := svc.admitPendingHook(testRuntimeAgentLocalRef("agent-chat-exec"), newTestTimePendingHook(t, "hook-chat-exec-old", "agent-chat-exec", scheduledFor, now)); err != nil {
		t.Fatalf("admitPendingHook: %v", err)
	}

	fakeAI := &fakeLifeTurnAI{
		response: &runtimev1.ExecuteScenarioResponse{
			Output: &runtimev1.ScenarioOutput{
				Output: &runtimev1.ScenarioOutput_TextGenerate{
					TextGenerate: &runtimev1.TextGenerateOutput{
						Text: `<chat-track-sidecar><behavioral-posture><posture-class>focused_support</posture-class><action-family>support</action-family><interrupt-mode>focused</interrupt-mode><transition-reason>chat sidecar</transition-reason><truth-basis-id>truth-a</truth-basis-id><truth-basis-id>truth-a</truth-basis-id><truth-basis-id>truth-b</truth-basis-id><status-text>focused and present</status-text></behavioral-posture><cancel-pending-hook-id>hook-chat-exec-old</cancel-pending-hook-id><next-hook-intent trigger-family="TIME" effect="FOLLOW_UP_TURN" reason="follow up later"><time delay="600s"/></next-hook-intent><canonical-memory-candidates><candidate canonical-class="PUBLIC_SHARED" policy-reason="chat_summary"><observational><observation>user asked about wave 6 chat posture patch</observation></observational></candidate></canonical-memory-candidates></chat-track-sidecar>`,
					},
				},
			},
		},
	}
	svc.SetChatTrackSidecarExecutor(NewAIBackedChatTrackSidecarExecutor(fakeAI))

	err := svc.ExecuteChatTrackSidecar(ctx, ChatTrackSidecarExecutionRequest{
		AgentID:       testRuntimeAgentLocalRef("agent-chat-exec"),
		SourceEventID: "chat-turn-1",
		Messages: []*runtimev1.ChatMessage{
			{Role: "user", Content: "please keep the agent focused and remember this request"},
		},
	})
	if err != nil {
		t.Fatalf("ExecuteChatTrackSidecar: %v", err)
	}
	if len(fakeAI.requests) != 1 {
		t.Fatalf("expected one AI request, got %d", len(fakeAI.requests))
	}
	if got := fakeAI.requests[0].GetHead().GetAppId(); got != chatTrackSidecarExecutorAppID {
		t.Fatalf("expected direct chat sidecar execution to use internal app id, got=%q", got)
	}

	posture, err := svc.GetBehavioralPosture(ctx, testRuntimeAgentLocalRef("agent-chat-exec"))
	if err != nil {
		t.Fatalf("GetBehavioralPosture: %v", err)
	}
	if posture == nil || posture.ModeID != "support" || posture.StatusText != "focused and present" {
		t.Fatalf("unexpected posture after chat sidecar execution: %#v", posture)
	}

	canceledResp, err := svc.ListPendingHooks(ctx, &runtimev1.ListPendingHooksRequest{
		Context:              testRuntimeAgentIdentityContext("agent-chat-exec"),
		AgentId:              "agent-chat-exec",
		AdmissionStateFilter: runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_CANCELED,
	})
	if err != nil {
		t.Fatalf("ListPendingHooks(canceled): %v", err)
	}
	if len(canceledResp.GetHooks()) != 1 || canceledResp.GetHooks()[0].GetIntent().GetIntentId() != "hook-chat-exec-old" {
		t.Fatalf("expected canceled original hook, got %#v", canceledResp.GetHooks())
	}
	pendingResp, err := svc.ListPendingHooks(ctx, &runtimev1.ListPendingHooksRequest{
		Context:              testRuntimeAgentIdentityContext("agent-chat-exec"),
		AgentId:              "agent-chat-exec",
		AdmissionStateFilter: runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PENDING,
	})
	if err != nil {
		t.Fatalf("ListPendingHooks(pending): %v", err)
	}
	if len(pendingResp.GetHooks()) != 1 {
		t.Fatalf("expected one follow-up hook, got %#v", pendingResp.GetHooks())
	}

	queryResp, err := svc.QueryAgentMemory(ctx, &runtimev1.QueryAgentMemoryRequest{
		Context:          testRuntimeAgentIdentityContext("agent-chat-exec"),
		AgentId:          "agent-chat-exec",
		Query:            "wave 6 posture patch",
		Limit:            5,
		CanonicalClasses: []runtimev1.MemoryCanonicalClass{runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_PUBLIC_SHARED},
	})
	if err != nil {
		t.Fatalf("QueryAgentMemory: %v", err)
	}
	if len(queryResp.GetMemories()) == 0 {
		t.Fatalf("expected chat sidecar memory write, got %#v", queryResp.GetMemories())
	}
}

func TestRuntimeAgentConsumeChatTrackSidecarAppMessagePreservesCallerAppIDForAIExecution(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		Context: testRuntimeAgentIdentityContext("agent-chat-sidecar-caller-app"),
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}

	fakeAI := &fakeLifeTurnAI{
		response: &runtimev1.ExecuteScenarioResponse{
			Output: &runtimev1.ScenarioOutput{
				Output: &runtimev1.ScenarioOutput_TextGenerate{
					TextGenerate: &runtimev1.TextGenerateOutput{
						Text: `<chat-track-sidecar><canonical-memory-candidates></canonical-memory-candidates></chat-track-sidecar>`,
					},
				},
			},
		},
	}
	svc.SetChatTrackSidecarExecutor(NewAIBackedChatTrackSidecarExecutor(fakeAI))

	err := svc.ConsumeChatTrackSidecarAppMessage(ctx, &runtimev1.AppMessageEvent{
		FromAppId:   "desktop.app",
		ToAppId:     "runtime.agent.internal.chat_track_sidecar",
		MessageType: "agent.chat_track.sidecar_input.v1",
		Payload: &structpb.Struct{Fields: map[string]*structpb.Value{
			"agent_id":        structpb.NewStringValue(testRuntimeAgentLocalRef("agent-chat-sidecar-caller-app")),
			"source_event_id": structpb.NewStringValue("turn-sidecar-caller-app"),
			"thread_id":       structpb.NewStringValue("thread-caller-app"),
			"messages": structpb.NewListValue(&structpb.ListValue{Values: []*structpb.Value{
				structpb.NewStructValue(&structpb.Struct{Fields: map[string]*structpb.Value{
					"role":    structpb.NewStringValue("user"),
					"content": structpb.NewStringValue("please stay engaged"),
				}}),
			}}),
		}},
	})
	if err != nil {
		t.Fatalf("ConsumeChatTrackSidecarAppMessage: %v", err)
	}
	if len(fakeAI.requests) != 1 {
		t.Fatalf("expected one AI request, got %d", len(fakeAI.requests))
	}
	if got := fakeAI.requests[0].GetHead().GetAppId(); got != "desktop.app" {
		t.Fatalf("expected sidecar ingress AI execution to preserve caller app id, got=%q", got)
	}
}

func TestRuntimeAgentExecuteChatTrackSidecarWithAIBackedExecutorFailsClosedOnInvalidOutput(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		Context: testRuntimeAgentIdentityContext("agent-chat-exec-invalid"),
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}

	svc.SetChatTrackSidecarExecutor(NewAIBackedChatTrackSidecarExecutor(&fakeLifeTurnAI{
		response: &runtimev1.ExecuteScenarioResponse{
			Output: &runtimev1.ScenarioOutput{
				Output: &runtimev1.ScenarioOutput_TextGenerate{
					TextGenerate: &runtimev1.TextGenerateOutput{
						Text: `<chat-track-sidecar><behavioral-posture><posture-class>bad</posture-class><action-family>freestyle</action-family><interrupt-mode>welcome</interrupt-mode><status-text>bad</status-text></behavioral-posture><initiate-chat-intent><message>hi</message></initiate-chat-intent></chat-track-sidecar>`,
					},
				},
			},
		},
	}))

	err := svc.ExecuteChatTrackSidecar(ctx, ChatTrackSidecarExecutionRequest{
		AgentID:       testRuntimeAgentLocalRef("agent-chat-exec-invalid"),
		SourceEventID: "chat-turn-invalid",
		Messages: []*runtimev1.ChatMessage{
			{Role: "user", Content: "hello"},
		},
	})
	if err == nil {
		t.Fatal("expected invalid AI-backed chat sidecar output to fail")
	}

	posture, getErr := svc.GetBehavioralPosture(ctx, testRuntimeAgentLocalRef("agent-chat-exec-invalid"))
	if getErr != nil {
		t.Fatalf("GetBehavioralPosture: %v", getErr)
	}
	if posture != nil {
		t.Fatalf("expected no committed posture after invalid AI output, got %#v", posture)
	}
}

func TestChatTrackSidecarPromptsFrameTranscriptAsEvidence(t *testing.T) {
	t.Parallel()

	systemPrompt, _, err := chatTrackSidecarPrompts(&ChatTrackSidecarExecutorRequest{
		Agent: &runtimev1.AgentRecord{AgentId: "agent-chat-prompt"},
		State: &runtimev1.AgentStateProjection{},
		Messages: []*runtimev1.ChatMessage{
			{Role: "user", Content: "I like cats. Actually, I like dogs."},
		},
	})
	if err != nil {
		t.Fatalf("chatTrackSidecarPrompts: %v", err)
	}
	if !strings.Contains(systemPrompt, "source evidence, not canonical memory truth by default") {
		t.Fatalf("expected prompt to frame transcript as evidence, got %q", systemPrompt)
	}
	if !strings.Contains(systemPrompt, "absorb explicit same-window self-correction or contradiction before candidate emission") {
		t.Fatalf("expected prompt to require same-window correction absorption, got %q", systemPrompt)
	}
	if !strings.Contains(systemPrompt, "empty <canonical-memory-candidates></canonical-memory-candidates> or prefer <observational> over <semantic>") {
		t.Fatalf("expected prompt to prefer observational/no candidate when unstable, got %q", systemPrompt)
	}
}

func TestLifeTurnPromptsFrameEvidenceAsStabilizedCandidateInput(t *testing.T) {
	t.Parallel()

	systemPrompt, _, err := lifeTurnPrompts(&lifeTurnRequest{
		Agent:    &runtimev1.AgentRecord{AgentId: "agent-life-prompt"},
		State:    &runtimev1.AgentStateProjection{},
		Hook:     &runtimev1.PendingHook{Intent: &runtimev1.HookIntent{IntentId: "hook-life-prompt"}},
		Autonomy: &runtimev1.AgentAutonomyState{},
	})
	if err != nil {
		t.Fatalf("lifeTurnPrompts: %v", err)
	}
	if !strings.Contains(systemPrompt, "source evidence, not canonical memory truth by default") {
		t.Fatalf("expected prompt to frame life-turn evidence as evidence, got %q", systemPrompt)
	}
	if !strings.Contains(systemPrompt, "absorb explicit same-window self-correction or contradiction before candidate emission") {
		t.Fatalf("expected prompt to require same-window correction absorption, got %q", systemPrompt)
	}
	if !strings.Contains(systemPrompt, "empty <canonical-memory-candidates></canonical-memory-candidates> or prefer <observational> over <semantic>") {
		t.Fatalf("expected prompt to prefer observational/no candidate when unstable, got %q", systemPrompt)
	}
}

func TestChatTrackSidecarPromptsFrameCadenceInteractionAsBoundedHostOwnedHint(t *testing.T) {
	t.Parallel()

	systemPrompt, _, err := chatTrackSidecarPrompts(&ChatTrackSidecarExecutorRequest{
		Agent: &runtimev1.AgentRecord{AgentId: "agent-chat-cadence-prompt"},
		State: &runtimev1.AgentStateProjection{},
	})
	if err != nil {
		t.Fatalf("chatTrackSidecarPrompts: %v", err)
	}
	if !strings.Contains(systemPrompt, "runtime host owns cadence truth") {
		t.Fatalf("expected prompt to keep cadence host-owned, got %q", systemPrompt)
	}
	if !strings.Contains(systemPrompt, "no cadence-interaction tag is admitted") {
		t.Fatalf("expected prompt to explicitly forbid cadence-interaction, got %q", systemPrompt)
	}
	if !strings.Contains(systemPrompt, "HookIntent") {
		t.Fatalf("expected prompt to reference new HookIntent vocabulary, got %q", systemPrompt)
	}
}

func TestLifeTurnPromptsFrameCadenceInteractionAsBoundedHostOwnedHint(t *testing.T) {
	t.Parallel()

	systemPrompt, _, err := lifeTurnPrompts(&lifeTurnRequest{
		Agent:    &runtimev1.AgentRecord{AgentId: "agent-life-cadence-prompt"},
		State:    &runtimev1.AgentStateProjection{},
		Hook:     &runtimev1.PendingHook{Intent: &runtimev1.HookIntent{IntentId: "hook-life-prompt"}},
		Autonomy: &runtimev1.AgentAutonomyState{},
	})
	if err != nil {
		t.Fatalf("lifeTurnPrompts: %v", err)
	}
	if !strings.Contains(systemPrompt, "runtime host owns cadence truth") {
		t.Fatalf("expected prompt to keep cadence host-owned, got %q", systemPrompt)
	}
	if !strings.Contains(systemPrompt, "no cadence-interaction tag is admitted") {
		t.Fatalf("expected prompt to explicitly forbid cadence-interaction, got %q", systemPrompt)
	}
}

func TestRuntimeAgentConsumeChatTrackSidecarAppMessageExecutesIngressPayload(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		Context: testRuntimeAgentIdentityContext("agent-chat-sidecar-ingress"),
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}

	fakeAI := &fakeLifeTurnAI{
		response: &runtimev1.ExecuteScenarioResponse{
			Output: &runtimev1.ScenarioOutput{
				Output: &runtimev1.ScenarioOutput_TextGenerate{
					TextGenerate: &runtimev1.TextGenerateOutput{
						Text: `<chat-track-sidecar><behavioral-posture><posture-class>engaged</posture-class><action-family>engage</action-family><interrupt-mode>welcome</interrupt-mode><transition-reason>chat ingress</transition-reason><truth-basis-id>truth-1</truth-basis-id><status-text>ready to engage</status-text></behavioral-posture><canonical-memory-candidates></canonical-memory-candidates></chat-track-sidecar>`,
					},
				},
			},
		},
	}
	svc.SetChatTrackSidecarExecutor(NewAIBackedChatTrackSidecarExecutor(fakeAI))

	err := svc.ConsumeChatTrackSidecarAppMessage(ctx, &runtimev1.AppMessageEvent{
		ToAppId:     "runtime.agent.internal.chat_track_sidecar",
		MessageType: "agent.chat_track.sidecar_input.v1",
		Payload: &structpb.Struct{Fields: map[string]*structpb.Value{
			"agent_id":        structpb.NewStringValue(testRuntimeAgentLocalRef("agent-chat-sidecar-ingress")),
			"source_event_id": structpb.NewStringValue("turn-sidecar-1"),
			"thread_id":       structpb.NewStringValue("thread-1"),
			"messages": structpb.NewListValue(&structpb.ListValue{Values: []*structpb.Value{
				structpb.NewStructValue(&structpb.Struct{Fields: map[string]*structpb.Value{
					"role":    structpb.NewStringValue("user"),
					"content": structpb.NewStringValue("please stay engaged"),
				}}),
				structpb.NewStructValue(&structpb.Struct{Fields: map[string]*structpb.Value{
					"role":    structpb.NewStringValue("assistant"),
					"content": structpb.NewStringValue("I will stay engaged."),
				}}),
			}}),
		}},
	})
	if err != nil {
		t.Fatalf("ConsumeChatTrackSidecarAppMessage: %v", err)
	}
	if len(fakeAI.requests) != 1 {
		t.Fatalf("expected one executor request, got %d", len(fakeAI.requests))
	}
	posture, err := svc.GetBehavioralPosture(ctx, testRuntimeAgentLocalRef("agent-chat-sidecar-ingress"))
	if err != nil {
		t.Fatalf("GetBehavioralPosture: %v", err)
	}
	if posture == nil || posture.ModeID != "engage" {
		t.Fatalf("expected engage posture, got %#v", posture)
	}
}

func TestRuntimeAgentApplyChatTrackSidecarRejectsSameBatchSemanticContradiction(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		Context: testRuntimeAgentIdentityContext("agent-chat-sidecar-contradiction"),
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}

	err := svc.ApplyChatTrackSidecar(ctx, testRuntimeAgentLocalRef("agent-chat-sidecar-contradiction"), "chat-turn-contradiction", ChatTrackSidecarResult{
		CanonicalMemoryCandidates: []*runtimev1.CanonicalMemoryCandidate{
			{
				CanonicalClass: runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_PUBLIC_SHARED,
				TargetBank: &runtimev1.MemoryBankLocator{
					Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
					Owner: &runtimev1.MemoryBankLocator_AgentCore{
						AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: testRuntimeAgentLocalRef("agent-chat-sidecar-contradiction")},
					},
				},
				Record: &runtimev1.MemoryRecordInput{
					Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_SEMANTIC,
					Payload: &runtimev1.MemoryRecordInput_Semantic{
						Semantic: &runtimev1.SemanticMemoryRecord{
							Subject:   "user",
							Predicate: "likes",
							Object:    "cats",
						},
					},
				},
			},
			{
				CanonicalClass: runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_PUBLIC_SHARED,
				TargetBank: &runtimev1.MemoryBankLocator{
					Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
					Owner: &runtimev1.MemoryBankLocator_AgentCore{
						AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: testRuntimeAgentLocalRef("agent-chat-sidecar-contradiction")},
					},
				},
				Record: &runtimev1.MemoryRecordInput{
					Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_SEMANTIC,
					Payload: &runtimev1.MemoryRecordInput_Semantic{
						Semantic: &runtimev1.SemanticMemoryRecord{
							Subject:   "user",
							Predicate: "likes",
							Object:    "dogs",
						},
					},
				},
			},
		},
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected invalid argument, got %v", err)
	}
	if !strings.Contains(err.Error(), "same-batch semantic contradiction") {
		t.Fatalf("expected contradiction rejection, got %v", err)
	}

	queryResp, queryErr := svc.QueryAgentMemory(ctx, &runtimev1.QueryAgentMemoryRequest{
		Context:          testRuntimeAgentIdentityContext("agent-chat-sidecar-contradiction"),
		AgentId:          "agent-chat-sidecar-contradiction",
		Query:            "likes",
		Limit:            5,
		CanonicalClasses: []runtimev1.MemoryCanonicalClass{runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_PUBLIC_SHARED},
	})
	if queryErr != nil {
		t.Fatalf("QueryAgentMemory: %v", queryErr)
	}
	if len(queryResp.GetMemories()) != 0 {
		t.Fatalf("expected no memory writes after contradiction, got %#v", queryResp.GetMemories())
	}
}

func TestRuntimeAgentConsumeChatTrackSidecarAppMessageFailsClosedOnInvalidPayload(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	err := svc.ConsumeChatTrackSidecarAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:     "runtime.agent.internal.chat_track_sidecar",
		MessageType: "agent.chat_track.sidecar_input.v1",
		Payload: &structpb.Struct{Fields: map[string]*structpb.Value{
			"agent_id":           structpb.NewStringValue(testRuntimeAgentLocalRef("agent-1")),
			"source_event_id":    structpb.NewStringValue("turn-1"),
			"thread_id":          structpb.NewStringValue("thread-1"),
			"behavioral_posture": structpb.NewStructValue(&structpb.Struct{}),
			"messages": structpb.NewListValue(&structpb.ListValue{Values: []*structpb.Value{
				structpb.NewStructValue(&structpb.Struct{Fields: map[string]*structpb.Value{
					"role":    structpb.NewStringValue("user"),
					"content": structpb.NewStringValue("hello"),
				}}),
			}}),
		}},
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected invalid argument, got %v", err)
	}
}
