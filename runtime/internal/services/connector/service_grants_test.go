package connector

import (
	"errors"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestConnectorGrantLifecycleAndDeleteCascade(t *testing.T) {
	svc := newTestService(t)
	ctx := userContext("account-a")
	created, err := svc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{
		Provider: "openai",
		ApiKey:   "secret-never-in-grant",
	})
	if err != nil {
		t.Fatalf("CreateConnector: %v", err)
	}
	connectorID := created.GetConnector().GetConnectorId()
	granted, err := svc.CreateConnectorGrant(ctx, &runtimev1.CreateConnectorGrantRequest{ConnectorId: connectorID})
	if err != nil {
		t.Fatalf("CreateConnectorGrant: %v", err)
	}
	grant := granted.GetGrant()
	if grant.GetGrantId() == "" || grant.GetConnectorId() != connectorID || grant.GetAccountId() != "account-a" ||
		grant.GetStatus() != runtimev1.ConnectorGrantStatus_CONNECTOR_GRANT_STATUS_ACTIVE || grant.GetCreatedAt() == nil || grant.GetRevokedAt() != nil {
		t.Fatalf("grant = %+v", grant)
	}
	if _, err := svc.store.ValidateGrantBinding("account-a", grant.GetGrantId()); err != nil {
		t.Fatalf("ValidateGrantBinding(active): %v", err)
	}
	if _, err := svc.store.ValidateGrantBinding("account-b", grant.GetGrantId()); !errors.Is(err, ErrConnectorGrantSelectionRequired) {
		t.Fatalf("foreign-account validation = %v", err)
	}
	listed, err := svc.ListConnectorGrants(ctx, &runtimev1.ListConnectorGrantsRequest{})
	if err != nil || len(listed.GetGrants()) != 1 || listed.GetGrants()[0].GetGrantId() != grant.GetGrantId() {
		t.Fatalf("ListConnectorGrants = %+v, %v", listed, err)
	}

	revoked, err := svc.RevokeConnectorGrant(ctx, &runtimev1.RevokeConnectorGrantRequest{GrantId: grant.GetGrantId()})
	if err != nil {
		t.Fatalf("RevokeConnectorGrant: %v", err)
	}
	if revoked.GetGrant().GetStatus() != runtimev1.ConnectorGrantStatus_CONNECTOR_GRANT_STATUS_REVOKED || revoked.GetGrant().GetRevokedAt() == nil {
		t.Fatalf("revoked grant = %+v", revoked.GetGrant())
	}
	if _, err := svc.store.ValidateGrantBinding("account-a", grant.GetGrantId()); !errors.Is(err, ErrConnectorGrantRevoked) {
		t.Fatalf("revoked validation = %v", err)
	}

	regranted, err := svc.CreateConnectorGrant(ctx, &runtimev1.CreateConnectorGrantRequest{ConnectorId: connectorID})
	if err != nil || regranted.GetGrant().GetGrantId() == grant.GetGrantId() {
		t.Fatalf("regrant = %+v, %v", regranted, err)
	}
	if _, err := svc.DeleteConnector(ctx, &runtimev1.DeleteConnectorRequest{ConnectorId: connectorID}); err != nil {
		t.Fatalf("DeleteConnector: %v", err)
	}
	if _, err := svc.store.ValidateGrantBinding("account-a", regranted.GetGrant().GetGrantId()); !errors.Is(err, ErrConnectorGrantRevoked) {
		t.Fatalf("delete-cascade validation = %v", err)
	}
}

func TestConnectorGrantRegistryPersistsAcrossStoreReopen(t *testing.T) {
	basePath := t.TempDir()
	store := NewConnectorStoreWithMemorySecrets(basePath)
	connectorRecord, err := store.Create(ConnectorRecord{
		Kind:      runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
		OwnerType: runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER,
		OwnerID:   "account-persist", Provider: "openai", Status: runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
	}, "key")
	if err != nil {
		t.Fatal(err)
	}
	grant, err := store.CreateGrant("account-persist", connectorRecord.ConnectorID)
	if err != nil {
		t.Fatal(err)
	}
	reopened := NewConnectorStoreWithMemorySecrets(basePath)
	loaded, found, err := reopened.GetGrant(grant.GrantID)
	if err != nil || !found || loaded.AccountID != "account-persist" || loaded.ConnectorID != connectorRecord.ConnectorID {
		t.Fatalf("persisted grant = %+v found=%v err=%v", loaded, found, err)
	}
}

func TestConnectorGrantRPCIsAccountScopedAndIdempotent(t *testing.T) {
	svc := newTestService(t)
	connector, err := svc.CreateConnector(userContext("account-a"), &runtimev1.CreateConnectorRequest{Provider: "openai", ApiKey: "key"})
	if err != nil {
		t.Fatal(err)
	}
	request := &runtimev1.CreateConnectorGrantRequest{ConnectorId: connector.GetConnector().GetConnectorId()}
	first, err := svc.CreateConnectorGrant(userContext("account-a"), request)
	if err != nil {
		t.Fatal(err)
	}
	second, err := svc.CreateConnectorGrant(userContext("account-a"), request)
	if err != nil || first.GetGrant().GetGrantId() != second.GetGrant().GetGrantId() {
		t.Fatalf("active grant creation is not idempotent: first=%+v second=%+v err=%v", first, second, err)
	}
	foreign, err := svc.ListConnectorGrants(userContext("account-b"), &runtimev1.ListConnectorGrantsRequest{})
	if err != nil || len(foreign.GetGrants()) != 0 {
		t.Fatalf("foreign grant list = %+v, %v", foreign, err)
	}
}
