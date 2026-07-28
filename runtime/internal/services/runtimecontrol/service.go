package runtimecontrol

import (
	"context"
	"errors"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"google.golang.org/grpc/codes"
)

type RestartRequester func() bool

// Service owns only the protected Runtime self-exit trigger. SCM recovery,
// service definition, process replacement, and post-restart verification stay
// with the OS service manager and Kit carrier.
type Service struct {
	runtimev1.UnimplementedRuntimeServiceControlServiceServer
	desktopSessions *protectedlocal.DesktopSessionManager
	requestRestart  RestartRequester
}

func New(desktopSessions *protectedlocal.DesktopSessionManager, requestRestart RestartRequester) *Service {
	return &Service{desktopSessions: desktopSessions, requestRestart: requestRestart}
}

func (service *Service) RequestRuntimeRestart(ctx context.Context, _ *runtimev1.RequestRuntimeRestartRequest) (*runtimev1.RequestRuntimeRestartResponse, error) {
	if service == nil || service.desktopSessions == nil || service.requestRestart == nil {
		retryable := false
		return nil, grpcerr.WithReasonCodeOptions(codes.Unavailable, runtimev1.ReasonCode_PROTECTED_LOCAL_LEDGER_UNAVAILABLE, grpcerr.ReasonOptions{
			ActionHint: "repair_runtime_service",
			Retryable:  &retryable,
		})
	}
	if err := service.desktopSessions.AuthorizeContext(ctx, protectedlocal.RoleVerifiedDesktopProcess); err != nil {
		return nil, protectedRestartAuthorizationError(err)
	}
	if !service.requestRestart() {
		retryable := true
		return nil, grpcerr.WithReasonCodeOptions(codes.Aborted, runtimev1.ReasonCode_PROTECTED_LOCAL_BOOT_EPOCH_MISMATCH, grpcerr.ReasonOptions{
			ActionHint: "wait_for_runtime_restart",
			Retryable:  &retryable,
		})
	}
	return &runtimev1.RequestRuntimeRestartResponse{Accepted: true, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func protectedRestartAuthorizationError(err error) error {
	var failure *protectedlocal.Failure
	if !errors.As(err, &failure) {
		return grpcerr.WrapWithReasonCode(
			codes.Unavailable,
			runtimev1.ReasonCode_PROTECTED_LOCAL_LEDGER_UNAVAILABLE,
			err,
			grpcerr.ReasonOptions{Message: "runtime restart authorization failed"},
		)
	}
	reasonValue, ok := runtimev1.ReasonCode_value[string(failure.Reason())]
	if !ok {
		return grpcerr.WrapWithReasonCode(
			codes.Unavailable,
			runtimev1.ReasonCode_PROTECTED_LOCAL_LEDGER_UNAVAILABLE,
			err,
			grpcerr.ReasonOptions{Message: "runtime restart authorization failed"},
		)
	}
	retryable := failure.Retryable()
	return grpcerr.WrapWithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode(reasonValue), err, grpcerr.ReasonOptions{
		ActionHint: failure.ActionHint(),
		Retryable:  &retryable,
		Message:    "runtime restart authorization failed",
	})
}
