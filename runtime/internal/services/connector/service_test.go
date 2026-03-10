package connector

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	aicatalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/fieldmaskpb"
)

type fakeLocalModelLister struct {
	models []*runtimev1.LocalModelRecord
	err    error
}

func (f *fakeLocalModelLister) ListLocalModels(_ context.Context, req *runtimev1.ListLocalModelsRequest) (*runtimev1.ListLocalModelsResponse, error) {
	if f.err != nil {
		return nil, f.err
	}
	result := make([]*runtimev1.LocalModelRecord, 0, len(f.models))
	for _, model := range f.models {
		if req.GetStatusFilter() != runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNSPECIFIED &&
			model.GetStatus() != req.GetStatusFilter() {
			continue
		}
		result = append(result, model)
	}
	return &runtimev1.ListLocalModelsResponse{Models: result}, nil
}

func newTestService(t *testing.T) *Service {
	t.Helper()
	store := newTestStore(t)
	logger := slog.Default()
	return New(logger, store, nil)
}

func newTestServiceWithModelCatalog(t *testing.T) *Service {
	t.Helper()
	svc := newTestService(t)
	resolver, err := aicatalog.NewResolver(aicatalog.ResolverConfig{
		CustomDir: filepath.Join(t.TempDir(), "provider-catalog"),
	})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}
	svc.SetModelCatalogResolver(resolver)
	return svc
}

func userContext(userID string) context.Context {
	return authn.WithIdentity(context.Background(), &authn.Identity{SubjectUserID: userID})
}

func TestCreateConnector(t *testing.T) {
	svc := newTestService(t)
	ctx := userContext("user-1")

	resp, err := svc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{
		Provider: "openai",
		Endpoint: "https://api.openai.com/v1",
		Label:    "Test OpenAI",
		ApiKey:   "sk-test",
	})
	if err != nil {
		t.Fatalf("CreateConnector: %v", err)
	}
	if resp.Connector.Provider != "openai" {
		t.Errorf("expected provider openai, got %s", resp.Connector.Provider)
	}
	if resp.Connector.Kind != runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED {
		t.Errorf("expected REMOTE_MANAGED kind")
	}
	if !resp.Connector.HasCredential {
		t.Error("expected has_credential=true")
	}
}

func TestCreateConnectorMissingAPIKey(t *testing.T) {
	svc := newTestService(t)
	ctx := userContext("user-1")

	_, err := svc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{
		Provider: "openai",
	})
	if err == nil {
		t.Fatal("expected error for missing api_key")
	}
	st, _ := status.FromError(err)
	if st.Code() != codes.InvalidArgument {
		t.Errorf("expected InvalidArgument, got %v", st.Code())
	}
}

func TestCreateConnectorDefaultEndpoint(t *testing.T) {
	svc := newTestService(t)
	ctx := userContext("user-1")

	resp, err := svc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{
		Provider: "gemini",
		ApiKey:   "test-key",
	})
	if err != nil {
		t.Fatalf("CreateConnector: %v", err)
	}
	if resp.Connector.Endpoint != "https://generativelanguage.googleapis.com/v1beta/openai" {
		t.Errorf("expected default gemini endpoint, got %s", resp.Connector.Endpoint)
	}
}

func TestCreateConnectorLimit(t *testing.T) {
	svc := newTestService(t)
	ctx := userContext("user-1")

	// Create 128 connectors
	for i := 0; i < maxConnectorsPerUser; i++ {
		_, err := svc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{
			Provider: "openai",
			ApiKey:   "key",
		})
		if err != nil {
			t.Fatalf("CreateConnector %d: %v", i, err)
		}
	}

	// 129th should fail
	_, err := svc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{
		Provider: "openai",
		ApiKey:   "key",
	})
	if err == nil {
		t.Fatal("expected limit exceeded error")
	}
	st, _ := status.FromError(err)
	if st.Code() != codes.ResourceExhausted {
		t.Errorf("expected ResourceExhausted, got %v", st.Code())
	}
}

