package ai

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
	"sync"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

const (
	chatGPTPlanTestClientID = "oaiapp_ai_test"
	chatGPTPlanTestSubject  = "account-subject"
)

type chatGPTPlanAITestClock struct {
	mu  sync.Mutex
	now time.Time
}

func (clock *chatGPTPlanAITestClock) Now() time.Time {
	clock.mu.Lock()
	defer clock.mu.Unlock()
	return clock.now
}

func (clock *chatGPTPlanAITestClock) Advance(duration time.Duration) {
	clock.mu.Lock()
	defer clock.mu.Unlock()
	clock.now = clock.now.Add(duration)
}

type chatGPTPlanAITestRenewer struct {
	calls  atomic.Int32
	renew  func(refreshToken string) (connector.ChatGPTPlanTokenSet, error)
	revoke error
}

func (renewer *chatGPTPlanAITestRenewer) Renew(_ context.Context, _ string, refreshToken string) (connector.ChatGPTPlanTokenSet, error) {
	renewer.calls.Add(1)
	if renewer.renew == nil {
		return connector.ChatGPTPlanTokenSet{}, fmt.Errorf("unexpected renewal")
	}
	return renewer.renew(refreshToken)
}

func (renewer *chatGPTPlanAITestRenewer) Revoke(context.Context, string, string) error {
	return renewer.revoke
}

