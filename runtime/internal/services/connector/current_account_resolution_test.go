package connector

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	aicatalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func TestResolveCurrentAccountConnectorBindingUsesExactCurrentAccountTarget(t *testing.T) {
	resolver, err := aicatalog.NewResolver(aicatalog.ResolverConfig{})
	if err != nil {
		t.Fatal(err)
	}
	store := NewConnectorStoreWithMemorySecrets(t.TempDir())
	current, err := store.Create(ConnectorRecord{
		ConnectorID: "connector-current", Kind: runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
		OwnerType: runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER, OwnerID: "account-a",
		Provider: "dashscope", Status: runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
	}, "valid-current-credential")
	if err != nil {
		t.Fatal(err)
	}
	ref := catalogRefForConnectorTest(t, resolver, "account-a", current, "qwen3-tts-vc")

	resolved, binding, err := ResolveCurrentAccountConnectorBinding(store, resolver, "account-a", ref)
	if err != nil {
		t.Fatalf("ResolveCurrentAccountConnectorBinding: %v", err)
	}
	if resolved.ConnectorID != current.ConnectorID || binding == nil || binding.ConnectorID != current.ConnectorID {
		t.Fatalf("resolved Connector=%+v binding=%+v", resolved, binding)
	}
}

func TestResolveCurrentAccountConnectorBindingFailsClosedWithoutExactTarget(t *testing.T) {
	store := NewConnectorStoreWithMemorySecrets(t.TempDir())
	createConnectorResolutionRecord(t, store, "connector-current", "account-a", runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE, "valid-current-credential")

	resolved, binding, err := ResolveCurrentAccountConnectorBinding(store, newCurrentAccountCatalogResolver(t), "account-a", RemoteModelCatalogRef{
		ProviderModelID: "qwen3-tts-vc",
		Provider:        "dashscope",
	})
	if resolved.ConnectorID != "" || binding != nil {
		t.Fatalf("missing exact target resolved Connector=%+v binding=%+v", resolved, binding)
	}
	assertCurrentAccountResolutionReason(t, err, runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND)
}

func TestResolveCurrentAccountConnectorBindingFailsClosedForForeignConnector(t *testing.T) {
	resolver, err := aicatalog.NewResolver(aicatalog.ResolverConfig{})
	if err != nil {
		t.Fatal(err)
	}
	store := NewConnectorStoreWithMemorySecrets(t.TempDir())
	_, err = store.Create(ConnectorRecord{
		ConnectorID: "connector-current", Kind: runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
		OwnerType: runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER, OwnerID: "account-a",
		Provider: "dashscope", Status: runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
	}, "valid-current-credential")
	if err != nil {
		t.Fatal(err)
	}
	foreign, err := store.Create(ConnectorRecord{
		ConnectorID: "connector-foreign", Kind: runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
		OwnerType: runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER, OwnerID: "account-b",
		Provider: "dashscope", Status: runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
	}, "valid-foreign-credential")
	if err != nil {
		t.Fatal(err)
	}
	foreignRef := catalogRefForConnectorTest(t, resolver, "account-b", foreign, "qwen3-tts-vc")

	_, _, err = ResolveCurrentAccountConnectorBinding(store, resolver, "account-a", foreignRef)
	assertCurrentAccountResolutionReason(t, err, runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND)
}

func TestResolveCurrentAccountConnectorBindingFailsClosedWithoutCredential(t *testing.T) {
	resolver, err := aicatalog.NewResolver(aicatalog.ResolverConfig{})
	if err != nil {
		t.Fatal(err)
	}
	store := NewConnectorStoreWithMemorySecrets(t.TempDir())
	record, err := store.Create(ConnectorRecord{
		ConnectorID: "connector-no-credential", Kind: runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
		OwnerType: runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER, OwnerID: "account-a",
		Provider: "dashscope", Status: runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
	}, "")
	if err != nil {
		t.Fatal(err)
	}
	ref := catalogRefForConnectorTest(t, resolver, "account-a", record, "qwen3-tts-vc")

	_, _, err = ResolveCurrentAccountConnectorBinding(store, resolver, "account-a", ref)
	assertCurrentAccountResolutionReason(t, err, runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING)
}

