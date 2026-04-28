package account

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appregistry"
	"github.com/oklog/ulid/v2"
	"google.golang.org/protobuf/types/known/timestamppb"
)

var (
	ErrCustodyUnavailable   = errors.New("account custody unavailable")
	ErrNoStoredAccount      = errors.New("account custody has no stored account")
	ErrInertNotActivated    = errors.New("runtime account substrate is inert")
	ErrLoginExchangeFailure = errors.New("account login exchange unavailable")
)

type AccountMaterial struct {
	AccountID          string
	DisplayName        string
	RealmEnvironmentID string
	AccessToken        string
	AccessTokenExpires time.Time
	RefreshToken       string
	RefreshTokenHashes map[string]bool
}

type LoginAttempt struct {
	LoginAttemptID string
	State          string
	Nonce          string
	PKCEVerifier   string
	PKCEChallenge  string
	RedirectURI    string
	CallbackOrigin string
	ExpiresAt      time.Time
}

type Custody interface {
	Load(ctx context.Context, partition string) (AccountMaterial, error)
	Store(ctx context.Context, partition string, material AccountMaterial) error
	Clear(ctx context.Context, partition string) error
}

type LoginExchanger interface {
	Exchange(ctx context.Context, attempt LoginAttempt, code string) (AccountMaterial, error)
}

type BrowserCallbackTokenAdopter interface {
	AdoptBrowserCallbackTokens(ctx context.Context, attempt LoginAttempt, accessToken string, refreshToken string) (AccountMaterial, error)
}

type Refresher interface {
	Refresh(ctx context.Context, material AccountMaterial) (AccountMaterial, error)
}

type LoginAuthorizationURLProvider interface {
	AuthorizationURL(attempt LoginAttempt) string
}

type Option func(*Service)

type unavailableCustody struct{}

func (unavailableCustody) Load(context.Context, string) (AccountMaterial, error) {
	return AccountMaterial{}, ErrCustodyUnavailable
}

func (unavailableCustody) Store(context.Context, string, AccountMaterial) error {
	return ErrCustodyUnavailable
}

func (unavailableCustody) Clear(context.Context, string) error {
	return ErrCustodyUnavailable
}

type inertExchanger struct{}

func (inertExchanger) Exchange(context.Context, LoginAttempt, string) (AccountMaterial, error) {
	return AccountMaterial{}, ErrInertNotActivated
}

type inertRefresher struct{}

func (inertRefresher) Refresh(context.Context, AccountMaterial) (AccountMaterial, error) {
	return AccountMaterial{}, ErrInertNotActivated
}

type loginAttemptRecord struct {
	attempt  LoginAttempt
	consumed bool
}

type bindingRecord struct {
	relation *runtimev1.ScopedAppBindingRelation
	carrier  string
}

type subscriber struct {
	id uint64
	ch chan *runtimev1.AccountSessionEvent
}

type Service struct {
	runtimev1.UnimplementedRuntimeAccountServiceServer

	logger *slog.Logger
	now    func() time.Time

	custody   Custody
	exchanger LoginExchanger
	refresher Refresher
	registry  *appregistry.Registry

	partition                string
	productionActivated      bool
	nonProductionHarnessMode bool
	eventRetention           int

	mu               sync.RWMutex
	state            runtimev1.AccountSessionState
	projection       *runtimev1.AccountProjection
	material         AccountMaterial
	loginAttempts    map[string]loginAttemptRecord
	bindings         map[string]bindingRecord
	nextSequence     uint64
	events           []*runtimev1.AccountSessionEvent
	nextSubscriberID uint64
	subscribers      map[uint64]subscriber
}

func New(logger *slog.Logger, opts ...Option) *Service {
	if logger == nil {
		logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	}
	s := &Service{
		logger:         logger,
		now:            time.Now,
		custody:        unavailableCustody{},
		exchanger:      inertExchanger{},
		refresher:      inertRefresher{},
		registry:       appregistry.New(),
		partition:      "runtime-account:default-device",
		eventRetention: 128,
		state:          runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_UNAVAILABLE,
		loginAttempts:  make(map[string]loginAttemptRecord),
		bindings:       make(map[string]bindingRecord),
		subscribers:    make(map[uint64]subscriber),
	}
	for _, opt := range opts {
		if opt != nil {
			opt(s)
		}
	}
	s.recoverFromCustody(context.Background())
	return s
}

func WithClock(now func() time.Time) Option {
	return func(s *Service) {
		if now != nil {
			s.now = now
		}
	}
}

func WithCustody(custody Custody) Option {
	return func(s *Service) {
		if custody != nil {
			s.custody = custody
		}
	}
}

func WithLoginExchanger(exchanger LoginExchanger) Option {
	return func(s *Service) {
		if exchanger != nil {
			s.exchanger = exchanger
		}
	}
}

func WithRefresher(refresher Refresher) Option {
	return func(s *Service) {
		if refresher != nil {
			s.refresher = refresher
		}
	}
}

func WithAppRegistry(registry *appregistry.Registry) Option {
	return func(s *Service) {
		if registry != nil {
			s.registry = registry
		}
	}
}

func WithCustodyPartition(partition string) Option {
	return func(s *Service) {
		if trimmed := strings.TrimSpace(partition); trimmed != "" {
			s.partition = trimmed
		}
	}
}

func WithEventRetention(retention int) Option {
	return func(s *Service) {
		if retention > 0 {
			s.eventRetention = retention
		}
	}
}

func WithNonProductionHarnessMode() Option {
	return func(s *Service) {
		s.nonProductionHarnessMode = true
	}
}

func WithProductionActivation() Option {
	return func(s *Service) {
		s.productionActivated = true
	}
}

func (s *Service) isActivated() bool {
	return s.productionActivated || s.nonProductionHarnessMode
}