func chatGPTPlanTestAccessToken(t *testing.T, expires time.Time, marker string) string {
	t.Helper()
	claims, err := json.Marshal(map[string]any{
		"iss": "https://auth.openai.com", "aud": "https://api.openai.com/v1", "client_id": chatGPTPlanTestClientID,
		"sub": chatGPTPlanTestSubject, "scope": "chatgpt.tokens.use.direct offline_access openid", "exp": expires.Unix(), "jti": marker,
	})
	if err != nil {
		t.Fatal(err)
	}
	return base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"RS256"}`)) + "." + base64.RawURLEncoding.EncodeToString(claims) + ".sig"
}

type chatGPTPlanAppTestFixture struct {
	managedCloudScenarioTestFixture
	clock       *chatGPTPlanAITestClock
	renewer     *chatGPTPlanAITestRenewer
	accessToken string
	serverURL   string
}

const chatGPTPlanTestInventory = `{"models":[{"slug":"gpt-6.1-sol","display_name":"GPT-6.1 Sol","visibility":"list"},{"slug":"gpt-6-astra","display_name":"GPT-6 Astra","visibility":"list"},{"slug":"gpt-6-luna","display_name":"GPT-6 Luna","visibility":"list"}]}`

// chatGPTPlanAppFixture wires a protected App to one SIWC Connector whose
// fixed resource is replaced only by an explicitly allowed loopback server.
func chatGPTPlanAppFixture(t *testing.T, modelID string, handler http.HandlerFunc) (*chatGPTPlanAppTestFixture, func(accountservice.LocalAppOperation, string) context.Context) {
	t.Helper()
	return chatGPTPlanAppFixtureWithInventory(t, modelID, chatGPTPlanTestInventory, true, handler)
}

func chatGPTPlanAppFixtureWithInventory(t *testing.T, modelID string, inventory string, wantAvailable bool, handler http.HandlerFunc) (*chatGPTPlanAppTestFixture, func(accountservice.LocalAppOperation, string) context.Context) {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && r.URL.Path == "/v1/models" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(inventory))
			return
		}
		handler(w, r)
	}))
	t.Cleanup(server.Close)
	clock := &chatGPTPlanAITestClock{now: time.Now().UTC().Truncate(time.Second)}
	renewer := &chatGPTPlanAITestRenewer{}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	store := connector.NewConnectorStoreWithMemorySecrets(t.TempDir(), connector.WithChatGPTPlanRenewer(renewer), connector.WithClock(clock.Now))
	accessToken := chatGPTPlanTestAccessToken(t, clock.Now().Add(time.Hour), "initial")
	authorization, err := json.Marshal(map[string]any{
		"schema": "nimi.openai_chatgpt_plan.siwc/v1", "issuer": "https://auth.openai.com", "subject": chatGPTPlanTestSubject,
		"email": "user@example.com", "client_id": chatGPTPlanTestClientID, "ext_agent_host_id": "urn:uuid:9d7f1f61-4ab0-4d1b-a0e6-3c1f5e4d2b10",
		"access_token": accessToken, "refresh_token": "refresh-initial", "token_type": "Bearer",
		"scopes": []string{"chatgpt.tokens.use.direct", "offline_access", "openid"}, "saved_at": clock.Now().Format(time.RFC3339),
	})
	if err != nil {
		t.Fatal(err)
	}
	sealed, registration, err := connector.SealChatGPTPlanAuthorization(string(authorization), "", clock.Now())
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
	connectorSvc := connector.New(logger, store, nil)
	connectorSvc.SetCloudProvider(nimillm.NewCloudProvider(nimillm.CloudConfig{AllowLoopbackEndpoint: true}))
	ctx := authn.WithIdentity(
		metadata.NewIncomingContext(context.Background(), metadata.Pairs("x-nimi-app-id", "nimi.desktop")),
		&authn.Identity{SubjectUserID: "user-001"},
	)
	descriptor := connectorModelDescriptorForAITest(t, connectorSvc, ctx, created.ConnectorID, modelID)
	if descriptor.GetAvailable() != wantAvailable {
		t.Fatalf("reviewed model %s availability = %v, want %v", modelID, descriptor.GetAvailable(), wantAvailable)
	}
	svc, err := newFromProviderConfig(logger, nil, store, Config{AllowLoopbackEndpoint: true}, 8, 2)
	if err != nil {
		t.Fatalf("new ai service: %v", err)
	}
	// The Runtime server wires the same account availability fact.
	store.SetAccountModelAvailability(connector.NewChatGPTPlanAccountAvailability(store, svc.CloudProvider()))
	fixture := &chatGPTPlanAppTestFixture{
		managedCloudScenarioTestFixture: managedCloudScenarioTestFixture{
			service: svc, connectorService: connectorSvc, context: ctx, connectorID: created.ConnectorID,
			descriptor: descriptor, targetRef: cloudScenarioTargetRefForDescriptor(created.ConnectorID, descriptor),
		},
		clock: clock, renewer: renewer, accessToken: accessToken, serverURL: server.URL,
	}
	target, _ := structpb.NewStruct(map[string]any{"provider": "openai_chatgpt_plan", "providerModelId": modelID, "remoteModelCatalogId": descriptor.GetRemoteModelCatalogId()})
	config := appAIConfig("app.chatgpt", &runtimev1.AIConfigCapabilityIntent{CapabilityContract: "text.generate", Route: &runtimev1.AIConfigCapabilityIntent_Cloud{Cloud: &runtimev1.AIConfigCloudIntent{
		Implementation: &runtimev1.CapabilityImplementationIdentity{ImplementationId: "openai_chatgpt_plan", DriverId: "nimillm", DriverDialect: "openai_chatgpt_plan"},
		ConnectorRef:   created.ConnectorID, ProviderModelTarget: target,
	}}})
	if err := overwriteAIConfigStoreForTest(context.Background(), svc.aiConfigStore, "user-001", config); err != nil {
		t.Fatal(err)
	}
	return fixture, func(operation accountservice.LocalAppOperation, capability string) context.Context {
		return accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{
			AccountID: "user-001", AppID: "app.chatgpt", RegisteredAppSubject: "app-subject-chatgpt", Operation: operation,
			AuthorityClass: localappop.AuthorityClassAppAccess, OperationCapability: capability,
		})
	}
}

func writeChatGPTPlanResponse(t *testing.T, w http.ResponseWriter, output []map[string]any, terminal map[string]any) {
	t.Helper()
	w.Header().Set("Content-Type", "text/event-stream")
	write := func(value any) {
		bytes, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", value.(map[string]any)["type"], bytes)
	}
	write(map[string]any{"type": "response.created", "response": map[string]any{"status": "in_progress"}})
	for index, item := range output {
		start := map[string]any{"type": item["type"], "id": item["id"], "call_id": item["call_id"], "name": item["name"], "namespace": item["namespace"]}
		write(map[string]any{"type": "response.output_item.added", "output_index": index, "item": start})
		write(map[string]any{"type": "response.output_item.done", "output_index": index, "item": item})
	}
	if terminal != nil {
		write(terminal)
	}
	if flusher, ok := w.(http.Flusher); ok {
		flusher.Flush()
	}
}

func chatGPTPlanCompleted(output []map[string]any) map[string]any {
	return map[string]any{"type": "response.completed", "response": map[string]any{"status": "completed", "output": output, "usage": map[string]int{"input_tokens": 3, "output_tokens": 4}}}
}

func chatGPTPlanCall(id, callID string, arguments string) map[string]any {
	return map[string]any{"type": "function_call", "id": id, "call_id": callID, "name": "lookup", "namespace": "nimi_app_tools", "arguments": arguments}
}

func decodeChatGPTPlanRequest(t *testing.T, r *http.Request, bearer string, modelID string) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		t.Error(err)
		return nil
	}
	if r.Method != http.MethodPost || r.URL.Path != "/v1/responses" || r.Header.Get("Authorization") != "Bearer "+bearer ||
		r.Header.Get("Accept") != "text/event-stream" || body["model"] != modelID || body["stream"] != true || body["store"] != false {
		t.Errorf("wrong public ChatGPT-plan protocol: %s %s %v", r.Method, r.URL.Path, body)
	}
	for _, rejected := range []string{"previous_response_id", "background", "conversation", "max_output_tokens", "temperature", "top_p", "metadata", "user", "truncation"} {
		if _, present := body[rejected]; present {
			t.Errorf("rejected ChatGPT-plan field %q was sent", rejected)
		}
	}
	return body
}

// The reviewed rows admit input.image, so an App-owned image artifact is sent
// as exact ordered input_text and input_image content in one Responses step.
func TestChatGPTPlanAppImageInputSendsOwnedBytesInOrder(t *testing.T) {
	var requests atomic.Int32
	payload := l1CarrierPNGBytes(t)
	expectedImage := "data:image/png;base64," + base64.StdEncoding.EncodeToString(payload)
	var fixture *chatGPTPlanAppTestFixture
	fixture, decision := chatGPTPlanAppFixture(t, "gpt-6.1-sol", func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		body := decodeChatGPTPlanRequest(t, r, fixture.accessToken, "gpt-6.1-sol")
		messages, ok := body["input"].([]any)
		if !ok || len(messages) != 1 {
			t.Errorf("input = %#v", body["input"])
			return
		}
		content, ok := messages[0].(map[string]any)["content"].([]any)
		if !ok || len(content) != 2 || content[0].(map[string]any)["type"] != "input_text" || content[1].(map[string]any)["type"] != "input_image" || content[1].(map[string]any)["image_url"] != expectedImage {
			t.Error("owned image bytes or input order changed")
		}
		output := []map[string]any{{"type": "message", "id": "msg_image", "content": []any{map[string]any{"type": "output_text", "text": "A small diagram."}}}}
		writeChatGPTPlanResponse(t, w, output, chatGPTPlanCompleted(output))
	})
	uploaded, err := fixture.service.UploadLocalAppArtifact(decision(accountservice.LocalAppOperationArtifactUpload, localappop.AppOperationIDArtifactUpload), &runtimev1.UploadLocalAppArtifactRequest{Bytes: payload, MimeType: "image/png"})
	if err != nil {
		t.Fatal(err)
	}
	input := &runtimev1.StreamLocalAppTextTurnRequest{Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Parts: []*runtimev1.ChatContentPart{
		{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT, Content: &runtimev1.ChatContentPart_Text{Text: "Describe the diagram"}},
		{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_ARTIFACT_REF, Content: &runtimev1.ChatContentPart_ArtifactRef{ArtifactRef: &runtimev1.ChatContentArtifactRef{ArtifactId: uploaded.ArtifactId, MimeType: "image/png"}}},
	}}}}
	response, err := fixture.service.ExecuteLocalAppScenario(decision(accountservice.LocalAppOperationScenarioExecute, localappop.AppOperationIDScenarioExecute),
		&runtimev1.ExecuteLocalAppScenarioRequest{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextGenerate{TextGenerate: input}})
	if err != nil || response.GetTextGenerate().GetItems()[0].GetText().GetText() != "A small diagram." || requests.Load() != 1 {
		t.Fatalf("image input = %v err=%v requests=%d", response, err, requests.Load())
	}
}

// A registered step may return the encrypted reasoning items the adapter
// requests; the exact returned transcript must be accepted by the next step.
func TestChatGPTPlanAppToolRoundTripReplaysReturnedContinuity(t *testing.T) {
	for _, modelID := range []string{"gpt-6.1-sol", "gpt-6-astra", "gpt-6-luna"} {
		t.Run(modelID, func(t *testing.T) {
			var requests atomic.Int32
			var fixture *chatGPTPlanAppTestFixture
			fixture, decision := chatGPTPlanAppFixture(t, modelID, func(w http.ResponseWriter, r *http.Request) {
				number := requests.Add(1)
				body := decodeChatGPTPlanRequest(t, r, fixture.accessToken, modelID)
				if _, present := body["instructions"]; present {
					t.Error("default instructions were injected")
				}
				tools, _ := body["tools"].([]any)
				namespace, _ := tools[0].(map[string]any)
				if len(tools) != 1 || namespace["type"] != "namespace" || namespace["name"] != "nimi_app_tools" || body["parallel_tool_calls"] != false {
					t.Errorf("function tools were not grouped as the preview requires: %v", body["tools"])
				}
				if number == 1 {
					output := []map[string]any{
						{"type": "reasoning", "id": "rs_1", "encrypted_content": "opaque-continuity", "summary": []any{}},
						chatGPTPlanCall("fc_1", "call_1", `{"query":"one"}`),
					}
					writeChatGPTPlanResponse(t, w, output, chatGPTPlanCompleted(output))
					return
				}
				input := body["input"].([]any)
				if len(input) != 4 {
					t.Errorf("replayed transcript = %v", input)
					return
				}
				reasoning, call, result := input[1].(map[string]any), input[2].(map[string]any), input[3].(map[string]any)
				if reasoning["type"] != "reasoning" || reasoning["id"] != "rs_1" || reasoning["encrypted_content"] != "opaque-continuity" ||
					call["type"] != "function_call" || call["call_id"] != "call_1" || call["namespace"] != "nimi_app_tools" ||
					result["type"] != "function_call_output" || result["call_id"] != "call_1" {
					t.Errorf("continuity order or call association lost: %v", input)
				}
				output := []map[string]any{{"type": "message", "id": "msg_1", "content": []any{map[string]any{"type": "output_text", "text": "Lookup completed."}}}}
				writeChatGPTPlanResponse(t, w, output, chatGPTPlanCompleted(output))
			})
			execute := func(input *runtimev1.StreamLocalAppTextTurnRequest) (*runtimev1.ExecuteLocalAppScenarioResponse, error) {
				return fixture.service.ExecuteLocalAppScenario(decision(accountservice.LocalAppOperationScenarioExecute, localappop.AppOperationIDScenarioExecute),
					&runtimev1.ExecuteLocalAppScenarioRequest{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextGenerate{TextGenerate: input}})
			}
			input := &runtimev1.StreamLocalAppTextTurnRequest{Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: "Use the lookup"}}, Tools: []*runtimev1.ToolSpec{localAppLookupTool(t)}, ToolChoice: runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED}
			first, err := execute(input)
			if err != nil {
				t.Fatal(err)
			}
			items := first.GetTextGenerate().GetItems()
			if len(items) != 2 || items[0].GetReasoningContinuity().GetKind() != "openai_chatgpt_plan.responses.encrypted-reasoning" || items[1].GetToolCall().GetId() != "call_1" {
				t.Fatalf("ordered outputs: %v", items)
			}
			// The App returns every item exactly as received, then its ToolResult.
			turn := &runtimev1.LocalAppTextCandidateMessage{Role: "assistant"}
			for _, item := range items {
				turn.TurnItems = append(turn.TurnItems, &runtimev1.TextTurnItem{Item: &runtimev1.TextTurnItem_Output{Output: item}})
			}
			turn.TurnItems = append(turn.TurnItems, &runtimev1.TextTurnItem{Item: &runtimev1.TextTurnItem_ToolResult{ToolResult: &runtimev1.ToolResult{ToolCallId: "call_1", ToolName: "lookup", Result: structpb.NewStringValue("complete")}}})
			input.Messages = append(input.Messages, turn)
			input.ToolChoice = runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE
			second, err := execute(input)
			if err != nil || second.GetTextGenerate().GetItems()[0].GetText().GetText() != "Lookup completed." || requests.Load() != 2 {
				t.Fatalf("round trip = %v err=%v requests=%d", second, err, requests.Load())
			}

			// A streamed tool step is still unregistered and fails before dispatch.
			stream := &mockLocalAppTextTurnStream{ctx: decision(accountservice.LocalAppOperationTextTurnStream, localappop.AppOperationIDTextTurnStream)}
			if err := fixture.service.StreamLocalAppTextTurn(input, stream); err == nil {
				t.Fatal("streamed tool step was admitted")
			} else if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED || requests.Load() != 2 {
				t.Fatalf("streamed tool step = %v requests=%d", err, requests.Load())
			}
		})
	}
}

// Plain text in both modes and strict JSON Schema continue a transcript that
// carries the returned continuity in its original order.
func TestChatGPTPlanAppContinuesTranscriptWithReturnedContinuity(t *testing.T) {
	schema := localAppLookupTool(t).GetInputSchema()
	for _, test := range []struct {
		name   string
		mode   string
		format *runtimev1.ResponseFormat
		text   string
	}{
		{name: "plain", mode: "sync", text: "First answer."},
		{name: "plain", mode: "stream", text: "First answer."},
		{name: "strict json schema", mode: "sync", text: `{"query":"complete"}`, format: &runtimev1.ResponseFormat{
			Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA, JsonSchema: schema, SchemaName: "lookup_result", Strict: true,
		}},
	} {
		t.Run(test.name+"/"+test.mode, func(t *testing.T) {
			var requests atomic.Int32
			var fixture *chatGPTPlanAppTestFixture
			fixture, decision := chatGPTPlanAppFixture(t, "gpt-6-astra", func(w http.ResponseWriter, r *http.Request) {
				number := requests.Add(1)
				body := decodeChatGPTPlanRequest(t, r, fixture.accessToken, "gpt-6-astra")
				if number == 2 {
					input := body["input"].([]any)
					if len(input) != 4 || input[1].(map[string]any)["type"] != "reasoning" || input[1].(map[string]any)["encrypted_content"] != "astra-continuity" {
						t.Errorf("continued transcript = %v", input)
					}
				}
				output := []map[string]any{
					{"type": "reasoning", "id": fmt.Sprintf("rs_%d", number), "encrypted_content": "astra-continuity", "summary": []any{}},
					{"type": "message", "id": fmt.Sprintf("msg_%d", number), "content": []any{map[string]any{"type": "output_text", "text": test.text}}},
				}
				writeChatGPTPlanResponse(t, w, output, chatGPTPlanCompleted(output))
			})
			input := &runtimev1.StreamLocalAppTextTurnRequest{Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: "Start"}}, ResponseFormat: test.format}
			run := func() []*runtimev1.TextOutputItem {
				if test.mode == "sync" {
					response, err := fixture.service.ExecuteLocalAppScenario(decision(accountservice.LocalAppOperationScenarioExecute, localappop.AppOperationIDScenarioExecute),
						&runtimev1.ExecuteLocalAppScenarioRequest{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextGenerate{TextGenerate: input}})
					if err != nil {
						t.Fatal(err)
					}
					return response.GetTextGenerate().GetItems()
				}
				stream := &mockLocalAppTextTurnStream{ctx: decision(accountservice.LocalAppOperationTextTurnStream, localappop.AppOperationIDTextTurnStream)}
				if err := fixture.service.StreamLocalAppTextTurn(input, stream); err != nil {
					t.Fatal(err)
				}
				// A streaming App rebuilds the ordered items from the events it received.
				var out []*runtimev1.TextOutputItem
				for _, event := range stream.events {
					if carrier := event.GetReasoningContinuity().GetCarrier(); carrier != nil {
						out = append(out, &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ReasoningContinuity{ReasoningContinuity: carrier}})
					}
					if text := event.GetDelta().GetText(); text != "" {
						out = append(out, &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_Text{Text: &runtimev1.TextOutputText{Text: text}}})
					}
				}
				return out
			}
			first := run()
			if len(first) != 2 || first[0].GetReasoningContinuity() == nil || first[1].GetText().GetText() != test.text {
				t.Fatalf("first step items = %v", first)
			}
			turn := &runtimev1.LocalAppTextCandidateMessage{Role: "assistant"}
			for _, item := range first {
				turn.TurnItems = append(turn.TurnItems, &runtimev1.TextTurnItem{Item: &runtimev1.TextTurnItem_Output{Output: item}})
			}
			input.Messages = append(input.Messages, turn, &runtimev1.LocalAppTextCandidateMessage{Role: "user", Text: "Continue"})
			if second := run(); len(second) != 2 || requests.Load() != 2 {
				t.Fatalf("continued step items = %v requests=%d", second, requests.Load())
			}
		})
	}
}

// The registration relays opaque continuity only; a reasoning activation,
// effort or presentation request is not admitted for any plan target.
func TestChatGPTPlanRegistrationAdmitsContinuityWithoutReasoningControls(t *testing.T) {
	registration := chatGPTPlanTextBehaviorRegistration("gpt-6-astra")
	carrier := &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ReasoningContinuity{ReasoningContinuity: &runtimev1.ReasoningContinuityCarrier{
		Kind: "openai_chatgpt_plan.responses.encrypted-reasoning", Version: 1, Payload: []byte(`{"type":"reasoning","id":"rs_1","encrypted_content":"opaque","summary":[]}`),
	}}}
	continued := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{
		{Role: "user", Content: "Start"},
		{Role: "assistant", TurnItems: []*runtimev1.TextTurnItem{{Item: &runtimev1.TextTurnItem_Output{Output: carrier}}}},
		{Role: "user", Content: "Continue"},
	}}
	requested, err := requestedTextBehaviorsForSpec(continued)
	if err != nil || !requested.reasoningContinuity {
		t.Fatalf("continuity request = %+v err=%v", requested, err)
	}
	for _, mode := range []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM} {
		if !textBehaviorAdapterSupportsRequest(registration, requested, mode, continued) {
			t.Fatalf("returned continuity is not replayable in mode %v", mode)
		}
	}
	activated := &runtimev1.TextGenerateScenarioSpec{
		Input:     []*runtimev1.ChatMessage{{Role: "user", Content: "Think first"}},
		Reasoning: &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED},
	}
	if requested, err := requestedTextBehaviorsForSpec(activated); err == nil && textBehaviorAdapterSupportsRequest(registration, requested, runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, activated) {
		t.Fatal("reasoning activation was admitted for a continuity-only relay")
	}
}

func TestChatGPTPlanAppTextAndStrictStructuredOutputUseSSE(t *testing.T) {
	schema := localAppLookupTool(t).GetInputSchema()
	for _, test := range []struct {
		name   string
		format *runtimev1.ResponseFormat
		text   string
	}{
		{name: "plain", text: "Sol completed the request."},
		{name: "strict json schema", text: `{"query":"complete"}`, format: &runtimev1.ResponseFormat{
			Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA, JsonSchema: schema, SchemaName: "lookup_result", Strict: true,
		}},
	} {
		for _, mode := range []string{"sync", "stream"} {
			if test.format != nil && mode == "stream" {
				continue
			}
			t.Run(test.name+"/"+mode, func(t *testing.T) {
				var requests atomic.Int32
				var fixture *chatGPTPlanAppTestFixture
				fixture, decision := chatGPTPlanAppFixture(t, "gpt-6.1-sol", func(w http.ResponseWriter, r *http.Request) {
					requests.Add(1)
					body := decodeChatGPTPlanRequest(t, r, fixture.accessToken, "gpt-6.1-sol")
					if test.format != nil {
						format, _ := body["text"].(map[string]any)["format"].(map[string]any)
						if format["type"] != "json_schema" || format["name"] != "lookup_result" || format["strict"] != true {
							t.Errorf("strict JSON Schema was not preserved: %v", format)
						}
					}
					output := []map[string]any{
						{"type": "reasoning", "id": "rs_sol", "encrypted_content": "sol-continuity", "summary": []any{}},
						{"type": "message", "id": "msg_sol", "content": []any{map[string]any{"type": "output_text", "text": test.text}}},
					}
					writeChatGPTPlanResponse(t, w, output, chatGPTPlanCompleted(output))
				})
				input := &runtimev1.StreamLocalAppTextTurnRequest{Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: "Complete the request"}}, ResponseFormat: test.format}
				if mode == "sync" {
					response, err := fixture.service.ExecuteLocalAppScenario(decision(accountservice.LocalAppOperationScenarioExecute, localappop.AppOperationIDScenarioExecute),
						&runtimev1.ExecuteLocalAppScenarioRequest{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextGenerate{TextGenerate: input}})
					if err != nil {
						t.Fatal(err)
					}
					output := response.GetTextGenerate()
					if len(output.GetItems()) != 2 || output.GetItems()[1].GetText().GetText() != test.text || output.GetFinishReason() != runtimev1.FinishReason_FINISH_REASON_STOP {
						t.Fatalf("output = %v", output)
					}
				} else {
					stream := &mockLocalAppTextTurnStream{ctx: decision(accountservice.LocalAppOperationTextTurnStream, localappop.AppOperationIDTextTurnStream)}
					if err := fixture.service.StreamLocalAppTextTurn(input, stream); err != nil {
						t.Fatal(err)
					}
					if len(stream.events) != 3 || stream.events[1].GetDelta().GetText() != test.text || stream.events[2].GetCompleted().GetFinishReason() != runtimev1.FinishReason_FINISH_REASON_STOP {
						t.Fatalf("stream = %v", stream.events)
					}
				}
				if requests.Load() != 1 {
					t.Fatalf("provider requests = %d, want 1", requests.Load())
				}
			})
		}
	}
}

func TestChatGPTPlanStreamedStructuredOutputIsNotRegistered(t *testing.T) {
	var requests atomic.Int32
	fixture, decision := chatGPTPlanAppFixture(t, "gpt-6-astra", func(w http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		http.Error(w, "unexpected dispatch", http.StatusBadRequest)
	})
	input := &runtimev1.StreamLocalAppTextTurnRequest{Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: "Complete the request"}}, ResponseFormat: &runtimev1.ResponseFormat{
		Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA, JsonSchema: localAppLookupTool(t).GetInputSchema(), SchemaName: "lookup_result", Strict: true,
	}}
	stream := &mockLocalAppTextTurnStream{ctx: decision(accountservice.LocalAppOperationTextTurnStream, localappop.AppOperationIDTextTurnStream)}
	err := fixture.service.StreamLocalAppTextTurn(input, stream)
	if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED || requests.Load() != 0 {
		t.Fatalf("streamed schema = %v requests=%d", err, requests.Load())
	}
}

func TestChatGPTPlanRejectsUnsupportedRequestsBeforeDispatch(t *testing.T) {
	var calls atomic.Int32
	fixture, _ := chatGPTPlanAppFixture(t, "gpt-6-astra", func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		http.Error(w, "unexpected unsupported request", http.StatusBadRequest)
	})
	nonStrict, _ := structpb.NewStruct(map[string]any{"type": "object", "properties": map[string]any{"title": map[string]any{"type": "string"}}})
	for _, test := range []struct {
		name  string
		apply func(*runtimev1.TextGenerateScenarioSpec)
	}{
		{name: "temperature", apply: func(spec *runtimev1.TextGenerateScenarioSpec) { spec.Temperature = proto.Float32(0) }},
		{name: "top p", apply: func(spec *runtimev1.TextGenerateScenarioSpec) { spec.TopP = proto.Float32(1) }},
		{name: "max tokens", apply: func(spec *runtimev1.TextGenerateScenarioSpec) { spec.MaxTokens = proto.Int32(32) }},
		{name: "stop", apply: func(spec *runtimev1.TextGenerateScenarioSpec) { spec.Stop = []string{"stop"} }},
		{name: "raw chunks", apply: func(spec *runtimev1.TextGenerateScenarioSpec) { spec.IncludeRawChunks = true }},
		{name: "named tool choice", apply: func(spec *runtimev1.TextGenerateScenarioSpec) {
			spec.Tools, spec.ToolChoice, spec.ToolChoiceName = []*runtimev1.ToolSpec{localAppLookupTool(t)}, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL, "lookup"
		}},
		{name: "non-strict schema", apply: func(spec *runtimev1.TextGenerateScenarioSpec) {
			spec.ResponseFormat = &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA, JsonSchema: nonStrict}
		}},
		{name: "tool plus schema", apply: func(spec *runtimev1.TextGenerateScenarioSpec) {
			spec.Tools = []*runtimev1.ToolSpec{localAppLookupTool(t)}
			spec.ResponseFormat = &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA, JsonSchema: localAppLookupTool(t).GetInputSchema(), Strict: true}
		}},
	} {
		for _, mode := range []string{"sync", "stream"} {
			t.Run(test.name+"/"+mode, func(t *testing.T) {
				textSpec := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "respond"}}}
				test.apply(textSpec)
				spec := &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_TextGenerate{TextGenerate: textSpec}}
				head := &runtimev1.ScenarioRequestHead{AppId: "app.chatgpt", SubjectUserId: "user-001", TimeoutMs: 10_000}
				ctx := scenarioJobUserContext("app.chatgpt", "user-001")
				var err error
				if mode == "sync" {
					_, err = fixture.service.ExecuteScenario(ctx, &runtimev1.ExecuteScenarioRequest{Head: head, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE, ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, Spec: spec})
				} else {
					err = fixture.service.StreamScenario(&runtimev1.StreamScenarioRequest{Head: head, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE, Spec: spec}, &mockScenarioEventStream{ctx: ctx})
				}
				if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED || calls.Load() != 0 {
					t.Fatalf("unsupported request = %v, provider calls = %d", err, calls.Load())
				}
			})
		}
	}
}

func TestChatGPTPlanProviderFailuresStayTyped(t *testing.T) {
	var redirected atomic.Int32
	redirectTarget := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { redirected.Add(1) }))
	defer redirectTarget.Close()
	tests := []struct {
		name   string
		reply  func(w http.ResponseWriter, r *http.Request)
		reason runtimev1.ReasonCode
		hint   string
	}{
		{name: "usage limit in stream", reason: runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED, hint: "manage_chatgpt_plan_usage", reply: func(w http.ResponseWriter, _ *http.Request) {
			writeChatGPTPlanResponse(t, w, nil, map[string]any{"type": "response.failed", "response": map[string]any{"status": "failed", "error": map[string]any{"code": "subscription_sharing_usage_limit_exceeded"}}})
		}},
		{name: "ineligible account before stream", reason: runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED, hint: "chatgpt_plan_not_eligible", reply: func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte(`{"error":{"code":"subscription_sharing_user_not_eligible","message":"x"}}`))
		}},
		{name: "admission detail body", reason: runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, reply: func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte(`{"detail":"direct routing unavailable"}`))
		}},
		{name: "incomplete response", reason: runtimev1.ReasonCode_AI_TEXT_OUTPUT_INCOMPLETE, reply: func(w http.ResponseWriter, _ *http.Request) {
			writeChatGPTPlanResponse(t, w, nil, map[string]any{"type": "response.incomplete", "response": map[string]any{"status": "incomplete", "incomplete_details": map[string]any{"reason": "max_output_tokens"}}})
		}},
		{name: "redirect is not followed", reason: runtimev1.ReasonCode_AI_PROVIDER_ENDPOINT_FORBIDDEN, reply: func(w http.ResponseWriter, r *http.Request) {
			http.Redirect(w, r, redirectTarget.URL+"/v1/responses", http.StatusTemporaryRedirect)
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			fixture, decision := chatGPTPlanAppFixture(t, "gpt-6-luna", test.reply)
			_, err := fixture.service.ExecuteLocalAppScenario(decision(accountservice.LocalAppOperationScenarioExecute, localappop.AppOperationIDScenarioExecute),
				&runtimev1.ExecuteLocalAppScenarioRequest{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextGenerate{TextGenerate: &runtimev1.StreamLocalAppTextTurnRequest{
					Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: "respond"}},
				}}})
			reason, ok := grpcerr.ExtractReasonCode(err)
			if !ok || reason != test.reason {
				t.Fatalf("reason = %v present=%v err=%v", reason, ok, err)
			}
			if test.hint != "" {
				if metadata, _ := grpcerr.ExtractReasonMetadata(err); metadata["action_hint"] != test.hint {
					t.Fatalf("action hint = %q", metadata["action_hint"])
				}
			}
		})
	}
	if redirected.Load() != 0 {
		t.Fatal("a ChatGPT-plan request followed a redirect away from the fixed endpoint")
	}
}

func TestChatGPTPlanUnlistedAccountModelFailsBeforeDispatch(t *testing.T) {
	var responses atomic.Int32
	// The account list carries the reviewed row only as hidden: the listing keeps
	// it as unavailable and execution fails typed without another model.
	inventory := `{"models":[{"slug":"gpt-6-astra","display_name":"GPT-6 Astra","visibility":"list"},{"slug":"gpt-6-luna","display_name":"GPT-6 Luna","visibility":"hide"}]}`
	fixture, decision := chatGPTPlanAppFixtureWithInventory(t, "gpt-6-luna", inventory, false, func(w http.ResponseWriter, _ *http.Request) {
		responses.Add(1)
		http.Error(w, "unexpected dispatch", http.StatusBadRequest)
	})
	_, err := fixture.service.ExecuteLocalAppScenario(decision(accountservice.LocalAppOperationScenarioExecute, localappop.AppOperationIDScenarioExecute),
		&runtimev1.ExecuteLocalAppScenarioRequest{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextGenerate{TextGenerate: &runtimev1.StreamLocalAppTextTurnRequest{
			Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: "respond"}},
		}}})
	if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_MODEL_NOT_FOUND || responses.Load() != 0 {
		t.Fatalf("unlisted account model = %v responses=%d", err, responses.Load())
	}
	if metadata, _ := grpcerr.ExtractReasonMetadata(err); metadata["action_hint"] != "select_available_model" {
		t.Fatalf("unlisted account model action = %v", metadata)
	}
}

// AIConfig options and effective selections project the same current-account
// availability as the Connector listing and the dispatch gate.
func TestChatGPTPlanAIConfigProjectsAccountAvailability(t *testing.T) {
	inventory := `{"models":[{"slug":"gpt-6-astra","display_name":"GPT-6 Astra","visibility":"list"},{"slug":"gpt-6-luna","display_name":"GPT-6 Luna","visibility":"hide"}]}`
	fixture, _ := chatGPTPlanAppFixtureWithInventory(t, "gpt-6-luna", inventory, false, func(w http.ResponseWriter, _ *http.Request) {
		t.Error("configuration reads must not dispatch inference")
	})
	ctx := context.Background()
	states := func() map[string]*connector.AIConfigCloudTargetOption {
		options, _, err := connector.ListAIConfigCloudTargetOptions(ctx, fixture.service.connStore, fixture.service.speechCatalog, "user-001", "text.generate", fixture.connectorID, "", 50)
		if err != nil {
			t.Fatal(err)
		}
		out := map[string]*connector.AIConfigCloudTargetOption{}
		for index := range options {
			out[options[index].ProviderTarget.GetFields()["providerModelId"].GetStringValue()] = &options[index]
		}
		return out
	}
	options := states()
	if option := options["gpt-6-astra"]; option == nil || option.State != runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_READY {
		t.Fatalf("account-listed target = %+v", option)
	}
	for _, missing := range []string{"gpt-6-luna", "gpt-6.1-sol"} {
		option := options[missing]
		if option == nil || option.State != runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_BLOCKED ||
			len(option.Reasons) != 1 || option.Reasons[0] != runtimev1.ReasonCode_AI_MODEL_NOT_FOUND {
			t.Fatalf("account-missing target %s = %+v", missing, option)
		}
	}
	intent := func(model string) *runtimev1.AIConfigCloudIntent {
		option := options[model]
		return &runtimev1.AIConfigCloudIntent{Implementation: option.Implementation, ConnectorRef: fixture.connectorID, ProviderModelTarget: option.ProviderTarget}
	}
	if selection := fixture.service.projectCloudEffectiveSelection(ctx, "user-001", "text.generate", intent("gpt-6-luna"), nil); selection.GetState() != runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_BLOCKED ||
		len(selection.GetReasons()) != 1 || selection.GetReasons()[0] != runtimev1.ReasonCode_AI_MODEL_NOT_FOUND.String() {
		t.Fatalf("committed account-missing selection = %v", selection)
	}
	if selection := fixture.service.projectCloudEffectiveSelection(ctx, "user-001", "text.generate", intent("gpt-6-astra"), nil); selection.GetState() != runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_READY {
		t.Fatalf("committed account-listed selection = %v", selection)
	}
	// Near expiry a configuration read renews custody like the Connector
	// listing, so the account list stays known.
	fixture.renewer.renew = func(string) (connector.ChatGPTPlanTokenSet, error) {
		rotated := chatGPTPlanTestAccessToken(t, fixture.clock.Now().Add(time.Hour), "rotated")
		return connector.ChatGPTPlanTokenSet{AccessToken: rotated, RefreshToken: "refresh-rotated", TokenType: "Bearer", ExpiresIn: 3600}, nil
	}
	fixture.clock.Advance(57 * time.Minute)
	if option := states()["gpt-6-luna"]; option.State != runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_BLOCKED || fixture.renewer.calls.Load() != 1 {
		t.Fatalf("availability after renewal = %+v renewals=%d", option, fixture.renewer.calls.Load())
	}
}

func TestChatGPTPlanRenewsExpiringCredentialBeforeDispatch(t *testing.T) {
	var fixture *chatGPTPlanAppTestFixture
	var rotated string
	var requests atomic.Int32
	fixture, decision := chatGPTPlanAppFixture(t, "gpt-6.1-sol", func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		decodeChatGPTPlanRequest(t, r, rotated, "gpt-6.1-sol")
		output := []map[string]any{{"type": "message", "id": "msg", "content": []any{map[string]any{"type": "output_text", "text": "renewed"}}}}
		writeChatGPTPlanResponse(t, w, output, chatGPTPlanCompleted(output))
	})
	fixture.renewer.renew = func(refreshToken string) (connector.ChatGPTPlanTokenSet, error) {
		if refreshToken != "refresh-initial" {
			t.Errorf("renewed with %q", refreshToken)
		}
		rotated = chatGPTPlanTestAccessToken(t, fixture.clock.Now().Add(time.Hour), "rotated")
		return connector.ChatGPTPlanTokenSet{AccessToken: rotated, RefreshToken: "refresh-rotated", TokenType: "Bearer", ExpiresIn: 3600}, nil
	}
	fixture.clock.Advance(57 * time.Minute)
	execute := func() error {
		_, err := fixture.service.ExecuteLocalAppScenario(decision(accountservice.LocalAppOperationScenarioExecute, localappop.AppOperationIDScenarioExecute),
			&runtimev1.ExecuteLocalAppScenarioRequest{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextGenerate{TextGenerate: &runtimev1.StreamLocalAppTextTurnRequest{
				Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: "respond"}},
			}}})
		return err
	}
	if err := execute(); err != nil || fixture.renewer.calls.Load() != 1 || requests.Load() != 1 {
		t.Fatalf("renewed request err=%v renewals=%d requests=%d", err, fixture.renewer.calls.Load(), requests.Load())
	}
	if err := execute(); err != nil || fixture.renewer.calls.Load() != 1 || requests.Load() != 2 {
		t.Fatalf("committed rotation was not reused: err=%v renewals=%d", err, fixture.renewer.calls.Load())
	}
	fixture.clock.Advance(58 * time.Minute)
	fixture.renewer.renew = func(string) (connector.ChatGPTPlanTokenSet, error) {
		return connector.ChatGPTPlanTokenSet{}, fmt.Errorf("simulated unusable grant")
	}
	err := execute()
	if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING || requests.Load() != 2 {
		t.Fatalf("failed renewal = %v requests=%d", err, requests.Load())
	}
	if metadata, _ := grpcerr.ExtractReasonMetadata(err); metadata["action_hint"] != connector.ChatGPTPlanReauthorizeHint {
		t.Fatalf("reauthorization action = %v", metadata)
	}
	if record, _, _ := fixture.service.connStore.Get(fixture.connectorID); record.HasCredential {
		t.Fatal("Connector still projects a usable credential after terminal renewal failure")
	}
}

func TestChatGPTPlanMissingTerminalAndCancelNeverComplete(t *testing.T) {
	for _, cancel := range []bool{false, true} {
		t.Run(fmt.Sprint(cancel), func(t *testing.T) {
			started, closed := make(chan struct{}), make(chan struct{})
			fixture, decision := chatGPTPlanAppFixture(t, "gpt-6.1-sol", func(w http.ResponseWriter, r *http.Request) {
				writeChatGPTPlanResponse(t, w, []map[string]any{{"type": "message", "id": "msg_1", "content": []any{map[string]any{"type": "output_text", "text": "partial"}}}}, nil)
				close(started)
				if cancel {
					<-r.Context().Done()
					close(closed)
				}
			})
			ctx, stop := context.WithCancel(decision(accountservice.LocalAppOperationTextTurnStream, localappop.AppOperationIDTextTurnStream))
			defer stop()
			stream := &mockLocalAppTextTurnStream{ctx: ctx}
			done := make(chan error, 1)
			go func() {
				done <- fixture.service.StreamLocalAppTextTurn(&runtimev1.StreamLocalAppTextTurnRequest{Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: "write"}}}, stream)
			}()
			select {
			case <-started:
			case err := <-done:
				t.Fatalf("request did not dispatch: %v", err)
			case <-time.After(5 * time.Second):
				t.Fatal("request did not start")
			}
			if cancel {
				stop()
				select {
				case <-closed:
				case <-time.After(5 * time.Second):
					t.Fatal("HTTP did not cancel")
				}
			}
			select {
			case <-done:
			case <-time.After(5 * time.Second):
				t.Fatal("request did not settle")
			}
			for _, event := range stream.events {
				if event.GetCompleted() != nil {
					t.Fatal("unfinished step completed")
				}
			}
		})
	}
}

func TestChatGPTPlanCandidateRejectsCarrierOnlyAndSampling(t *testing.T) {
	var requests atomic.Int32
	var fixture *chatGPTPlanAppTestFixture
	carrierOnly := atomic.Bool{}
	fixture, decision := chatGPTPlanAppFixture(t, "gpt-6-astra", func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		decodeChatGPTPlanRequest(t, r, fixture.accessToken, "gpt-6-astra")
		output := []map[string]any{{"type": "reasoning", "id": "rs", "encrypted_content": "private", "summary": []any{}}}
		if !carrierOnly.Load() {
			output = append(output, map[string]any{"type": "message", "id": "msg", "content": []any{map[string]any{"type": "output_text", "text": "Candidate text."}}})
		}
		writeChatGPTPlanResponse(t, w, output, chatGPTPlanCompleted(output))
	})
	ctx := decision(accountservice.LocalAppOperationTextCandidateGenerate, localappop.AppOperationIDTextCandidateGenerate)
	messages := []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: "Draft candidate text"}}
	response, err := fixture.service.GenerateLocalAppTextCandidate(ctx, &runtimev1.GenerateLocalAppTextCandidateRequest{Messages: messages})
	if err != nil || response.GetText() != "Candidate text." || strings.TrimSpace(response.GetTraceId()) == "" {
		t.Fatalf("candidate = %v err=%v", response, err)
	}
	if _, err := fixture.service.GenerateLocalAppTextCandidate(ctx, &runtimev1.GenerateLocalAppTextCandidateRequest{Messages: messages, Temperature: proto.Float32(0)}); err == nil || requests.Load() != 1 {
		t.Fatalf("sampling request = %v requests=%d", err, requests.Load())
	}
	carrierOnly.Store(true)
	_, err = fixture.service.GenerateLocalAppTextCandidate(ctx, &runtimev1.GenerateLocalAppTextCandidateRequest{Messages: messages})
	if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_TEXT_OUTPUT_INCOMPLETE || status.Code(err) != codes.ResourceExhausted {
		t.Fatalf("carrier-only output = %v", err)
	}
}
