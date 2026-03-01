package grant

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appregistry"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/scopecatalog"
	"log/slog"
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

	mu           sync.RWMutex
	tokens       map[string]tokenRecord
	policyIndex  map[string]string
	policyTokens map[string]map[string]bool
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
		logger:       logger,
		registry:     registry,
		catalog:      catalog,
		tokens:       make(map[string]tokenRecord),
		policyIndex:  make(map[string]string),
		policyTokens: make(map[string]map[string]bool),
	}
	for _, opt := range opts {
		opt(svc)
	}
	return svc
}

// WithAuditStore sets the audit store for grant event tracking (K-GRANT-007).
func WithAuditStore(store *auditlog.Store) func(*Service) {
	return func(s *Service) {
		s.auditStore = store
	}
}

// emitAudit writes an audit event for grant operations (K-GRANT-007).
func (s *Service) emitAudit(operation string, appID string, subjectUserID string, reasonCode runtimev1.ReasonCode) {
	if s.auditStore == nil {
		return
	}
	s.auditStore.AppendEvent(&runtimev1.AuditEventRecord{
		Domain:        "runtime.grant",
		Operation:     operation,
		AppId:         appID,
		SubjectUserId: subjectUserID,
		ReasonCode:    reasonCode,
	})
}
