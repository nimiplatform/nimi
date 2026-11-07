package nimillm

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

const runwayTestTaskID = "17f20503-6c24-4c16-946b-35dbbce2af2f"

func TestRunwayProbeAndDeleteKeepNativeVersionWithoutStopOrRefundClaim(t *testing.T) {
	for _, deleteStatus := range []int{204, 404} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("X-Runway-Version") != runwayAPIVersion || r.Header.Get("Authorization") != "Bearer test-key" || r.Header.Get("x-api-key") != "" {
				t.Error("native auth/version changed")
			}
			if r.Method == "GET" && r.URL.Path == "/proxy/anthropic/v1/organization" {
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(map[string]any{"creditBalance": 0, "tier": map[string]any{"maxMonthlyCreditSpend": 1000, "models": map[string]any{}}, "usage": map[string]any{"models": map[string]any{}}})
				return
			}
			if r.Method != "DELETE" || r.URL.Path != "/proxy/anthropic/v1/tasks/"+runwayTestTaskID {
				t.Error("unexpected protocol", r.Method, r.URL.Path)
			}
			w.WriteHeader(deleteStatus)
		}))
		b := NewSecuredBackend("cloud-runway", server.URL+"/proxy/anthropic/v1", "test-key", defaultHTTPTimeout, true)
		if err := b.ProbeConnector(context.Background()); err != nil {
			t.Fatal(err)
		}
		got, err := DeleteProviderAsyncTask(context.Background(), AdapterRunwayTask, runwayTestTaskID, MediaAdapterConfig{BaseURL: server.URL + "/proxy/anthropic/v1", APIKey: "test-key", AllowLoopbackEndpoint: true, Headers: map[string]string{"x-runway-version": "wrong"}})
		server.Close()
		if err != nil || got != ProviderTaskCleanupUnconfirmed {
			t.Fatal("DELETE became compute/refund proof", got, err)
		}
	}
}

func TestRunwayObservationPreservesOriginalIdentityAndExactState(t *testing.T) {
	for _, tc := range []struct {
		name, status, id    string
		outputs             int
		cost                *int64
		failure             string
		terminal, wantError bool
	}{
		{"queued", "THROTTLED", runwayTestTaskID, 0, nil, "", false, false},
		{"wrong-id", "SUCCEEDED", "17f20503-6c24-4c16-946b-35dbbce2af20", 1, ptrRunwayCost(1), "", false, true},
		{"extra-output", "SUCCEEDED", runwayTestTaskID, 2, ptrRunwayCost(1), "", false, true},
		{"missing-final-cost", "SUCCEEDED", runwayTestTaskID, 1, nil, "", false, true},
		{"signed-final-cost", "SUCCEEDED", runwayTestTaskID, 1, ptrRunwayCost(-1), "", true, false},
		{"moderation", "FAILED", runwayTestTaskID, 0, ptrRunwayCost(0), "SAFETY.INPUT.TEXT", true, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/v1/tasks/"+runwayTestTaskID {
					t.Error("original ID changed")
				}
				out := map[string]any{"id": tc.id, "status": tc.status, "estimatedCost": map[string]any{"credits": 999}, "failureCode": tc.failure}
				if tc.cost != nil {
					out["cost"] = map[string]any{"credits": *tc.cost}
				}
				outputs := []string{}
				for i := 0; i < tc.outputs; i++ {
					outputs = append(outputs, "https://example.com/output.mp4")
				}
				out["output"] = outputs
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(out)
			}))
			defer server.Close()
			r := &NativeTaskReceipt{Version: 1, Adapter: AdapterRunwayTask, TaskID: runwayTestTaskID, Model: "gen4.5", QueryPathTemplate: runwayQueryPath, Artifact: BinaryArtifact("video/mp4", nil, nil)}
			out, done, err := ObserveNativeTask(context.Background(), MediaAdapterConfig{BaseURL: server.URL, APIKey: "test-key", AllowLoopbackEndpoint: true}, r)
			if (err != nil) != tc.wantError || done != tc.terminal {
				t.Fatal(out, done, err)
			}
			if tc.name == "signed-final-cost" && (out.Usage != nil || out.Artifacts[0].GetMetadata().GetFields()["provider_cost_credits"].GetStringValue() != "-1" || out.Artifacts[0].GetDurationMs() != 0) {
				t.Fatal("credits became token, duration or estimate", out)
			}
			if tc.name == "moderation" {
				if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED {
					t.Fatal(err)
				}
			}
		})
	}
}
func ptrRunwayCost(value int64) *int64 { return &value }