func TestResolveCurrentAccountConnectorBindingSelectedDisabledWithUnrelatedActiveReturnsDisabled(t *testing.T) {
	resolver := newCurrentAccountCatalogResolver(t)
	store := NewConnectorStoreWithMemorySecrets(t.TempDir())
	selected := createConnectorResolutionRecord(t, store, "connector-selected", "account-a", runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE, "selected-credential")
	ref := catalogRefForConnectorTest(t, resolver, "account-a", selected, "qwen3-tts-vc")
	disabled := runtimev1.ConnectorStatus_CONNECTOR_STATUS_DISABLED
	if _, err := store.Update(selected.ConnectorID, ConnectorMutations{Status: &disabled}); err != nil {
		t.Fatal(err)
	}
	createConnectorResolutionRecord(t, store, "connector-unrelated", "account-a", runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE, "unrelated-credential")

	_, _, err := ResolveCurrentAccountConnectorBinding(store, resolver, "account-a", ref)
	assertCurrentAccountResolutionReason(t, err, runtimev1.ReasonCode_AI_CONNECTOR_DISABLED)
}

func TestResolveCurrentAccountConnectorBindingForeignRefDoesNotLeakDisabledCurrentConnector(t *testing.T) {
	resolver := newCurrentAccountCatalogResolver(t)
	store := NewConnectorStoreWithMemorySecrets(t.TempDir())
	createConnectorResolutionRecord(t, store, "connector-current-disabled", "account-a", runtimev1.ConnectorStatus_CONNECTOR_STATUS_DISABLED, "current-credential")
	foreign := createConnectorResolutionRecord(t, store, "connector-foreign", "account-b", runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE, "foreign-credential")
	foreignRef := catalogRefForConnectorTest(t, resolver, "account-b", foreign, "qwen3-tts-vc")

	_, _, err := ResolveCurrentAccountConnectorBinding(store, resolver, "account-a", foreignRef)
	assertCurrentAccountResolutionReason(t, err, runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND)
}

func TestResolveCurrentAccountConnectorBindingStaleRefDoesNotReportUnrelatedDisabledConnector(t *testing.T) {
	resolver := newCurrentAccountCatalogResolver(t)
	store := NewConnectorStoreWithMemorySecrets(t.TempDir())
	record := createConnectorResolutionRecord(t, store, "connector-current-disabled", "account-a", runtimev1.ConnectorStatus_CONNECTOR_STATUS_DISABLED, "current-credential")
	ref := catalogRefForConnectorTest(t, resolver, "account-a", record, "qwen3-tts-vc")
	ref.RemoteModelCatalogID += "-stale"

	_, _, err := ResolveCurrentAccountConnectorBinding(store, resolver, "account-a", ref)
	assertCurrentAccountResolutionReason(t, err, runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND)
}

func TestResolveCurrentAccountConnectorBindingSelectedMissingCredentialWithUnrelatedActiveReturnsCredentialMissing(t *testing.T) {
	resolver := newCurrentAccountCatalogResolver(t)
	store := NewConnectorStoreWithMemorySecrets(t.TempDir())
	selected := createConnectorResolutionRecord(t, store, "connector-selected", "account-a", runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE, "")
	ref := catalogRefForConnectorTest(t, resolver, "account-a", selected, "qwen3-tts-vc")
	createConnectorResolutionRecord(t, store, "connector-unrelated", "account-a", runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE, "unrelated-credential")

	_, _, err := ResolveCurrentAccountConnectorBinding(store, resolver, "account-a", ref)
	assertCurrentAccountResolutionReason(t, err, runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING)
}

