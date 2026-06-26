package ai

import (
	"context"
	"io"
	"log/slog"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc"
)

func TestExecuteScenarioImageGenerateRouteDescribeProbeWritesHeaderForManagedCloudRoute(t *testing.T) {
	fixture := newManagedCloudScenarioTestFixture(t, "openai", "gpt-image-1.5", "https://example.com", Config{})

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
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Extensions: []*runtimev1.ScenarioExtension{{
			Namespace: imageGenerateRouteDescribeExtensionNamespace,
			Payload: testProbePayload(t, map[string]any{
				"version":            "v1",
				"resolvedBindingRef": "binding-image-001",
			}),
		}},
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_ImageGenerate{
				ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{
					Prompt: "route describe probe",
					N:      1,
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("execute scenario image route describe probe: %v", err)
	}
	if got := resp.GetModelResolved(); got == "" {
		t.Fatalf("model resolved must be set")
	}
	payload := decodeRouteDescribeHeader(t, transport.header)
	if got := payload["capability"]; got != "image.generate" {
		t.Fatalf("capability mismatch: got=%v", got)
	}
	metadataPayload, ok := payload["metadata"].(map[string]any)
	if !ok {
		t.Fatalf("metadata payload missing: %#v", payload["metadata"])
	}
	if got := metadataPayload["defaultResponseFormat"]; got != "b64_json" {
		t.Fatalf("defaultResponseFormat mismatch: got=%v", got)
	}
	if got := metadataPayload["maxImagesPerRequest"]; got != float64(1) {
		t.Fatalf("maxImagesPerRequest mismatch: got=%v", got)
	}
	if got := metadataPayload["supportsSize"]; got != true {
		t.Fatalf("supportsSize mismatch: got=%v", got)
	}
	if got := metadataPayload["supportsReferenceImages"]; got != true {
		t.Fatalf("supportsReferenceImages mismatch: got=%v", got)
	}
}

func TestWriteImageRouteDescribeHeaderFailsClosedWhenCatalogMetadataMissing(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	transport := &routeDescribeTransportStream{}
	ctx := grpc.NewContextWithServerTransportStream(context.Background(), transport)
	err := svc.writeImageGenerateRouteDescribeHeader(
		ctx,
		&imageGenerateRouteDescribeProbe{
			version:            "v1",
			resolvedBindingRef: "binding-image-missing",
		},
		"openai/gpt-4o-mini",
		nil,
		nil,
	)
	if err == nil {
		t.Fatalf("expected image route describe probe to fail-close when metadata is missing")
	}
	if got, ok := grpcerr.ExtractReasonCode(err); !ok || got != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
		t.Fatalf("reason code mismatch: got=%s", got)
	}
}
