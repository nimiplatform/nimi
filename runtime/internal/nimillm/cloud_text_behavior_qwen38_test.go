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
)

func TestQwen38ToolTransportUsesDashscopeCredentialAndChatPath(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/chat/completions" || r.Header.Get("Authorization") != "Bearer fixture-key" {
			t.Errorf("wrong Qwen target or credential: %s %s", r.Method, r.URL.Path)
			http.Error(w, "wrong target", http.StatusBadRequest)
			return
		}
		body := map[string]any{}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode Qwen request: %v", err)
		}
		if body["model"] != "qwen3.8-flash" || body["enable_thinking"] != false || body["thinking"] != nil || body["parallel_tool_calls"] != false || body["tool_choice"] != "auto" {
			t.Errorf("Qwen captured behavior changed: %+v", body)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []any{map[string]any{"index": 0, "finish_reason": "tool_calls", "message": map[string]any{
				"content": nil, "tool_calls": []any{map[string]any{"id": "call-1", "type": "function", "function": map[string]any{"name": "lookup", "arguments": `{"query":"Nimi"}`}}},
			}}},
			"usage": map[string]any{"prompt_tokens": 20, "completion_tokens": 9},
		})
	}))
	defer server.Close()
	adapter, err := textbehavior.NewAdapter(textbehavior.AdapterCapture{AdapterID: "dashscope.qwen38-flash.chat", Version: "1", RequestSerializerID: "dashscope/qwen38-flash/chat/request/v1", NonStreamParserID: "dashscope/qwen38-flash/chat/response/v1", StreamAssemblerID: "dashscope/qwen38-flash/chat/stream/v1", ProcessIdentityImpact: textbehavior.ProcessIdentityUnaffected},
		capabilitydriver.DashscopeQwen38RequestSerializer, capabilitydriver.DashscopeQwen38NonStreamParser, capabilitydriver.DeepseekChatStreamAssembler)
	if err != nil {
		t.Fatal(err)
	}
	spec := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "Look up Nimi."}},
		Tools: []*runtimev1.ToolSpec{{Kind: runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION, Name: "lookup"}}, ToolChoice: runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO}
	invocation, err := adapter.Bind(spec)
	if err != nil {
		t.Fatal(err)
	}
	payload, err := invocation.Serialize(false)
	if err != nil {
		t.Fatal(err)
	}
	provider := nimillm.NewCloudProvider(nimillm.CloudConfig{})
	target := &nimillm.RemoteTarget{ProviderType: "dashscope", Endpoint: server.URL + "/v1", APIKey: "fixture-key", ProviderModelID: "qwen3.8-flash", AllowLoopback: true}
	result, err := provider.ExecuteTextBehaviorWithTarget(context.Background(), "qwen3.8-flash", target, invocation, payload, nil)
	if err != nil || result.FinishReason != runtimev1.FinishReason_FINISH_REASON_TOOL_CALL || len(result.Items) != 1 || result.Items[0].ToolCall == nil || result.Items[0].ToolCall.GetArgumentsJson() != `{"query":"Nimi"}` {
		t.Fatalf("Qwen tool result=%+v err=%v", result, err)
	}
}
