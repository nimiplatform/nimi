package runtimeagent

import (
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
)

func localAppConversationAuthorizationError(cause error) error {
	return grpcerr.WrapWithReasonCode(
		codes.PermissionDenied,
		accountservice.LocalAppOperationAuthorizationReason(cause),
		cause,
		grpcerr.ReasonOptions{
			Message: "local-app conversation permission denied",
		},
	)
}
