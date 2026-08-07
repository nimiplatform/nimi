package app

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appstorage"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	authservice "github.com/nimiplatform/nimi/runtime/internal/services/auth"
	"google.golang.org/grpc/codes"
)

var (
	errLocalAppAccountRequired               = errors.New("local-app authenticated account required")
	errLocalAppAccountGenerationChanged      = errors.New("local-app account generation changed")
	errLocalAppRegistrationGenerationChanged = errors.New("local-app registration generation changed")
)

type localAppRuntimeSession struct {
	handle                protectedlocal.LocalAppSessionHandle
	launchCorrelation     protectedlocal.Identifier
	registrationHandle    string
	registeredAppSubject  string
	appID                 string
	sourceGeneration      uint64
	declarationGeneration uint64
	accountID             string
	realmEnvironmentID    string
	accountGeneration     uint64
	accountInvalidated    <-chan struct{}
	runtimeGeneration     uint64
	snapshot              *localappop.EffectiveAppAccessSnapshot
	currentUser           *runtimev1.CurrentUserDisplayProjection
	currentUserReason     runtimev1.ReasonCode
	expiresAt             time.Time
}

func (s *Service) OpenLocalAppSessionProjection(ctx context.Context) (authservice.LocalAppSessionProjection, error) {
	connection, ok := protectedlocal.LocalAppConnectionFromContext(ctx)
	if !ok || connection == nil || !connection.BootstrapAllowed() {
		return authservice.LocalAppSessionProjection{}, localDevelopmentFailure(codes.Unauthenticated, runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED)
	}
	registrationHandle, launchCorrelation, err := s.initialLocalAppSessionRegistration(ctx, connection)
	if err != nil {
		return authservice.LocalAppSessionProjection{}, localAppSessionEstablishmentError(err)
	}
	next, err := s.deriveLocalAppRuntimeSession(ctx, registrationHandle, launchCorrelation)
	if err != nil {
		return authservice.LocalAppSessionProjection{}, localAppSessionEstablishmentError(err)
	}
	if err := connection.BindSession(next.handle); err != nil {
		return authservice.LocalAppSessionProjection{}, localDevelopmentFailureFromCause(codes.Unauthenticated, runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED, err)
	}
	s.localAppSessionMu.Lock()
	if _, exists := s.localAppSessions[connection]; exists {
		s.localAppSessionMu.Unlock()
		connection.Revoke()
		return authservice.LocalAppSessionProjection{}, localDevelopmentFailure(codes.Unauthenticated, runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED)
	}
	s.localAppSessions[connection] = next
	s.localAppSessionMu.Unlock()
	connection.OnRevoke(func() {
		s.localAppSessionMu.Lock()
		delete(s.localAppSessions, connection)
		s.localAppSessionMu.Unlock()
	})
	return localAppAuthSessionProjection(next), nil
}

func (s *Service) RenewLocalAppSessionProjection(ctx context.Context) (authservice.LocalAppSessionProjection, error) {
	connection, ok := protectedlocal.LocalAppConnectionFromContext(ctx)
	if !ok || connection == nil || !connection.ProtectedOperationAllowed() {
		return authservice.LocalAppSessionProjection{}, localDevelopmentFailure(codes.Unauthenticated, runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED)
	}
	previousHandle, ok := connection.Session()
	if !ok {
		return authservice.LocalAppSessionProjection{}, localDevelopmentFailure(codes.Unauthenticated, runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED)
	}
	s.localAppSessionMu.RLock()
	previous, exists := s.localAppSessions[connection]
	s.localAppSessionMu.RUnlock()
	if !exists || previous.handle != previousHandle {
		return authservice.LocalAppSessionProjection{}, localDevelopmentFailure(codes.Unauthenticated, runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED)
	}
	next, err := s.deriveLocalAppRuntimeSession(ctx, previous.registrationHandle, previous.launchCorrelation)
	if err != nil {
		return authservice.LocalAppSessionProjection{}, localAppSessionEstablishmentError(err)
	}
	if err := connection.RotateSession(previousHandle, next.handle); err != nil {
		return authservice.LocalAppSessionProjection{}, localDevelopmentFailureFromCause(codes.Unauthenticated, runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED, err)
	}
	s.localAppSessionMu.Lock()
	current, stillCurrent := s.localAppSessions[connection]
	if !stillCurrent || current.handle != previousHandle {
		s.localAppSessionMu.Unlock()
		connection.Revoke()
		return authservice.LocalAppSessionProjection{}, localDevelopmentFailure(codes.Unauthenticated, runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED)
	}
	s.localAppSessions[connection] = next
	s.localAppSessionMu.Unlock()
	return localAppAuthSessionProjection(next), nil
}

