package ai

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/remoteexecution"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
)

type durableCaptureTextHost struct {
	store       *scenarioJobStore
	wantMode    runtimev1.ExecutionMode
	wantRequest string
}

type deleteConnectorBeforeTextHost struct {
	store       *connector.ConnectorStore
	connectorID string
	delegate    remoteexecution.TextHost
}

func (h *deleteConnectorBeforeTextHost) deleteConnector() error {
	if h == nil || h.store == nil {
		return fmt.Errorf("test Connector store is unavailable")
	}
	return h.store.Delete(h.connectorID)
}

func (h *deleteConnectorBeforeTextHost) ExecuteText(
	ctx context.Context,
	record connector.ConnectorRecord,
	target capabilitydriver.CloudTextTarget,
	request *capabilitydriver.CloudTextMappedRequest,
	audit remoteexecution.TextDispatchAudit,
) (capabilitydriver.CloudTextTransportResponse, error) {
	if err := h.deleteConnector(); err != nil {
		return capabilitydriver.CloudTextTransportResponse{}, err
	}
	return h.delegate.ExecuteText(ctx, record, target, request, audit)
}

func (h *deleteConnectorBeforeTextHost) StreamText(
	ctx context.Context,
	record connector.ConnectorRecord,
	target capabilitydriver.CloudTextTarget,
	request *capabilitydriver.CloudTextMappedRequest,
	onDelta func(string) error,
	audit remoteexecution.TextDispatchAudit,
) (capabilitydriver.CloudTextTransportResponse, error) {
	if err := h.deleteConnector(); err != nil {
		return capabilitydriver.CloudTextTransportResponse{}, err
	}
	return h.delegate.StreamText(ctx, record, target, request, onDelta, audit)
}

func (h *durableCaptureTextHost) assertCapturedBeforeDispatch(audit remoteexecution.TextDispatchAudit, request *capabilitydriver.CloudTextMappedRequest) error {
	if h == nil || h.store == nil || request == nil {
		return fmt.Errorf("test Host has no captured request or store")
	}
	if request.Spec().GetInput()[0].GetContent() != h.wantRequest {
		return fmt.Errorf("Host request = %+v, want captured input %q", request.Spec(), h.wantRequest)
	}
	h.store.mu.RLock()
	var matched *scenarioJobRecord
	for _, record := range h.store.jobs {
		if record != nil && record.job != nil && record.job.GetTraceId() == audit.TraceID {
			matched = record
			break
		}
	}
	if matched == nil || matched.job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING ||
		matched.job.GetExecutionMode() != h.wantMode || matched.cloudAssembly == nil ||
		matched.cloudAssembly.RequestKind != cloudResolvedRequestText || matched.cloudAssembly.ExecutionMode != h.wantMode {
		h.store.mu.RUnlock()
		return fmt.Errorf("Host started without RUNNING durable Cloud capture: %+v", matched)
	}
	h.store.mu.RUnlock()
	raw, err := os.ReadFile(h.store.durablePath)
	if err != nil {
		return fmt.Errorf("read durable capture before Host: %w", err)
	}
	if !bytes.Contains(raw, []byte(h.wantRequest)) || !bytes.Contains(raw, []byte("cloud_resolved_assembly")) {
		return fmt.Errorf("durable snapshot before Host lacks exact request: %s", raw)
	}
	if bytes.Contains(raw, []byte("test-key")) {
		return fmt.Errorf("durable snapshot before Host contains credential material")
	}
	return nil
}

func (h *durableCaptureTextHost) ExecuteText(
	_ context.Context,
	_ connector.ConnectorRecord,
	_ capabilitydriver.CloudTextTarget,
	request *capabilitydriver.CloudTextMappedRequest,
	audit remoteexecution.TextDispatchAudit,
) (capabilitydriver.CloudTextTransportResponse, error) {
	if err := h.assertCapturedBeforeDispatch(audit, request); err != nil {
		return capabilitydriver.CloudTextTransportResponse{}, err
	}
	return capabilitydriver.CloudTextTransportResponse{
		Text: "sync result", FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
	}, nil
}

