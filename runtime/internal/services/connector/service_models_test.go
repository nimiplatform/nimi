package connector

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
)

func TestListConnectorModelsRemoteUsesCatalogWithoutOutbound(t *testing.T) {
	svc := newTestService(t)
	ctx := userContext("user-1")
	var hits atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		http.NotFound(w, r)
	}))
	t.Cleanup(server.Close)
	svc.SetCloudProvider(nimillm.NewCloudProvider(nimillm.CloudConfig{
		Providers: map[string]nimillm.ProviderCredentials{
			"openai": {BaseURL: server.URL, APIKey: "cloud-key"},
		},
		HTTPTimeout:           5 * time.Second,
		AllowLoopbackEndpoint: true,
	}, nil, nil))
	created, err := svc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{
		Provider: "openai",
		Endpoint: server.URL,
		ApiKey:   "managed-key",
	})
	if err != nil {
		t.Fatalf("CreateConnector: %v", err)
	}
	connectorID := created.GetConnector().GetConnectorId()
	if connectorID == "" {
		t.Fatalf("expected connector id")
	}
	resp, err := svc.ListConnectorModels(ctx, &runtimev1.ListConnectorModelsRequest{
		ConnectorId: connectorID,
		PageSize:    200,
	})
	if err != nil {
		t.Fatalf("ListConnectorModels: %v", err)
	}
	if len(resp.GetModels()) == 0 {
		t.Fatalf("expected catalog-derived model list")
	}
	foundGPTAudio := false
	for _, model := range resp.GetModels() {
		if model.GetModelId() == "gpt-audio" {
			foundGPTAudio = true
			break
		}
	}
	if !foundGPTAudio {
		t.Fatalf("expected openai catalog model gpt-audio in response")
	}
	if got := hits.Load(); got != 0 {
		t.Fatalf("expected zero upstream calls for YAML-only model listing, got %d", got)
	}
}
func TestListConnectorModelsDashScopeIncludesRepresentativeImageModels(t *testing.T) {
	svc := newTestService(t)
	ctx := userContext("user-1")
	created, err := svc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{
		Provider: "dashscope",
		ApiKey:   "managed-key",
	})
	if err != nil {
		t.Fatalf("CreateConnector: %v", err)
	}
	connectorID := created.GetConnector().GetConnectorId()
	if connectorID == "" {
		t.Fatalf("expected connector id")
	}
	resp, err := svc.ListConnectorModels(ctx, &runtimev1.ListConnectorModelsRequest{
		ConnectorId: connectorID,
		PageSize:    200,
	})
	if err != nil {
		t.Fatalf("ListConnectorModels: %v", err)
	}
	if len(resp.GetModels()) == 0 {
		t.Fatalf("expected dashscope catalog-derived model list")
	}
	expectedImageModels := map[string]bool{"qwen-image-2.0-pro": true, "qwen-image-2.0": true, "z-image-turbo": true, "wan2.6-t2i": true, "wan2.7-image-pro": true, "wan2.7-image": true, "flux-schnell": true, "flux-dev": true, "flux-merged": true}
	foundImageModels := map[string]bool{}
	foundVoiceWorkflowCapabilities := map[string]string{}
	for _, model := range resp.GetModels() {
		modelID := strings.TrimSpace(model.GetModelId())
		for _, capability := range model.GetCapabilities() {
			switch strings.TrimSpace(capability) {
			case "image.generate":
				if !expectedImageModels[modelID] {
					continue
				}
				foundImageModels[modelID] = true
			case "voice_workflow.voice_clone", "voice_workflow.voice_design":
				foundVoiceWorkflowCapabilities[modelID] = strings.TrimSpace(capability)
			}
		}
	}
	if len(foundImageModels) != len(expectedImageModels) {
		t.Fatalf("expected representative dashscope image models %v, found %v", expectedImageModels, foundImageModels)
	}
	if foundVoiceWorkflowCapabilities["qwen3-tts-vc"] != "voice_workflow.voice_clone" {
		t.Fatalf("expected qwen3-tts-vc voice_workflow.voice_clone, found %q", foundVoiceWorkflowCapabilities["qwen3-tts-vc"])
	}
	if foundVoiceWorkflowCapabilities["qwen3-tts-vd"] != "voice_workflow.voice_design" {
		t.Fatalf("expected qwen3-tts-vd voice_workflow.voice_design, found %q", foundVoiceWorkflowCapabilities["qwen3-tts-vd"])
	}
}
func TestListConnectorModelsForceRefreshIsNoOpAndDoesNotOutbound(t *testing.T) {
	svc := newTestService(t)
	ctx := userContext("user-1")
	var hits atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		http.NotFound(w, r)
	}))
	t.Cleanup(server.Close)
	svc.SetCloudProvider(nimillm.NewCloudProvider(nimillm.CloudConfig{
		Providers: map[string]nimillm.ProviderCredentials{
			"openai": {BaseURL: server.URL, APIKey: "cloud-key"},
		},
		AllowLoopbackEndpoint: true,
	}, nil, nil))
	created, err := svc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{
		Provider: "openai",
		Endpoint: server.URL,
		ApiKey:   "managed-key",
	})
	if err != nil {
		t.Fatalf("CreateConnector: %v", err)
	}
	connectorID := created.GetConnector().GetConnectorId()
	first, err := svc.ListConnectorModels(ctx, &runtimev1.ListConnectorModelsRequest{
		ConnectorId: connectorID,
		PageSize:    200,
	})
	if err != nil {
		t.Fatalf("ListConnectorModels first: %v", err)
	}
	refreshed, err := svc.ListConnectorModels(ctx, &runtimev1.ListConnectorModelsRequest{
		ConnectorId:  connectorID,
		PageSize:     200,
		ForceRefresh: true,
	})
	if err != nil {
		t.Fatalf("ListConnectorModels force_refresh: %v", err)
	}
	if len(first.GetModels()) != len(refreshed.GetModels()) {
		t.Fatalf("force_refresh should return same catalog-derived model count: first=%d refreshed=%d", len(first.GetModels()), len(refreshed.GetModels()))
	}
	if got := hits.Load(); got != 0 {
		t.Fatalf("force_refresh must not trigger outbound discovery, got %d upstream calls", got)
	}
}
func TestListConnectorModelsDynamicProviderForceRefreshIsNoOp(t *testing.T) {
	svc := newTestService(t)
	ctx := userContext("user-1")
	var hits atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"openai/gpt-4.1","architecture":{"input_modalities":["text"],"output_modalities":["text"],"modality":"text->text"}},{"id":"openai/text-embedding-3-large","architecture":{"input_modalities":["text"],"output_modalities":["embeddings"],"modality":"text->embeddings"}}]}`))
	}))
	t.Cleanup(server.Close)
	svc.SetCloudProvider(nimillm.NewCloudProvider(nimillm.CloudConfig{
		Providers: map[string]nimillm.ProviderCredentials{
			"openrouter": {BaseURL: server.URL, APIKey: "cloud-key"},
		},
		HTTPTimeout:           5 * time.Second,
		AllowLoopbackEndpoint: true,
	}, nil, nil))
	created, err := svc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{
		Provider: "openrouter",
		Endpoint: server.URL,
		ApiKey:   "managed-key",
	})
	if err != nil {
		t.Fatalf("CreateConnector: %v", err)
	}
	connectorID := created.GetConnector().GetConnectorId()
	first, err := svc.ListConnectorModels(ctx, &runtimev1.ListConnectorModelsRequest{
		ConnectorId: connectorID,
		PageSize:    200,
	})
	if err != nil {
		t.Fatalf("ListConnectorModels first: %v", err)
	}
	if got := hits.Load(); got != 0 {
		t.Fatalf("expected dynamic provider ListConnectorModels to use snapshot without outbound, got %d upstream calls", got)
	}
	second, err := svc.ListConnectorModels(ctx, &runtimev1.ListConnectorModelsRequest{
		ConnectorId: connectorID,
		PageSize:    200,
	})
	if err != nil {
		t.Fatalf("ListConnectorModels second: %v", err)
	}
	if len(second.GetModels()) != len(first.GetModels()) {
		t.Fatalf("expected stable catalog-derived model count on second call")
	}
	if got := hits.Load(); got != 0 {
		t.Fatalf("expected second snapshot read to avoid outbound, got %d upstream calls", got)
	}
	refreshed, err := svc.ListConnectorModels(ctx, &runtimev1.ListConnectorModelsRequest{
		ConnectorId:  connectorID,
		PageSize:     200,
		ForceRefresh: true,
	})
	if err != nil {
		t.Fatalf("ListConnectorModels force_refresh: %v", err)
	}
	if got := hits.Load(); got != 0 {
		t.Fatalf("force_refresh must not trigger dynamic discovery, got %d upstream calls", got)
	}
	if len(refreshed.GetModels()) != len(first.GetModels()) {
		t.Fatalf("force_refresh should preserve catalog-derived model count: first=%d refreshed=%d", len(first.GetModels()), len(refreshed.GetModels()))
	}
}
func TestListConnectorModelsFireworksUsesSnapshotWithoutAccountModelsEndpoint(t *testing.T) {
	svc := newTestService(t)
	ctx := userContext("user-1")
	var hits atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		if r.URL.Path != "/v1/accounts/fireworks/models" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"models":[{"name":"accounts/fireworks/models/deepseek-v3","displayName":"DeepSeek V3","state":"READY","supportsImageInput":false,"baseModelDetails":{"modelType":"chat"}},{"name":"accounts/fireworks/models/qwen3-vl","displayName":"Qwen3 VL","state":"READY","supportsImageInput":true,"baseModelDetails":{"modelType":"chat"}}]}`))
	}))
	t.Cleanup(server.Close)
	svc.SetCloudProvider(nimillm.NewCloudProvider(nimillm.CloudConfig{
		Providers: map[string]nimillm.ProviderCredentials{
			"fireworks": {BaseURL: server.URL + "/inference/v1", APIKey: "cloud-key"},
		},
		HTTPTimeout:           5 * time.Second,
		AllowLoopbackEndpoint: true,
	}, nil, nil))
	created, err := svc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{
		Provider: "fireworks",
		Endpoint: server.URL + "/inference/v1",
		ApiKey:   "managed-key",
	})
	if err != nil {
		t.Fatalf("CreateConnector: %v", err)
	}
	connectorID := created.GetConnector().GetConnectorId()
	if _, err := svc.ListConnectorModels(ctx, &runtimev1.ListConnectorModelsRequest{
		ConnectorId: connectorID,
		PageSize:    200,
	}); err != nil {
		t.Fatalf("ListConnectorModels: %v", err)
	}
	if got := hits.Load(); got != 0 {
		t.Fatalf("expected fireworks ListConnectorModels to use snapshot without account models probe, got %d upstream calls", got)
	}
}
func TestTestConnectorRemoteStillProbesOutbound(t *testing.T) {
	svc := newTestService(t)
	ctx := userContext("user-1")
	var hits atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			http.NotFound(w, r)
			return
		}
		hits.Add(1)
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(server.Close)
	svc.SetCloudProvider(nimillm.NewCloudProvider(nimillm.CloudConfig{
		Providers: map[string]nimillm.ProviderCredentials{
			"openai": {BaseURL: server.URL, APIKey: "cloud-key"},
		},
		HTTPTimeout:           5 * time.Second,
		AllowLoopbackEndpoint: true,
	}, nil, nil))
	created, err := svc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{
		Provider: "openai",
		Endpoint: server.URL,
		ApiKey:   "managed-key",
	})
	if err != nil {
		t.Fatalf("CreateConnector: %v", err)
	}
	resp, err := svc.TestConnector(ctx, &runtimev1.TestConnectorRequest{
		ConnectorId: created.GetConnector().GetConnectorId(),
	})
	if err != nil {
		t.Fatalf("TestConnector: %v", err)
	}
	if !resp.GetAck().GetOk() {
		t.Fatalf("expected probe success")
	}
	if got := hits.Load(); got != 1 {
		t.Fatalf("expected exactly one outbound probe during TestConnector, got %d", got)
	}
}
func TestTestConnectorRemotePropagatesProviderAuthFailure(t *testing.T) {
	svc := newTestService(t)
	ctx := userContext("user-1")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = io.WriteString(w, `{"error":{"message":"API key not valid. Please pass a valid API key."}}`)
	}))
	t.Cleanup(server.Close)
	svc.SetCloudProvider(nimillm.NewCloudProvider(nimillm.CloudConfig{
		Providers: map[string]nimillm.ProviderCredentials{
			"openai": {BaseURL: server.URL, APIKey: "cloud-key"},
		},
		HTTPTimeout:           5 * time.Second,
		AllowLoopbackEndpoint: true,
	}, nil, nil))
	created, err := svc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{
		Provider: "openai",
		Endpoint: server.URL,
		ApiKey:   "managed-key",
	})
	if err != nil {
		t.Fatalf("CreateConnector: %v", err)
	}
	resp, err := svc.TestConnector(ctx, &runtimev1.TestConnectorRequest{
		ConnectorId: created.GetConnector().GetConnectorId(),
	})
	if err != nil {
		t.Fatalf("TestConnector: %v", err)
	}
	if resp.GetAck().GetOk() {
		t.Fatalf("expected probe failure")
	}
	if resp.GetAck().GetReasonCode() != runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED {
		t.Fatalf("expected AI_PROVIDER_AUTH_FAILED, got %v", resp.GetAck().GetReasonCode())
	}
}
func TestTestConnectorOpenAICodexUsesOAuthHeaders(t *testing.T) {
	svc := newTestService(t)
	ctx := userContext("user-1")
	var capturedOriginator string
	var capturedAccountID string
	var capturedClientVersion string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/backend-api/codex/models" {
			http.NotFound(w, r)
			return
		}
		capturedOriginator = r.Header.Get("originator")
		capturedAccountID = r.Header.Get("ChatGPT-Account-ID")
		capturedClientVersion = r.URL.Query().Get("client_version")
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(server.Close)
	svc.SetCloudProvider(nimillm.NewCloudProvider(nimillm.CloudConfig{
		Providers: map[string]nimillm.ProviderCredentials{
			"openai_codex": {BaseURL: server.URL + "/backend-api/codex", APIKey: "cloud-key"},
		},
		HTTPTimeout:           5 * time.Second,
		AllowLoopbackEndpoint: true,
	}, nil, nil))
	credentialPayload, err := json.Marshal(map[string]any{
		"access_token": codexProbeJWTForTest(t, "acct_probe_123"),
	})
	if err != nil {
		t.Fatalf("marshal credential payload: %v", err)
	}
	created, err := svc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{
		Provider:            "openai_codex",
		Endpoint:            server.URL + "/backend-api/codex",
		AuthKind:            runtimev1.ConnectorAuthKind_CONNECTOR_AUTH_KIND_OAUTH_MANAGED,
		ProviderAuthProfile: "openai_codex",
		CredentialJson:      string(credentialPayload),
	})
	if err != nil {
		t.Fatalf("CreateConnector: %v", err)
	}
	resp, err := svc.TestConnector(ctx, &runtimev1.TestConnectorRequest{
		ConnectorId: created.GetConnector().GetConnectorId(),
	})
	if err != nil {
		t.Fatalf("TestConnector: %v", err)
	}
	if !resp.GetAck().GetOk() {
		t.Fatalf("expected probe success, got reason=%v", resp.GetAck().GetReasonCode())
	}
	if capturedOriginator != "codex_cli_rs" {
		t.Fatalf("expected codex originator header, got %q", capturedOriginator)
	}
	if capturedAccountID != "acct_probe_123" {
		t.Fatalf("expected codex account header, got %q", capturedAccountID)
	}
	if capturedClientVersion != "1.0.0" {
		t.Fatalf("expected codex client_version query param, got %q", capturedClientVersion)
	}
}
func TestTestConnectorQwenOAuthUsesBearerTokenThroughOpenAICompatibleProvider(t *testing.T) {
	svc := newTestService(t)
	ctx := userContext("user-1")
	var capturedAuthorization string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			http.NotFound(w, r)
			return
		}
		capturedAuthorization = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"object":"list","data":[{"id":"qwen-max","object":"model"}]}`)
	}))
	t.Cleanup(server.Close)
	svc.SetCloudProvider(nimillm.NewCloudProvider(nimillm.CloudConfig{
		Providers: map[string]nimillm.ProviderCredentials{
			"openai_compatible": {BaseURL: server.URL + "/v1", APIKey: "cloud-key"},
		},
		HTTPTimeout:           5 * time.Second,
		AllowLoopbackEndpoint: true,
	}, nil, nil))
	created, err := svc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{
		Provider:            "openai_compatible",
		Endpoint:            server.URL + "/v1",
		AuthKind:            runtimev1.ConnectorAuthKind_CONNECTOR_AUTH_KIND_OAUTH_MANAGED,
		ProviderAuthProfile: "qwen_oauth",
		CredentialJson:      `{"access_token":"qwen-oauth-token"}`,
	})
	if err != nil {
		t.Fatalf("CreateConnector: %v", err)
	}
	resp, err := svc.TestConnector(ctx, &runtimev1.TestConnectorRequest{
		ConnectorId: created.GetConnector().GetConnectorId(),
	})
	if err != nil {
		t.Fatalf("TestConnector: %v", err)
	}
	if !resp.GetAck().GetOk() {
		t.Fatalf("expected probe success, got reason=%v", resp.GetAck().GetReasonCode())
	}
	if capturedAuthorization != "Bearer qwen-oauth-token" {
		t.Fatalf("expected bearer oauth token, got %q", capturedAuthorization)
	}
}
func TestTestConnectorSystemOwnedRemoteFailsClosedWithoutCloudProvider(t *testing.T) {
	svc := newTestService(t)
	if _, err := svc.store.Create(ConnectorRecord{
		ConnectorID: "sys-openai",
		Kind:        runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
		OwnerType:   runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_SYSTEM,
		OwnerID:     "system",
		Provider:    "openai",
		Status:      runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
	}, "system-key"); err != nil {
		t.Fatalf("create system connector: %v", err)
	}
	resp, err := svc.TestConnector(context.Background(), &runtimev1.TestConnectorRequest{
		ConnectorId: "sys-openai",
	})
	if err != nil {
		t.Fatalf("TestConnector: %v", err)
	}
	if resp.GetAck().GetOk() {
		t.Fatalf("expected system-owned remote connector probe to fail closed without cloud provider")
	}
	if resp.GetAck().GetReasonCode() != runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE {
		t.Fatalf("expected AI_PROVIDER_UNAVAILABLE, got %v", resp.GetAck().GetReasonCode())
	}
}
func TestEnsureLocalConnectors(t *testing.T) {
	store := newTestStore(t)
	if err := EnsureLocalConnectors(store); err != nil {
		t.Fatalf("EnsureLocalConnectors: %v", err)
	}
	records, _ := store.Load()
	if len(records) != 6 {
		t.Fatalf("expected 6 local connectors, got %d", len(records))
	}
	// Running again should be idempotent
	if err := EnsureLocalConnectors(store); err != nil {
		t.Fatalf("EnsureLocalConnectors second run: %v", err)
	}
	records2, _ := store.Load()
	if len(records2) != 6 {
		t.Fatalf("expected still 6 connectors, got %d", len(records2))
	}
}
func TestTestConnectorLocalUsesRuntimeAvailability(t *testing.T) {
	svc := newTestService(t)
	ctx := userContext("user-1")
	if err := EnsureLocalConnectors(svc.store); err != nil {
		t.Fatalf("EnsureLocalConnectors: %v", err)
	}
	localList, err := svc.ListConnectors(ctx, &runtimev1.ListConnectorsRequest{KindFilter: runtimev1.ConnectorKind_CONNECTOR_KIND_LOCAL_MODEL})
	if err != nil {
		t.Fatalf("ListConnectors: %v", err)
	}
	llmConnectorID := ""
	for _, connectorItem := range localList.GetConnectors() {
		if connectorItem.GetLocalCategory() == runtimev1.LocalConnectorCategory_LOCAL_CONNECTOR_CATEGORY_LLM {
			llmConnectorID = connectorItem.GetConnectorId()
			break
		}
	}
	if llmConnectorID == "" {
		t.Fatalf("expected LLM local connector")
	}
	nilListerResp, err := svc.TestConnector(ctx, &runtimev1.TestConnectorRequest{ConnectorId: llmConnectorID})
	if err != nil {
		t.Fatalf("TestConnector nil local lister: %v", err)
	}
	if nilListerResp.GetAck().GetOk() {
		t.Fatalf("expected local connector unavailable when local model lister is absent")
	}
	if nilListerResp.GetAck().GetReasonCode() != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE {
		t.Fatalf("expected AI_LOCAL_MODEL_UNAVAILABLE, got %v", nilListerResp.GetAck().GetReasonCode())
	}
	svc.SetLocalModelLister(&fakeLocalModelLister{
		models: []*runtimev1.LocalAssetRecord{
			{AssetId: "image-only", Capabilities: []string{"image.generate"}, Status: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE},
		},
	})
	emptyResp, err := svc.TestConnector(ctx, &runtimev1.TestConnectorRequest{ConnectorId: llmConnectorID})
	if err != nil {
		t.Fatalf("TestConnector empty local availability: %v", err)
	}
	if emptyResp.GetAck().GetOk() {
		t.Fatalf("expected local connector unavailable without matching ACTIVE models")
	}
	if emptyResp.GetAck().GetReasonCode() != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE {
		t.Fatalf("expected AI_LOCAL_MODEL_UNAVAILABLE, got %v", emptyResp.GetAck().GetReasonCode())
	}
	svc.SetLocalModelLister(&fakeLocalModelLister{
		models: []*runtimev1.LocalAssetRecord{
			{AssetId: "chat-model", Capabilities: []string{"chat"}, Status: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE},
		},
	})
	okResp, err := svc.TestConnector(ctx, &runtimev1.TestConnectorRequest{ConnectorId: llmConnectorID})
	if err != nil {
		t.Fatalf("TestConnector local available: %v", err)
	}
	if !okResp.GetAck().GetOk() {
		t.Fatalf("expected local connector to be available")
	}
}
func TestListConnectorModelsLocalUsesRuntimeModels(t *testing.T) {
	svc := newTestService(t)
	ctx := userContext("user-1")
	if err := EnsureLocalConnectors(svc.store); err != nil {
		t.Fatalf("EnsureLocalConnectors: %v", err)
	}
	localList, err := svc.ListConnectors(ctx, &runtimev1.ListConnectorsRequest{KindFilter: runtimev1.ConnectorKind_CONNECTOR_KIND_LOCAL_MODEL})
	if err != nil {
		t.Fatalf("ListConnectors: %v", err)
	}
	llmConnectorID := ""
	for _, connectorItem := range localList.GetConnectors() {
		if connectorItem.GetLocalCategory() == runtimev1.LocalConnectorCategory_LOCAL_CONNECTOR_CATEGORY_LLM {
			llmConnectorID = connectorItem.GetConnectorId()
			break
		}
	}
	if llmConnectorID == "" {
		t.Fatalf("expected LLM local connector")
	}
	svc.SetLocalModelLister(&fakeLocalModelLister{
		models: []*runtimev1.LocalAssetRecord{
			{AssetId: "chat-model", Capabilities: []string{"chat"}, Status: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE},
			{AssetId: "image-model", Capabilities: []string{"image.generate"}, Status: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE},
			{AssetId: "chat-installed", Capabilities: []string{"chat"}, Status: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED},
		},
	})
	resp, err := svc.ListConnectorModels(ctx, &runtimev1.ListConnectorModelsRequest{
		ConnectorId: llmConnectorID,
		PageSize:    20,
	})
	if err != nil {
		t.Fatalf("ListConnectorModels local: %v", err)
	}
	if len(resp.GetModels()) != 1 {
		t.Fatalf("expected 1 active LLM model, got %d", len(resp.GetModels()))
	}
	if resp.GetModels()[0].GetModelId() != "chat-model" {
		t.Fatalf("unexpected local model id: %s", resp.GetModels()[0].GetModelId())
	}
}
func TestListConnectorModelsSystemOwnedRemoteVisibleWithoutCaller(t *testing.T) {
	svc := newTestService(t)
	if _, err := svc.store.Create(ConnectorRecord{
		ConnectorID: "sys-openai",
		Kind:        runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
		OwnerType:   runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_SYSTEM,
		OwnerID:     "system",
		Provider:    "openai",
		Status:      runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
	}, "system-key"); err != nil {
		t.Fatalf("create system connector: %v", err)
	}
	resp, err := svc.ListConnectorModels(context.Background(), &runtimev1.ListConnectorModelsRequest{
		ConnectorId: "sys-openai",
		PageSize:    20,
	})
	if err != nil {
		t.Fatalf("ListConnectorModels: %v", err)
	}
	if len(resp.GetModels()) == 0 {
		t.Fatalf("expected catalog-derived models for system-owned remote connector")
	}
}
