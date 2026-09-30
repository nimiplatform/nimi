package nimillm

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func TestChatGPTPlanModelListUsesSelectedAccountBearerAndPreservesVisibleOrder(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/v1/models" || r.Header.Get("Authorization") != "Bearer plan-test-token" {
			t.Errorf("wrong SIWC model-list request: %s %s auth=%q", r.Method, r.URL.Path, r.Header.Get("Authorization"))
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"models":[{"slug":"gpt-6-astra","display_name":"GPT-6 Astra","visibility":"list"},{"slug":"internal-model","display_name":"Internal","visibility":"hidden"},{"slug":"gpt-6-sol","display_name":"GPT-6 Sol","visibility":"list"}]}`))
	}))
	defer server.Close()
	provider := NewCloudProvider(CloudConfig{AllowLoopbackEndpoint: true})
	models, err := provider.DiscoverChatGPTPlanModels(context.Background(), &RemoteTarget{
		ProviderType: "openai_chatgpt_plan", Endpoint: server.URL, APIKey: "plan-test-token", AllowLoopback: true,
	})
	if err != nil || len(models) != 2 || models[0].ID != "gpt-6-astra" || models[1].ID != "gpt-6-sol" || models[0].DisplayName != "GPT-6 Astra" {
		t.Fatalf("account-visible model order: models=%+v err=%v", models, err)
	}
}

func TestChatGPTPlanModelListRejectsWrongEndpointAndMalformedInventory(t *testing.T) {
	var calls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		_, _ = w.Write([]byte(`{"models":[{"slug":"gpt-6-sol","visibility":"list"},{"slug":"gpt-6-sol","visibility":"list"}]}`))
	}))
	defer server.Close()
	provider := NewCloudProvider(CloudConfig{AllowLoopbackEndpoint: true})
	_, err := provider.DiscoverChatGPTPlanModels(context.Background(), &RemoteTarget{
		ProviderType: "openai_chatgpt_plan", Endpoint: server.URL + "/backend-api/codex", APIKey: "token", AllowLoopback: true,
	})
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_CONNECTOR_INVALID || calls != 0 {
		t.Fatalf("private endpoint reached: reason=%v present=%v calls=%d err=%v", reason, ok, calls, err)
	}
	_, err = provider.DiscoverChatGPTPlanModels(context.Background(), &RemoteTarget{
		ProviderType: "openai_chatgpt_plan", Endpoint: server.URL, APIKey: "token", AllowLoopback: true,
	})
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_OUTPUT_INVALID || calls != 1 {
		t.Fatalf("ambiguous inventory accepted: reason=%v present=%v calls=%d err=%v", reason, ok, calls, err)
	}
}

func TestChatGPTPlanExecutionRequiresListVisibleAccountModelAndReusesInventory(t *testing.T) {
	var listCalls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/v1/models" {
			t.Errorf("unexpected dispatch before account admission: %s %s", r.Method, r.URL.Path)
			http.Error(w, "unexpected", http.StatusBadRequest)
			return
		}
		listCalls++
		_, _ = w.Write([]byte(`{"models":[{"slug":"gpt-6-astra","display_name":"GPT-6 Astra","visibility":"list"},{"slug":"gpt-6-luna","display_name":"GPT-6 Luna","visibility":"hide"}]}`))
	}))
	defer server.Close()
	provider := NewCloudProvider(CloudConfig{AllowLoopbackEndpoint: true})
	now := time.Date(2026, 9, 30, 12, 0, 0, 0, time.UTC)
	provider.chatGPTPlanInventory.now = func() time.Time { return now }
	target := &RemoteTarget{ProviderType: "openai_chatgpt_plan", Endpoint: server.URL, APIKey: "plan-token-1", AllowLoopback: true}

	if err := provider.requireChatGPTPlanAccountModel(context.Background(), target, "gpt-6-astra"); err != nil {
		t.Fatalf("listed account model rejected: %v", err)
	}
	// A hidden or absent account model fails typed and is never replaced.
	for _, model := range []string{"gpt-6-luna", "gpt-6.1-sol"} {
		err := provider.requireChatGPTPlanAccountModel(context.Background(), target, model)
		if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MODEL_NOT_FOUND {
			t.Fatalf("%s admitted outside the account list: reason=%v present=%v err=%v", model, reason, ok, err)
		}
	}
	if listCalls != 1 {
		t.Fatalf("inventory not reused within its bound: calls=%d", listCalls)
	}
	rotated := *target
	rotated.APIKey = "plan-token-2"
	if err := provider.requireChatGPTPlanAccountModel(context.Background(), &rotated, "gpt-6-astra"); err != nil || listCalls != 2 {
		t.Fatalf("rotated credential reused another credential's inventory: calls=%d err=%v", listCalls, err)
	}
	now = now.Add(chatGPTPlanInventoryTTL)
	if err := provider.requireChatGPTPlanAccountModel(context.Background(), target, "gpt-6-astra"); err != nil || listCalls != 3 {
		t.Fatalf("expired inventory reused: calls=%d err=%v", listCalls, err)
	}
}
