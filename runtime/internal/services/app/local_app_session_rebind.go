package app

import (
	"context"
	"fmt"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/nimiappinstall"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	authservice "github.com/nimiplatform/nimi/runtime/internal/services/auth"
	"google.golang.org/grpc/codes"
)

func localAppSessionContextError(ctx context.Context, connection *protectedlocal.LocalAppConnection) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if decision, ok := accountservice.AuthorizedLocalAppDecisionFromContext(ctx); ok {
		select {
		case <-decision.SessionInvalidated:
			return errLocalDevelopmentSessionRevoked
		default:
		}
		handle, bound := connection.Session()
		if !bound || handle.SessionID != decision.SessionID {
			return errLocalDevelopmentSessionRevoked
		}
	}
	return nil
}

// @nimi-authority: rule.nimi.runtime.protected-session.r017
func (s *Service) RebindLocalAppSessionProjection(ctx context.Context) (authservice.LocalAppSessionProjection, error) {
	fail := func() (authservice.LocalAppSessionProjection, error) {
		return authservice.LocalAppSessionProjection{}, localDevelopmentFailure(codes.Unauthenticated, runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED)
	}
	connection, ok := protectedlocal.LocalAppConnectionFromContext(ctx)
	if s == nil || s.localAppKernel == nil || !ok || connection == nil || !connection.ProtectedOperationAllowed() {
		return fail()
	}
	if err := localAppSessionContextError(ctx, connection); err != nil {
		return authservice.LocalAppSessionProjection{}, localAppIngressError(err)
	}
	s.localAppSessionRebindMu.Lock()
	defer s.localAppSessionRebindMu.Unlock()
	previousHandle, bound := connection.Session()
	if !bound {
		return fail()
	}
	s.localAppSessionMu.RLock()
	previous, exists := s.localAppSessions[connection]
	s.localAppSessionMu.RUnlock()
	if !exists || previous.handle != previousHandle {
		return fail()
	}
	_, live, liveErr := s.currentFormalAppSessionProjection(ctx, connection)
	if ctx.Err() != nil {
		return authservice.LocalAppSessionProjection{}, ctx.Err()
	}
	if !live || liveErr != nil {
		connection.InvalidateSession(previousHandle)
	}
	if err := s.localAppRebindSupervision(ctx, connection, previous); err != nil {
		connection.InvalidateSession(previousHandle)
		return authservice.LocalAppSessionProjection{}, err
	}
	verifier := s.localAppRebindVerifier
	if verifier == nil {
		verifier = s.revalidateLocalAppRebindSource
	}
	registration, err := verifier(ctx, connection, previous)
	if ctx.Err() != nil {
		return authservice.LocalAppSessionProjection{}, ctx.Err()
	}
	if err != nil {
		connection.InvalidateSession(previousHandle)
		return authservice.LocalAppSessionProjection{}, localDevelopmentFailureAtStageFromCause(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_PROCESS_MISMATCH, "session-rebind-source", err)
	}
	// These counters are the source owner's result of rereading launch inputs,
	// not caller assertions. A changed security launch source needs a new launch.
	if registration.RegistrationHandle != previous.registrationHandle || registration.RegisteredAppSubject != previous.registeredAppSubject || registration.AppID != previous.appID || registration.State != localappkernel.RegistrationStateActive || registration.SourceGeneration != previous.sourceGeneration {
		connection.InvalidateSession(previousHandle)
		return authservice.LocalAppSessionProjection{}, localDevelopmentFailure(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_LAUNCH_LEASE_REQUIRED)
	}
	if live && liveErr == nil {
		current, currentOK, currentErr := s.currentFormalAppSessionProjection(ctx, connection)
		if currentErr == nil && currentOK {
			return current, nil
		}
	}
	// Close the old callback/resource fence before capturing any fresh scope.
	if !connection.InvalidateSession(previousHandle) {
		return fail()
	}
	launch := localAppSessionLaunchBinding{registrationHandle: previous.registrationHandle, launchCorrelation: previous.launchCorrelation, desktopOwner: previous.desktopOwner, supervisorRunID: previous.supervisorRunID}
	next, err := s.deriveLocalAppRuntimeSession(ctx, connection, launch)
	if err != nil {
		return authservice.LocalAppSessionProjection{}, localAppSessionEstablishmentError(err)
	}
	if next.sourceGeneration != registration.SourceGeneration || next.declarationGeneration != registration.DeclarationGeneration {
		return fail()
	}
	if err := s.localAppRebindSupervision(ctx, connection, previous); err != nil {
		return authservice.LocalAppSessionProjection{}, err
	}
	if err := ctx.Err(); err != nil {
		return authservice.LocalAppSessionProjection{}, err
	}
	if err := connection.RotateSession(previousHandle, next.handle); err != nil {
		return fail()
	}
	s.localAppSessionMu.Lock()
	current, currentOK := s.localAppSessions[connection]
	if !currentOK || current.handle != previousHandle {
		s.localAppSessionMu.Unlock()
		connection.InvalidateSession(next.handle)
		return fail()
	}
	s.localAppSessions[connection] = next
	s.localAppSessionMu.Unlock()
	s.expireLocalAppRuntimeSession(connection, next)
	return localAppAuthSessionProjection(next), nil
}

