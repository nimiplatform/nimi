package ai

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/remoteexecution"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/protobuf/types/known/structpb"
)

type durableCaptureTextHost struct {
	store       *scenarioJobStore
	wantMode    runtimev1.ExecutionMode
	wantRequest string
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
	if len(fixture.service.scenarioJobs.jobs) != 1 {
		t.Fatalf("captured stream jobs = %d, want 1", len(fixture.service.scenarioJobs.jobs))
	}
	for _, record := range fixture.service.scenarioJobs.jobs {
		if record.job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED ||
			record.job.GetReasonCode() != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
			t.Fatalf("stream terminal did not preserve returned cause: status=%s reason=%s", record.job.GetStatus(), record.job.GetReasonCode())
		}
	}
}
