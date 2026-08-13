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
	aicatalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
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
		if model.GetProviderModelId() == "gpt-audio" {
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

func TestListConnectorModelsProjectsRemoteCatalogIdentity(t *testing.T) {
	svc := newTestService(t)
	ctx := userContext("user-1")
	created, err := svc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{
		Provider: "openai",
		ApiKey:   "managed-key",
	})
	if err != nil {
		t.Fatalf("CreateConnector: %v", err)
	}
	resp, err := svc.ListConnectorModels(ctx, &runtimev1.ListConnectorModelsRequest{
		ConnectorId: created.GetConnector().GetConnectorId(),
		PageSize:    200,
	})
	if err != nil {
		t.Fatalf("ListConnectorModels: %v", err)
	}
	var found *runtimev1.ConnectorModelDescriptor
	for _, model := range resp.GetModels() {
		if model.GetProviderModelId() == "gpt-audio" {
			found = model
			break
		}
	}
	if found == nil {
		t.Fatal("expected gpt-audio model")
	}
	if found.GetRemoteModelCatalogId() == "" {
		t.Fatalf("remote_model_catalog_id missing: %#v", found)
	}
	if found.GetModelLabel() != "gpt-audio" {
		t.Fatalf("model_label = %q want %q", found.GetModelLabel(), "gpt-audio")
	}
	if found.GetProvider() != "openai" {
		t.Fatalf("provider = %q", found.GetProvider())
	}
	if found.GetConnectorSnapshotId() == "" || found.GetEndpointProfileId() == "" || found.GetInventorySnapshotId() == "" {
		t.Fatalf("snapshot fields missing: %#v", found)
	}
}

func TestListConnectorModelsCanonicalizesAliasesByExecutableProviderModelID(t *testing.T) {
	svc := newTestService(t)
	ctx := userContext("user-1")
	created, err := svc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{
		Provider: "volcengine",
		ApiKey:   "managed-key",
	})
	if err != nil {
		t.Fatalf("CreateConnector: %v", err)
	}
	resp, err := svc.ListConnectorModels(ctx, &runtimev1.ListConnectorModelsRequest{
		ConnectorId: created.GetConnector().GetConnectorId(),
		PageSize:    200,
	})
	if err != nil {
		t.Fatalf("ListConnectorModels: %v", err)
	}
	const providerModelID = "doubao-seed-2-0-pro-260215"
	var matches []*runtimev1.ConnectorModelDescriptor
	for _, model := range resp.GetModels() {
		if model.GetProviderModelId() == providerModelID {
			matches = append(matches, model)
		}
	}
	if len(matches) != 1 {
		t.Fatalf("provider_model_id %q projected %d descriptors, want 1", providerModelID, len(matches))
	}
	found := matches[0]
	if found.GetModelLabel() != providerModelID {
		t.Fatalf("model_label = %q want canonical catalog model label %q", found.GetModelLabel(), providerModelID)
	}
	if found.GetRemoteModelCatalogId() == "" {
		t.Fatalf("remote_model_catalog_id missing: %#v", found)
	}
}

func TestListConnectorModelsDashScopeVoiceAliasHasOneExecutableTarget(t *testing.T) {
	svc := newTestService(t)
	ctx := userContext("user-1")
	created, err := svc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{
		Provider: "dashscope",
		ApiKey:   "managed-key",
	})
	if err != nil {
		t.Fatalf("CreateConnector: %v", err)
	}
	resp, err := svc.ListConnectorModels(ctx, &runtimev1.ListConnectorModelsRequest{
		ConnectorId: created.GetConnector().GetConnectorId(),
		PageSize:    200,
	})
	if err != nil {
		t.Fatalf("ListConnectorModels: %v", err)
	}
	const providerModelID = "qwen3-tts-vc-2026-01-22"
	var matches []*runtimev1.ConnectorModelDescriptor
	for _, model := range resp.GetModels() {
		if model.GetProviderModelId() == providerModelID {
			matches = append(matches, model)
		}
	}
	if len(matches) != 1 {
		t.Fatalf("provider_model_id %q projected %d descriptors, want 1", providerModelID, len(matches))
	}
	found := matches[0]
	if found.GetModelLabel() != "qwen3-tts-vc" {
		t.Fatalf("model_label = %q want canonical catalog model label qwen3-tts-vc", found.GetModelLabel())
	}
	capabilities := map[string]bool{}
	for _, capability := range found.GetCapabilities() {
		capabilities[strings.TrimSpace(capability)] = true
	}
	if !capabilities["voice.create"] || !capabilities["audio.synthesize"] {
		t.Fatalf("canonical descriptor capabilities = %v", found.GetCapabilities())
	}

	record, ok, err := svc.Store().Get(created.GetConnector().GetConnectorId())
	if err != nil || !ok {
		t.Fatalf("Get connector: ok=%v err=%v", ok, err)
	}
	modelCatalog := svc.modelCatalogResolver()
	models, _, err := modelCatalog.ListModelsForProviderForSubject("user-1", "dashscope")
	if err != nil {
		t.Fatalf("ListModelsForProviderForSubject: %v", err)
	}
	providerRecord := catalogProviderRecordForSubject(modelCatalog, "user-1", "dashscope")
	identities := map[string]remoteModelCatalogIdentity{}
	for _, model := range models {
		if model.Model.ModelID == "qwen3-tts-vc" || model.Model.ModelID == providerModelID {
			identities[model.Model.ModelID] = remoteModelCatalogIdentityForConnector(record, providerRecord, model)
		}
	}
	canonical, canonicalOK := identities["qwen3-tts-vc"]
	alias, aliasOK := identities[providerModelID]
	if !canonicalOK || !aliasOK {
		t.Fatalf("voice catalog identities missing: %v", identities)
	}
	if canonical.remoteModelCatalogID != alias.remoteModelCatalogID {
		t.Fatalf("same executable provider model produced different remote identities: canonical=%q alias=%q", canonical.remoteModelCatalogID, alias.remoteModelCatalogID)
	}
	_, err = ResolveRemoteModelCatalogBinding(modelCatalog, "user-1", record, RemoteModelCatalogRef{
		ConnectorID:          record.ConnectorID,
		RemoteModelCatalogID: canonical.remoteModelCatalogID,
		ProviderModelID:      "qwen3-tts-vc",
		Provider:             "dashscope",
	})
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_REMOTE_MODEL_CATALOG_STALE {
		t.Fatalf("catalog label alias resolved as executable provider identity: reason=%v present=%v err=%v", reason, ok, err)
	}
}

