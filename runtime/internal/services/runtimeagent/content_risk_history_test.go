package runtimeagent

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"github.com/nimiplatform/nimi/runtime/internal/services/ai"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestContentRiskHistoryRefusesThroughScenarioAndRemainsReadable(t *testing.T) {
	var dispatches atomic.Int32
	var allowDispatch atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		dispatches.Add(1)
		if !allowDispatch.Load() {
			http.Error(w, "unexpected dispatch", 500)
			return
		}
		body, _ := io.ReadAll(r.Body)
		if strings.Contains(string(body), "ghp_") {
			t.Error("excluded history reached model dispatch")
		}
		var request struct {
			Stream bool `json:"stream"`
		}
		_ = json.Unmarshal(body, &request)
		if request.Stream {
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = fmt.Fprint(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Ordinary reply.\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
		} else {
			w.Header().Set("Content-Type", "application/json")
			_, _ = fmt.Fprint(w, `{"choices":[{"index":0,"message":{"content":"Ordinary reply."},"finish_reason":"stop"}]}`)
		}
	}))
	defer server.Close()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	store := connector.NewConnectorStoreWithMemorySecrets(t.TempDir())
	created, err := store.Create(connector.ConnectorRecord{ConnectorID: "history-risk", Kind: runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED, OwnerType: runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER, OwnerID: "user-001", Provider: "deepseek", Endpoint: server.URL, Label: "history fixture", Status: runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE}, "synthetic-test-key")
	if err != nil {
		t.Fatal(err)
	}
	aiSvc, err := ai.New(logger, nil, store, config.Config{AllowLoopbackProviderEndpoint: true})
	if err != nil {
		t.Fatal(err)
	}
	ctx := authn.WithIdentity(metadata.NewIncomingContext(context.Background(), metadata.Pairs("x-nimi-app-id", "nimi.desktop")), &authn.Identity{SubjectUserID: "user-001"})
	models, err := connector.New(logger, store, nil).ListConnectorModels(ctx, &runtimev1.ListConnectorModelsRequest{ConnectorId: created.ConnectorID, PageSize: 200})
	if err != nil {
		t.Fatal(err)
	}
	var descriptor *runtimev1.ConnectorModelDescriptor
	for _, model := range models.GetModels() {
		if model.GetProviderModelId() == "deepseek-flash" {
			descriptor = model
		}
	}
	if descriptor == nil {
		t.Fatal("fixture model not in current catalog")
	}
	target, _ := structpb.NewStruct(map[string]any{"provider": "deepseek", "providerModelId": descriptor.GetProviderModelId(), "remoteModelCatalogId": descriptor.GetRemoteModelCatalogId()})
	capability := &runtimev1.AIConfigCapabilityIntent{CapabilityContract: "text.generate", Route: &runtimev1.AIConfigCapabilityIntent_Cloud{Cloud: &runtimev1.AIConfigCloudIntent{ConnectorRef: created.ConnectorID, Implementation: &runtimev1.CapabilityImplementationIdentity{ImplementationId: "deepseek", DriverId: "nimillm", DriverDialect: "deepseek"}, ProviderModelTarget: target}}}
	resolver := &selectedLocalMachineExecutionBindingResolver{owner: &Service{connectorStore: store, modelCatalog: aiSvc.SpeechCatalogResolver()}}
	binding, err := resolver.resolveCloudMachineExecutionBinding("user-001", capability)
	if err != nil {
		t.Fatal(err)
	}
	executor := NewAIBackedPublicChatTurnExecutor(aiSvc)
	checkContentRiskHistory(t, func(messages []*runtimev1.ChatMessage) error {
		before := dispatches.Load()
		err := executor.StreamChatTurn(ctx, &PublicChatTurnExecutionRequest{AppID: "nimi.desktop", SubjectUserID: "user-001", Messages: messages, ReservedOutputTokens: 4096, Binding: binding}, func(*runtimev1.StreamScenarioEvent) error { t.Error("input refusal fabricated an event"); return nil })
		if dispatches.Load() != before {
			t.Fatal("restricted history dispatched model")
		}
		return err
	}, func(messages []*runtimev1.ChatMessage) error {
		allowDispatch.Store(true)
		defer allowDispatch.Store(false)
		completed := false
		err := executor.StreamChatTurn(ctx, &PublicChatTurnExecutionRequest{AppID: "nimi.desktop", SubjectUserID: "user-001", Messages: messages, ReservedOutputTokens: 4096, Binding: binding}, func(event *runtimev1.StreamScenarioEvent) error {
			if event.GetCompleted() != nil {
				completed = true
			}
			if event.GetFailed() != nil {
				return fmt.Errorf("normal fixture failed: %s", event.GetFailed().GetReasonCode())
			}
			return nil
		})
		if err == nil && !completed {
			return fmt.Errorf("normal Scenario did not complete")
		}
		return err
	})
}

