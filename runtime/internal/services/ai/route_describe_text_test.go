package ai

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/types/known/structpb"
)

type routeDescribeTransportStream struct {
	header  metadata.MD
	trailer metadata.MD
}

func (s *routeDescribeTransportStream) Method() string {
	return "/nimi.runtime.v1.RuntimeAiService/ExecuteScenario"
}

func (s *routeDescribeTransportStream) SetHeader(md metadata.MD) error {
	s.header = metadata.Join(s.header, md)
	return nil
}

func (s *routeDescribeTransportStream) SendHeader(md metadata.MD) error {
	return s.SetHeader(md)
}

func (s *routeDescribeTransportStream) SetTrailer(md metadata.MD) error {
	s.trailer = metadata.Join(s.trailer, md)
	return nil
}

func testProbePayload(t *testing.T, values map[string]any) *structpb.Struct {
	t.Helper()
	payload, err := structpb.NewStruct(values)
	if err != nil {
		t.Fatalf("new struct payload: %v", err)
	}
	return payload
}

func decodeRouteDescribeHeader(t *testing.T, md metadata.MD) map[string]any {
	t.Helper()
	values := md.Get(routeDescribeResponseHeaderKey)
	if len(values) == 0 {
		t.Fatalf("missing %s header", routeDescribeResponseHeaderKey)
	}
	decoded, err := base64.StdEncoding.DecodeString(values[0])
	if err != nil {
		t.Fatalf("decode route describe header: %v", err)
	}
	var payload map[string]any
	if err := json.Unmarshal(decoded, &payload); err != nil {
		t.Fatalf("unmarshal route describe header: %v", err)
	}
	return payload
}

func repeatedLocalAssetsResponse(asset *runtimev1.LocalAssetRecord, count int) []*runtimev1.ListLocalAssetsResponse {
	responses := make([]*runtimev1.ListLocalAssetsResponse, 0, count)
	for i := 0; i < count; i++ {
		responses = append(responses, &runtimev1.ListLocalAssetsResponse{
			Assets: []*runtimev1.LocalAssetRecord{asset},
		})
	}
	return responses
}