func TestGetConnectorNotFound(t *testing.T) {
	svc := newTestService(t)
	ctx := context.Background()

	_, err := svc.GetConnector(ctx, &runtimev1.GetConnectorRequest{
		ConnectorId: "nonexistent",
	})
	if err == nil {
		t.Fatal("expected not found")
	}
	st, _ := status.FromError(err)
	if st.Code() != codes.NotFound {
		t.Errorf("expected NotFound, got %v", st.Code())
	}
}

func TestGetConnectorOwnerMismatch(t *testing.T) {
	svc := newTestService(t)
	user1Ctx := userContext("user-1")
	user2Ctx := userContext("user-2")

	resp, _ := svc.CreateConnector(user1Ctx, &runtimev1.CreateConnectorRequest{
		Provider: "openai",
		ApiKey:   "key",
	})
	connID := resp.Connector.ConnectorId

	// Different owner should see NOT_FOUND (information hiding)
	_, err := svc.GetConnector(user2Ctx, &runtimev1.GetConnectorRequest{
		ConnectorId: connID,
	})
	if err == nil {
		t.Fatal("expected not found for owner mismatch")
	}
	st, _ := status.FromError(err)
	if st.Code() != codes.NotFound {
		t.Errorf("expected NotFound, got %v", st.Code())
	}
}

func TestListConnectorsFiltering(t *testing.T) {
	svc := newTestService(t)
	user1Ctx := userContext("user-1")
	user2Ctx := userContext("user-2")

	// Ensure local connectors exist
	if err := EnsureLocalConnectors(svc.store); err != nil {
		t.Fatalf("EnsureLocalConnectors: %v", err)
	}

	// Create remote connectors for different users
	svc.CreateConnector(user1Ctx, &runtimev1.CreateConnectorRequest{
		Provider: "openai",
		ApiKey:   "key",
	})
	svc.CreateConnector(user2Ctx, &runtimev1.CreateConnectorRequest{
		Provider: "gemini",
		ApiKey:   "key",
	})

	// List for user-1: should see 6 local + 1 remote
	resp, err := svc.ListConnectors(user1Ctx, &runtimev1.ListConnectorsRequest{})
	if err != nil {
		t.Fatalf("ListConnectors: %v", err)
	}
	localCount := 0
	remoteCount := 0
	for _, c := range resp.Connectors {
		if c.Kind == runtimev1.ConnectorKind_CONNECTOR_KIND_LOCAL_MODEL {
			localCount++
		} else {
			remoteCount++
		}
	}
	if localCount != 6 {
		t.Errorf("expected 6 local connectors, got %d", localCount)
	}
	if remoteCount != 1 {
		t.Errorf("expected 1 remote connector for user-1, got %d", remoteCount)
	}
}

func TestUpdateConnector(t *testing.T) {
	svc := newTestService(t)
	ctx := userContext("user-1")

	resp, _ := svc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{
		Provider: "openai",
		ApiKey:   "key",
		Label:    "Old",
	})
	connID := resp.Connector.ConnectorId

	updated, err := svc.UpdateConnector(ctx, &runtimev1.UpdateConnectorRequest{
		ConnectorId: connID,
		Label:       proto.String("New"),
		UpdateMask:  &fieldmaskpb.FieldMask{Paths: []string{"label"}},
	})
	if err != nil {
		t.Fatalf("UpdateConnector: %v", err)
	}
	if updated.Connector.Label != "New" {
		t.Errorf("expected label 'New', got %q", updated.Connector.Label)
	}
}

func TestUpdateConnectorNoChanges(t *testing.T) {
	svc := newTestService(t)
	ctx := userContext("user-1")

	resp, _ := svc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{
		Provider: "openai",
		ApiKey:   "key",
	})
	connID := resp.Connector.ConnectorId

	_, err := svc.UpdateConnector(ctx, &runtimev1.UpdateConnectorRequest{
		ConnectorId: connID,
	})
	if err == nil {
		t.Fatal("expected error for no changes")
	}
}

