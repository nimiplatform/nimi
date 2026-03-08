package grpcserver

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appregistry"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/health"
	"github.com/nimiplatform/nimi/runtime/internal/idempotency"
	"github.com/nimiplatform/nimi/runtime/internal/modelregistry"
	"github.com/nimiplatform/nimi/runtime/internal/providerhealth"
	"github.com/nimiplatform/nimi/runtime/internal/scopecatalog"
	aiservice "github.com/nimiplatform/nimi/runtime/internal/services/ai"
	appservice "github.com/nimiplatform/nimi/runtime/internal/services/app"
	auditservice "github.com/nimiplatform/nimi/runtime/internal/services/audit"
	authservice "github.com/nimiplatform/nimi/runtime/internal/services/auth"
	connectorservice "github.com/nimiplatform/nimi/runtime/internal/services/connector"
	grantservice "github.com/nimiplatform/nimi/runtime/internal/services/grant"
	knowledgeservice "github.com/nimiplatform/nimi/runtime/internal/services/knowledge"
	localservice "github.com/nimiplatform/nimi/runtime/internal/services/localservice"
	modelservice "github.com/nimiplatform/nimi/runtime/internal/services/model"
	workflowservice "github.com/nimiplatform/nimi/runtime/internal/services/workflow"
	"github.com/nimiplatform/nimi/runtime/internal/workerproxy"
	"google.golang.org/grpc"
	grpcHealth "google.golang.org/grpc/health"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
)

// Server wraps the gRPC serving stack for the runtime daemon.
type Server struct {
	addr         string
	state        *health.State
	logger       *slog.Logger
	grpcServer   *grpc.Server
	healthServer *grpcHealth.Server
	aiHealth     *providerhealth.Tracker
	auditStore   *auditlog.Store
	workerPool   *workerproxy.ConnPool
	aiSvc        *aiservice.Service
	localService *localservice.Service
}

