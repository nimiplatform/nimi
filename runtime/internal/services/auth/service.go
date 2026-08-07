package auth

import (
	"context"
	"crypto/subtle"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appidentityprojection"
	"github.com/nimiplatform/nimi/runtime/internal/appregistry"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"github.com/nimiplatform/nimi/runtime/internal/protocol/envelope"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type appRegistration struct {
	AppID         string
	AppInstanceID string
	DeviceID      string
	AppVersion    string
	Capabilities  []string
	ModeManifest  *runtimev1.AppModeManifest
	RegisteredAt  time.Time
}

type appSession struct {
	SessionID     string
	AppID         string
	AppInstanceID string
	DeviceID      string
	SubjectUserID string
	IssuedAt      time.Time
	ExpiresAt     time.Time
	SessionToken  string
	Revoked       bool
	Authority     appSessionAuthority
}

type appSessionAuthority string

const appSessionAuthorityBindingOnly appSessionAuthority = "binding_only"

type externalPrincipal struct {
	AppID                 string
	ExternalPrincipalID   string
	ExternalPrincipalType runtimev1.ExternalPrincipalType
	Issuer                string
	ClientID              string
	SignatureKeyID        string
	ProofType             runtimev1.ExternalProofType
}

type externalSession struct {
	ExternalSessionID   string
	AppID               string
	ExternalPrincipalID string
	ExpiresAt           time.Time
	SessionToken        string
	Revoked             bool
}

type Option func(*Service)

type runtimeAccountSecurityContextProvider interface {
	AuthenticatedRuntimeSecurityContext(context.Context) (*runtimev1.AccountProjection, uint64, bool)
}

type LocalAppSessionProjection struct {
	CurrentUser           *runtimev1.CurrentUserDisplayProjection
	CurrentUserReasonCode runtimev1.ReasonCode
}

type localAppSessionOpener interface {
	OpenLocalAppSessionProjection(context.Context) (LocalAppSessionProjection, error)
	RenewLocalAppSessionProjection(context.Context) (LocalAppSessionProjection, error)
}

func WithDesktopSessionManager(manager *protectedlocal.DesktopSessionManager) Option {
	return func(service *Service) {
		service.desktopSessions = manager
	}
}

// Service implements RuntimeAuthService with in-memory session storage.
type Service struct {
	runtimev1.UnimplementedRuntimeAuthServiceServer
	logger            *slog.Logger
	registry          *appregistry.Registry
	nimiAppIdentities *appidentityprojection.Projection
	auditStore        *auditlog.Store
	desktopSessions   *protectedlocal.DesktopSessionManager
	accountSecurity   runtimeAccountSecurityContextProvider
	localAppOpener    localAppSessionOpener

	// TTL bounds (K-AUTHSVC-004).
	ttlMinSeconds int32
	ttlMaxSeconds int32

	mu                 sync.RWMutex
	apps               map[string]appRegistration
	registeredApps     map[string]int
	appSessions        map[string]appSession
	externalPrincipals map[string]externalPrincipal
	externalSessions   map[string]externalSession
}

func New(logger *slog.Logger) *Service {
	return NewWithRegistry(logger, appregistry.New())
}

func NewWithRegistry(logger *slog.Logger, registry *appregistry.Registry) *Service {
	return NewWithDependencies(logger, registry, nil, 60, 86400)
}

// NewWithDependencies creates a Service with audit store and configurable TTL bounds.
func NewWithDependencies(logger *slog.Logger, registry *appregistry.Registry, auditStore *auditlog.Store, ttlMinSeconds int32, ttlMaxSeconds int32, options ...Option) *Service {
	if registry == nil {
		registry = appregistry.New()
	}
	if ttlMinSeconds <= 0 {
		ttlMinSeconds = 60
	}
	if ttlMaxSeconds <= 0 {
		ttlMaxSeconds = 86400
	}
	service := &Service{
		logger:             logger,
		registry:           registry,
		auditStore:         auditStore,
		ttlMinSeconds:      ttlMinSeconds,
		ttlMaxSeconds:      ttlMaxSeconds,
		apps:               make(map[string]appRegistration),
		registeredApps:     make(map[string]int),
		appSessions:        make(map[string]appSession),
		externalPrincipals: make(map[string]externalPrincipal),
		externalSessions:   make(map[string]externalSession),
	}
	for _, option := range options {
		if option != nil {
			option(service)
		}
	}
	return service
}

func (s *Service) SetNimiAppIdentityProjection(projection *appidentityprojection.Projection) {
	s.nimiAppIdentities = projection
}

func (s *Service) SetRuntimeAccountSecurityContextProvider(provider runtimeAccountSecurityContextProvider) {
	s.accountSecurity = provider
}

func (s *Service) SetLocalAppSessionOpener(opener localAppSessionOpener) {
	s.localAppOpener = opener
}

// OpenDesktopSession establishes non-portable Desktop authority from the
// protected connection attached by the native transport. The empty request and
// response projections never participate in authorization.
func (s *Service) OpenDesktopSession(ctx context.Context, _ *runtimev1.OpenDesktopSessionRequest) (*runtimev1.OpenDesktopSessionResponse, error) {
	if s.desktopSessions == nil {
		retryable := false
		return nil, grpcerr.WithReasonCodeOptions(codes.Unavailable, runtimev1.ReasonCode_PROTECTED_LOCAL_LEDGER_UNAVAILABLE, grpcerr.ReasonOptions{
			ActionHint: "restart_runtime_service",
			Retryable:  &retryable,
		})
	}
	projection, err := s.desktopSessions.Open(ctx)
	if err != nil {
		return nil, protectedDesktopSessionError(err)
	}
	if len(projection.DesktopSessionID) != protectedlocal.IdentifierBytes || len(projection.RuntimeBootEpoch) != protectedlocal.IdentifierBytes {
		return nil, grpcerr.WithReasonCodeOptions(codes.Internal, runtimev1.ReasonCode_PROTECTED_LOCAL_LEDGER_UNAVAILABLE, grpcerr.ReasonOptions{
			ActionHint: "restart_runtime_service",
		})
	}
	return &runtimev1.OpenDesktopSessionResponse{
		DesktopSessionId: append([]byte(nil), projection.DesktopSessionID...),
		RuntimeBootEpoch: append([]byte(nil), projection.RuntimeBootEpoch...),
	}, nil
}

func protectedDesktopSessionError(err error) error {
	var failure *protectedlocal.Failure
	if !errors.As(err, &failure) {
		return grpcerr.WrapWithReasonCode(codes.Unavailable, runtimev1.ReasonCode_PROTECTED_LOCAL_LEDGER_UNAVAILABLE, err, grpcerr.ReasonOptions{
			ActionHint: "restart_runtime_service",
			Message:    "protected desktop session could not be opened",
		})
	}
	reasonValue, ok := runtimev1.ReasonCode_value[string(failure.Reason())]
	if !ok {
		return grpcerr.WrapWithReasonCode(codes.Unavailable, runtimev1.ReasonCode_PROTECTED_LOCAL_LEDGER_UNAVAILABLE, err, grpcerr.ReasonOptions{
			ActionHint: "restart_runtime_service",
			Message:    "protected desktop session could not be opened",
		})
	}
	reason := runtimev1.ReasonCode(reasonValue)
	retryable := failure.Retryable()
	return grpcerr.WrapWithReasonCode(protectedDesktopSessionCode(failure.Reason()), reason, err, grpcerr.ReasonOptions{
		ActionHint: failure.ActionHint(),
		Retryable:  &retryable,
		Message:    "protected desktop session could not be opened",
	})
}

func protectedDesktopSessionCode(reason protectedlocal.Reason) codes.Code {
	switch reason {
	case protectedlocal.ReasonDesktopControlTransportRequired,
		protectedlocal.ReasonDesktopExecutableTrustFailed,
		protectedlocal.ReasonProtectedOriginRoleMismatch,
		protectedlocal.ReasonProtectedLocalRuntimePrincipalRequired:
		return codes.PermissionDenied
	case protectedlocal.ReasonDesktopProcessVerificationUnavailable:
		return codes.Unauthenticated
	case protectedlocal.ReasonProtectedLocalBootEpochMismatch:
		return codes.FailedPrecondition
	case protectedlocal.ReasonProtectedLocalLedgerRollbackDetected:
		return codes.DataLoss
	default:
		return codes.Unavailable
	}
}

func (s *Service) pruneExpiredSessionsLocked(now time.Time) {
	for sessionID, session := range s.appSessions {
		if !session.ExpiresAt.IsZero() && !session.ExpiresAt.After(now) {
			delete(s.appSessions, sessionID)
		}
	}
	for sessionID, session := range s.externalSessions {
		if !session.ExpiresAt.IsZero() && !session.ExpiresAt.After(now) {
			delete(s.externalSessions, sessionID)
		}
	}
}

func (s *Service) RegisterApp(ctx context.Context, req *runtimev1.RegisterAppRequest) (*runtimev1.RegisterAppResponse, error) {
	appID := strings.TrimSpace(req.GetAppId())
	if appID == "" {
		s.emitAudit(ctx, "RegisterApp", appID, "", runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		return &runtimev1.RegisterAppResponse{
			Accepted:   false,
			ReasonCode: runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID,
		}, nil
	}
	if reasonCode, _, ok := appregistry.ValidateManifest(req.GetModeManifest()); !ok {
		s.emitAudit(ctx, "RegisterApp", appID, "", reasonCode)
		return &runtimev1.RegisterAppResponse{
			Accepted:   false,
			ReasonCode: reasonCode,
		}, nil
	}
	if reasonCode, eligibilityReason, ok := s.checkNimiAppIdentityEligibility(appID); !ok {
		payload := map[string]any{
			"eligibility_reason": eligibilityReason,
			"identity_app_id":    appID,
		}
		s.emitAuditWithPayload(ctx, "RegisterApp", appID, "", reasonCode, payload)
		return &runtimev1.RegisterAppResponse{
			Accepted:   false,
			ReasonCode: reasonCode,
		}, nil
	}
	instanceID := strings.TrimSpace(req.GetAppInstanceId())
	if instanceID == "" {
		instanceID = ulid.Make().String()
	}

	now := time.Now().UTC()
	capabilities := s.registrationCapabilities(appID, req.GetCapabilities())
	registration := appRegistration{
		AppID:         appID,
		AppInstanceID: instanceID,
		DeviceID:      strings.TrimSpace(req.GetDeviceId()),
		AppVersion:    strings.TrimSpace(req.GetAppVersion()),
		Capabilities:  append([]string(nil), capabilities...),
		ModeManifest:  cloneModeManifest(req.GetModeManifest()),
		RegisteredAt:  now,
	}

	if err := s.registry.UpsertInstance(appID, instanceID, req.GetDeviceId(), req.GetModeManifest(), capabilities); err != nil {
		return nil, grpcerr.WrapWithReasonCode(
			codes.InvalidArgument,
			runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID,
			err,
			grpcerr.ReasonOptions{Message: "app instance registration is invalid"},
		)
	}
	s.mu.Lock()
	s.pruneExpiredSessionsLocked(now)
	appKey := appID + "::" + instanceID
	if _, exists := s.apps[appKey]; !exists {
		s.registeredApps[appID]++
	}
	s.apps[appKey] = registration
	s.mu.Unlock()

	s.emitAudit(ctx, "RegisterApp", appID, "", runtimev1.ReasonCode_ACTION_EXECUTED)
	s.logger.Info("app registered", "app_id", appID, "app_instance_id", instanceID)
	return &runtimev1.RegisterAppResponse{
		AppInstanceId: instanceID,
		Accepted:      true,
		ReasonCode:    runtimev1.ReasonCode_ACTION_EXECUTED,
	}, nil
}

func (s *Service) registrationCapabilities(_ string, _ []string) []string {
	return nil
}

func (s *Service) checkNimiAppIdentityEligibility(appID string) (runtimev1.ReasonCode, string, bool) {
	appID = strings.TrimSpace(appID)
	if isForbiddenNimiSideNamespace(appID) {
		return runtimev1.ReasonCode_APP_AUTHORIZATION_DENIED, "app-id-namespace-forbidden", false
	}
	if !isPlatformGovernedNimiAppID(appID) {
		return runtimev1.ReasonCode_ACTION_EXECUTED, "", true
	}
	if appID == "nimi.desktop" {
		return runtimev1.ReasonCode_ACTION_EXECUTED, "", true
	}
	if s.nimiAppIdentities == nil {
		return runtimev1.ReasonCode_APP_NOT_REGISTERED, "app-identity-projection-missing", false
	}
	if s.nimiAppIdentities.IsLocalFirstParty(appID) {
		return runtimev1.ReasonCode_ACTION_EXECUTED, "", true
	}
	return runtimev1.ReasonCode_APP_NOT_REGISTERED, "app-identity-not-admitted", false
}

func isPlatformGovernedNimiAppID(appID string) bool {
	return strings.HasPrefix(strings.TrimSpace(appID), "nimi.")
}

func isForbiddenNimiSideNamespace(appID string) bool {
	appID = strings.TrimSpace(appID)
	return appID == "app.nimi" ||
		strings.HasPrefix(appID, "app.nimi.") ||
		appID == "dev.nimi" ||
		strings.HasPrefix(appID, "dev.nimi.")
}

func (s *Service) isLocalFirstPartyAppID(appID string) bool {
	appID = strings.TrimSpace(appID)
	return appID == "nimi.desktop" ||
		(s.nimiAppIdentities != nil && s.nimiAppIdentities.IsLocalFirstParty(appID))
}

func (s *Service) OpenSession(ctx context.Context, req *runtimev1.OpenSessionRequest) (*runtimev1.OpenSessionResponse, error) {
	appID := strings.TrimSpace(req.GetAppId())
	instanceID := strings.TrimSpace(req.GetAppInstanceId())
	deviceID := strings.TrimSpace(req.GetDeviceId())
	subjectUserID := strings.TrimSpace(req.GetSubjectUserId())

	if appID == "" || instanceID == "" {
		s.emitAudit(ctx, "OpenSession", appID, subjectUserID, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		return &runtimev1.OpenSessionResponse{ReasonCode: runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID}, nil
	}

	s.mu.RLock()
	registration, exists := s.apps[appID+"::"+instanceID]
	s.mu.RUnlock()
	if !exists {
		s.emitAudit(ctx, "OpenSession", appID, subjectUserID, runtimev1.ReasonCode_APP_NOT_REGISTERED)
		return &runtimev1.OpenSessionResponse{ReasonCode: runtimev1.ReasonCode_APP_NOT_REGISTERED}, nil
	}
	localFirstParty := s.isLocalFirstPartyAppID(appID) &&
		isLocalFirstPartyModeManifest(registration.ModeManifest)
	if localFirstParty && subjectUserID != "" {
		s.emitAuditWithPayload(ctx, "OpenSession", appID, "", runtimev1.ReasonCode_APP_AUTHORIZATION_DENIED, map[string]any{
			"subject_source": "caller_provided",
			"session_mode":   runtimeAccountSessionMode(registration),
		})
		return &runtimev1.OpenSessionResponse{ReasonCode: runtimev1.ReasonCode_APP_AUTHORIZATION_DENIED}, nil
	}
	now := time.Now().UTC()
	ttl, err := s.resolveTTL(req.GetTtlSeconds(), 3600)
	if err != nil {
		s.emitAudit(ctx, "OpenSession", appID, subjectUserID, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		return nil, err
	}
	expiresAt := now.Add(ttl)
	sessionID := ulid.Make().String()
	sessionToken, err := newSessionToken()
	if err != nil {
		s.emitAudit(ctx, "OpenSession", appID, subjectUserID, runtimev1.ReasonCode_AUTH_TOKEN_INVALID)
		return nil, grpcerr.WrapWithReasonCode(
			codes.Internal,
			runtimev1.ReasonCode_AUTH_TOKEN_INVALID,
			err,
			grpcerr.ReasonOptions{Message: "session token could not be generated"},
		)
	}

	s.mu.Lock()
	s.pruneExpiredSessionsLocked(now)
	s.appSessions[sessionID] = appSession{
		SessionID:     sessionID,
		AppID:         appID,
		AppInstanceID: instanceID,
		DeviceID:      deviceID,
		SubjectUserID: "",
		IssuedAt:      now,
		ExpiresAt:     expiresAt,
		SessionToken:  sessionToken,
		Revoked:       false,
		Authority:     appSessionAuthorityBindingOnly,
	}
	s.mu.Unlock()

	s.emitAuditWithPayload(ctx, "OpenSession", appID, "", runtimev1.ReasonCode_ACTION_EXECUTED, map[string]any{
		"session_id":             sessionID,
		"session_mode":           runtimeAccountSessionMode(registration),
		"caller_subject_ignored": subjectUserID != "",
	})
	return &runtimev1.OpenSessionResponse{
		SessionId:    sessionID,
		IssuedAt:     timestamppb.New(now),
		ExpiresAt:    timestamppb.New(expiresAt),
		SessionToken: sessionToken,
		ReasonCode:   runtimev1.ReasonCode_ACTION_EXECUTED,
	}, nil
}

func runtimeAccountSessionMode(appRegistration) string {
	return string(appSessionAuthorityBindingOnly)
}

func isLocalFirstPartyModeManifest(manifest *runtimev1.AppModeManifest) bool {
	return manifest.GetAppMode() == runtimev1.AppMode_APP_MODE_FULL &&
		manifest.GetRuntimeRequired() &&
		manifest.GetRealmRequired()
}

func (s *Service) RefreshSession(ctx context.Context, req *runtimev1.RefreshSessionRequest) (*runtimev1.RefreshSessionResponse, error) {
	sessionID := strings.TrimSpace(req.GetSessionId())
	if sessionID == "" {
		s.emitAudit(ctx, "RefreshSession", "", "", runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		return &runtimev1.RefreshSessionResponse{ReasonCode: runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID}, nil
	}
	contextSessionID, contextSessionToken, err := envelope.ParseSessionFromContext(ctx)
	if err != nil || strings.TrimSpace(contextSessionID) != sessionID {
		s.emitAudit(ctx, "RefreshSession", "", "", runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
		return nil, grpcerr.WithReasonCode(codes.Unauthenticated, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}

	ttl, err := s.resolveTTL(req.GetTtlSeconds(), 3600)
	if err != nil {
		s.emitAudit(ctx, "RefreshSession", "", "", runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		return nil, err
	}

	s.mu.Lock()
	session, exists := s.appSessions[sessionID]
	if !exists {
		s.pruneExpiredSessionsLocked(time.Now().UTC())
		s.mu.Unlock()
		s.emitAudit(ctx, "RefreshSession", "", "", runtimev1.ReasonCode_APP_TOKEN_REVOKED)
		return &runtimev1.RefreshSessionResponse{ReasonCode: runtimev1.ReasonCode_APP_TOKEN_REVOKED}, nil
	}
	if session.Revoked {
		s.mu.Unlock()
		s.emitAudit(ctx, "RefreshSession", session.AppID, session.SubjectUserID, runtimev1.ReasonCode_APP_TOKEN_REVOKED)
		return &runtimev1.RefreshSessionResponse{ReasonCode: runtimev1.ReasonCode_APP_TOKEN_REVOKED}, nil
	}
	if subtle.ConstantTimeCompare([]byte(session.SessionToken), []byte(strings.TrimSpace(contextSessionToken))) != 1 {
		s.mu.Unlock()
		s.emitAudit(ctx, "RefreshSession", session.AppID, session.SubjectUserID, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
		return nil, grpcerr.WithReasonCode(codes.Unauthenticated, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}

	now := time.Now().UTC()
	if now.After(session.ExpiresAt) {
		delete(s.appSessions, sessionID)
		s.pruneExpiredSessionsLocked(now)
		s.mu.Unlock()
		s.emitAudit(ctx, "RefreshSession", session.AppID, session.SubjectUserID, runtimev1.ReasonCode_SESSION_EXPIRED)
		return &runtimev1.RefreshSessionResponse{ReasonCode: runtimev1.ReasonCode_SESSION_EXPIRED}, nil
	}

	expiresAt := now.Add(ttl)
	session.ExpiresAt = expiresAt
	sessionToken, err := newSessionToken()
	if err != nil {
		s.mu.Unlock()
		s.emitAudit(ctx, "RefreshSession", session.AppID, session.SubjectUserID, runtimev1.ReasonCode_AUTH_TOKEN_INVALID)
		return nil, grpcerr.WrapWithReasonCode(
			codes.Internal,
			runtimev1.ReasonCode_AUTH_TOKEN_INVALID,
			err,
			grpcerr.ReasonOptions{Message: "session token could not be generated"},
		)
	}
	session.SessionToken = sessionToken
	s.pruneExpiredSessionsLocked(now)
	s.appSessions[sessionID] = session
	s.mu.Unlock()

	s.emitAuditWithPayload(ctx, "RefreshSession", session.AppID, session.SubjectUserID, runtimev1.ReasonCode_ACTION_EXECUTED, map[string]any{
		"session_id": sessionID,
	})
	return &runtimev1.RefreshSessionResponse{
		SessionId:    session.SessionID,
		ExpiresAt:    timestamppb.New(expiresAt),
		SessionToken: session.SessionToken,
		ReasonCode:   runtimev1.ReasonCode_ACTION_EXECUTED,
	}, nil
}

func (s *Service) RevokeSession(ctx context.Context, req *runtimev1.RevokeSessionRequest) (*runtimev1.Ack, error) {
	sessionID := strings.TrimSpace(req.GetSessionId())
	if sessionID == "" {
		s.emitAudit(ctx, "RevokeSession", "", "", runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		return &runtimev1.Ack{Ok: false, ReasonCode: runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, ActionHint: "set session_id"}, nil
	}

	s.mu.Lock()
	session, exists := s.appSessions[sessionID]
	if exists {
		delete(s.appSessions, sessionID)
	}
	s.pruneExpiredSessionsLocked(time.Now().UTC())
	s.mu.Unlock()

	auditAppID := ""
	auditSubjectUserID := ""
	if exists {
		auditAppID = session.AppID
		auditSubjectUserID = session.SubjectUserID
	}
	s.emitAuditWithPayload(ctx, "RevokeSession", auditAppID, auditSubjectUserID, runtimev1.ReasonCode_ACTION_EXECUTED, map[string]any{
		"session_id": sessionID,
	})
	return &runtimev1.Ack{Ok: true, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func (s *Service) RegisterExternalPrincipal(ctx context.Context, req *runtimev1.RegisterExternalPrincipalRequest) (*runtimev1.RegisterExternalPrincipalResponse, error) {
	appID := strings.TrimSpace(req.GetAppId())
	externalID := strings.TrimSpace(req.GetExternalPrincipalId())
	if appID == "" || externalID == "" {
		s.emitAudit(ctx, "RegisterExternalPrincipal", appID, "", runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		return &runtimev1.RegisterExternalPrincipalResponse{Accepted: false, ReasonCode: runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID}, nil
	}
	if req.GetProofType() != runtimev1.ExternalProofType_EXTERNAL_PROOF_TYPE_JWT {
		s.emitAudit(ctx, "RegisterExternalPrincipal", appID, "", runtimev1.ReasonCode_AUTH_UNSUPPORTED_PROOF_TYPE)
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AUTH_UNSUPPORTED_PROOF_TYPE)
	}
	signatureKeyID := strings.TrimSpace(req.GetSignatureKeyId())
	if signatureKeyID == "" {
		s.emitAudit(ctx, "RegisterExternalPrincipal", appID, "", runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if strings.TrimSpace(req.GetIssuer()) == "" {
		s.emitAudit(ctx, "RegisterExternalPrincipal", appID, "", runtimev1.ReasonCode_AUTH_TOKEN_INVALID)
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AUTH_TOKEN_INVALID)
	}
	if err := validateJWTSignatureKey(signatureKeyID); err != nil {
		s.emitAudit(ctx, "RegisterExternalPrincipal", appID, "", runtimev1.ReasonCode_AUTH_TOKEN_INVALID)
		return nil, grpcerr.WrapWithReasonCode(
			codes.InvalidArgument,
			runtimev1.ReasonCode_AUTH_TOKEN_INVALID,
			err,
			grpcerr.ReasonOptions{Message: "external principal signature key is invalid"},
		)
	}

	principal := externalPrincipal{
		AppID:                 appID,
		ExternalPrincipalID:   externalID,
		ExternalPrincipalType: req.GetExternalPrincipalType(),
		Issuer:                strings.TrimSpace(req.GetIssuer()),
		ClientID:              strings.TrimSpace(req.GetClientId()),
		SignatureKeyID:        signatureKeyID,
		ProofType:             req.GetProofType(),
	}

	s.mu.Lock()
	s.pruneExpiredSessionsLocked(time.Now().UTC())
	s.externalPrincipals[principalKey(appID, externalID)] = principal
	s.mu.Unlock()

	s.emitAuditWithPayload(ctx, "RegisterExternalPrincipal", appID, "", runtimev1.ReasonCode_ACTION_EXECUTED, map[string]any{
		"external_principal_id": externalID,
		"proof_type":            req.GetProofType().String(),
	})
	return &runtimev1.RegisterExternalPrincipalResponse{Accepted: true, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func (s *Service) OpenExternalPrincipalSession(ctx context.Context, req *runtimev1.OpenExternalPrincipalSessionRequest) (*runtimev1.OpenExternalPrincipalSessionResponse, error) {
	appID := strings.TrimSpace(req.GetAppId())
	externalID := strings.TrimSpace(req.GetExternalPrincipalId())
	proof := strings.TrimSpace(req.GetProof())

	if appID == "" || externalID == "" {
		s.emitAudit(ctx, "OpenExternalPrincipalSession", appID, "", runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		return &runtimev1.OpenExternalPrincipalSessionResponse{ReasonCode: runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID}, nil
	}
	if proof == "" {
		s.emitAudit(ctx, "OpenExternalPrincipalSession", appID, "", runtimev1.ReasonCode_EXTERNAL_PRINCIPAL_PROOF_MISSING)
		return &runtimev1.OpenExternalPrincipalSessionResponse{ReasonCode: runtimev1.ReasonCode_EXTERNAL_PRINCIPAL_PROOF_MISSING}, nil
	}

	s.mu.RLock()
	principal, exists := s.externalPrincipals[principalKey(appID, externalID)]
	s.mu.RUnlock()
	if !exists {
		s.emitAudit(ctx, "OpenExternalPrincipalSession", appID, "", runtimev1.ReasonCode_EXTERNAL_PRINCIPAL_NOT_REGISTERED)
		return &runtimev1.OpenExternalPrincipalSessionResponse{ReasonCode: runtimev1.ReasonCode_EXTERNAL_PRINCIPAL_NOT_REGISTERED}, nil
	}

	// Validate proof against registered principal (K-AUTHSVC-013).
	if err := validateExternalProof(proof, principal); err != nil {
		switch {
		case errors.Is(err, ErrUnsupportedProofType):
			s.emitAudit(ctx, "OpenExternalPrincipalSession", appID, "", runtimev1.ReasonCode_AUTH_UNSUPPORTED_PROOF_TYPE)
			return nil, grpcerr.WrapWithReasonCode(
				codes.InvalidArgument,
				runtimev1.ReasonCode_AUTH_UNSUPPORTED_PROOF_TYPE,
				err,
				grpcerr.ReasonOptions{Message: "external principal proof type is unsupported"},
			)
		case errors.Is(err, ErrTokenExpired):
			s.emitAudit(ctx, "OpenExternalPrincipalSession", appID, "", runtimev1.ReasonCode_AUTH_TOKEN_EXPIRED)
			return nil, grpcerr.WrapWithReasonCode(
				codes.Unauthenticated,
				runtimev1.ReasonCode_AUTH_TOKEN_EXPIRED,
				err,
				grpcerr.ReasonOptions{Message: "external principal proof has expired"},
			)
		default:
			s.emitAudit(ctx, "OpenExternalPrincipalSession", appID, "", runtimev1.ReasonCode_AUTH_TOKEN_INVALID)
			return nil, grpcerr.WrapWithReasonCode(
				codes.Unauthenticated,
				runtimev1.ReasonCode_AUTH_TOKEN_INVALID,
				err,
				grpcerr.ReasonOptions{Message: "external principal proof is invalid"},
			)
		}
	}

	now := time.Now().UTC()
	ttl, err := s.resolveTTL(req.GetTtlSeconds(), 3600)
	if err != nil {
		s.emitAudit(ctx, "OpenExternalPrincipalSession", appID, "", runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		return nil, err
	}
	expiresAt := now.Add(ttl)
	externalSessionID := ulid.Make().String()
	sessionToken, err := newSessionToken()
	if err != nil {
		s.emitAudit(ctx, "OpenExternalPrincipalSession", appID, "", runtimev1.ReasonCode_AUTH_TOKEN_INVALID)
		return nil, grpcerr.WrapWithReasonCode(
			codes.Internal,
			runtimev1.ReasonCode_AUTH_TOKEN_INVALID,
			err,
			grpcerr.ReasonOptions{Message: "session token could not be generated"},
		)
	}

	s.mu.Lock()
	s.pruneExpiredSessionsLocked(now)
	s.externalSessions[externalSessionID] = externalSession{
		ExternalSessionID:   externalSessionID,
		AppID:               appID,
		ExternalPrincipalID: externalID,
		ExpiresAt:           expiresAt,
		SessionToken:        sessionToken,
		Revoked:             false,
	}
	s.mu.Unlock()

	s.emitAuditWithPayload(ctx, "OpenExternalPrincipalSession", appID, "", runtimev1.ReasonCode_ACTION_EXECUTED, map[string]any{
		"external_principal_id": externalID,
		"external_session_id":   externalSessionID,
	})
	return &runtimev1.OpenExternalPrincipalSessionResponse{
		ExternalSessionId: externalSessionID,
		ExpiresAt:         timestamppb.New(expiresAt),
		SessionToken:      sessionToken,
		ReasonCode:        runtimev1.ReasonCode_ACTION_EXECUTED,
	}, nil
}

func (s *Service) RevokeExternalPrincipalSession(ctx context.Context, req *runtimev1.RevokeExternalPrincipalSessionRequest) (*runtimev1.Ack, error) {
	externalSessionID := strings.TrimSpace(req.GetExternalSessionId())
	if externalSessionID == "" {
		s.emitAudit(ctx, "RevokeExternalPrincipalSession", "", "", runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		return &runtimev1.Ack{Ok: false, ReasonCode: runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, ActionHint: "set external_session_id"}, nil
	}

	s.mu.Lock()
	session, exists := s.externalSessions[externalSessionID]
	if exists {
		delete(s.externalSessions, externalSessionID)
	}
	s.pruneExpiredSessionsLocked(time.Now().UTC())
	s.mu.Unlock()

	auditAppID := ""
	payload := map[string]any{
		"external_session_id": externalSessionID,
	}
	if exists {
		auditAppID = session.AppID
		payload["external_principal_id"] = session.ExternalPrincipalID
	}
	s.emitAuditWithPayload(ctx, "RevokeExternalPrincipalSession", auditAppID, "", runtimev1.ReasonCode_ACTION_EXECUTED, payload)
	return &runtimev1.Ack{Ok: true, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

// resolveTTL validates and resolves TTL with bounds enforcement (K-AUTHSVC-004).
func (s *Service) resolveTTL(rawSeconds int32, fallbackSeconds int32) (time.Duration, error) {
	if rawSeconds == 0 {
		return time.Duration(fallbackSeconds) * time.Second, nil
	}
	if rawSeconds < s.ttlMinSeconds || rawSeconds > s.ttlMaxSeconds {
		return 0, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, grpcerr.ReasonOptions{
			ActionHint: "set_ttl_seconds_within_allowed_range",
		})
	}
	return time.Duration(rawSeconds) * time.Second, nil
}

func principalKey(appID string, externalID string) string {
	return appID + "::" + externalID
}

func cloneModeManifest(input *runtimev1.AppModeManifest) *runtimev1.AppModeManifest {
	if input == nil {
		return nil
	}
	return &runtimev1.AppModeManifest{
		AppMode:         input.GetAppMode(),
		RuntimeRequired: input.GetRuntimeRequired(),
		RealmRequired:   input.GetRealmRequired(),
		WorldRelation:   input.GetWorldRelation(),
	}
}