func TestUpdateConnectorInfersUpdateMaskFromOptionalFields(t *testing.T) {
	svc := newTestService(t)
	ctx := userContext("user-1")

	resp, _ := svc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{
		Provider: "openai",
		ApiKey:   "key",
		Label:    "Old",
	})
	connID := resp.Connector.ConnectorId

	updated, err := svc.UpdateConnector(ctx, &runtimev1.UpdateConnectorRequest{
		ConnectorId: connID,
		Label:       proto.String("New"),
	})
	if err != nil {
		t.Fatalf("UpdateConnector: %v", err)
	}
	if updated.GetConnector().GetLabel() != "New" {
		t.Fatalf("expected inferred update_mask to update label, got %q", updated.GetConnector().GetLabel())
	}
}

func TestUpdateConnectorRejectsUnknownUpdateMaskPath(t *testing.T) {
	svc := newTestService(t)
	ctx := userContext("user-1")

	resp, _ := svc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{
		Provider: "openai",
		ApiKey:   "key",
	})
	connID := resp.GetConnector().GetConnectorId()

	_, err := svc.UpdateConnector(ctx, &runtimev1.UpdateConnectorRequest{
		ConnectorId: connID,
		UpdateMask:  &fieldmaskpb.FieldMask{Paths: []string{"unknown_field"}},
	})
	if err == nil {
		t.Fatal("expected invalid_argument for unknown update_mask path")
	}
	st, _ := status.FromError(err)
	if st.Code() != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument, got %v", st.Code())
	}
}

func TestUpdateConnectorRejectsMaskPathWithoutOptionalValue(t *testing.T) {
	svc := newTestService(t)
	ctx := userContext("user-1")

	resp, _ := svc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{
		Provider: "openai",
		ApiKey:   "key",
	})
	connID := resp.GetConnector().GetConnectorId()

	_, err := svc.UpdateConnector(ctx, &runtimev1.UpdateConnectorRequest{
		ConnectorId: connID,
		UpdateMask:  &fieldmaskpb.FieldMask{Paths: []string{"label"}},
	})
	if err == nil {
		t.Fatal("expected invalid_argument when label path is set without label optional value")
	}
	st, _ := status.FromError(err)
	if st.Code() != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument, got %v", st.Code())
	}
}

func TestUpdateLocalConnectorImmutable(t *testing.T) {
	svc := newTestService(t)
	ctx := userContext("user-1")

	if err := EnsureLocalConnectors(svc.store); err != nil {
		t.Fatalf("EnsureLocalConnectors: %v", err)
	}
	list, _ := svc.ListConnectors(ctx, &runtimev1.ListConnectorsRequest{})
	var localID string
	for _, c := range list.Connectors {
		if c.Kind == runtimev1.ConnectorKind_CONNECTOR_KIND_LOCAL_MODEL {
			localID = c.ConnectorId
			break
		}
	}

	_, err := svc.UpdateConnector(ctx, &runtimev1.UpdateConnectorRequest{
		ConnectorId: localID,
		Label:       proto.String("Hacked"),
		UpdateMask:  &fieldmaskpb.FieldMask{Paths: []string{"label"}},
	})
	if err == nil {
		t.Fatal("expected immutable error for local connector")
	}
	st, _ := status.FromError(err)
	if st.Code() != codes.InvalidArgument {
		t.Errorf("expected InvalidArgument, got %v", st.Code())
	}
}

func TestDeleteConnector(t *testing.T) {
	svc := newTestService(t)
	ctx := userContext("user-1")

	resp, _ := svc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{
		Provider: "openai",
		ApiKey:   "key",
	})
	connID := resp.Connector.ConnectorId

	delResp, err := svc.DeleteConnector(ctx, &runtimev1.DeleteConnectorRequest{
		ConnectorId: connID,
	})
	if err != nil {
		t.Fatalf("DeleteConnector: %v", err)
	}
	if !delResp.Ack.Ok {
		t.Error("expected ack.ok=true")
	}

	// Verify deleted
	_, err = svc.GetConnector(ctx, &runtimev1.GetConnectorRequest{ConnectorId: connID})
	st, _ := status.FromError(err)
	if st.Code() != codes.NotFound {
		t.Errorf("expected NotFound after delete, got %v", st.Code())
	}
}

