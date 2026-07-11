package app

import (
	"context"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	authservice "github.com/nimiplatform/nimi/runtime/internal/services/auth"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *Service) revokeInstalledAppAuthority(ctx context.Context, appID string) error {
	if s == nil || s.installedLaunches == nil {
		return nil
	}
	return s.installedLaunches.RevokeApp(ctx, strings.TrimSpace(appID))
}

func (s *Service) BindInstalledLaunchProcess(ctx context.Context, req *runtimev1.BindInstalledLaunchProcessRequest) (*runtimev1.BindInstalledLaunchProcessResponse, error) {
	if req == nil || len(req.GetLaunchId()) != protectedlocal.IdentifierBytes || req.GetChildProcessId() == 0 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if s.installedLaunches == nil || s.installedRegistry == nil || s.installedVerifier == nil {
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_PROTECTED_LOCAL_TRANSPORT_UNSUPPORTED)
	}
	_, accountGeneration, ok := s.authenticatedLifecycleAccount(ctx)
	if !ok {
		return nil, grpcerr.WithReasonCode(codes.Unauthenticated, runtimev1.ReasonCode_AUTH_TOKEN_INVALID)
	}
	var launchID protectedlocal.Identifier
	copy(launchID[:], req.GetLaunchId())
	deadline, err := s.installedRegistry.Bind(ctx, launchID, req.GetChildProcessId(), s.installedVerifier, func(process protectedlocal.ProcessTuple) (time.Time, error) {
		binding, err := s.installedLaunches.BindProcess(ctx, authservice.InstalledLaunchProcess{LaunchID: launchID, PID: process.PID, CreationMarker: process.CreationMarker, ReleaseDigest: process.ExecutableDigest, AccountGeneration: accountGeneration})
		return binding.BindDeadline, err
	}, func() {
		_ = s.installedLaunches.RevokeLaunch(context.Background(), launchID)
	})
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH)
	}
	return &runtimev1.BindInstalledLaunchProcessResponse{LaunchId: append([]byte(nil), launchID[:]...), BindDeadline: timestamppb.New(deadline)}, nil
}
