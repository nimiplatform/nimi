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
	"/nimi.runtime.v1.RuntimeAuditService/ListAuditEvents":                 true,
	"/nimi.runtime.v1.RuntimeAuditService/ListUsageStats":                  true,
	"/nimi.runtime.v1.RuntimeAuditService/ListAIProviderHealth":            true,
	"/nimi.runtime.v1.RuntimeAuditService/ExportAuditEvents":               true,
	"/nimi.runtime.v1.RuntimeAuditService/SubscribeRuntimeHealthEvents":    true,
	"/nimi.runtime.v1.RuntimeAuditService/SubscribeAIProviderHealthEvents": true,
	"/nimi.runtime.v1.RuntimeAiService/GetScenarioJob":                     true,
	"/nimi.runtime.v1.RuntimeAiService/GetScenarioArtifacts":               true,
	"/nimi.runtime.v1.RuntimeAiService/SubscribeScenarioJobEvents":         true,
	"/nimi.runtime.v1.RuntimeAiService/ListScenarioProfiles":               true,
	"/nimi.runtime.v1.RuntimeAiService/GetVoiceAsset":                      true,
	"/nimi.runtime.v1.RuntimeAiService/ListVoiceAssets":                    true,
	"/nimi.runtime.v1.RuntimeAiService/ListPresetVoices":                   true,
	"/nimi.runtime.v1.RuntimeAiRealtimeService/ReadRealtimeEvents":         true,
	"/nimi.runtime.v1.RuntimeGrantService/ValidateAppAccessToken":          true,
	"/nimi.runtime.v1.RuntimeGrantService/ListTokenChain":                  true,
	"/nimi.runtime.v1.RuntimeModelService/ListModels":                      true,
	"/nimi.runtime.v1.RuntimeModelService/CheckModelHealth":                true,
	"/nimi.runtime.v1.RuntimeConnectorService/ListConnectors":              true,
	"/nimi.runtime.v1.RuntimeConnectorService/GetConnector":                true,
	"/nimi.runtime.v1.RuntimeConnectorService/ListConnectorModels":         true,
	"/nimi.runtime.v1.RuntimeLocalService/ListLocalModels":                 true,
	"/nimi.runtime.v1.RuntimeLocalService/ListLocalArtifacts":              true,
	"/nimi.runtime.v1.RuntimeLocalService/ListVerifiedModels":              true,
	"/nimi.runtime.v1.RuntimeLocalService/ListVerifiedArtifacts":           true,
	"/nimi.runtime.v1.RuntimeLocalService/SearchCatalogModels":             true,
	"/nimi.runtime.v1.RuntimeLocalService/ResolveModelInstallPlan":         true,
	"/nimi.runtime.v1.RuntimeLocalService/CheckLocalModelHealth":           true,
	"/nimi.runtime.v1.RuntimeLocalService/CollectDeviceProfile":            true,
	"/nimi.runtime.v1.RuntimeLocalService/ResolveProfile":                  true,
	"/nimi.runtime.v1.RuntimeLocalService/ListLocalServices":               true,
	"/nimi.runtime.v1.RuntimeLocalService/CheckLocalServiceHealth":         true,
	"/nimi.runtime.v1.RuntimeLocalService/ListNodeCatalog":                 true,
	"/nimi.runtime.v1.RuntimeLocalService/ListLocalAudits":                 true,
	"/nimi.runtime.v1.RuntimeLocalService/ListEngines":                     true,
	"/nimi.runtime.v1.RuntimeLocalService/GetEngineStatus":                 true,
	"/grpc.health.v1.Health/Check":                                         true,
	"/grpc.health.v1.Health/Watch":                                         true,
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
