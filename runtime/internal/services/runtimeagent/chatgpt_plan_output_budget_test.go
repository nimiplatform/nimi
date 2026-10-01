package runtimeagent

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/services/ai"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/types/known/structpb"
)

type chatGPTPlanAgentTestRenewer struct{ t *testing.T }

func (r chatGPTPlanAgentTestRenewer) Renew(context.Context, string, string) (connector.ChatGPTPlanTokenSet, error) {
	r.t.Error("a fresh ChatGPT-plan credential must not be renewed")
	return connector.ChatGPTPlanTokenSet{}, fmt.Errorf("unexpected renewal")
}

func (chatGPTPlanAgentTestRenewer) Revoke(context.Context, string, string) error { return nil }

// A LocalAgent turn on the ChatGPT-plan text target runs through the real
// binding resolver, turn executor and exact adapter: the Agent's context
// reserve never becomes a provider output limit, a caller hard limit still
// fails before dispatch, and an unfinished provider step never completes.
// @nimi-authority: rule.nimi.runtime.ai-provider.internal-output-budget
func TestLocalAgentTurnOnChatGPTPlanKeepsReserveInternal(t *testing.T) {
	const modelID = "gpt-6-astra"
	var calls atomic.Int32
	var terminal atomic.Bool
	terminal.Store(true)
	now := time.Now().UTC().Truncate(time.Second)
	claims, _ := json.Marshal(map[string]any{
		"iss": "https://auth.openai.com", "aud": "https://api.openai.com/v1", "client_id": "oaiapp_agent_test",
		"sub": "account-subject", "scope": "chatgpt.tokens.use.direct offline_access openid", "exp": now.Add(time.Hour).Unix(), "jti": "agent",
	})
	accessToken := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"RS256"}`)) + "." + base64.RawURLEncoding.EncodeToString(claims) + ".sig"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && r.URL.Path == "/v1/models" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"models":[{"slug":"gpt-6-astra","display_name":"GPT-6 Astra","visibility":"list"}]}`))
			return
		}
		calls.Add(1)
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		if r.URL.Path != "/v1/responses" || r.Header.Get("Authorization") != "Bearer "+accessToken || body["model"] != modelID || body["stream"] != true || body["store"] != false {
			t.Errorf("wrong ChatGPT-plan request: %s %v", r.URL.Path, body)
		}
		for _, rejected := range []string{"max_output_tokens", "previous_response_id", "conversation", "temperature", "top_p"} {
			if _, present := body[rejected]; present {
				t.Errorf("LocalAgent turn sent rejected ChatGPT-plan field %q", rejected)
			}
		}
		w.Header().Set("Content-Type", "text/event-stream")
		output := []map[string]any{{"type": "message", "id": "msg_agent", "content": []any{map[string]any{"type": "output_text", "text": "潮水退了，信还在。"}}}}
		events := []map[string]any{
			{"type": "response.created", "response": map[string]any{"status": "in_progress"}},
			{"type": "response.output_item.added", "output_index": 0, "item": map[string]any{"type": "message", "id": "msg_agent"}},
			{"type": "response.output_item.done", "output_index": 0, "item": output[0]},
		}
		if terminal.Load() {
			events = append(events, map[string]any{"type": "response.completed", "response": map[string]any{"status": "completed", "output": output, "usage": map[string]int{"input_tokens": 3, "output_tokens": 4}}})
		}
		for _, event := range events {
			raw, _ := json.Marshal(event)
			_, _ = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event["type"], raw)
		}
	}))
	t.Cleanup(server.Close)

	store := connector.NewConnectorStoreWithMemorySecrets(t.TempDir(), connector.WithChatGPTPlanRenewer(chatGPTPlanAgentTestRenewer{t: t}), connector.WithClock(func() time.Time { return now }))
	authorization, _ := json.Marshal(map[string]any{
		"schema": "nimi.openai_chatgpt_plan.siwc/v1", "issuer": "https://auth.openai.com", "subject": "account-subject",
		"email": "user@example.com", "client_id": "oaiapp_agent_test", "ext_agent_host_id": "urn:uuid:9d7f1f61-4ab0-4d1b-a0e6-3c1f5e4d2b10",
		"access_token": accessToken, "refresh_token": "refresh-agent", "token_type": "Bearer",
		"scopes": []string{"chatgpt.tokens.use.direct", "offline_access", "openid"}, "saved_at": now.Format(time.RFC3339),
	})
	sealed, registration, err := connector.SealChatGPTPlanAuthorization(string(authorization), "", now)
	if err != nil {
		t.Fatalf("seal SIWC authorization: %v", err)
	}
	created, err := store.Create(connector.ConnectorRecord{
		ConnectorID: "connector-chatgpt-plan", Kind: runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
		OwnerType: runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER, OwnerID: "user-001",
		Provider: "openai_chatgpt_plan", Endpoint: server.URL, Label: "user@example.com",
		Status: runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE, AuthKind: runtimev1.ConnectorAuthKind_CONNECTOR_AUTH_KIND_OAUTH_MANAGED,
		ProviderAuthProfile: "openai_chatgpt_plan", OAuthRegistration: registration,
	}, sealed)
	if err != nil {
		t.Fatalf("create SIWC connector: %v", err)
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	aiSvc, err := ai.New(logger, nil, store, config.Config{AllowLoopbackProviderEndpoint: true})
	if err != nil {
		t.Fatalf("new ai service: %v", err)
	}
	store.SetAccountModelAvailability(connector.NewChatGPTPlanAccountAvailability(store, aiSvc.CloudProvider()))
	ctx := authn.WithIdentity(
		metadata.NewIncomingContext(context.Background(), metadata.Pairs("x-nimi-app-id", "nimi.desktop")),
		&authn.Identity{SubjectUserID: "user-001"},
	)
	connectorSvc := connector.New(logger, store, nil)
	connectorSvc.SetCloudProvider(nimillm.NewCloudProvider(nimillm.CloudConfig{AllowLoopbackEndpoint: true}))
	models, err := connectorSvc.ListConnectorModels(ctx, &runtimev1.ListConnectorModelsRequest{ConnectorId: created.ConnectorID, PageSize: 50})
	if err != nil {
		t.Fatalf("list ChatGPT-plan models: %v", err)
	}
	var descriptor *runtimev1.ConnectorModelDescriptor
	for _, model := range models.GetModels() {
		if model.GetProviderModelId() == modelID && model.GetAvailable() {
			descriptor = model
		}
	}
	if descriptor == nil {
		t.Fatalf("%s is not available on the account: %v", modelID, models.GetModels())
	}

	// The Agent's shared AIConfig text.generate intent resolves through the
	// production cloud binding resolver, exactly as a LocalAgent turn does.
	target, _ := structpb.NewStruct(map[string]any{"provider": "openai_chatgpt_plan", "providerModelId": modelID, "remoteModelCatalogId": descriptor.GetRemoteModelCatalogId()})
	capability := &runtimev1.AIConfigCapabilityIntent{CapabilityContract: "text.generate", Route: &runtimev1.AIConfigCapabilityIntent_Cloud{Cloud: &runtimev1.AIConfigCloudIntent{
		Implementation: &runtimev1.CapabilityImplementationIdentity{ImplementationId: "openai_chatgpt_plan", DriverId: "nimillm", DriverDialect: "openai_chatgpt_plan"},
		ConnectorRef:   created.ConnectorID, ProviderModelTarget: target,
	}}}
	resolver := &selectedLocalMachineExecutionBindingResolver{owner: &Service{connectorStore: store, modelCatalog: aiSvc.SpeechCatalogResolver()}}
	binding, err := resolver.resolveCloudMachineExecutionBinding("user-001", capability)
	if err != nil {
		t.Fatalf("resolve Agent cloud binding: %v", err)
	}
	executor := NewAIBackedPublicChatTurnExecutor(aiSvc)
	turn := func(callerMaxTokens int32) ([]*runtimev1.StreamScenarioEvent, error) {
		var events []*runtimev1.StreamScenarioEvent
		err := executor.StreamChatTurn(ctx, &PublicChatTurnExecutionRequest{
			AppID: "nimi.desktop", SubjectUserID: "user-001",
			Messages:             []*runtimev1.ChatMessage{{Role: "system", Content: "你是退潮邮局的邮差。"}, {Role: "user", Content: "今天有我的信吗？"}},
			MaxTokens:            callerMaxTokens,
			ReservedOutputTokens: 4096,
			Binding:              binding,
		}, func(event *runtimev1.StreamScenarioEvent) error {
			events = append(events, event)
			return nil
		})
		return events, err
	}

	events, err := turn(0)
	if err != nil {
		t.Fatalf("LocalAgent turn with only a Runtime reserve failed: %v", err)
	}
	var text strings.Builder
	completed := false
	for _, event := range events {
		text.WriteString(scenarioStreamText(event))
		completed = completed || event.GetCompleted().GetFinishReason() == runtimev1.FinishReason_FINISH_REASON_STOP
	}
	if !completed || text.String() != "潮水退了，信还在。" || calls.Load() != 1 {
		t.Fatalf("LocalAgent turn = %q completed=%v provider calls=%d", text.String(), completed, calls.Load())
	}

	// A caller-requested hard limit is never dropped to fit the target.
	if _, err := turn(777); err == nil {
		t.Fatal("caller max_tokens on ChatGPT plan must fail closed")
	} else if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED || calls.Load() != 1 {
		t.Fatalf("caller max_tokens = %v, provider calls = %d", err, calls.Load())
	}

	// Without an output limit the provider's own terminal event remains the
	// only completion signal.
	terminal.Store(false)
	events, _ = turn(0)
	for _, event := range events {
		if event.GetCompleted() != nil {
			t.Fatal("an unfinished ChatGPT-plan step completed a LocalAgent turn")
		}
	}
	if calls.Load() != 2 {
		t.Fatalf("provider calls = %d, want 2", calls.Load())
	}
}