func (s *Service) localAppRebindSupervision(ctx context.Context, connection *protectedlocal.LocalAppConnection, previous localAppRuntimeSession) error {
	if !connection.Live() || !connection.ProtectedOperationAllowed() || previous.desktopOwner == nil || !previous.desktopOwner.VerifiedDesktopTransport() {
		return localDevelopmentFailure(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_LAUNCH_LEASE_REQUIRED)
	}
	if claimed, ok := protectedlocal.DesktopConnectionFromContext(ctx); ok && claimed != previous.desktopOwner {
		return installedLaunchMismatch()
	}
	if connection.TrustClass() == protectedlocal.LocalAppTrustLocalDevelopment {
		if previous.supervisorRunID == (protectedlocal.Identifier{}) || !previous.desktopOwner.HasBoundRevocationHook(previous.supervisorRunID) {
			return installedLaunchMismatch()
		}
		if s.localDevelopment == nil || s.localDevelopment.RequireDeveloperMode(ctx) != nil {
			return localDevelopmentFailure(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_DEVELOPER_MODE_DISABLED)
		}
		return nil
	}
	if connection.TrustClass() == protectedlocal.LocalAppTrustBuiltIn {
		s.formalAppMu.Lock()
		valid := false
		for key, binding := range s.formalApps {
			if binding != nil && binding.connection == connection && key.desktop == previous.desktopOwner && key.appID == previous.appID {
				valid = true
				break
			}
		}
		s.formalAppMu.Unlock()
		if valid {
			return nil
		}
	}
	lease := s.installedLaunch(previous.launchCorrelation[:])
	if lease == nil || lease.owner != previous.desktopOwner || lease.policy.RegistrationHandle != previous.registrationHandle {
		return installedLaunchMismatch()
	}
	lease.mu.Lock()
	valid := lease.bound && !lease.closed
	lease.mu.Unlock()
	if !valid {
		return installedLaunchMismatch()
	}
	return nil
}

