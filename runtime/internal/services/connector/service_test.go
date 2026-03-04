package connector

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
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

func TestModelCacheSetGetAndInvalidation(t *testing.T) {
	cache := NewModelCache()

	models := []*runtimev1.ConnectorModelDescriptor{
		{ModelId: "gpt-4", Available: true},
	}

	cache.Set("conn-1", models)

	got := cache.Get("conn-1")
	if len(got) != 1 {
		t.Fatalf("expected 1 cached model, got %d", len(got))
	}

	cache.Invalidate("conn-1")
	got = cache.Get("conn-1")
	if got != nil {
		t.Error("expected nil after invalidation")
	}
}

func TestListConnectorModelsConcurrentRequestsShareSingleRemoteFetch(t *testing.T) {
	svc := newTestService(t)
	ctx := userContext("user-1")

	var hits atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			http.NotFound(w, r)
			return
		}
		hits.Add(1)
		time.Sleep(120 * time.Millisecond)
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"data":[{"id":"qwen-plus","name":"qwen-plus"}]}`)
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

	const workers = 8
	start := make(chan struct{})
	errCh := make(chan error, workers)
	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			resp, callErr := svc.ListConnectorModels(ctx, &runtimev1.ListConnectorModelsRequest{
				ConnectorId: connectorID,
				PageSize:    20,
			})
			if callErr != nil {
				errCh <- callErr
				return
			}
			if len(resp.GetModels()) != 1 || resp.GetModels()[0].GetModelId() != "qwen-plus" {
				errCh <- status.Errorf(codes.Internal, "unexpected models payload: %+v", resp.GetModels())
			}
		}()
	}

	close(start)
	wg.Wait()
	close(errCh)
	for callErr := range errCh {
		if callErr != nil {
			t.Fatalf("ListConnectorModels concurrent call failed: %v", callErr)
		}
	}

	if got := hits.Load(); got != 1 {
		t.Fatalf("expected exactly one upstream /v1/models call, got %d", got)
	}
}

func TestModelCacheIsolation(t *testing.T) {
	cache := NewModelCache()

	cache.Set("conn-1", []*runtimev1.ConnectorModelDescriptor{{ModelId: "m1"}})
	cache.Set("conn-2", []*runtimev1.ConnectorModelDescriptor{{ModelId: "m2"}})

	got1 := cache.Get("conn-1")
	got2 := cache.Get("conn-2")
	if len(got1) != 1 || got1[0].ModelId != "m1" {
		t.Error("conn-1 cache corrupted")
	}
	if len(got2) != 1 || got2[0].ModelId != "m2" {
		t.Error("conn-2 cache corrupted")
	}

	cache.Invalidate("conn-1")
	if cache.Get("conn-1") != nil {
		t.Error("conn-1 should be invalidated")
	}
	if cache.Get("conn-2") == nil {
		t.Error("conn-2 should still be cached")
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
