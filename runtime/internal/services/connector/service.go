package connector

import (
	"context"
	"log/slog"
	"sync"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	aicatalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
)

const maxConnectorsPerUser = 128

// Service implements RuntimeConnectorServiceServer.
type Service struct {
	runtimev1.UnimplementedRuntimeConnectorServiceServer
	logger       *slog.Logger
	store        *ConnectorStore
	audit        *auditlog.Store
	depsMu       sync.RWMutex
	cloud        *nimillm.CloudProvider
	localModel   localModelLister
	modelCatalog *aicatalog.Resolver
}

// New creates a new ConnectorService.
func New(logger *slog.Logger, store *ConnectorStore, audit *auditlog.Store) *Service {
	svc := &Service{
		logger: logger,
		store:  store,
		audit:  audit,
	}
	if resolver, err := aicatalog.NewResolver(aicatalog.ResolverConfig{Logger: logger}); err == nil {
		svc.modelCatalog = resolver
	} else if logger != nil {
		logger.Warn("connector model catalog init failed", "error", err)
	}
	return svc
}

type localModelLister interface {
	ListLocalModels(context.Context, *runtimev1.ListLocalModelsRequest) (*runtimev1.ListLocalModelsResponse, error)
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