func New(cfg config.Config, state *health.State, logger *slog.Logger, version string) *Server {
	addr := cfg.GRPCAddr
	auditStore := auditlog.New(cfg.AuditRingBufferSize, cfg.UsageStatsBufferSize)
	idempotencyStore := idempotency.New(24*time.Hour, cfg.IdempotencyCapacity)
	appRegistry := appregistry.New()
	scopeCatalog := scopecatalog.New(func(operation string, version string, code runtimev1.ReasonCode) {
		appendAuditEvent(auditStore, auditEventInput{
			Domain:              "runtime.scope",
			Operation:           operation,
			ReasonCode:          code,
			ScopeCatalogVersion: version,
			CallerKind:          runtimev1.CallerKind_CALLER_KIND_DESKTOP_CORE,
			CallerID:            "scope-catalog",
		})
	})
	registryPath := modelregistry.ResolvePersistencePath()
	modelRegistry, err := modelregistry.NewFromFile(registryPath)
	if err != nil {
		logger.Warn("load model registry failed; fallback to empty registry", "path", registryPath, "error", err)
		modelRegistry = modelregistry.New()
	}
	if registryPath != "" {
		logger.Info("model registry persistence enabled", "path", registryPath)
	}
	aiHealth := providerhealth.New()

	h := grpcHealth.NewServer()
	grantSvc := grantservice.NewWithDependencies(logger, appRegistry, scopeCatalog, grantservice.WithAuditStore(auditStore))

	// AuthN validator — JWKS mode (K-AUTHN-004)
	authnValidator, authnErr := authn.NewValidator(cfg.AuthJWTJWKSURL, cfg.AuthJWTIssuer, cfg.AuthJWTAudience)
	if authnErr != nil {
		logger.Warn("JWT authn validator init failed; all JWT tokens will be rejected", "error", authnErr)
		authnValidator, _ = authn.NewValidator("", "", "")
	}

	g := grpc.NewServer(
		grpc.ChainUnaryInterceptor(
			newUnaryVersionInterceptor(version),
			newUnaryLifecycleInterceptor(state),
			newUnaryProtocolInterceptor(idempotencyStore),
			authn.NewUnaryInterceptor(authnValidator),
			newUnaryAuthzInterceptor(grantSvc),
			newUnaryAuditInterceptor(auditStore),
		),
		grpc.ChainStreamInterceptor(
			newStreamVersionInterceptor(version),
			newStreamLifecycleInterceptor(state),
			newStreamProtocolInterceptor(),
			authn.NewStreamInterceptor(authnValidator),
			newStreamAuthzInterceptor(grantSvc),
			newStreamAuditInterceptor(auditStore),
		),
	)
	healthpb.RegisterHealthServer(g, h)
	runtimev1.RegisterRuntimeAuditServiceServer(g, auditservice.New(state, logger, aiHealth, auditStore))

	var workerPool *workerproxy.ConnPool
	var aiSvc *aiservice.Service
	var localSvc *localservice.Service
	if cfg.WorkerMode {
		workerPool = workerproxy.NewConnPool(logger)
		runtimev1.RegisterRuntimeAiServiceServer(g, workerproxy.NewAIProxy(workerPool))
		runtimev1.RegisterRuntimeWorkflowServiceServer(g, workerproxy.NewWorkflowProxy(workerPool))
		runtimev1.RegisterRuntimeModelServiceServer(g, workerproxy.NewModelProxy(workerPool))
		runtimev1.RegisterRuntimeLocalServiceServer(g, workerproxy.NewLocalServiceProxy(workerPool))
		logger.Info("runtime worker proxy mode enabled")
	} else {
		connStore := connectorservice.NewConnectorStore(connectorservice.ResolveBasePath())
		if err := connStore.ReconcileStartup(); err != nil {
			logger.Warn("connector store reconcile startup failed", "error", err)
		}
		connectorservice.EnsureLocalConnectors(connStore)

		cloudDefs := buildCloudConnectorDefs(cfg)
		if err := connectorservice.EnsureCloudConnectorsFromConfig(connStore, cloudDefs); err != nil {
			logger.Warn("cloud connector auto-registration failed", "error", err)
		}

		aiSvc = aiservice.New(logger, modelRegistry, aiHealth, auditStore, connStore, cfg)
		aiSvc.SetModelRegistryPersistencePath(registryPath)
		runtimev1.RegisterRuntimeAiServiceServer(g, aiSvc)

		runtimev1.RegisterRuntimeWorkflowServiceServer(g, workflowservice.New(logger))
		modelSvc := modelservice.New(logger, modelRegistry)
		modelSvc.SetPersistencePath(registryPath)
		runtimev1.RegisterRuntimeModelServiceServer(g, modelSvc)
		localSvc = localservice.New(logger, auditStore, cfg.LocalStatePath, cfg.LocalAuditCapacity)
		runtimev1.RegisterRuntimeLocalServiceServer(g, localSvc)
		aiSvc.SetLocalModelLister(localSvc)
		aiSvc.SetLocalImageProfileResolver(localSvc)

		connSvc := connectorservice.New(logger, connStore, auditStore)
		connSvc.SetCloudProvider(aiSvc.CloudProvider())
		connSvc.SetLocalModelLister(localSvc)
		connSvc.SetModelCatalogResolver(aiSvc.SpeechCatalogResolver())
		runtimev1.RegisterRuntimeConnectorServiceServer(g, connSvc)
		logger.Info("runtime in-process mode enabled")
	}

	runtimev1.RegisterRuntimeGrantServiceServer(g, grantSvc)
	runtimev1.RegisterRuntimeAuthServiceServer(g, authservice.NewWithDependencies(
		logger, appRegistry, auditStore,
		cfg.SessionTTLMinSeconds, cfg.SessionTTLMaxSeconds,
	))
	runtimev1.RegisterRuntimeKnowledgeServiceServer(g, knowledgeservice.New(logger))
	runtimev1.RegisterRuntimeAppServiceServer(g, appservice.New(logger))

	s := &Server{
		addr:         addr,
		state:        state,
		logger:       logger,
		grpcServer:   g,
		healthServer: h,
		aiHealth:     aiHealth,
		auditStore:   auditStore,
		workerPool:   workerPool,
		aiSvc:        aiSvc,
		localService: localSvc,
	}
	s.SyncServingState()
	return s
}

