package grpcserver

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/idempotency"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

func TestUnaryProtocolInterceptorRejectsMissingMetadata(t *testing.T) {
	store, err := idempotency.New(time.Hour, 16)
	if err != nil {
		t.Fatalf("New idempotency store: %v", err)
	}
	interceptor := newUnaryProtocolInterceptor(store)
	handlerCalled := false
	_, err = interceptor(context.Background(), &runtimev1.RemoveModelAssetRequest{
		ModelAssetId: "model-asset-1",
	}, &grpc.UnaryServerInfo{FullMethod: "/nimi.runtime.v1.RuntimeLocalService/RemoveModelAsset"}, func(_ context.Context, _ any) (any, error) {
		handlerCalled = true
		return &runtimev1.RemoveModelAssetResponse{}, nil
	})
	if err == nil {
		t.Fatalf("expected protocol error")
	}
	if handlerCalled {
		t.Fatalf("handler must not be called")
	}
	st, ok := status.FromError(err)
	if !ok || st.Code() != codes.InvalidArgument || st.Message() != "missing protocol envelope metadata" {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestUnaryProtocolInterceptorReplaysIdempotentWrite(t *testing.T) {
	store, err := idempotency.New(time.Hour, 16)
	if err != nil {
		t.Fatalf("New idempotency store: %v", err)
	}
	interceptor := newUnaryProtocolInterceptor(store)
	callCount := 0
	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"x-nimi-protocol-version", "1.0.0",
		"x-nimi-participant-protocol-version", "1.0.0",
		"x-nimi-participant-id", "nimi-cli",
		"x-nimi-domain", "runtime.local_runtime",
		"x-nimi-app-id", "nimi.desktop",
		"x-nimi-idempotency-key", "idem-fixed",
		"x-nimi-caller-kind", "third-party-service",
		"x-nimi-caller-id", "nimi-cli",
	))
	req := &runtimev1.RemoveModelAssetRequest{
		ModelAssetId: "model-asset-1",
	}
	info := &grpc.UnaryServerInfo{FullMethod: "/nimi.runtime.v1.RuntimeLocalService/RemoveModelAsset"}
	handler := func(_ context.Context, _ any) (any, error) {
		callCount++
		return &runtimev1.RemoveModelAssetResponse{CleanupPending: true}, nil
	}

	first, err := interceptor(ctx, req, info, handler)
	if err != nil {
		t.Fatalf("first call failed: %v", err)
	}
	second, err := interceptor(ctx, req, info, handler)
	if err != nil {
		t.Fatalf("second call failed: %v", err)
	}
	if callCount != 1 {
		t.Fatalf("expected single handler invocation, got %d", callCount)
	}
	firstResponse, ok := first.(*runtimev1.RemoveModelAssetResponse)
	if !ok {
		t.Fatalf("first response type mismatch")
	}
	secondResponse, ok := second.(*runtimev1.RemoveModelAssetResponse)
	if !ok {
		t.Fatalf("second response type mismatch")
	}
	if !firstResponse.GetCleanupPending() || !secondResponse.GetCleanupPending() {
		t.Fatalf("idempotent replay response mismatch")
	}
}

func TestUnaryProtocolInterceptorMaterializationReplayAlwaysReachesDurableDomainLedger(t *testing.T) {
	store, err := idempotency.New(time.Hour, 16)
	if err != nil {
		t.Fatalf("New idempotency store: %v", err)
	}
	interceptor := newUnaryProtocolInterceptor(store)
	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"x-nimi-protocol-version", "1.0.0",
		"x-nimi-participant-protocol-version", "1.0.0",
		"x-nimi-participant-id", "nimi-desktop",
		"x-nimi-domain", "runtime.agent",
		"x-nimi-app-id", "nimi.desktop",
		"x-nimi-idempotency-key", "materialization-domain-replay",
		"x-nimi-caller-kind", "first-party-app",
		"x-nimi-caller-id", "nimi.desktop",
	))
	req := &runtimev1.MaterializeRealmSourceRequest{
		Context:   &runtimev1.AgentRequestContext{AppId: "nimi.desktop"},
		RequestId: "materialize-domain-replay",
	}
	info := &grpc.UnaryServerInfo{FullMethod: "/nimi.runtime.v1.RuntimeAgentService/MaterializeRealmSource"}
	callCount := 0
	handler := func(_ context.Context, _ any) (any, error) {
		callCount++
		if callCount == 1 {
			return &runtimev1.MaterializeRealmSourceResponse{
				LocalAgentRef: "local-agent:deleted-after-first-response",
				ReasonCode:    runtimev1.RealmSourceMaterializationReasonCode_REALM_SOURCE_MATERIALIZATION_REASON_CODE_NONE,
			}, nil
		}
		return &runtimev1.MaterializeRealmSourceResponse{
			ReasonCode: runtimev1.RealmSourceMaterializationReasonCode_REALM_SOURCE_MATERIALIZATION_REASON_CODE_PERSISTENCE_FAILED,
		}, nil
	}
	first, err := interceptor(ctx, req, info, handler)
	if err != nil {
		t.Fatalf("first materialization call: %v", err)
	}
	second, err := interceptor(ctx, req, info, handler)
	if err != nil {
		t.Fatalf("second materialization call: %v", err)
	}
	if callCount != 2 {
		t.Fatalf("materialization handler calls = %d, want 2", callCount)
	}
	if first.(*runtimev1.MaterializeRealmSourceResponse).GetLocalAgentRef() == "" {
		t.Fatalf("first materialization response = %+v", first)
	}
	if got := second.(*runtimev1.MaterializeRealmSourceResponse); got.GetReasonCode() != runtimev1.RealmSourceMaterializationReasonCode_REALM_SOURCE_MATERIALIZATION_REASON_CODE_PERSISTENCE_FAILED || got.GetLocalAgentRef() != "" {
		t.Fatalf("second materialization response bypassed domain ledger: %+v", got)
	}
}

