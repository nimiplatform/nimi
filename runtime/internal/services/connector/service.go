package connector

import (
	"context"
	"log/slog"
	"strings"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	aicatalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
)

const maxConnectorsPerUser = 128

// Service implements RuntimeConnectorServiceServer.
type Service struct {
	runtimev1.UnimplementedRuntimeConnectorServiceServer
	logger             *slog.Logger
	store              *ConnectorStore
	audit              *auditlog.Store
	depsMu             sync.RWMutex
	dynamicModelsMu    sync.RWMutex
	dynamicModelsCache map[string]dynamicConnectorModelsCacheEntry
	cloud              *nimillm.CloudProvider
	localModel         localModelLister
	modelCatalog       *aicatalog.Resolver
}

type dynamicConnectorModelsCacheEntry struct {
	models    []*runtimev1.ConnectorModelDescriptor
	expiresAt time.Time
}

// New creates a new ConnectorService.
func New(logger *slog.Logger, store *ConnectorStore, audit *auditlog.Store) *Service {
	svc := &Service{
		logger:             logger,
		store:              store,
		audit:              audit,
		dynamicModelsCache: map[string]dynamicConnectorModelsCacheEntry{},
	}
	if resolver, err := aicatalog.NewResolver(aicatalog.ResolverConfig{Logger: logger}); err == nil {
		svc.modelCatalog = resolver
	} else if logger != nil {
		logger.Warn("connector model catalog init failed", "error", err)
	}
	return svc
}

type localModelLister interface {
	ListLocalAssets(context.Context, *runtimev1.ListLocalAssetsRequest) (*runtimev1.ListLocalAssetsResponse, error)
}

// SetCloudProvider sets the cloud provider for probe and model listing.
func (s *Service) SetCloudProvider(cloud *nimillm.CloudProvider) {
	s.depsMu.Lock()
	defer s.depsMu.Unlock()
	s.cloud = cloud
}

// SetLocalModelLister wires RuntimeLocalService for local connector checks.
func (s *Service) SetLocalModelLister(localSvc localModelLister) {
	s.depsMu.Lock()
	defer s.depsMu.Unlock()
	s.localModel = localSvc
}

// SetModelCatalogResolver wires runtime model/voice catalog management hooks.
func (s *Service) SetModelCatalogResolver(resolver *aicatalog.Resolver) {
	s.depsMu.Lock()
	defer s.depsMu.Unlock()
	s.modelCatalog = resolver
}

func (s *Service) Store() *ConnectorStore {
	return s.store
}

func (s *Service) cloudProvider() *nimillm.CloudProvider {
	s.depsMu.RLock()
	defer s.depsMu.RUnlock()
	return s.cloud
}

func (s *Service) localModelLister() localModelLister {
	s.depsMu.RLock()
	defer s.depsMu.RUnlock()
	return s.localModel
}

func (s *Service) modelCatalogResolver() *aicatalog.Resolver {
	s.depsMu.RLock()
	defer s.depsMu.RUnlock()
	return s.modelCatalog
}

func (s *Service) invalidateDynamicConnectorModelsCache(connectorID string) {
	if strings.TrimSpace(connectorID) == "" {
		return
	}
	s.dynamicModelsMu.Lock()
	defer s.dynamicModelsMu.Unlock()
	delete(s.dynamicModelsCache, connectorID)
}
