package ai

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

const (
	cloudDecideAppID  = "app.decide"
	cloudDecideUserID = "user-001"
	cloudDecideModel  = "jev-1.13.0"
)

func cloudDecideText(value string) *runtimev1.TextDecisionContent {
	return &runtimev1.TextDecisionContent{Value: &runtimev1.TextDecisionContent_Text{Text: value}}
}

func cloudDecideJSON(value string) *runtimev1.TextDecisionContent {
	return &runtimev1.TextDecisionContent{Value: &runtimev1.TextDecisionContent_Json{Json: value}}
}

func cloudDecideSpec() *runtimev1.TextDecideScenarioSpec {
	return &runtimev1.TextDecideScenarioSpec{
		State: cloudDecideJSON(`{"ticket":"Payouts failing for 3 days","tier":"pro","amounts":[12.50,1e2]}`),
		Questions: []*runtimev1.TextDecisionQuestion{
			{Id: "team", Instructions: cloudDecideText("Which team should handle this?"), Kind: &runtimev1.TextDecisionQuestion_Choice{
				Choice: &runtimev1.TextDecisionChoice{Candidates: []*runtimev1.TextDecisionCandidate{
					{Id: "technical", Description: cloudDecideText("Bugs, outages, integrations")},
					{Id: "billing", Description: cloudDecideJSON(`{"covers":["payments","refunds"]}`)},
					{Id: "sales"},
				}},
			}},
			{Id: "urgent", Instructions: cloudDecideText("Is this urgent?"), Kind: &runtimev1.TextDecisionQuestion_Boolean{
				Boolean: &runtimev1.TextDecisionBoolean{TrueCriterion: cloudDecideText("Explicitly time-sensitive")},
			}},
		},
	}
}

const cloudDecideWantBody = `{"state":{"ticket":"Payouts failing for 3 days","tier":"pro","amounts":[12.50,1e2]},"model":"jev-1.13.0","questions":{` +
	`"team":{"type":"choice","instructions":"Which team should handle this?","criteria":{"technical":"Bugs, outages, integrations","billing":{"covers":["payments","refunds"]},"sales":null}},` +
	`"urgent":{"type":"noul","instructions":"Is this urgent?","criteria":{"true":"Explicitly time-sensitive"}}}}`

const cloudDecideValidResponse = `{"model":"jev-1.13.0","answers":{"urgent":{"type":"noul","noul":0.91},` +
	`"team":{"type":"choice","choice":"billing","probabilities":{"sales":0.02,"billing":0.86,"technical":0.12},"confidence":0.8}},` +
	`"usage":{"input_tokens":120,"output_tokens":7}}`

func cloudDecideWantResult() *runtimev1.TextDecisionResult {
	return &runtimev1.TextDecisionResult{Answers: []*runtimev1.TextDecisionAnswer{
		{QuestionId: "team", Result: &runtimev1.TextDecisionAnswer_Choice{Choice: &runtimev1.TextDecisionChoiceAnswer{
			SelectedCandidateId: "billing",
			Probabilities: []*runtimev1.TextDecisionCandidateProbability{
				{CandidateId: "technical", Probability: 0.12},
				{CandidateId: "billing", Probability: 0.86},
				{CandidateId: "sales", Probability: 0.02},
			},
		}}},
		{QuestionId: "urgent", Result: &runtimev1.TextDecisionAnswer_Boolean{Boolean: &runtimev1.TextDecisionBooleanAnswer{TrueProbability: 0.91}}},
	}}
}

type cloudDecideHarness struct {
	fixture managedCloudScenarioTestFixture
	server  *httptest.Server
	ctx     context.Context
	calls   *atomic.Int32
	target  *structpb.Struct
	impl    *runtimev1.CapabilityImplementationIdentity
}

func newCloudDecideHarness(t *testing.T, handler http.HandlerFunc) cloudDecideHarness {
	t.Helper()
	calls := &atomic.Int32{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		handler(w, r)
	}))
	t.Cleanup(server.Close)
	fixture := newManagedCloudScenarioTestFixture(t, "typesafe", cloudDecideModel, server.URL, Config{
		CloudProviders:        map[string]nimillm.ProviderCredentials{},
		AllowLoopbackEndpoint: true,
	})
	harness := cloudDecideHarness{fixture: fixture, server: server, ctx: scenarioJobUserContext(cloudDecideAppID, cloudDecideUserID), calls: calls}
	harness.impl, harness.target = harness.targetOption(t, fixture.connectorID)
	harness.commit(t, fixture.connectorID, harness.impl, harness.target, nil)
	return harness
}

