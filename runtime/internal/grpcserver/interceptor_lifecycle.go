package grpcserver

import (
	"context"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/health"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// readOnlyMethods are gRPC methods allowed during STOPPING/STOPPED states.
var readOnlyMethods = map[string]bool{
	"/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth":                true,
	"/nimi.runtime.v1.RuntimeAuditService/ListAuditEvents":                true,
	"/nimi.runtime.v1.RuntimeAuditService/ListUsageStats":                 true,
	"/nimi.runtime.v1.RuntimeAuditService/ListAIProviderHealth":           true,
	"/nimi.runtime.v1.RuntimeAuditService/ExportAuditEvents":              true,
	"/nimi.runtime.v1.RuntimeAuditService/SubscribeRuntimeHealthEvents":   true,
	"/nimi.runtime.v1.RuntimeAuditService/SubscribeAIProviderHealthEvents": true,
	"/nimi.runtime.v1.RuntimeAiService/GetMediaJob":                       true,
	"/nimi.runtime.v1.RuntimeAiService/GetMediaArtifacts":                 true,
	"/nimi.runtime.v1.RuntimeAiService/SubscribeMediaJobEvents":           true,
	"/nimi.runtime.v1.RuntimeGrantService/ValidateAppAccessToken":         true,
	"/nimi.runtime.v1.RuntimeGrantService/ListTokenChain":                 true,
	"/nimi.runtime.v1.RuntimeModelService/ListModels":                     true,
	"/nimi.runtime.v1.RuntimeModelService/CheckModelHealth":               true,
	"/nimi.runtime.v1.RuntimeLocalRuntimeService/ListLocalModels":         true,
	"/nimi.runtime.v1.RuntimeLocalRuntimeService/ListVerifiedModels":      true,
	"/nimi.runtime.v1.RuntimeLocalRuntimeService/SearchCatalogModels":     true,
	"/nimi.runtime.v1.RuntimeLocalRuntimeService/ResolveModelInstallPlan": true,
	"/nimi.runtime.v1.RuntimeLocalRuntimeService/CheckLocalModelHealth":   true,
	"/nimi.runtime.v1.RuntimeLocalRuntimeService/CollectDeviceProfile":    true,
	"/nimi.runtime.v1.RuntimeLocalRuntimeService/ResolveDependencies":     true,
	"/nimi.runtime.v1.RuntimeLocalRuntimeService/ListLocalServices":       true,
	"/nimi.runtime.v1.RuntimeLocalRuntimeService/CheckLocalServiceHealth": true,
	"/nimi.runtime.v1.RuntimeLocalRuntimeService/ListNodeCatalog":         true,
	"/nimi.runtime.v1.RuntimeLocalRuntimeService/ListLocalAudits":         true,
	"/grpc.health.v1.Health/Check":                                        true,
	"/grpc.health.v1.Health/Watch":                                        true,
}

func isReadOnlyMethod(fullMethod string) bool {
	if readOnlyMethods[fullMethod] {
		return true
	}
	// Health service is always allowed.
	if strings.HasPrefix(fullMethod, "/grpc.health.v1.") {
		return true
	}
	return false
}

func newUnaryLifecycleInterceptor(state *health.State) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
		snapshot := state.Snapshot()
		if snapshot.Status == health.StatusStopping || snapshot.Status == health.StatusStopped {
			if !isReadOnlyMethod(info.FullMethod) {
				return nil, status.Error(codes.Unavailable, "runtime is shutting down")
			}
		}
		return handler(ctx, req)
	}
}

func newStreamLifecycleInterceptor(state *health.State) grpc.StreamServerInterceptor {
	return func(srv any, ss grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
		snapshot := state.Snapshot()
		if snapshot.Status == health.StatusStopping || snapshot.Status == health.StatusStopped {
			if !isReadOnlyMethod(info.FullMethod) {
				return status.Error(codes.Unavailable, "runtime is shutting down")
			}
		}
		return handler(srv, ss)
	}
}