func TestListConnectorsPageSizeClampTo200(t *testing.T) {
	svc := newTestService(t)
	ctx := userContext("user-1")

	// Create >100 connectors to validate page_size clamping behavior.
	for i := 0; i < 120; i++ {
		_, err := svc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{
			Provider: "openai",
			ApiKey:   "key",
		})
		if err != nil {
			t.Fatalf("CreateConnector %d: %v", i, err)
		}
	}

	resp, err := svc.ListConnectors(ctx, &runtimev1.ListConnectorsRequest{
		PageSize: 999,
	})
	if err != nil {
		t.Fatalf("ListConnectors: %v", err)
	}
	if len(resp.GetConnectors()) != 120 {
		t.Fatalf("expected page_size clamp to return all 120 items (<=200 max), got %d", len(resp.GetConnectors()))
	}
	if resp.GetNextPageToken() != "" {
		t.Fatalf("expected no next page token when all items fit in clamped page")
	}
}

func TestDeleteLocalConnectorForbidden(t *testing.T) {
	svc := newTestService(t)
	ctx := userContext("user-1")

	if err := EnsureLocalConnectors(svc.store); err != nil {
		t.Fatalf("EnsureLocalConnectors: %v", err)
	}
	list, _ := svc.ListConnectors(ctx, &runtimev1.ListConnectorsRequest{})
	var localID string
	for _, c := range list.Connectors {
		if c.Kind == runtimev1.ConnectorKind_CONNECTOR_KIND_LOCAL_MODEL {
			localID = c.ConnectorId
			break
		}
	}

	_, err := svc.DeleteConnector(ctx, &runtimev1.DeleteConnectorRequest{
		ConnectorId: localID,
	})
	if err == nil {
		t.Fatal("expected error deleting local connector")
	}
}

func TestDeleteConnectorIdempotent(t *testing.T) {
	svc := newTestService(t)
	ctx := userContext("user-1")

	resp, err := svc.DeleteConnector(ctx, &runtimev1.DeleteConnectorRequest{
		ConnectorId: "nonexistent",
	})
	if err != nil {
		t.Fatalf("DeleteConnector nonexistent: %v", err)
	}
	if !resp.Ack.Ok {
		t.Error("expected ack.ok=true for idempotent delete")
	}
}

func TestTestConnectorNotFound(t *testing.T) {
	svc := newTestService(t)
	ctx := context.Background()

	resp, err := svc.TestConnector(ctx, &runtimev1.TestConnectorRequest{
		ConnectorId: "nonexistent",
	})
	if err != nil {
		t.Fatalf("TestConnector: %v", err)
	}
	if resp.Ack.Ok {
		t.Error("expected ack.ok=false for not found")
	}
	if resp.Ack.ReasonCode != runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND {
		t.Errorf("expected AI_CONNECTOR_NOT_FOUND, got %v", resp.Ack.ReasonCode)
	}
}