// targetOption uses the public AIConfig option projection, so the committed
// identity is exactly what Desktop would offer for a TypeSafe Connector.
func (h cloudDecideHarness) targetOption(t *testing.T, connectorRef string) (*runtimev1.CapabilityImplementationIdentity, *structpb.Struct) {
	t.Helper()
	options, _, err := connector.ListAIConfigCloudTargetOptions(h.fixture.service.connStore, h.fixture.service.speechCatalog, cloudDecideUserID, "text.decide", connectorRef, "", 100)
	if err != nil {
		t.Fatalf("ListAIConfigCloudTargetOptions: %v", err)
	}
	if len(options) != 3 {
		t.Fatalf("TypeSafe text.decide targets = %d, want jev-1.13.0, jev-latest and jev-preview", len(options))
	}
	for _, option := range options {
		if option.ProviderTarget.GetFields()["providerModelId"].GetStringValue() != cloudDecideModel {
			continue
		}
		want := &runtimev1.CapabilityImplementationIdentity{ImplementationId: "typesafe", DriverId: "nimillm", DriverDialect: "typesafe"}
		if !proto.Equal(option.Implementation, want) {
			t.Fatalf("AIConfig implementation = %v, want %v", option.Implementation, want)
		}
		return option.Implementation, option.ProviderTarget
	}
	t.Fatalf("no %s target option", cloudDecideModel)
	return nil, nil
}

func (h cloudDecideHarness) commit(t *testing.T, connectorRef string, implementation *runtimev1.CapabilityImplementationIdentity, target *structpb.Struct, defaults *structpb.Struct) {
	t.Helper()
	config := appAIConfig(cloudDecideAppID, &runtimev1.AIConfigCapabilityIntent{
		CapabilityContract: "text.decide",
		Defaults:           defaults,
		Route: &runtimev1.AIConfigCapabilityIntent_Cloud{Cloud: &runtimev1.AIConfigCloudIntent{
			ConnectorRef: connectorRef, Implementation: implementation, ProviderModelTarget: target,
		}},
	})
	if err := overwriteAIConfigStoreForTest(h.ctx, h.fixture.service.aiConfigStore, cloudDecideUserID, config); err != nil {
		t.Fatalf("store AIConfig: %v", err)
	}
}

func (h cloudDecideHarness) execute(ctx context.Context, timeoutMS int32) (*runtimev1.ExecuteScenarioResponse, error) {
	return h.fixture.service.ExecuteScenario(ctx, &runtimev1.ExecuteScenarioRequest{
		Head:          &runtimev1.ScenarioRequestHead{AppId: cloudDecideAppID, SubjectUserId: cloudDecideUserID, TimeoutMs: timeoutMS},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_DECIDE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Spec:          &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_TextDecide{TextDecide: cloudDecideSpec()}},
	})
}

func (h cloudDecideHarness) jobs() []*scenarioJobRecord {
	store := h.fixture.service.scenarioJobs
	store.mu.RLock()
	defer store.mu.RUnlock()
	records := make([]*scenarioJobRecord, 0, len(store.jobs))
	for _, record := range store.jobs {
		records = append(records, record)
	}
	return records
}

func requireCloudDecideReason(t *testing.T, err error, want runtimev1.ReasonCode) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected %s, got success", want)
	}
	if got, _ := grpcerr.ExtractReasonCode(err); got != want {
		t.Fatalf("reason = %s, want %s (err=%v)", got, want, err)
	}
}

