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

func TestExecuteScenarioTextGenerateRouteDescribeProbeWritesHeaderForManagedCloudRoute(t *testing.T) {
	fixture := newManagedCloudScenarioTestFixture(t, "openai", "gpt-4o-mini", "https://api.openai.com/v1", Config{})

	transport := &routeDescribeTransportStream{}
	ctx := withCloudScenarioTestIntent(fixture.context, "text.generate", fixture.targetRef)
	ctx = grpc.NewContextWithServerTransportStream(ctx, transport)
	resp, err := fixture.service.ExecuteScenario(ctx, &runtimev1.ExecuteScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			TimeoutMs:     30_000,
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

func TestExecuteScenarioTextGenerateRouteDescribeDoesNotProjectExecutionBinding(t *testing.T) {
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
	target := cloudScenarioTargetRefForDescriptor(connectorID, descriptor)

	svc, err := newFromProviderConfig(logger, nil, nil, nil, store, Config{}, 8, 2)
	if err != nil {
		t.Fatalf("new service: %v", err)
	}

	transport := &routeDescribeTransportStream{}
	execCtx := metadata.NewIncomingContext(ctx, metadata.Pairs("x-nimi-key-source", "managed"))
	execCtx = withCloudScenarioTestIntent(execCtx, "text.generate", target)
	execCtx = grpc.NewContextWithServerTransportStream(execCtx, transport)
	resp, err := svc.ExecuteScenario(execCtx, &runtimev1.ExecuteScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			TimeoutMs:     30_000,
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
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_TextGenerate{
			TextGenerate: &runtimev1.TextGenerateScenarioSpec{
				Input: []*runtimev1.ChatMessage{{Role: "user", Content: "route describe probe"}},
			},
		}},
	})
	if err != nil {
		t.Fatalf("execute scenario cloud route describe probe: %v", err)
	}
	if resp.GetRouteDecision() != runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD || resp.GetModelResolved() != descriptor.GetProviderModelId() {
		t.Fatalf("public outcome diagnostics mismatch: route=%v model=%q", resp.GetRouteDecision(), resp.GetModelResolved())
	}
	if field := resp.ProtoReflect().Descriptor().Fields().ByName("resolved_execution_binding"); field != nil {
		t.Fatalf("public response still declares resolved_execution_binding: %v", field)
	}
	payload := decodeRouteDescribeHeader(t, transport.header)
	if got := payload["routeMetadataRef"]; got == nil || got == "" {
		t.Fatalf("routeMetadataRef missing: %#v", payload)
	}
	for _, forbidden := range []string{"sourceTargetRef", "targetRef", "resolvedExecutionBinding"} {
		if value, exists := payload[forbidden]; exists {
			t.Fatalf("route describe projected private %s=%#v", forbidden, value)
		}
	}
}

func TestExecuteScenarioTextGenerateRejectsIncompletePrivateCloudIntent(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	target := cloudScenarioTargetRef("connector-openai-managed", "", "gpt-4o-mini", "openai")
	ctx := withCloudScenarioTestIntent(context.Background(), "text.generate", target)
	_, err := svc.ExecuteScenario(ctx, &runtimev1.ExecuteScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			TimeoutMs:     30_000,
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
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_TextGenerate{
			TextGenerate: &runtimev1.TextGenerateScenarioSpec{
				Input: []*runtimev1.ChatMessage{{Role: "user", Content: "route describe probe"}},
			},
		}},
	})
	if err == nil {
		t.Fatal("expected incomplete private cloud intent error")
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_CONFIG_INVALID {
		t.Fatalf("reason mismatch: got=%v ok=%v want=%v", reason, ok, runtimev1.ReasonCode_AI_CONFIG_INVALID)
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
	target := cloudScenarioTargetRefForDescriptor(connectorID, descriptor)
	execCtx := metadata.NewIncomingContext(ctx, metadata.Pairs("x-nimi-key-source", "managed"))
	execCtx = withCloudScenarioTestIntent(execCtx, "text.generate", target)
	_, err = svc.ExecuteScenario(execCtx, &runtimev1.ExecuteScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			TimeoutMs:     30_000,
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
