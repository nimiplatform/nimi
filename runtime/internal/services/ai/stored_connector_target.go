package ai

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/endpointsec"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/grpc/codes"
)

// resolveStoredConnectorTarget is used only by Runtime-private bindings that
// already captured one exact Connector identity. It is not a caller routing
// surface and opens custody only for the subsequent private execution.
func resolveStoredConnectorTarget(ctx context.Context, connectorID string, connStore *connector.ConnectorStore, allowLoopback bool) (*nimillm.RemoteTarget, error) {
	if connStore == nil {
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	rec, found, err := connStore.Get(connectorID)
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, err, grpcerr.ReasonOptions{
			ActionHint: "retry_or_check_runtime_logs", Message: "connector record could not be read",
		})
	}
	if !found || storedConnectorViolatesOAuthBoundary(rec) {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND)
	}
	if connector.IsRetiredLocalConnectorKind(rec.Kind) {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CONNECTOR_RETIRED)
	}
	if rec.Kind == runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED && rec.OwnerType == runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER {
		identity := authn.IdentityFromContext(ctx)
		subjectUserID := ""
		if identity != nil {
			subjectUserID = strings.TrimSpace(identity.SubjectUserID)
		}
		if subjectUserID == "" || rec.OwnerID != subjectUserID {
			return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND)
		}
	}
	if rec.Status == runtimev1.ConnectorStatus_CONNECTOR_STATUS_DISABLED {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONNECTOR_DISABLED)
	}
	secretPayload, err := connStore.LoadSecretPayload(connectorID)
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, err, grpcerr.ReasonOptions{
			ActionHint: "retry_or_check_runtime_logs", Message: "connector credentials could not be loaded",
		})
	}
	resolvedCredential := connector.ResolveCredential(rec, secretPayload)
	if resolvedCredential.APIKey == "" {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING)
	}
	endpoint := rec.Endpoint
	if endpoint == "" {
		endpoint = connector.ResolveEndpoint(rec.Provider, "")
	}
	if err := endpointsec.ValidateEndpoint(ctx, endpoint, allowLoopback); err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_PROVIDER_ENDPOINT_FORBIDDEN, err, grpcerr.ReasonOptions{
			Message: "connector endpoint is not allowed",
		})
	}
	return &nimillm.RemoteTarget{
		ProviderType: rec.Provider, Endpoint: endpoint, APIKey: resolvedCredential.APIKey,
		Headers: resolvedCredential.Headers, AllowLoopback: allowLoopback,
	}, nil
}

func storedConnectorViolatesOAuthBoundary(rec connector.ConnectorRecord) bool {
	return rec.Kind == runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED &&
		rec.AuthKind == runtimev1.ConnectorAuthKind_CONNECTOR_AUTH_KIND_OAUTH_MANAGED &&
		rec.OwnerType != runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER
}