func (s *Service) initialLocalAppSessionRegistration(ctx context.Context, connection *protectedlocal.LocalAppConnection) (string, protectedlocal.Identifier, error) {
	if s == nil || s.localAppKernel == nil || connection == nil {
		return "", protectedlocal.Identifier{}, errLocalDevelopmentSessionRevoked
	}
	if launch, direct := connection.DirectLaunch(); direct {
		if launch.RegistrationHandle == (protectedlocal.Identifier{}) || launch.LaunchID == (protectedlocal.Identifier{}) {
			return "", protectedlocal.Identifier{}, errLocalDevelopmentLaunchMismatch
		}
		return localDevelopmentRegistrationHandleRef(launch.RegistrationHandle), launch.LaunchID, nil
	}
	if s.localDevelopment == nil {
		return "", protectedlocal.Identifier{}, errLocalDevelopmentSessionRevoked
	}
	ticket, err := s.localDevelopment.SessionLaunch(ctx, connection.LaunchID(), connection.Process())
	if err != nil || ticket.RegistrationHandle == (protectedlocal.Identifier{}) {
		return "", protectedlocal.Identifier{}, fmt.Errorf("resolve verified local-app launch: %w", err)
	}
	return localDevelopmentRegistrationHandleRef(ticket.RegistrationHandle), ticket.LaunchID, nil
}

func (s *Service) deriveLocalAppRuntimeSession(ctx context.Context, registrationHandle string, launchCorrelation protectedlocal.Identifier) (localAppRuntimeSession, error) {
	if s == nil || s.localAppKernel == nil || launchCorrelation == (protectedlocal.Identifier{}) {
		return localAppRuntimeSession{}, errLocalDevelopmentSessionRevoked
	}
	registration, err := s.localAppKernel.Registrations().GetByHandle(ctx, registrationHandle)
	if err != nil {
		return localAppRuntimeSession{}, fmt.Errorf("resolve current registered App record: %w", err)
	}
	if registration.State != localappkernel.RegistrationStateActive {
		return localAppRuntimeSession{}, localappkernel.ErrRegistrationTombstoned
	}
	if strings.TrimSpace(registration.RegisteredAppSubject) == "" {
		return localAppRuntimeSession{}, errLocalDevelopmentSessionRevoked
	}
	account, accountGeneration, accountInvalidated, ok := s.bindAuthenticatedRuntimeAccount(ctx)
	if !ok {
		return localAppRuntimeSession{}, errLocalAppAccountRequired
	}
	handle, runtimeGeneration, err := s.newLocalAppSessionMaterial()
	if err != nil {
		return localAppRuntimeSession{}, err
	}
	binding := localappop.SnapshotBinding{
		LaunchCorrelation:     [32]byte(launchCorrelation),
		RegistrationHandle:    registration.RegistrationHandle,
		RegisteredAppSubject:  registration.RegisteredAppSubject,
		SourceGeneration:      registration.SourceGeneration,
		DeclarationGeneration: registration.DeclarationGeneration,
		AccountID:             strings.TrimSpace(account.GetAccountId()),
		AccountGeneration:     accountGeneration,
		RuntimeGeneration:     runtimeGeneration,
	}
	snapshot, err := localappop.NewEffectiveAppAccessSnapshot(binding, registration.ActivatedDomains)
	if err != nil {
		return localAppRuntimeSession{}, fmt.Errorf("derive Effective App Access Snapshot: %w", err)
	}
	currentUser, currentUserReason := s.currentUserDisplayProjection(ctx)
	return localAppRuntimeSession{
		handle: handle, launchCorrelation: launchCorrelation,
		registrationHandle: registration.RegistrationHandle, registeredAppSubject: registration.RegisteredAppSubject,
		appID: registration.AppID, sourceGeneration: registration.SourceGeneration,
		declarationGeneration: registration.DeclarationGeneration,
		accountID:             binding.AccountID, realmEnvironmentID: strings.TrimSpace(account.GetRealmEnvironmentId()),
		accountGeneration: accountGeneration, accountInvalidated: accountInvalidated,
		runtimeGeneration: runtimeGeneration, snapshot: snapshot,
		currentUser: currentUser, currentUserReason: currentUserReason,
		expiresAt: s.now().UTC().Add(s.localAppSessionTTL),
	}, nil
}

