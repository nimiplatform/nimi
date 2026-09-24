package remoteexecution

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/structpb"
)

const decideHostAccountID = "account-a"

type decideHostFixture struct {
	host    *ProviderDecideHost
	record  connector.ConnectorRecord
	driver  capabilitydriver.CloudDecideDriver
	target  capabilitydriver.CloudDecideTarget
	mapped  *capabilitydriver.CloudDecideMappedRequest
	audit   *auditlog.Store
	secrets *trackingSecretStore
}

func newDecideHostFixture(t *testing.T, endpoint string, secret string) decideHostFixture {
	t.Helper()
	secrets := &trackingSecretStore{values: map[string]string{}}
	store := connector.NewConnectorStoreWithSecretStore(t.TempDir(), secrets)
	record, err := store.Create(connector.ConnectorRecord{
		Kind: runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED, OwnerType: runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER,
		OwnerID: decideHostAccountID, Provider: capabilitydriver.TypeSafeProviderID, Endpoint: endpoint, Status: runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
	}, secret)
	if err != nil {
		t.Fatal(err)
	}
	rawTarget, _ := structpb.NewStruct(map[string]any{
		"provider": capabilitydriver.TypeSafeProviderID, "providerModelId": "jev-1.13.0", "remoteModelCatalogId": "catalog-1",
	})
	driver, target, err := capabilitydriver.NewProductionCloudDecideRegistry().Resolve(capabilitydriver.Identity{
		ImplementationID: capabilitydriver.TypeSafeProviderID, DriverID: "nimillm", DriverDialect: capabilitydriver.TypeSafeProviderID,
	}, rawTarget)
	if err != nil {
		t.Fatal(err)
	}
	mapped, err := driver.MapRequest(target, &runtimev1.TextDecideScenarioSpec{
		State: &runtimev1.TextDecisionContent{Value: &runtimev1.TextDecisionContent_Text{Text: "My payouts are failing."}},
		Questions: []*runtimev1.TextDecisionQuestion{
			{Id: "urgent", Instructions: &runtimev1.TextDecisionContent{Value: &runtimev1.TextDecisionContent_Text{Text: "Urgent?"}},
				Kind: &runtimev1.TextDecisionQuestion_Boolean{Boolean: &runtimev1.TextDecisionBoolean{}}},
			{Id: "team", Instructions: &runtimev1.TextDecisionContent{Value: &runtimev1.TextDecisionContent_Text{Text: "Which team?"}},
				Kind: &runtimev1.TextDecisionQuestion_Choice{Choice: &runtimev1.TextDecisionChoice{Candidates: []*runtimev1.TextDecisionCandidate{
					{Id: "billing"}, {Id: "technical"},
				}}}},
		},
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	audit := auditlog.New(64, 64)
	host := NewProviderDecideHost(store, nimillm.NewCloudProvider(nimillm.CloudConfig{HTTPTimeout: 5 * time.Second, AllowLoopbackEndpoint: true}), audit, true)
	secrets.mu.Lock()
	secrets.reads = 0
	secrets.mu.Unlock()
	return decideHostFixture{host: host, record: record, driver: driver, target: target, mapped: mapped, audit: audit, secrets: secrets}
}

func (f decideHostFixture) dispatchAudit() DecideDispatchAudit {
	return DecideDispatchAudit{
		AppID: "app", AccountID: decideHostAccountID, TraceID: "trace-decide", CapabilityContract: "text.decide",
		ImplementationID: capabilitydriver.TypeSafeProviderID, DriverID: "nimillm", DriverDialect: capabilitydriver.TypeSafeProviderID,
		ConnectorID: f.record.ConnectorID, Provider: capabilitydriver.TypeSafeProviderID, ProviderModelID: "jev-1.13.0", RemoteModelCatalogID: "catalog-1",
	}
}

func (f decideHostFixture) auditPhases(t *testing.T, secret string) []string {
	t.Helper()
	events, err := f.audit.ListEvents(&runtimev1.ListAuditEventsRequest{})
	if err != nil {
		t.Fatal(err)
	}
	// ListEvents is newest first; return chronological operations.
	phases := make([]string, 0, len(events.GetEvents()))
	for index := len(events.GetEvents()) - 1; index >= 0; index-- {
		event := events.GetEvents()[index]
		raw, _ := protojson.Marshal(event)
		if secret != "" && strings.Contains(string(raw), secret) {
			t.Fatalf("credential leaked to audit: %s", raw)
		}
		phases = append(phases, event.GetOperation())
	}
	return phases
}

const decideHostValidResponse = `{"model":"jev-1.13.0","answers":{"team":{"type":"choice","choice":"billing","probabilities":{"technical":0.25,"billing":0.75},"confidence":0.6},"urgent":{"type":"noul","noul":0.9}},"usage":{"input_tokens":42,"output_tokens":3}}`

func TestProviderDecideHostSendsExactSystemOneRequestWithCapturedCredential(t *testing.T) {
	for _, suffix := range []string{"", "/v1"} {
		t.Run("endpoint"+suffix, func(t *testing.T) {
			const secret = "typesafe-host-secret"
			var (
				mu          sync.Mutex
				method      string
				path        string
				auth        string
				contentType string
				body        []byte
			)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				raw, _ := io.ReadAll(r.Body)
				mu.Lock()
				method, path, auth, contentType, body = r.Method, r.URL.Path, r.Header.Get("Authorization"), r.Header.Get("Content-Type"), raw
				mu.Unlock()
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(decideHostValidResponse))
			}))
			defer server.Close()
			fixture := newDecideHostFixture(t, server.URL+suffix, secret)
			response, err := fixture.host.ExecuteDecide(context.Background(), fixture.record, fixture.target, fixture.mapped, fixture.dispatchAudit())
			if err != nil {
				t.Fatalf("ExecuteDecide: %v", err)
			}
			mu.Lock()
			defer mu.Unlock()
			if method != http.MethodPost || path != nimillm.TypeSafeSystemOnePath {
				t.Fatalf("dispatch = %s %s", method, path)
			}
			if auth != "Bearer "+secret || contentType != "application/json" {
				t.Fatalf("headers authorization=%q content-type=%q", auth, contentType)
			}
			if string(body) != string(fixture.mapped.Body()) {
				t.Fatalf("wire body = %s\nwant %s", body, fixture.mapped.Body())
			}
			result, err := fixture.driver.NormalizeResponse(fixture.mapped, response)
			if err != nil {
				t.Fatalf("NormalizeResponse: %v", err)
			}
			answers := result.Result.GetAnswers()
			if len(answers) != 2 || answers[0].GetQuestionId() != "urgent" || answers[0].GetBoolean().GetTrueProbability() != 0.9 ||
				answers[1].GetChoice().GetSelectedCandidateId() != "billing" ||
				answers[1].GetChoice().GetProbabilities()[0].GetCandidateId() != "billing" ||
				answers[1].GetChoice().GetProbabilities()[1].GetProbability() != 0.25 {
				t.Fatalf("normalized answers = %v", result.Result)
			}
			if result.Usage.GetInputTokens() != 42 {
				t.Fatalf("usage = %+v", result.Usage)
			}
			fixture.secrets.mu.Lock()
			reads := fixture.secrets.reads
			fixture.secrets.mu.Unlock()
			if reads != 1 {
				t.Fatalf("credential reads = %d, want exactly one request-scoped read", reads)
			}
			phases := fixture.auditPhases(t, secret)
			if len(phases) != 2 || phases[0] != "remote_execution_host.decide.dispatch" || phases[1] != "remote_execution_host.decide.complete" {
				t.Fatalf("audit phases = %v", phases)
			}
		})
	}
}

