package remoteexecution

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestProviderEmbedHostConfinesCredentialToOneAuditedDispatch(t *testing.T) {
	const secret = "embed-host-secret"
	var authorization string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authorization = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"embedding":[0.1,0.2]}],"usage":{"prompt_tokens":1,"total_tokens":1}}`))
	}))
	defer server.Close()

	secrets := &trackingSecretStore{values: map[string]string{}}
	store := connector.NewConnectorStoreWithSecretStore(t.TempDir(), secrets)
	record, err := store.Create(connector.ConnectorRecord{
		Kind: runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED, OwnerType: runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER,
		OwnerID: "account-a", Provider: "openai", Endpoint: server.URL, Status: runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
	}, secret)
	if err != nil {
		t.Fatal(err)
	}
	secrets.mu.Lock()
	secrets.reads = 0
	secrets.mu.Unlock()

	rawTarget, _ := structpb.NewStruct(map[string]any{
		"provider": "openai", "providerModelId": "text-embedding-3-small", "remoteModelCatalogId": "catalog-1",
	})
	driver, target, err := capabilitydriver.NewProductionCloudEmbedRegistry().Resolve(capabilitydriver.Identity{
		ImplementationID: "cloud.text.embed.openai", DriverID: "driver.openai", DriverDialect: "openai/embeddings/v1",
	}, rawTarget)
	if err != nil {
		t.Fatal(err)
	}
	mapped, err := driver.MapRequest(target, &runtimev1.TextEmbedScenarioSpec{Inputs: []string{"hello"}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	audit := auditlog.New(16, 16)
	host := NewProviderEmbedHost(
		store,
		nimillm.NewCloudProvider(nimillm.CloudConfig{HTTPTimeout: time.Second, AllowLoopbackEndpoint: true}),
		audit,
		true,
	)
	response, err := host.ExecuteEmbed(context.Background(), record, target, mapped, EmbedDispatchAudit{
		AppID: "app", AccountID: "account-a", TraceID: "trace", CapabilityContract: "text.embed",
		ImplementationID: "cloud.text.embed.openai", DriverID: "driver.openai", DriverDialect: "openai/embeddings/v1",
		ConnectorID: record.ConnectorID, Provider: "openai", ProviderModelID: "text-embedding-3-small", RemoteModelCatalogID: "catalog-1",
	})
	if err != nil {
		t.Fatalf("ExecuteEmbed: %v", err)
	}
	result, err := driver.NormalizeResponse(mapped, response)
	if err != nil || len(result.Vectors) != 1 {
		t.Fatalf("NormalizeResponse = %+v, %v", result, err)
	}
	if authorization != "Bearer "+secret {
		t.Fatalf("provider authorization = %q", authorization)
	}
	secrets.mu.Lock()
	reads := secrets.reads
	secrets.mu.Unlock()
	if reads != 1 {
		t.Fatalf("credential reads = %d, want one", reads)
	}
	events, err := audit.ListEvents(&runtimev1.ListAuditEventsRequest{})
	if err != nil || len(events.GetEvents()) != 2 {
		t.Fatalf("dispatch audits = %+v, %v", events, err)
	}
	for _, event := range events.GetEvents() {
		raw, _ := protojson.Marshal(event)
		if strings.Contains(string(raw), secret) {
			t.Fatalf("credential leaked to audit: %s", raw)
		}
	}
}

func TestDashscopeEmbedBatchesPreserveOrderTargetCredentialAndCompleteUsage(t *testing.T) {
	for _, report := range []string{"complete", "zero", "missing-first", "missing-last"} {
		t.Run(report, func(t *testing.T) {
			var calls atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				call := int(calls.Add(1))
				var body struct {
					Model      string   `json:"model"`
					Input      []string `json:"input"`
					Dimensions *int     `json:"dimensions"`
				}
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
					return
				}
				wantSize := 10
				if call == 2 {
					wantSize = 6
				}
				if call > 2 || len(body.Input) != wantSize || body.Model != "text-embedding-v4" || body.Dimensions != nil || r.Header.Get("Authorization") != "Bearer embed-host-secret" {
					t.Errorf("unexpected captured batch: call=%d model=%s count=%d", call, body.Model, len(body.Input))
					w.WriteHeader(http.StatusBadRequest)
					return
				}
				// Provider indexes may arrive in reverse order within each HTTP
				// response; the full sixteen-input result must still be ordered.
				data := make([]map[string]any, 0, len(body.Input))
				for index := len(body.Input) - 1; index >= 0; index-- {
					var inputIndex int
					if _, err := fmt.Sscanf(body.Input[index], "input-%d", &inputIndex); err != nil {
						t.Error(err)
					}
					data = append(data, map[string]any{"index": index, "embedding": []float64{float64(inputIndex), 1}})
				}
				response := map[string]any{"data": data}
				if !(report == "missing-first" && call == 1 || report == "missing-last" && call == 2) {
					input, total := len(body.Input), len(body.Input)+call
					if report == "zero" {
						input, total = 0, 0
					}
					response["usage"] = map[string]any{"prompt_tokens": input, "total_tokens": total}
				}
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(response)
			}))
			defer server.Close()
			host, record, target, mapped, driver, audit, dispatch, secrets := dashscopeEmbedBatchFixture(t, server.URL)
			response, err := host.ExecuteEmbed(context.Background(), record, target, mapped, dispatch)
			if err != nil {
				t.Fatal(err)
			}
			result, err := driver.NormalizeResponse(mapped, response)
			if err != nil || len(result.Vectors) != 16 || calls.Load() != 2 {
				t.Fatalf("result=%+v err=%v calls=%d", result, err, calls.Load())
			}
			for index, vector := range result.Vectors {
				if vector.Values[0] != float64(index) || len(vector.Values) != 2 {
					t.Fatalf("vector order/width changed at %d", index)
				}
			}
			switch report {
			case "complete":
				if result.Usage == nil || result.Usage.GetInputTokens() != 16 || result.Usage.GetOutputTokens() != 3 || result.Usage.GetComputeMs() != 0 {
					t.Fatalf("usage=%+v", result.Usage)
				}
			case "zero":
				if result.Usage == nil || result.Usage.GetInputTokens() != 0 || result.Usage.GetOutputTokens() != 0 {
					t.Fatalf("reported zero usage=%+v", result.Usage)
				}
			default:
				if result.Usage != nil {
					t.Fatalf("partial usage became complete: %+v", result.Usage)
				}
			}
			secrets.mu.Lock()
			reads := secrets.reads
			secrets.mu.Unlock()
			if reads != 1 {
				t.Fatalf("credential opened %d times, want once", reads)
			}
			events, err := audit.ListEvents(&runtimev1.ListAuditEventsRequest{})
			if err != nil || len(events.GetEvents()) != 2 {
				t.Fatalf("one logical dispatch must have two audits: %+v %v", events, err)
			}
			for _, event := range events.GetEvents() {
				raw, _ := protojson.Marshal(event)
				if strings.Contains(string(raw), "embed-host-secret") {
					t.Fatal("credential entered audit")
				}
			}
		})
	}
}

func TestDashscopeEmbedLaterFailureReturnsNoPartialResult(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 2 {
			http.Error(w, `{"error":{"message":"rejected"}}`, http.StatusBadRequest)
			return
		}
		writeEmbedBatchSuccess(t, w, r)
	}))
	defer server.Close()
	host, record, target, mapped, driver, audit, dispatch, _ := dashscopeEmbedBatchFixture(t, server.URL)
	response, err := host.ExecuteEmbed(context.Background(), record, target, mapped, dispatch)
	if err == nil || response.Vectors != nil || response.Usage != nil || calls.Load() != 2 {
		t.Fatalf("partial success: %+v %v calls=%d", response, err, calls.Load())
	}
	if reason, _ := grpcerr.ExtractReasonCode(driver.NormalizeReason(err)); reason != runtimev1.ReasonCode_AI_INPUT_INVALID {
		t.Fatalf("reason=%v", reason)
	}
	events, _ := audit.ListEvents(&runtimev1.ListAuditEventsRequest{})
	for _, event := range events.GetEvents() {
		if strings.HasSuffix(event.Operation, ".complete") {
			t.Fatal("failed batch recorded complete")
		}
	}
}

func TestDashscopeEmbedCancellationStopsAnInflightLaterBatch(t *testing.T) {
	var calls atomic.Int32
	secondStarted := make(chan struct{})
	secondCanceled := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			writeEmbedBatchSuccess(t, w, r)
			return
		}
		_, _ = io.Copy(io.Discard, r.Body)
		_ = r.Body.Close()
		close(secondStarted)
		<-r.Context().Done()
		close(secondCanceled)
	}))
	defer server.Close()
	host, record, target, mapped, _, _, dispatch, _ := dashscopeEmbedBatchFixture(t, server.URL)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	type outcome struct {
		response capabilitydriver.CloudEmbedTransportResponse
		err      error
	}
	done := make(chan outcome, 1)
	go func() {
		response, err := host.ExecuteEmbed(ctx, record, target, mapped, dispatch)
		done <- outcome{response, err}
	}()
	select {
	case <-secondStarted:
	case <-time.After(5 * time.Second):
		t.Fatal("second batch did not start")
	}
	cancel()
	select {
	case result := <-done:
		if !errors.Is(result.err, context.Canceled) || result.response.Vectors != nil || result.response.Usage != nil {
			t.Fatalf("cancellation returned partial success: %+v", result)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("cancellation did not settle")
	}
	select {
	case <-secondCanceled:
	case <-time.After(5 * time.Second):
		t.Fatal("provider transport was not canceled")
	}
	if calls.Load() != 2 {
		t.Fatalf("calls=%d", calls.Load())
	}
}

func writeEmbedBatchSuccess(t *testing.T, w http.ResponseWriter, r *http.Request) {
	t.Helper()
	var body struct {
		Input []string `json:"input"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		t.Error(err)
		return
	}
	data := make([]map[string]any, len(body.Input))
	for index := range data {
		data[index] = map[string]any{"index": index, "embedding": []float64{1, 2}}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"data": data})
}

