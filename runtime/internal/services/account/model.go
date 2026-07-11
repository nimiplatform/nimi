package account

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appregistry"
)

var (
	ErrCustodyUnavailable              = errors.New("account custody unavailable")
	ErrNoStoredAccount                 = errors.New("account custody has no stored account")
	ErrInertNotActivated               = errors.New("runtime account substrate is inert")
	ErrLoginExchangeFailure            = errors.New("account login exchange unavailable")
	ErrPresenceVerificationUnavailable = errors.New("account presence verification unavailable")
)

type AccountMaterial struct {
	AccountID            string
	DisplayName          string
	RealmEnvironmentID   string
	WorkspaceMemberships []*runtimev1.WorkspaceMembershipProjection
	AccessToken          string
	AccessTokenExpires   time.Time
	RefreshToken         string
	RefreshTokenHashes   map[string]bool
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

type Refresher interface {
	Refresh(ctx context.Context, material AccountMaterial) (AccountMaterial, error)
}

type PresenceVerificationRequest struct {
	Caller       *runtimev1.AccountCaller
	Account      PresenceVerificationAccountContext
	Purpose      string
	RequestedTTL time.Duration
	Now          time.Time
}

type PresenceVerificationAccountContext struct {
	AccountID            string
	DisplayName          string
	RealmEnvironmentID   string
	WorkspaceMemberships []*runtimev1.WorkspaceMembershipProjection
}

type PresenceVerification struct {
	State         runtimev1.PresenceVerificationState
	Method        runtimev1.PresenceVerificationMethod
	VerifiedUntil time.Time
}

type PresenceVerifier interface {
	RequestPresenceVerification(ctx context.Context, request PresenceVerificationRequest) (PresenceVerification, error)
}

type AppSessionValidator interface {
	ValidateAppSessionBinding(appID string, appInstanceID string, deviceID string, sessionID string, sessionToken string) (runtimev1.ReasonCode, bool)
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

type inertPresenceVerifier struct{}

func (inertPresenceVerifier) RequestPresenceVerification(context.Context, PresenceVerificationRequest) (PresenceVerification, error) {
	return PresenceVerification{}, ErrPresenceVerificationUnavailable
}

type loginAttemptRecord struct {
	attempt  LoginAttempt
	consumed bool
}

type bindingRecord struct {
	relation *runtimev1.ScopedAppBindingRelation
	carrier  string
}

type workspaceBindingRecord struct {
	relation   *runtimev1.WorkspaceBindingRelation
	attachment *runtimev1.WorkspaceBindingAttachment
}

type subscriber struct {
	id uint64
	ch chan *runtimev1.AccountSessionEvent
}

type Service struct {
	runtimev1.UnimplementedRuntimeAccountServiceServer

	logger *slog.Logger
	now    func() time.Time

	custody             Custody
	exchanger           LoginExchanger
	refresher           Refresher
	registry            *appregistry.Registry
	realmHTTP           *http.Client
	realmBaseURL        string
	presenceVerifier    PresenceVerifier
	appSessionValidator AppSessionValidator
	installedSessions   InstalledSessionResolver
	installedPolicy     InstalledOperationPolicySource

	partition                string
	productionActivated      bool
	nonProductionHarnessMode bool
	eventRetention           int

	identityMutationMu           sync.Mutex
	mu                           sync.RWMutex
	state                        runtimev1.AccountSessionState
	projection                   *runtimev1.AccountProjection
	material                     AccountMaterial
	accountGeneration            uint64
	authenticatedRuntimeIdentity bool
	loginAttempts                map[string]loginAttemptRecord
	bindings                     map[string]bindingRecord
	workspaceBindings            map[string]workspaceBindingRecord
	nextSequence                 uint64
	events                       []*runtimev1.AccountSessionEvent
	nextSubscriberID             uint64
	subscribers                  map[uint64]subscriber
	launchNonceSessions          map[string]string
}