func TestCloudTextDecisionExecutesThroughCapturedImmediateJob(t *testing.T) {
	var (
		mu     sync.Mutex
		path   string
		auth   string
		accept string
		body   []byte
	)
	harness := newCloudDecideHarness(t, func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		mu.Lock()
		path, auth, accept, body = r.Method+" "+r.URL.Path, r.Header.Get("Authorization"), r.Header.Get("Content-Type"), raw
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(cloudDecideValidResponse))
	})
	store, _ := newDurableScenarioJobStoreForFailureTest(t)
	harness.fixture.service.scenarioJobs = store
	if _, _, err := connector.ValidateAIConfigCloudSelection(
		harness.fixture.service.connStore, harness.fixture.service.speechCatalog, cloudDecideUserID, "text.decide", harness.impl,
		connector.RemoteModelCatalogRef{
			ConnectorID: harness.fixture.connectorID, Provider: "typesafe", ProviderModelID: cloudDecideModel,
			RemoteModelCatalogID: harness.target.GetFields()["remoteModelCatalogId"].GetStringValue(),
		},
	); err != nil {
		t.Fatalf("AIConfig commit validation rejected the TypeSafe target: %v", err)
	}

	response, err := harness.execute(harness.ctx, 10_000)
	if err != nil {
		t.Fatalf("ExecuteScenario(text.decide): %v", err)
	}
	mu.Lock()
	if path != "POST /v1/systemone" || auth != "Bearer test-key" || accept != "application/json" {
		t.Fatalf("dispatch %q authorization=%q content-type=%q", path, auth, accept)
	}
	if string(body) != cloudDecideWantBody {
		t.Fatalf("wire body mismatch:\n got=%s\nwant=%s", body, cloudDecideWantBody)
	}
	mu.Unlock()
	if !proto.Equal(response.GetOutput().GetTextDecision(), cloudDecideWantResult()) {
		t.Fatalf("decision = %v\nwant %v", response.GetOutput().GetTextDecision(), cloudDecideWantResult())
	}
	if response.GetRouteDecision() != runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD || response.GetModelResolved() != cloudDecideModel ||
		response.GetFinishReason() != runtimev1.FinishReason_FINISH_REASON_STOP || response.GetTraceId() == "" {
		t.Fatalf("response diagnostics = %+v", response)
	}
	if response.GetUsage().GetInputTokens() != 120 || response.GetUsage().GetOutputTokens() != 7 {
		t.Fatalf("usage = %+v", response.GetUsage())
	}
	if harness.calls.Load() != 1 {
		t.Fatalf("provider calls = %d", harness.calls.Load())
	}

	records := harness.jobs()
	if len(records) != 1 {
		t.Fatalf("immediate jobs = %d, want 1", len(records))
	}
	record := records[0]
	if record.job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED ||
		record.job.GetScenarioType() != runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_DECIDE ||
		record.job.GetRouteDecision() != runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD ||
		record.job.GetModelResolved() != cloudDecideModel || record.job.GetTraceId() != response.GetTraceId() {
		t.Fatalf("terminal job = %+v", record.job)
	}
	assembly := record.cloudAssembly
	if assembly == nil || assembly.RequestKind != cloudResolvedRequestDecide || assembly.CapabilityContract != "text.decide" ||
		assembly.ExecutionMode != runtimev1.ExecutionMode_EXECUTION_MODE_SYNC || assembly.CredentialCustodyRef != "" {
		t.Fatalf("captured assembly = %+v", assembly)
	}
	captured := &runtimev1.TextDecideScenarioSpec{}
	if err := protojson.Unmarshal(assembly.Request, captured); err != nil || !proto.Equal(captured, cloudDecideSpec()) {
		t.Fatalf("captured request = %v, err=%v", captured, err)
	}
	raw, err := os.ReadFile(store.durablePath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(raw, []byte("cloud_resolved_assembly")) || bytes.Contains(raw, []byte("test-key")) {
		t.Fatalf("durable capture must hold the assembly and no credential: %s", raw)
	}
}

func TestCloudTextDecisionMapsProviderFailuresWithoutRetryOrSuccess(t *testing.T) {
	for statusCode, want := range map[int]runtimev1.ReasonCode{
		http.StatusUnauthorized:        runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED,
		http.StatusUnprocessableEntity: runtimev1.ReasonCode_AI_INPUT_INVALID,
		http.StatusTooManyRequests:     runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED,
		529:                            runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
		http.StatusInternalServerError: runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
	} {
		t.Run(strconv.Itoa(statusCode), func(t *testing.T) {
			harness := newCloudDecideHarness(t, func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(statusCode)
				_, _ = w.Write([]byte(`{"detail":"invalid api key"}`))
			})
			response, err := harness.execute(harness.ctx, 10_000)
			if response != nil {
				t.Fatalf("provider failure returned a response: %+v", response)
			}
			requireCloudDecideReason(t, err, want)
			if harness.calls.Load() != 1 {
				t.Fatalf("provider calls = %d, want exactly one", harness.calls.Load())
			}
			records := harness.jobs()
			if len(records) != 1 || records[0].job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED ||
				records[0].job.GetReasonCode() != want {
				t.Fatalf("terminal job = %+v", records)
			}
		})
	}
}

