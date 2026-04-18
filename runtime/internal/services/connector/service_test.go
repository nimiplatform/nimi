package connector

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/fieldmaskpb"
)

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

func TestCreateConnectorReturnsFreshRecordWhenProviderRepeats(t *testing.T) {
	svc := newTestService(t)
	ctx := userContext("user-1")

	first, err := svc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{
		Provider: "openai",
		Label:    "First",
		ApiKey:   "key-1",
	})
	if err != nil {
		t.Fatalf("first CreateConnector: %v", err)
	}
	second, err := svc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{
		Provider: "openai",
		Label:    "Second",
		ApiKey:   "key-2",
	})
	if err != nil {
		t.Fatalf("second CreateConnector: %v", err)
	}
	if first.GetConnector().GetConnectorId() == second.GetConnector().GetConnectorId() {
		t.Fatalf("expected distinct connector ids for repeated provider creates")
	}
	if second.GetConnector().GetLabel() != "Second" {
		t.Fatalf("expected second connector label to match created record, got %q", second.GetConnector().GetLabel())
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
	// K-AUTH-002: owner mismatch must be hidden as NOT_FOUND.
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

func TestListConnectorsAnonymousOnlySeesLocal(t *testing.T) {
	// K-AUTH-001: anonymous callers may only see LOCAL_MODEL connectors.
	svc := newTestService(t)

	if err := EnsureLocalConnectors(svc.store); err != nil {
		t.Fatalf("EnsureLocalConnectors: %v", err)
	}
	if _, err := svc.CreateConnector(userContext("user-1"), &runtimev1.CreateConnectorRequest{
		Provider: "openai",
		ApiKey:   "key",
	}); err != nil {
		t.Fatalf("CreateConnector: %v", err)
	}

	resp, err := svc.ListConnectors(context.Background(), &runtimev1.ListConnectorsRequest{})
	if err != nil {
		t.Fatalf("ListConnectors: %v", err)
	}
	if len(resp.GetConnectors()) != 6 {
		t.Fatalf("expected 6 local connectors, got %d", len(resp.GetConnectors()))
	}
	for _, connector := range resp.GetConnectors() {
		if connector.GetKind() != runtimev1.ConnectorKind_CONNECTOR_KIND_LOCAL_MODEL {
			t.Fatalf("anonymous caller must not see remote connector: %+v", connector)
		}
	}
}

func TestConnectorOwnerTypeMapping(t *testing.T) {
	// K-AUTH-003: authenticated REMOTE_MANAGED maps to REALM_USER, anonymous machine-global and LOCAL_MODEL map to SYSTEM.
	svc := newTestService(t)

	created, err := svc.CreateConnector(userContext("user-1"), &runtimev1.CreateConnectorRequest{
		Provider: "openai",
		ApiKey:   "key",
	})
	if err != nil {
		t.Fatalf("CreateConnector: %v", err)
	}
	if created.GetConnector().GetKind() != runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED {
		t.Fatalf("expected remote managed connector, got %v", created.GetConnector().GetKind())
	}
	if created.GetConnector().GetOwnerType() != runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER {
		t.Fatalf("expected remote connector owner type REALM_USER, got %v", created.GetConnector().GetOwnerType())
	}

	anonymousCreated, err := svc.CreateConnector(context.Background(), &runtimev1.CreateConnectorRequest{
		Provider: "gemini",
		ApiKey:   "machine-key",
	})
	if err != nil {
		t.Fatalf("CreateConnector anonymous: %v", err)
	}
	if anonymousCreated.GetConnector().GetOwnerType() != runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_SYSTEM {
		t.Fatalf("expected anonymous remote connector owner type SYSTEM, got %v", anonymousCreated.GetConnector().GetOwnerType())
	}
	if anonymousCreated.GetConnector().GetOwnerId() != "machine" {
		t.Fatalf("expected anonymous remote connector owner_id=machine, got %q", anonymousCreated.GetConnector().GetOwnerId())
	}

	if err := EnsureLocalConnectors(svc.store); err != nil {
		t.Fatalf("EnsureLocalConnectors: %v", err)
	}
	localResp, err := svc.ListConnectors(context.Background(), &runtimev1.ListConnectorsRequest{
		KindFilter: runtimev1.ConnectorKind_CONNECTOR_KIND_LOCAL_MODEL,
	})
	if err != nil {
		t.Fatalf("ListConnectors local: %v", err)
	}
	if len(localResp.GetConnectors()) == 0 {
		t.Fatal("expected local connectors")
	}
	for _, connector := range localResp.GetConnectors() {
		if connector.GetOwnerType() != runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_SYSTEM {
			t.Fatalf("expected local connector owner type SYSTEM, got %v", connector.GetOwnerType())
		}
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
	if _, err := svc.CreateConnector(user1Ctx, &runtimev1.CreateConnectorRequest{
		Provider: "openai",
		ApiKey:   "key",
	}); err != nil {
		t.Fatalf("CreateConnector user-1: %v", err)
	}
	if _, err := svc.CreateConnector(user2Ctx, &runtimev1.CreateConnectorRequest{
		Provider: "gemini",
		ApiKey:   "key",
	}); err != nil {
		t.Fatalf("CreateConnector user-2: %v", err)
	}

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

func TestConnectorManagementRequiresAuth(t *testing.T) {
	// K-AUTH-004: user-owned connectors still require auth; machine-global connectors remain manageable without JWT.
	svc := newTestService(t)

	createdAnonymous, err := svc.CreateConnector(context.Background(), &runtimev1.CreateConnectorRequest{
		Provider: "openai",
		ApiKey:   "key",
	})
	if err != nil {
		t.Fatalf("expected anonymous create to succeed, got %v", err)
	}
	if createdAnonymous.GetConnector().GetOwnerId() != "machine" {
		t.Fatalf("expected anonymous create to produce owner_id=machine, got %q", createdAnonymous.GetConnector().GetOwnerId())
	}

	_, err = svc.UpdateConnector(context.Background(), &runtimev1.UpdateConnectorRequest{
		ConnectorId: createdAnonymous.GetConnector().GetConnectorId(),
		Label:       proto.String("machine-global"),
	})
	if err != nil {
		t.Fatalf("expected anonymous update of machine-global connector to succeed, got %v", err)
	}

	_, err = svc.DeleteConnector(context.Background(), &runtimev1.DeleteConnectorRequest{
		ConnectorId: createdAnonymous.GetConnector().GetConnectorId(),
	})
	if err != nil {
		t.Fatalf("expected anonymous delete of machine-global connector to succeed, got %v", err)
	}

	created, err := svc.CreateConnector(userContext("user-1"), &runtimev1.CreateConnectorRequest{
		Provider: "openai",
		ApiKey:   "key",
	})
	if err != nil {
		t.Fatalf("CreateConnector: %v", err)
	}
	connectorID := created.GetConnector().GetConnectorId()

	_, err = svc.UpdateConnector(context.Background(), &runtimev1.UpdateConnectorRequest{
		ConnectorId: connectorID,
		Label:       proto.String("renamed"),
	})
	if err == nil {
		t.Fatal("expected unauthenticated update to fail")
	}
	if st, _ := status.FromError(err); st.Code() != codes.Unauthenticated {
		t.Fatalf("expected update unauthenticated, got %v", st.Code())
	}

	_, err = svc.DeleteConnector(context.Background(), &runtimev1.DeleteConnectorRequest{
		ConnectorId: connectorID,
	})
	if err == nil {
		t.Fatal("expected unauthenticated delete to fail")
	}
	if st, _ := status.FromError(err); st.Code() != codes.Unauthenticated {
		t.Fatalf("expected delete unauthenticated, got %v", st.Code())
	}
}

func TestAuthenticatedCallerSeesMachineGlobalAndOwnedConnectors(t *testing.T) {
	svc := newTestService(t)
	if err := EnsureLocalConnectors(svc.store); err != nil {
		t.Fatalf("EnsureLocalConnectors: %v", err)
	}

	if _, err := svc.CreateConnector(context.Background(), &runtimev1.CreateConnectorRequest{
		Provider: "openai",
		ApiKey:   "machine-key",
	}); err != nil {
		t.Fatalf("CreateConnector anonymous: %v", err)
	}
	if _, err := svc.CreateConnector(userContext("user-1"), &runtimev1.CreateConnectorRequest{
		Provider: "gemini",
		ApiKey:   "user-key",
	}); err != nil {
		t.Fatalf("CreateConnector user-1: %v", err)
	}
	if _, err := svc.CreateConnector(userContext("user-2"), &runtimev1.CreateConnectorRequest{
		Provider: "deepseek",
		ApiKey:   "other-user-key",
	}); err != nil {
		t.Fatalf("CreateConnector user-2: %v", err)
	}

	resp, err := svc.ListConnectors(userContext("user-1"), &runtimev1.ListConnectorsRequest{})
	if err != nil {
		t.Fatalf("ListConnectors: %v", err)
	}

	remoteOwnerIDs := make([]string, 0, len(resp.GetConnectors()))
	for _, connector := range resp.GetConnectors() {
		if connector.GetKind() == runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED {
			remoteOwnerIDs = append(remoteOwnerIDs, connector.GetOwnerId())
		}
	}
	sort.Strings(remoteOwnerIDs)
	expected := []string{"machine", "user-1"}
	if len(remoteOwnerIDs) != len(expected) {
		t.Fatalf("expected remote owner ids %v, got %v", expected, remoteOwnerIDs)
	}
	for index, value := range expected {
		if index >= len(remoteOwnerIDs) || remoteOwnerIDs[index] != value {
			t.Fatalf("expected remote owner ids %v, got %v", expected, remoteOwnerIDs)
		}
	}
}

func TestSystemManagedRemoteConnectorsRemainImmutable(t *testing.T) {
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

	_, err := svc.UpdateConnector(context.Background(), &runtimev1.UpdateConnectorRequest{
		ConnectorId: "sys-openai",
		Label:       proto.String("renamed"),
	})
	if err == nil {
		t.Fatal("expected immutable error for system-managed connector update")
	}
	if st, _ := status.FromError(err); st.Code() != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument, got %v", st.Code())
	}

	_, err = svc.DeleteConnector(context.Background(), &runtimev1.DeleteConnectorRequest{
		ConnectorId: "sys-openai",
	})
	if err == nil {
		t.Fatal("expected immutable error for system-managed connector delete")
	}
	if st, _ := status.FromError(err); st.Code() != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument, got %v", st.Code())
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
	if _, err := svc.store.Update(connID, ConnectorMutations{Status: &disabled}); err != nil {
		t.Fatalf("Update connector status: %v", err)
	}

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
		"wan2.7-image-pro":   true,
		"wan2.7-image":       true,
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

func TestListConnectorModelsDynamicProviderUsesOutboundCacheAndForceRefresh(t *testing.T) {
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
		HTTPTimeout: 5 * time.Second,
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
	if got := hits.Load(); got != 1 {
		t.Fatalf("expected first dynamic discovery to outbound once, got %d", got)
	}
	if len(first.GetModels()) != 2 {
		t.Fatalf("expected two live-discovered models, got %d", len(first.GetModels()))
	}
	modelCapabilities := map[string][]string{}
	for _, model := range first.GetModels() {
		modelCapabilities[model.GetModelId()] = append([]string(nil), model.GetCapabilities()...)
	}
	if got := modelCapabilities["openai/gpt-4.1"]; len(got) != 1 || got[0] != "text.generate" {
		t.Fatalf("expected openrouter text model capabilities to be inferred per-model, got %v", got)
	}
	if got := modelCapabilities["openai/text-embedding-3-large"]; len(got) != 1 || got[0] != "text.embed" {
		t.Fatalf("expected openrouter embedding model capabilities to be inferred per-model, got %v", got)
	}

	second, err := svc.ListConnectorModels(ctx, &runtimev1.ListConnectorModelsRequest{
		ConnectorId: connectorID,
		PageSize:    200,
	})
	if err != nil {
		t.Fatalf("ListConnectorModels second: %v", err)
	}
	if len(second.GetModels()) != len(first.GetModels()) {
		t.Fatalf("expected cached dynamic inventory on second call")
	}
	if got := hits.Load(); got != 1 {
		t.Fatalf("expected second dynamic call to use cache, got %d upstream calls", got)
	}

	_, err = svc.ListConnectorModels(ctx, &runtimev1.ListConnectorModelsRequest{
		ConnectorId:  connectorID,
		PageSize:     200,
		ForceRefresh: true,
	})
	if err != nil {
		t.Fatalf("ListConnectorModels force_refresh: %v", err)
	}
	if got := hits.Load(); got != 2 {
		t.Fatalf("expected force_refresh to re-discover dynamic inventory, got %d upstream calls", got)
	}
}

func TestListConnectorModelsFireworksUsesAccountModelsEndpointAndPerModelCapabilities(t *testing.T) {
	svc := newTestService(t)
	ctx := userContext("user-1")

	var hits atomic.Int32
	var requestedPath atomic.Value
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestedPath.Store(r.URL.Path)
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
		HTTPTimeout: 5 * time.Second,
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

	resp, err := svc.ListConnectorModels(ctx, &runtimev1.ListConnectorModelsRequest{
		ConnectorId: connectorID,
		PageSize:    200,
	})
	if err != nil {
		t.Fatalf("ListConnectorModels: %v", err)
	}
	if got := hits.Load(); got != 1 {
		t.Fatalf("expected fireworks discovery to probe account models endpoint once, got %d", got)
	}
	if got, _ := requestedPath.Load().(string); got != "/v1/accounts/fireworks/models" {
		t.Fatalf("expected fireworks discovery path /v1/accounts/fireworks/models, got %q", got)
	}
	if len(resp.GetModels()) != 2 {
		t.Fatalf("expected two fireworks models, got %d", len(resp.GetModels()))
	}
	modelCapabilities := map[string][]string{}
	for _, model := range resp.GetModels() {
		modelCapabilities[model.GetModelId()] = append([]string(nil), model.GetCapabilities()...)
	}
	if got := modelCapabilities["accounts/fireworks/models/deepseek-v3"]; len(got) != 1 || got[0] != "text.generate" {
		t.Fatalf("expected fireworks text model capabilities to stay text-only, got %v", got)
	}
	if got := modelCapabilities["accounts/fireworks/models/qwen3-vl"]; len(got) != 2 || got[0] != "text.generate" || got[1] != "text.generate.vision" {
		t.Fatalf("expected fireworks vision model capabilities to include text.generate.vision, got %v", got)
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
	if resp.GetAck().GetOk() {
		t.Fatalf("expected probe failure")
	}
	if resp.GetAck().GetReasonCode() != runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED {
		t.Fatalf("expected AI_PROVIDER_AUTH_FAILED, got %v", resp.GetAck().GetReasonCode())
	}
}

func TestTestConnectorSystemOwnedRemoteVisibleWithoutCaller(t *testing.T) {
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