func TestProviderDecideHostMapsProviderStatusesWithoutRetry(t *testing.T) {
	for statusCode, expected := range map[int]runtimev1.ReasonCode{
		http.StatusUnauthorized:        runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED,
		http.StatusForbidden:           runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED,
		http.StatusUnprocessableEntity: runtimev1.ReasonCode_AI_INPUT_INVALID,
		http.StatusTooManyRequests:     runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED,
		529:                            runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
		http.StatusServiceUnavailable:  runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
		http.StatusInternalServerError: runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
		http.StatusGatewayTimeout:      runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT,
	} {
		t.Run(strconv.Itoa(statusCode), func(t *testing.T) {
			var calls atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(statusCode)
				// Provider error text must never steer the reason.
				_, _ = w.Write([]byte(`{"detail":"invalid api key; content policy; model not found"}`))
			}))
			defer server.Close()
			const secret = "typesafe-status-secret"
			fixture := newDecideHostFixture(t, server.URL, secret)
			_, err := fixture.host.ExecuteDecide(context.Background(), fixture.record, fixture.target, fixture.mapped, fixture.dispatchAudit())
			if err == nil {
				t.Fatal("provider failure returned success")
			}
			normalized := fixture.driver.NormalizeReason(err)
			if reason, _ := grpcerr.ExtractReasonCode(normalized); reason != expected {
				t.Fatalf("status %d reason = %s, want %s (err=%v)", statusCode, reason, expected, normalized)
			}
			if strings.Contains(normalized.Error(), "invalid api key") {
				t.Fatalf("provider error text leaked: %v", normalized)
			}
			if calls.Load() != 1 {
				t.Fatalf("provider calls = %d, want exactly one without retry", calls.Load())
			}
			phases := fixture.auditPhases(t, secret)
			if len(phases) != 2 || phases[0] != "remote_execution_host.decide.dispatch" || phases[1] != "remote_execution_host.decide.error" {
				t.Fatalf("audit phases = %v", phases)
			}
		})
	}
}

