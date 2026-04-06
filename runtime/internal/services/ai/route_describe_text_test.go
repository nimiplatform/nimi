package ai

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
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

func TestExecuteScenarioTextGenerateRouteDescribeProbeWritesHeaderForLocalRoute(t *testing.T) {
	requestCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount++
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"unexpected"}}]}`))
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	localAsset := &runtimev1.LocalAssetRecord{
		LocalAssetId: "local-qwen3-4b-q4_k_m",
		AssetId:      "qwen3-4b-q4_k_m",
		Engine:       "llama",
		Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
		Endpoint:     server.URL + "/v1",
		Capabilities: []string{
			"text.generate",
			"text.generate.vision",
			"text.generate.audio",
			"text.generate.video",
		},
	}
	svc.localModel = &fakeLocalModelLister{
		responses: repeatedLocalAssetsResponse(localAsset, 4),
	}

	transport := &routeDescribeTransportStream{}
	ctx := grpc.NewContextWithServerTransportStream(context.Background(), transport)
	resp, err := svc.ExecuteScenario(ctx, &runtimev1.ExecuteScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "local/qwen3-4b-q4_k_m",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     30_000,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Extensions: []*runtimev1.ScenarioExtension{{
			Namespace: textGenerateRouteDescribeExtensionNamespace,
			Payload: testProbePayload(t, map[string]any{
				"version":            "v1",
				"resolvedBindingRef": "binding-local-001",
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
		t.Fatalf("execute scenario route describe probe: %v", err)
	}
	if requestCount != 0 {
		t.Fatalf("route describe probe must not call provider generate, got=%d", requestCount)
	}
	if resp.GetModelResolved() == "" {
		t.Fatalf("model resolved must be set")
	}
	payload := decodeRouteDescribeHeader(t, transport.header)
	if got := payload["capability"]; got != "text.generate" {
		t.Fatalf("capability mismatch: got=%v", got)
	}
	if got := payload["resolvedBindingRef"]; got != "binding-local-001" {
		t.Fatalf("resolvedBindingRef mismatch: got=%v", got)
	}
	metadataPayload, ok := payload["metadata"].(map[string]any)
	if !ok {
		t.Fatalf("metadata payload missing: %#v", payload["metadata"])
	}
	if got := metadataPayload["supportsThinking"]; got != true {
		t.Fatalf("supportsThinking mismatch: got=%v", got)
	}
	if got := metadataPayload["traceModeSupport"]; got != "separate" {
		t.Fatalf("traceModeSupport mismatch: got=%v", got)
	}
	if got := metadataPayload["supportsImageInput"]; got != true {
		t.Fatalf("supportsImageInput mismatch: got=%v", got)
	}
	if got := metadataPayload["supportsAudioInput"]; got != true {
		t.Fatalf("supportsAudioInput mismatch: got=%v", got)
	}
	if got := metadataPayload["supportsVideoInput"]; got != true {
		t.Fatalf("supportsVideoInput mismatch: got=%v", got)
	}
	if got := metadataPayload["supportsArtifactRefInput"]; got != true {
		t.Fatalf("supportsArtifactRefInput mismatch: got=%v", got)
	}
}

func TestExecuteScenarioTextGenerateRouteDescribeProbeUsesResolvedLocalAssetIdentity(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	svc.localModel = &fakeLocalModelLister{
		responses: []*runtimev1.ListLocalAssetsResponse{{
			Assets: []*runtimev1.LocalAssetRecord{
				{
					LocalAssetId: "runtime-local-asset-a",
					AssetId:      "qwen3-chat",
					Engine:       "llama",
					Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
					Endpoint:     "http://127.0.0.1:11434/v1",
					Capabilities: []string{
						"text.generate",
					},
				},
				{
					LocalAssetId: "runtime-local-asset-b",
					AssetId:      "qwen3-chat",
					Engine:       "llama",
					Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
					Endpoint:     "http://127.0.0.1:22434/v1",
					Capabilities: []string{
						"text.generate",
						"text.generate.vision",
						"text.generate.audio",
					},
				},
			},
		}, {
			Assets: []*runtimev1.LocalAssetRecord{
				{
					LocalAssetId: "runtime-local-asset-a",
					AssetId:      "qwen3-chat",
					Engine:       "llama",
					Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
					Endpoint:     "http://127.0.0.1:11434/v1",
					Capabilities: []string{
						"text.generate",
					},
				},
				{
					LocalAssetId: "runtime-local-asset-b",
					AssetId:      "qwen3-chat",
					Engine:       "llama",
					Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
					Endpoint:     "http://127.0.0.1:22434/v1",
					Capabilities: []string{
						"text.generate",
						"text.generate.vision",
						"text.generate.audio",
					},
				},
			},
		}},
	}

	transport := &routeDescribeTransportStream{}
	ctx := grpc.NewContextWithServerTransportStream(context.Background(), transport)
	_, err := svc.ExecuteScenario(ctx, &runtimev1.ExecuteScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "local/qwen3-chat",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     30_000,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Extensions: []*runtimev1.ScenarioExtension{{
			Namespace: textGenerateRouteDescribeExtensionNamespace,
			Payload: testProbePayload(t, map[string]any{
				"version":               "v1",
				"resolvedBindingRef":    "binding-local-asset-b",
				"goRuntimeLocalModelId": "runtime-local-asset-b",
				"localModelId":          "desktop-local-asset-b",
				"engine":                "llama",
				"modelId":               "qwen3-chat",
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
		t.Fatalf("execute scenario local identity route describe probe: %v", err)
	}

	payload := decodeRouteDescribeHeader(t, transport.header)
	metadataPayload, ok := payload["metadata"].(map[string]any)
	if !ok {
		t.Fatalf("metadata payload missing: %#v", payload["metadata"])
	}
	if got := metadataPayload["supportsImageInput"]; got != true {
		t.Fatalf("supportsImageInput mismatch: got=%v", got)
	}
	if got := metadataPayload["supportsAudioInput"]; got != true {
		t.Fatalf("supportsAudioInput mismatch: got=%v", got)
	}
	if got := metadataPayload["supportsVideoInput"]; got != false {
		t.Fatalf("supportsVideoInput mismatch: got=%v", got)
	}
}

func TestExecuteScenarioTextGenerateRouteDescribeProbeFailsCloseWhenResolvedLocalAssetIdentityIsMissing(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	svc.localModel = &fakeLocalModelLister{
		responses: []*runtimev1.ListLocalAssetsResponse{{
			Assets: []*runtimev1.LocalAssetRecord{{
				LocalAssetId: "runtime-local-asset-a",
				AssetId:      "qwen3-chat",
				Engine:       "llama",
				Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
				Endpoint:     "http://127.0.0.1:11434/v1",
				Capabilities: []string{
					"text.generate",
				},
			}},
		}, {
			Assets: []*runtimev1.LocalAssetRecord{{
				LocalAssetId: "runtime-local-asset-a",
				AssetId:      "qwen3-chat",
				Engine:       "llama",
				Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
				Endpoint:     "http://127.0.0.1:11434/v1",
				Capabilities: []string{
					"text.generate",
				},
			}},
		}},
	}

	_, err := svc.ExecuteScenario(context.Background(), &runtimev1.ExecuteScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "local/qwen3-chat",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     30_000,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Extensions: []*runtimev1.ScenarioExtension{{
			Namespace: textGenerateRouteDescribeExtensionNamespace,
			Payload: testProbePayload(t, map[string]any{
				"version":               "v1",
				"resolvedBindingRef":    "binding-local-missing",
				"goRuntimeLocalModelId": "missing-local-asset",
				"engine":                "llama",
				"modelId":               "qwen3-chat",
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
	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("expected grpc status error, got=%v", err)
	}
	if st.Code() != codes.FailedPrecondition {
		t.Fatalf("status code mismatch: got=%v want=%v", st.Code(), codes.FailedPrecondition)
	}
	if !strings.Contains(st.Message(), runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE.String()) {
		t.Fatalf("reason code mismatch: got=%q want message containing=%q", st.Message(), runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE.String())
	}
}

func TestExecuteScenarioTextGenerateRouteDescribeProbeWritesHeaderForManagedCloudRoute(t *testing.T) {
	store := connector.NewConnectorStoreWithMemorySecrets(t.TempDir())
	if _, err := store.Create(connector.ConnectorRecord{
		ConnectorID: "connector-openai-managed",
		Kind:        runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
		OwnerType:   runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_SYSTEM,
		OwnerID:     "machine",
		Provider:    "openai",
		Endpoint:    "https://api.openai.com/v1",
		Label:       "OpenAI Managed",
		Status:      runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
	}, "sk-test-managed"); err != nil {
		t.Fatalf("create connector: %v", err)
	}

	svc, err := newFromProviderConfig(
		slog.New(slog.NewTextHandler(io.Discard, nil)),
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
	ctx := grpc.NewContextWithServerTransportStream(context.Background(), transport)
	ctx = metadata.NewIncomingContext(ctx, metadata.Pairs("x-nimi-key-source", "managed"))
	resp, err := svc.ExecuteScenario(ctx, &runtimev1.ExecuteScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "gpt-4o-mini",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     30_000,
			ConnectorId:   "connector-openai-managed",
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

func TestExecuteScenarioTextGenerateRouteDescribeProbeRejectsMissingResolvedBindingRef(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	svc.localModel = &fakeLocalModelLister{
		responses: repeatedLocalAssetsResponse(&runtimev1.LocalAssetRecord{
			LocalAssetId: "local-qwen3-4b-q4_k_m",
			AssetId:      "qwen3-4b-q4_k_m",
			Engine:       "llama",
			Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
			Endpoint:     "http://127.0.0.1:11434/v1",
			Capabilities: []string{
				"text.generate",
			},
		}, 1),
	}
	_, err := svc.ExecuteScenario(context.Background(), &runtimev1.ExecuteScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "local/qwen3-4b-q4_k_m",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     30_000,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Extensions: []*runtimev1.ScenarioExtension{{
			Namespace: textGenerateRouteDescribeExtensionNamespace,
			Payload: testProbePayload(t, map[string]any{
				"version": "v1",
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
	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("expected grpc status error, got=%v", err)
	}
	if st.Code() != codes.InvalidArgument {
		t.Fatalf("status code mismatch: got=%v want=%v", st.Code(), codes.InvalidArgument)
	}
	if st.Message() != runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID.String() {
		t.Fatalf("reason code mismatch: got=%q want=%q", st.Message(), runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID.String())
	}
}