func (s *Service) GetAccountSessionStatus(ctx context.Context, req *runtimev1.GetAccountSessionStatusRequest) (*runtimev1.GetAccountSessionStatusResponse, error) {
	if !s.isActivated() {
		return &runtimev1.GetAccountSessionStatusResponse{
			State:             runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_UNAVAILABLE,
			ReasonCode:        runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED,
			AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_INERT_NOT_ACTIVATED,
			ProductionInert:   true,
		}, nil
	}
	if reason, ok := s.validateRuntimeAdmittedCaller(req.GetCaller(), false); !ok {
		return &runtimev1.GetAccountSessionStatusResponse{
			State:             s.currentState(),
			ReasonCode:        runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED,
			AccountReasonCode: reason,
		}, nil
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return &runtimev1.GetAccountSessionStatusResponse{
		State:             s.state,
		AccountProjection: cloneProjection(s.projection),
		ReasonCode:        runtimev1.ReasonCode_ACTION_EXECUTED,
		AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED,
	}, nil
}

func (s *Service) SubscribeAccountSessionEvents(req *runtimev1.SubscribeAccountSessionEventsRequest, stream runtimev1.RuntimeAccountService_SubscribeAccountSessionEventsServer) error {
	if !s.isActivated() {
		return stream.Send(s.rejectedAccountSessionEvent(runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_INERT_NOT_ACTIVATED))
	}
	if reason, ok := s.validateRuntimeAdmittedCaller(req.GetCaller(), false); !ok {
		return stream.Send(s.rejectedAccountSessionEvent(reason))
	}
	snapshot, replay, sub := s.subscribe(req)
	if err := stream.Send(snapshot); err != nil {
		s.removeSubscriber(sub.id)
		return err
	}
	for _, event := range replay {
		if err := stream.Send(event); err != nil {
			s.removeSubscriber(sub.id)
			return err
		}
	}
	defer s.removeSubscriber(sub.id)
	for {
		select {
		case <-stream.Context().Done():
			return stream.Context().Err()
		case event := <-sub.ch:
			if err := stream.Send(event); err != nil {
				return err
			}
		}
	}
}

func (s *Service) BeginLogin(ctx context.Context, req *runtimev1.BeginLoginRequest) (*runtimev1.BeginLoginResponse, error) {
	if !s.isActivated() {
		return &runtimev1.BeginLoginResponse{
			Accepted:          false,
			ReasonCode:        runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED,
			AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_INERT_NOT_ACTIVATED,
			ProductionInert:   true,
		}, nil
	}
	if reason, ok := s.validateRuntimeAdmittedCaller(req.GetCaller(), false); !ok {
		return &runtimev1.BeginLoginResponse{ReasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, AccountReasonCode: reason}, nil
	}
	now := s.now().UTC()
	ttl := time.Duration(req.GetTtlSeconds()) * time.Second
	if ttl <= 0 {
		ttl = 10 * time.Minute
	}
	s.mu.RLock()
	if s.state == runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_LOGIN_PENDING {
		for _, record := range s.loginAttempts {
			if !record.consumed && record.attempt.ExpiresAt.After(now) {
				authorizationURL := fmt.Sprintf("https://auth.nimi.invalid/oauth/authorize?state=%s&challenge=%s", record.attempt.State, record.attempt.PKCEChallenge)
				if provider, ok := s.exchanger.(LoginAuthorizationURLProvider); ok {
					if resolved := provider.AuthorizationURL(record.attempt); resolved != "" {
						authorizationURL = resolved
					}
				}
				s.mu.RUnlock()
				return &runtimev1.BeginLoginResponse{
					Accepted:              true,
					LoginAttemptId:        record.attempt.LoginAttemptID,
					OauthAuthorizationUrl: authorizationURL,
					CallbackOrigin:        record.attempt.CallbackOrigin,
					State:                 record.attempt.State,
					Nonce:                 record.attempt.Nonce,
					PkceChallenge:         record.attempt.PKCEChallenge,
					ExpiresAt:             timestamppb.New(record.attempt.ExpiresAt),
					ReasonCode:            runtimev1.ReasonCode_ACTION_EXECUTED,
					AccountReasonCode:     runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED,
				}, nil
			}
		}
	}
	if s.state == runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED ||
		s.state == runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REFRESH_PENDING ||
		s.state == runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_SWITCHING ||
		s.state == runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_LOGGING_OUT {
		s.mu.RUnlock()
		return &runtimev1.BeginLoginResponse{
			Accepted:          false,
			ReasonCode:        runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED,
			AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE,
		}, nil
	}
	s.mu.RUnlock()
	attempt := LoginAttempt{
		LoginAttemptID: ulid.Make().String(),
		State:          randomToken(),
		Nonce:          randomToken(),
		PKCEVerifier:   randomToken(),
		RedirectURI:    strings.TrimSpace(req.GetRedirectUri()),
		CallbackOrigin: strings.TrimSpace(req.GetCallbackOrigin()),
		ExpiresAt:      now.Add(ttl),
	}
	attempt.PKCEChallenge = pkceChallenge(attempt.PKCEVerifier)
	authorizationURL := fmt.Sprintf("https://auth.nimi.invalid/oauth/authorize?state=%s&challenge=%s", attempt.State, attempt.PKCEChallenge)
	if provider, ok := s.exchanger.(LoginAuthorizationURLProvider); ok {
		if resolved := provider.AuthorizationURL(attempt); resolved != "" {
			authorizationURL = resolved
		}
	}

	s.mu.Lock()
	s.loginAttempts[attempt.LoginAttemptID] = loginAttemptRecord{attempt: attempt}
	s.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_LOGIN_PENDING
	event := s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_LOGIN_STARTED, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, "")
	statusEvent := s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, "")
	s.mu.Unlock()
	s.publish(event)
	s.publish(statusEvent)

	return &runtimev1.BeginLoginResponse{
		Accepted:              true,
		LoginAttemptId:        attempt.LoginAttemptID,
		OauthAuthorizationUrl: authorizationURL,
		CallbackOrigin:        attempt.CallbackOrigin,
		State:                 attempt.State,
		Nonce:                 attempt.Nonce,
		PkceChallenge:         attempt.PKCEChallenge,
		ExpiresAt:             timestamppb.New(attempt.ExpiresAt),
		ReasonCode:            runtimev1.ReasonCode_ACTION_EXECUTED,
		AccountReasonCode:     runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED,
	}, nil
}