func (s *Service) currentUserDisplayProjection(ctx context.Context) (*runtimev1.CurrentUserDisplayProjection, runtimev1.ReasonCode) {
	provider, ok := s.accountProjection.(runtimeCurrentUserDisplayProvider)
	if !ok {
		return nil, runtimev1.ReasonCode_CURRENT_USER_DISPLAY_UNAVAILABLE
	}
	display, err := provider.CurrentUserDisplay(ctx)
	if err != nil || display.Handle == "" || display.DisplayName == "" {
		return nil, runtimev1.ReasonCode_CURRENT_USER_DISPLAY_UNAVAILABLE
	}
	return &runtimev1.CurrentUserDisplayProjection{
		Handle: display.Handle, DisplayName: display.DisplayName, AvatarUrl: display.AvatarURL,
	}, runtimev1.ReasonCode_ACTION_EXECUTED
}

func localAppAuthSessionProjection(session localAppRuntimeSession) authservice.LocalAppSessionProjection {
	return authservice.LocalAppSessionProjection{
		CurrentUser: session.currentUser, CurrentUserReasonCode: session.currentUserReason,
	}
}

func (s *Service) newLocalAppSessionMaterial() (protectedlocal.LocalAppSessionHandle, uint64, error) {
	if s == nil || s.localAppSessionEntropy == nil {
		return protectedlocal.LocalAppSessionHandle{}, 0, errLocalDevelopmentSessionRevoked
	}
	s.localAppSessionMu.Lock()
	defer s.localAppSessionMu.Unlock()
	if s.localAppRuntimeGeneration == 0 {
		var encoded [8]byte
		if _, err := io.ReadFull(s.localAppSessionEntropy, encoded[:]); err != nil {
			return protectedlocal.LocalAppSessionHandle{}, 0, fmt.Errorf("generate Runtime App-access generation: %w", err)
		}
		s.localAppRuntimeGeneration = binary.BigEndian.Uint64(encoded[:])
		if s.localAppRuntimeGeneration == 0 {
			return protectedlocal.LocalAppSessionHandle{}, 0, fmt.Errorf("generate Runtime App-access generation: zero value")
		}
	}
	handle, err := protectedlocal.NewLocalAppSessionHandle(s.localAppSessionEntropy)
	if err != nil {
		return protectedlocal.LocalAppSessionHandle{}, 0, err
	}
	return handle, s.localAppRuntimeGeneration, nil
}

func (s *Service) AdmitLocalAppIngress(ctx context.Context, ingress localappop.Ingress) error {
	_, err := s.AuthorizeLocalAppIngress(ctx, ingress)
	return err
}