func dashscopeEmbedBatchFixture(t *testing.T, endpoint string) (*ProviderEmbedHost, connector.ConnectorRecord, capabilitydriver.CloudEmbedTarget, *capabilitydriver.CloudEmbedMappedRequest, capabilitydriver.CloudEmbedDriver, *auditlog.Store, EmbedDispatchAudit, *trackingSecretStore) {
	t.Helper()
	secrets := &trackingSecretStore{values: map[string]string{}}
	store := connector.NewConnectorStoreWithSecretStore(t.TempDir(), secrets)
	record, err := store.Create(connector.ConnectorRecord{
		Kind: runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED, OwnerType: runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER,
		OwnerID: "account-a", Provider: "dashscope", Endpoint: endpoint, Status: runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
	}, "embed-host-secret")
	if err != nil {
		t.Fatal(err)
	}
	secrets.mu.Lock()
	secrets.reads = 0
	secrets.mu.Unlock()
	raw, _ := structpb.NewStruct(map[string]any{"provider": "dashscope", "providerModelId": "text-embedding-v4", "remoteModelCatalogId": "catalog-1"})
	driver, target, err := capabilitydriver.NewProductionCloudEmbedRegistry().Resolve(capabilitydriver.Identity{ImplementationID: "cloud.text.embed.dashscope", DriverID: "driver.dashscope", DriverDialect: "dashscope/embeddings/v1"}, raw)
	if err != nil {
		t.Fatal(err)
	}
	inputs := make([]string, 16)
	for index := range inputs {
		inputs[index] = fmt.Sprintf("input-%d", index)
	}
	mapped, err := driver.MapRequest(target, &runtimev1.TextEmbedScenarioSpec{Inputs: inputs, Purpose: runtimev1.TextEmbedPurpose_TEXT_EMBED_PURPOSE_RETRIEVAL_DOCUMENT}, nil)
	if err != nil {
		t.Fatal(err)
	}
	audit := auditlog.New(16, 16)
	host := NewProviderEmbedHost(store, nimillm.NewCloudProvider(nimillm.CloudConfig{HTTPTimeout: 10 * time.Second, AllowLoopbackEndpoint: true}), audit, true)
	dispatch := EmbedDispatchAudit{AppID: "app", AccountID: "account-a", TraceID: "trace", CapabilityContract: "text.embed", ImplementationID: "cloud.text.embed.dashscope", DriverID: "driver.dashscope", DriverDialect: "dashscope/embeddings/v1", ConnectorID: record.ConnectorID, Provider: "dashscope", ProviderModelID: "text-embedding-v4", RemoteModelCatalogID: "catalog-1"}
	return host, record, target, mapped, driver, audit, dispatch, secrets
}
