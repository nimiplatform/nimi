package remoteexecution

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aitelemetry"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/protobuf/types/known/structpb"
)

// Exercise the real Host, account inventory gate, text transport, and SQLite
// accounting owner together. Read-only model inventory is never AI execution.
func TestTextObservationExcludesPreDispatchAccountAdmission(t *testing.T) {
	for _, stream := range []bool{false, true} {
		for _, outcome := range []string{"inventory unavailable", "model not offered", "response dispatched"} {
			t.Run(fmt.Sprintf("stream=%v/%s", stream, outcome), func(t *testing.T) {
				var inventories, responses atomic.Int32
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					switch {
					case r.Method == http.MethodGet && r.URL.Path == "/v1/models":
						inventories.Add(1)
						if outcome == "inventory unavailable" {
							http.Error(w, "inventory unavailable", http.StatusServiceUnavailable)
							return
						}
						w.Header().Set("Content-Type", "application/json")
						inventory := `{"models":[]}`
						if outcome == "response dispatched" {
							inventory = `{"models":[{"slug":"gpt-6-luna","display_name":"GPT-6 Luna","visibility":"list"}]}`
						}
						_, _ = io.WriteString(w, inventory)
					case r.Method == http.MethodPost && r.URL.Path == "/v1/responses":
						responses.Add(1)
						writeObservedTextResponse(t, w)
					default:
						t.Errorf("unexpected provider request %s %s", r.Method, r.URL.Path)
						http.NotFound(w, r)
					}
				}))
				defer server.Close()
				store, record := observationChatGPTConnector(t, server.URL)
				identity := capabilitydriver.Identity{ImplementationID: "openai_chatgpt_plan", DriverID: "nimillm", DriverDialect: "openai_chatgpt_plan"}
				rawTarget, _ := structpb.NewStruct(map[string]any{"provider": "openai_chatgpt_plan", "providerModelId": "gpt-6-luna", "remoteModelCatalogId": "remote-model-catalog_test"})
				driver, target, err := capabilitydriver.NewProductionCloudTextRegistry().Resolve(identity, rawTarget)
				if err != nil {
					t.Fatal(err)
				}
				adapter, err := textbehavior.NewAdapter(textbehavior.AdapterCapture{
					AdapterID: "chatgpt-plan-observation-test", Version: "1", RequestSerializerID: "chatgpt-plan/request/v1",
					NonStreamParserID: "chatgpt-plan/response/v1", StreamAssemblerID: "chatgpt-plan/stream/v1", ProcessIdentityImpact: textbehavior.ProcessIdentityUnaffected,
				}, capabilitydriver.ChatGPTPlanTextBehaviorRequestSerializer, capabilitydriver.ChatGPTPlanTextBehaviorNonStreamParser, capabilitydriver.ChatGPTPlanTextBehaviorStreamAssembler)
				if err != nil {
					t.Fatal(err)
				}
				mapped, err := driver.MapRequest(target, &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "hello"}}}, nil, stream, adapter)
				if err != nil {
					t.Fatal(err)
				}
				mapped, err = mapped.WithTextBehavior(adapter)
				if err != nil {
					t.Fatal(err)
				}
				logger := slog.New(slog.NewTextHandler(io.Discard, nil))
				backend, err := runtimepersistence.Open(logger, filepath.Join(t.TempDir(), "state.json"))
				if err != nil {
					t.Fatal(err)
				}
				defer backend.Close()
				owner := aitelemetry.Open(backend, logger)
				defer owner.Close()
				from := time.Now().Add(-time.Second)
				ctx := aitelemetry.WithInvocation(context.Background(), owner, aitelemetry.Facts{AccountID: "account-a", OperationID: "text-op", Source: aitelemetry.Source{Kind: "app", ID: "app", ParentID: "text-op", ParentKind: "scenario"}, Capability: "text.generate", Route: runtimev1.DesktopAIExecutionRoute_DESKTOP_AI_EXECUTION_ROUTE_CLOUD})
				host := NewProviderTextHost(store, nimillm.NewCloudProvider(nimillm.CloudConfig{HTTPTimeout: time.Second, AllowLoopbackEndpoint: true}), auditlog.New(16, 16), true)
				audit := TextDispatchAudit{AccountID: "account-a", AppID: "app", CapabilityContract: "text.generate", Provider: target.Provider(), ProviderModelID: target.ProviderModelID(), ConnectorID: record.ConnectorID}
				var result capabilitydriver.CloudTextTransportResponse
				if stream {
					result, err = host.StreamText(ctx, record, target, mapped, func(textbehavior.OrderedDelta) error { return nil }, audit)
				} else {
					result, err = host.ExecuteText(ctx, record, target, mapped, audit)
				}
				want := int64(0)
				if outcome == "response dispatched" {
					want = 1
					if err != nil || result.Usage.GetInputTokens() != 3 || result.Usage.GetOutputTokens() != 4 {
						t.Fatalf("real Responses result = %+v, error = %v", result, err)
					}
				} else if err == nil {
					t.Fatal("account-model admission unexpectedly succeeded")
				}
				flushCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				if err := owner.Flush(flushCtx); err != nil {
					t.Fatal(err)
				}
				summary, err := owner.Summary(context.Background(), "account-a", from, time.Now().Add(time.Second))
				if err != nil {
					t.Fatal(err)
				}
				if inventories.Load() != 1 || int64(responses.Load()) != want || summary.GetTotals().GetAttemptCount() != want || len(owner.Snapshot("account-a", 50).GetExecutions()) != 0 {
					t.Fatalf("inventory=%d responses=%d attempts=%d active=%d, want one inventory and %d actual attempts", inventories.Load(), responses.Load(), summary.GetTotals().GetAttemptCount(), len(owner.Snapshot("account-a", 50).GetExecutions()), want)
				}
			})
		}
	}
}

