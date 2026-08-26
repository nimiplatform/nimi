package account

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appregistry"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
)

func New(logger *slog.Logger, opts ...Option) *Service {
	if logger == nil {
		logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	}
	s := &Service{
		logger:                       logger,
		now:                          time.Now,
		custody:                      unavailableCustody{},
		exchanger:                    inertExchanger{},
		refresher:                    inertRefresher{},
		registry:                     appregistry.New(),
		realmHTTP:                    &http.Client{Timeout: 30 * time.Second},
		realmBaseURL:                 "",
		presenceVerifier:             inertPresenceVerifier{},
		partition:                    "runtime-account:default-device",
		eventRetention:               128,
		state:                        runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_UNAVAILABLE,
		stateReason:                  runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CUSTODY_UNAVAILABLE,
		loginAttempts:                make(map[string]loginAttemptRecord),
		workspaceBindings:            make(map[string]workspaceBindingRecord),
		subscribers:                  make(map[uint64]subscriber),
		accountGenerationInvalidated: make(chan struct{}),
	}
	for _, opt := range opts {
		if opt != nil {
			opt(s)
		}
	}
	s.recoverFromCustody(context.Background())
	return s
}

// WithAuditStore binds Account-owned security events to the sole Runtime audit
// store. The account service never opens a parallel audit log.
func WithAuditStore(store *auditlog.Store) Option {
	return func(s *Service) {
		s.auditStore = store
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

func WithRealmRealtimeURL(realtimeURL string) Option {
	return func(s *Service) {
		s.realmRealtimeURL = strings.TrimRight(strings.TrimSpace(realtimeURL), "/")
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
