package account

import (
	"context"
	"crypto/rand"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appregistry"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
)

func New(logger *slog.Logger, opts ...Option) *Service {
	if logger == nil {
		logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	}
	s := &Service{
		logger:                logger,
		now:                   time.Now,
		custody:               unavailableCustody{},
		exchanger:             inertExchanger{},
		refresher:             inertRefresher{},
		registry:              appregistry.New(),
		realmHTTP:             &http.Client{Timeout: 30 * time.Second},
		realmBaseURL:          "",
		presenceVerifier:      inertPresenceVerifier{},
		localAppGrantRandom:   rand.Reader,
		partition:             "runtime-account:default-device",
		eventRetention:        128,
		state:                 runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_UNAVAILABLE,
		loginAttempts:         make(map[string]loginAttemptRecord),
		bindings:              make(map[string]bindingRecord),
		workspaceBindings:     make(map[string]workspaceBindingRecord),
		subscribers:           make(map[uint64]subscriber),
		localAppGrantRequests: make(map[string]localAppGrantPendingRequest),
	}
	for _, opt := range opts {
		if opt != nil {
			opt(s)
		}
	}
	s.recoverFromCustody(context.Background())
	return s
}

// WithLocalAppKernel injects the sole Runtime-owned local-app principal,
// record, and grant store. The account service never opens a parallel store.
func WithLocalAppKernel(kernel *localappkernel.Kernel) Option {
	return func(s *Service) {
		s.localAppKernel = kernel
	}
}

// WithLocalAppGrantControlAuthority injects the protected Desktop control
// binding used to route and consume Runtime-issued grant-presence challenges.
func WithLocalAppGrantControlAuthority(authority LocalAppGrantControlAuthority) Option {
	return func(s *Service) {
		s.localAppGrantControl = authority
	}
}

// WithAuditStore binds Account-owned local-app grant lifecycle events to the
// sole Runtime audit store. Production grant mutation fails closed when this
// dependency is absent; the account service never opens a parallel audit log.
func WithAuditStore(store *auditlog.Store) Option {
	return func(s *Service) {
		s.auditStore = store
	}
}

// withLocalAppGrantRandom is intentionally package-private. Production uses
// crypto/rand; focused tests may inject deterministic entropy.
func withLocalAppGrantRandom(random io.Reader) Option {
	return func(s *Service) {
		if random != nil {
			s.localAppGrantRandom = random
		}
	}
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

func WithPresenceVerifier(verifier PresenceVerifier) Option {
	return func(s *Service) {
		if verifier != nil {
			s.presenceVerifier = verifier
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

func WithAppSessionValidator(validator AppSessionValidator) Option {
	return func(s *Service) {
		if validator != nil {
			s.appSessionValidator = validator
		}
	}
}

func WithRealmHTTPClient(client *http.Client) Option {
	return func(s *Service) {
		if client != nil {
			s.realmHTTP = client
		}
	}
}

func WithRealmBaseURL(baseURL string) Option {
	return func(s *Service) {
		s.realmBaseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
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
