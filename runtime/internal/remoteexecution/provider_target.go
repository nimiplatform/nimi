package remoteexecution

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/endpointsec"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/grpc/codes"
)

type providerTargetIdentity interface {
	Provider() string
	ProviderModelID() string
	RemoteModelCatalogID() string
}

// requestScopedProviderTarget is the only remote credential opening point.
// Grant and connector records are immutable snapshots; the sealed payload is
// read only for one Host dispatch and never enters a Driver or service capture.
func requestScopedProviderTarget(
	ctx context.Context,
	connectors *connector.ConnectorStore,
	allowLoopback bool,
	grant connector.ConnectorGrantSnapshot,
	target providerTargetIdentity,
) (*nimillm.RemoteTarget, error) {
	if connectors == nil || target == nil {
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	grantRecord := grant.Grant
	connectorRecord := grant.Connector
	ownerConsistent := connectorRecord.OwnerType == runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER && connectorRecord.OwnerID == grantRecord.AccountID
	if grantRecord.GrantID == "" || grantRecord.AccountID == "" || grantRecord.ConnectorID == "" ||
		grantRecord.ConnectorID != connectorRecord.ConnectorID || !ownerConsistent ||
		connectorRecord.Kind != runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED ||
		connectorRecord.Provider != target.Provider() {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONNECTOR_GRANT_SELECTION_REQUIRED)
	}
	secretPayload, err := connectors.LoadSecretPayload(connectorRecord.ConnectorID)
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, err, grpcerr.ReasonOptions{Message: "connector credential custody is unavailable"})
	}
	credential := connector.ResolveCredential(connectorRecord, secretPayload)
	if credential.APIKey == "" {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING)
	}
	endpoint := strings.TrimSpace(connectorRecord.Endpoint)
	if endpoint == "" {
		endpoint = connector.ResolveEndpoint(connectorRecord.Provider, "")
	}
	if err := endpointsec.ValidateEndpoint(ctx, endpoint, allowLoopback); err != nil {
		credential.APIKey = ""
		credential.Headers = nil
		return nil, grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_PROVIDER_ENDPOINT_FORBIDDEN, err, grpcerr.ReasonOptions{Message: "connector endpoint is not allowed"})
	}
	return &nimillm.RemoteTarget{
		ProviderType:         target.Provider(),
		ProviderModelID:      target.ProviderModelID(),
		RemoteModelCatalogID: target.RemoteModelCatalogID(),
		ConnectorID:          connectorRecord.ConnectorID,
		Endpoint:             endpoint,
		APIKey:               credential.APIKey,
		Headers:              credential.Headers,
		AllowLoopback:        allowLoopback,
	}, nil
}

func clearRequestScopedProviderTarget(target *nimillm.RemoteTarget) {
	if target == nil {
		return
	}
	target.APIKey = ""
	for key := range target.Headers {
		target.Headers[key] = ""
		delete(target.Headers, key)
	}
	target.Headers = nil
}
