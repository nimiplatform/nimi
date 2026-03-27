package grant

import (
	"context"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appregistry"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/protocol/envelope"
	"github.com/nimiplatform/nimi/runtime/internal/scopecatalog"
	"log/slog"
	"strings"
	"sync"
	"time"
)

type tokenRecord struct {
	TokenID             string
	AppID               string
	SubjectUserID       string
	ExternalPrincipalID string
	PolicyVersion       string
	IssuedScopeCatalog  string
	Scopes              []string
	ResourceSelectors   *runtimev1.ResourceSelectors
	CanDelegate         bool
	MaxDelegationDepth  int32
	DelegationDepth     int32
	ParentTokenID       string
	ConsentRef          *runtimev1.ConsentRef
	IssuedAt            time.Time
	ExpiresAt           time.Time
	Secret              string
	Revoked             bool
}

// Service implements RuntimeGrantService with in-memory token state.
type Service struct {
	runtimev1.UnimplementedRuntimeGrantServiceServer
	logger     *slog.Logger
	registry   *appregistry.Registry
	catalog    *scopecatalog.Catalog
	auditStore *auditlog.Store

	// TTL bounds (K-GRANT-003).
	ttlMinSeconds int32
	ttlMaxSeconds int32

	// Delegation depth cap (K-GRANT-005).
	maxDelegationDepth int32

	mu             sync.RWMutex
	tokens         map[string]tokenRecord
	parentChildren map[string]map[string]bool
	policyIndex    map[string]string
	policyTokens   map[string]map[string]bool
}

func New(logger *slog.Logger) *Service {
	return NewWithDependencies(logger, appregistry.New(), scopecatalog.New())
}

func NewWithDependencies(logger *slog.Logger, registry *appregistry.Registry, catalog *scopecatalog.Catalog, opts ...func(*Service)) *Service {
	if registry == nil {
		registry = appregistry.New()
	}
	if catalog == nil {
		catalog = scopecatalog.New()
	}
	svc := &Service{
		logger:             logger,
		registry:           registry,
		catalog:            catalog,
		ttlMinSeconds:      60,
		ttlMaxSeconds:      86400,
		maxDelegationDepth: 3,
		tokens:             make(map[string]tokenRecord),
		parentChildren:     make(map[string]map[string]bool),
		policyIndex:        make(map[string]string),
		policyTokens:       make(map[string]map[string]bool),
	}
	for _, opt := range opts {
		opt(svc)
	}
	return svc
}

// WithTTLBounds sets the min/max TTL bounds for grant tokens (K-GRANT-003).
func WithTTLBounds(minSeconds, maxSeconds int) func(*Service) {
	return func(s *Service) {
		if minSeconds > 0 {
			s.ttlMinSeconds = int32(minSeconds)
		}
		if maxSeconds > 0 {
			s.ttlMaxSeconds = int32(maxSeconds)
		}
	}
}

// WithMaxDelegationDepth sets the maximum delegation depth (K-GRANT-005).
func WithMaxDelegationDepth(depth int) func(*Service) {
	return func(s *Service) {
		if depth > 0 {
			s.maxDelegationDepth = int32(depth)
		}
	}
}

// WithAuditStore sets the audit store for grant event tracking (K-GRANT-007).
func WithAuditStore(store *auditlog.Store) func(*Service) {
	return func(s *Service) {
		s.auditStore = store
	}
}

// emitAudit writes an audit event for grant operations (K-GRANT-007).
func (s *Service) emitAudit(ctx context.Context, operation string, appID string, subjectUserID string, reasonCode runtimev1.ReasonCode) {
	if s.auditStore == nil {
		return
	}
	s.auditStore.AppendEvent(&runtimev1.AuditEventRecord{
		Domain:        "runtime.grant",
		Operation:     operation,
		AppId:         appID,
		SubjectUserId: subjectUserID,
		ReasonCode:    reasonCode,
		TraceId:       strings.TrimSpace(envelope.ParseTraceIDFromContext(ctx)),
	})
}