func TestTestConnectorDisabled(t *testing.T) {
	svc := newTestService(t)
	ctx := userContext("user-1")

	resp, _ := svc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{
		Provider: "openai",
		ApiKey:   "key",
	})
	connID := resp.Connector.ConnectorId

	// Disable it
	disabled := runtimev1.ConnectorStatus_CONNECTOR_STATUS_DISABLED
	svc.store.Update(connID, ConnectorMutations{Status: &disabled})

	testResp, err := svc.TestConnector(ctx, &runtimev1.TestConnectorRequest{
		ConnectorId: connID,
	})
	if err != nil {
		t.Fatalf("TestConnector: %v", err)
	}
	if testResp.Ack.Ok {
		t.Error("expected ack.ok=false for disabled")
	}
	if testResp.Ack.ReasonCode != runtimev1.ReasonCode_AI_CONNECTOR_DISABLED {
		t.Errorf("expected AI_CONNECTOR_DISABLED, got %v", testResp.Ack.ReasonCode)
	}
}

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
		HTTPTimeout: 5 * time.Second,
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

	expectedImageModels := map[string]bool{
		"qwen-image-2.0-pro": true,
		"qwen-image-2.0":     true,
		"z-image-turbo":      true,
		"wan2.6-t2i":         true,
		"wan2.5-t2i-preview": true,
		"flux-schnell":       true,
		"flux-dev":           true,
		"flux-merged":        true,
	}
	foundImageModels := map[string]bool{}
	for _, model := range resp.GetModels() {
		modelID := strings.TrimSpace(model.GetModelId())
		if !expectedImageModels[modelID] {
			continue
		}
		for _, capability := range model.GetCapabilities() {
			if strings.TrimSpace(capability) == "image.generate" {
				foundImageModels[modelID] = true
				break
			}
		}
	}

	if len(foundImageModels) != len(expectedImageModels) {
		t.Fatalf("expected representative dashscope image models %v, found %v", expectedImageModels, foundImageModels)
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
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"data":[{"id":"gpt-audio","name":"gpt-audio"}]}`)
	}))
	t.Cleanup(server.Close)

	svc.SetCloudProvider(nimillm.NewCloudProvider(nimillm.CloudConfig{
		Providers: map[string]nimillm.ProviderCredentials{
			"openai": {BaseURL: server.URL, APIKey: "cloud-key"},
		},
		HTTPTimeout: 5 * time.Second,
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

func TestTestConnectorSystemOwnedRemoteVisibleWithoutCaller(t *testing.T) {
	svc := newTestService(t)
	if err := svc.store.Create(ConnectorRecord{
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
	if !resp.GetAck().GetOk() {
		t.Fatalf("expected system-owned remote connector to be visible, got ok=false reason=%v", resp.GetAck().GetReasonCode())
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

	svc.SetLocalModelLister(&fakeLocalModelLister{
		models: []*runtimev1.LocalModelRecord{
			{ModelId: "image-only", Capabilities: []string{"image.generate"}, Status: runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE},
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
		models: []*runtimev1.LocalModelRecord{
			{ModelId: "chat-model", Capabilities: []string{"chat"}, Status: runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE},
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
		models: []*runtimev1.LocalModelRecord{
			{ModelId: "chat-model", Capabilities: []string{"chat"}, Status: runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE},
			{ModelId: "image-model", Capabilities: []string{"image.generate"}, Status: runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE},
			{ModelId: "chat-installed", Capabilities: []string{"chat"}, Status: runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_INSTALLED},
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
	if err := svc.store.Create(ConnectorRecord{
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

func TestListModelCatalogProvidersReturnsBuiltins(t *testing.T) {
	svc := newTestServiceWithModelCatalog(t)

	resp, err := svc.ListModelCatalogProviders(context.Background(), &runtimev1.ListModelCatalogProvidersRequest{})
	if err != nil {
		t.Fatalf("ListModelCatalogProviders: %v", err)
	}
	if len(resp.GetProviders()) == 0 {
		t.Fatalf("expected non-empty providers")
	}
	foundDashScope := false
	for _, entry := range resp.GetProviders() {
		if entry.GetProvider() == "dashscope" {
			foundDashScope = true
		}
		if entry.GetSource() == runtimev1.ModelCatalogProviderSource_MODEL_CATALOG_PROVIDER_SOURCE_UNSPECIFIED {
			t.Fatalf("provider source should not be unspecified")
		}
	}
	if !foundDashScope {
		t.Fatalf("expected dashscope provider entry")
	}
}

func TestUpsertModelCatalogProviderRequiresAuth(t *testing.T) {
	svc := newTestServiceWithModelCatalog(t)

	_, err := svc.UpsertModelCatalogProvider(context.Background(), &runtimev1.UpsertModelCatalogProviderRequest{
		Provider: "dashscope",
		Yaml:     "version: 1\nprovider: dashscope\ncatalog_version: test\nmodels: []\nvoices: []\n",
	})
	if err == nil {
		t.Fatalf("expected unauthenticated error")
	}
	st, _ := status.FromError(err)
	if st.Code() != codes.Unauthenticated {
		t.Fatalf("expected Unauthenticated, got %v", st.Code())
	}
}

func TestUpsertAndDeleteModelCatalogProvider(t *testing.T) {
	svc := newTestServiceWithModelCatalog(t)
	ctx := userContext("user-1")

	upsertResp, err := svc.UpsertModelCatalogProvider(ctx, &runtimev1.UpsertModelCatalogProviderRequest{
		Provider: "dashscope",
		Yaml: `version: 1