// The caller supplies the existing AI-backed executor fixture. This verifies
// owner composition and actual Scenario refusal, not a real model journey.
func checkContentRiskHistory(t *testing.T, run func([]*runtimev1.ChatMessage) error, runRecovered func([]*runtimev1.ChatMessage) error) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	secret := "ghp_" + strings.Repeat("aB3", 12)
	for _, summary := range []bool{false, true} {
		t.Run(map[bool]string{false: "history", true: "summary"}[summary], func(t *testing.T) {
			turns := testPublicChatCommittedTranscript([2]string{"historical " + secret, "recorded response"})
			anchor := svc.chatAnchors[anchorID]
			anchor.CommittedTranscript = turns
			anchor.ConversationContext = publicChatConversationContextSelection{}
			anchor.ConversationSummary = nil
			if summary {
				for i := 0; i < 6; i++ {
					turns = append(turns, testPublicChatCommittedTranscript([2]string{"ordinary", "ordinary"})[0])
					turns[len(turns)-1].Sequence = uint64(len(turns) - 1)
					turns[len(turns)-1].TurnID = string(rune('a' + i))
				}
				anchor.CommittedTranscript = turns
				anchor.ConversationSummary = &publicChatConversationSummaryState{
					LastAttempt: publicChatConversationSummaryAttemptState{Status: "ready", TargetSequenceEnd: 0, AttemptedAt: time.Now()},
					LastValid:   &publicChatConversationSummaryValidState{Revision: 1, CoveredSequenceStart: 0, CoveredSequenceEnd: 0, Text: "summary " + secret, GeneratedAt: time.Now(), RouteCorrelation: strings.Repeat("a", 64)},
				}
			}
			original := clonePublicChatCommittedTranscript(anchor.CommittedTranscript)
			for attempt := 0; attempt < 2; attempt++ {
				if reopened := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1"); reopened != anchorID {
					t.Fatal("Open unexpectedly reset context")
				}
				recent, err := publicChatAgentTurnTranscriptInput(*anchor)
				if err != nil {
					t.Fatal(err)
				}
				summaryInput, err := publicChatAgentTurnConversationSummaryInput(*anchor, recent)
				if err != nil {
					t.Fatal(err)
				}
				input := agentTurnContextTestInput(t, "worldCharacter")
				input.Transcript = recent
				input.ConversationSummary = summaryInput
				compiled, err := compileAgentTurnContext(input)
				if err != nil {
					t.Fatal(err)
				}
				err = run(publicChatAgentTurnProviderMessages(compiled.ProviderPrompt.Messages))
				if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED || status.Code(err) != codes.FailedPrecondition {
					t.Fatalf("selected history did not refuse through AI: %v", err)
				}
				readable, err := publicChatTranscriptProjection(anchor.CommittedTranscript)
				if err != nil || !strings.Contains(readable[0].GetContent(), secret) {
					t.Fatal("original history is no longer readable")
				}
				if !reflect.DeepEqual(original, anchor.CommittedTranscript) {
					t.Fatal("history mutated")
				}
				if summary {
					// Even a failed attempt at this same target is not auto-retried.
					failed := *anchor
					failed.ConversationSummary = &publicChatConversationSummaryState{LastAttempt: publicChatConversationSummaryAttemptState{Status: "failed", TargetSequenceEnd: 0, AttemptedAt: time.Now()}}
					if _, pending, err := pendingPublicChatConversationSummaryTargetForAnchor(&failed); err != nil || pending {
						t.Fatalf("same summary target retried: %v", err)
					}
				}
			}
			anchor.LastTurnSnapshot = &publicChatTurnProjectionState{ReasonCode: runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED, ActionHint: "adjust_conversation_history"}
			decision, managerCtx := localAppConfigureContext(accountservice.LocalAppOperationUpdateConversationContext, 0x53, "user-1")
			request := &runtimev1.UpdateLocalAppAgentConversationContextRequest{AgentHandle: mintLocalAppAgentHandle(decision, anchor.LocalAgentRef), ConversationAnchorId: anchorID, ExpectedContextRevision: 1, FirstTurnSequence: 1, OmitSupplementalContext: true}
			if suggestion := svc.projectConversationContextLocked(anchor).GetSuggestedFirstTurnSequence(); suggestion != 1 {
				t.Fatalf("suggestion cut unrelated later history: %d", suggestion)
			}
			if _, err := svc.UpdateLocalAppAgentConversationContext(managerCtx, request); err != nil {
				t.Fatal(err)
			}
			for next := 0; next < 2; next++ {
				if opened := openPublicChatTestAnchor(t, svc, "agent-alpha", "other-app", "user-1"); opened != anchorID {
					t.Fatal("recovery changed anchor")
				}
				input := agentTurnContextTestInput(t, "worldCharacter")
				recent, err := publicChatAgentTurnTranscriptInput(*anchor)
				if err != nil {
					t.Fatal(err)
				}
				input.Transcript = recent
				input.ConversationSummary, err = publicChatAgentTurnConversationSummaryInput(*anchor, input.Transcript)
				if err != nil {
					t.Fatal(err)
				}
				compiled, err := compileAgentTurnContext(input)
				if err != nil {
					t.Fatal(err)
				}
				if err := runRecovered(publicChatAgentTurnProviderMessages(compiled.ProviderPrompt.Messages)); err != nil {
					t.Fatal(err)
				}
				if err := svc.commitPublicChatTurnTranscriptForTurn(anchorID, fmt.Sprintf("recovered-turn-%d", next), &runtimev1.ChatMessage{Role: "user", Content: fmt.Sprintf("ordinary follow-up %d", next)}, "Ordinary reply."); err != nil {
					t.Fatal(err)
				}
			}
			if len(anchor.CommittedTranscript) != len(original)+2 || !reflect.DeepEqual(original, anchor.CommittedTranscript[:len(original)]) {
				t.Fatal("recovery did not append to unchanged original records")
			}
			request.ExpectedContextRevision, request.FirstTurnSequence, request.OmitSupplementalContext = 2, 0, false
			if _, err := svc.UpdateLocalAppAgentConversationContext(managerCtx, request); err != nil {
				t.Fatal(err)
			}
			selected, err := publicChatAgentTurnTranscriptInput(*anchor)
			if err != nil {
				t.Fatal(err)
			}
			input := agentTurnContextTestInput(t, "worldCharacter")
			input.Transcript = selected
			compiled, err := compileAgentTurnContext(input)
			if err != nil {
				t.Fatal(err)
			}
			if reason, _ := grpcerr.ExtractReasonCode(run(publicChatAgentTurnProviderMessages(compiled.ProviderPrompt.Messages))); reason != runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED {
				t.Fatal("restoring full history bypassed checks")
			}
		})
	}
}
