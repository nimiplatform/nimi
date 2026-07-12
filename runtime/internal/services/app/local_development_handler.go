package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	runtimeartifactservice "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const localDevelopmentTrustClass = "local-development-installed-admission"

func (s *Service) RevokeAccountAuthority(ctx context.Context, accountID string) error {
	if s == nil || s.localDevelopment == nil {
		return errLocalDevelopmentInvalid
	}
	return s.localDevelopment.RevokeAccountAuthority(ctx, strings.TrimSpace(accountID))
}

func OpenLocalDevelopmentStore(path string, bootEpoch protectedlocal.Identifier) (*localDevelopmentStore, error) {
	return openLocalDevelopmentStore(path, bootEpoch)
}

func (s *Service) EvaluateLocalDevelopmentProject(ctx context.Context, req *runtimev1.EvaluateLocalDevelopmentProjectRequest) (*runtimev1.EvaluateLocalDevelopmentProjectResponse, error) {
	if err := requireProtectedLocalDevelopmentDesktop(ctx); err != nil {
		return nil, err
	}
	if s == nil || s.localDevelopment == nil || s.localDevelopmentVerifier == nil || req == nil {
		return nil, localDevelopmentFailure(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_DEVELOPMENT_PLATFORM_UNSUPPORTED)
	}
	runID, ok := localDevelopmentIdentifierFromBytes(req.GetSupervisorRunId())
	if !ok {
		return nil, localDevelopmentFailure(codes.InvalidArgument, runtimev1.ReasonCode_LOCAL_DEVELOPMENT_SUPERVISOR_REQUIRED)
	}
	account, generation, authenticated := s.authenticatedLifecycleAccount(ctx)
	if !authenticated {
		return nil, localDevelopmentFailure(codes.Unauthenticated, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}
	project, err := resolveLocalDevelopmentProject(req.GetProjectRoot(), req.GetExpectedAppId(), req.GetShellKind(), account.GetAccountId(), generation)
	if err != nil {
		return nil, localDevelopmentFailure(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_DEVELOPMENT_PROJECT_CHANGED)
	}
	evaluation, err := s.localDevelopment.Evaluate(ctx, project, runID)
	if err != nil {
		return nil, localDevelopmentStoreError(err)
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
		return nil, localDevelopmentFailure(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_DEVELOPMENT_PLATFORM_UNSUPPORTED)
	}
	evaluationID, ok := localDevelopmentIdentifierFromBytes(req.GetEvaluationId())
	if !ok || !validLocalDevelopmentDecision(req.GetDecision()) {
		return nil, localDevelopmentFailure(codes.InvalidArgument, runtimev1.ReasonCode_LOCAL_DEVELOPMENT_AUTHORIZATION_REQUIRED)
	}
	currentAccountID := ""
	var currentAccountGeneration uint64
	if req.GetDecision() != runtimev1.LocalDevelopmentDecision_LOCAL_DEVELOPMENT_DECISION_DENY {
		account, generation, authenticated := s.authenticatedLifecycleAccount(ctx)
		if !authenticated {
			return nil, localDevelopmentFailure(codes.Unauthenticated, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
		}
		currentAccountID = account.GetAccountId()
		currentAccountGeneration = generation
	}
	authorization, err := s.localDevelopment.Decide(ctx, evaluationID, req.GetDecision(), currentAccountID, currentAccountGeneration)
	if err != nil {
		return nil, localDevelopmentStoreError(err)
	}
	reason := runtimev1.ReasonCode_ACTION_EXECUTED
	if authorization.State == localDevelopmentAuthorizationDenied {
		reason = runtimev1.ReasonCode_LOCAL_DEVELOPMENT_APPROVAL_DENIED
	}
	return &runtimev1.DecideLocalDevelopmentProjectResponse{Authorization: localDevelopmentAuthorizationToProto(authorization), ReasonCode: reason}, nil
}

func (s *Service) ListLocalDevelopmentAuthorizations(ctx context.Context, _ *runtimev1.ListLocalDevelopmentAuthorizationsRequest) (*runtimev1.ListLocalDevelopmentAuthorizationsResponse, error) {
	if err := requireProtectedLocalDevelopmentDesktop(ctx); err != nil {
		return nil, err
	}
	if s == nil || s.localDevelopment == nil {
		return nil, localDevelopmentFailure(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_DEVELOPMENT_PLATFORM_UNSUPPORTED)
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
		return nil, localDevelopmentFailure(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_DEVELOPMENT_PLATFORM_UNSUPPORTED)
	}
	authorizationID, ok := localDevelopmentIdentifierFromBytes(req.GetAuthorizationId())
	if !ok {
		return nil, localDevelopmentFailure(codes.InvalidArgument, runtimev1.ReasonCode_LOCAL_DEVELOPMENT_AUTHORIZATION_REQUIRED)
	}
	account, _, authenticated := s.authenticatedLifecycleAccount(ctx)
	if !authenticated {
		return nil, localDevelopmentFailure(codes.Unauthenticated, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}
	current, err := s.localDevelopment.GetAuthorization(ctx, authorizationID)
	if err != nil || current.Project.AccountID != account.GetAccountId() {
		return nil, localDevelopmentFailure(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_DEVELOPMENT_AUTHORIZATION_REQUIRED)
	}
	authorization, err := s.localDevelopment.RevokeAuthorization(ctx, authorizationID)
	if err != nil {
		return nil, localDevelopmentStoreError(err)
	}
	return &runtimev1.RevokeLocalDevelopmentAuthorizationResponse{Authorization: localDevelopmentAuthorizationToProto(authorization), ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func (s *Service) PrepareLocalDevelopmentLaunch(ctx context.Context, req *runtimev1.PrepareLocalDevelopmentLaunchRequest) (*runtimev1.PrepareLocalDevelopmentLaunchResponse, error) {
	if err := requireProtectedLocalDevelopmentDesktop(ctx); err != nil {
		return nil, err
	}
	if s == nil || s.localDevelopment == nil || req == nil {
		return nil, localDevelopmentFailure(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_DEVELOPMENT_PLATFORM_UNSUPPORTED)
	}
	authorizationID, authorizationOK := localDevelopmentIdentifierFromBytes(req.GetAuthorizationId())
	runID, runOK := localDevelopmentIdentifierFromBytes(req.GetSupervisorRunId())
	if !authorizationOK || !runOK {
		return nil, localDevelopmentFailure(codes.InvalidArgument, runtimev1.ReasonCode_LOCAL_DEVELOPMENT_SUPERVISOR_REQUIRED)
	}
	authorization, err := s.localDevelopment.GetAuthorization(ctx, authorizationID)
	if err != nil || authorization.State != localDevelopmentAuthorizationActive {
		return nil, localDevelopmentFailure(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_DEVELOPMENT_AUTHORIZATION_REQUIRED)
	}
	account, generation, authenticated := s.authenticatedLifecycleAccount(ctx)
	if !authenticated || account.GetAccountId() != authorization.Project.AccountID {
		return nil, localDevelopmentFailure(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_DEVELOPMENT_REAPPROVAL_REQUIRED)
	}
	project, err := resolveLocalDevelopmentProject(authorization.Project.ProjectRoot, authorization.Project.AppID, req.GetShellKind(), account.GetAccountId(), generation)
	if err != nil || !localDevelopmentProjectsMatch(authorization.Project, project) {
		if s.logger != nil {
			s.logger.Warn("local development launch rejected", "stage", "project-authority", "app_id", authorization.Project.AppID, "error", err)
		}
		return nil, localDevelopmentFailure(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_DEVELOPMENT_PROJECT_CHANGED)
	}
	hostExecutable, err := canonicalLocalDevelopmentHostExecutable(project.ProjectRoot, req.GetHostExecutablePath(), req.GetShellKind())
	if err != nil {
		if s.logger != nil {
			s.logger.Warn("local development launch rejected", "stage", "host-executable", "app_id", authorization.Project.AppID, "error", err)
		}
		return nil, localDevelopmentFailure(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_DEVELOPMENT_PROJECT_CHANGED)
	}
	ticket, err := s.localDevelopment.PrepareLaunch(ctx, localDevelopmentLaunchRequest{
		AuthorizationID: authorizationID,
		SupervisorRunID: runID,
		Project:         project,
		ShellKind:       req.GetShellKind(),
		HostExecutable:  hostExecutable,
		RendererOrigin:  strings.TrimSpace(req.GetRendererOrigin()),
	})
	if err != nil {
		if s.logger != nil {
			s.logger.Warn("local development launch rejected", "stage", "launch-store", "app_id", authorization.Project.AppID, "error", err)
		}
		return nil, localDevelopmentStoreError(err)
	}
	desktopConnection, ok := protectedlocal.DesktopConnectionFromContext(ctx)
	if !ok || desktopConnection == nil {
		_ = s.localDevelopment.EndRun(context.Background(), authorizationID, runID)
		return nil, localDevelopmentFailure(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_DEVELOPMENT_SUPERVISOR_REQUIRED)
	}
	if err := desktopConnection.BindRevocationHook(runID, func() {
		_ = s.localDevelopment.EndRun(context.Background(), authorizationID, runID)
	}); err != nil {
		_ = s.localDevelopment.EndRun(context.Background(), authorizationID, runID)
		return nil, localDevelopmentFailure(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_DEVELOPMENT_SUPERVISOR_REQUIRED)
	}
	return &runtimev1.PrepareLocalDevelopmentLaunchResponse{LaunchId: append([]byte(nil), ticket.LaunchID[:]...), BindDeadline: timestamppb.New(ticket.BindDeadline), ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func (s *Service) BindLocalDevelopmentHostProcess(ctx context.Context, req *runtimev1.BindLocalDevelopmentHostProcessRequest) (*runtimev1.BindLocalDevelopmentHostProcessResponse, error) {
	if err := requireProtectedLocalDevelopmentDesktop(ctx); err != nil {
		return nil, err
	}
	if s == nil || s.localDevelopment == nil || s.localDevelopmentRegistry == nil || s.localDevelopmentVerifier == nil || req == nil {
		return nil, localDevelopmentFailure(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_DEVELOPMENT_PLATFORM_UNSUPPORTED)
	}
	launchID, ok := localDevelopmentIdentifierFromBytes(req.GetLaunchId())
	if !ok || req.GetChildProcessId() == 0 {
		return nil, localDevelopmentFailure(codes.InvalidArgument, runtimev1.ReasonCode_LOCAL_DEVELOPMENT_SUPERVISOR_REQUIRED)
	}
	policy, err := s.localDevelopment.PendingLaunchPolicy(ctx, launchID)
	if err != nil {
		return nil, localDevelopmentStoreError(err)
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
		return nil, localDevelopmentFailure(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_DEVELOPMENT_SUPERVISOR_REQUIRED)
	}
	return &runtimev1.BindLocalDevelopmentHostProcessResponse{LaunchId: append([]byte(nil), launchID[:]...), BindDeadline: timestamppb.New(deadline), ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func (s *Service) OpenLocalDevelopmentAppSession(ctx context.Context, _ *runtimev1.OpenLocalDevelopmentAppSessionRequest) (*runtimev1.OpenLocalDevelopmentAppSessionResponse, error) {
	if s == nil || s.localDevelopment == nil || s.localDevelopmentArtifacts == nil {
		return nil, localDevelopmentFailure(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_DEVELOPMENT_PLATFORM_UNSUPPORTED)
	}
	connection, ok := protectedlocal.InstalledLaunchConnectionFromContext(ctx)
	if !ok || connection == nil || connection.Process().ExecutableTrustSetID != protectedlocal.WindowsLocalDevelopmentTrustSetID {
		return nil, localDevelopmentFailure(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_DEVELOPMENT_SUPERVISOR_REQUIRED)
	}
	if _, production := connection.InstalledSession(); production {
		return nil, localDevelopmentFailure(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_DEVELOPMENT_OPERATION_FORBIDDEN)
	}
	account, generation, authenticated := s.authenticatedLifecycleAccount(ctx)
	if !authenticated {
		return nil, localDevelopmentFailure(codes.Unauthenticated, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}
	previous, rotating := connection.LocalDevelopmentSession()
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
		return nil, localDevelopmentFailure(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_DEVELOPMENT_REAPPROVAL_REQUIRED)
	}
	nextHandle := protectedlocal.LocalDevelopmentSessionHandle{SessionID: session.SessionID, SessionProof: session.SessionProof}
	if rotating {
		err = connection.RotateLocalDevelopmentSession(previous, nextHandle)
	} else {
		err = connection.BindLocalDevelopmentSession(nextHandle)
	}
	if err != nil {
		_ = s.localDevelopment.RevokeSession(ctx, session.SessionID)
		return nil, localDevelopmentFailure(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_DEVELOPMENT_SESSION_REVOKED)
	}
	connection.OnRevoke(func() { _ = s.localDevelopment.RevokeSession(context.Background(), session.SessionID) })
	artifactID, err := s.writeLocalDevelopmentBootstrapArtifact(session)
	if err != nil {
		connection.Revoke()
		return nil, localDevelopmentFailure(codes.Internal, runtimev1.ReasonCode_ARTIFACT_INVALID_INPUT)
	}
	return &runtimev1.OpenLocalDevelopmentAppSessionResponse{
		State:               runtimev1.LocalDevelopmentBootstrapState_LOCAL_DEVELOPMENT_BOOTSTRAP_STATE_READY,
		AppId:               session.AppID,
		BootstrapArtifactId: artifactID,
		ExpiresAt:           timestamppb.New(session.ExpiresAt),
		AccountGeneration:   session.AccountGeneration,
		RuntimeBootEpoch:    append([]byte(nil), session.RuntimeBootEpoch[:]...),
		ReasonCode:          runtimev1.ReasonCode_ACTION_EXECUTED,
	}, nil
}

func (s *Service) GetLocalDevelopmentSessionStatus(ctx context.Context, _ *runtimev1.GetLocalDevelopmentSessionStatusRequest) (*runtimev1.GetLocalDevelopmentSessionStatusResponse, error) {
	if s == nil || s.localDevelopment == nil {
		return nil, localDevelopmentFailure(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_DEVELOPMENT_PLATFORM_UNSUPPORTED)
	}
	connection, ok := protectedlocal.InstalledLaunchConnectionFromContext(ctx)
	if !ok {
		return nil, localDevelopmentFailure(codes.Unauthenticated, runtimev1.ReasonCode_LOCAL_DEVELOPMENT_SESSION_REVOKED)
	}
	handle, ok := connection.LocalDevelopmentSession()
	if !ok {
		return nil, localDevelopmentFailure(codes.Unauthenticated, runtimev1.ReasonCode_LOCAL_DEVELOPMENT_SESSION_REVOKED)
	}
	_, generation, authenticated := s.authenticatedLifecycleAccount(ctx)
	if !authenticated {
		return nil, localDevelopmentFailure(codes.Unauthenticated, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}
	session, err := s.localDevelopment.ValidateSession(ctx, localDevelopmentSessionBinding{SessionID: handle.SessionID, SessionProof: handle.SessionProof, Process: connection.Process(), AccountGeneration: generation, RuntimeBootEpoch: connection.RuntimeBootEpoch()})
	if err != nil {
		return nil, localDevelopmentFailure(codes.Unauthenticated, runtimev1.ReasonCode_LOCAL_DEVELOPMENT_SESSION_REVOKED)
	}
	return &runtimev1.GetLocalDevelopmentSessionStatusResponse{State: runtimev1.LocalDevelopmentBootstrapState_LOCAL_DEVELOPMENT_BOOTSTRAP_STATE_READY, AppId: session.AppID, ExpiresAt: timestamppb.New(session.ExpiresAt), ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

// ResolveInstalledSession projects a verified local-development technical
// session into the existing Account-owned per-operation evaluator. The trust
// class remains explicit; it is never represented as an installed release.
func (s *Service) ResolveInstalledSession(ctx context.Context, accountGeneration uint64) (accountservice.InstalledCallerBinding, error) {
	if s == nil || s.localDevelopment == nil || accountGeneration == 0 {
		return accountservice.InstalledCallerBinding{}, errLocalDevelopmentSessionRevoked
	}
	connection, ok := protectedlocal.InstalledLaunchConnectionFromContext(ctx)
	if !ok || connection.Process().ExecutableTrustSetID != protectedlocal.WindowsLocalDevelopmentTrustSetID {
		return accountservice.InstalledCallerBinding{}, errLocalDevelopmentSessionRevoked
	}
	handle, ok := connection.LocalDevelopmentSession()
	if !ok {
		return accountservice.InstalledCallerBinding{}, errLocalDevelopmentSessionRevoked
	}
	session, err := s.localDevelopment.ValidateSession(ctx, localDevelopmentSessionBinding{
		SessionID: handle.SessionID, SessionProof: handle.SessionProof, Process: connection.Process(),
		AccountGeneration: accountGeneration, RuntimeBootEpoch: connection.RuntimeBootEpoch(),
	})
	if err != nil || !connection.Live() {
		return accountservice.InstalledCallerBinding{}, errLocalDevelopmentSessionRevoked
	}
	return accountservice.InstalledCallerBinding{
		SessionID:               session.SessionID,
		AppID:                   session.AppID,
		ReleaseDigest:           session.HostExecutableDigest,
		AccountGeneration:       session.AccountGeneration,
		RuntimeBootEpoch:        session.RuntimeBootEpoch,
		Process:                 session.Process,
		ExpiresAt:               session.ExpiresAt,
		TrustClass:              accountservice.InstalledTrustClassLocalDevelopment,
		AuthorizationID:         session.AuthorizationID,
		AuthorizationGeneration: session.AuthorizationGeneration,
		ProjectRoot:             session.ProjectRoot,
		CapabilityFingerprint:   session.CapabilityFingerprint,
		Capabilities:            append([]string(nil), session.Capabilities...),
	}, nil
}

func (s *Service) EndLocalDevelopmentRun(ctx context.Context, req *runtimev1.EndLocalDevelopmentRunRequest) (*runtimev1.EndLocalDevelopmentRunResponse, error) {
	if err := requireProtectedLocalDevelopmentDesktop(ctx); err != nil {
		return nil, err
	}
	if s == nil || s.localDevelopment == nil || req == nil {
		return nil, localDevelopmentFailure(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_DEVELOPMENT_PLATFORM_UNSUPPORTED)
	}
	authorizationID, authorizationOK := localDevelopmentIdentifierFromBytes(req.GetAuthorizationId())
	runID, runOK := localDevelopmentIdentifierFromBytes(req.GetSupervisorRunId())
	if !authorizationOK || !runOK {
		return nil, localDevelopmentFailure(codes.InvalidArgument, runtimev1.ReasonCode_LOCAL_DEVELOPMENT_SUPERVISOR_REQUIRED)
	}
	if err := s.localDevelopment.EndRun(ctx, authorizationID, runID); err != nil {
		return nil, localDevelopmentStoreError(err)
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
	if origin.TransportClass != protectedlocal.TransportDesktopControl || !origin.HasRole(protectedlocal.RoleDesktopLifecycleHost) {
		return localDevelopmentFailure(codes.PermissionDenied, runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH)
	}
	return nil
}

func localDevelopmentProjectToProto(project localDevelopmentProjectSnapshot) *runtimev1.LocalDevelopmentProjectProjection {
	return &runtimev1.LocalDevelopmentProjectProjection{
		AppId:                 project.AppID,
		DisplayName:           project.DisplayName,
		CanonicalProjectRoot:  project.ProjectRoot,
		CanonicalManifestPath: project.ManifestPath,
		ShellKind:             project.ShellKind,
		AccountId:             project.AccountID,
		RequestedCapabilities: append([]string(nil), project.Capabilities...),
		CapabilityFingerprint: append([]byte(nil), project.CapabilityFingerprint[:]...),
		TrustClass:            localDevelopmentTrustClass,
	}
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

func canonicalLocalDevelopmentHostExecutable(projectRoot string, raw string, shellKind runtimev1.LocalDevelopmentShellKind) (string, error) {
	path := filepath.Clean(strings.TrimSpace(raw))
	if !filepath.IsAbs(path) {
		return "", errLocalDevelopmentProjectChanged
	}
	canonical, err := canonicalLocalDevelopmentFilePath(path)
	if err != nil {
		return "", err
	}
	canonical = filepath.Clean(canonical)
	info, err := os.Stat(canonical)
	if err != nil || !info.Mode().IsRegular() {
		return "", errLocalDevelopmentProjectChanged
	}
	electronAliasCanonical := ""
	if shellKind == runtimev1.LocalDevelopmentShellKind_LOCAL_DEVELOPMENT_SHELL_KIND_ELECTRON {
		electronAlias := filepath.Join(projectRoot, "node_modules", "electron", "dist", "electron.exe")
		if !pathWithinLocalDevelopmentRoot(projectRoot, electronAlias) {
			return "", errLocalDevelopmentProjectChanged
		}
		electronAliasCanonical, err = canonicalLocalDevelopmentFilePath(electronAlias)
		if err != nil {
			return "", errLocalDevelopmentProjectChanged
		}
		aliasInfo, err := os.Stat(electronAliasCanonical)
		if err != nil || !aliasInfo.Mode().IsRegular() {
			return "", errLocalDevelopmentProjectChanged
		}
	}
	return validateCanonicalLocalDevelopmentHostExecutable(
		projectRoot,
		canonical,
		electronAliasCanonical,
		shellKind,
	)
}

func validateCanonicalLocalDevelopmentHostExecutable(
	projectRoot string,
	candidate string,
	electronAliasCanonical string,
	shellKind runtimev1.LocalDevelopmentShellKind,
) (string, error) {
	candidate = filepath.Clean(candidate)
	switch shellKind {
	case runtimev1.LocalDevelopmentShellKind_LOCAL_DEVELOPMENT_SHELL_KIND_ELECTRON:
		alias := filepath.Clean(electronAliasCanonical)
		if alias == "." || !sameLocalDevelopmentFile(candidate, alias) {
			return "", errLocalDevelopmentProjectChanged
		}
	case runtimev1.LocalDevelopmentShellKind_LOCAL_DEVELOPMENT_SHELL_KIND_TAURI:
		if !pathWithinLocalDevelopmentRoot(projectRoot, candidate) {
			return "", errLocalDevelopmentProjectChanged
		}
	default:
		return "", errLocalDevelopmentProjectChanged
	}
	return candidate, nil
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

func (s *Service) writeLocalDevelopmentBootstrapArtifact(session localDevelopmentSessionProjection) (string, error) {
	payload, err := json.Marshal(struct {
		State      string `json:"state"`
		AppID      string `json:"appId"`
		TrustClass string `json:"trustClass"`
		Operation  string `json:"operation"`
	}{State: "ready", AppID: session.AppID, TrustClass: localDevelopmentTrustClass, Operation: "artifacts.readRuntimeBytes"})
	if err != nil {
		return "", err
	}
	selectorHash := sha256.Sum256(append([]byte("nimi-local-development-bootstrap-v1\x00"), session.SessionID[:]...))
	artifactID := "local-development-bootstrap-" + hex.EncodeToString(selectorHash[:])
	record := runtimeartifactservice.ArtifactRecord{
		Bytes:     payload,
		MimeType:  "application/json",
		CreatedAt: s.localDevelopment.now().UTC(),
		Audience: &runtimeartifactservice.ArtifactAudience{
			ProducerJobID:           "runtime.local-development.bootstrap",
			OwnerAccountID:          session.AccountID,
			AppID:                   session.AppID,
			ReleaseDigest:           session.HostExecutableDigest,
			SessionID:               session.SessionID,
			AccountGeneration:       session.AccountGeneration,
			AllowedUse:              runtimeartifactservice.ArtifactUseReadBytes,
			ExpiresAt:               session.ExpiresAt,
			TrustClass:              localDevelopmentTrustClass,
			AuthorizationID:         session.AuthorizationID,
			AuthorizationGeneration: session.AuthorizationGeneration,
			ProjectRoot:             session.ProjectRoot,
			CapabilityFingerprint:   session.CapabilityFingerprint,
		},
	}
	if err := s.localDevelopmentArtifacts.Put(artifactID, record); err != nil {
		return "", err
	}
	return artifactID, nil
}

func localDevelopmentStoreError(err error) error {
	switch {
	case errors.Is(err, errLocalDevelopmentProjectChanged):
		return localDevelopmentFailure(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_DEVELOPMENT_PROJECT_CHANGED)
	case errors.Is(err, errLocalDevelopmentReapproval):
		return localDevelopmentFailure(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_DEVELOPMENT_REAPPROVAL_REQUIRED)
	case errors.Is(err, errLocalDevelopmentAuthorization), errors.Is(err, errLocalDevelopmentEvaluationExpired):
		return localDevelopmentFailure(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_DEVELOPMENT_AUTHORIZATION_REQUIRED)
	case errors.Is(err, errLocalDevelopmentLaunchExpired), errors.Is(err, errLocalDevelopmentSessionRevoked):
		return localDevelopmentFailure(codes.Unauthenticated, runtimev1.ReasonCode_LOCAL_DEVELOPMENT_SESSION_REVOKED)
	case errors.Is(err, errLocalDevelopmentLaunchMismatch):
		return localDevelopmentFailure(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_DEVELOPMENT_SUPERVISOR_REQUIRED)
	default:
		return localDevelopmentFailure(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_DEVELOPMENT_AUTHORIZATION_REQUIRED)
	}
}

func localDevelopmentFailure(code codes.Code, reason runtimev1.ReasonCode) error {
	return grpcerr.WithReasonCode(code, reason)
}