func TestCloudTextDecisionLogsOnlyTheClassOfAFailureBeforeAnyProviderStatus(t *testing.T) {
	const message = "cloud decision request failed before a provider status"
	logged := func(t *testing.T, handler http.HandlerFunc) (string, cloudDecideHarness, error) {
		harness := newCloudDecideHarness(t, handler)
		var logs bytes.Buffer
		harness.fixture.service.logger = slog.New(slog.NewTextHandler(&logs, nil))
		_, err := harness.execute(harness.ctx, 10_000)
		for _, line := range strings.Split(logs.String(), "\n") {
			if strings.Contains(line, message) {
				return line, harness, err
			}
		}
		return "", harness, err
	}
	// The provider closes the connection without answering.
	line, harness, err := logged(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		conn, _, hijackErr := w.(http.Hijacker).Hijack()
		if hijackErr != nil {
			t.Error(hijackErr)
			return
		}
		_ = conn.Close()
	})
	requireCloudDecideReason(t, err, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	records := harness.jobs()
	if len(records) != 1 || !strings.Contains(line, "failure_class=eof") || !strings.Contains(line, "job_id="+records[0].job.GetJobId()) ||
		strings.Contains(line, harness.server.URL) || strings.Contains(line, "127.0.0.1") {
		t.Fatalf("transport failure log = %q", line)
	}
	// A provider that answers with a status is not a transport failure.
	line, _, err = logged(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	})
	requireCloudDecideReason(t, err, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	if line != "" {
		t.Fatalf("provider status logged as a transport failure: %q", line)
	}
}

func TestCloudTextDecisionRejectsInvalidProviderOutputBeforeCompletingJob(t *testing.T) {
	for name, body := range map[string]string{
		"unnormalized": `{"answers":{"urgent":{"type":"noul","noul":0.5},"team":{"type":"choice","choice":"billing","probabilities":{"technical":0.1,"billing":0.3,"sales":0.1}}}}`,
		"inconsistent": `{"answers":{"urgent":{"type":"noul","noul":0.5},"team":{"type":"choice","choice":"technical","probabilities":{"technical":0.1,"billing":0.8,"sales":0.1}}}}`,
		"incomplete":   `{"answers":{"urgent":{"type":"noul","noul":0.5}}}`,
		"mistyped":     `{"answers":{"urgent":{"type":"choice","choice":"yes","probabilities":{"yes":1}},"team":{"type":"choice","choice":"billing","probabilities":{"technical":0.1,"billing":0.8,"sales":0.1}}}}`,
		"out of range": `{"answers":{"urgent":{"type":"noul","noul":1.2},"team":{"type":"choice","choice":"billing","probabilities":{"technical":0.1,"billing":0.8,"sales":0.1}}}}`,
		"extra":        `{"answers":{"urgent":{"type":"noul","noul":0.5},"extra":{"type":"noul","noul":0.5},"team":{"type":"choice","choice":"billing","probabilities":{"technical":0.1,"billing":0.8,"sales":0.1}}}}`,
	} {
		t.Run(name, func(t *testing.T) {
			harness := newCloudDecideHarness(t, func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(body))
			})
			response, err := harness.execute(harness.ctx, 10_000)
			if response != nil {
				t.Fatalf("invalid output returned a response: %+v", response)
			}
			requireCloudDecideReason(t, err, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
			records := harness.jobs()
			if len(records) != 1 || records[0].job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED ||
				records[0].job.GetReasonCode() != runtimev1.ReasonCode_AI_OUTPUT_INVALID {
				t.Fatalf("terminal job = %+v", records)
			}
		})
	}
}

func TestCloudTextDecisionCancellationAndTimeoutPublishNoSuccess(t *testing.T) {
	blockUntilClientGone := func(entered chan<- struct{}, release <-chan struct{}) http.HandlerFunc {
		var once sync.Once
		return func(w http.ResponseWriter, r *http.Request) {
			_, _ = io.ReadAll(r.Body)
			once.Do(func() { close(entered) })
			select {
			case <-r.Context().Done():
			case <-release:
			}
		}
	}
	t.Run("canceled", func(t *testing.T) {
		entered, release := make(chan struct{}), make(chan struct{})
		harness := newCloudDecideHarness(t, blockUntilClientGone(entered, release))
		t.Cleanup(func() { close(release) })
		ctx, cancel := context.WithCancel(harness.ctx)
		go func() {
			<-entered
			cancel()
		}()
		response, err := harness.execute(ctx, 10_000)
		if response != nil || status.Code(err) != codes.Canceled {
			t.Fatalf("canceled decision = %+v, %v", response, err)
		}
		records := harness.jobs()
		if len(records) != 1 || records[0].job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED {
			t.Fatalf("canceled job = %+v", records)
		}
	})
	t.Run("timeout", func(t *testing.T) {
		entered, release := make(chan struct{}), make(chan struct{})
		harness := newCloudDecideHarness(t, blockUntilClientGone(entered, release))
		t.Cleanup(func() { close(release) })
		started := time.Now()
		response, err := harness.execute(harness.ctx, 300)
		if response != nil {
			t.Fatalf("timed-out decision returned %+v", response)
		}
		requireCloudDecideReason(t, err, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT)
		if elapsed := time.Since(started); elapsed > 5*time.Second {
			t.Fatalf("timeout took %s", elapsed)
		}
		records := harness.jobs()
		if len(records) != 1 || records[0].job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_TIMEOUT {
			t.Fatalf("timed-out job = %+v", records)
		}
	})
}