func (s *Service) CompleteLogin(ctx context.Context, req *runtimev1.CompleteLoginRequest) (*runtimev1.CompleteLoginResponse, error) {
	if !s.isActivated() {
		return &runtimev1.CompleteLoginResponse{
			Accepted:          false,
			State:             runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_UNAVAILABLE,
			ReasonCode:        runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED,
			AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_INERT_NOT_ACTIVATED,
			ProductionInert:   true,
		}, nil
	}
	if strings.TrimSpace(req.GetSealedCompletionTicket()) != "" {
		return &runtimev1.CompleteLoginResponse{
			Accepted:          false,
			State:             s.currentState(),
			ReasonCode:        runtimev1.ReasonCode_AUTH_UNSUPPORTED_PROOF_TYPE,
			AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_PROOF_UNSUPPORTED,
		}, nil
	}
	attemptID := strings.TrimSpace(req.GetLoginAttemptId())
	code := strings.TrimSpace(req.GetCode())
	if attemptID == "" || code == "" {
		return &runtimev1.CompleteLoginResponse{State: s.currentState(), ReasonCode: runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_PROOF_MISMATCHED}, nil
	}

	s.mu.Lock()
	record, exists := s.loginAttempts[attemptID]
	if !exists {
		s.mu.Unlock()
		return &runtimev1.CompleteLoginResponse{State: s.currentState(), ReasonCode: runtimev1.ReasonCode_AUTH_TOKEN_INVALID, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_PROOF_MISMATCHED}, nil
	}
	if record.consumed {
		s.mu.Unlock()
		return &runtimev1.CompleteLoginResponse{State: s.currentState(), ReasonCode: runtimev1.ReasonCode_AUTH_TOKEN_INVALID, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_PROOF_CONSUMED}, nil
	}
	if !record.attempt.ExpiresAt.After(s.now().UTC()) {
		delete(s.loginAttempts, attemptID)
		s.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_ANONYMOUS
		event := s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_LOGIN_TIMED_OUT, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_PROOF_EXPIRED, "")
		statusEvent := s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_PROOF_EXPIRED, "")
		s.mu.Unlock()
		s.publish(event)
		s.publish(statusEvent)
		return &runtimev1.CompleteLoginResponse{State: runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_ANONYMOUS, ReasonCode: runtimev1.ReasonCode_AUTH_TOKEN_EXPIRED, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_PROOF_EXPIRED}, nil
	}
	if record.attempt.State != strings.TrimSpace(req.GetState()) || record.attempt.Nonce != strings.TrimSpace(req.GetNonce()) {
		s.mu.Unlock()
		return &runtimev1.CompleteLoginResponse{State: s.currentState(), ReasonCode: runtimev1.ReasonCode_AUTH_TOKEN_INVALID, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_PROOF_MISMATCHED}, nil
	}
	record.consumed = true
	s.loginAttempts[attemptID] = record
	s.mu.Unlock()

	var material AccountMaterial
	var err error
	refreshToken := strings.TrimSpace(req.GetRefreshToken())
	if refreshToken != "" {
		adopter, ok := s.exchanger.(BrowserCallbackTokenAdopter)
		if !ok {
			err = ErrLoginExchangeFailure
		} else {
			material, err = adopter.AdoptBrowserCallbackTokens(ctx, record.attempt, code, refreshToken)
		}
	} else {
		material, err = s.exchanger.Exchange(ctx, record.attempt, code)
	}
	if err != nil {
		reason := runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_LOGIN_EXCHANGE_UNAVAILABLE
		if errors.Is(err, ErrInertNotActivated) {
			reason = runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_INERT_NOT_ACTIVATED
		}
		s.transitionToReauthRequired(reason)
		return &runtimev1.CompleteLoginResponse{Accepted: false, State: s.currentState(), ReasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, AccountReasonCode: reason}, nil
	}
	normalized := normalizeMaterial(material)
	if normalized.AccountID == "" || normalized.RefreshToken == "" || normalized.AccessToken == "" {
		s.transitionToReauthRequired(runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_LOGIN_EXCHANGE_UNAVAILABLE)
		return &runtimev1.CompleteLoginResponse{Accepted: false, State: s.currentState(), ReasonCode: runtimev1.ReasonCode_AUTH_TOKEN_INVALID, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_LOGIN_EXCHANGE_UNAVAILABLE}, nil
	}
	if err := s.custody.Store(ctx, s.partition, normalized); err != nil {
		s.markCustodyUnavailable()
		return &runtimev1.CompleteLoginResponse{Accepted: false, State: runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_UNAVAILABLE, ReasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CUSTODY_UNAVAILABLE}, nil
	}

	s.mu.Lock()
	s.material = normalized
	s.projection = projectionFromMaterial(normalized)
	s.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED
	loginEvent := s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_LOGIN_COMPLETED, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, "")
	statusEvent := s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, "")
	projection := cloneProjection(s.projection)
	s.mu.Unlock()
	s.publish(loginEvent)
	s.publish(statusEvent)

	return &runtimev1.CompleteLoginResponse{
		Accepted:          true,
		State:             runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED,
		AccountProjection: projection,
		ReasonCode:        runtimev1.ReasonCode_ACTION_EXECUTED,
		AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED,
	}, nil
}

