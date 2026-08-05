package connector

import (
	"errors"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

// ValidateAIConfigConnectorGrants validates every non-empty Cloud grant at the
// configuration commit boundary. Empty grant ids are valid unresolved intent.
// This function reads only local grant/connector registries: no credential is
// opened and no provider probe is possible.
func ValidateAIConfigConnectorGrants(store *ConnectorStore, accountID string, config *runtimev1.AIConfig) error {
	if config == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONFIG_INVALID)
	}
	for _, capability := range config.GetCapabilities() {
		cloud := capability.GetCloud()
		if cloud == nil {
			continue
		}
		grantID := cloud.GetConnectorGrantId()
		if grantID == "" {
			continue
		}
		if grantID != strings.TrimSpace(grantID) || store == nil {
			return connectorGrantSelectionRequiredError(nil)
		}
		if _, err := store.ValidateGrantBinding(accountID, grantID); err != nil {
			switch {
			case errors.Is(err, ErrConnectorGrantRevoked):
				return connectorGrantRevokedError(err)
			case errors.Is(err, ErrConnectorGrantSelectionRequired):
				return connectorGrantSelectionRequiredError(err)
			default:
				return grpcerr.WrapWithReasonCode(
					codes.Internal,
					runtimev1.ReasonCode_AI_PROVIDER_INTERNAL,
					err,
					grpcerr.ReasonOptions{Message: "connector grant registry could not be validated"},
				)
			}
		}
	}
	return nil
}