func TestProviderDecideHostCancellationReturnsNoResponse(t *testing.T) {
	const secret = "typesafe-cancel-secret"
	entered := make(chan struct{})
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Consuming the body lets the server observe the client disconnect.
		_, _ = io.ReadAll(r.Body)
		close(entered)
		select {
		case <-r.Context().Done():
		case <-release:
		}
	}))
	defer server.Close()
	defer close(release)
	fixture := newDecideHostFixture(t, server.URL, secret)
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		<-entered
		cancel()
	}()
	response, err := fixture.host.ExecuteDecide(ctx, fixture.record, fixture.target, fixture.mapped, fixture.dispatchAudit())
	if err == nil || len(response.Body) != 0 {
		t.Fatalf("canceled dispatch = %q, %v", response.Body, err)
	}
	if code := status.Code(fixture.driver.NormalizeReason(err)); code != codes.Canceled {
		t.Fatalf("canceled reason code = %s (%v)", code, err)
	}
	phases := fixture.auditPhases(t, secret)
	if len(phases) != 2 || phases[0] != "remote_execution_host.decide.dispatch" || phases[1] != "remote_execution_host.decide.canceled" {
		t.Fatalf("audit phases = %v", phases)
	}
}

func TestProviderDecideHostRejectsMissingCredentialBeforeDispatch(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { calls.Add(1) }))
	defer server.Close()
	fixture := newDecideHostFixture(t, server.URL, "")
	_, err := fixture.host.ExecuteDecide(context.Background(), fixture.record, fixture.target, fixture.mapped, fixture.dispatchAudit())
	if reason, _ := grpcerr.ExtractReasonCode(fixture.driver.NormalizeReason(err)); reason != runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING {
		t.Fatalf("missing credential reason = %s (%v)", reason, err)
	}
	if calls.Load() != 0 {
		t.Fatalf("provider was called %d times without a credential", calls.Load())
	}
}