// AuthorizeLocalAppIngress performs the common admission once and attaches only
// the Runtime-derived owner handoff. Caller-supplied owner, account, subject,
// generation, or capability facts never enter this context.
func (s *Service) AuthorizeLocalAppIngress(ctx context.Context, ingress localappop.Ingress) (context.Context, error) {
	admission, session, err := s.admitLocalAppIngress(ctx, ingress)
	if err != nil {
		return nil, localAppIngressError(err)
	}
	capability := ""
	ownerSupported := true
	switch admission.Operation {
	case localappop.OperationStorageJSONRead, localappop.OperationStorageJSONWrite, localappop.OperationStorageJSONRemove:
		capability = appstorage.LocalAppPrivateStorageEntitlement
	case localappop.OperationAppAIConfigGet, localappop.OperationAppAIConfigOverwrite:
		// The AIConfig owner validates the exact admitted operation directly;
		// it has no separate capability string or caller-selected owner input.
	case localappop.OperationRealmWorldCoreList:
		capability = "realm.world-core.list"
	case localappop.OperationRealmWorldCoreCreate:
		capability = "realm.world-core.create"
	case localappop.OperationTextCandidateGenerate:
		capability = localappop.AppOperationIDTextCandidateGenerate
	case localappop.OperationAgentReferenceList,
		localappop.OperationConversationOpen,
		localappop.OperationConversationTurnSend,
		localappop.OperationConversationTurnInterrupt,
		localappop.OperationConversationEventsSubscribe,
		localappop.OperationConversationSnapshotGet:
		capability = "agent.local"
	default:
		ownerSupported = false
	}
	if !ownerSupported {
		return nil, localDevelopmentFailure(codes.Unimplemented, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNSUPPORTED)
	}
	registrationHandle, registrationOK := localDevelopmentRegistrationIdentifier(session.registrationHandle)
	connection, connectionOK := protectedlocal.LocalAppConnectionFromContext(ctx)
	if !registrationOK || !connectionOK || connection == nil {
		return nil, localDevelopmentFailure(codes.Unauthenticated, runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED)
	}
	directPeer, _ := connection.DirectPeer()
	process := connection.Process()
	decision := accountservice.LocalAppCallerDecision{
		LocalOSUserAnchor: s.localAppKernel.LocalOSUserAnchor(), SessionID: session.handle.SessionID,
		AppID: session.appID, HostExecutableDigest: process.ExecutableDigest,
		AccountID: session.accountID, RealmEnvironmentID: session.realmEnvironmentID,
		AccountGeneration: session.accountGeneration, RuntimeBootEpoch: connection.RuntimeBootEpoch(),
		Process: process, DirectPeer: directPeer, ExpiresAt: session.expiresAt,
		Operation: admission.Operation, AuthorityClass: admission.Class, OperationCapability: capability,
		TrustClass: accountservice.LocalAppTrustClassDevelopment, RegistrationHandle: registrationHandle,
		SourceGeneration: session.sourceGeneration, DeclarationGeneration: session.declarationGeneration,
		RegisteredAppSubject: session.registeredAppSubject,
	}
	return accountservice.ContextWithAuthorizedLocalAppDecision(ctx, decision), nil
}