func (h *durableCaptureTextHost) StreamText(
	_ context.Context,
	_ connector.ConnectorRecord,
	_ capabilitydriver.CloudTextTarget,
	request *capabilitydriver.CloudTextMappedRequest,
	onDelta func(string) error,
	audit remoteexecution.TextDispatchAudit,
) (capabilitydriver.CloudTextTransportResponse, error) {
	if err := h.assertCapturedBeforeDispatch(audit, request); err != nil {
		return capabilitydriver.CloudTextTransportResponse{}, err
	}
	if err := onDelta("stream result"); err != nil {
		return capabilitydriver.CloudTextTransportResponse{}, err
	}
	return capabilitydriver.CloudTextTransportResponse{
		Streamed: true, FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
	}, nil
}

func TestCloudTextImmediatePathsPersistExactAssemblyBeforeHost(t *testing.T) {
	for _, test := range []struct {
		name string
		mode runtimev1.ExecutionMode
	}{
		{name: "sync", mode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC},
		{name: "stream", mode: runtimev1.ExecutionMode_EXECUTION_MODE_STREAM},
	} {
		t.Run(test.name, func(t *testing.T) {
			fixture := newManagedCloudScenarioTestFixture(t, "openai", "gpt-4o-mini", "https://api.openai.com/v1", Config{
				CloudProviders: map[string]nimillm.ProviderCredentials{},
			})
			store, _ := newDurableScenarioJobStoreForFailureTest(t)
			fixture.service.scenarioJobs = store
			const appID = "app.cloud.capture"
			const input = "must be durable before remote Host"
			target, err := structpb.NewStruct(map[string]any{
				"provider": "openai", "providerModelId": fixture.descriptor.GetProviderModelId(),
				"remoteModelCatalogId": fixture.descriptor.GetRemoteModelCatalogId(),
			})
			if err != nil {
				t.Fatal(err)
			}
			if err := fixture.service.aiConfigStore.Overwrite(scenarioJobUserContext(appID, "user-001"), "user-001", appAIConfig(appID,
				&runtimev1.AIConfigCapabilityIntent{
					CapabilityContract: "text.generate",
					Route: &runtimev1.AIConfigCapabilityIntent_Cloud{Cloud: &runtimev1.AIConfigCloudIntent{
						Implementation: &runtimev1.CapabilityImplementationIdentity{
							ImplementationId: "cloud.text.openai", DriverId: "nimi.runtime.driver.openai", DriverDialect: "openai/chat-completions/v1",
						},
						ProviderModelTarget: target,
					}},
				},
			)); err != nil {
				t.Fatalf("store AIConfig: %v", err)
			}
			fixture.service.SetRemoteTextExecutionHost(&durableCaptureTextHost{store: store, wantMode: test.mode, wantRequest: input})
			ctx := scenarioJobUserContext(appID, "user-001")
			head := &runtimev1.ScenarioRequestHead{AppId: appID, SubjectUserId: "user-001"}
			spec := &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_TextGenerate{TextGenerate: &runtimev1.TextGenerateScenarioSpec{
				Input: []*runtimev1.ChatMessage{{Role: "user", Content: input}},
			}}}
			if test.mode == runtimev1.ExecutionMode_EXECUTION_MODE_SYNC {
				response, err := fixture.service.ExecuteScenario(ctx, &runtimev1.ExecuteScenarioRequest{
					Head: head, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE, ExecutionMode: test.mode, Spec: spec,
				})
				if err != nil || outputText(response.GetOutput()) != "sync result" {
					t.Fatalf("ExecuteScenario = %+v, %v", response, err)
				}
			} else {
				stream := &mockScenarioEventStream{ctx: ctx}
				if err := fixture.service.StreamScenario(&runtimev1.StreamScenarioRequest{
					Head: head, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE, ExecutionMode: test.mode, Spec: spec,
				}, stream); err != nil {
					t.Fatalf("StreamScenario: %v", err)
				}
				if len(stream.events) < 3 || stream.events[len(stream.events)-1].GetCompleted() == nil {
					t.Fatalf("stream events = %+v", stream.events)
				}
			}
			store.mu.RLock()
			defer store.mu.RUnlock()
			if len(store.jobs) != 1 {
				t.Fatalf("immediate Cloud jobs = %d, want 1", len(store.jobs))
			}
			for _, record := range store.jobs {
				if record.job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || record.cloudAssembly == nil {
					t.Fatalf("terminal immediate Cloud capture = %+v", record)
				}
			}
		})
	}
}