func TestUnaryProtocolInterceptorRejectsVersionMinorMismatch(t *testing.T) {
	store, err := idempotency.New(time.Hour, 16)
	if err != nil {
		t.Fatalf("New idempotency store: %v", err)
	}
	interceptor := newUnaryProtocolInterceptor(store)
	handlerCalled := false
	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"x-nimi-protocol-version", "1.0.0",
		"x-nimi-participant-protocol-version", "1.1.0",
		"x-nimi-participant-id", "nimi-cli",
		"x-nimi-domain", "runtime.local_runtime",
		"x-nimi-app-id", "nimi.desktop",
		"x-nimi-idempotency-key", "idem-version-mismatch",
		"x-nimi-caller-kind", "third-party-service",
		"x-nimi-caller-id", "nimi-cli",
	))
	_, err = interceptor(ctx, &runtimev1.RemoveModelAssetRequest{
		ModelAssetId: "model-asset-1",
	}, &grpc.UnaryServerInfo{FullMethod: "/nimi.runtime.v1.RuntimeLocalService/RemoveModelAsset"}, func(_ context.Context, _ any) (any, error) {
		handlerCalled = true
		return &runtimev1.RemoveModelAssetResponse{}, nil
	})
	if err == nil {
		t.Fatalf("expected protocol error on minor mismatch")
	}
	if handlerCalled {
		t.Fatalf("handler must not be called on version mismatch")
	}
	st, ok := status.FromError(err)
	if !ok || st.Code() != codes.InvalidArgument || st.Message() != "protocol versions must share major and minor components" {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestUnaryProtocolInterceptorRejectsNonProtoWriteRequest(t *testing.T) {
	store, err := idempotency.New(time.Hour, 16)
	if err != nil {
		t.Fatalf("New idempotency store: %v", err)
	}
	interceptor := newUnaryProtocolInterceptor(store)
	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"x-nimi-protocol-version", "1.0.0",
		"x-nimi-participant-protocol-version", "1.0.0",
		"x-nimi-participant-id", "nimi-cli",
		"x-nimi-domain", "runtime.local_runtime",
		"x-nimi-app-id", "nimi.desktop",
		"x-nimi-idempotency-key", "idem-bad-req",
		"x-nimi-caller-kind", "third-party-service",
		"x-nimi-caller-id", "nimi-cli",
	))
	_, err = interceptor(ctx, struct{ AppID string }{AppID: "nimi.desktop"}, &grpc.UnaryServerInfo{FullMethod: "/nimi.runtime.v1.RuntimeLocalService/RemoveModelAsset"}, func(_ context.Context, _ any) (any, error) {
		t.Fatal("handler must not be called for unsupported request type")
		return nil, nil
	})
	if err == nil {
		t.Fatal("expected protocol error for non-proto write request")
	}
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("unexpected status code: %v", status.Code(err))
	}
}

func TestHashRequestPreservesMarshalCause(t *testing.T) {
	_, err := hashRequest(&runtimev1.RemoveModelAssetRequest{
		ModelAssetId: string([]byte{0xff}),
	})
	if err == nil {
		t.Fatal("expected deterministic marshal failure")
	}
	if errors.Unwrap(err) == nil {
		t.Fatal("expected marshal cause to remain available in-process")
	}
}