func TestRemoteModelCatalogIdentityIgnoresDuplicateRowProvenance(t *testing.T) {
	record := ConnectorRecord{
		ConnectorID: "connector-1",
		Provider:    "dashscope",
		Endpoint:    "https://dashscope.aliyuncs.com",
		AuthKind:    runtimev1.ConnectorAuthKind_CONNECTOR_AUTH_KIND_API_KEY,
	}
	providerRecord := aicatalog.CatalogProviderRecord{
		Provider:       "dashscope",
		Version:        1,
		CatalogVersion: "2026-01",
	}
	canonical := remoteModelCatalogIdentityForConnector(record, providerRecord, aicatalog.CatalogModelRecord{
		Model:  aicatalog.ModelEntry{ModelID: "qwen3-tts-vc", ApiModelID: "qwen3-tts-vc-2026-01-22"},
		Source: aicatalog.ModelSourceBuiltin,
	})
	overlayAlias := remoteModelCatalogIdentityForConnector(record, providerRecord, aicatalog.CatalogModelRecord{
		Model:      aicatalog.ModelEntry{ModelID: "qwen3-tts-vc-2026-01-22", ApiModelID: "qwen3-tts-vc-2026-01-22"},
		Source:     aicatalog.ModelSourceCustom,
		UserScoped: true,
	})
	if canonical != overlayAlias {
		t.Fatalf("duplicate executable rows produced different target identities: canonical=%+v alias=%+v", canonical, overlayAlias)
	}
}

func TestListConnectorModelsEndpointChangeInvalidatesRemoteCatalogID(t *testing.T) {
	svc := newTestService(t)
	ctx := userContext("user-1")
	firstEndpoint := "https://first.example.test/v1"
	secondEndpoint := "https://second.example.test/v1"
	created, err := svc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{
		Provider: "openai",
		Endpoint: firstEndpoint,
		ApiKey:   "managed-key",
	})
	if err != nil {
		t.Fatalf("CreateConnector: %v", err)
	}
	connectorID := created.GetConnector().GetConnectorId()
	first := connectorModelDescriptorByID(t, svc, ctx, connectorID, "gpt-audio")
	if first.GetRemoteModelCatalogId() == "" {
		t.Fatal("first remote_model_catalog_id missing")
	}
	_, err = svc.UpdateConnector(ctx, &runtimev1.UpdateConnectorRequest{
		ConnectorId: connectorID,
		Endpoint:    &secondEndpoint,
	})
	if err != nil {
		t.Fatalf("UpdateConnector endpoint: %v", err)
	}
	second := connectorModelDescriptorByID(t, svc, ctx, connectorID, "gpt-audio")
	if first.GetRemoteModelCatalogId() == second.GetRemoteModelCatalogId() {
		t.Fatalf("remote_model_catalog_id should change after endpoint update: %q", first.GetRemoteModelCatalogId())
	}
	if first.GetEndpointProfileId() == second.GetEndpointProfileId() {
		t.Fatalf("endpoint_profile_id should change after endpoint update: %q", first.GetEndpointProfileId())
	}
	if first.GetConnectorSnapshotId() == second.GetConnectorSnapshotId() {
		t.Fatalf("connector_snapshot_id should change after endpoint update: %q", first.GetConnectorSnapshotId())
	}
	if first.GetInventorySnapshotId() != second.GetInventorySnapshotId() {
		t.Fatalf("inventory_snapshot_id should not change for endpoint-only update: got %q want %q", second.GetInventorySnapshotId(), first.GetInventorySnapshotId())
	}
}