func (s *Service) revalidateLocalAppRebindSource(ctx context.Context, connection *protectedlocal.LocalAppConnection, previous localAppRuntimeSession) (localappkernel.Registration, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	registration, err := s.localAppKernel.Registrations().GetByHandle(ctx, previous.registrationHandle)
	if err != nil || registration.State != localappkernel.RegistrationStateActive {
		return localappkernel.Registration{}, errLocalDevelopmentSessionRevoked
	}
	if connection.TrustClass() == protectedlocal.LocalAppTrustLocalDevelopment {
		project, err := resolveLocalDevelopmentProject(registration.ProjectRoot, registration.AppID, runtimev1.LocalDevelopmentShellKind(registration.ShellKind))
		if err != nil {
			return localappkernel.Registration{}, err
		}
		registration, err = s.registerLocalDevelopmentProject(ctx, project, previous.registrationHandle)
		if err != nil {
			return localappkernel.Registration{}, err
		}
		host, err := localDevelopmentHostExecutable(project)
		if err != nil {
			return localappkernel.Registration{}, err
		}
		if direct, ok := connection.DirectLaunch(); ok {
			if !sameLocalDevelopmentFile(host, direct.HostExecutablePath) {
				return localappkernel.Registration{}, errLocalDevelopmentProcessMismatch
			}
			err = protectedlocal.RevalidateDirectLocalAppProcess(ctx, connection)
		} else {
			if s.localDevelopmentVerifier == nil {
				return localappkernel.Registration{}, errLocalDevelopmentProcessMismatch
			}
			if err = protectedlocal.RevalidateDesktopConnectionProcess(ctx, previous.desktopOwner); err != nil {
				return localappkernel.Registration{}, err
			}
			parent, ok := previous.desktopOwner.ClientProcess()
			if !ok {
				return localappkernel.Registration{}, errLocalDevelopmentProcessMismatch
			}
			if err = protectedlocal.VerifyLocalAppProcessParent(ctx, connection.Process().PID, previous.desktopOwner); err != nil {
				return localappkernel.Registration{}, err
			}
			process, live, verifyErr := s.localDevelopmentVerifier.VerifyLocalDevelopmentProcess(ctx, connection.Process().PID, protectedlocal.LocalDevelopmentProcessPolicy{ProjectRoot: project.ProjectRoot, HostExecutablePath: host, SupervisorProcess: parent})
			if verifyErr != nil {
				return localappkernel.Registration{}, verifyErr
			}
			if live == nil {
				return localappkernel.Registration{}, errLocalDevelopmentProcessMismatch
			}
			_ = live.Close()
			if process != connection.Process() {
				return localappkernel.Registration{}, errLocalDevelopmentProcessMismatch
			}
		}
		return registration, err
	}
	if connection.TrustClass() == protectedlocal.LocalAppTrustBuiltIn && registration.BindingSlot != "" {
		if err := protectedlocal.RevalidateDesktopConnectionProcess(ctx, previous.desktopOwner); err != nil {
			return localappkernel.Registration{}, err
		}
		process, ok := previous.desktopOwner.ClientProcess()
		if !ok || process != connection.Process() {
			return localappkernel.Registration{}, errLocalDevelopmentProcessMismatch
		}
		return s.registerFormalAppRelease(ctx, previous.appID, registration.BindingSlot, process)
	}
	lease := s.installedLaunch(previous.launchCorrelation[:])
	if lease == nil || s.appInstallCoordinator == nil {
		return localappkernel.Registration{}, errLocalDevelopmentLaunchMismatch
	}
	err = s.appInstallCoordinator.WithInstalledLaunch(ctx, previous.registrationHandle, func(current nimiappinstall.InstalledLaunch) error {
		if current.RuntimeEntry != lease.verified.RuntimeEntry || current.WorkingDirectory != lease.verified.WorkingDirectory || current.ExecutableDigest != lease.verified.ExecutableDigest || current.Release.PayloadRootDigest != lease.verified.Release.PayloadRootDigest {
			return errLocalDevelopmentProcessMismatch
		}
		registration = current.Registration
		if _, direct := connection.DirectLaunch(); direct {
			return protectedlocal.RevalidateDirectLocalAppProcess(ctx, connection)
		}
		if err := protectedlocal.RevalidateDesktopConnectionProcess(ctx, previous.desktopOwner); err != nil {
			return err
		}
		return protectedlocal.RevalidateInstalledAppProcess(ctx, connection.Process(), lease.policy)
	})
	if err != nil {
		return localappkernel.Registration{}, fmt.Errorf("revalidate installed launch: %w", err)
	}
	return registration, nil
}
