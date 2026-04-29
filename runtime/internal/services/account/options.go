package account

import (
	"context"
	"io"
	"log/slog"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appregistry"
)

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