func (s *Service) GetAccessToken(ctx context.Context, req *runtimev1.GetAccessTokenRequest) (*runtimev1.GetAccessTokenResponse, error) {
	if !s.isActivated() {
		return &runtimev1.GetAccessTokenResponse{Accepted: false, ReasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_INERT_NOT_ACTIVATED, ProductionInert: true}, nil
	}
	if reason, ok := s.validateRuntimeAdmittedCaller(req.GetCaller(), true); !ok {
		return &runtimev1.GetAccessTokenResponse{Accepted: false, ReasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, AccountReasonCode: reason}, nil
	}
	s.mu.RLock()
	if (s.state != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED && s.state != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_EXPIRED) || s.material.RefreshToken == "" {
		s.mu.RUnlock()
		return &runtimev1.GetAccessTokenResponse{Accepted: false, ReasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE}, nil
	}
	needsRefresh := s.state == runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_EXPIRED || !s.material.AccessTokenExpires.IsZero() && !s.material.AccessTokenExpires.After(s.now().UTC().Add(30*time.Second))
	s.mu.RUnlock()
	if needsRefresh {
		refresh, err := s.RefreshAccountSession(ctx, &runtimev1.RefreshAccountSessionRequest{Caller: req.GetCaller()})
		if err != nil {
			return nil, err
		}
		if !refresh.GetAccepted() {
			return &runtimev1.GetAccessTokenResponse{Accepted: false, ReasonCode: refresh.GetReasonCode(), AccountReasonCode: refresh.GetAccountReasonCode()}, nil
		}
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.state != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED || s.material.AccessToken == "" {
		return &runtimev1.GetAccessTokenResponse{Accepted: false, ReasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE}, nil
	}
	return &runtimev1.GetAccessTokenResponse{
		Accepted:          true,
		AccessToken:       s.material.AccessToken,
		ExpiresAt:         timestamppb.New(s.material.AccessTokenExpires),
		ReasonCode:        runtimev1.ReasonCode_ACTION_EXECUTED,
		AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED,
	}, nil
}

func (s *Service) RefreshAccountSession(ctx context.Context, req *runtimev1.RefreshAccountSessionRequest) (*runtimev1.RefreshAccountSessionResponse, error) {
	if !s.isActivated() {
		return &runtimev1.RefreshAccountSessionResponse{Accepted: false, State: runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_UNAVAILABLE, ReasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_INERT_NOT_ACTIVATED, ProductionInert: true}, nil
	}
	if reason, ok := s.validateRuntimeAdmittedCaller(req.GetCaller(), false); !ok {
		return &runtimev1.RefreshAccountSessionResponse{Accepted: false, State: s.currentState(), ReasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, AccountReasonCode: reason}, nil
	}
	s.mu.Lock()
	if s.state != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED && s.state != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_EXPIRED {
		state := s.state
		s.mu.Unlock()
		return &runtimev1.RefreshAccountSessionResponse{Accepted: false, State: state, ReasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE}, nil
	}
	current := s.material
	s.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REFRESH_PENDING
	startEvent := s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_REFRESH_STARTED, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, "")
	s.mu.Unlock()
	s.publish(startEvent)

	next, err := s.refresher.Refresh(ctx, current)
	if err != nil {
		s.transitionToReauthRequired(runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_LOGIN_EXCHANGE_UNAVAILABLE)
		return &runtimev1.RefreshAccountSessionResponse{Accepted: false, State: s.currentState(), ReasonCode: runtimev1.ReasonCode_AUTH_TOKEN_INVALID, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_LOGIN_EXCHANGE_UNAVAILABLE}, nil
	}
	next = normalizeMaterial(next)
	next.RefreshTokenHashes = copyRefreshHashes(current.RefreshTokenHashes)
	next.RefreshTokenHashes[refreshHash(current.RefreshToken)] = true
	if next.RefreshToken == "" || next.AccessToken == "" || next.AccountID != current.AccountID {
		s.transitionToReauthRequired(runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_LOGIN_EXCHANGE_UNAVAILABLE)
		return &runtimev1.RefreshAccountSessionResponse{Accepted: false, State: s.currentState(), ReasonCode: runtimev1.ReasonCode_AUTH_TOKEN_INVALID, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_LOGIN_EXCHANGE_UNAVAILABLE}, nil
	}
	if err := s.custody.Store(ctx, s.partition, next); err != nil {
		s.markCustodyUnavailable()
		return &runtimev1.RefreshAccountSessionResponse{Accepted: false, State: runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_UNAVAILABLE, ReasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CUSTODY_UNAVAILABLE}, nil
	}
	s.mu.Lock()
	s.material = next
	s.projection = projectionFromMaterial(next)
	s.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED
	refreshEvent := s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_REFRESH_COMPLETED, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, "")
	statusEvent := s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, "")
	projection := cloneProjection(s.projection)
	s.mu.Unlock()
	s.publish(refreshEvent)
	s.publish(statusEvent)
	return &runtimev1.RefreshAccountSessionResponse{Accepted: true, State: runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED, AccountProjection: projection, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED}, nil
}

func (s *Service) Logout(ctx context.Context, req *runtimev1.LogoutRequest) (*runtimev1.LogoutResponse, error) {
	if !s.isActivated() {
		return &runtimev1.LogoutResponse{Accepted: false, State: runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_UNAVAILABLE, ReasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_INERT_NOT_ACTIVATED, ProductionInert: true}, nil
	}
	if reason, ok := s.validateRuntimeAdmittedCaller(req.GetCaller(), false); !ok {
		return &runtimev1.LogoutResponse{Accepted: false, State: s.currentState(), ReasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, AccountReasonCode: reason}, nil
	}
	return s.logout(ctx, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED)
}

func (s *Service) SwitchAccount(ctx context.Context, req *runtimev1.SwitchAccountRequest) (*runtimev1.SwitchAccountResponse, error) {
	if !s.isActivated() {
		return &runtimev1.SwitchAccountResponse{Accepted: false, State: runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_UNAVAILABLE, ReasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_INERT_NOT_ACTIVATED, ProductionInert: true}, nil
	}
	if reason, ok := s.validateRuntimeAdmittedCaller(req.GetCaller(), false); !ok {
		return &runtimev1.SwitchAccountResponse{Accepted: false, State: s.currentState(), ReasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, AccountReasonCode: reason}, nil
	}
	s.mu.Lock()
	if s.state != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED {
		state := s.state
		s.mu.Unlock()
		return &runtimev1.SwitchAccountResponse{Accepted: false, State: state, ReasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE}, nil
	}
	s.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_SWITCHING
	switchStart := s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_SWITCH_STARTED, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, "")
	revoked := s.revokeBindingsLocked(runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED)
	s.material = AccountMaterial{}
	s.projection = nil
	s.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_ANONYMOUS
	switchDone := s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_SWITCH_COMPLETED, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, "")
	statusEvent := s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, "")
	state := s.state
	s.mu.Unlock()
	_ = s.custody.Clear(ctx, s.partition)
	s.publish(switchStart)
	for _, event := range revoked {
		s.publish(event)
	}
	s.publish(switchDone)
	s.publish(statusEvent)
	return &runtimev1.SwitchAccountResponse{Accepted: true, State: state, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED}, nil
}