func TestCapturedCloudJobExecutesAfterConnectorDeletionWithoutPersistingCredential(t *testing.T) {
	var authorization string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		authorization = request.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"captured custody"},"finish_reason":"stop"}]}`))
	}))
	defer server.Close()

	fixture := newManagedCloudScenarioTestFixture(t, "openai", "gpt-4o-mini", server.URL, Config{
		CloudProviders:        map[string]nimillm.ProviderCredentials{},
		AllowLoopbackEndpoint: true,
	})
	store, _ := newDurableScenarioJobStoreForFailureTest(t)
	fixture.service.scenarioJobs = store
	fixture.service.SetRemoteTextExecutionHost(&deleteConnectorBeforeTextHost{
		store: fixture.service.connStore, connectorID: fixture.connectorID, delegate: fixture.service.remoteTextHost,
	})

	const appID = "app.cloud.custody"
	ctx := withCloudScenarioTestIntent(scenarioJobUserContext(appID, "user-001"), "text.generate", fixture.targetRef)
	response, err := fixture.service.ExecuteScenario(ctx, &runtimev1.ExecuteScenarioRequest{
		Head:          &runtimev1.ScenarioRequestHead{AppId: appID, SubjectUserId: "user-001"},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_TextGenerate{TextGenerate: &runtimev1.TextGenerateScenarioSpec{
			Input: []*runtimev1.ChatMessage{{Role: "user", Content: "use the captured credential"}},
		}}},
	})
	if err != nil || outputText(response.GetOutput()) != "captured custody" {
		t.Fatalf("ExecuteScenario after Connector deletion = %+v, %v", response, err)
	}
	if authorization != "Bearer test-key" {
		t.Fatalf("provider authorization after Connector deletion = %q", authorization)
	}
	if _, found, err := fixture.service.connStore.Get(fixture.connectorID); err != nil || found {
		t.Fatalf("deleted Connector lookup: found=%v err=%v", found, err)
	}

	raw, err := os.ReadFile(store.durablePath)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(raw, []byte("test-key")) {
		t.Fatalf("durable Job/assembly contains raw credential: %s", raw)
	}
	if !bytes.Contains(raw, []byte("credential_custody_ref")) {
		t.Fatalf("durable Job/assembly lacks opaque credential custody ref: %s", raw)
	}
	store.mu.RLock()
	var job *runtimev1.ScenarioJob
	var custodyRef string
	for _, record := range store.jobs {
		if record != nil && record.cloudAssembly != nil {
			job = cloneScenarioJob(record.job)
			custodyRef = record.cloudAssembly.CredentialCustodyRef
			break
		}
	}
	store.mu.RUnlock()
	if job == nil || job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || custodyRef == "" {
		t.Fatalf("captured terminal Job=%+v custodyRef=%q", job, custodyRef)
	}
	if captured, err := fixture.service.connStore.LoadCredentialCustody(custodyRef); err != nil || captured != "" {
		t.Fatalf("terminal Job credential custody = %q, err=%v; want released", captured, err)
	}
}

func TestCloudTextStreamFallbackPersistsActualReturnedCause(t *testing.T) {
	fixture := newManagedCloudScenarioTestFixture(t, "openai", "gpt-4o-mini", "https://api.openai.com/v1", Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{},
	})
	target, err := structpb.NewStruct(map[string]any{
		"provider":             "openai",
		"providerModelId":      fixture.descriptor.GetProviderModelId(),
		"remoteModelCatalogId": fixture.descriptor.GetRemoteModelCatalogId(),
	})
	if err != nil {
		t.Fatal(err)
	}
	const appID = "app.cloud.stream-cause"
	if err := fixture.service.aiConfigStore.Overwrite(scenarioJobUserContext(appID, "user-001"), "user-001", appAIConfig(appID,
		&runtimev1.AIConfigCapabilityIntent{
			CapabilityContract: "text.generate",
			Route: &runtimev1.AIConfigCapabilityIntent_Cloud{Cloud: &runtimev1.AIConfigCloudIntent{
				Implementation: &runtimev1.CapabilityImplementationIdentity{
					ImplementationId: "cloud.text.openai", DriverId: "nimi.runtime.driver.openai", DriverDialect: "openai/chat-completions/v1",
				},
				ProviderModelTarget: target,
			}},
		},
	)); err != nil {
		t.Fatalf("store AIConfig: %v", err)
	}
	stream := &mockScenarioEventStream{ctx: scenarioJobUserContext(appID, "user-001")}
	err = fixture.service.StreamScenario(&runtimev1.StreamScenarioRequest{
		Head:          &runtimev1.ScenarioRequestHead{AppId: appID, SubjectUserId: "user-001", TimeoutMs: -1},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_STREAM,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_TextGenerate{TextGenerate: &runtimev1.TextGenerateScenarioSpec{
			Input: []*runtimev1.ChatMessage{{Role: "user", Content: "preserve this validation failure"}},
		}}},
	}, stream)
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
		t.Fatalf("StreamScenario error reason = %s present=%v err=%v", reason, ok, err)
	}
	fixture.service.scenarioJobs.mu.RLock()
	defer fixture.service.scenarioJobs.mu.RUnlock()
	if len(fixture.service.scenarioJobs.jobs) != 0 {
		t.Fatalf("invalid timeout published %d stream Jobs, want 0", len(fixture.service.scenarioJobs.jobs))
	}
}

func TestCloudTextStartedSendFailurePersistsStreamBrokenWithoutCallingProvider(t *testing.T) {
	providerCalled := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/models" || r.URL.Path == "/models" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"data":[{"id":"gpt-4o-mini"}]}`))
			return
		}
		providerCalled = true
		http.Error(w, "provider should not be called", http.StatusInternalServerError)
	}))
	defer server.Close()
	fixture := newManagedCloudScenarioTestFixture(t, "openai", "gpt-4o-mini", server.URL+"/v1", Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{},
	})
	target, err := structpb.NewStruct(map[string]any{
		"provider": "openai", "providerModelId": fixture.descriptor.GetProviderModelId(),
		"remoteModelCatalogId": fixture.descriptor.GetRemoteModelCatalogId(),
	})
	if err != nil {
		t.Fatal(err)
	}
	const appID = "app.cloud.stream-delivery"
	if err := fixture.service.aiConfigStore.Overwrite(scenarioJobUserContext(appID, "user-001"), "user-001", appAIConfig(appID,
		&runtimev1.AIConfigCapabilityIntent{
			CapabilityContract: "text.generate",
			Route: &runtimev1.AIConfigCapabilityIntent_Cloud{Cloud: &runtimev1.AIConfigCloudIntent{
				Implementation: &runtimev1.CapabilityImplementationIdentity{
					ImplementationId: "cloud.text.openai", DriverId: "nimi.runtime.driver.openai", DriverDialect: "openai/chat-completions/v1",
				},
				ProviderModelTarget: target,
			}},
		},
	)); err != nil {
		t.Fatalf("store AIConfig: %v", err)
	}
	sendErr := status.Error(codes.Unavailable, "stream transport closed")
	stream := &mockScenarioEventStream{ctx: scenarioJobUserContext(appID, "user-001"), failSendAt: 1, sendErr: sendErr}
	err = fixture.service.StreamScenario(&runtimev1.StreamScenarioRequest{
		Head:          &runtimev1.ScenarioRequestHead{AppId: appID, SubjectUserId: "user-001"},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_STREAM,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_TextGenerate{TextGenerate: &runtimev1.TextGenerateScenarioSpec{
			Input: []*runtimev1.ChatMessage{{Role: "user", Content: "hello"}},
		}}},
	}, stream)
	if status.Code(err) != codes.Unavailable {
		t.Fatalf("stream error=%v", err)
	}
	if providerCalled {
		t.Fatal("provider was called after STARTED delivery failed")
	}
	fixture.service.scenarioJobs.mu.RLock()
	defer fixture.service.scenarioJobs.mu.RUnlock()
	if len(fixture.service.scenarioJobs.jobs) != 1 {
		t.Fatalf("stream Jobs=%d, want 1", len(fixture.service.scenarioJobs.jobs))
	}
	for _, record := range fixture.service.scenarioJobs.jobs {
		if record.job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED ||
			record.job.GetReasonCode() != runtimev1.ReasonCode_AI_STREAM_BROKEN {
			t.Fatalf("stream terminal=%s reason=%s", record.job.GetStatus(), record.job.GetReasonCode())
		}
	}
}
