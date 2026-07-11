package auth

import (
	"context"
	"errors"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/timestamppb"
)

var ErrInstalledSessionNotBound = errors.New("installed session is not bound to the verified connection")

// OpenDesktopLaunchedAppSession atomically exchanges a Runtime-issued launch
// ticket for a process-bound installed session. All binding inputs come from
// the verified native connection and Runtime-private account state; the RPC
// request deliberately carries no authority fields.
func (s *Service) OpenDesktopLaunchedAppSession(ctx context.Context, _ *runtimev1.OpenDesktopLaunchedAppSessionRequest) (*runtimev1.OpenDesktopLaunchedAppSessionResponse, error) {
	if s == nil || s.installedLaunches == nil || s.accountSecurity == nil {
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_PROTECTED_LOCAL_TRANSPORT_UNSUPPORTED)
	}
	connection, ok := protectedlocal.InstalledLaunchConnectionFromContext(ctx)
	if !ok {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH)
	}
	_, accountGeneration, authenticated := s.accountSecurity.AuthenticatedRuntimeSecurityContext(ctx)
	if !authenticated || accountGeneration == 0 {
		return nil, grpcerr.WithReasonCode(codes.Unauthenticated, runtimev1.ReasonCode_AUTH_TOKEN_INVALID)
	}
	if connection.RuntimeBootEpoch() != s.installedLaunches.BootEpoch() {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_PROTECTED_LOCAL_BOOT_EPOCH_MISMATCH)
	}
	process := connection.Process()
	projection, err := s.installedLaunches.Consume(ctx, InstalledLaunchProcess{
		LaunchID:          connection.LaunchID(),
		PID:               process.PID,
		CreationMarker:    process.CreationMarker,
		ReleaseDigest:     process.ExecutableDigest,
		AccountGeneration: accountGeneration,
	})
	if err != nil {
		return nil, installedLaunchConsumeError(err)
	}
	if err := connection.BindInstalledSession(protectedlocal.InstalledSessionHandle{
		SessionID: projection.SessionID, SessionProof: projection.SessionProof,
	}); err != nil {
		_ = s.installedLaunches.RevokeSession(context.Background(), projection.SessionID)
		return nil, grpcerr.WithReasonCode(codes.Unauthenticated, runtimev1.ReasonCode_DESKTOP_PROCESS_VERIFICATION_UNAVAILABLE)
	}
	connection.OnRevoke(func() {
		_ = s.installedLaunches.RevokeSession(context.Background(), projection.SessionID)
	})
	if !connection.Live() {
		return nil, grpcerr.WithReasonCode(codes.Unauthenticated, runtimev1.ReasonCode_DESKTOP_PROCESS_VERIFICATION_UNAVAILABLE)
	}
	return &runtimev1.OpenDesktopLaunchedAppSessionResponse{
		InstalledSessionId:    append([]byte(nil), projection.SessionID[:]...),
		InstalledSessionProof: append([]byte(nil), projection.SessionProof[:]...),
		ExpiresAt:             timestamppb.New(projection.ExpiresAt),
		AppId:                 projection.AppID,
		ReleaseDigest:         append([]byte(nil), projection.ReleaseDigest[:]...),
		AccountGeneration:     projection.AccountGeneration,
		RuntimeBootEpoch:      append([]byte(nil), projection.RuntimeBootEpoch[:]...),
	}, nil
}

// ResolveInstalledSession resolves the Auth-owned installed session and native
// process binding for the Account-owned authorization evaluator. It does not
// decide capabilities or accept portable caller fields.
func (s *Service) ResolveInstalledSession(ctx context.Context, accountGeneration uint64) (accountservice.InstalledCallerBinding, error) {
	if s == nil || s.installedLaunches == nil || accountGeneration == 0 {
		return accountservice.InstalledCallerBinding{}, ErrInstalledSessionNotBound
	}
	connection, ok := protectedlocal.InstalledLaunchConnectionFromContext(ctx)
	if !ok {
		return accountservice.InstalledCallerBinding{}, ErrInstalledSessionNotBound
	}
	handle, ok := connection.InstalledSession()
	if !ok {
		return accountservice.InstalledCallerBinding{}, ErrInstalledSessionNotBound
	}
	process := connection.Process()
	projection, err := s.installedLaunches.ValidateSession(ctx, InstalledSessionBinding{
		SessionID:         handle.SessionID,
		SessionProof:      handle.SessionProof,
		ReleaseDigest:     process.ExecutableDigest,
		PID:               process.PID,
		CreationMarker:    process.CreationMarker,
		AccountGeneration: accountGeneration,
		RuntimeBootEpoch:  connection.RuntimeBootEpoch(),
	})
	if err != nil {
		return accountservice.InstalledCallerBinding{}, err
	}
	if !connection.Live() {
		return accountservice.InstalledCallerBinding{}, ErrInstalledSessionRevoked
	}
	return accountservice.InstalledCallerBinding{
		SessionID:         projection.SessionID,
		AppID:             projection.AppID,
		ReleaseDigest:     projection.ReleaseDigest,
		AccountGeneration: projection.AccountGeneration,
		RuntimeBootEpoch:  projection.RuntimeBootEpoch,
		Process:           process,
		ExpiresAt:         projection.ExpiresAt,
		TrustClass:        accountservice.InstalledTrustClassProductionInstalled,
	}, nil
}

func installedLaunchConsumeError(err error) error {
	switch {
	case errors.Is(err, ErrInstalledLaunchReplay):
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	case errors.Is(err, ErrInstalledLaunchExpired):
		return grpcerr.WithReasonCode(codes.DeadlineExceeded, runtimev1.ReasonCode_SESSION_EXPIRED)
	case errors.Is(err, ErrInstalledLaunchMismatch):
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH)
	default:
		return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_PROTECTED_LOCAL_LEDGER_UNAVAILABLE)
	}
}

var _ accountservice.InstalledSessionResolver = (*Service)(nil)