func (s *Service) IssueScopedAppBinding(ctx context.Context, req *runtimev1.IssueScopedAppBindingRequest) (*runtimev1.IssueScopedAppBindingResponse, error) {
	if !s.isActivated() {
		return &runtimev1.IssueScopedAppBindingResponse{Accepted: false, ReasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_INERT_NOT_ACTIVATED, ProductionInert: true}, nil
	}
	if reason, ok := s.validateRuntimeAdmittedCaller(req.GetCaller(), false); !ok {
		return &runtimev1.IssueScopedAppBindingResponse{Accepted: false, ReasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, AccountReasonCode: reason}, nil
	}
	relation := cloneRelation(req.GetRelation())
	if relation == nil || strings.TrimSpace(relation.GetRuntimeAppId()) == "" || strings.TrimSpace(relation.GetAgentId()) == "" {
		return &runtimev1.IssueScopedAppBindingResponse{Accepted: false, ReasonCode: runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_STALE}, nil
	}
	if reason, ok := validateBindingCallerRelation(req.GetCaller(), relation); !ok {
		return &runtimev1.IssueScopedAppBindingResponse{Accepted: false, ReasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, AccountReasonCode: reason}, nil
	}
	s.mu.Lock()
	if s.state != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED {
		stateEvent := s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE, "")
		s.mu.Unlock()
		s.publish(stateEvent)
		return &runtimev1.IssueScopedAppBindingResponse{Accepted: false, ReasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE}, nil
	}
	now := s.now().UTC()
	ttl := time.Duration(req.GetTtlSeconds()) * time.Second
	if ttl <= 0 {
		ttl = time.Hour
	}
	bindingID := ulid.Make().String()
	relation.BindingId = bindingID
	relation.IssuedAt = timestamppb.New(now)
	relation.ExpiresAt = timestamppb.New(now.Add(ttl))
	relation.State = runtimev1.ScopedAppBindingState_SCOPED_APP_BINDING_STATE_ISSUED
	relation.ReasonCode = runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED
	issued := s.appendBindingEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_BINDING_ISSUED, relation)
	relation.State = runtimev1.ScopedAppBindingState_SCOPED_APP_BINDING_STATE_ACTIVE
	activated := s.appendBindingEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_BINDING_ACTIVATED, relation)
	carrier := "binding:" + bindingID
	s.bindings[bindingID] = bindingRecord{relation: cloneRelation(relation), carrier: carrier}
	s.mu.Unlock()
	s.publish(issued)
	s.publish(activated)

	return &runtimev1.IssueScopedAppBindingResponse{
		Accepted:          true,
		BindingId:         bindingID,
		BindingCarrier:    carrier,
		Relation:          cloneRelation(relation),
		ReasonCode:        runtimev1.ReasonCode_ACTION_EXECUTED,
		AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED,
	}, nil
}

func (s *Service) RevokeScopedAppBinding(ctx context.Context, req *runtimev1.RevokeScopedAppBindingRequest) (*runtimev1.RevokeScopedAppBindingResponse, error) {
	if !s.isActivated() {
		return &runtimev1.RevokeScopedAppBindingResponse{Accepted: false, ReasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_INERT_NOT_ACTIVATED, ProductionInert: true}, nil
	}
	if reason, ok := s.validateRuntimeAdmittedCaller(req.GetCaller(), false); !ok {
		return &runtimev1.RevokeScopedAppBindingResponse{Accepted: false, ReasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, AccountReasonCode: reason}, nil
	}
	bindingID := strings.TrimSpace(req.GetBindingId())
	s.mu.Lock()
	record, exists := s.bindings[bindingID]
	if !exists {
		s.mu.Unlock()
		return &runtimev1.RevokeScopedAppBindingResponse{Accepted: false, ReasonCode: runtimev1.ReasonCode_APP_GRANT_INVALID, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_NOT_FOUND}, nil
	}
	if reason, ok := validateBindingCallerRelation(req.GetCaller(), record.relation); !ok {
		s.mu.Unlock()
		return &runtimev1.RevokeScopedAppBindingResponse{Accepted: false, ReasonCode: commonReason(reason), AccountReasonCode: reason}, nil
	}
	reason := req.GetReasonCode()
	if reason == runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_UNSPECIFIED {
		reason = runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED
	}
	record.relation.State = runtimev1.ScopedAppBindingState_SCOPED_APP_BINDING_STATE_REVOKED
	record.relation.ReasonCode = reason
	s.bindings[bindingID] = record
	event := s.appendBindingEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_BINDING_REVOKED, record.relation)
	s.mu.Unlock()
	s.publish(event)
	return &runtimev1.RevokeScopedAppBindingResponse{Accepted: true, Relation: cloneRelation(record.relation), ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED, AccountReasonCode: reason}, nil
}