provider: dashscope
catalog_version: custom-test
models:
  - provider: dashscope
    model_id: qwen3-tts-instruct-flash-2026-01-26
    model_type: tts
    updated_at: "2026-01-26"
    capabilities: [audio.synthesize]
    pricing:
      unit: char
      input: "unknown"
      output: "unknown"
      currency: CNY
      as_of: "2026-03-05"
      notes: custom test
    voice_set_id: dashscope:qwen3-tts-system-v1
    voice_discovery_mode: static_catalog
    voice_ref_kinds: [preset_voice_id, provider_voice_ref]
    source_ref:
      url: https://example.com/model
      retrieved_at: "2026-03-05"
      note: custom test
voices:
  - voice_set_id: dashscope:qwen3-tts-system-v1
    provider: dashscope
    voice_id: CustomCherry
    name: CustomCherry
    langs: [zh-cn]
    model_ids: [qwen3-tts-instruct-flash-2026-01-26]
    source_ref:
      url: https://example.com/model
      retrieved_at: "2026-03-05"
      note: custom test
`,
	})
	if err != nil {
		t.Fatalf("UpsertModelCatalogProvider: %v", err)
	}
	if upsertResp.GetProvider().GetProvider() != "dashscope" {
		t.Fatalf("unexpected provider in upsert response: %q", upsertResp.GetProvider().GetProvider())
	}
	if upsertResp.GetProvider().GetSource() != runtimev1.ModelCatalogProviderSource_MODEL_CATALOG_PROVIDER_SOURCE_CUSTOM {
		t.Fatalf("expected custom source after upsert")
	}

	listResp, err := svc.ListModelCatalogProviders(ctx, &runtimev1.ListModelCatalogProvidersRequest{})
	if err != nil {
		t.Fatalf("ListModelCatalogProviders after upsert: %v", err)
	}
	foundCustomVoice := false
	for _, entry := range listResp.GetProviders() {
		if entry.GetProvider() != "dashscope" {
			continue
		}
		if entry.GetSource() != runtimev1.ModelCatalogProviderSource_MODEL_CATALOG_PROVIDER_SOURCE_CUSTOM {
			t.Fatalf("expected dashscope source=custom after upsert")
		}
		if !strings.Contains(entry.GetYaml(), "CustomCherry") {
			t.Fatalf("expected custom yaml to contain CustomCherry")
		}
		foundCustomVoice = true
	}
	if !foundCustomVoice {
		t.Fatalf("expected dashscope custom provider entry")
	}

	_, err = svc.DeleteModelCatalogProvider(ctx, &runtimev1.DeleteModelCatalogProviderRequest{Provider: "dashscope"})
	if err != nil {
		t.Fatalf("DeleteModelCatalogProvider: %v", err)
	}

	finalList, err := svc.ListModelCatalogProviders(ctx, &runtimev1.ListModelCatalogProvidersRequest{})
	if err != nil {
		t.Fatalf("ListModelCatalogProviders after delete: %v", err)
	}
	for _, entry := range finalList.GetProviders() {
		if entry.GetProvider() != "dashscope" {
			continue
		}
		if entry.GetSource() != runtimev1.ModelCatalogProviderSource_MODEL_CATALOG_PROVIDER_SOURCE_BUILTIN {
			t.Fatalf("expected dashscope source=builtin after delete")
		}
		if strings.Contains(entry.GetYaml(), "CustomCherry") {
			t.Fatalf("custom yaml should be removed after delete")
		}
	}
}

func TestConnectorCheckOrderOwnerBeforeStatusBeforeCredential(t *testing.T) {
	// K-AUTH-005: check order is owner → status → credential.
	// Owner mismatch MUST return NOT_FOUND (information hiding), even if connector
	// is also disabled or missing credentials.
	svc := newTestService(t)
	user1Ctx := userContext("user-1")
	user2Ctx := userContext("user-2")

	// Create a connector owned by user-1
	resp, err := svc.CreateConnector(user1Ctx, &runtimev1.CreateConnectorRequest{
		Provider: "openai",
		ApiKey:   "key",
	})
	if err != nil {
		t.Fatalf("CreateConnector: %v", err)
	}
	connID := resp.GetConnector().GetConnectorId()

	// Disable the connector
	_, err = svc.UpdateConnector(user1Ctx, &runtimev1.UpdateConnectorRequest{
		ConnectorId: connID,
		Status:      runtimev1.ConnectorStatus_CONNECTOR_STATUS_DISABLED,
		UpdateMask:  &fieldmaskpb.FieldMask{Paths: []string{"status"}},
	})
	if err != nil {
		t.Fatalf("UpdateConnector disable: %v", err)
	}

	// user-2 tries to access → should see NOT_FOUND (owner check first)
	_, err = svc.GetConnector(user2Ctx, &runtimev1.GetConnectorRequest{ConnectorId: connID})
	if err == nil {
		t.Fatal("expected error for owner mismatch")
	}
	st, _ := status.FromError(err)
	if st.Code() != codes.NotFound {
		t.Fatalf("expected NotFound (owner hides entity), got %v", st.Code())
	}

	// user-1 accesses disabled connector → should see the connector (status check is second)
	getResp, err := svc.GetConnector(user1Ctx, &runtimev1.GetConnectorRequest{ConnectorId: connID})
	if err != nil {
		t.Fatalf("owner should see disabled connector: %v", err)
	}
	if getResp.GetConnector().GetStatus() != runtimev1.ConnectorStatus_CONNECTOR_STATUS_DISABLED {
		t.Fatal("connector should be disabled")
	}
}

func TestEnsureLocalConnectorsCreatesExactly6Categories(t *testing.T) {
	// K-LOCAL-001: 6 fixed categories in Phase 1.
	store := newTestStore(t)
	if err := EnsureLocalConnectors(store); err != nil {
		t.Fatalf("EnsureLocalConnectors: %v", err)
	}

	records, _ := store.Load()
	if len(records) != 6 {
		t.Fatalf("expected exactly 6 local connectors, got %d", len(records))
	}

	expectedCategories := map[runtimev1.LocalConnectorCategory]bool{
		runtimev1.LocalConnectorCategory_LOCAL_CONNECTOR_CATEGORY_LLM:    false,
		runtimev1.LocalConnectorCategory_LOCAL_CONNECTOR_CATEGORY_VISION: false,
		runtimev1.LocalConnectorCategory_LOCAL_CONNECTOR_CATEGORY_IMAGE:  false,
		runtimev1.LocalConnectorCategory_LOCAL_CONNECTOR_CATEGORY_TTS:    false,
		runtimev1.LocalConnectorCategory_LOCAL_CONNECTOR_CATEGORY_STT:    false,
		runtimev1.LocalConnectorCategory_LOCAL_CONNECTOR_CATEGORY_CUSTOM: false,
	}

	for _, record := range records {
		cat := record.LocalCategory
		if _, ok := expectedCategories[cat]; !ok {
			t.Errorf("unexpected local connector category: %v", cat)
		}
		expectedCategories[cat] = true
	}

	for cat, found := range expectedCategories {
		if !found {
			t.Errorf("missing local connector category: %v", cat)
		}
	}
}
