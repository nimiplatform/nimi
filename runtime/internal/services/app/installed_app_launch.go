package app

import (
	"context"
	"crypto/rand"
	"errors"
	"sync"
	"time"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/nimiappinstall"
	"github.com/nimiplatform/nimi/runtime/internal/nimiappnative"
	"github.com/nimiplatform/nimi/runtime/internal/nimiapppackage"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"github.com/nimiplatform/nimi/runtime/internal/publicappregistry"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Ephemeral launch ownership, not a persisted process or authorization record.
type installedAppLaunch struct {
	mu       sync.Mutex
	id       protectedlocal.Identifier
	owner    *protectedlocal.Connection
	verified nimiappinstall.VerifiedInstalledLaunch
	policy   protectedlocal.InstalledAppProcessPolicy
	expires  time.Time
	bound    bool
	closed   bool
	liveness protectedlocal.DesktopProcessLiveness
}

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-034a
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-040c
func (s *Service) PrepareInstalledAppLaunch(ctx context.Context, req *runtimev1.PrepareInstalledAppLaunchRequest) (*runtimev1.PrepareInstalledAppLaunchResponse, error) {
	if err := requireProtectedLocalDevelopmentDesktop(ctx); err != nil {
		return nil, err
	}
	if s == nil || s.appInstallCoordinator == nil || req == nil {
		return nil, installedLaunchUnavailable()
	}
	selector := req.GetLaunchSelector()
	if len(selector) == 0 || len(selector) > 160 || !utf8.Valid(selector) {
		return nil, installedLaunchMismatch()
	}
	owner, _ := protectedlocal.DesktopConnectionFromContext(ctx)
	supervisor, ok := owner.ClientProcess()
	if !ok || supervisor.OS != protectedlocal.OSWindows {
		return nil, installedLaunchUnavailable()
	}
	var lease *installedAppLaunch
	err := s.appInstallCoordinator.WithVerifiedInstalledLaunch(ctx, string(selector), func(verified nimiappinstall.VerifiedInstalledLaunch) error {
		handle, ok := localDevelopmentRegistrationIdentifier(verified.Registration.RegistrationHandle)
		if !ok {
			return installedLaunchMismatch()
		}
		var runID protectedlocal.Identifier
		if _, err := rand.Read(runID[:]); err != nil {
			return err
		}
		id := runID
		expires := s.now().UTC().Add(30 * time.Second)
		if s.directLocalAppLaunches != nil {
			peer, direct := owner.DirectDesktopPeer()
			if !direct {
				return installedLaunchUnavailable()
			}
			prepared, err := s.directLocalAppLaunches.Prepare(handle, runID, verified.Registration.SourceGeneration,
				verified.Registration.DeclarationGeneration, peer.PID, peer.UID, verified.RuntimeEntry, expires)
			if err != nil {
				return err
			}
			id = prepared.LaunchID
		} else if s.localDevelopmentRegistry == nil {
			return installedLaunchUnavailable()
		}
		lease = &installedAppLaunch{id: id, owner: owner, verified: verified, expires: expires,
			policy: protectedlocal.InstalledAppProcessPolicy{RegistrationHandle: verified.Registration.RegistrationHandle,
				SourceGeneration: verified.Registration.SourceGeneration, DeclarationGeneration: verified.Registration.DeclarationGeneration,
				HostExecutablePath: verified.RuntimeEntry, HostExecutableDigest: verified.ExecutableDigest,
				ExecutionProfileRef: verified.Release.ExecutionProfileRef, SupervisorProcess: supervisor}}
		s.installedLaunchMu.Lock()
		if s.installedLaunches == nil {
			s.installedLaunches = make(map[protectedlocal.Identifier]*installedAppLaunch)
		}
		for _, active := range s.installedLaunches {
			if active.policy.RegistrationHandle == lease.policy.RegistrationHandle {
				s.installedLaunchMu.Unlock()
				if s.directLocalAppLaunches != nil {
					s.directLocalAppLaunches.Revoke(id)
				}
				return grpcerr.WithReasonCode(codes.AlreadyExists, runtimev1.ReasonCode_LOCAL_APP_LAUNCH_LEASE_REPLAY)
			}
		}
		s.installedLaunches[id] = lease
		s.installedLaunchMu.Unlock()
		return nil
	})
	if err != nil {
		return nil, installedLaunchError(err)
	}
	if err := owner.BindRevocationHook(lease.id, func() { s.revokeInstalledLaunch(lease.id) }); err != nil {
		s.revokeInstalledLaunch(lease.id)
		return nil, installedLaunchMismatch()
	}
	time.AfterFunc(time.Until(lease.expires), func() {
		lease.mu.Lock()
		expired := !lease.bound && !lease.closed
		if expired {
			lease.closed = true
		}
		lease.mu.Unlock()
		if expired {
			s.revokeInstalledLaunch(lease.id)
		}
	})
	return &runtimev1.PrepareInstalledAppLaunchResponse{LaunchId: append([]byte(nil), lease.id[:]...),
		AppId: lease.verified.Release.AppID, Version: lease.verified.Release.Version, ExecutablePath: lease.verified.RuntimeEntry,
		WorkingDirectory: lease.verified.WorkingDirectory, Arguments: []string{}, ExecutableSha256: append([]byte(nil), lease.verified.ExecutableDigest[:]...),
		ExecutionProfileRef: lease.policy.ExecutionProfileRef, BindDeadline: timestamppb.New(lease.expires), ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func (s *Service) installedLaunch(raw []byte) *installedAppLaunch {
	if s == nil {
		return nil
	}
	id, ok := localDevelopmentIdentifierFromBytes(raw)
	if !ok {
		return nil
	}
	s.installedLaunchMu.Lock()
	defer s.installedLaunchMu.Unlock()
	return s.installedLaunches[id]
}

func (s *Service) bindInstalledAppProcess(ctx context.Context, req *runtimev1.BindLocalAppProcessRequest) (*runtimev1.BindLocalAppProcessResponse, error) {
	lease := s.installedLaunch(req.GetLaunchId())
	owner, ok := protectedlocal.DesktopConnectionFromContext(ctx)
	if lease == nil || !ok || lease.owner != owner || req.GetChildProcessId() == 0 {
		return nil, installedLaunchMismatch()
	}
	lease.mu.Lock()
	defer lease.mu.Unlock()
	if lease.closed || lease.bound || !s.now().UTC().Before(lease.expires) {
		return nil, installedLaunchMismatch()
	}
	var deadline time.Time
	err := s.appInstallCoordinator.WithVerifiedInstalledLaunch(ctx, lease.policy.RegistrationHandle, func(current nimiappinstall.VerifiedInstalledLaunch) error {
		if current.Registration.SourceGeneration != lease.policy.SourceGeneration || current.Registration.DeclarationGeneration != lease.policy.DeclarationGeneration ||
			current.Release.ReleaseRef != lease.verified.Release.ReleaseRef || current.Release.PayloadRootDigest != lease.verified.Release.PayloadRootDigest ||
			current.ExecutableDigest != lease.policy.HostExecutableDigest || current.RuntimeEntry != lease.policy.HostExecutablePath || !s.now().UTC().Before(lease.expires) {
			return installedLaunchMismatch()
		}
		process, liveness, err := protectedlocal.VerifyInstalledAppProcess(ctx, req.GetChildProcessId(), lease.policy)
		if err != nil {
			return installedLaunchMismatch()
		}
		accepted := false
		defer func() {
			if !accepted {
				_ = liveness.Close()
			}
		}()
		deadline = s.now().UTC().Add(10 * time.Second)
		if deadline.After(lease.expires) {
			deadline = lease.expires
		}
		if s.directLocalAppLaunches != nil {
			peer, direct := owner.DirectDesktopPeer()
			if !direct {
				return installedLaunchMismatch()
			}
			if _, err := s.directLocalAppLaunches.BindInstalled(lease.id, lease.policy, process, peer.UID, deadline); err != nil {
				return installedLaunchMismatch()
			}
		} else {
			if err := s.localDevelopmentRegistry.BindInstalled(lease.id, lease.policy, process, liveness, func() { s.invalidateInstalledLaunchAccess(lease.id) }); err != nil {
				return installedLaunchMismatch()
			}
		}
		lease.liveness = liveness
		lease.bound = true
		accepted = true
		return nil
	})
	if err != nil {
		return nil, installedLaunchError(err)
	}
	return &runtimev1.BindLocalAppProcessResponse{LaunchId: append([]byte(nil), lease.id[:]...), BindDeadline: timestamppb.New(deadline), ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func (s *Service) EndInstalledAppRun(ctx context.Context, req *runtimev1.EndInstalledAppRunRequest) (*runtimev1.EndInstalledAppRunResponse, error) {
	if err := requireProtectedLocalDevelopmentDesktop(ctx); err != nil {
		return nil, err
	}
	if req == nil {
		return nil, installedLaunchMismatch()
	}
	lease := s.installedLaunch(req.GetLaunchId())
	owner, _ := protectedlocal.DesktopConnectionFromContext(ctx)
	if lease == nil {
		if _, valid := localDevelopmentIdentifierFromBytes(req.GetLaunchId()); !valid {
			return nil, installedLaunchMismatch()
		}
		return &runtimev1.EndInstalledAppRunResponse{ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
	}
	if lease.owner != owner {
		return nil, installedLaunchMismatch()
	}
	lease.mu.Lock()
	liveness := lease.liveness
	lease.mu.Unlock()
	if liveness != nil {
		select {
		case <-liveness.Revoked():
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(5 * time.Second):
			return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_PROCESS_MISMATCH)
		}
	}
	s.revokeInstalledLaunch(lease.id)
	return &runtimev1.EndInstalledAppRunResponse{ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func (s *Service) GetInstalledAppRunAccess(ctx context.Context, req *runtimev1.GetInstalledAppRunAccessRequest) (*runtimev1.GetInstalledAppRunAccessResponse, error) {
	if err := requireProtectedLocalDevelopmentDesktop(ctx); err != nil {
		return nil, err
	}
	if req == nil {
		return nil, installedLaunchMismatch()
	}
	lease := s.installedLaunch(req.GetLaunchId())
	owner, _ := protectedlocal.DesktopConnectionFromContext(ctx)
	if lease == nil || lease.owner != owner {
		return nil, installedLaunchMismatch()
	}
	// Inspect the actual Runtime-created session, never process existence.
	s.localAppSessionMu.RLock()
	var connection *protectedlocal.LocalAppConnection
	for candidate, session := range s.localAppSessions {
		if session.launchCorrelation == lease.id && session.registrationHandle == lease.policy.RegistrationHandle {
			connection = candidate
			break
		}
	}
	s.localAppSessionMu.RUnlock()
	if connection == nil {
		return &runtimev1.GetInstalledAppRunAccessResponse{ReasonCode: runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED}, nil
	}
	_, _, err := s.admitLocalAppIngress(protectedlocal.ContextWithLocalAppConnection(ctx, connection), localappop.IngressStorageJSONRead)
	if err != nil {
		return &runtimev1.GetInstalledAppRunAccessResponse{ReasonCode: runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED}, nil
	}
	return &runtimev1.GetInstalledAppRunAccessResponse{Available: true, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func (s *Service) revokeInstalledLaunch(id protectedlocal.Identifier) {
	s.installedLaunchMu.Lock()
	lease := s.installedLaunches[id]
	delete(s.installedLaunches, id)
	s.installedLaunchMu.Unlock()
	if lease == nil {
		return
	}
	lease.owner.UnbindRevocationHook(id)
	lease.mu.Lock()
	lease.closed = true
	liveness := lease.liveness
	lease.mu.Unlock()
	if s.directLocalAppLaunches != nil {
		s.directLocalAppLaunches.Revoke(id)
	}
	if s.localDevelopmentRegistry != nil {
		s.localDevelopmentRegistry.RevokeInstalled(id)
	}
	if liveness != nil {
		_ = liveness.Close()
	}
	s.invalidateInstalledLaunchAccess(id)
}

func (s *Service) invalidateInstalledLaunchAccess(id protectedlocal.Identifier) {
	s.localAppSessionMu.RLock()
	var connections []*protectedlocal.LocalAppConnection
	for connection, session := range s.localAppSessions {
		if session.launchCorrelation == id {
			connections = append(connections, connection)
		}
	}
	s.localAppSessionMu.RUnlock()
	for _, connection := range connections {
		connection.Revoke()
	}
}

func installedLaunchMismatch() error {
	return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_LAUNCH_LEASE_MISMATCH)
}
func installedLaunchUnavailable() error {
	return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
}
func installedLaunchError(err error) error {
	if _, ok := status.FromError(err); ok {
		return err
	}
	var blocked *publicappregistry.PolicyBlockedError
	if errors.As(err, &blocked) || errors.Is(err, localappkernel.ErrPackageJobActive) {
		return appPackageInstallStartError(err)
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return status.FromContextError(err).Err()
	}
	if errors.Is(err, nimiapppackage.ErrPackageIntegrity) || errors.Is(err, nimiappnative.ErrNativeVerification) || errors.Is(err, nimiappnative.ErrNativePostureMismatch) {
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_PROVENANCE_UNAVAILABLE)
	}
	if errors.Is(err, nimiappinstall.ErrInstalledLaunch) {
		return installedLaunchUnavailable()
	}
	return installedLaunchUnavailable()
}