func (s *Service) ValidateScopedBinding(bindingID string, actual *runtimev1.ScopedAppBindingRelation, requiredScope string) (runtimev1.AccountReasonCode, bool) {
	trimmed := strings.TrimSpace(bindingID)
	s.mu.Lock()
	defer s.mu.Unlock()
	record, exists := s.bindings[trimmed]
	if !exists {
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_NOT_FOUND, false
	}
	if record.relation.GetState() != runtimev1.ScopedAppBindingState_SCOPED_APP_BINDING_STATE_ACTIVE {
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_STALE, false
	}
	if s.state != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED {
		record.relation.State = runtimev1.ScopedAppBindingState_SCOPED_APP_BINDING_STATE_REVOKED
		record.relation.ReasonCode = bindingRevocationReasonForAccountState(s.state)
		s.bindings[trimmed] = record
		event := s.appendBindingEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_BINDING_REVOKED, record.relation)
		go s.publish(event)
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE, false
	}
	now := s.now().UTC()
	if expires := record.relation.GetExpiresAt().AsTime(); !expires.IsZero() && !expires.After(now) {
		record.relation.State = runtimev1.ScopedAppBindingState_SCOPED_APP_BINDING_STATE_EXPIRED
		record.relation.ReasonCode = runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_STALE
		s.bindings[trimmed] = record
		event := s.appendBindingEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_BINDING_EXPIRED, record.relation)
		go s.publish(event)
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_STALE, false
	}
	if relationReplay(record.relation, actual) {
		record.relation.State = runtimev1.ScopedAppBindingState_SCOPED_APP_BINDING_STATE_REVOKED
		record.relation.ReasonCode = runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_REPLAY
		s.bindings[trimmed] = record
		event := s.appendBindingEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_BINDING_REPLAY_DETECTED, record.relation)
		go s.publish(event)
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_REPLAY, false
	}
	if requiredScope != "" && !scopeIncluded(record.relation.GetScopes(), requiredScope) {
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_STALE, false
	}
	return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, true
}

func (s *Service) ObserveRefreshToken(ctx context.Context, token string) (runtimev1.AccountReasonCode, bool) {
	hash := refreshHash(token)
	s.mu.Lock()
	if s.material.RefreshTokenHashes[hash] {
		s.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REAUTH_REQUIRED
		revoked := s.revokeBindingsLocked(runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_REUSE_DETECTED)
		s.material = AccountMaterial{}
		s.projection = nil
		event := s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_REFRESH_FAILED, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_REUSE_DETECTED, "")
		statusEvent := s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_REUSE_DETECTED, "")
		s.mu.Unlock()
		for _, revokeEvent := range revoked {
			go s.publish(revokeEvent)
		}
		go s.publish(event)
		go s.publish(statusEvent)
		_ = s.custody.Clear(ctx, s.partition)
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_REUSE_DETECTED, false
	}
	s.mu.Unlock()
	return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, true
}

func (s *Service) recoverFromCustody(ctx context.Context) {
	material, err := s.custody.Load(ctx, s.partition)
	s.mu.Lock()
	defer s.mu.Unlock()
	if err != nil {
		if errors.Is(err, ErrNoStoredAccount) {
			s.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_ANONYMOUS
			s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE, "")
			return
		}
		s.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_UNAVAILABLE
		s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_CUSTODY_UNAVAILABLE, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CUSTODY_UNAVAILABLE, "")
		s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CUSTODY_UNAVAILABLE, "")
		return
	}
	material = normalizeMaterial(material)
	if material.AccountID == "" || material.RefreshToken == "" || material.AccessToken == "" {
		s.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REAUTH_REQUIRED
		s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE, "")
		return
	}
	if !material.AccessTokenExpires.IsZero() && !material.AccessTokenExpires.After(s.now().UTC()) {
		s.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_EXPIRED
		s.material = material
		s.projection = projectionFromMaterial(material)
		s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE, "")
		return
	}
	s.material = material
	s.projection = projectionFromMaterial(material)
	s.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED
	s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_CUSTODY_RECOVERED, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, "")
	s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, "")
}

func (s *Service) logout(ctx context.Context, reason runtimev1.AccountReasonCode) (*runtimev1.LogoutResponse, error) {
	s.mu.Lock()
	if s.state == runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_ANONYMOUS {
		s.mu.Unlock()
		return &runtimev1.LogoutResponse{Accepted: true, State: runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_ANONYMOUS, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED}, nil
	}
	s.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_LOGGING_OUT
	start := s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_LOGOUT_STARTED, reason, "")
	revoked := s.revokeBindingsLocked(runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED)
	s.material = AccountMaterial{}
	s.projection = nil
	s.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_ANONYMOUS
	done := s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_LOGOUT_COMPLETED, reason, "")
	statusEvent := s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS, reason, "")
	s.mu.Unlock()
	_ = s.custody.Clear(ctx, s.partition)
	s.publish(start)
	for _, event := range revoked {
		s.publish(event)
	}
	s.publish(done)
	s.publish(statusEvent)
	return &runtimev1.LogoutResponse{Accepted: true, State: runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_ANONYMOUS, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED, AccountReasonCode: reason}, nil
}

func (s *Service) subscribe(req *runtimev1.SubscribeAccountSessionEventsRequest) (*runtimev1.AccountSessionEvent, []*runtimev1.AccountSessionEvent, subscriber) {
	s.mu.Lock()
	defer s.mu.Unlock()
	after := req.GetAfterSequence()
	replayTruncated := false
	var replay []*runtimev1.AccountSessionEvent
	if after > 0 && len(s.events) > 0 && s.events[0].GetSequence() > after+1 {
		replayTruncated = true
	} else {
		for _, event := range s.events {
			if event.GetSequence() > after {
				replay = append(replay, cloneEvent(event))
			}
		}
	}
	snapshot := s.newEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, "", nil)
	snapshot.ReplayTruncated = replayTruncated
	s.nextSubscriberID++
	sub := subscriber{id: s.nextSubscriberID, ch: make(chan *runtimev1.AccountSessionEvent, 16)}
	s.subscribers[sub.id] = sub
	return snapshot, replay, sub
}

func (s *Service) removeSubscriber(id uint64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.subscribers, id)
}

func (s *Service) appendEventLocked(eventType runtimev1.AccountEventType, reason runtimev1.AccountReasonCode, bindingID string) *runtimev1.AccountSessionEvent {
	return s.appendStoredEventLocked(s.newEventLocked(eventType, reason, bindingID, nil))
}

func (s *Service) appendBindingEventLocked(eventType runtimev1.AccountEventType, relation *runtimev1.ScopedAppBindingRelation) *runtimev1.AccountSessionEvent {
	return s.appendStoredEventLocked(s.newEventLocked(eventType, relation.GetReasonCode(), relation.GetBindingId(), relation))
}

