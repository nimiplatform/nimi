package app

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const localDevelopmentTrustClass = "local_development"

func OpenLocalDevelopmentStore(path string, bootEpoch protectedlocal.Identifier) (*localDevelopmentStore, error) {
	return openLocalDevelopmentStore(path, bootEpoch)
}

func OpenDirectLocalDevelopmentStore(path string) (*localDevelopmentStore, error) {
	return openDirectLocalDevelopmentStore(path)
}

func (s *Service) GetDeveloperModeStatus(ctx context.Context, _ *runtimev1.GetDeveloperModeStatusRequest) (*runtimev1.GetDeveloperModeStatusResponse, error) {
	if err := requireProtectedLocalDevelopmentDesktop(ctx); err != nil {
		return nil, err
	}
	if s == nil || s.localDevelopment == nil {
		return &runtimev1.GetDeveloperModeStatusResponse{State: runtimev1.DeveloperModeState_DEVELOPER_MODE_STATE_UNAVAILABLE, ReasonCode: runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE}, nil
	}
	mode, err := s.localDevelopment.DeveloperMode(ctx)
	if err != nil {
		return nil, localDevelopmentStoreError(err)
	}
	state := runtimev1.DeveloperModeState_DEVELOPER_MODE_STATE_DISABLED
	if mode.Enabled {
		state = runtimev1.DeveloperModeState_DEVELOPER_MODE_STATE_ENABLED
	}
	return &runtimev1.GetDeveloperModeStatusResponse{State: state, Revision: mode.Revision, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func (s *Service) SetDeveloperMode(ctx context.Context, req *runtimev1.SetDeveloperModeRequest) (*runtimev1.SetDeveloperModeResponse, error) {
	if err := requireProtectedLocalDevelopmentDesktop(ctx); err != nil {
		return nil, err
	}
	if s == nil || s.localDevelopment == nil || req == nil {
		return nil, localDevelopmentFailure(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
	}
	mode, err := s.localDevelopment.SetDeveloperMode(ctx, req.GetEnabled())
	if err != nil {
		return nil, localDevelopmentStoreError(err)
	}
	state := runtimev1.DeveloperModeState_DEVELOPER_MODE_STATE_DISABLED
	if mode.Enabled {
		state = runtimev1.DeveloperModeState_DEVELOPER_MODE_STATE_ENABLED
	}
	return &runtimev1.SetDeveloperModeResponse{State: state, Revision: mode.Revision, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func (s *Service) RegisterLocalDevelopmentProject(ctx context.Context, req *runtimev1.RegisterLocalDevelopmentProjectRequest) (*runtimev1.RegisterLocalDevelopmentProjectResponse, error) {
	if err := requireProtectedLocalDevelopmentDesktop(ctx); err != nil {
		return nil, err
	}
	if s == nil || s.localDevelopment == nil || s.localAppKernel == nil || req == nil {
		return nil, localDevelopmentFailure(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
	}
	if _, ok := localDevelopmentIdentifierFromBytes(req.GetSupervisorRunId()); !ok {
		return nil, localDevelopmentFailure(codes.InvalidArgument, runtimev1.ReasonCode_LOCAL_APP_LAUNCH_LEASE_REQUIRED)
	}
	if err := s.localDevelopment.RequireDeveloperMode(ctx); err != nil {
		return nil, localDevelopmentFailureFromCause(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_DEVELOPER_MODE_DISABLED, err)
	}
	project, err := resolveLocalDevelopmentProject(req.GetProjectRoot(), req.GetExpectedAppId(), req.GetShellKind())
	if err != nil {
		return nil, localDevelopmentProjectAuthorityError(err)
	}
	registration, err := s.registerLocalDevelopmentProject(ctx, project, "")
	if err != nil {
		return nil, localDevelopmentStoreError(err)
	}
	return &runtimev1.RegisterLocalDevelopmentProjectResponse{
		Registration: localDevelopmentRegistrationToProto(registration),
		ReasonCode:   runtimev1.ReasonCode_ACTION_EXECUTED,
	}, nil
}

func (s *Service) ListLocalDevelopmentRegistrations(ctx context.Context, _ *runtimev1.ListLocalDevelopmentRegistrationsRequest) (*runtimev1.ListLocalDevelopmentRegistrationsResponse, error) {
	if err := requireProtectedLocalDevelopmentDesktop(ctx); err != nil {
		return nil, err
	}
	if s == nil || s.localAppKernel == nil {
		return nil, localDevelopmentFailure(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
	}
	rows, err := s.localAppKernel.Registrations().ListDevelopment(ctx)
	if err != nil {
		return nil, localDevelopmentStoreError(err)
	}
	response := &runtimev1.ListLocalDevelopmentRegistrationsResponse{ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}
	for _, registration := range rows {
		response.Registrations = append(response.Registrations, localDevelopmentRegistrationToProto(registration))
	}
	return response, nil
}

func (s *Service) RemoveLocalDevelopmentRegistration(ctx context.Context, req *runtimev1.RemoveLocalDevelopmentRegistrationRequest) (*runtimev1.RemoveLocalDevelopmentRegistrationResponse, error) {
	if err := requireProtectedLocalDevelopmentDesktop(ctx); err != nil {
		return nil, err
	}
	if s == nil || s.localAppKernel == nil || req == nil {
		return nil, localDevelopmentFailure(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
	}
	handle, ok := localDevelopmentIdentifierFromBytes(req.GetRegistrationHandle())
	if !ok {
		return nil, localDevelopmentFailure(codes.InvalidArgument, runtimev1.ReasonCode_LOCAL_APP_RECORD_NOT_FOUND)
	}
	registration, err := s.localAppKernel.Registrations().GetByHandle(ctx, localDevelopmentRegistrationHandleRef(handle))
	if err != nil {
		return nil, localDevelopmentStoreError(err)
	}
	if err := s.localAppKernel.Registrations().Tombstone(ctx, localDevelopmentRegistrationHandleRef(handle)); err != nil {
		return nil, localDevelopmentStoreError(err)
	}
	s.invalidateLocalAppSessionsForRegistration(registration, true)
	if s.localDevelopment != nil {
		s.localDevelopment.RevokeRegistration(handle)
	}
	if s.directLocalAppLaunches != nil {
		s.directLocalAppLaunches.RevokeRegistration(handle)
	}
	return &runtimev1.RemoveLocalDevelopmentRegistrationResponse{ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func (s *Service) PrepareLocalAppLaunch(ctx context.Context, req *runtimev1.PrepareLocalAppLaunchRequest) (*runtimev1.PrepareLocalAppLaunchResponse, error) {
	if err := requireProtectedLocalDevelopmentDesktop(ctx); err != nil {
		return nil, err
	}
	if s == nil || s.localDevelopment == nil || s.localAppKernel == nil || req == nil {
		return nil, localDevelopmentFailure(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
	}
	handle, handleOK := localDevelopmentIdentifierFromBytes(req.GetLocalAppHandle())
	runID, runOK := localDevelopmentIdentifierFromBytes(req.GetSupervisorRunId())
	if !handleOK || !runOK {
		return nil, localDevelopmentFailure(codes.InvalidArgument, runtimev1.ReasonCode_LOCAL_APP_LAUNCH_LEASE_REQUIRED)
	}
	if err := s.localDevelopment.RequireDeveloperMode(ctx); err != nil {
		return nil, localDevelopmentFailureFromCause(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_DEVELOPER_MODE_DISABLED, err)
	}
	registration, err := s.localAppKernel.Registrations().GetByHandle(ctx, localDevelopmentRegistrationHandleRef(handle))
	if err != nil || registration.State != localappkernel.RegistrationStateActive {
		return nil, localDevelopmentFailureFromCause(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_RECORD_NOT_FOUND, err)
	}
	project, err := resolveLocalDevelopmentProject(registration.ProjectRoot, registration.AppID, runtimev1.LocalDevelopmentShellKind(registration.ShellKind))
	if err != nil {
		return nil, localDevelopmentProjectAuthorityError(err)
	}
	registration, err = s.registerLocalDevelopmentProject(ctx, project, localDevelopmentRegistrationHandleRef(handle))
	if err != nil || registration.RegistrationHandle != localDevelopmentRegistrationHandleRef(handle) {
		return nil, localDevelopmentFailureFromCause(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_PROVENANCE_UNAVAILABLE, err)
	}
	hostExecutable, err := localDevelopmentHostExecutable(project)
	if err != nil {
		return nil, localDevelopmentFailureAtStageFromCause(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_PROVENANCE_UNAVAILABLE, "host-executable", err)
	}
	desktopConnection, ok := protectedlocal.DesktopConnectionFromContext(ctx)
	if !ok || desktopConnection == nil {
		return nil, localDevelopmentFailure(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_LAUNCH_LEASE_REQUIRED)
	}
	var launchID protectedlocal.Identifier
	var bindDeadline time.Time
	var revoke func()
	if s.directLocalAppLaunches != nil {
		desktopPeer, direct := desktopConnection.DirectDesktopPeer()
		if !direct {
			return nil, localDevelopmentFailure(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_LAUNCH_LEASE_REQUIRED)
		}
		prepared, prepareErr := s.directLocalAppLaunches.Prepare(handle, runID, registration.SourceGeneration, registration.DeclarationGeneration, desktopPeer.PID, desktopPeer.UID, hostExecutable, s.now().UTC().Add(localDevelopmentLaunchTTL))
		if prepareErr != nil {
			return nil, localDevelopmentFailureAtStageFromCause(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE, "launch-memory", prepareErr)
		}
		launchID, bindDeadline = prepared.LaunchID, prepared.ExpiresAt
		revoke = func() { s.directLocalAppLaunches.Revoke(launchID) }
	} else {
		expectedHostDigest, digestErr := localDevelopmentDigestIdentifier("host", registration.HostExecutableDigest)
		if digestErr != nil {
			return nil, localDevelopmentFailureAtStageFromCause(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_PROVENANCE_UNAVAILABLE, "registration", digestErr)
		}
		ticket, prepareErr := s.localDevelopment.PrepareLaunch(ctx, localDevelopmentLaunchRequest{RegistrationHandle: handle, SupervisorRunID: runID, Project: project, HostExecutable: hostExecutable, ExpectedHostDigest: expectedHostDigest})
		if prepareErr != nil {
			return nil, localDevelopmentStoreError(prepareErr)
		}
		launchID, bindDeadline = ticket.LaunchID, ticket.BindDeadline
		revoke = func() { _ = s.localDevelopment.RevokeLaunch(context.Background(), launchID) }
	}
	if err := desktopConnection.BindRevocationHook(runID, func() {
		revoke()
		_ = s.localDevelopment.EndRun(context.Background(), handle, runID)
		if s.directLocalAppLaunches != nil {
			s.directLocalAppLaunches.RevokeRun(handle, runID)
		}
	}); err != nil {
		revoke()
		return nil, localDevelopmentFailureFromCause(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_LAUNCH_LEASE_REQUIRED, err)
	}
	return &runtimev1.PrepareLocalAppLaunchResponse{LaunchId: append([]byte(nil), launchID[:]...), BindDeadline: timestamppb.New(bindDeadline), ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func (s *Service) BindLocalAppProcess(ctx context.Context, req *runtimev1.BindLocalAppProcessRequest) (*runtimev1.BindLocalAppProcessResponse, error) {
	if err := requireProtectedLocalDevelopmentDesktop(ctx); err != nil {
		return nil, err
	}
	if s != nil && req != nil && s.installedLaunch(req.GetLaunchId()) != nil {
		return s.bindInstalledAppProcess(ctx, req)
	}
	if s == nil || s.localDevelopment == nil || req == nil || (s.directLocalAppLaunches == nil && (s.localDevelopmentRegistry == nil || s.localDevelopmentVerifier == nil)) {
		return nil, localDevelopmentFailure(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
	}
	launchID, ok := localDevelopmentIdentifierFromBytes(req.GetLaunchId())
	if !ok || req.GetChildProcessId() == 0 {
		return nil, localDevelopmentFailure(codes.InvalidArgument, runtimev1.ReasonCode_LOCAL_APP_LAUNCH_LEASE_REQUIRED)
	}
	desktopConnection, ok := protectedlocal.DesktopConnectionFromContext(ctx)
	if !ok || desktopConnection == nil {
		return nil, localDevelopmentFailureAtStage(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_PROCESS_MISMATCH, "bind-supervisor")
	}
	if s.directLocalAppLaunches != nil {
		desktopPeer, direct := desktopConnection.DirectDesktopPeer()
		if !direct {
			return nil, localDevelopmentFailureAtStage(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_PROCESS_MISMATCH, "bind-supervisor")
		}
		deadline, err := protectedlocal.BindPlatformDirectLocalAppLaunch(s.directLocalAppLaunches, launchID, req.GetChildProcessId(), desktopPeer, s.now().UTC().Add(localDevelopmentProcessBindTTL))
		if err != nil {
			return nil, localDevelopmentFailureAtStageFromCause(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_PROCESS_MISMATCH, "bind-direct-peer", err)
		}
		return &runtimev1.BindLocalAppProcessResponse{LaunchId: append([]byte(nil), launchID[:]...), BindDeadline: timestamppb.New(deadline), ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
	}
	policy, err := s.localDevelopment.PendingLaunchPolicy(ctx, launchID)
	if err != nil {
		return nil, localDevelopmentStoreError(err)
	}
	if process, ok := desktopConnection.ClientProcess(); ok {
		policy.SupervisorProcess = process
	} else if peer, ok := desktopConnection.DirectDesktopPeer(); ok {
		policy.SupervisorPID = peer.PID
	} else {
		return nil, localDevelopmentFailureAtStage(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_PROCESS_MISMATCH, "bind-supervisor")
	}
	deadline, err := protectedlocal.BindLocalDevelopmentProcess(s.localDevelopmentRegistry, ctx, launchID, req.GetChildProcessId(), s.localDevelopmentVerifier, policy,
		func(process protectedlocal.ProcessTuple) (time.Time, error) {
			return s.localDevelopment.BindLaunch(ctx, launchID, process)
		},
		func() { _ = s.localDevelopment.RevokeLaunch(context.Background(), launchID) })
	if err != nil {
		return nil, localDevelopmentFailureAtStageFromCause(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_PROCESS_MISMATCH, localDevelopmentBindDiagnosticStage(err), err)
	}
	return &runtimev1.BindLocalAppProcessResponse{LaunchId: append([]byte(nil), launchID[:]...), BindDeadline: timestamppb.New(deadline), ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func localDevelopmentBindDiagnosticStage(err error) string {
	if stage, ok := protectedlocal.PlatformLocalDevelopmentDiagnosticStage(err); ok {
		return stage
	}
	if stage, ok := protectedlocal.LocalDevelopmentBindStageFromError(err); ok {
		return "bind-registry-" + string(stage)
	}
	return "bind-witness"
}

func (s *Service) RebindLocalAppProcess(ctx context.Context, req *runtimev1.RebindLocalAppProcessRequest) (*runtimev1.RebindLocalAppProcessResponse, error) {
	if err := requireProtectedLocalDevelopmentDesktop(ctx); err != nil {
		return nil, err
	}
	if s == nil || !s.perUserRuntimeRebind || s.directLocalAppLaunches == nil || req == nil {
		return nil, localDevelopmentFailure(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
	}
	launchID, ok := localDevelopmentIdentifierFromBytes(req.GetLaunchId())
	if !ok || req.GetChildProcessId() == 0 {
		return nil, localDevelopmentFailure(codes.InvalidArgument, runtimev1.ReasonCode_LOCAL_APP_LAUNCH_LEASE_REQUIRED)
	}
	desktopConnection, ok := protectedlocal.DesktopConnectionFromContext(ctx)
	if !ok || desktopConnection == nil {
		return nil, localDevelopmentFailureAtStage(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_PROCESS_MISMATCH, "rebind-supervisor")
	}
	desktopPeer, direct := desktopConnection.DirectDesktopPeer()
	if !direct {
		return nil, localDevelopmentFailureAtStage(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_PROCESS_MISMATCH, "rebind-supervisor")
	}
	deadline, err := protectedlocal.RebindPlatformDirectLocalAppLaunch(
		s.directLocalAppLaunches,
		launchID,
		req.GetChildProcessId(),
		desktopPeer,
		s.now().UTC().Add(localDevelopmentProcessBindTTL),
	)
	if err != nil {
		return nil, localDevelopmentFailureAtStageFromCause(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_PROCESS_MISMATCH, "rebind-direct-peer", err)
	}
	return &runtimev1.RebindLocalAppProcessResponse{
		LaunchId: append([]byte(nil), launchID[:]...), BindDeadline: timestamppb.New(deadline), ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
	}, nil
}

func (s *Service) EndLocalDevelopmentRun(ctx context.Context, req *runtimev1.EndLocalDevelopmentRunRequest) (*runtimev1.EndLocalDevelopmentRunResponse, error) {
	if err := requireProtectedLocalDevelopmentDesktop(ctx); err != nil {
		return nil, err
	}
	if s == nil || s.localDevelopment == nil || req == nil {
		return nil, localDevelopmentFailure(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
	}
	handle, handleOK := localDevelopmentIdentifierFromBytes(req.GetRegistrationHandle())
	runID, runOK := localDevelopmentIdentifierFromBytes(req.GetSupervisorRunId())
	if !handleOK || !runOK {
		return nil, localDevelopmentFailure(codes.InvalidArgument, runtimev1.ReasonCode_LOCAL_APP_LAUNCH_LEASE_REQUIRED)
	}
	if err := s.localDevelopment.EndRun(ctx, handle, runID); err != nil {
		return nil, localDevelopmentStoreError(err)
	}
	if s.directLocalAppLaunches != nil {
		s.directLocalAppLaunches.RevokeRun(handle, runID)
	}
	if connection, ok := protectedlocal.DesktopConnectionFromContext(ctx); ok {
		connection.UnbindRevocationHook(runID)
	}
	return &runtimev1.EndLocalDevelopmentRunResponse{ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func localDevelopmentIdentifierFromBytes(value []byte) (protectedlocal.Identifier, bool) {
	if len(value) != protectedlocal.IdentifierBytes {
		return protectedlocal.Identifier{}, false
	}
	var identifier protectedlocal.Identifier
	copy(identifier[:], value)
	return identifier, identifier != (protectedlocal.Identifier{})
}

func requireProtectedLocalDevelopmentDesktop(ctx context.Context) error {
	connection, ok := protectedlocal.DesktopConnectionFromContext(ctx)
	if !ok || connection == nil {
		return localDevelopmentFailure(codes.PermissionDenied, runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED)
	}
	if !connection.VerifiedDesktopTransport() {
		return localDevelopmentFailure(codes.PermissionDenied, runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH)
	}
	return nil
}

func localDevelopmentRegistrationToProto(registration localappkernel.Registration) *runtimev1.LocalDevelopmentRegistrationProjection {
	handle, ok := localDevelopmentRegistrationIdentifier(registration.RegistrationHandle)
	if !ok {
		return nil
	}
	project := localDevelopmentProjectSnapshot{
		AppID: registration.AppID, DisplayName: registration.DisplayName,
		ProjectRoot: registration.ProjectRoot, ManifestPath: registration.ManifestPath,
		ShellKind: runtimev1.LocalDevelopmentShellKind(registration.ShellKind), RawAppAccess: append([]string(nil), registration.RawDeclaration...),
		ActivatedDomains: append([]string(nil), registration.ActivatedDomains...),
		SourceGeneration: registration.SourceGeneration, DeclarationGeneration: registration.DeclarationGeneration,
	}
	return &runtimev1.LocalDevelopmentRegistrationProjection{
		RegistrationHandle: append([]byte(nil), handle[:]...), Project: localDevelopmentProjectToProto(project),
		RegisteredAt: timestamppb.New(registration.CreatedAt), UpdatedAt: timestamppb.New(registration.UpdatedAt),
		ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
	}
}

func localDevelopmentProjectToProto(project localDevelopmentProjectSnapshot) *runtimev1.LocalDevelopmentProjectProjection {
	return &runtimev1.LocalDevelopmentProjectProjection{
		AppId: project.AppID, DisplayName: project.DisplayName,
		CanonicalProjectRoot: project.ProjectRoot, CanonicalManifestPath: project.ManifestPath,
		ShellKind: runtimev1.LocalDevelopmentShellKind(project.ShellKind), AppAccess: append([]string(nil), project.RawAppAccess...),
		TrustClass: localDevelopmentTrustClass, SourceGeneration: project.SourceGeneration,
		DeclarationGeneration: project.DeclarationGeneration,
	}
}

func sameLocalDevelopmentFile(left, right string) bool {
	if sameLocalDevelopmentPath(left, right) {
		return true
	}
	leftInfo, leftErr := os.Stat(left)
	rightInfo, rightErr := os.Stat(right)
	return leftErr == nil && rightErr == nil && leftInfo.Mode().IsRegular() && rightInfo.Mode().IsRegular() && os.SameFile(leftInfo, rightInfo)
}

func sameLocalDevelopmentPath(left, right string) bool {
	left, right = filepath.Clean(left), filepath.Clean(right)
	if filepath.Separator == '\\' {
		return strings.EqualFold(left, right)
	}
	return left == right
}

func localDevelopmentProjectAuthorityError(err error) error {
	return localDevelopmentFailureAtStageFromCause(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_PROVENANCE_UNAVAILABLE, "project-authority", err)
}

func localDevelopmentStoreError(err error) error {
	switch {
	case errors.Is(err, localappkernel.ErrNotFound), errors.Is(err, localappkernel.ErrRegistrationTombstoned):
		return localDevelopmentFailureFromCause(codes.NotFound, runtimev1.ReasonCode_LOCAL_APP_RECORD_NOT_FOUND, err)
	case errors.Is(err, errLocalDevelopmentProjectChanged), errors.Is(err, errLocalDevelopmentProjectUnstable), errors.Is(err, localappkernel.ErrRevisionConflict):
		return localDevelopmentFailureFromCause(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_PROVENANCE_UNAVAILABLE, err)
	case errors.Is(err, errLocalDevelopmentLaunchExpired), errors.Is(err, errLocalDevelopmentSessionRevoked):
		return localDevelopmentFailureFromCause(codes.Unauthenticated, runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED, err)
	case errors.Is(err, errLocalDevelopmentLaunchMismatch), errors.Is(err, errLocalDevelopmentProcessMismatch):
		return localDevelopmentFailureFromCause(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_PROCESS_MISMATCH, err)
	default:
		return localDevelopmentFailureFromCause(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE, err)
	}
}

func localDevelopmentFailure(code codes.Code, reason runtimev1.ReasonCode) error {
	return grpcerr.WithReasonCode(code, reason)
}

func localDevelopmentFailureFromCause(code codes.Code, reason runtimev1.ReasonCode, cause error) error {
	return grpcerr.WrapWithReasonCode(code, reason, cause, grpcerr.ReasonOptions{Message: "local development operation failed"})
}

func localDevelopmentFailureAtStage(code codes.Code, reason runtimev1.ReasonCode, stage string) error {
	return grpcerr.WithReasonCodeOptions(code, reason, grpcerr.ReasonOptions{Metadata: map[string]string{"diagnostic_stage": stage}})
}

func localDevelopmentFailureAtStageFromCause(code codes.Code, reason runtimev1.ReasonCode, stage string, cause error) error {
	return grpcerr.WrapWithReasonCode(code, reason, cause, grpcerr.ReasonOptions{Message: "local development operation failed", Metadata: map[string]string{"diagnostic_stage": stage}})
}
