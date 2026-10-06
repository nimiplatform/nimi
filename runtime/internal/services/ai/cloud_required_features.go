package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/grpc/codes"
)

// @nimi-authority: rule.nimi.platform.core-protocol.p-caiex-008
// @nimi-authority: rule.nimi.runtime.ai-provider.r001
func requireCloudRequiredFeatures(required []string, binding *connector.RemoteModelCatalogBinding) error {
	if len(required) == 0 {
		return nil
	}
	if binding != nil && localexecution.SupportsRequiredFeatures(required, binding.Features) {
		return nil
	}
	return grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID, grpcerr.ReasonOptions{
		Message: "Cloud target does not support the AIConfig required features",
	})
}