func (s *Service) appendStoredEventLocked(event *runtimev1.AccountSessionEvent) *runtimev1.AccountSessionEvent {
	s.events = append(s.events, event)
	if len(s.events) > s.eventRetention {
		s.events = append([]*runtimev1.AccountSessionEvent(nil), s.events[len(s.events)-s.eventRetention:]...)
	}
	return cloneEvent(event)
}

func (s *Service) newEventLocked(eventType runtimev1.AccountEventType, reason runtimev1.AccountReasonCode, bindingID string, relation *runtimev1.ScopedAppBindingRelation) *runtimev1.AccountSessionEvent {
	s.nextSequence++
	return &runtimev1.AccountSessionEvent{
		EventId:           ulid.Make().String(),
		Sequence:          s.nextSequence,
		EmittedAt:         timestamppb.New(s.now().UTC()),
		EventType:         eventType,
		State:             s.state,
		ReasonCode:        commonReason(reason),
		AccountReasonCode: reason,
		AccountProjection: cloneProjection(s.projection),
		BindingId:         bindingID,
		BindingRelation:   cloneRelation(relation),
		ReplayTruncated:   false,
	}
}

func (s *Service) publish(event *runtimev1.AccountSessionEvent) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, sub := range s.subscribers {
		select {
		case sub.ch <- cloneEvent(event):
		default:
		}
	}
}

func (s *Service) revokeBindingsLocked(reason runtimev1.AccountReasonCode) []*runtimev1.AccountSessionEvent {
	var events []*runtimev1.AccountSessionEvent
	for id, record := range s.bindings {
		if record.relation.GetState() != runtimev1.ScopedAppBindingState_SCOPED_APP_BINDING_STATE_ACTIVE &&
			record.relation.GetState() != runtimev1.ScopedAppBindingState_SCOPED_APP_BINDING_STATE_ISSUED {
			continue
		}
		record.relation.State = runtimev1.ScopedAppBindingState_SCOPED_APP_BINDING_STATE_REVOKED
		record.relation.ReasonCode = reason
		s.bindings[id] = record
		events = append(events, s.appendBindingEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_BINDING_REVOKED, record.relation))
	}
	return events
}

func (s *Service) markCustodyUnavailable() {
	s.mu.Lock()
	s.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_UNAVAILABLE
	revoked := s.revokeBindingsLocked(runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CUSTODY_UNAVAILABLE)
	s.material = AccountMaterial{}
	s.projection = nil
	custodyEvent := s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_CUSTODY_UNAVAILABLE, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CUSTODY_UNAVAILABLE, "")
	statusEvent := s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CUSTODY_UNAVAILABLE, "")
	s.mu.Unlock()
	for _, event := range revoked {
		s.publish(event)
	}
	s.publish(custodyEvent)
	s.publish(statusEvent)
}

func (s *Service) transitionToReauthRequired(reason runtimev1.AccountReasonCode) {
	s.mu.Lock()
	s.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REAUTH_REQUIRED
	revoked := s.revokeBindingsLocked(reason)
	s.material = AccountMaterial{}
	s.projection = nil
	refreshEvent := s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_REFRESH_FAILED, reason, "")
	statusEvent := s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS, reason, "")
	s.mu.Unlock()
	for _, event := range revoked {
		s.publish(event)
	}
	s.publish(refreshEvent)
	s.publish(statusEvent)
}

func (s *Service) currentState() runtimev1.AccountSessionState {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.state
}

func (s *Service) rejectedAccountSessionEvent(reason runtimev1.AccountReasonCode) *runtimev1.AccountSessionEvent {
	return &runtimev1.AccountSessionEvent{
		EventId:           ulid.Make().String(),
		EmittedAt:         timestamppb.New(s.now().UTC()),
		EventType:         runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS,
		State:             s.currentState(),
		ReasonCode:        commonReason(reason),
		AccountReasonCode: reason,
	}
}

func validateProductionCaller(caller *runtimev1.AccountCaller, tokenRequest bool) (runtimev1.AccountReasonCode, bool) {
	switch caller.GetMode() {
	case runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_LOCAL_FIRST_PARTY_APP,
		runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_DESKTOP_SHELL:
		if strings.TrimSpace(caller.GetAppId()) == "" || strings.TrimSpace(caller.GetAppInstanceId()) == "" {
			return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED, false
		}
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, true
	case runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_DESKTOP_LAUNCHED_AVATAR:
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_AVATAR_BINDING_ONLY, false
	case runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_MOD:
		if tokenRequest {
			return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_MOD_TOKEN_FORBIDDEN, false
		}
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED, false
	default:
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED, false
	}
}

func (s *Service) validateRuntimeAdmittedCaller(caller *runtimev1.AccountCaller, tokenRequest bool) (runtimev1.AccountReasonCode, bool) {
	reason, ok := validateProductionCaller(caller, tokenRequest)
	if !ok {
		return reason, false
	}
	if caller.GetMode() != runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_LOCAL_FIRST_PARTY_APP &&
		caller.GetMode() != runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_DESKTOP_SHELL {
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED, false
	}
	if s.registry == nil || !s.registry.AdmitLocalFirstPartyInstance(caller.GetAppId(), caller.GetAppInstanceId()) {
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED, false
	}
	return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, true
}

func validateBindingCallerRelation(caller *runtimev1.AccountCaller, relation *runtimev1.ScopedAppBindingRelation) (runtimev1.AccountReasonCode, bool) {
	if caller == nil || relation == nil {
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED, false
	}
	if strings.TrimSpace(caller.GetAppId()) != strings.TrimSpace(relation.GetRuntimeAppId()) {
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED, false
	}
	if strings.TrimSpace(caller.GetAppInstanceId()) != strings.TrimSpace(relation.GetAppInstanceId()) {
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED, false
	}
	if relation.GetPurpose() == runtimev1.ScopedAppBindingPurpose_SCOPED_APP_BINDING_PURPOSE_AVATAR_INTERACTION_CONSUME {
		if strings.TrimSpace(relation.GetAvatarInstanceId()) == "" ||
			strings.TrimSpace(relation.GetConversationAnchorId()) == "" ||
			strings.TrimSpace(relation.GetWindowId()) == "" {
			return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_STALE, false
		}
	}
	return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, true
}