func TestCloudTextDecisionRejectsMissingCredentialOrTargetBeforeDispatch(t *testing.T) {
	t.Run("missing credential", func(t *testing.T) {
		harness := newCloudDecideHarness(t, func(http.ResponseWriter, *http.Request) {})
		record, err := harness.fixture.service.connStore.Create(connector.ConnectorRecord{
			ConnectorID: "connector-typesafe-no-key", Kind: runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
			OwnerType: runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER, OwnerID: cloudDecideUserID,
			Provider: "typesafe", Endpoint: harness.server.URL, Status: runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
		}, "")
		if err != nil {
			t.Fatal(err)
		}
		implementation, target := harness.targetOption(t, record.ConnectorID)
		harness.commit(t, record.ConnectorID, implementation, target, nil)
		_, err = harness.execute(harness.ctx, 10_000)
		requireCloudDecideReason(t, err, runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING)
		if harness.calls.Load() != 0 || len(harness.jobs()) != 0 {
			t.Fatalf("missing credential dispatched: calls=%d jobs=%d", harness.calls.Load(), len(harness.jobs()))
		}
	})
	t.Run("incomplete target", func(t *testing.T) {
		harness := newCloudDecideHarness(t, func(http.ResponseWriter, *http.Request) {})
		target, _ := structpb.NewStruct(map[string]any{"provider": "typesafe", "providerModelId": cloudDecideModel})
		incomplete := appAIConfig(cloudDecideAppID, &runtimev1.AIConfigCapabilityIntent{
			CapabilityContract: "text.decide",
			Route: &runtimev1.AIConfigCapabilityIntent_Cloud{Cloud: &runtimev1.AIConfigCloudIntent{
				ConnectorRef: harness.fixture.connectorID, Implementation: harness.impl, ProviderModelTarget: target,
			}},
		})
		if err := overwriteAIConfigStoreForTest(harness.ctx, harness.fixture.service.aiConfigStore, cloudDecideUserID, incomplete); err == nil {
			t.Fatal("AIConfig committed a target without remoteModelCatalogId")
		}
		// An already-captured incomplete intent must still fail before dispatch.
		ctx := executionintent.WithIntent(harness.ctx, executionintent.Intent{
			CapabilityContract: "text.decide", Route: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
			ConnectorRef: harness.fixture.connectorID, CloudImplementation: harness.impl, ProviderModelTarget: target,
		})
		_, err := harness.execute(ctx, 10_000)
		requireCloudDecideReason(t, err, runtimev1.ReasonCode_AI_CONFIG_INVALID)
		if harness.calls.Load() != 0 || len(harness.jobs()) != 0 {
			t.Fatalf("incomplete target dispatched: calls=%d jobs=%d", harness.calls.Load(), len(harness.jobs()))
		}
	})
	t.Run("unsupported defaults", func(t *testing.T) {
		harness := newCloudDecideHarness(t, func(http.ResponseWriter, *http.Request) {})
		defaults, _ := structpb.NewStruct(map[string]any{"temperature": 0.2})
		harness.commit(t, harness.fixture.connectorID, harness.impl, harness.target, defaults)
		_, err := harness.execute(harness.ctx, 10_000)
		requireCloudDecideReason(t, err, runtimev1.ReasonCode_AI_CONFIG_INVALID)
		if harness.calls.Load() != 0 || len(harness.jobs()) != 0 {
			t.Fatalf("unsupported defaults dispatched: calls=%d jobs=%d", harness.calls.Load(), len(harness.jobs()))
		}
	})
}