func (s *Server) AIHealthTracker() *providerhealth.Tracker {
	return s.aiHealth
}

func (s *Server) AuditStore() *auditlog.Store {
	return s.auditStore
}

func (s *Server) AIService() *aiservice.Service {
	return s.aiSvc
}

// LocalService returns the in-process local runtime service for engine
// manager injection. Returns nil in worker mode.
func (s *Server) LocalService() *localservice.Service {
	return s.localService
}

func (s *Server) Serve() error {
	listener, err := net.Listen("tcp", s.addr)
	if err != nil {
		return fmt.Errorf("listen grpc %s: %w", s.addr, err)
	}

	s.logger.Info("grpc server listening", "addr", s.addr)
	if err := s.grpcServer.Serve(listener); err != nil {
		return fmt.Errorf("serve grpc: %w", err)
	}
	return nil
}

func (s *Server) Stop(ctx context.Context) error {
	done := make(chan struct{})
	go func() {
		s.grpcServer.GracefulStop()
		close(done)
	}()

	select {
	case <-done:
		if s.workerPool != nil {
			if err := s.workerPool.Close(); err != nil {
				return err
			}
		}
		return nil
	case <-ctx.Done():
		s.grpcServer.Stop()
		if s.workerPool != nil {
			_ = s.workerPool.Close()
		}
		return ctx.Err()
	}
}

// SyncServingState maps runtime health status to grpc health checks.
func (s *Server) SyncServingState() {
	snapshot := s.state.Snapshot()
	servingStatus := healthpb.HealthCheckResponse_NOT_SERVING
	if snapshot.Status.Ready() {
		servingStatus = healthpb.HealthCheckResponse_SERVING
	}

	s.healthServer.SetServingStatus("", servingStatus)
	s.healthServer.SetServingStatus(runtimev1.RuntimeAuditService_ServiceDesc.ServiceName, servingStatus)
	s.healthServer.SetServingStatus(runtimev1.RuntimeAiService_ServiceDesc.ServiceName, servingStatus)
	s.healthServer.SetServingStatus(runtimev1.RuntimeWorkflowService_ServiceDesc.ServiceName, servingStatus)
	s.healthServer.SetServingStatus(runtimev1.RuntimeModelService_ServiceDesc.ServiceName, servingStatus)
	s.healthServer.SetServingStatus(runtimev1.RuntimeLocalService_ServiceDesc.ServiceName, servingStatus)
	s.healthServer.SetServingStatus(runtimev1.RuntimeGrantService_ServiceDesc.ServiceName, servingStatus)
	s.healthServer.SetServingStatus(runtimev1.RuntimeAuthService_ServiceDesc.ServiceName, servingStatus)
	s.healthServer.SetServingStatus(runtimev1.RuntimeKnowledgeService_ServiceDesc.ServiceName, servingStatus)
	s.healthServer.SetServingStatus(runtimev1.RuntimeAppService_ServiceDesc.ServiceName, servingStatus)
	s.healthServer.SetServingStatus(runtimev1.RuntimeConnectorService_ServiceDesc.ServiceName, servingStatus)
}

// buildCloudConnectorDefs builds cloud connector definitions from config.json providers.
func buildCloudConnectorDefs(cfg config.Config) []connectorservice.CloudConnectorDef {
	if len(cfg.Providers) == 0 {
		return nil
	}
	var defs []connectorservice.CloudConnectorDef
	for configKey, target := range cfg.Providers {
		canonical, ok := config.ResolveCanonicalProviderID(configKey)
		if !ok {
			continue
		}
		apiKey := config.ResolveProviderAPIKey(target)
		if apiKey == "" {
			continue
		}
		endpoint := strings.TrimSpace(target.BaseURL)
		if endpoint == "" {
			endpoint = connectorservice.ResolveEndpoint(canonical, "")
		}
		label := "Cloud " + capitalizeFirst(canonical)
		defs = append(defs, connectorservice.CloudConnectorDef{
			Provider: canonical,
			Endpoint: endpoint,
			APIKey:   apiKey,
			Label:    label,
		})
	}
	return defs
}

func capitalizeFirst(s string) string {
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}
