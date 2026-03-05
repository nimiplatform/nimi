package grpcserver

import (
	"context"
	"io"
	"log/slog"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appregistry"
	"github.com/nimiplatform/nimi/runtime/internal/idempotency"
	"github.com/nimiplatform/nimi/runtime/internal/scopecatalog"
	grantservice "github.com/nimiplatform/nimi/runtime/internal/services/grant"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestUnaryProtocolInterceptorRejectsMissingMetadata(t *testing.T) {
	interceptor := newUnaryProtocolInterceptor(idempotency.New(0, 0))
	handlerCalled := false
	_, err := interceptor(context.Background(), &runtimev1.RemoveModelRequest{
		AppId:   "nimi.desktop",
		ModelId: "local/model",
	}, &grpc.UnaryServerInfo{FullMethod: "/nimi.runtime.v1.RuntimeModelService/RemoveModel"}, func(_ context.Context, _ any) (any, error) {
		handlerCalled = true
		return &runtimev1.Ack{Ok: true}, nil
	})
	if err == nil {
		t.Fatalf("expected protocol error")
	}
	if handlerCalled {
		t.Fatalf("handler must not be called")
	}
	st, ok := status.FromError(err)
	if !ok || st.Code() != codes.InvalidArgument || st.Message() != runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID.String() {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestUnaryProtocolInterceptorReplaysIdempotentWrite(t *testing.T) {
	interceptor := newUnaryProtocolInterceptor(idempotency.New(0, 0))
	callCount := 0
	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"x-nimi-protocol-version", "1.0.0",
		"x-nimi-participant-protocol-version", "1.0.0",
		"x-nimi-participant-id", "nimi-cli",
		"x-nimi-domain", "runtime.model",
		"x-nimi-app-id", "nimi.desktop",
		"x-nimi-idempotency-key", "idem-fixed",
		"x-nimi-caller-kind", "third-party-service",
		"x-nimi-caller-id", "nimi-cli",
	))
	req := &runtimev1.RemoveModelRequest{
		AppId:   "nimi.desktop",
		ModelId: "local/model",
	}
	info := &grpc.UnaryServerInfo{FullMethod: "/nimi.runtime.v1.RuntimeModelService/RemoveModel"}
	handler := func(_ context.Context, _ any) (any, error) {
		callCount++
		return &runtimev1.Ack{Ok: true, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
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
	firstAck, ok := first.(*runtimev1.Ack)
	if !ok {
		t.Fatalf("first response type mismatch")
	}
	secondAck, ok := second.(*runtimev1.Ack)
	if !ok {
		t.Fatalf("second response type mismatch")
	}
	if !firstAck.GetOk() || !secondAck.GetOk() {
		t.Fatalf("idempotent replay response mismatch")
	}
}

func TestUnaryProtocolInterceptorRejectsVersionMinorMismatch(t *testing.T) {
	interceptor := newUnaryProtocolInterceptor(idempotency.New(0, 0))
	handlerCalled := false
	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"x-nimi-protocol-version", "1.0.0",
		"x-nimi-participant-protocol-version", "1.1.0",
		"x-nimi-participant-id", "nimi-cli",
		"x-nimi-domain", "runtime.model",
		"x-nimi-app-id", "nimi.desktop",
		"x-nimi-idempotency-key", "idem-version-mismatch",
		"x-nimi-caller-kind", "third-party-service",
		"x-nimi-caller-id", "nimi-cli",
	))
	_, err := interceptor(ctx, &runtimev1.RemoveModelRequest{
		AppId:   "nimi.desktop",
		ModelId: "local/model",
	}, &grpc.UnaryServerInfo{FullMethod: "/nimi.runtime.v1.RuntimeModelService/RemoveModel"}, func(_ context.Context, _ any) (any, error) {
		handlerCalled = true
		return &runtimev1.Ack{Ok: true}, nil
	})
	if err == nil {
		t.Fatalf("expected protocol error on minor mismatch")
	}
	if handlerCalled {
		t.Fatalf("handler must not be called on version mismatch")
	}
	st, ok := status.FromError(err)
	if !ok || st.Code() != codes.InvalidArgument || st.Message() != runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID.String() {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestUnaryAuthzInterceptorProtectedCapability(t *testing.T) {
	registry := appregistry.New()
	registry.Upsert("nimi.desktop", &runtimev1.AppModeManifest{
		AppMode:         runtimev1.AppMode_APP_MODE_FULL,
		RuntimeRequired: true,
		RealmRequired:   true,
		WorldRelation:   runtimev1.WorldRelation_WORLD_RELATION_NONE,
	}, nil)
	grantSvc := grantservice.NewWithDependencies(slog.New(slog.NewTextHandler(io.Discard, nil)), registry, scopecatalog.New())
	authorizeResp, err := grantSvc.AuthorizeExternalPrincipal(context.Background(), &runtimev1.AuthorizeExternalPrincipalRequest{
		Domain:                "app-auth",
		AppId:                 "nimi.desktop",
		ExternalPrincipalId:   "agent-a",
		ExternalPrincipalType: runtimev1.ExternalPrincipalType_EXTERNAL_PRINCIPAL_TYPE_AGENT,
		SubjectUserId:         "user-1",
		ConsentId:             "consent-1",
		ConsentVersion:        "v1",
		DecisionAt:            timestamppb.Now(),
		PolicyVersion:         "p1",
		PolicyMode:            runtimev1.PolicyMode_POLICY_MODE_CUSTOM,
		Scopes:                []string{"runtime.model.remove"},
		ResourceSelectors:     &runtimev1.ResourceSelectors{},
		ScopeCatalogVersion:   "sdk-v1",
		TtlSeconds:            300,
	})
	if err != nil {
		t.Fatalf("authorize token: %v", err)
	}

	interceptor := newUnaryAuthzInterceptor(grantSvc)
	info := &grpc.UnaryServerInfo{FullMethod: "/nimi.runtime.v1.RuntimeModelService/RemoveModel"}
	req := &runtimev1.RemoveModelRequest{
		AppId:   "nimi.desktop",
		ModelId: "local/model",
	}

	missingTokenCtx := metadata.NewIncomingContext(context.Background(), metadata.Pairs("x-nimi-app-id", "nimi.desktop"))
	_, err = interceptor(missingTokenCtx, req, info, func(_ context.Context, _ any) (any, error) {
		return &runtimev1.Ack{Ok: true}, nil
	})
	if err == nil {
		t.Fatalf("expected permission denied without token")
	}
	st, _ := status.FromError(err)
	if st.Code() != codes.PermissionDenied || st.Message() != runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED.String() {
		t.Fatalf("unexpected error without token: %v", err)
	}

	authorizedCtx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"x-nimi-app-id", "nimi.desktop",
		"x-nimi-access-token-id", authorizeResp.GetTokenId(),
		"x-nimi-access-token-secret", authorizeResp.GetSecret(),
	))
	_, err = interceptor(authorizedCtx, req, info, func(_ context.Context, _ any) (any, error) {
		return &runtimev1.Ack{Ok: true, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
	})
	if err != nil {
		t.Fatalf("expected protected action allowed, got %v", err)
	}
}

func TestIsWriteMethodScenarioSurface(t *testing.T) {
	writeMethods := []string{
		"/nimi.runtime.v1.RuntimeAiService/ExecuteScenario",
		"/nimi.runtime.v1.RuntimeAiService/StreamScenario",
		"/nimi.runtime.v1.RuntimeAiService/SubmitScenarioJob",
		"/nimi.runtime.v1.RuntimeAiService/CancelScenarioJob",
		"/nimi.runtime.v1.RuntimeAiService/DeleteVoiceAsset",
	}
	for _, method := range writeMethods {
		if !isWriteMethod(method) {
			t.Fatalf("expected write method: %s", method)
		}
	}

	readMethods := []string{
		"/nimi.runtime.v1.RuntimeAiService/GetScenarioJob",
		"/nimi.runtime.v1.RuntimeAiService/GetScenarioArtifacts",
		"/nimi.runtime.v1.RuntimeAiService/ListScenarioProfiles",
	}
	for _, method := range readMethods {
		if isWriteMethod(method) {
			t.Fatalf("expected read method: %s", method)
		}
	}
}
