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

func TestMiniMaxMessagesPreservesCapturedOriginPrefixQueryAndCredential(t *testing.T) {
	for _, suffix := range []string{"", "/v1", "/anthropic", "/anthropic/v1", "/gateway/v1?region=fixture", "/gateway/anthropic/v1?region=fixture"} {
		t.Run(suffix, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				prefix := ""
				if len(suffix) > 8 && suffix[:8] == "/gateway" {
					prefix = "/gateway"
					if r.URL.Query().Get("region") != "fixture" {
						t.Error("captured query lost")
					}
				}
				if r.URL.Path != prefix+"/anthropic/v1/messages" || r.Header.Get("Authorization") != "Bearer fixture-key" || r.Header.Get("x-goog-api-key") != "" {
					t.Errorf("captured protocol or credential changed: path=%s bearer=%v googleHeader=%v", r.URL.Path, r.Header.Get("Authorization") == "Bearer fixture-key", r.Header.Get("x-goog-api-key") != "")
				}
				var body map[string]any
				_ = json.NewDecoder(r.Body).Decode(&body)
				if body["model"] != "MiniMax-M3" || body["thinking"] != nil {
					t.Error("native target/default changed")
				}
				_, _ = fmt.Fprint(w, `{"type":"message","role":"assistant","model":"MiniMax-M3","content":[{"type":"text","text":"Native output."}],"stop_reason":"end_turn"}`)
			}))
			defer server.Close()
			p, err := capabilitydriver.NewMiniMaxMessagesBehavior("MiniMax-M3")
			if err != nil {
				t.Fatal(err)
			}
			adapter, err := textbehavior.NewAdapter(textbehavior.AdapterCapture{AdapterID: "minimax.MiniMax-M3.messages", Version: "1", RequestSerializerID: "minimax/request/v1", NonStreamParserID: "minimax/response/v1", StreamAssemblerID: "minimax/stream/v1", ProcessIdentityImpact: textbehavior.ProcessIdentityUnaffected}, p.Serialize, p.Parse, p.Stream)
			if err != nil {
				t.Fatal(err)
			}
			invocation, err := adapter.Bind(&runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "Reply briefly."}}})
			if err != nil {
				t.Fatal(err)
			}
			wire, err := invocation.Serialize(false)
			if err != nil {
				t.Fatal(err)
			}
			target := &nimillm.RemoteTarget{ProviderType: "minimax", ProviderModelID: "MiniMax-M3", Endpoint: server.URL + suffix, APIKey: "fixture-key", AllowLoopback: true}
			r, err := nimillm.NewCloudProvider(nimillm.CloudConfig{}).ExecuteTextBehaviorWithTarget(context.Background(), "MiniMax-M3", target, invocation, wire, nil)
			if err != nil || len(r.Items) != 1 || r.Items[0].Text != "Native output." {
				t.Fatalf("native transport=%v %v", r, err)
			}
		})
	}
}