func observationChatGPTConnector(t *testing.T, endpoint string) (*connector.ConnectorStore, connector.ConnectorRecord) {
	t.Helper()
	now := time.Now().UTC()
	claims, _ := json.Marshal(map[string]any{"iss": "https://auth.openai.com", "aud": "https://api.openai.com/v1", "client_id": "oaiapp_observation_test", "sub": "account-subject", "scope": "chatgpt.tokens.use.direct offline_access openid", "exp": now.Add(time.Hour).Unix()})
	token := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"RS256"}`)) + "." + base64.RawURLEncoding.EncodeToString(claims) + ".sig"
	authorization, _ := json.Marshal(map[string]any{
		"schema": "nimi.openai_chatgpt_plan.siwc/v1", "issuer": "https://auth.openai.com", "subject": "account-subject", "email": "user@example.com", "client_id": "oaiapp_observation_test",
		"ext_agent_host_id": "urn:uuid:9d7f1f61-4ab0-4d1b-a0e6-3c1f5e4d2b10", "access_token": token, "refresh_token": "refresh-test", "token_type": "Bearer",
		"scopes": []string{"chatgpt.tokens.use.direct", "offline_access", "openid"}, "saved_at": now.Format(time.RFC3339),
	})
	sealed, registration, err := connector.SealChatGPTPlanAuthorization(string(authorization), "", now)
	if err != nil {
		t.Fatal(err)
	}
	store := connector.NewConnectorStoreWithMemorySecrets(t.TempDir())
	record, err := store.Create(connector.ConnectorRecord{ConnectorID: "connector-observation", Kind: runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED, OwnerType: runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER, OwnerID: "account-a", Provider: "openai_chatgpt_plan", Endpoint: endpoint, Status: runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE, AuthKind: runtimev1.ConnectorAuthKind_CONNECTOR_AUTH_KIND_OAUTH_MANAGED, ProviderAuthProfile: "openai_chatgpt_plan", OAuthRegistration: registration}, sealed)
	if err != nil {
		t.Fatal(err)
	}
	captured, custodyRef, err := store.CaptureChatGPTPlanRequestCredential(context.Background(), record.ConnectorID, "text-observation-job")
	if err != nil {
		t.Fatal(err)
	}
	captured.CredentialCustodyRef = custodyRef
	t.Cleanup(func() { _ = store.ReleaseCredentialCustody(custodyRef) })
	return store, captured
}

func writeObservedTextResponse(t *testing.T, w http.ResponseWriter) {
	t.Helper()
	w.Header().Set("Content-Type", "text/event-stream")
	item := map[string]any{"type": "message", "id": "message-1", "role": "assistant", "content": []any{map[string]any{"type": "output_text", "text": "hello"}}}
	events := []map[string]any{
		{"type": "response.created", "response": map[string]any{"status": "in_progress"}},
		{"type": "response.output_item.added", "output_index": 0, "item": map[string]any{"type": "message", "id": "message-1", "role": "assistant"}},
		{"type": "response.output_item.done", "output_index": 0, "item": item},
		{"type": "response.completed", "response": map[string]any{"status": "completed", "output": []any{item}, "usage": map[string]int{"input_tokens": 3, "output_tokens": 4}}},
	}
	for _, event := range events {
		encoded, err := json.Marshal(event)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event["type"], encoded)
	}
}
