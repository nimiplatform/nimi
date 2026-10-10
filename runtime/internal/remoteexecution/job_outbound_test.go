package remoteexecution

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
)

func TestJobHTTPHandoffReleasesConnectorBeforeResponseAndFencesNextIO(t *testing.T) {
	entered, finish := make(chan struct{}), make(chan struct{})
	var finishOnce, enterOnce sync.Once
	releaseResponse := func() { finishOnce.Do(func() { close(finish) }) }
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		enterOnce.Do(func() { close(entered) })
		<-finish
		_, _ = fmt.Fprint(w, `{"result":"original"}`)
	}))
	defer server.Close()
	defer releaseResponse()
	store := connector.NewConnectorStoreWithMemorySecrets(t.TempDir())
	record, err := store.Create(connector.ConnectorRecord{ConnectorID: "original", Kind: runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED, OwnerType: runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER, OwnerID: "owner", Provider: "openai", Endpoint: server.URL, Status: runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE}, "key")
	if err != nil {
		t.Fatal(err)
	}
	captured, ref, err := store.CaptureCredentialCustody(record.ConnectorID, "job-original")
	if err != nil {
		t.Fatal(err)
	}
	captured.CredentialCustodyRef = ref
	host := NewProviderMediaHost(store, nil, nil, true)
	ctx := host.jobOutboundContext(nimillm.WithMediaAdapterEndpointPolicy(WithAsyncJob(context.Background()), nimillm.MediaAdapterConfig{AllowLoopbackEndpoint: true}), captured, MediaDispatchAudit{AccountID: "owner"})
	completed := make(chan error, 1)
	go func() {
		var response map[string]any
		completed <- nimillm.DoJSONRequestWithHeaders(ctx, http.MethodGet, server.URL, "key", nil, &response, nil)
	}()
	select {
	case <-entered:
	case <-time.After(time.Second):
		releaseResponse()
		t.Fatal("HTTP handoff did not reach actual transport")
	}
	disabled := runtimev1.ConnectorStatus_CONNECTOR_STATUS_DISABLED
	mutated := make(chan error, 1)
	go func() {
		_, err := store.Update(record.ConnectorID, connector.ConnectorMutations{Status: &disabled})
		mutated <- err
	}()
	select {
	case err := <-mutated:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		releaseResponse()
		t.Fatal("Connector guard waited for response headers")
	}
	releaseResponse()
	if err := <-completed; err != nil {
		t.Fatalf("already admitted IO was retracted: %v", err)
	}
	var response map[string]any
	err = nimillm.DoJSONRequestWithHeaders(ctx, http.MethodGet, server.URL, "key", nil, &response, nil)
	if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_CONNECTOR_DISABLED || calls.Load() != 1 {
		t.Fatalf("fresh IO bypassed mutation: calls=%d err=%v", calls.Load(), err)
	}
}