func bindingRevocationReasonForAccountState(state runtimev1.AccountSessionState) runtimev1.AccountReasonCode {
	switch state {
	case runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_UNAVAILABLE:
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CUSTODY_UNAVAILABLE
	case runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REAUTH_REQUIRED:
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_LOGIN_EXCHANGE_UNAVAILABLE
	default:
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE
	}
}

func normalizeMaterial(material AccountMaterial) AccountMaterial {
	material.AccountID = strings.TrimSpace(material.AccountID)
	material.DisplayName = strings.TrimSpace(material.DisplayName)
	material.RealmEnvironmentID = strings.TrimSpace(material.RealmEnvironmentID)
	material.AccessToken = strings.TrimSpace(material.AccessToken)
	material.RefreshToken = strings.TrimSpace(material.RefreshToken)
	if material.AccessTokenExpires.IsZero() {
		material.AccessTokenExpires = time.Now().UTC().Add(5 * time.Minute)
	}
	material.RefreshTokenHashes = copyRefreshHashes(material.RefreshTokenHashes)
	return material
}

func projectionFromMaterial(material AccountMaterial) *runtimev1.AccountProjection {
	return &runtimev1.AccountProjection{
		AccountId:          material.AccountID,
		DisplayName:        material.DisplayName,
		RealmEnvironmentId: material.RealmEnvironmentID,
	}
}

func cloneProjection(in *runtimev1.AccountProjection) *runtimev1.AccountProjection {
	if in == nil {
		return nil
	}
	return &runtimev1.AccountProjection{
		AccountId:          in.GetAccountId(),
		DisplayName:        in.GetDisplayName(),
		RealmEnvironmentId: in.GetRealmEnvironmentId(),
	}
}

func cloneRelation(in *runtimev1.ScopedAppBindingRelation) *runtimev1.ScopedAppBindingRelation {
	if in == nil {
		return nil
	}
	return &runtimev1.ScopedAppBindingRelation{
		BindingId:            in.GetBindingId(),
		RuntimeAppId:         in.GetRuntimeAppId(),
		AppInstanceId:        in.GetAppInstanceId(),
		WindowId:             in.GetWindowId(),
		AvatarInstanceId:     in.GetAvatarInstanceId(),
		AgentId:              in.GetAgentId(),
		ConversationAnchorId: in.GetConversationAnchorId(),
		WorldId:              in.GetWorldId(),
		Purpose:              in.GetPurpose(),
		Scopes:               append([]string(nil), in.GetScopes()...),
		IssuedAt:             in.GetIssuedAt(),
		ExpiresAt:            in.GetExpiresAt(),
		State:                in.GetState(),
		ReasonCode:           in.GetReasonCode(),
	}
}

func cloneEvent(in *runtimev1.AccountSessionEvent) *runtimev1.AccountSessionEvent {
	if in == nil {
		return nil
	}
	return &runtimev1.AccountSessionEvent{
		EventId:           in.GetEventId(),
		Sequence:          in.GetSequence(),
		EmittedAt:         in.GetEmittedAt(),
		EventType:         in.GetEventType(),
		State:             in.GetState(),
		ReasonCode:        in.GetReasonCode(),
		AccountReasonCode: in.GetAccountReasonCode(),
		AccountProjection: cloneProjection(in.GetAccountProjection()),
		BindingId:         in.GetBindingId(),
		BindingRelation:   cloneRelation(in.GetBindingRelation()),
		ReplayTruncated:   in.GetReplayTruncated(),
	}
}

func copyRefreshHashes(in map[string]bool) map[string]bool {
	out := make(map[string]bool)
	for key, value := range in {
		out[key] = value
	}
	return out
}

func refreshHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func pkceChallenge(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func randomToken() string {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return ulid.Make().String()
	}
	return base64.RawURLEncoding.EncodeToString(buf)
}

func commonReason(reason runtimev1.AccountReasonCode) runtimev1.ReasonCode {
	switch reason {
	case runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED:
		return runtimev1.ReasonCode_ACTION_EXECUTED
	case runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_PROOF_EXPIRED:
		return runtimev1.ReasonCode_AUTH_TOKEN_EXPIRED
	case runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_PROOF_MISMATCHED,
		runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_PROOF_CONSUMED,
		runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_LOGIN_EXCHANGE_UNAVAILABLE:
		return runtimev1.ReasonCode_AUTH_TOKEN_INVALID
	case runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_NOT_FOUND,
		runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_STALE,
		runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_REPLAY:
		return runtimev1.ReasonCode_APP_GRANT_INVALID
	default:
		return runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED
	}
}

func relationReplay(expected *runtimev1.ScopedAppBindingRelation, actual *runtimev1.ScopedAppBindingRelation) bool {
	if expected == nil || actual == nil {
		return true
	}
	return strings.TrimSpace(expected.GetRuntimeAppId()) != strings.TrimSpace(actual.GetRuntimeAppId()) ||
		strings.TrimSpace(expected.GetAppInstanceId()) != strings.TrimSpace(actual.GetAppInstanceId()) ||
		strings.TrimSpace(expected.GetWindowId()) != strings.TrimSpace(actual.GetWindowId()) ||
		strings.TrimSpace(expected.GetAvatarInstanceId()) != strings.TrimSpace(actual.GetAvatarInstanceId()) ||
		strings.TrimSpace(expected.GetAgentId()) != strings.TrimSpace(actual.GetAgentId()) ||
		strings.TrimSpace(expected.GetConversationAnchorId()) != strings.TrimSpace(actual.GetConversationAnchorId()) ||
		strings.TrimSpace(expected.GetWorldId()) != strings.TrimSpace(actual.GetWorldId())
}

func scopeIncluded(scopes []string, required string) bool {
	for _, scope := range scopes {
		if strings.TrimSpace(scope) == required {
			return true
		}
	}
	return false
}

func (s *Service) mustEmbedUnimplementedRuntimeAccountServiceServer() {}
