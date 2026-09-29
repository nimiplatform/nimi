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

// Service owns only the protected Runtime self-exit trigger and the typed
// service mode. SCM recovery, service definition, process replacement, and
// post-restart verification stay with the OS service manager and Kit carrier.
type Service struct {
	runtimev1.UnimplementedRuntimeServiceControlServiceServer
	desktopSessions   *protectedlocal.DesktopSessionManager
	requestRestart    RestartRequester
	maintenanceReason runtimev1.ReasonCode
}

// New serves the ordinary protected Runtime.
func New(desktopSessions *protectedlocal.DesktopSessionManager, requestRestart RestartRequester) *Service {
	return &Service{desktopSessions: desktopSessions, requestRestart: requestRestart}
}

// NewMaintenance serves a Runtime that refused ordinary startup for reason.
func NewMaintenance(desktopSessions *protectedlocal.DesktopSessionManager, requestRestart RestartRequester, reason runtimev1.ReasonCode) *Service {
	if reason == runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		reason = runtimev1.ReasonCode_RUNTIME_STORED_DATA_UNSUPPORTED
	}
	return &Service{desktopSessions: desktopSessions, requestRestart: requestRestart, maintenanceReason: reason}
}

// @nimi-authority: rule.nimi.runtime.protected-session.r034
// GetRuntimeServiceState reports which protected surface this process serves.
// It is process-operational truth, never readiness or App access.
func (service *Service) GetRuntimeServiceState(ctx context.Context, _ *runtimev1.GetRuntimeServiceStateRequest) (*runtimev1.GetRuntimeServiceStateResponse, error) {
	if service == nil || service.desktopSessions == nil {
		retryable := false
		return nil, grpcerr.WithReasonCodeOptions(codes.Unavailable, runtimev1.ReasonCode_PROTECTED_LOCAL_LEDGER_UNAVAILABLE, grpcerr.ReasonOptions{
			ActionHint: "repair_runtime_service",
			Retryable:  &retryable,
		})
	}
	if err := service.desktopSessions.AuthorizeContext(ctx, protectedlocal.RoleVerifiedDesktopProcess); err != nil {
		return nil, protectedRestartAuthorizationError(err)
	}
	if service.maintenanceReason != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		return &runtimev1.GetRuntimeServiceStateResponse{
			Mode:       runtimev1.RuntimeServiceMode_RUNTIME_SERVICE_MODE_MAINTENANCE,
			ReasonCode: service.maintenanceReason,
		}, nil
	}
	return &runtimev1.GetRuntimeServiceStateResponse{Mode: runtimev1.RuntimeServiceMode_RUNTIME_SERVICE_MODE_ORDINARY}, nil
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
