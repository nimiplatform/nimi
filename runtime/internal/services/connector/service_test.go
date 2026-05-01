package connector

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"sort"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/fieldmaskpb"
)

func codexProbeJWTForTest(t *testing.T, accountID string) string {
	t.Helper()
	raw, err := json.Marshal(map[string]any{
		"https://api.openai.com/auth": map[string]any{
			"chatgpt_account_id": accountID,
		},
	})
	if err != nil {
		t.Fatalf("marshal codex probe jwt: %v", err)
	}
	return "hdr." + base64.RawURLEncoding.EncodeToString(raw) + ".sig"
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
func TestCreateConnectorRejectsUnknownOAuthProfile(t *testing.T) {
	svc := newTestService(t)
	ctx := userContext("user-1")
	_, err := svc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{
		Provider:            "openai_compatible",
		Endpoint:            "https://example.com/v1",
		AuthKind:            runtimev1.ConnectorAuthKind_CONNECTOR_AUTH_KIND_OAUTH_MANAGED,
		ProviderAuthProfile: "unknown_oauth",
		CredentialJson:      `{"access_token":"token-1"}`,
	})
	if err == nil {
		t.Fatal("expected invalid connector error for unknown oauth profile")
	}
	st, _ := status.FromError(err)
	if st.Code() != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument, got %v", st.Code())
	}
}
func TestCreateConnectorRejectsIncompatibleOAuthProfile(t *testing.T) {
	svc := newTestService(t)
	ctx := userContext("user-1")
	_, err := svc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{
		Provider:            "openai_compatible",
		Endpoint:            "https://example.com/v1",
		AuthKind:            runtimev1.ConnectorAuthKind_CONNECTOR_AUTH_KIND_OAUTH_MANAGED,
		ProviderAuthProfile: "openai_codex",
		CredentialJson:      `{"access_token":"token-1"}`,
	})
	if err == nil {
		t.Fatal("expected invalid connector error for incompatible oauth profile")
	}
	st, _ := status.FromError(err)
	if st.Code() != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument, got %v", st.Code())
	}
}
func TestCreateConnectorAnonymousOAuthManagedRequiresAuth(t *testing.T) {
	svc := newTestService(t)
	_, err := svc.CreateConnector(context.Background(), &runtimev1.CreateConnectorRequest{
		Provider:            "openai_codex",
		Endpoint:            "https://chatgpt.com/backend-api/codex",
		AuthKind:            runtimev1.ConnectorAuthKind_CONNECTOR_AUTH_KIND_OAUTH_MANAGED,
		ProviderAuthProfile: "openai_codex",
		CredentialJson:      `{"access_token":"token-1"}`,
	})
	if err == nil {
		t.Fatal("expected unauthenticated error for anonymous oauth-managed connector create")
	}
	st, _ := status.FromError(err)
	if st.Code() != codes.Unauthenticated {
		t.Fatalf("expected Unauthenticated, got %v", st.Code())
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
	// K-AUTH-003: authenticated REMOTE_MANAGED maps to REALM_USER, anonymous machine-global API-key connectors and LOCAL_MODEL map to SYSTEM.
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
	// K-AUTH-004: user-owned connectors still require auth; machine-global API-key connectors remain manageable without JWT.
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
func TestNonUserOwnedOAuthManagedConnectorsFailClosed(t *testing.T) {
	svc := newTestService(t)
	payload := `{"access_token":"token-1"}`
	if _, err := svc.store.Create(ConnectorRecord{
		ConnectorID:         "machine-codex",
		Kind:                runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
		OwnerType:           runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_SYSTEM,
		OwnerID:             "machine",
		Provider:            "openai_codex",
		ProviderAuthProfile: "openai_codex",
		Endpoint:            "https://chatgpt.com/backend-api/codex",
		Status:              runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
		AuthKind:            runtimev1.ConnectorAuthKind_CONNECTOR_AUTH_KIND_OAUTH_MANAGED,
	}, payload); err != nil {
		t.Fatalf("create invalid oauth-managed connector: %v", err)
	}
	if _, err := svc.GetConnector(context.Background(), &runtimev1.GetConnectorRequest{
		ConnectorId: "machine-codex",
	}); err == nil {
		t.Fatal("expected invalid oauth-managed connector to be hidden from GetConnector")
	} else if st, _ := status.FromError(err); st.Code() != codes.NotFound {
		t.Fatalf("expected GetConnector NotFound, got %v", st.Code())
	}
	listResp, err := svc.ListConnectors(context.Background(), &runtimev1.ListConnectorsRequest{})
	if err != nil {
		t.Fatalf("ListConnectors: %v", err)
	}
	for _, item := range listResp.GetConnectors() {
		if item.GetConnectorId() == "machine-codex" {
			t.Fatal("expected invalid oauth-managed connector to be hidden from ListConnectors")
		}
	}
	testResp, err := svc.TestConnector(context.Background(), &runtimev1.TestConnectorRequest{
		ConnectorId: "machine-codex",
	})
	if err != nil {
		t.Fatalf("TestConnector: %v", err)
	}
	if testResp.GetAck().GetOk() || testResp.GetAck().GetReasonCode() != runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND {
		t.Fatalf("expected TestConnector fail-closed not found, got %+v", testResp.GetAck())
	}
	if _, err := svc.ListConnectorModels(context.Background(), &runtimev1.ListConnectorModelsRequest{
		ConnectorId: "machine-codex",
	}); err == nil {
		t.Fatal("expected ListConnectorModels to hide invalid oauth-managed connector")
	} else if st, _ := status.FromError(err); st.Code() != codes.NotFound {
		t.Fatalf("expected ListConnectorModels NotFound, got %v", st.Code())
	}
	if _, err := svc.UpdateConnector(context.Background(), &runtimev1.UpdateConnectorRequest{
		ConnectorId: "machine-codex",
		Label:       proto.String("renamed"),
	}); err == nil {
		t.Fatal("expected UpdateConnector to hide invalid oauth-managed connector")
	} else if st, _ := status.FromError(err); st.Code() != codes.NotFound {
		t.Fatalf("expected UpdateConnector NotFound, got %v", st.Code())
	}
	if _, err := svc.DeleteConnector(context.Background(), &runtimev1.DeleteConnectorRequest{
		ConnectorId: "machine-codex",
	}); err == nil {
		t.Fatal("expected DeleteConnector to hide invalid oauth-managed connector")
	} else if st, _ := status.FromError(err); st.Code() != codes.NotFound {
		t.Fatalf("expected DeleteConnector NotFound, got %v", st.Code())
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
