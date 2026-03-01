package connector

import (
	"context"
	"log/slog"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func newTestService(t *testing.T) *Service {
	t.Helper()
	store := newTestStore(t)
	logger := slog.Default()
	return New(logger, store, nil)
}

func TestCreateConnector(t *testing.T) {
	svc := newTestService(t)
	ctx := context.Background()

	resp, err := svc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{
		Provider: "openai",
		Endpoint: "https://api.openai.com/v1",
		Label:    "Test OpenAI",
		ApiKey:   "sk-test",
		OwnerId:  "user-1",
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
	ctx := context.Background()

	_, err := svc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{
		Provider: "openai",
		OwnerId:  "user-1",
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
	ctx := context.Background()

	resp, err := svc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{
		Provider: "gemini",
		ApiKey:   "test-key",
		OwnerId:  "user-1",
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
	ctx := context.Background()

	// Create 128 connectors
	for i := 0; i < maxConnectorsPerUser; i++ {
		_, err := svc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{
			Provider: "openai",
			ApiKey:   "key",
			OwnerId:  "user-1",
		})
		if err != nil {
			t.Fatalf("CreateConnector %d: %v", i, err)
		}
	}

	// 129th should fail
	_, err := svc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{
		Provider: "openai",
		ApiKey:   "key",
		OwnerId:  "user-1",
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
	ctx := context.Background()

	resp, _ := svc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{
		Provider: "openai",
		ApiKey:   "key",
		OwnerId:  "user-1",
	})
	connID := resp.Connector.ConnectorId

	// Different owner should see NOT_FOUND (information hiding)
	_, err := svc.GetConnector(ctx, &runtimev1.GetConnectorRequest{
		ConnectorId: connID,
		OwnerId:     "user-2",
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
	ctx := context.Background()

	// Ensure local connectors exist
	if err := EnsureLocalConnectors(svc.store); err != nil {
		t.Fatalf("EnsureLocalConnectors: %v", err)
	}

	// Create remote connectors for different users
	svc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{
		Provider: "openai",
		ApiKey:   "key",
		OwnerId:  "user-1",
	})
	svc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{
		Provider: "gemini",
		ApiKey:   "key",
		OwnerId:  "user-2",
	})

	// List for user-1: should see 6 local + 1 remote
	resp, err := svc.ListConnectors(ctx, &runtimev1.ListConnectorsRequest{
		OwnerId: "user-1",
	})
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
	ctx := context.Background()

	resp, _ := svc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{
		Provider: "openai",
		ApiKey:   "key",
		OwnerId:  "user-1",
		Label:    "Old",
	})
	connID := resp.Connector.ConnectorId

	updated, err := svc.UpdateConnector(ctx, &runtimev1.UpdateConnectorRequest{
		ConnectorId: connID,
		OwnerId:     "user-1",
		Label:       "New",
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
	ctx := context.Background()

	resp, _ := svc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{
		Provider: "openai",
		ApiKey:   "key",
		OwnerId:  "user-1",
	})
	connID := resp.Connector.ConnectorId

	_, err := svc.UpdateConnector(ctx, &runtimev1.UpdateConnectorRequest{
		ConnectorId: connID,
		OwnerId:     "user-1",
	})
	if err == nil {
		t.Fatal("expected error for no changes")
	}
}

func TestUpdateLocalConnectorImmutable(t *testing.T) {
	svc := newTestService(t)
	ctx := context.Background()

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
		Label:       "Hacked",
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
	ctx := context.Background()

	resp, _ := svc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{
		Provider: "openai",
		ApiKey:   "key",
		OwnerId:  "user-1",
	})
	connID := resp.Connector.ConnectorId

	delResp, err := svc.DeleteConnector(ctx, &runtimev1.DeleteConnectorRequest{
		ConnectorId: connID,
		OwnerId:     "user-1",
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

func TestDeleteLocalConnectorForbidden(t *testing.T) {
	svc := newTestService(t)
	ctx := context.Background()

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
	ctx := context.Background()

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
	ctx := context.Background()

	resp, _ := svc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{
		Provider: "openai",
		ApiKey:   "key",
		OwnerId:  "user-1",
	})
	connID := resp.Connector.ConnectorId

	// Disable it
	disabled := runtimev1.ConnectorStatus_CONNECTOR_STATUS_DISABLED
	svc.store.Update(connID, ConnectorMutations{Status: &disabled})

	testResp, err := svc.TestConnector(ctx, &runtimev1.TestConnectorRequest{
		ConnectorId: connID,
		OwnerId:     "user-1",
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

func TestModelCacheTTLAndInvalidation(t *testing.T) {
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
