package integration

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestIntegrationMCPSourceDisplayNamesSurviveDiscoveryAndStorage(t *testing.T) {
	tools := []map[string]any{
		{"name": "inventory.lookup_SKU", "title": "查询库存", "annotations": map[string]any{"title": "annotation title"}},
		{"name": "archive.getHTTPStatus", "annotations": map[string]any{"title": "Check archive status"}},
		{"name": "warehouse.read", "title": "  ", "annotations": map[string]any{"title": " Warehouse status "}},
		{"name": "unseen_vendor.read"},
	}
	for _, tool := range tools {
		tool["inputSchema"] = map[string]any{"type": "object"}
		tool["description"] = "Original source description"
	}
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
			return jsonResponse(map[string]any{"jsonrpc": "2.0", "id": rpc.ID, "result": map[string]any{"protocolVersion": "2025-06-18", "serverInfo": map[string]any{"name": "inventory", "version": "1"}, "capabilities": map[string]any{"tools": map[string]any{}}}}), nil
		case "notifications/initialized":
			return &http.Response{StatusCode: 202, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(""))}, nil
		case "tools/list":
			return jsonResponse(map[string]any{"jsonrpc": "2.0", "id": rpc.ID, "result": map[string]any{"tools": tools}}), nil
		default:
			return nil, fmt.Errorf("unexpected MCP method %q", rpc.Method)
		}
	}))
	ctx := context.Background()
	target, err := s.configureInitialAdapter(ctx, "test-account", "catalog", &runtimev1.PutIntegrationConnectionRequest{
		Adapter: "mcp", DisplayName: "Inventory",
		Config: &runtimev1.IntegrationConnectionConfig{Mcp: &runtimev1.IntegrationMcpConfig{Endpoint: "https://inventory.test.invalid/mcp"}},
	}, "")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.saveTarget(ctx, target); err != nil {
		t.Fatal(err)
	}
	stored, err := s.loadTarget(ctx, "test-account", "catalog")
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"查询库存", "Check archive status", "Warehouse status", ""}
	for i, op := range stored.Public.Operations {
		if op.Name != tools[i]["name"] || op.GetDisplayName() != want[i] || op.Description != "Original source description" || op.Effect != "write" {
			t.Fatalf("source display metadata changed identity, description or effect: %v", op)
		}
	}
	if stored.Public.Operations[3].DisplayName != nil {
		t.Fatal("missing source title must remain absent")
	}
}

func TestIntegrationProviderDisplayNameUpdatePreservesGrantsAndOfflineMetadata(t *testing.T) {
	s := newIntegrationTestService(t, nil)
	provider, consumer := testDecision("provider", 1), testDecision("consumer", 2)
	id := registerTestProvider(t, s, provider, "read")
	grantTestTarget(t, s, consumer, id, "document.read")
	title := "读取指定文档"
	op := testOperation("read")
	op.DisplayName = &title
	response, err := s.RegisterIntegrationProvider(testContext(provider, localappop.OperationIntegrationProviderRegister), &runtimev1.RegisterIntegrationProviderRequest{
		IntegrationId: "documents", DisplayName: "Documents", Operations: []*runtimev1.IntegrationOperation{op},
	})
	if err != nil {
		t.Fatal(err)
	}
	if response.Target.TargetRef != id || response.Target.Operations[0].GetDisplayName() != title {
		t.Fatalf("metadata update changed target identity or lost title: %v", response)
	}
	if !s.permitted(context.Background(), consumer.AccountID, consumer.RegisteredAppSubject, id, "document.read") || s.permitted(context.Background(), consumer.AccountID, consumer.RegisteredAppSubject, id, title) {
		t.Fatal("display name update rewrote operation permissions")
	}
	if _, err := s.UnregisterIntegrationProvider(testContext(provider, localappop.OperationIntegrationProviderUnregister), &runtimev1.UnregisterIntegrationProviderRequest{TargetRef: id}); err != nil {
		t.Fatal(err)
	}
	catalog, err := s.ListIntegrationCatalog(testContext(consumer, localappop.OperationIntegrationCatalogList), &runtimev1.ListIntegrationCatalogRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if len(catalog.Targets) != 1 || catalog.Targets[0].Available || catalog.Targets[0].Operations[0].GetDisplayName() != title {
		t.Fatalf("offline provider lost source display metadata: %v", catalog)
	}
}

func TestIntegrationOperationDisplayNameBounds(t *testing.T) {
	for _, title := range []string{"", " ", " padded ", "bad\x00name", strings.Repeat("中", 171)} {
		op := testOperation("read")
		op.DisplayName = &title
		if err := validateOperations([]*runtimev1.IntegrationOperation{op}); status.Code(err) != codes.InvalidArgument {
			t.Fatalf("invalid display name accepted: %q: %v", title, err)
		}
	}
	title := strings.Repeat("中", 170) + "ab"
	op := testOperation("read")
	op.DisplayName = &title
	if err := validateOperations([]*runtimev1.IntegrationOperation{op}); err != nil {
		t.Fatalf("512-byte display name rejected: %v", err)
	}
}
