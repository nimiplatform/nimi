package grant

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appregistry"
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
	logger   *slog.Logger
	registry *appregistry.Registry
	catalog  *scopecatalog.Catalog

	mu           sync.RWMutex
	tokens       map[string]tokenRecord
	policyIndex  map[string]string
	policyTokens map[string]map[string]bool
}

func New(logger *slog.Logger) *Service {
	return NewWithDependencies(logger, appregistry.New(), scopecatalog.New())
}

func NewWithDependencies(logger *slog.Logger, registry *appregistry.Registry, catalog *scopecatalog.Catalog) *Service {
	if registry == nil {
		registry = appregistry.New()
	}
	if catalog == nil {
		catalog = scopecatalog.New()
	}
	return &Service{
		logger:       logger,
		registry:     registry,
		catalog:      catalog,
		tokens:       make(map[string]tokenRecord),
		policyIndex:  make(map[string]string),
		policyTokens: make(map[string]map[string]bool),
	}
}