func TestIsWriteMethodScenarioSurface(t *testing.T) {
	writeMethods := []string{
		"/nimi.runtime.v1.RuntimeAiService/OverwriteAppAIConfig",
		"/nimi.runtime.v1.RuntimeAiService/ExecuteScenario",
		"/nimi.runtime.v1.RuntimeAiService/StreamScenario",
		"/nimi.runtime.v1.RuntimeAiService/SubmitScenarioJob",
		"/nimi.runtime.v1.RuntimeAiService/CancelScenarioJob",
		"/nimi.runtime.v1.RuntimeAiService/DeleteVoiceAsset",
		"/nimi.runtime.v1.RuntimeAiService/UploadArtifact",
		"/nimi.runtime.v1.RuntimeAiService/UploadLocalAppArtifact",
		"/nimi.runtime.v1.RuntimeAiRealtimeService/OpenRealtimeSession",
		"/nimi.runtime.v1.RuntimeAiRealtimeService/AppendRealtimeInput",
		"/nimi.runtime.v1.RuntimeAiRealtimeService/CloseRealtimeSession",
		"/nimi.runtime.v1.RuntimeAgentService/MaterializeRealmSource",
		"/nimi.runtime.v1.RuntimeAgentService/InterruptAgentVoicePlayback",
		"/nimi.runtime.v1.RuntimeConnectorService/CreateConnector",
		"/nimi.runtime.v1.RuntimeConnectorService/UpdateConnector",
		"/nimi.runtime.v1.RuntimeConnectorService/DeleteConnector",
		"/nimi.runtime.v1.RuntimeConnectorService/TestConnector",
		"/nimi.runtime.v1.RuntimeConnectorService/UpsertModelCatalogProvider",
		"/nimi.runtime.v1.RuntimeConnectorService/DeleteCatalogModelOverlay",
		"/nimi.runtime.v1.RuntimeAccountService/InvokeRealmUnary",
		"/nimi.runtime.v1.RuntimeAccountService/RequestPresenceVerification",
		"/nimi.runtime.v1.RuntimeAccountService/IssueWorkspaceBinding",
		"/nimi.runtime.v1.RuntimeAccountService/RevokeWorkspaceBinding",
	}
	for _, method := range writeMethods {
		if !isWriteMethod(method) {
			t.Fatalf("expected write method: %s", method)
		}
	}
	durableMaterializationMethods := []string{
		"/nimi.runtime.v1.RuntimeAgentService/MaterializeRealmSource",
	}
	for _, method := range durableMaterializationMethods {
		if !usesDomainDurableIdempotency(method) {
			t.Fatalf("expected durable domain idempotency method: %s", method)
		}
	}
	if usesDomainDurableIdempotency("/nimi.runtime.v1.RuntimeLocalService/RemoveModelAsset") {
		t.Fatal("ordinary writes must retain generic protocol idempotency")
	}

	readMethods := []string{
		"/nimi.runtime.v1.RuntimeAiService/GetAppAIConfig",
		"/nimi.runtime.v1.RuntimeAiService/GetScenarioJob",
		"/nimi.runtime.v1.RuntimeAiService/GetScenarioArtifacts",
		"/nimi.runtime.v1.RuntimeAiService/ListScenarioProfiles",
		"/nimi.runtime.v1.RuntimeConnectorService/ListProviderCatalog",
	}
	for _, method := range readMethods {
		if isWriteMethod(method) {
			t.Fatalf("expected read method: %s", method)
		}
	}
}

func TestIsWriteMethodCoversGeneratedRuntimeMethods(t *testing.T) {
	for _, method := range generatedRuntimeFullMethods() {
		if isWriteMethod(method) {
			continue
		}
		operation := method[strings.LastIndex(method, "/")+1:]
		if isKnownReadOperation(operation) {
			continue
		}
		t.Fatalf("generated runtime RPC method is not classified as write-gated or explicitly read-only: %s", method)
	}
}

func generatedRuntimeFullMethods() []string {
	descs := []grpc.ServiceDesc{
		runtimev1.RuntimeAccountService_ServiceDesc,
		runtimev1.RuntimeAgentService_ServiceDesc,
		runtimev1.RuntimeAiRealtimeService_ServiceDesc,
		runtimev1.RuntimeAiService_ServiceDesc,
		runtimev1.RuntimeAppService_ServiceDesc,
		runtimev1.RuntimeArtifactService_ServiceDesc,
		runtimev1.RuntimeAuditService_ServiceDesc,
		runtimev1.RuntimeAuthService_ServiceDesc,
		runtimev1.RuntimeServiceControlService_ServiceDesc,
		runtimev1.RuntimeCognitionService_ServiceDesc,
		runtimev1.RuntimeConnectorService_ServiceDesc,
		runtimev1.RuntimeLocalService_ServiceDesc,
	}
	methods := make([]string, 0)
	for _, desc := range descs {
		for _, method := range desc.Methods {
			methods = append(methods, "/"+desc.ServiceName+"/"+method.MethodName)
		}
		for _, stream := range desc.Streams {
			methods = append(methods, "/"+desc.ServiceName+"/"+stream.StreamName)
		}
	}
	return methods
}

func isKnownReadOperation(operation string) bool {
	switch operation {
	case "OpenCompanionParticipationReplay",
		"RevealLocalAppAsset",
		"ResolveAvatarLiveInstanceBinding",
		"ResolveLocalEnvironmentPlan",
		"ResolveModelInstallPlan":
		return true
	}
	readPrefixes := []string{
		"Check",
		"Collect",
		"Describe",
		"Get",
		"History",
		"Inspect",
		"List",
		"Peek",
		"Preview",
		"Query",
		"Read",
		"Recall",
		"Search",
		"Stat",
		"Subscribe",
		"Traverse",
		"Validate",
		"Watch",
	}
	for _, prefix := range readPrefixes {
		if strings.HasPrefix(operation, prefix) {
			return true
		}
	}
	return false
}