func localAppIngressError(err error) error {
	switch {
	case errors.Is(err, errLocalAppAccountGenerationChanged):
		return localDevelopmentFailure(codes.Unauthenticated, runtimev1.ReasonCode_LOCAL_APP_ACCOUNT_CHANGED)
	case errors.Is(err, errLocalDevelopmentSessionRevoked), errors.Is(err, errLocalAppRegistrationGenerationChanged), errors.Is(err, localappop.ErrSessionInvalid), errors.Is(err, localappop.ErrSnapshotStale):
		return localDevelopmentFailure(codes.Unauthenticated, runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED)
	case errors.Is(err, localappop.ErrSnapshotMissing):
		return localDevelopmentFailure(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_SNAPSHOT_UNAVAILABLE)
	case errors.Is(err, localappop.ErrDomainUncovered), errors.Is(err, localappop.ErrCallerAssertion):
		return localDevelopmentFailure(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED)
	case errors.Is(err, localappop.ErrOperationUnknown), errors.Is(err, localappop.ErrContractInvalid):
		return localDevelopmentFailure(codes.Unimplemented, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNSUPPORTED)
	default:
		return localDevelopmentFailure(codes.Unavailable, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
	}
}

func (s *Service) admitLocalAppIngress(ctx context.Context, ingress localappop.Ingress) (localappop.Admission, localAppRuntimeSession, error) {
	connection, ok := protectedlocal.LocalAppConnectionFromContext(ctx)
	if !ok || connection == nil || !connection.ProtectedOperationAllowed() {
		return localappop.Admission{}, localAppRuntimeSession{}, errLocalDevelopmentSessionRevoked
	}
	handle, ok := connection.Session()
	if !ok {
		return localappop.Admission{}, localAppRuntimeSession{}, errLocalDevelopmentSessionRevoked
	}
	s.localAppSessionMu.RLock()
	session, exists := s.localAppSessions[connection]
	s.localAppSessionMu.RUnlock()
	if !exists || session.handle != handle || !s.now().UTC().Before(session.expiresAt) {
		return localappop.Admission{}, localAppRuntimeSession{}, errLocalDevelopmentSessionRevoked
	}
	select {
	case <-session.accountInvalidated:
		return localappop.Admission{}, localAppRuntimeSession{}, errLocalAppAccountGenerationChanged
	default:
	}
	account, generation, _, accountOK := s.bindAuthenticatedRuntimeAccount(ctx)
	if !accountOK || generation != session.accountGeneration || strings.TrimSpace(account.GetAccountId()) != session.accountID {
		return localappop.Admission{}, localAppRuntimeSession{}, errLocalAppAccountGenerationChanged
	}
	registration, err := s.localAppKernel.Registrations().GetByHandle(ctx, session.registrationHandle)
	if err != nil || registration.State != localappkernel.RegistrationStateActive ||
		registration.RegisteredAppSubject != session.registeredAppSubject ||
		registration.SourceGeneration != session.sourceGeneration ||
		registration.DeclarationGeneration != session.declarationGeneration {
		return localappop.Admission{}, localAppRuntimeSession{}, errLocalAppRegistrationGenerationChanged
	}
	admission, err := localappop.Admit(localappop.AdmissionInput{
		Ingress: ingress, Snapshot: session.snapshot,
		Current: localappop.CurrentBinding{
			LaunchCorrelation: [32]byte(session.launchCorrelation), RegistrationHandle: session.registrationHandle,
			RegisteredAppSubject: session.registeredAppSubject, SourceGeneration: session.sourceGeneration,
			DeclarationGeneration: session.declarationGeneration, AccountID: session.accountID,
			AccountGeneration: session.accountGeneration, RuntimeGeneration: session.runtimeGeneration,
		},
	})
	return admission, session, err
}

func (s *Service) ResolveLocalAppSession(ctx context.Context, accountGeneration uint64) (accountservice.LocalAppCallerBinding, error) {
	_, session, err := s.admitLocalAppIngress(ctx, localappop.IngressStorageJSONRead)
	if err != nil || accountGeneration == 0 || accountGeneration != session.accountGeneration {
		return accountservice.LocalAppCallerBinding{}, errLocalDevelopmentSessionRevoked
	}
	registrationHandle, ok := localDevelopmentRegistrationIdentifier(session.registrationHandle)
	if !ok {
		return accountservice.LocalAppCallerBinding{}, errLocalDevelopmentSessionRevoked
	}
	connection, ok := protectedlocal.LocalAppConnectionFromContext(ctx)
	if !ok {
		return accountservice.LocalAppCallerBinding{}, errLocalDevelopmentSessionRevoked
	}
	return accountservice.LocalAppCallerBinding{
		LocalOSUserAnchor: s.localAppKernel.LocalOSUserAnchor(), SessionID: session.handle.SessionID,
		AppID: session.appID, AccountGeneration: session.accountGeneration,
		Process: connection.Process(), ExpiresAt: session.expiresAt, TrustClass: accountservice.LocalAppTrustClassDevelopment,
		RegistrationHandle: registrationHandle, SourceGeneration: session.sourceGeneration,
		DeclarationGeneration: session.declarationGeneration, RegisteredAppSubject: session.registeredAppSubject,
	}, nil
}

func localAppSessionEstablishmentError(err error) error {
	switch {
	case errors.Is(err, errLocalAppAccountRequired):
		return localDevelopmentFailure(codes.Unauthenticated, runtimev1.ReasonCode_AUTH_TOKEN_INVALID)
	case errors.Is(err, errLocalAppAccountGenerationChanged):
		return localDevelopmentFailure(codes.Unauthenticated, runtimev1.ReasonCode_LOCAL_APP_ACCOUNT_CHANGED)
	case errors.Is(err, localappkernel.ErrNotFound), errors.Is(err, localappkernel.ErrRegistrationTombstoned):
		return localDevelopmentFailure(codes.NotFound, runtimev1.ReasonCode_LOCAL_APP_RECORD_NOT_FOUND)
	default:
		return localDevelopmentFailureFromCause(codes.Unavailable, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE, err)
	}
}
