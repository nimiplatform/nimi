package nimillm_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
)

func TestDeepseekJSONUsesExistingCredentialHostAndExactChatPath(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" || r.Header.Get("Authorization") != "Bearer fixture-key" {
			t.Errorf("unexpected request path or credential header")
		}
		var body map[string]any
		if json.NewDecoder(r.Body).Decode(&body) != nil {
			t.Error("invalid request JSON")
		}
		if body["model"] != "deepseek-v4-flash" || body["thinking"].(map[string]any)["type"] != "disabled" {
			t.Error("captured target or behavior was lost")
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprintln(w, `data: {"choices":[{"index":0,"delta":{"content":"{\"ok\":true}"},"finish_reason":"stop"}]}`)
		fmt.Fprintln(w)
		fmt.Fprintln(w, `data: {"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":4}}`)
		fmt.Fprintln(w)
		fmt.Fprintln(w, "data: [DONE]")
		fmt.Fprintln(w)
	}))
	defer server.Close()
	adapter, err := textbehavior.NewAdapter(textbehavior.AdapterCapture{AdapterID: "deepseek.v4-flash.chat-json", Version: "1", RequestSerializerID: "deepseek/chat-json/request/v1", NonStreamParserID: "deepseek/chat-json/response/v1", StreamAssemblerID: "deepseek/chat-json/stream/v1", ProcessIdentityImpact: textbehavior.ProcessIdentityUnaffected},
		capabilitydriver.DeepseekJSONRequestSerializer, capabilitydriver.DeepseekJSONNonStreamParser, capabilitydriver.DeepseekJSONStreamAssembler)
	if err != nil {
		t.Fatal(err)
	}
	spec := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "Return JSON."}}, ResponseFormat: &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT}}
	invocation, err := adapter.Bind(spec)
	if err != nil {
		t.Fatal(err)
	}
	payload, err := invocation.Serialize(true)
	if err != nil {
		t.Fatal(err)
	}
	provider := nimillm.NewCloudProvider(nimillm.CloudConfig{})
	target := &nimillm.RemoteTarget{ProviderType: "deepseek", Endpoint: server.URL + "/v1", APIKey: "fixture-key", ProviderModelID: "deepseek-v4-flash", AllowLoopback: true}
	text := ""
	result, err := provider.ExecuteTextBehaviorWithTarget(context.Background(), "deepseek-v4-flash", target, invocation, payload, func(delta textbehavior.OrderedDelta) error { text += delta.Text; return nil })
	if err != nil {
		t.Fatal(err)
	}
	if text != `{"ok":true}` || result.Usage.GetOutputTokens() != 4 {
		t.Fatalf("result=%+v text=%q", result, text)
	}
}
