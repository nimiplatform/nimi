package connector

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"google.golang.org/grpc/codes"
)

func TestConnectionCheckPersistsSuccessFailureAndDoesNotProbeOnRead(t *testing.T) {
	svc := newTestService(t)
	ctx := userContext("user-1")
	code, hits := http.StatusOK, 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		if r.Header.Get("Authorization") != "Bearer managed-key" {
			t.Error("check did not use the captured credential")
		}
		w.WriteHeader(code)
		_, _ = w.Write([]byte(`{"data":[]}`))
	}))
	defer server.Close()
	svc.SetCloudProvider(nimillm.NewCloudProvider(nimillm.CloudConfig{AllowLoopbackEndpoint: true, HTTPTimeout: time.Second}))
	created, err := svc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{Provider: "openai", Endpoint: server.URL, ApiKey: "managed-key"})
	if err != nil {
		t.Fatal(err)
	}
	id := created.Connector.ConnectorId
	for _, httpCode := range []int{http.StatusOK, http.StatusUnauthorized} {
		code = httpCode
		result, err := svc.TestConnector(ctx, &runtimev1.TestConnectorRequest{ConnectorId: id})
		if err != nil {
			t.Fatal(err)
		}
		check := result.GetConnector().GetLastCheck()
		if check == nil || check.Ok != (code == http.StatusOK) || check.CheckedAt == nil {
			t.Fatalf("bad observation: %v", result)
		}
		reopened := NewConnectorStoreWithSecretStore(filepath.Dir(svc.store.registryPath), svc.store.secretStore)
		stored, found, err := reopened.Get(id)
		if err != nil || !found || stored.LastCheck == nil || stored.LastCheck.OK != check.Ok {
			t.Fatalf("check was not durable: %+v %v", stored, err)
		}
		before := hits
		if _, err := svc.ListConnectors(ctx, &runtimev1.ListConnectorsRequest{}); err != nil {
			t.Fatal(err)
		}
		if hits != before {
			t.Fatal("reading inventory probed the provider")
		}
	}
}

func TestConnectionCheckInvalidationAndStaleCompletion(t *testing.T) {
	store := newTestStore(t)
	record, err := store.Create(ConnectorRecord{ConnectorID: "checked", Provider: "openai", Status: runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE}, "key-one")
	if err != nil {
		t.Fatal(err)
	}
	check := ConnectionCheck{OK: true, Reason: runtimev1.ReasonCode_ACTION_EXECUTED, StartedAt: 10, CheckedAt: 100}
	if _, accepted, err := store.saveConnectionCheck(record, check); err != nil || !accepted {
		t.Fatalf("save: %v", err)
	}
	label := "New name"
	renamed, err := store.Update(record.ConnectorID, ConnectorMutations{Label: &label})
	if err != nil || renamed.LastCheck == nil {
		t.Fatalf("rename lost check: %v", err)
	}
	if _, accepted, err := store.saveConnectionCheck(record, ConnectionCheck{StartedAt: 9}); err != nil || accepted {
		t.Fatalf("older result accepted: %v", err)
	}
	key := "key-two"
	updated, err := store.Update(record.ConnectorID, ConnectorMutations{SecretPayload: &key})
	if err != nil || updated.LastCheck != nil {
		t.Fatalf("new credential retained old check: %v", err)
	}
	if _, accepted, err := store.saveConnectionCheck(record, ConnectionCheck{OK: true, StartedAt: 20}); err != nil || accepted {
		t.Fatalf("old credential result accepted: %v", err)
	}
	if _, accepted, err := store.saveConnectionCheck(updated, check); err != nil || !accepted {
		t.Fatalf("new credential check: %v", err)
	}
	endpoint := "https://other.example"
	updated, err = store.Update(record.ConnectorID, ConnectorMutations{Endpoint: &endpoint})
	if err != nil || updated.LastCheck != nil {
		t.Fatalf("new endpoint retained old check: %v", err)
	}
}

func TestExecutionCredentialRejectionDoesNotConfusePermissionsOrTransport(t *testing.T) {
	store := newTestStore(t)
	record, err := store.Create(ConnectorRecord{ConnectorID: "execution", Provider: "openai", Status: runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE}, "key")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.saveConnectionCheck(record, ConnectionCheck{OK: true, StartedAt: 1, CheckedAt: 1}); err != nil {
		t.Fatal(err)
	}
	for _, code := range []int{403, 404, 429, 500, 504} {
		if err := store.ObserveCredentialFailure(record, time.Now(), nimillm.MapProviderHTTPError(code, nil)); err != nil {
			t.Fatal(err)
		}
		current, _, _ := store.Get(record.ConnectorID)
		if !current.LastCheck.OK {
			t.Fatalf("HTTP %d invalidated credentials", code)
		}
	}
	unauthorized := grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED, grpcerr.ReasonOptions{Metadata: map[string]string{"provider_http_status": "401"}})
	if err := store.ObserveCredentialFailure(record, time.Now(), unauthorized); err != nil {
		t.Fatal(err)
	}
	current, _, _ := store.Get(record.ConnectorID)
	if current.LastCheck.OK || current.LastCheck.Reason != runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED {
		t.Fatal("credential rejection did not update check")
	}
	key := "replacement"
	if _, err := store.Update(record.ConnectorID, ConnectorMutations{SecretPayload: &key}); err != nil {
		t.Fatal(err)
	}
	if err := store.ObserveCredentialFailure(record, time.Now(), unauthorized); err != nil {
		t.Fatal(err)
	}
	current, _, _ = store.Get(record.ConnectorID)
	if current.LastCheck != nil {
		t.Fatal("old request invalidated replacement credential")
	}
}
