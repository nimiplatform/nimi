package auth

import (
	"context"
	"log/slog"
	"strings"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appregistry"
	"github.com/oklog/ulid/v2"
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
}

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

// Service implements RuntimeAuthService with in-memory session storage.
type Service struct {
	runtimev1.UnimplementedRuntimeAuthServiceServer
	logger   *slog.Logger
	registry *appregistry.Registry

	mu                 sync.RWMutex
	apps               map[string]appRegistration
	appSessions        map[string]appSession
	externalPrincipals map[string]externalPrincipal
	externalSessions   map[string]externalSession
}

func New(logger *slog.Logger) *Service {
	return NewWithRegistry(logger, appregistry.New())
}

func NewWithRegistry(logger *slog.Logger, registry *appregistry.Registry) *Service {
	if registry == nil {
		registry = appregistry.New()
	}
	return &Service{
		logger:             logger,
		registry:           registry,
		apps:               make(map[string]appRegistration),
		appSessions:        make(map[string]appSession),
		externalPrincipals: make(map[string]externalPrincipal),
		externalSessions:   make(map[string]externalSession),
	}
}

func (s *Service) RegisterApp(_ context.Context, req *runtimev1.RegisterAppRequest) (*runtimev1.RegisterAppResponse, error) {
	appID := strings.TrimSpace(req.GetAppId())
	if appID == "" {
		return &runtimev1.RegisterAppResponse{
			Accepted:   false,
			ReasonCode: runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID,
		}, nil
	}
	if reasonCode, _, ok := appregistry.ValidateManifest(req.GetModeManifest()); !ok {
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
	registration := appRegistration{
		AppID:         appID,
		AppInstanceID: instanceID,
		DeviceID:      strings.TrimSpace(req.GetDeviceId()),
		AppVersion:    strings.TrimSpace(req.GetAppVersion()),
		Capabilities:  append([]string(nil), req.GetCapabilities()...),
		ModeManifest:  cloneModeManifest(req.GetModeManifest()),
		RegisteredAt:  now,
	}

	s.mu.Lock()
	s.apps[appID+"::"+instanceID] = registration
	s.mu.Unlock()
	s.registry.Upsert(appID, req.GetModeManifest(), req.GetCapabilities())

	s.logger.Info("app registered", "app_id", appID, "app_instance_id", instanceID)
	return &runtimev1.RegisterAppResponse{
		AppInstanceId: instanceID,
		Accepted:      true,
		ReasonCode:    runtimev1.ReasonCode_ACTION_EXECUTED,
	}, nil
}

func (s *Service) OpenSession(_ context.Context, req *runtimev1.OpenSessionRequest) (*runtimev1.OpenSessionResponse, error) {
	appID := strings.TrimSpace(req.GetAppId())
	instanceID := strings.TrimSpace(req.GetAppInstanceId())
	deviceID := strings.TrimSpace(req.GetDeviceId())
	subjectUserID := strings.TrimSpace(req.GetSubjectUserId())

	if appID == "" || instanceID == "" || subjectUserID == "" {
		return &runtimev1.OpenSessionResponse{ReasonCode: runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID}, nil
	}

	s.mu.RLock()
	_, exists := s.apps[appID+"::"+instanceID]
	s.mu.RUnlock()
	if !exists {
		return &runtimev1.OpenSessionResponse{ReasonCode: runtimev1.ReasonCode_APP_NOT_REGISTERED}, nil
	}

	now := time.Now().UTC()
	expiresAt := now.Add(resolveTTL(req.GetTtlSeconds(), 3600))
	sessionID := ulid.Make().String()
	sessionToken := ulid.Make().String()

	s.mu.Lock()
	s.appSessions[sessionID] = appSession{
		SessionID:     sessionID,
		AppID:         appID,
		AppInstanceID: instanceID,
		DeviceID:      deviceID,
		SubjectUserID: subjectUserID,
		IssuedAt:      now,
		ExpiresAt:     expiresAt,
		SessionToken:  sessionToken,
		Revoked:       false,
	}
	s.mu.Unlock()

	return &runtimev1.OpenSessionResponse{
		SessionId:    sessionID,
		IssuedAt:     timestamppb.New(now),
		ExpiresAt:    timestamppb.New(expiresAt),
		SessionToken: sessionToken,
		ReasonCode:   runtimev1.ReasonCode_ACTION_EXECUTED,
	}, nil
}

func (s *Service) RefreshSession(_ context.Context, req *runtimev1.RefreshSessionRequest) (*runtimev1.RefreshSessionResponse, error) {
	sessionID := strings.TrimSpace(req.GetSessionId())
	if sessionID == "" {
		return &runtimev1.RefreshSessionResponse{ReasonCode: runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID}, nil
	}

	s.mu.Lock()
	session, exists := s.appSessions[sessionID]
	if !exists || session.Revoked {
		s.mu.Unlock()
		return &runtimev1.RefreshSessionResponse{ReasonCode: runtimev1.ReasonCode_APP_TOKEN_REVOKED}, nil
	}

	now := time.Now().UTC()
	if now.After(session.ExpiresAt) {
		session.Revoked = true
		s.appSessions[sessionID] = session
		s.mu.Unlock()
		return &runtimev1.RefreshSessionResponse{ReasonCode: runtimev1.ReasonCode_SESSION_EXPIRED}, nil
	}

	expiresAt := now.Add(resolveTTL(req.GetTtlSeconds(), 3600))
	session.ExpiresAt = expiresAt
	session.SessionToken = ulid.Make().String()
	s.appSessions[sessionID] = session
	s.mu.Unlock()

	return &runtimev1.RefreshSessionResponse{
		SessionId:    session.SessionID,
		ExpiresAt:    timestamppb.New(expiresAt),
		SessionToken: session.SessionToken,
		ReasonCode:   runtimev1.ReasonCode_ACTION_EXECUTED,
	}, nil
}

func (s *Service) RevokeSession(_ context.Context, req *runtimev1.RevokeSessionRequest) (*runtimev1.Ack, error) {
	sessionID := strings.TrimSpace(req.GetSessionId())
	if sessionID == "" {
		return &runtimev1.Ack{Ok: false, ReasonCode: runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, ActionHint: "set session_id"}, nil
	}

	s.mu.Lock()
	session, exists := s.appSessions[sessionID]
	if exists {
		session.Revoked = true
		s.appSessions[sessionID] = session
	}
	s.mu.Unlock()

	return &runtimev1.Ack{Ok: true, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func (s *Service) RegisterExternalPrincipal(_ context.Context, req *runtimev1.RegisterExternalPrincipalRequest) (*runtimev1.RegisterExternalPrincipalResponse, error) {
	appID := strings.TrimSpace(req.GetAppId())
	externalID := strings.TrimSpace(req.GetExternalPrincipalId())
	if appID == "" || externalID == "" {
		return &runtimev1.RegisterExternalPrincipalResponse{Accepted: false, ReasonCode: runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID}, nil
	}

	principal := externalPrincipal{
		AppID:                 appID,
		ExternalPrincipalID:   externalID,
		ExternalPrincipalType: req.GetExternalPrincipalType(),
		Issuer:                strings.TrimSpace(req.GetIssuer()),
		ClientID:              strings.TrimSpace(req.GetClientId()),
		SignatureKeyID:        strings.TrimSpace(req.GetSignatureKeyId()),
		ProofType:             req.GetProofType(),
	}

	s.mu.Lock()
	s.externalPrincipals[principalKey(appID, externalID)] = principal
	s.mu.Unlock()

	return &runtimev1.RegisterExternalPrincipalResponse{Accepted: true, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func (s *Service) OpenExternalPrincipalSession(_ context.Context, req *runtimev1.OpenExternalPrincipalSessionRequest) (*runtimev1.OpenExternalPrincipalSessionResponse, error) {
	appID := strings.TrimSpace(req.GetAppId())
	externalID := strings.TrimSpace(req.GetExternalPrincipalId())
	proof := strings.TrimSpace(req.GetProof())

	if appID == "" || externalID == "" {
		return &runtimev1.OpenExternalPrincipalSessionResponse{ReasonCode: runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID}, nil
	}
	if proof == "" {
		return &runtimev1.OpenExternalPrincipalSessionResponse{ReasonCode: runtimev1.ReasonCode_EXTERNAL_PRINCIPAL_PROOF_MISSING}, nil
	}

	s.mu.RLock()
	_, exists := s.externalPrincipals[principalKey(appID, externalID)]
	s.mu.RUnlock()
	if !exists {
		return &runtimev1.OpenExternalPrincipalSessionResponse{ReasonCode: runtimev1.ReasonCode_EXTERNAL_PRINCIPAL_NOT_REGISTERED}, nil
	}

	externalSessionID := ulid.Make().String()
	now := time.Now().UTC()
	expiresAt := now.Add(resolveTTL(req.GetTtlSeconds(), 3600))
	sessionToken := ulid.Make().String()

	s.mu.Lock()
	s.externalSessions[externalSessionID] = externalSession{
		ExternalSessionID:   externalSessionID,
		AppID:               appID,
		ExternalPrincipalID: externalID,
		ExpiresAt:           expiresAt,
		SessionToken:        sessionToken,
		Revoked:             false,
	}
	s.mu.Unlock()

	return &runtimev1.OpenExternalPrincipalSessionResponse{
		ExternalSessionId: externalSessionID,
		ExpiresAt:         timestamppb.New(expiresAt),
		SessionToken:      sessionToken,
		ReasonCode:        runtimev1.ReasonCode_ACTION_EXECUTED,
	}, nil
}

func (s *Service) RevokeExternalPrincipalSession(_ context.Context, req *runtimev1.RevokeExternalPrincipalSessionRequest) (*runtimev1.Ack, error) {
	externalSessionID := strings.TrimSpace(req.GetExternalSessionId())
	if externalSessionID == "" {
		return &runtimev1.Ack{Ok: false, ReasonCode: runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, ActionHint: "set external_session_id"}, nil
	}

	s.mu.Lock()
	session, exists := s.externalSessions[externalSessionID]
	if exists {
		session.Revoked = true
		s.externalSessions[externalSessionID] = session
	}
	s.mu.Unlock()

	return &runtimev1.Ack{Ok: true, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func resolveTTL(rawSeconds int32, fallbackSeconds int32) time.Duration {
	if rawSeconds <= 0 {
		return time.Duration(fallbackSeconds) * time.Second
	}
	return time.Duration(rawSeconds) * time.Second
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