func connectorModelDescriptorByID(t *testing.T, svc *Service, ctx context.Context, connectorID string, providerModelID string) *runtimev1.ConnectorModelDescriptor {
	t.Helper()
	resp, err := svc.ListConnectorModels(ctx, &runtimev1.ListConnectorModelsRequest{
		ConnectorId: connectorID,
		PageSize:    200,
	})
	if err != nil {
		t.Fatalf("ListConnectorModels: %v", err)
	}
	for _, model := range resp.GetModels() {
		if model.GetProviderModelId() == providerModelID {
			return model
		}
	}
	t.Fatalf("provider model %q not found", providerModelID)
	return nil
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
	foundSpeechSynthesizeModels := map[string]bool{}
	for _, model := range resp.GetModels() {
		modelID := strings.TrimSpace(model.GetModelLabel())
		for _, capability := range model.GetCapabilities() {
			switch strings.TrimSpace(capability) {
			case "audio.synthesize":
				switch modelID {
				case "cosyvoice-v3.5-flash", "qwen3-tts-flash":
					foundSpeechSynthesizeModels[modelID] = true
				}
			case "image.generate":
				if !expectedImageModels[modelID] {
					continue
				}
				foundImageModels[modelID] = true
			case "voice.create":
				foundVoiceWorkflowCapabilities[modelID] = strings.TrimSpace(capability)
			}
		}
	}
	if len(foundImageModels) != len(expectedImageModels) {
		t.Fatalf("expected representative dashscope image models %v, found %v", expectedImageModels, foundImageModels)
	}
	if !foundSpeechSynthesizeModels["cosyvoice-v3.5-flash"] || !foundSpeechSynthesizeModels["qwen3-tts-flash"] {
		t.Fatalf("expected representative dashscope audio.synthesize models, found %v", foundSpeechSynthesizeModels)
	}
	if foundVoiceWorkflowCapabilities["qwen3-tts-vc"] != "voice.create" {
		t.Fatalf("expected qwen3-tts-vc voice.create, found %q", foundVoiceWorkflowCapabilities["qwen3-tts-vc"])
	}
	if foundVoiceWorkflowCapabilities["qwen3-tts-vd"] != "voice.create" {
		t.Fatalf("expected qwen3-tts-vd voice.create, found %q", foundVoiceWorkflowCapabilities["qwen3-tts-vd"])
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
func TestTestConnectorRetiredLocalFailsClosed(t *testing.T) {
	svc := newTestService(t)
	ctx := userContext("user-1")
	_, err := svc.store.Create(ConnectorRecord{
		ConnectorID:          "old-local",
		Kind:                 runtimev1.ConnectorKind(1),
		OwnerType:            runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_SYSTEM,
		OwnerID:              "system",
		Provider:             "local",
		Status:               runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
		RetiredLocalCategory: 1,
	}, "")
	if err != nil {
		t.Fatalf("seed retired local connector: %v", err)
	}
	resp, err := svc.TestConnector(ctx, &runtimev1.TestConnectorRequest{ConnectorId: "old-local"})
	if err != nil {
		t.Fatalf("TestConnector retired local: %v", err)
	}
	if resp.GetAck().GetOk() {
		t.Fatalf("expected retired local connector to fail closed")
	}
	if resp.GetAck().GetReasonCode() != runtimev1.ReasonCode_AI_LOCAL_CONNECTOR_RETIRED {
		t.Fatalf("expected AI_LOCAL_CONNECTOR_RETIRED, got %v", resp.GetAck().GetReasonCode())
	}
}
func TestListConnectorModelsRetiredLocalFailsClosed(t *testing.T) {
	svc := newTestService(t)
	ctx := userContext("user-1")
	_, err := svc.store.Create(ConnectorRecord{
		ConnectorID:          "old-local",
		Kind:                 runtimev1.ConnectorKind(1),
		OwnerType:            runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_SYSTEM,
		OwnerID:              "system",
		Provider:             "local",
		Status:               runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
		RetiredLocalCategory: 1,
	}, "")
	if err != nil {
		t.Fatalf("seed retired local connector: %v", err)
	}
	_, err = svc.ListConnectorModels(ctx, &runtimev1.ListConnectorModelsRequest{
		ConnectorId: "old-local",
		PageSize:    20,
	})
	if err == nil {
		t.Fatalf("expected retired local connector model listing to fail closed")
	}
	st, _ := status.FromError(err)
	if st.Code() != codes.FailedPrecondition {
		t.Fatalf("expected FailedPrecondition, got %v", st.Code())
	}
	if st.Message() != runtimev1.ReasonCode_AI_LOCAL_CONNECTOR_RETIRED.String() {
		t.Fatalf("expected AI_LOCAL_CONNECTOR_RETIRED, got %s", st.Message())
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
