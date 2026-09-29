package nimillm_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestGemini38SchemaTransportUsesCapturedConnectorAndChatPath(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1beta/openai/chat/completions" ||
			r.Header.Get("Authorization") != "Bearer fixture-key" {
			t.Errorf("wrong Gemini target or credential: %s %s", r.Method, r.URL.Path)
			http.Error(w, "wrong target", http.StatusBadRequest)
			return
		}
		body := map[string]any{}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode Gemini request: %v", err)
		}
		format, _ := body["response_format"].(map[string]any)
		if body["model"] != "gemini-3.8-flash" || format["type"] != "json_schema" {
			t.Errorf("Gemini model/schema mismatch: %+v", body)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{
			"index": 0, "finish_reason": "stop", "message": map[string]any{"content": `{"ok":true}`},
		}}})
	}))
	defer server.Close()
	schema, _ := structpb.NewStruct(map[string]any{"type": "object", "properties": map[string]any{
		"ok": map[string]any{"type": "boolean"}}, "required": []any{"ok"}, "additionalProperties": false})
	spec := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "Return JSON."}},
		ResponseFormat: &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA,
			JsonSchema: schema, Strict: true}}
	adapter, err := textbehavior.NewAdapter(textbehavior.AdapterCapture{
		AdapterID: "gemini.38-flash.chat", Version: "2",
		RequestSerializerID:   "gemini/38-flash/chat/request/v2",
		NonStreamParserID:     "gemini/38-flash/chat/response/v2",
		StreamAssemblerID:     "gemini/38-flash/chat/stream/v2",
		ProcessIdentityImpact: textbehavior.ProcessIdentityUnaffected,
	}, capabilitydriver.Gemini38FlashRequestSerializer,
		capabilitydriver.Gemini38FlashNonStreamParser, capabilitydriver.Gemini38FlashSchemaStreamAssembler)
	if err != nil {
		t.Fatal(err)
	}
	invocation, err := adapter.Bind(spec)
	if err != nil {
		t.Fatal(err)
	}
	serialized, err := invocation.Serialize(false)
	if err != nil {
		t.Fatal(err)
	}
	provider := nimillm.NewCloudProvider(nimillm.CloudConfig{})
	target := &nimillm.RemoteTarget{ProviderType: "gemini", Endpoint: server.URL + "/v1beta/openai",
		APIKey: "fixture-key", ProviderModelID: "gemini-3.8-flash", AllowLoopback: true}
	result, err := provider.ExecuteTextBehaviorWithTarget(context.Background(), "gemini-3.8-flash", target, invocation, serialized, nil)
	if err != nil || result.FinishReason != runtimev1.FinishReason_FINISH_REASON_STOP ||
		len(result.Items) != 1 || result.Items[0].Text != `{"ok":true}` {
		t.Fatalf("Gemini schema result=%+v err=%v", result, err)
	}
}
