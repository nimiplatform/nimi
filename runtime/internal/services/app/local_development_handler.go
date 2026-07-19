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

type runtimePresenceAuthority interface {
	VerifyRuntimePresence(context.Context, string) (string, time.Time, error)
}

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
	account, generation, authenticated := s.authenticatedLifecycleAccount(ctx)
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
	account, generation, authenticated := s.authenticatedLifecycleAccount(ctx)
	if !authenticated {
		return nil, localDevelopmentFailure(codes.Unauthenticated, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}
	if err := s.localDevelopment.RequireDeveloperMode(ctx, account.GetAccountId(), generation); err != nil {
		return nil, localDevelopmentFailure(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_DEVELOPER_MODE_DISABLED)
	}
	project, err := resolveLocalDevelopmentProject(req.GetProjectRoot(), req.GetExpectedAppId(), req.GetShellKind(), account.GetAccountId(), generation)
	if err != nil {
		return nil, localDevelopmentFailureAtStage(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_PROVENANCE_UNAVAILABLE, "project-authority")
	}
	evaluation, err := s.localDevelopment.Evaluate(ctx, project, runID)
	if err != nil {
		return nil, localDevelopmentStoreError(err)
	}
	if evaluation.State == runtimev1.LocalDevelopmentAuthorizationState_LOCAL_DEVELOPMENT_AUTHORIZATION_STATE_ACTIVE {
		if _, _, kernelErr := s.prepareLocalDevelopmentRecord(ctx, evaluation.Authorization); kernelErr != nil {
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
	presenceEvidenceRef := ""
	if req.GetDecision() != runtimev1.LocalDevelopmentDecision_LOCAL_DEVELOPMENT_DECISION_DENY {
		if !req.GetRiskDisclosureAcknowledged() {
			return nil, localDevelopmentFailure(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_RISK_DISCLOSURE_REQUIRED)
		}
		account, generation, authenticated := s.authenticatedLifecycleAccount(ctx)
		if !authenticated {
			return nil, localDevelopmentFailure(codes.Unauthenticated, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
		}
		currentAccountID = account.GetAccountId()
		currentAccountGeneration = generation
		if err := s.localDevelopment.RequireDeveloperMode(ctx, currentAccountID, currentAccountGeneration); err != nil {
			return nil, localDevelopmentFailure(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_DEVELOPER_MODE_DISABLED)
		}
		presenceContext, presenceContextErr := withLocalDevelopmentPresenceBrowser(ctx)
		if presenceContextErr != nil {
			return nil, localDevelopmentFailure(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		var presenceErr error
		presenceEvidenceRef, _, presenceErr = s.verifyLocalDevelopmentPresence(presenceContext, "local-app.developer-project.approve")
		if presenceErr != nil {
			return nil, localDevelopmentFailure(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_PRESENCE_REQUIRED)
		}
	}
	authorization, err := s.localDevelopment.Decide(ctx, evaluationID, req.GetDecision(), currentAccountID, currentAccountGeneration)
	if err != nil {
		return nil, localDevelopmentStoreError(err)
	}
	if authorization.State == localDevelopmentAuthorizationActive {
		if err := s.createLocalDevelopmentPrincipalRecord(ctx, authorization, presenceEvidenceRef); err != nil {
			_, _ = s.localDevelopment.RevokeAuthorization(context.Background(), authorization.ID)
			return nil, localDevelopmentFailure(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_PROVENANCE_UNAVAILABLE)
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
	account, _, authenticated := s.authenticatedLifecycleAccount(ctx)
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
	account, _, authenticated := s.authenticatedLifecycleAccount(ctx)
	if !authenticated {
		return nil, localDevelopmentFailure(codes.Unauthenticated, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}
	current, err := s.localDevelopment.GetAuthorization(ctx, authorizationID)
	if err != nil || current.Project.AccountID != account.GetAccountId() {
		return nil, localDevelopmentFailure(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_RECORD_NOT_FOUND)
	}
	authorization, err := s.localDevelopment.RevokeAuthorization(ctx, authorizationID)
	if err != nil {
		return nil, localDevelopmentStoreError(err)
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
	if err != nil || authorization.State != localDevelopmentAuthorizationActive {
		// An unknown handle can belong only to an immutable profile in 0K. That
		// profile has no positive launch implementation until 0P maps admitted
		// package evidence into this opaque seam.
		return nil, localDevelopmentFailure(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
	}
	account, generation, authenticated := s.authenticatedLifecycleAccount(ctx)
	if !authenticated || account.GetAccountId() != authorization.Project.AccountID {
		return nil, localDevelopmentFailure(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_ACCOUNT_CHANGED)
	}
	project, err := resolveLocalDevelopmentProject(authorization.Project.ProjectRoot, authorization.Project.AppID, authorization.Project.ShellKind, account.GetAccountId(), generation)
	if err != nil || !localDevelopmentProjectsMatch(authorization.Project, project) {
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
		return nil, localDevelopmentFailureAtStage(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_PROVENANCE_UNAVAILABLE, "host-executable")
	}
	principal, record, err := s.prepareLocalDevelopmentRecord(ctx, authorization)
	if err != nil {
		return nil, localDevelopmentFailureAtStage(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_PROVENANCE_UNAVAILABLE, "local-app-record")
	}
	expectedHostDigest, err := localDevelopmentDigestIdentifier("host", record.HostExecutableDigest)
	if err != nil {
		return nil, localDevelopmentFailureAtStage(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_PROVENANCE_UNAVAILABLE, "local-app-record")
	}
	ticket, err := s.localDevelopment.PrepareLaunch(ctx, localDevelopmentLaunchRequest{
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
	if err != nil {
		if s.logger != nil {
			s.logger.Warn("local development launch rejected", "stage", "launch-store", "app_id", authorization.Project.AppID, "error", err)
		}
		if errors.Is(err, errLocalDevelopmentProjectChanged) {
			return nil, localDevelopmentFailureAtStage(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_PROVENANCE_UNAVAILABLE, "launch-store")
		}
		return nil, localDevelopmentStoreError(err)
	}
	desktopConnection, ok := protectedlocal.DesktopConnectionFromContext(ctx)
	if !ok || desktopConnection == nil {
		_ = s.localDevelopment.EndRun(context.Background(), authorizationID, runID)
		return nil, localDevelopmentFailure(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_LAUNCH_LEASE_REQUIRED)
	}
	if err := desktopConnection.BindRevocationHook(runID, func() {
		if endErr := s.localDevelopment.EndRun(context.Background(), authorizationID, runID); endErr == nil {
			if authorization.Decision == runtimev1.LocalDevelopmentDecision_LOCAL_DEVELOPMENT_DECISION_ALLOW_RUN_ONCE {
				_ = s.transitionLocalDevelopmentRecord(context.Background(), authorization, localappkernel.LifecycleStateRemoved, true)
			}
		}
	}); err != nil {
		_ = s.localDevelopment.EndRun(context.Background(), authorizationID, runID)
		return nil, localDevelopmentFailure(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_LAUNCH_LEASE_REQUIRED)
	}
	return &runtimev1.PrepareLocalAppLaunchResponse{LaunchId: append([]byte(nil), ticket.LaunchID[:]...), BindDeadline: timestamppb.New(ticket.BindDeadline), ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func (s *Service) BindLocalAppProcess(ctx context.Context, req *runtimev1.BindLocalAppProcessRequest) (*runtimev1.BindLocalAppProcessResponse, error) {
	if err := requireProtectedLocalDevelopmentDesktop(ctx); err != nil {
		return nil, err
	}
	if s == nil || s.localDevelopment == nil || s.localDevelopmentRegistry == nil || s.localDevelopmentVerifier == nil || req == nil {
		return nil, localDevelopmentFailure(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
	}
	launchID, ok := localDevelopmentIdentifierFromBytes(req.GetLaunchId())
	if !ok || req.GetChildProcessId() == 0 {
		return nil, localDevelopmentFailure(codes.InvalidArgument, runtimev1.ReasonCode_LOCAL_APP_LAUNCH_LEASE_REQUIRED)
	}
	policy, err := s.localDevelopment.PendingLaunchPolicy(ctx, launchID)
	if err != nil {
		return nil, localDevelopmentStoreError(err)
	}
	desktopConnection, desktopOK := protectedlocal.DesktopConnectionFromContext(ctx)
	desktopProcess, desktopProcessOK := desktopConnection.ClientProcess()
	if !desktopOK || !desktopProcessOK {
		return nil, localDevelopmentFailureAtStage(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_PROCESS_MISMATCH, "bind-supervisor")
	}
	policy.SupervisorProcess = desktopProcess
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
		return nil, localDevelopmentFailureAtStage(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_PROCESS_MISMATCH, localDevelopmentBindDiagnosticStage(err))
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
	if s == nil || s.localDevelopment == nil {
		return authservice.LocalAppSessionProjection{}, localDevelopmentFailure(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
	}
	connection, ok := protectedlocal.LocalAppConnectionFromContext(ctx)
	if !ok || connection == nil || !protectedlocal.IsLocalDevelopmentProcessTrustSet(connection.Process()) {
		return authservice.LocalAppSessionProjection{}, localDevelopmentFailure(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_PROCESS_MISMATCH)
	}
	account, generation, authenticated := s.authenticatedLifecycleAccount(ctx)
	if !authenticated {
		return authservice.LocalAppSessionProjection{}, localDevelopmentFailure(codes.Unauthenticated, runtimev1.ReasonCode_LOCAL_APP_ACCOUNT_CHANGED)
	}
	previous, rotating := connection.Session()
	var session localDevelopmentSessionProjection
	var err error
	if rotating {
		session, err = s.localDevelopment.RenewSession(ctx, localDevelopmentSessionBinding{
			SessionID: previous.SessionID, SessionProof: previous.SessionProof, Process: connection.Process(),
			AccountGeneration: generation, RuntimeBootEpoch: connection.RuntimeBootEpoch(),
		})
	} else {
		session, err = s.localDevelopment.ConsumeLaunch(ctx, connection.LaunchID(), connection.Process())
	}
	if err != nil || session.AccountID != account.GetAccountId() || session.AccountGeneration != generation {
		return authservice.LocalAppSessionProjection{}, localDevelopmentFailure(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_ACCOUNT_CHANGED)
	}
	if _, _, err := s.resolveLocalDevelopmentRecord(ctx, session); err != nil {
		_ = s.localDevelopment.RevokeSession(ctx, session.SessionID)
		return authservice.LocalAppSessionProjection{}, localDevelopmentFailure(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED)
	}
	nextHandle := protectedlocal.LocalAppSessionHandle{SessionID: session.SessionID, SessionProof: session.SessionProof}
	if rotating {
		err = connection.RotateSession(previous, nextHandle)
	} else {
		err = connection.BindSession(nextHandle)
	}
	if err != nil {
		_ = s.localDevelopment.RevokeSession(ctx, session.SessionID)
		return authservice.LocalAppSessionProjection{}, localDevelopmentFailure(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED)
	}
	connection.OnRevoke(func() { _ = s.localDevelopment.RevokeSession(context.Background(), session.SessionID) })
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
	origin := connection.Origin()
	if origin.TransportClass != protectedlocal.TransportDesktopControl || !origin.HasRole(protectedlocal.RoleLocalAppControl) {
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

func (s *Service) verifyLocalDevelopmentPresence(ctx context.Context, purpose string) (string, time.Time, error) {
	authority, ok := s.accountProjection.(runtimePresenceAuthority)
	if !ok || authority == nil {
		return "", time.Time{}, accountservice.ErrPresenceVerificationUnavailable
	}
	return authority.VerifyRuntimePresence(ctx, purpose)
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

func localDevelopmentStoreError(err error) error {
	switch {
	case errors.Is(err, errLocalDevelopmentProjectChanged):
		return localDevelopmentFailure(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_PROVENANCE_UNAVAILABLE)
	case errors.Is(err, errLocalDevelopmentReapproval):
		return localDevelopmentFailure(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_ACCOUNT_CHANGED)
	case errors.Is(err, errLocalDevelopmentAuthorization), errors.Is(err, errLocalDevelopmentEvaluationExpired):
		return localDevelopmentFailure(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_RECORD_NOT_FOUND)
	case errors.Is(err, errLocalDevelopmentLaunchExpired), errors.Is(err, errLocalDevelopmentSessionRevoked):
		return localDevelopmentFailure(codes.Unauthenticated, runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED)
	case errors.Is(err, errLocalDevelopmentLaunchMismatch):
		return localDevelopmentFailure(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_PROCESS_MISMATCH)
	default:
		return localDevelopmentFailure(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_RECORD_NOT_FOUND)
	}
}

func localDevelopmentFailure(code codes.Code, reason runtimev1.ReasonCode) error {
	return grpcerr.WithReasonCode(code, reason)
}

func localDevelopmentFailureAtStage(code codes.Code, reason runtimev1.ReasonCode, stage string) error {
	return grpcerr.WithReasonCodeOptions(code, reason, grpcerr.ReasonOptions{Metadata: map[string]string{"diagnostic_stage": stage}})
}
