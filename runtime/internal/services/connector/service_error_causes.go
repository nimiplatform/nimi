package connector

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

func catalogModelNotFoundError(cause error) error {
	return grpcerr.WrapWithReasonCode(
		codes.NotFound,
		runtimev1.ReasonCode_AI_MODEL_NOT_FOUND,
		cause,
		grpcerr.ReasonOptions{Message: "catalog model was not found"},
	)
}

func catalogMutationDisabledError(cause error) error {
	return grpcerr.WrapWithReasonCode(
		codes.FailedPrecondition,
		runtimev1.ReasonCode_AI_MODULE_CONFIG_INVALID,
		cause,
		grpcerr.ReasonOptions{
			ActionHint: "configure_runtime_model_catalog_custom_dir",
			Message:    "model catalog mutations are disabled",
		},
	)
}

func catalogProviderUnsupportedError(cause error) error {
	return grpcerr.WrapWithReasonCode(
		codes.InvalidArgument,
		runtimev1.ReasonCode_AI_INPUT_INVALID,
		cause,
		grpcerr.ReasonOptions{Message: "model catalog provider is unsupported"},
	)
}

func catalogInputInvalidError(cause error) error {
	return grpcerr.WrapWithReasonCode(
		codes.InvalidArgument,
		runtimev1.ReasonCode_AI_MODULE_CONFIG_INVALID,
		cause,
		grpcerr.ReasonOptions{
			ActionHint: "fix_provider_catalog_yaml",
			Message:    "model catalog input is invalid",
		},
	)
}

func remoteModelCatalogStaleError(cause error) error {
	return grpcerr.WrapWithReasonCode(
		codes.FailedPrecondition,
		runtimev1.ReasonCode_AI_REMOTE_MODEL_CATALOG_STALE,
		cause,
		grpcerr.ReasonOptions{Message: "remote model catalog binding is stale"},
	)
}

func connectorLimitExceededError(cause error) error {
	return grpcerr.WrapWithReasonCode(
		codes.ResourceExhausted,
		runtimev1.ReasonCode_AI_CONNECTOR_LIMIT_EXCEEDED,
		cause,
		grpcerr.ReasonOptions{Message: "connector limit was exceeded"},
	)
}
