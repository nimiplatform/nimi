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
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	authservice "github.com/nimiplatform/nimi/runtime/internal/services/auth"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const localDevelopmentTrustClass = "local_development"

func (s *Service) RevokeAccountAuthority(ctx context.Context, accountID string) error {
	if s == nil || s.localDevelopment == nil {
		return errLocalDevelopmentInvalid
	}
	normalized := strings.TrimSpace(accountID)
	if err := s.localDevelopment.RevokeAccountAuthority(ctx, normalized); err != nil {
		return err
	}
	authorizations, err := s.localDevelopment.List(ctx)
	if err != nil {
		return err
	}
	for _, authorization := range authorizations {
		if authorization.Project.AccountID != normalized {
			continue
		}
		if authorization.State == localDevelopmentAuthorizationRevoked {
			if s.directLocalAppLaunches != nil {
				s.directLocalAppLaunches.RevokeAuthorization(authorization.ID)
			}
			if err := s.transitionLocalDevelopmentRecord(ctx, authorization, localappkernel.LifecycleStateRemoved, true); err != nil {
				return err
			}
		}
	}
	return nil
}

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
	return &runtimev1.GetDeveloperModeStatusResponse{State: state, Revision: mode.Revision, AccountGeneration: mode.AccountGeneration, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func (s *Service) SetDeveloperMode(ctx context.Context, req *runtimev1.SetDeveloperModeRequest) (*runtimev1.SetDeveloperModeResponse, error) {
	if err := requireProtectedLocalDevelopmentDesktop(ctx); err != nil {
		return nil, err
	}
	if s == nil || s.localDevelopment == nil || req == nil {
		return nil, localDevelopmentFailure(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
	}
	account, generation, authenticated := s.authenticatedRuntimeAccount(ctx)
	if !authenticated {
		return nil, localDevelopmentFailure(codes.Unauthenticated, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}
	mode, err := s.localDevelopment.SetDeveloperMode(ctx, req.GetEnabled(), account.GetAccountId(), generation)
	if err != nil {
		return nil, localDevelopmentStoreError(err)
	}
	if !req.GetEnabled() {
		authorizations, listErr := s.localDevelopment.List(ctx)
		if listErr != nil {
			return nil, localDevelopmentStoreError(listErr)
		}
		for _, authorization := range authorizations {
			switch authorization.State {
			case localDevelopmentAuthorizationRevoked:
				if transitionErr := s.transitionLocalDevelopmentRecord(ctx, authorization, localappkernel.LifecycleStateRemoved, true); transitionErr != nil {
					return nil, localDevelopmentStoreError(transitionErr)
				}
			}
		}
	}
	state := runtimev1.DeveloperModeState_DEVELOPER_MODE_STATE_DISABLED
	if mode.Enabled {
		state = runtimev1.DeveloperModeState_DEVELOPER_MODE_STATE_ENABLED
	}
	return &runtimev1.SetDeveloperModeResponse{State: state, Revision: mode.Revision, AccountGeneration: mode.AccountGeneration, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func (s *Service) EvaluateLocalDevelopmentProject(ctx context.Context, req *runtimev1.EvaluateLocalDevelopmentProjectRequest) (*runtimev1.EvaluateLocalDevelopmentProjectResponse, error) {
	if err := requireProtectedLocalDevelopmentDesktop(ctx); err != nil {
		return nil, err
	}
	if s == nil || s.localDevelopment == nil || s.localDevelopmentVerifier == nil || req == nil {
		return nil, localDevelopmentFailure(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
	}
	runID, ok := localDevelopmentIdentifierFromBytes(req.GetSupervisorRunId())
	if !ok {
		return nil, localDevelopmentFailure(codes.InvalidArgument, runtimev1.ReasonCode_LOCAL_APP_LAUNCH_LEASE_REQUIRED)
	}
	account, generation, authenticated := s.authenticatedRuntimeAccount(ctx)
	if !authenticated {
		return nil, localDevelopmentFailure(codes.Unauthenticated, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}
	if err := s.localDevelopment.RequireDeveloperMode(ctx, account.GetAccountId(), generation); err != nil {
		return nil, localDevelopmentFailureFromCause(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_DEVELOPER_MODE_DISABLED, err)
	}
	project, err := resolveLocalDevelopmentProject(req.GetProjectRoot(), req.GetExpectedAppId(), req.GetShellKind(), account.GetAccountId(), generation)
	if err != nil {
		return nil, localDevelopmentProjectAuthorityError(err)
	}
	evaluation, err := s.localDevelopment.Evaluate(ctx, project, runID)
	if err != nil {
		return nil, localDevelopmentStoreError(err)
	}
	if evaluation.State == runtimev1.LocalDevelopmentAuthorizationState_LOCAL_DEVELOPMENT_AUTHORIZATION_STATE_ACTIVE {
		if _, _, kernelErr := s.prepareLocalDevelopmentRecord(ctx, evaluation.Authorization); kernelErr != nil {
			if !localDevelopmentPreparationInvalidatesAuthorization(kernelErr) {
				return nil, localDevelopmentFailureAtStageFromCause(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_PROVENANCE_UNAVAILABLE, "local-app-record", kernelErr)
			}
			_, _ = s.localDevelopment.RevokeAuthorization(ctx, evaluation.Authorization.ID)
			_ = s.transitionLocalDevelopmentRecord(context.Background(), evaluation.Authorization, localappkernel.LifecycleStateRemoved, true)
			evaluation, err = s.localDevelopment.Evaluate(ctx, project, runID)
			if err != nil {
				return nil, localDevelopmentStoreError(err)
			}
		}
	}
	response := &runtimev1.EvaluateLocalDevelopmentProjectResponse{
		Project:              localDevelopmentProjectToProto(evaluation.Project),
		State:                evaluation.State,
		ConfirmationRequired: evaluation.State != runtimev1.LocalDevelopmentAuthorizationState_LOCAL_DEVELOPMENT_AUTHORIZATION_STATE_ACTIVE,
		ReasonCode:           runtimev1.ReasonCode_ACTION_EXECUTED,
	}
	if evaluation.EvaluationID != (protectedlocal.Identifier{}) {
		response.EvaluationId = append([]byte(nil), evaluation.EvaluationID[:]...)
		response.EvaluationExpiresAt = timestamppb.New(evaluation.ExpiresAt)
	}
	if evaluation.Authorization.ID != (protectedlocal.Identifier{}) {
		response.Authorization = localDevelopmentAuthorizationToProto(evaluation.Authorization)
	}
	return response, nil
}

func (s *Service) DecideLocalDevelopmentProject(ctx context.Context, req *runtimev1.DecideLocalDevelopmentProjectRequest) (*runtimev1.DecideLocalDevelopmentProjectResponse, error) {
	if err := requireProtectedLocalDevelopmentDesktop(ctx); err != nil {
		return nil, err
	}
	if s == nil || s.localDevelopment == nil || s.localDevelopmentVerifier == nil || req == nil {
		return nil, localDevelopmentFailure(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
	}
	evaluationID, ok := localDevelopmentIdentifierFromBytes(req.GetEvaluationId())
	if !ok || !validLocalDevelopmentDecision(req.GetDecision()) {
		return nil, localDevelopmentFailure(codes.InvalidArgument, runtimev1.ReasonCode_LOCAL_APP_RECORD_NOT_FOUND)
	}
	currentAccountID := ""
	var currentAccountGeneration uint64
	if req.GetDecision() != runtimev1.LocalDevelopmentDecision_LOCAL_DEVELOPMENT_DECISION_DENY {
		if !req.GetRiskDisclosureAcknowledged() {
			return nil, localDevelopmentFailure(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_RISK_DISCLOSURE_REQUIRED)
		}
		account, generation, authenticated := s.authenticatedRuntimeAccount(ctx)
		if !authenticated {
			return nil, localDevelopmentFailure(codes.Unauthenticated, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
		}
		currentAccountID = account.GetAccountId()
		currentAccountGeneration = generation
		if err := s.localDevelopment.RequireDeveloperMode(ctx, currentAccountID, currentAccountGeneration); err != nil {
			return nil, localDevelopmentFailureFromCause(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_DEVELOPER_MODE_DISABLED, err)
		}
	}
	authorization, err := s.localDevelopment.Decide(ctx, evaluationID, req.GetDecision(), currentAccountID, currentAccountGeneration)
	if err != nil {
		return nil, localDevelopmentStoreError(err)
	}
	if authorization.State == localDevelopmentAuthorizationActive {
		if _, _, prepareErr := s.prepareLocalDevelopmentRecord(ctx, authorization); prepareErr != nil {
			if localDevelopmentPreparationInvalidatesAuthorization(prepareErr) {
				_, _ = s.localDevelopment.RevokeAuthorization(context.Background(), authorization.ID)
				_ = s.transitionLocalDevelopmentRecord(context.Background(), authorization, localappkernel.LifecycleStateRemoved, true)
			}
			return nil, localDevelopmentFailureFromCause(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_PROVENANCE_UNAVAILABLE, prepareErr)
		}
	}
	reason := runtimev1.ReasonCode_ACTION_EXECUTED
	if authorization.State == localDevelopmentAuthorizationDenied {
		reason = runtimev1.ReasonCode_LOCAL_APP_RECORD_NOT_FOUND
	}
	return &runtimev1.DecideLocalDevelopmentProjectResponse{Authorization: localDevelopmentAuthorizationToProto(authorization), ReasonCode: reason}, nil
}

func (s *Service) ListLocalDevelopmentAuthorizations(ctx context.Context, _ *runtimev1.ListLocalDevelopmentAuthorizationsRequest) (*runtimev1.ListLocalDevelopmentAuthorizationsResponse, error) {
	if err := requireProtectedLocalDevelopmentDesktop(ctx); err != nil {
		return nil, err
	}
	if s == nil || s.localDevelopment == nil {
		return nil, localDevelopmentFailure(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
	}
	account, _, authenticated := s.authenticatedRuntimeAccount(ctx)
	if !authenticated {
		return nil, localDevelopmentFailure(codes.Unauthenticated, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}
	authorizations, err := s.localDevelopment.List(ctx)
	if err != nil {
		return nil, localDevelopmentStoreError(err)
	}
	response := &runtimev1.ListLocalDevelopmentAuthorizationsResponse{ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}
	for _, authorization := range authorizations {
		if authorization.Project.AccountID == account.GetAccountId() {
			response.Authorizations = append(response.Authorizations, localDevelopmentAuthorizationToProto(authorization))
		}
	}
	return response, nil
}

func (s *Service) RevokeLocalDevelopmentAuthorization(ctx context.Context, req *runtimev1.RevokeLocalDevelopmentAuthorizationRequest) (*runtimev1.RevokeLocalDevelopmentAuthorizationResponse, error) {
	if err := requireProtectedLocalDevelopmentDesktop(ctx); err != nil {
		return nil, err
	}
	if s == nil || s.localDevelopment == nil || req == nil {
		return nil, localDevelopmentFailure(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
	}
	authorizationID, ok := localDevelopmentIdentifierFromBytes(req.GetAuthorizationId())
	if !ok {
		return nil, localDevelopmentFailure(codes.InvalidArgument, runtimev1.ReasonCode_LOCAL_APP_RECORD_NOT_FOUND)
	}
	account, _, authenticated := s.authenticatedRuntimeAccount(ctx)
	if !authenticated {
		return nil, localDevelopmentFailure(codes.Unauthenticated, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}
	current, err := s.localDevelopment.GetAuthorization(ctx, authorizationID)
	if err != nil {
		return nil, localDevelopmentFailureFromCause(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_RECORD_NOT_FOUND, err)
	}
	if current.Project.AccountID != account.GetAccountId() {
		return nil, localDevelopmentFailure(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_RECORD_NOT_FOUND)
	}
	authorization, err := s.localDevelopment.RevokeAuthorization(ctx, authorizationID)
	if err != nil {
		return nil, localDevelopmentStoreError(err)
	}
	if s.directLocalAppLaunches != nil {
		s.directLocalAppLaunches.RevokeAuthorization(authorizationID)
	}
	if err := s.transitionLocalDevelopmentRecord(ctx, authorization, localappkernel.LifecycleStateRemoved, true); err != nil {
		return nil, localDevelopmentStoreError(err)
	}
	return &runtimev1.RevokeLocalDevelopmentAuthorizationResponse{Authorization: localDevelopmentAuthorizationToProto(authorization), ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func (s *Service) PrepareLocalAppLaunch(ctx context.Context, req *runtimev1.PrepareLocalAppLaunchRequest) (*runtimev1.PrepareLocalAppLaunchResponse, error) {
	if err := requireProtectedLocalDevelopmentDesktop(ctx); err != nil {
		return nil, err
	}
	if s == nil || s.localDevelopment == nil || req == nil {
		return nil, localDevelopmentFailure(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
	}
	authorizationID, authorizationOK := localDevelopmentIdentifierFromBytes(req.GetLocalAppHandle())
	runID, runOK := localDevelopmentIdentifierFromBytes(req.GetSupervisorRunId())
	if !authorizationOK || !runOK {
		return nil, localDevelopmentFailure(codes.InvalidArgument, runtimev1.ReasonCode_LOCAL_APP_LAUNCH_LEASE_REQUIRED)
	}
	authorization, err := s.localDevelopment.GetAuthorization(ctx, authorizationID)
	if err != nil {
		return nil, localDevelopmentFailureFromCause(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE, err)
	}
	if authorization.State != localDevelopmentAuthorizationActive {
		// An unknown handle can belong only to an immutable profile in 0K. That
		// profile has no positive launch implementation until 0P maps admitted
		// package evidence into this opaque seam.
		return nil, localDevelopmentFailure(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
	}
	account, generation, authenticated := s.authenticatedRuntimeAccount(ctx)
	if !authenticated || account.GetAccountId() != authorization.Project.AccountID {
		return nil, localDevelopmentFailure(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_ACCOUNT_CHANGED)
	}
	project, err := resolveLocalDevelopmentProject(authorization.Project.ProjectRoot, authorization.Project.AppID, authorization.Project.ShellKind, account.GetAccountId(), generation)
	if err != nil {
		if s.logger != nil {
			s.logger.Warn("local development launch rejected", "stage", "project-authority", "app_id", authorization.Project.AppID, "error", err)
		}
		return nil, localDevelopmentProjectAuthorityError(err)
	}
	if !localDevelopmentProjectsMatch(authorization.Project, project) {
		if s.logger != nil {
			s.logger.Warn("local development launch rejected", "stage", "project-authority", "app_id", authorization.Project.AppID, "error", err)
		}
		return nil, localDevelopmentFailureAtStage(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_PROVENANCE_UNAVAILABLE, "project-authority")
	}
	hostExecutable, err := localDevelopmentHostExecutable(project)
	if err != nil {
		if s.logger != nil {
			s.logger.Warn("local development launch rejected", "stage", "host-executable", "app_id", authorization.Project.AppID, "error", err)
		}
		return nil, localDevelopmentFailureAtStageFromCause(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_PROVENANCE_UNAVAILABLE, "host-executable", err)
	}
	principal, record, err := s.prepareLocalDevelopmentRecord(ctx, authorization)
	if err != nil {
		return nil, localDevelopmentFailureAtStageFromCause(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_PROVENANCE_UNAVAILABLE, "local-app-record", err)
	}
	desktopConnection, ok := protectedlocal.DesktopConnectionFromContext(ctx)
	if !ok || desktopConnection == nil {
		return nil, localDevelopmentFailure(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_LAUNCH_LEASE_REQUIRED)
	}
	var launchID protectedlocal.Identifier
	var bindDeadline time.Time
	var revokeLaunch func()
	if s.directLocalAppLaunches != nil {
		desktopPeer, direct := desktopConnection.DirectDesktopPeer()
		if !direct || desktopPeer.OS != protectedlocal.OSMacOS {
			return nil, localDevelopmentFailure(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_LAUNCH_LEASE_REQUIRED)
		}
		if authorization.Decision == runtimev1.LocalDevelopmentDecision_LOCAL_DEVELOPMENT_DECISION_ALLOW_RUN_ONCE && authorization.RunID != runID {
			return nil, localDevelopmentFailure(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_LAUNCH_LEASE_REQUIRED)
		}
		prepared, prepareErr := s.directLocalAppLaunches.Prepare(
			authorizationID,
			runID,
			generation,
			authorization.Generation,
			desktopPeer.PID,
			desktopPeer.UID,
			s.now().UTC().Add(localDevelopmentLaunchTTL),
		)
		if prepareErr != nil {
			return nil, localDevelopmentFailureAtStageFromCause(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE, "launch-memory", prepareErr)
		}
		launchID = prepared.LaunchID
		bindDeadline = prepared.ExpiresAt
		revokeLaunch = func() { s.directLocalAppLaunches.Revoke(launchID) }
	} else {
		expectedHostDigest, digestErr := localDevelopmentDigestIdentifier("host", record.HostExecutableDigest)
		if digestErr != nil {
			return nil, localDevelopmentFailureAtStageFromCause(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_PROVENANCE_UNAVAILABLE, "local-app-record", digestErr)
		}
		ticket, prepareErr := s.localDevelopment.PrepareLaunch(ctx, localDevelopmentLaunchRequest{
			AuthorizationID:    authorizationID,
			SupervisorRunID:    runID,
			Project:            project,
			ShellKind:          project.ShellKind,
			HostExecutable:     hostExecutable,
			PrincipalID:        principal.LocalAppPrincipalID,
			RecordID:           record.LocalAppRecordID,
			ProvenanceRevision: record.ProvenanceRevision,
			ProjectGeneration:  record.InstallOrProjectGeneration,
			PayloadDigest:      record.PayloadRootDigest,
			ExpectedHostDigest: expectedHostDigest,
		})
		if prepareErr != nil {
			if s.logger != nil {
				s.logger.Warn("local development launch rejected", "stage", "launch-store", "app_id", authorization.Project.AppID, "error", prepareErr)
			}
			if errors.Is(prepareErr, errLocalDevelopmentProjectChanged) {
				return nil, localDevelopmentFailureAtStageFromCause(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_PROVENANCE_UNAVAILABLE, "launch-store", prepareErr)
			}
			return nil, localDevelopmentStoreError(prepareErr)
		}
		launchID = ticket.LaunchID
		bindDeadline = ticket.BindDeadline
		revokeLaunch = func() { _ = s.localDevelopment.RevokeLaunch(context.Background(), launchID) }
	}
	if err := desktopConnection.BindRevocationHook(runID, func() {
		revokeLaunch()
		if s.directLocalAppLaunches != nil {
			s.directLocalAppLaunches.RevokeRun(authorizationID, runID)
		}
		if endErr := s.localDevelopment.EndRun(context.Background(), authorizationID, runID); endErr == nil {
			if authorization.Decision == runtimev1.LocalDevelopmentDecision_LOCAL_DEVELOPMENT_DECISION_ALLOW_RUN_ONCE {
				_ = s.transitionLocalDevelopmentRecord(context.Background(), authorization, localappkernel.LifecycleStateRemoved, true)
			}
		}
	}); err != nil {
		revokeLaunch()
		_ = s.localDevelopment.EndRun(context.Background(), authorizationID, runID)
		return nil, localDevelopmentFailureFromCause(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_LAUNCH_LEASE_REQUIRED, err)
	}
	return &runtimev1.PrepareLocalAppLaunchResponse{LaunchId: append([]byte(nil), launchID[:]...), BindDeadline: timestamppb.New(bindDeadline), ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func (s *Service) BindLocalAppProcess(ctx context.Context, req *runtimev1.BindLocalAppProcessRequest) (*runtimev1.BindLocalAppProcessResponse, error) {
	if err := requireProtectedLocalDevelopmentDesktop(ctx); err != nil {
		return nil, err
	}
	if s == nil || s.localDevelopment == nil || req == nil ||
		(s.directLocalAppLaunches == nil && (s.localDevelopmentRegistry == nil || s.localDevelopmentVerifier == nil)) {
		return nil, localDevelopmentFailure(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
	}
	launchID, ok := localDevelopmentIdentifierFromBytes(req.GetLaunchId())
	if !ok || req.GetChildProcessId() == 0 {
		return nil, localDevelopmentFailure(codes.InvalidArgument, runtimev1.ReasonCode_LOCAL_APP_LAUNCH_LEASE_REQUIRED)
	}
	desktopConnection, desktopOK := protectedlocal.DesktopConnectionFromContext(ctx)
	if !desktopOK || desktopConnection == nil {
		return nil, localDevelopmentFailureAtStage(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_PROCESS_MISMATCH, "bind-supervisor")
	}
	if s.directLocalAppLaunches != nil {
		desktopPeer, direct := desktopConnection.DirectDesktopPeer()
		if !direct || desktopPeer.OS != protectedlocal.OSMacOS {
			return nil, localDevelopmentFailureAtStage(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_PROCESS_MISMATCH, "bind-supervisor")
		}
		deadline, bindErr := s.directLocalAppLaunches.Bind(
			launchID,
			req.GetChildProcessId(),
			desktopPeer.PID,
			desktopPeer.UID,
			s.now().UTC().Add(localDevelopmentProcessBindTTL),
		)
		if bindErr != nil {
			return nil, localDevelopmentFailureAtStageFromCause(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_PROCESS_MISMATCH, "bind-direct-peer", bindErr)
		}
		return &runtimev1.BindLocalAppProcessResponse{LaunchId: append([]byte(nil), launchID[:]...), BindDeadline: timestamppb.New(deadline), ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
	}
	policy, err := s.localDevelopment.PendingLaunchPolicy(ctx, launchID)
	if err != nil {
		return nil, localDevelopmentStoreError(err)
	}
	if desktopProcess, ok := desktopConnection.ClientProcess(); ok {
		policy.SupervisorProcess = desktopProcess
	} else if desktopPeer, ok := desktopConnection.DirectDesktopPeer(); ok {
		policy.SupervisorPID = desktopPeer.PID
	} else {
		return nil, localDevelopmentFailureAtStage(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_PROCESS_MISMATCH, "bind-supervisor")
	}
	deadline, err := protectedlocal.BindLocalDevelopmentProcess(
		s.localDevelopmentRegistry,
		ctx,
		launchID,
		req.GetChildProcessId(),
		s.localDevelopmentVerifier,
		policy,
		func(process protectedlocal.ProcessTuple) (time.Time, error) {
			return s.localDevelopment.BindLaunch(ctx, launchID, process)
		},
		func() { _ = s.localDevelopment.RevokeLaunch(context.Background(), launchID) },
	)
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

func (s *Service) OpenLocalAppSessionProjection(ctx context.Context) (authservice.LocalAppSessionProjection, error) {
	if s != nil && s.directLocalAppLaunches != nil {
		connection, _, _, _, generation, err := s.currentDirectLocalDevelopmentAuthority(ctx, false)
		if err != nil {
			return authservice.LocalAppSessionProjection{}, localDevelopmentSessionOpenError(err)
		}
		if err := connection.BindDirectAuthorization(); err != nil {
			return authservice.LocalAppSessionProjection{}, localDevelopmentFailureFromCause(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED, err)
		}
		return authservice.LocalAppSessionProjection{
			TrustClass:        runtimev1.LocalAppTrustClass_LOCAL_APP_TRUST_CLASS_LOCAL_DEVELOPMENT,
			AccountGeneration: generation,
		}, nil
	}
	connection, accountID, generation, err := s.localDevelopmentSessionOpenContext(ctx)
	if err != nil {
		return authservice.LocalAppSessionProjection{}, err
	}
	if _, alreadyOpen := connection.Session(); alreadyOpen {
		return authservice.LocalAppSessionProjection{}, localDevelopmentFailure(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED)
	}
	session, err := s.localDevelopment.ConsumeLaunch(ctx, connection.LaunchID(), connection.Process())
	if err != nil {
		return authservice.LocalAppSessionProjection{}, localDevelopmentSessionOpenError(err)
	}
	return s.finalizeLocalDevelopmentSession(ctx, connection, accountID, generation, session, nil)
}

func (s *Service) RenewLocalAppSessionProjection(ctx context.Context) (authservice.LocalAppSessionProjection, error) {
	if s != nil && s.directLocalAppLaunches != nil {
		_, _, _, _, generation, err := s.currentDirectLocalDevelopmentAuthority(ctx, true)
		if err != nil {
			return authservice.LocalAppSessionProjection{}, localDevelopmentSessionOpenError(err)
		}
		return authservice.LocalAppSessionProjection{
			TrustClass:        runtimev1.LocalAppTrustClass_LOCAL_APP_TRUST_CLASS_LOCAL_DEVELOPMENT,
			AccountGeneration: generation,
		}, nil
	}
	connection, accountID, generation, err := s.localDevelopmentSessionOpenContext(ctx)
	if err != nil {
		return authservice.LocalAppSessionProjection{}, err
	}
	previous, ok := connection.Session()
	if !ok {
		return authservice.LocalAppSessionProjection{}, localDevelopmentFailure(codes.Unauthenticated, runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED)
	}
	session, err := s.localDevelopment.RenewSession(ctx, localDevelopmentSessionBinding{
		SessionID: previous.SessionID, SessionProof: previous.SessionProof, Process: connection.Process(),
		AccountGeneration: generation, RuntimeBootEpoch: connection.RuntimeBootEpoch(),
	})
	if err != nil {
		return authservice.LocalAppSessionProjection{}, localDevelopmentSessionOpenError(err)
	}
	return s.finalizeLocalDevelopmentSession(ctx, connection, accountID, generation, session, &previous)
}

func (s *Service) localDevelopmentSessionOpenContext(ctx context.Context) (*protectedlocal.LocalAppConnection, string, uint64, error) {
	if s == nil || s.localDevelopment == nil {
		return nil, "", 0, localDevelopmentFailure(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
	}
	connection, ok := protectedlocal.LocalAppConnectionFromContext(ctx)
	if !ok || connection == nil || !protectedlocal.IsLocalDevelopmentProcessTrustSet(connection.Process()) {
		return nil, "", 0, localDevelopmentFailure(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_PROCESS_MISMATCH)
	}
	account, generation, authenticated := s.authenticatedRuntimeAccount(ctx)
	if !authenticated {
		return nil, "", 0, localDevelopmentFailure(codes.Unauthenticated, runtimev1.ReasonCode_LOCAL_APP_ACCOUNT_CHANGED)
	}
	return connection, account.GetAccountId(), generation, nil
}

func (s *Service) finalizeLocalDevelopmentSession(
	ctx context.Context,
	connection *protectedlocal.LocalAppConnection,
	accountID string,
	generation uint64,
	session localDevelopmentSessionProjection,
	previous *protectedlocal.LocalAppSessionHandle,
) (authservice.LocalAppSessionProjection, error) {
	if session.AccountID != accountID || session.AccountGeneration != generation {
		_ = s.localDevelopment.RevokeSession(ctx, session.SessionID)
		return authservice.LocalAppSessionProjection{}, localDevelopmentSessionOpenError(errLocalDevelopmentAccountChanged)
	}
	if _, _, err := s.resolveLocalDevelopmentRecord(ctx, session); err != nil {
		_ = s.localDevelopment.RevokeSession(ctx, session.SessionID)
		return authservice.LocalAppSessionProjection{}, localDevelopmentFailureFromCause(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED, err)
	}
	nextHandle := protectedlocal.LocalAppSessionHandle{SessionID: session.SessionID, SessionProof: session.SessionProof}
	var err error
	if previous == nil {
		err = connection.BindSession(nextHandle)
	} else {
		err = connection.RotateSession(*previous, nextHandle)
	}
	if err != nil {
		_ = s.localDevelopment.RevokeSession(ctx, session.SessionID)
		return authservice.LocalAppSessionProjection{}, localDevelopmentFailureFromCause(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED, err)
	}
	connection.ReplaceSessionRevokeHook(func() { _ = s.localDevelopment.RevokeSession(context.Background(), session.SessionID) })
	return authservice.LocalAppSessionProjection{
		TrustClass:        runtimev1.LocalAppTrustClass_LOCAL_APP_TRUST_CLASS_LOCAL_DEVELOPMENT,
		AccountGeneration: session.AccountGeneration,
		RuntimeBootEpoch:  session.RuntimeBootEpoch,
	}, nil
}

// ResolveLocalAppSession projects a verified local-development technical
// session into the Account-owned per-operation evaluator.
func (s *Service) ResolveLocalAppSession(ctx context.Context, accountGeneration uint64) (accountservice.LocalAppCallerBinding, error) {
	if s == nil || s.localDevelopment == nil || accountGeneration == 0 {
		return accountservice.LocalAppCallerBinding{}, errLocalDevelopmentSessionRevoked
	}
	if s.directLocalAppLaunches != nil {
		connection, authorization, principal, record, generation, err := s.currentDirectLocalDevelopmentAuthority(ctx, true)
		if errors.Is(err, errLocalDevelopmentAccountChanged) {
			return accountservice.LocalAppCallerBinding{}, accountservice.ErrLocalAppAccountChanged
		}
		if errors.Is(err, errLocalDevelopmentProcessMismatch) {
			return accountservice.LocalAppCallerBinding{}, accountservice.ErrLocalAppProcessMismatch
		}
		if err != nil || generation != accountGeneration {
			return accountservice.LocalAppCallerBinding{}, errLocalDevelopmentSessionRevoked
		}
		peer, peerOK := connection.DirectPeer()
		if !peerOK {
			return accountservice.LocalAppCallerBinding{}, accountservice.ErrLocalAppProcessMismatch
		}
		hostDigest, digestErr := localDevelopmentDigestIdentifier("host", record.HostExecutableDigest)
		if digestErr != nil {
			return accountservice.LocalAppCallerBinding{}, errLocalDevelopmentSessionRevoked
		}
		return accountservice.LocalAppCallerBinding{
			LocalOSUserAnchor:       principal.LocalOSUserAnchor,
			SessionID:               connection.LaunchID(),
			DirectPeer:              peer,
			AppID:                   authorization.Project.AppID,
			HostExecutableDigest:    hostDigest,
			AccountGeneration:       generation,
			TrustClass:              accountservice.LocalAppTrustClassDevelopment,
			AuthorizationID:         authorization.ID,
			AuthorizationGeneration: authorization.Generation,
			ProjectRoot:             authorization.Project.ProjectRoot,
			CapabilityFingerprint:   authorization.Project.PermissionRequirementFingerprint,
			Capabilities:            localDevelopmentPermissionIDs(authorization.Project.PermissionRequirements),
			LocalAppPrincipalID:     principal.LocalAppPrincipalID,
			LocalAppRecordID:        record.LocalAppRecordID,
			ProvenanceRevision:      record.ProvenanceRevision,
			ProjectGeneration:       record.InstallOrProjectGeneration,
			PayloadDigest:           record.PayloadRootDigest,
		}, nil
	}
	connection, ok := protectedlocal.LocalAppConnectionFromContext(ctx)
	if !ok || !protectedlocal.IsLocalDevelopmentProcessTrustSet(connection.Process()) {
		return accountservice.LocalAppCallerBinding{}, accountservice.ErrLocalAppProcessMismatch
	}
	handle, ok := connection.Session()
	if !ok {
		return accountservice.LocalAppCallerBinding{}, errLocalDevelopmentSessionRevoked
	}
	session, err := s.localDevelopment.ValidateSession(ctx, localDevelopmentSessionBinding{
		SessionID: handle.SessionID, SessionProof: handle.SessionProof, Process: connection.Process(),
		AccountGeneration: accountGeneration, RuntimeBootEpoch: connection.RuntimeBootEpoch(),
	})
	if errors.Is(err, errLocalDevelopmentAccountChanged) {
		return accountservice.LocalAppCallerBinding{}, accountservice.ErrLocalAppAccountChanged
	}
	if errors.Is(err, errLocalDevelopmentProcessMismatch) || !connection.Live() {
		return accountservice.LocalAppCallerBinding{}, accountservice.ErrLocalAppProcessMismatch
	}
	if err != nil {
		return accountservice.LocalAppCallerBinding{}, errLocalDevelopmentSessionRevoked
	}
	principal, record, err := s.resolveLocalDevelopmentRecord(ctx, session)
	if err != nil {
		return accountservice.LocalAppCallerBinding{}, errLocalDevelopmentSessionRevoked
	}
	return accountservice.LocalAppCallerBinding{
		LocalOSUserAnchor:       principal.LocalOSUserAnchor,
		SessionID:               session.SessionID,
		AppID:                   session.AppID,
		HostExecutableDigest:    session.HostExecutableDigest,
		AccountGeneration:       session.AccountGeneration,
		RuntimeBootEpoch:        session.RuntimeBootEpoch,
		Process:                 session.Process,
		ExpiresAt:               session.ExpiresAt,
		TrustClass:              accountservice.LocalAppTrustClassDevelopment,
		AuthorizationID:         session.AuthorizationID,
		AuthorizationGeneration: session.AuthorizationGeneration,
		ProjectRoot:             session.ProjectRoot,
		CapabilityFingerprint:   session.PermissionRequirementFingerprint,
		Capabilities:            localDevelopmentPermissionIDs(session.PermissionRequirements),
		LocalAppPrincipalID:     principal.LocalAppPrincipalID,
		LocalAppRecordID:        record.LocalAppRecordID,
		ProvenanceRevision:      record.ProvenanceRevision,
		ProjectGeneration:       record.InstallOrProjectGeneration,
		PayloadDigest:           record.PayloadRootDigest,
	}, nil
}

func (s *Service) currentDirectLocalDevelopmentAuthority(
	ctx context.Context,
	requireAuthorized bool,
) (*protectedlocal.LocalAppConnection, localDevelopmentAuthorization, localappkernel.Principal, localappkernel.Record, uint64, error) {
	if s == nil || s.localDevelopment == nil || s.directLocalAppLaunches == nil || s.localAppKernel == nil {
		return nil, localDevelopmentAuthorization{}, localappkernel.Principal{}, localappkernel.Record{}, 0, errLocalDevelopmentSessionRevoked
	}
	connection, ok := protectedlocal.LocalAppConnectionFromContext(ctx)
	if !ok || connection == nil || !connection.Live() {
		return nil, localDevelopmentAuthorization{}, localappkernel.Principal{}, localappkernel.Record{}, 0, errLocalDevelopmentProcessMismatch
	}
	if requireAuthorized != connection.DirectAuthorizationBound() {
		return nil, localDevelopmentAuthorization{}, localappkernel.Principal{}, localappkernel.Record{}, 0, errLocalDevelopmentSessionRevoked
	}
	peer, peerOK := connection.DirectPeer()
	launch, launchOK := connection.DirectLaunch()
	if !peerOK || !launchOK || peer.OS != protectedlocal.OSMacOS || peer.UID != launch.ExpectedUID {
		return nil, localDevelopmentAuthorization{}, localappkernel.Principal{}, localappkernel.Record{}, 0, errLocalDevelopmentProcessMismatch
	}
	account, generation, authenticated := s.authenticatedRuntimeAccount(ctx)
	if !authenticated || generation == 0 || generation != launch.AccountGeneration {
		return nil, localDevelopmentAuthorization{}, localappkernel.Principal{}, localappkernel.Record{}, 0, errLocalDevelopmentAccountChanged
	}
	authorization, err := s.localDevelopment.GetAuthorization(ctx, launch.AuthorizationID)
	if err != nil || authorization.State != localDevelopmentAuthorizationActive ||
		authorization.Generation != launch.AuthorizationGeneration ||
		authorization.Project.AccountID != account.GetAccountId() {
		return nil, localDevelopmentAuthorization{}, localappkernel.Principal{}, localappkernel.Record{}, 0, errLocalDevelopmentSessionRevoked
	}
	if authorization.Decision == runtimev1.LocalDevelopmentDecision_LOCAL_DEVELOPMENT_DECISION_ALLOW_RUN_ONCE &&
		authorization.RunID != launch.SupervisorRunID {
		return nil, localDevelopmentAuthorization{}, localappkernel.Principal{}, localappkernel.Record{}, 0, errLocalDevelopmentSessionRevoked
	}
	currentProject, err := resolveLocalDevelopmentProject(
		authorization.Project.ProjectRoot,
		authorization.Project.AppID,
		authorization.Project.ShellKind,
		account.GetAccountId(),
		generation,
	)
	if err != nil || !localDevelopmentProjectsMatch(authorization.Project, currentProject) {
		return nil, localDevelopmentAuthorization{}, localappkernel.Principal{}, localappkernel.Record{}, 0, errLocalDevelopmentSessionRevoked
	}
	principal, err := s.localAppKernel.Principals().GetByDevelopmentAuthorizationID(ctx, localDevelopmentAuthorizationRef(authorization.ID))
	if err != nil || principal.State != localappkernel.PrincipalStateActive ||
		principal.Kind != localappkernel.PrincipalKindDevelopment ||
		principal.AppID != authorization.Project.AppID {
		return nil, localDevelopmentAuthorization{}, localappkernel.Principal{}, localappkernel.Record{}, 0, errLocalDevelopmentSessionRevoked
	}
	record, err := s.localAppKernel.Records().GetByPrincipalID(ctx, principal.LocalAppPrincipalID)
	if err != nil || record.LocalAppPrincipalID != principal.LocalAppPrincipalID ||
		record.TrustClass != localappkernel.TrustClassLocalDevelopment ||
		record.LifecycleState != localappkernel.LifecycleStateActive ||
		record.ActiveCapabilityFingerprint != localDevelopmentCapabilityRef(authorization.Project.PermissionRequirementFingerprint) ||
		record.ExecutionProfileRef != localDevelopmentExecutionProfileRef(authorization.Project.ShellKind) ||
		record.HostExecutableDigest == "" || record.PayloadRootDigest == "" {
		return nil, localDevelopmentAuthorization{}, localappkernel.Principal{}, localappkernel.Record{}, 0, errLocalDevelopmentSessionRevoked
	}
	return connection, authorization, principal, record, generation, nil
}

func (s *Service) EndLocalDevelopmentRun(ctx context.Context, req *runtimev1.EndLocalDevelopmentRunRequest) (*runtimev1.EndLocalDevelopmentRunResponse, error) {
	if err := requireProtectedLocalDevelopmentDesktop(ctx); err != nil {
		return nil, err
	}
	if s == nil || s.localDevelopment == nil || req == nil {
		return nil, localDevelopmentFailure(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
	}
	authorizationID, authorizationOK := localDevelopmentIdentifierFromBytes(req.GetAuthorizationId())
	runID, runOK := localDevelopmentIdentifierFromBytes(req.GetSupervisorRunId())
	if !authorizationOK || !runOK {
		return nil, localDevelopmentFailure(codes.InvalidArgument, runtimev1.ReasonCode_LOCAL_APP_LAUNCH_LEASE_REQUIRED)
	}
	authorization, err := s.localDevelopment.GetAuthorization(ctx, authorizationID)
	if err != nil {
		return nil, localDevelopmentStoreError(err)
	}
	if err := s.localDevelopment.EndRun(ctx, authorizationID, runID); err != nil {
		return nil, localDevelopmentStoreError(err)
	}
	if s.directLocalAppLaunches != nil {
		s.directLocalAppLaunches.RevokeRun(authorizationID, runID)
	}
	if authorization.Decision == runtimev1.LocalDevelopmentDecision_LOCAL_DEVELOPMENT_DECISION_ALLOW_RUN_ONCE {
		if err := s.transitionLocalDevelopmentRecord(ctx, authorization, localappkernel.LifecycleStateRemoved, true); err != nil {
			return nil, localDevelopmentStoreError(err)
		}
	}
	if connection, ok := protectedlocal.DesktopConnectionFromContext(ctx); ok {
		connection.UnbindRevocationHook(runID)
	}
	return &runtimev1.EndLocalDevelopmentRunResponse{ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
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

func localDevelopmentProjectToProto(project localDevelopmentProjectSnapshot) *runtimev1.LocalDevelopmentProjectProjection {
	return &runtimev1.LocalDevelopmentProjectProjection{
		AppId:                            project.AppID,
		DisplayName:                      project.DisplayName,
		CanonicalProjectRoot:             project.ProjectRoot,
		CanonicalManifestPath:            project.ManifestPath,
		ShellKind:                        project.ShellKind,
		AccountId:                        project.AccountID,
		PermissionRequirements:           localDevelopmentPermissionRequirementsToProto(project.PermissionRequirements),
		PermissionRequirementFingerprint: append([]byte(nil), project.PermissionRequirementFingerprint[:]...),
		TrustClass:                       localDevelopmentTrustClass,
	}
}

func localDevelopmentPermissionRequirementsToProto(requirements []localDevelopmentPermissionRequirement) []*runtimev1.LocalDevelopmentPermissionRequirement {
	projected := make([]*runtimev1.LocalDevelopmentPermissionRequirement, 0, len(requirements))
	for _, requirement := range requirements {
		projected = append(projected, &runtimev1.LocalDevelopmentPermissionRequirement{
			PermissionId: requirement.PermissionID,
			Reason:       requirement.Reason,
		})
	}
	return projected
}

func localDevelopmentPermissionIDs(requirements []localDevelopmentPermissionRequirement) []string {
	permissionIDs := make([]string, 0, len(requirements))
	for _, requirement := range requirements {
		permissionIDs = append(permissionIDs, requirement.PermissionID)
	}
	return permissionIDs
}

func localDevelopmentAuthorizationToProto(authorization localDevelopmentAuthorization) *runtimev1.LocalDevelopmentAuthorizationProjection {
	state := runtimev1.LocalDevelopmentAuthorizationState_LOCAL_DEVELOPMENT_AUTHORIZATION_STATE_UNSPECIFIED
	switch authorization.State {
	case localDevelopmentAuthorizationActive:
		state = runtimev1.LocalDevelopmentAuthorizationState_LOCAL_DEVELOPMENT_AUTHORIZATION_STATE_ACTIVE
	case localDevelopmentAuthorizationDenied:
		state = runtimev1.LocalDevelopmentAuthorizationState_LOCAL_DEVELOPMENT_AUTHORIZATION_STATE_DENIED
	case localDevelopmentAuthorizationRevoked:
		state = runtimev1.LocalDevelopmentAuthorizationState_LOCAL_DEVELOPMENT_AUTHORIZATION_STATE_REVOKED
	}
	return &runtimev1.LocalDevelopmentAuthorizationProjection{
		AuthorizationId:         append([]byte(nil), authorization.ID[:]...),
		Project:                 localDevelopmentProjectToProto(authorization.Project),
		State:                   state,
		Persistence:             authorization.Decision,
		AuthorizationGeneration: authorization.Generation,
		ApprovedAt:              timestamppb.New(authorization.ApprovedAt),
		UpdatedAt:               timestamppb.New(authorization.UpdatedAt),
		ReasonCode:              runtimev1.ReasonCode_ACTION_EXECUTED,
	}
}

func sameLocalDevelopmentFile(left string, right string) bool {
	if sameLocalDevelopmentPath(left, right) {
		return true
	}
	leftInfo, leftErr := os.Stat(left)
	rightInfo, rightErr := os.Stat(right)
	return leftErr == nil && rightErr == nil && leftInfo.Mode().IsRegular() && rightInfo.Mode().IsRegular() && os.SameFile(leftInfo, rightInfo)
}

func sameLocalDevelopmentPath(left string, right string) bool {
	left = filepath.Clean(left)
	right = filepath.Clean(right)
	if filepath.Separator == '\\' {
		return strings.EqualFold(left, right)
	}
	return left == right
}

func localDevelopmentProjectAuthorityError(err error) error {
	if _, ok := localDevelopmentManifestPermissionFailureFromError(err); ok {
		return localDevelopmentManifestPermissionStatusError(err)
	}
	return localDevelopmentFailureAtStageFromCause(
		codes.FailedPrecondition,
		runtimev1.ReasonCode_LOCAL_APP_PROVENANCE_UNAVAILABLE,
		"project-authority",
		err,
	)
}

func localDevelopmentManifestPermissionStatusError(err error) error {
	failure, ok := localDevelopmentManifestPermissionFailureFromError(err)
	if !ok {
		return localDevelopmentFailureAtStageFromCause(
			codes.FailedPrecondition,
			runtimev1.ReasonCode_LOCAL_APP_PROVENANCE_UNAVAILABLE,
			"project-authority",
			err,
		)
	}

	message := "local development manifest permission is not admitted"
	actionHint := "use_an_admitted_permission_id"
	admission := "unknown"
	switch failure.Reason() {
	case localDevelopmentManifestPermissionReserved:
		message = "local development manifest permission is reserved pending admission"
		actionHint = "wait_for_permission_admission"
		admission = "reserved"
	case localDevelopmentManifestPermissionUnknown:
		message = "local development manifest permission id is unknown to the public catalog"
		actionHint = "use_known_permission_id"
	}

	metadata := map[string]string{
		"diagnostic_stage":              "manifest-permission",
		"local_development_reason_code": string(failure.Reason()),
		"permission_admission":          admission,
	}
	if permissionID := localDevelopmentPublicPermissionID(failure.PermissionID()); permissionID != "" {
		metadata["permission_id"] = permissionID
		if failure.Reason() == localDevelopmentManifestPermissionReserved {
			message = "local development manifest permission \"" + permissionID + "\" is reserved pending admission"
		} else {
			message = "local development manifest permission id \"" + permissionID + "\" is unknown to the public catalog"
		}
	}
	return grpcerr.WrapWithReasonCode(
		codes.FailedPrecondition,
		runtimev1.ReasonCode_LOCAL_APP_PERMISSION_DENIED,
		err,
		grpcerr.ReasonOptions{
			ActionHint: actionHint,
			Message:    message,
			Metadata:   metadata,
		},
	)
}

func localDevelopmentPublicPermissionID(value string) string {
	if value == "" || len([]byte(value)) > 240 {
		return ""
	}
	for _, character := range value {
		if character >= 'a' && character <= 'z' || character >= 'A' && character <= 'Z' ||
			character >= '0' && character <= '9' || character == '.' || character == '-' || character == '_' {
			continue
		}
		return ""
	}
	return value
}

func localDevelopmentStoreError(err error) error {
	if _, ok := localDevelopmentManifestPermissionFailureFromError(err); ok {
		return localDevelopmentManifestPermissionStatusError(err)
	}
	switch {
	case errors.Is(err, errLocalDevelopmentProjectChanged), errors.Is(err, errLocalDevelopmentProjectUnstable):
		return localDevelopmentFailureFromCause(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_PROVENANCE_UNAVAILABLE, err)
	case errors.Is(err, errLocalDevelopmentReapproval):
		return localDevelopmentFailureFromCause(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_ACCOUNT_CHANGED, err)
	case errors.Is(err, errLocalDevelopmentAuthorization), errors.Is(err, errLocalDevelopmentEvaluationExpired):
		return localDevelopmentFailureFromCause(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_RECORD_NOT_FOUND, err)
	case errors.Is(err, errLocalDevelopmentLaunchExpired), errors.Is(err, errLocalDevelopmentSessionRevoked):
		return localDevelopmentFailureFromCause(codes.Unauthenticated, runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED, err)
	case errors.Is(err, errLocalDevelopmentLaunchMismatch):
		return localDevelopmentFailureFromCause(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_PROCESS_MISMATCH, err)
	default:
		return localDevelopmentFailureFromCause(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_RECORD_NOT_FOUND, err)
	}
}

func localDevelopmentSessionOpenError(err error) error {
	switch {
	case errors.Is(err, errLocalDevelopmentAccountChanged):
		return localDevelopmentFailureFromCause(codes.Unauthenticated, runtimev1.ReasonCode_LOCAL_APP_ACCOUNT_CHANGED, err)
	case errors.Is(err, errLocalDevelopmentLaunchMismatch), errors.Is(err, errLocalDevelopmentProcessMismatch):
		return localDevelopmentFailureFromCause(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_PROCESS_MISMATCH, err)
	case errors.Is(err, errLocalDevelopmentLaunchExpired), errors.Is(err, errLocalDevelopmentSessionRevoked), errors.Is(err, errLocalDevelopmentAuthorization):
		return localDevelopmentFailureFromCause(codes.Unauthenticated, runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED, err)
	default:
		return localDevelopmentFailureFromCause(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE, err)
	}
}

func localDevelopmentFailure(code codes.Code, reason runtimev1.ReasonCode) error {
	return grpcerr.WithReasonCode(code, reason)
}

func localDevelopmentFailureFromCause(code codes.Code, reason runtimev1.ReasonCode, cause error) error {
	return grpcerr.WrapWithReasonCode(
		code,
		reason,
		cause,
		grpcerr.ReasonOptions{Message: "local development operation failed"},
	)
}

func localDevelopmentFailureAtStage(code codes.Code, reason runtimev1.ReasonCode, stage string) error {
	return grpcerr.WithReasonCodeOptions(code, reason, grpcerr.ReasonOptions{Metadata: map[string]string{"diagnostic_stage": stage}})
}

func localDevelopmentFailureAtStageFromCause(code codes.Code, reason runtimev1.ReasonCode, stage string, cause error) error {
	return grpcerr.WrapWithReasonCode(
		code,
		reason,
		cause,
		grpcerr.ReasonOptions{
			Message:  "local development operation failed",
			Metadata: map[string]string{"diagnostic_stage": stage},
		},
	)
}