func TestExecuteScenarioTextGenerateRouteDescribeProbeWritesHeaderForManagedCloudRoute(t *testing.T) {
	fixture := newManagedCloudScenarioTestFixture(t, "openai", "gpt-4o-mini", "https://api.openai.com/v1", Config{})

	transport := &routeDescribeTransportStream{}
	ctx := grpc.NewContextWithServerTransportStream(fixture.context, transport)
	resp, err := fixture.service.ExecuteScenario(ctx, &runtimev1.ExecuteScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       fixture.descriptor.GetProviderModelId(),
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     30_000,
			ConnectorId:   fixture.connectorID,
			TargetRef:     fixture.targetRef,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Extensions: []*runtimev1.ScenarioExtension{{
			Namespace: textGenerateRouteDescribeExtensionNamespace,
			Payload: testProbePayload(t, map[string]any{
				"version":            "v1",
				"resolvedBindingRef": "binding-cloud-001",
			}),
		}},
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_TextGenerate{
				TextGenerate: &runtimev1.TextGenerateScenarioSpec{
					Input: []*runtimev1.ChatMessage{{
						Role:    "user",
						Content: "route describe probe",
					}},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("execute scenario cloud route describe probe: %v", err)
	}
	if resp.GetRouteDecision() != runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD {
		t.Fatalf("route decision mismatch: got=%v", resp.GetRouteDecision())
	}
	payload := decodeRouteDescribeHeader(t, transport.header)
	if got := payload["capability"]; got != "text.generate" {
		t.Fatalf("capability mismatch: got=%v", got)
	}
	if got := payload["resolvedBindingRef"]; got != "binding-cloud-001" {
		t.Fatalf("resolvedBindingRef mismatch: got=%v", got)
	}
	metadataPayload, ok := payload["metadata"].(map[string]any)
	if !ok {
		t.Fatalf("metadata payload missing: %#v", payload["metadata"])
	}
	if _, ok := metadataPayload["supportsImageInput"].(bool); !ok {
		t.Fatalf("supportsImageInput must be boolean: %#v", metadataPayload["supportsImageInput"])
	}
	if _, ok := metadataPayload["supportsAudioInput"].(bool); !ok {
		t.Fatalf("supportsAudioInput must be boolean: %#v", metadataPayload["supportsAudioInput"])
	}
	if _, ok := metadataPayload["supportsVideoInput"].(bool); !ok {
		t.Fatalf("supportsVideoInput must be boolean: %#v", metadataPayload["supportsVideoInput"])
	}
}

func TestExecuteScenarioTextGenerateRouteDescribeReturnsResolvedCloudBinding(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	store := connector.NewConnectorStoreWithMemorySecrets(t.TempDir())
	connectorSvc := connector.New(logger, store, nil)
	ctx := userCtx("user-001")
	created, err := connectorSvc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{
		Provider: "openai",
		ApiKey:   "managed-key",
	})
	if err != nil {
		t.Fatalf("CreateConnector: %v", err)
	}
	connectorID := created.GetConnector().GetConnectorId()
	descriptor := connectorModelDescriptorForAITest(t, connectorSvc, ctx, connectorID, "gpt-4o-mini")
	if descriptor.GetRemoteModelCatalogId() == "" {
		t.Fatalf("remote_model_catalog_id missing: %#v", descriptor)
	}

	svc, err := newFromProviderConfig(
		logger,
		nil,
		nil,
		nil,
		store,
		Config{},
		8,
		2,
	)
	if err != nil {
		t.Fatalf("new service: %v", err)
	}

	transport := &routeDescribeTransportStream{}
	execCtx := metadata.NewIncomingContext(ctx, metadata.Pairs("x-nimi-key-source", "managed"))
	execCtx = grpc.NewContextWithServerTransportStream(execCtx, transport)
	resp, err := svc.ExecuteScenario(execCtx, &runtimev1.ExecuteScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     30_000,
			TargetRef: &runtimev1.RuntimeDurableTargetRef{
				Target: &runtimev1.RuntimeDurableTargetRef_Cloud{
					Cloud: &runtimev1.RuntimeDurableCloudTargetRef{
						Version:              "v2",
						ConnectorId:          connectorID,
						RemoteModelCatalogId: descriptor.GetRemoteModelCatalogId(),
						ProviderModelId:      descriptor.GetProviderModelId(),
						Provider:             descriptor.GetProvider(),
					},
				},
			},
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Extensions: []*runtimev1.ScenarioExtension{{
			Namespace: textGenerateRouteDescribeExtensionNamespace,
			Payload: testProbePayload(t, map[string]any{
				"version":            "v1",
				"resolvedBindingRef": "binding-cloud-v2",
			}),
		}},
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_TextGenerate{
				TextGenerate: &runtimev1.TextGenerateScenarioSpec{
					Input: []*runtimev1.ChatMessage{{
						Role:    "user",
						Content: "route describe probe",
					}},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("execute scenario cloud route describe probe: %v", err)
	}
	binding := resp.GetResolvedExecutionBinding()
	if binding == nil {
		t.Fatalf("resolved_execution_binding missing")
	}
	if binding.GetBindingVersion() != "v2" {
		t.Fatalf("binding_version = %q", binding.GetBindingVersion())
	}
	if binding.GetCapability() != "text.generate" {
		t.Fatalf("capability = %q", binding.GetCapability())
	}
	if binding.GetResolvedBindingRef() != "binding-cloud-v2" {
		t.Fatalf("resolved_binding_ref = %q", binding.GetResolvedBindingRef())
	}
	if binding.GetRouteMetadataRef() == "" {
		t.Fatalf("route_metadata_ref missing")
	}
	if binding.GetSourceTargetRef().GetCloud().GetRemoteModelCatalogId() != descriptor.GetRemoteModelCatalogId() {
		t.Fatalf("source target ref mismatch: %#v", binding.GetSourceTargetRef())
	}
	cloud := binding.GetCloud()
	if cloud == nil {
		t.Fatalf("cloud binding missing: %#v", binding)
	}
	if cloud.GetConnectorId() != connectorID {
		t.Fatalf("connector_id = %q want %q", cloud.GetConnectorId(), connectorID)
	}
	if cloud.GetRemoteModelCatalogId() != descriptor.GetRemoteModelCatalogId() {
		t.Fatalf("remote_model_catalog_id = %q want %q", cloud.GetRemoteModelCatalogId(), descriptor.GetRemoteModelCatalogId())
	}
	if cloud.GetProviderModelId() != descriptor.GetProviderModelId() {
		t.Fatalf("provider_model_id = %q want %q", cloud.GetProviderModelId(), descriptor.GetProviderModelId())
	}
	if cloud.GetProvider() != descriptor.GetProvider() {
		t.Fatalf("provider = %q want %q", cloud.GetProvider(), descriptor.GetProvider())
	}
	if cloud.GetEndpointProfileId() != descriptor.GetEndpointProfileId() {
		t.Fatalf("endpoint_profile_id = %q want %q", cloud.GetEndpointProfileId(), descriptor.GetEndpointProfileId())
	}
	if cloud.GetConnectorSnapshotId() != descriptor.GetConnectorSnapshotId() {
		t.Fatalf("connector_snapshot_id = %q want %q", cloud.GetConnectorSnapshotId(), descriptor.GetConnectorSnapshotId())
	}
	payload := decodeRouteDescribeHeader(t, transport.header)
	if got := payload["routeMetadataRef"]; got != binding.GetRouteMetadataRef() {
		t.Fatalf("routeMetadataRef = %v want %q", got, binding.GetRouteMetadataRef())
	}
	sourceTarget, ok := payload["sourceTargetRef"].(map[string]any)
	if !ok {
		t.Fatalf("sourceTargetRef missing: %#v", payload["sourceTargetRef"])
	}
	sourceCloud, ok := sourceTarget["cloud"].(map[string]any)
	if !ok {
		t.Fatalf("sourceTargetRef.cloud missing: %#v", sourceTarget)
	}
	if got := sourceCloud["remoteModelCatalogId"]; got != descriptor.GetRemoteModelCatalogId() {
		t.Fatalf("sourceTargetRef.cloud.remoteModelCatalogId = %v want %q", got, descriptor.GetRemoteModelCatalogId())
	}
}

func TestExecuteScenarioTextGenerateCloudTargetRefRequiresRemoteCatalogID(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	_, err := svc.ExecuteScenario(context.Background(), &runtimev1.ExecuteScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     30_000,
			TargetRef: &runtimev1.RuntimeDurableTargetRef{
				Target: &runtimev1.RuntimeDurableTargetRef_Cloud{
					Cloud: &runtimev1.RuntimeDurableCloudTargetRef{
						Version:         "v2",
						ConnectorId:     "connector-openai-managed",
						ProviderModelId: "gpt-4o-mini",
						Provider:        "openai",
					},
				},
			},
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Extensions: []*runtimev1.ScenarioExtension{{
			Namespace: textGenerateRouteDescribeExtensionNamespace,
			Payload: testProbePayload(t, map[string]any{
				"version":            "v1",
				"resolvedBindingRef": "binding-cloud-missing-catalog",
			}),
		}},
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_TextGenerate{
				TextGenerate: &runtimev1.TextGenerateScenarioSpec{
					Input: []*runtimev1.ChatMessage{{Role: "user", Content: "route describe probe"}},
				},
			},
		},
	})
	if err == nil {
		t.Fatal("expected missing remote model catalog id error")
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_REMOTE_MODEL_CATALOG_ID_REQUIRED {
		t.Fatalf("reason mismatch: got=%v ok=%v want=%v", reason, ok, runtimev1.ReasonCode_AI_REMOTE_MODEL_CATALOG_ID_REQUIRED)
	}
}

func TestExecuteScenarioTextGenerateCloudTargetRefStaleAfterEndpointChange(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	store := connector.NewConnectorStoreWithMemorySecrets(t.TempDir())
	connectorSvc := connector.New(logger, store, nil)
	ctx := userCtx("user-001")
	created, err := connectorSvc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{
		Provider: "openai",
		Endpoint: "https://first.example.test/v1",
		ApiKey:   "managed-key",
	})
	if err != nil {
		t.Fatalf("CreateConnector: %v", err)
	}
	connectorID := created.GetConnector().GetConnectorId()
	descriptor := connectorModelDescriptorForAITest(t, connectorSvc, ctx, connectorID, "gpt-4o-mini")
	secondEndpoint := "https://second.example.test/v1"
	if _, err := connectorSvc.UpdateConnector(ctx, &runtimev1.UpdateConnectorRequest{
		ConnectorId: connectorID,
		Endpoint:    &secondEndpoint,
	}); err != nil {
		t.Fatalf("UpdateConnector endpoint: %v", err)
	}

	svc, err := newFromProviderConfig(
		logger,
		nil,
		nil,
		nil,
		store,
		Config{},
		8,
		2,
	)
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	execCtx := metadata.NewIncomingContext(ctx, metadata.Pairs("x-nimi-key-source", "managed"))
	_, err = svc.ExecuteScenario(execCtx, &runtimev1.ExecuteScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     30_000,
			TargetRef: &runtimev1.RuntimeDurableTargetRef{
				Target: &runtimev1.RuntimeDurableTargetRef_Cloud{
					Cloud: &runtimev1.RuntimeDurableCloudTargetRef{
						Version:              "v2",
						ConnectorId:          connectorID,
						RemoteModelCatalogId: descriptor.GetRemoteModelCatalogId(),
						ProviderModelId:      descriptor.GetProviderModelId(),
						Provider:             descriptor.GetProvider(),
					},
				},
			},
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Extensions: []*runtimev1.ScenarioExtension{{
			Namespace: textGenerateRouteDescribeExtensionNamespace,
			Payload: testProbePayload(t, map[string]any{
				"version":            "v1",
				"resolvedBindingRef": "binding-cloud-stale",
			}),
		}},
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_TextGenerate{
				TextGenerate: &runtimev1.TextGenerateScenarioSpec{
					Input: []*runtimev1.ChatMessage{{Role: "user", Content: "route describe probe"}},
				},
			},
		},
	})
	if err == nil {
		t.Fatal("expected stale remote model catalog id error")
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_REMOTE_MODEL_CATALOG_STALE {
		t.Fatalf("reason mismatch: got=%v ok=%v want=%v", reason, ok, runtimev1.ReasonCode_AI_REMOTE_MODEL_CATALOG_STALE)
	}
}

func connectorModelDescriptorForAITest(
	t *testing.T,
	svc *connector.Service,
	ctx context.Context,
	connectorID string,
	modelID string,
) *runtimev1.ConnectorModelDescriptor {
	t.Helper()
	resp, err := svc.ListConnectorModels(ctx, &runtimev1.ListConnectorModelsRequest{
		ConnectorId: connectorID,
		PageSize:    200,
	})
	if err != nil {
		t.Fatalf("ListConnectorModels: %v", err)
	}
	for _, model := range resp.GetModels() {
		if model.GetModelId() == modelID {
			return model
		}
	}
	t.Fatalf("model %q not found", modelID)
	return nil
}