func TestResolveCurrentAccountConnectorBindingCredentialRemovedAfterSelectionReturnsCredentialMissing(t *testing.T) {
	resolver := newCurrentAccountCatalogResolver(t)
	store := NewConnectorStoreWithMemorySecrets(t.TempDir())
	selected := createConnectorResolutionRecord(t, store, "connector-selected", "account-a", runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE, "selected-credential")
	ref := catalogRefForConnectorTest(t, resolver, "account-a", selected, "qwen3-tts-vc")
	empty := ""
	if _, err := store.Update(selected.ConnectorID, ConnectorMutations{SecretPayload: &empty}); err != nil {
		t.Fatal(err)
	}

	_, _, err := ResolveCurrentAccountConnectorBinding(store, resolver, "account-a", ref)
	assertCurrentAccountResolutionReason(t, err, runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING)
}

func TestRemoteModelCatalogIdentityIgnoresCredentialAvailability(t *testing.T) {
	resolver := newCurrentAccountCatalogResolver(t)
	record := ConnectorRecord{
		ConnectorID: "connector-current", Kind: runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
		OwnerType: runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER, OwnerID: "account-a",
		Provider: "dashscope", Status: runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
	}
	withoutCredential := catalogIdentityForConnectorTest(t, resolver, "account-a", record, "qwen3-tts-vc")
	record.HasCredential = true
	withCredential := catalogIdentityForConnectorTest(t, resolver, "account-a", record, "qwen3-tts-vc")
	if withoutCredential != withCredential {
		t.Fatalf("credential availability changed remote catalog identity: without=%+v with=%+v", withoutCredential, withCredential)
	}
}

func newCurrentAccountCatalogResolver(t *testing.T) *aicatalog.Resolver {
	t.Helper()
	resolver, err := aicatalog.NewResolver(aicatalog.ResolverConfig{})
	if err != nil {
		t.Fatal(err)
	}
	return resolver
}

func createConnectorResolutionRecord(
	t *testing.T,
	store *ConnectorStore,
	connectorID string,
	ownerID string,
	status runtimev1.ConnectorStatus,
	secret string,
) ConnectorRecord {
	t.Helper()
	record, err := store.Create(ConnectorRecord{
		ConnectorID: connectorID, Kind: runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
		OwnerType: runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER, OwnerID: ownerID,
		Provider: "dashscope", Status: status,
	}, secret)
	if err != nil {
		t.Fatal(err)
	}
	return record
}

func catalogRefForConnectorTest(t *testing.T, resolver *aicatalog.Resolver, accountID string, record ConnectorRecord, modelID string) RemoteModelCatalogRef {
	t.Helper()
	models, _, err := resolver.ListModelsForProviderForSubject(accountID, record.Provider)
	if err != nil {
		t.Fatal(err)
	}
	providerRecord := catalogProviderRecordForSubject(resolver, accountID, record.Provider)
	for _, model := range models {
		if model.Model.ModelID != modelID {
			continue
		}
		identity := remoteModelCatalogIdentityForConnector(record, providerRecord, model)
		return RemoteModelCatalogRef{
			RemoteModelCatalogID: identity.remoteModelCatalogID,
			ProviderModelID:      catalogProviderModelID(model.Model),
			Provider:             record.Provider,
		}
	}
	t.Fatalf("model %q not found for %s", modelID, record.Provider)
	return RemoteModelCatalogRef{}
}

func catalogIdentityForConnectorTest(t *testing.T, resolver *aicatalog.Resolver, accountID string, record ConnectorRecord, modelID string) remoteModelCatalogIdentity {
	t.Helper()
	models, _, err := resolver.ListModelsForProviderForSubject(accountID, record.Provider)
	if err != nil {
		t.Fatal(err)
	}
	providerRecord := catalogProviderRecordForSubject(resolver, accountID, record.Provider)
	for _, model := range models {
		if model.Model.ModelID == modelID {
			return remoteModelCatalogIdentityForConnector(record, providerRecord, model)
		}
	}
	t.Fatalf("model %q not found for %s", modelID, record.Provider)
	return remoteModelCatalogIdentity{}
}

func assertCurrentAccountResolutionReason(t *testing.T, err error, want runtimev1.ReasonCode) {
	t.Helper()
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != want {
		t.Fatalf("reason=%v present=%v want=%v err=%v", reason, ok, want, err)
	}
}
