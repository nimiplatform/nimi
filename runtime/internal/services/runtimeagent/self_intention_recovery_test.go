package runtimeagent

import (
	"context"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"github.com/nimiplatform/nimi/runtime/internal/services/cognitionmemory"
)

func TestForgottenPreferenceDoesNotReturnViaSavedIntentionConfirmation(t *testing.T) {
	for _, omit := range []bool{false, true} {
		name := "ordinary"
		if omit {
			name = "omit-supplemental"
		}
		t.Run(name, func(t *testing.T) {
			svc := newRuntimeAgentServiceForPublicChatTest(t)
			ctx := context.Background()
			ref := testRuntimeAgentLocalRef("agent-alpha")
			const canary = "cedar-canary-20261021"
			seedCognitionMemoryForTerminationTest(t, svc, ref, "I prefer "+canary+" forests")
			memory, err := svc.cognitionMemoryFacade.Inspect(ctx, cognitionmemory.InspectIntent{LocalAgentRef: ref, Limit: 8})
			if err != nil || len(memory.Items) != 1 {
				t.Fatalf("seed prerequisite: %+v %v", memory, err)
			}
			memoryRef := memory.Items[0].MemoryRef
			anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
			req := publicChatTurnRequestPayload{LocalAgentRef: ref, OwnerUserID: "user-1", RuntimeSourceRef: testRuntimeAgentSourceRef("agent-alpha"), ConversationAnchorID: anchorID, RequestID: "audit-original", RegisteredAppSubject: "audit-subject", Messages: []publicChatMessagePayload{{Role: "user", Content: "What would you create inspired by forests?"}}}
			if strings.Contains(req.Messages[0].Content, canary) {
				t.Fatal("precondition: current input must not contain the forgotten preference")
			}
			session, turn, _, err := svc.reservePublicChatTurn(ctx, "desktop.app", "user-1", req)
			if err != nil {
				t.Fatal(err)
			}
			compiled, err := svc.publicChatRuntime().composePublicChatTurnContext(ctx, session, turn, req)
			if err != nil {
				t.Fatal(err)
			}
			originalHadPreference := false
			for _, message := range compiled.ProviderPrompt.Messages {
				originalHadPreference = originalHadPreference || strings.Contains(message.Content, canary)
			}
			if !originalHadPreference {
				t.Fatal("precondition: original input did not Recall seeded preference")
			}
			svc.chatSurfaceMu.Lock()
			read := svc.chatTurns[turn.TurnID].MemoryReadSet
			svc.chatSurfaceMu.Unlock()
			if len(read.Refs) != 1 || read.Refs[0] != memoryRef {
				t.Fatalf("actual original reads=%+v", read)
			}
			accepted, err := svc.applySelfIntention(ctx, session, turn, req, &selfIntentionProposal{Action: "adopt", Title: "Cloud study", Kind: "project"}, "I chose a cloud study because you prefer "+canary+" forests.", nil)
			if err != nil || accepted == nil || !accepted.Accepted {
				t.Fatalf("intention prerequisite: %+v %v", accepted, err)
			}
			if !strings.Contains(accepted.Confirmation, canary) || strings.Contains(accepted.Title, canary) || strings.Contains(accepted.ActivityRef, canary) {
				t.Fatalf("precondition: external preference must occur only in free confirmation, result=%+v", accepted)
			}
			// Owner commit survives a reply interrupted before transcript commit.
			svc.releasePublicChatTurn(anchorID, turn.TurnID)
			svc.chatSurfaceMu.Lock()
			committedCount := len(svc.chatAnchors[anchorID].CommittedTranscript)
			publicPrefix := svc.chatAnchors[anchorID].Recoveries[turn.TurnID].PublicText
			svc.chatSurfaceMu.Unlock()
			if committedCount != 0 || publicPrefix != "" {
				t.Fatalf("precondition: no canonical/public assistant confirmation may exist: committed=%d publicPrefix=%q", committedCount, publicPrefix)
			}
			t.Logf("before Forget: committed transcript count=%d publicPrefix=%q current input contains canary=false; canary exists only in saved confirmation", committedCount, publicPrefix)
			decision, callCtx := localAppConfigureContext(accountservice.LocalAppOperationMemoryForget, 0x73, "user-1")
			forgotten, err := svc.ForgetLocalAppAgentMemory(callCtx, &runtimev1.ForgetLocalAppAgentMemoryRequest{AgentHandle: mintLocalAppAgentHandle(decision, ref), MemoryIds: []string{memoryRef}, Confirmed: true})
			if err != nil || forgotten.GetOutcome() != runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_FORGOTTEN {
				t.Fatalf("Forget prerequisite: %+v %v", forgotten, err)
			}
			if omit {
				configure, configureCtx := localAppConfigureContext(accountservice.LocalAppOperationUpdateConversationContext, 0x35, "user-1")
				_, err := svc.UpdateLocalAppAgentConversationContext(configureCtx, &runtimev1.UpdateLocalAppAgentConversationContextRequest{AgentHandle: mintLocalAppAgentHandle(configure, ref), ConversationAnchorId: anchorID, ExpectedContextRevision: 1, FirstTurnSequence: 0, OmitSupplementalContext: true})
				if err != nil {
					t.Fatalf("context omission prerequisite: %v", err)
				}
			}
			req.RequestID, req.RetryOfTurnID = "audit-regenerate", turn.TurnID
			regeneratedSession, regeneratedTurn, _, err := svc.reservePublicChatTurn(ctx, "desktop.app", "user-1", req)
			if err != nil {
				t.Fatal(err)
			}
			defer svc.releasePublicChatTurn(anchorID, regeneratedTurn.TurnID)
			regenerated, err := svc.publicChatRuntime().composePublicChatTurnContext(ctx, regeneratedSession, regeneratedTurn, req)
			if err != nil {
				t.Fatal(err)
			}
			leaked := false
			for _, message := range regenerated.ProviderPrompt.Messages {
				if strings.Contains(message.Content, canary) {
					leaked = true
					t.Logf("forgotten preference present in role=%s; original result retained=%t", message.Role, strings.Contains(message.Content, "Original Runtime self-intention result"))
				}
			}
			after, _ := svc.agentByID(ref)
			if len(after.Life.Activities) != 1 || after.Life.Activities[accepted.ActivityRef].Title != "Cloud study" {
				t.Fatal("independent accepted intention was lost")
			}
			if leaked {
				t.Fatal("forgotten external preference was reintroduced from saved confirmation; accepted own intention itself should remain")
			}
		})
	}
}
