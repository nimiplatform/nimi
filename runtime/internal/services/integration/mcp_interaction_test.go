package integration

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestIntegrationMCPInputRequiredIsUnsupportedWithoutRetryOrStateExposure(t *testing.T) {
	for _, effect := range []string{"read", "write"} {
		t.Run(effect, func(t *testing.T) {
			var toolCalls atomic.Int32
			s := newIntegrationTestService(t, testRoundTripper(func(req *http.Request) (*http.Response, error) {
				if req.Method == http.MethodDelete {
					return &http.Response{StatusCode: 204, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(""))}, nil
				}
				var rpc struct {
					ID     json.RawMessage `json:"id"`
					Method string          `json:"method"`
				}
				if err := json.NewDecoder(req.Body).Decode(&rpc); err != nil {
					return nil, err
				}
				switch rpc.Method {
				case "initialize":
					return jsonResponse(map[string]any{"jsonrpc": "2.0", "id": rpc.ID, "result": map[string]any{"protocolVersion": "2025-06-18", "serverInfo": map[string]any{"name": "test", "version": "1"}, "capabilities": map[string]any{"tools": map[string]any{}}}}), nil
				case "notifications/initialized":
					return &http.Response{StatusCode: 202, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(""))}, nil
				case "tools/call":
					toolCalls.Add(1)
					// The installed SDK defines empty inputRequests as load shedding. This
					// is still an incomplete interaction, even though isError is false.
					return jsonResponse(map[string]any{"jsonrpc": "2.0", "id": rpc.ID, "result": map[string]any{"resultType": "input_required", "isError": false, "inputRequests": map[string]any{}, "requestState": "private-resume-token"}}), nil
				default:
					return nil, fmt.Errorf("unexpected MCP request %q", rpc.Method)
				}
			}))
			d := testDecision("consumer", 1)
			target := target{Account: d.AccountID, Endpoint: "https://mcp.test.invalid", Public: &runtimev1.IntegrationTarget{TargetRef: "test-mcp", Kind: "mcp", IntegrationId: "mcp", Operations: []*runtimev1.IntegrationOperation{testOperation(effect)}}}
			if err := s.saveTarget(context.Background(), target); err != nil {
				t.Fatal(err)
			}
			grantTestTarget(t, s, d, target.Public.TargetRef, "document.read")
			id := invokeTestCall(t, s, d, target.Public.TargetRef, "document.read", `{}`)
			result := waitTestCall(t, s, d, id)
			expected := "failed"
			if effect == "write" {
				expected = "unconfirmed"
			}
			if result.Status != expected || result.ErrorCode != "INTEGRATION_INTERACTION_UNSUPPORTED" || result.ResultJson != "" || toolCalls.Load() != 1 {
				t.Fatalf("input-required response became success, leaked state, or retried: %v calls=%d", result, toolCalls.Load())
			}
		})
	}
}
