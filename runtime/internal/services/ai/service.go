package ai

import (
	"log/slog"
	"strings"
	"time"

	"github.com/oklog/ulid/v2"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/modelregistry"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/providerhealth"
	"github.com/nimiplatform/nimi/runtime/internal/scheduler"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
)

const (
	defaultChunkSize            = 32
	defaultGenerateTimeout      = 30 * time.Second
	defaultStreamFirstTimeout   = 10 * time.Second
	defaultStreamTotalTimeout   = 120 * time.Second
	defaultEmbedTimeout         = 20 * time.Second
	defaultGenerateImageTimeout = 120 * time.Second
	defaultGenerateVideoTimeout = 300 * time.Second
	defaultSynthesizeTimeout    = 45 * time.Second
	defaultTranscribeTimeout    = 90 * time.Second
)

// Service implements RuntimeAiService with deterministic in-memory behavior.
type Service struct {
	runtimev1.UnimplementedRuntimeAiServiceServer
	logger                   *slog.Logger
	config                   Config
	selector                 *routeSelector
	audit                    *auditlog.Store
	registry                 *modelregistry.Registry
	registryPath             string
	scheduler                *scheduler.Scheduler
	scenarioJobs             *scenarioJobStore
	voiceAssets              *voiceAssetStore
	connStore                *connector.ConnectorStore
	localModel               localModelLister
	localImageProfile        localImageProfileResolver
	speechCatalog            *catalog.Resolver
	allowLoopback            bool
	streamFirstPacketTimeout time.Duration
}

// New creates a Service with all dependencies.
func New(logger *slog.Logger, registry *modelregistry.Registry, aiHealth *providerhealth.Tracker, auditStore *auditlog.Store, connStore *connector.ConnectorStore, daemonCfg config.Config) *Service {
	effectiveCfg := loadConfigFromEnv()
	effectiveCfg.EnforceEndpointSecurity = true
	effectiveCfg.AllowLoopbackEndpoint = daemonCfg.AllowLoopbackProviderEndpoint
	effectiveCfg.DefaultLocalTextModel = strings.TrimSpace(daemonCfg.DefaultLocalTextModel)
	effectiveCfg.DefaultCloudProvider = strings.TrimSpace(daemonCfg.DefaultCloudProvider)
	if effectiveCfg.ProviderDefaultModels == nil {
		effectiveCfg.ProviderDefaultModels = map[string]string{}
	}
	for providerID, target := range daemonCfg.Providers {
		creds := effectiveCfg.CloudProviders[providerID]
		if strings.TrimSpace(creds.BaseURL) == "" {
			creds.BaseURL = strings.TrimSpace(target.BaseURL)
		}
		if strings.TrimSpace(creds.APIKey) == "" {
			creds.APIKey = strings.TrimSpace(config.ResolveProviderAPIKey(target))
		}
		if strings.TrimSpace(creds.BaseURL) != "" || strings.TrimSpace(creds.APIKey) != "" {
			effectiveCfg.CloudProviders[providerID] = creds
		}
		if defaultModel := strings.TrimSpace(target.DefaultModel); defaultModel != "" {
			effectiveCfg.ProviderDefaultModels[providerID] = defaultModel
		}
	}
	globalConc := daemonCfg.GlobalConcurrencyLimit
	if globalConc <= 0 {
		globalConc = 8
	}
	perAppConc := daemonCfg.PerAppConcurrencyLimit
	if perAppConc <= 0 {
		perAppConc = 2
	}
	svc := newFromProviderConfig(logger, registry, aiHealth, auditStore, connStore, effectiveCfg, globalConc, perAppConc)
	svc.allowLoopback = daemonCfg.AllowLoopbackProviderEndpoint
	voiceCatalog, err := catalog.NewResolver(catalog.ResolverConfig{
		Logger:    logger,
		CustomDir: daemonCfg.ModelCatalogCustomDir,
	})
	if err != nil {
		if logger != nil {
			logger.Warn("speech catalog init failed; fallback to built-in snapshot", "error", err)
		}
	} else {
		svc.speechCatalog = voiceCatalog
	}
	return svc
}

// newFromProviderConfig is an internal constructor used by New and tests.
func newFromProviderConfig(logger *slog.Logger, registry *modelregistry.Registry, aiHealth *providerhealth.Tracker, auditStore *auditlog.Store, connStore *connector.ConnectorStore, cfg Config, globalConc int, perAppConc int) *Service {
	if globalConc <= 0 {
		globalConc = 8
	}
	if perAppConc <= 0 {
		perAppConc = 2
	}
	svc := &Service{
		logger:                   logger,
		config:                   cfg,
		selector:                 newRouteSelectorWithRegistry(cfg, registry, aiHealth),
		audit:                    auditStore,
		registry:                 registry,
		scheduler:                scheduler.New(scheduler.Config{GlobalConcurrency: globalConc, PerAppConcurrency: perAppConc, StarvationThreshold: 30 * time.Second}),
		scenarioJobs:             newScenarioJobStore(),
		voiceAssets:              newVoiceAssetStore(),
		connStore:                connStore,
		streamFirstPacketTimeout: defaultStreamFirstTimeout,
	}
	voiceCatalog, err := catalog.NewResolver(catalog.ResolverConfig{Logger: logger})
	if err == nil {
		svc.speechCatalog = voiceCatalog
	} else if logger != nil {
		logger.Warn("speech catalog default init failed", "error", err)
	}
	return svc
}

func (s *Service) SetModelRegistryPersistencePath(path string) {
	s.registryPath = strings.TrimSpace(path)
}

// SetLocalModelLister wires RuntimeLocalService for local model availability checks.
func (s *Service) SetLocalModelLister(localSvc localModelLister) {
	s.localModel = localSvc
}

// SetLocalImageProfileResolver wires RuntimeLocalService for dynamic
// LocalAI image profile materialization.
func (s *Service) SetLocalImageProfileResolver(resolver localImageProfileResolver) {
	s.localImageProfile = resolver
}

// SetLocalProviderEndpoint hot-swaps the in-process local provider backend
// endpoint after the daemon bootstraps a managed engine.
func (s *Service) SetLocalProviderEndpoint(providerID string, endpoint string, apiKey string) {
	if s == nil || s.selector == nil {
		return
	}
	local, ok := s.selector.local.(*localProvider)
	if !ok || local == nil {
		return
	}

	creds := nimillm.ProviderCredentials{
		BaseURL: strings.TrimSpace(endpoint),
		APIKey:  strings.TrimSpace(apiKey),
	}
	local.setBackend(providerID, newLocalBackend("local-"+strings.TrimSpace(providerID), creds, s.config))
}

// CloudProvider returns the underlying cloud provider for cross-service wiring (e.g., ConnectorService probe).
func (s *Service) CloudProvider() *nimillm.CloudProvider {
	return s.selector.cloudProvider
}

// SpeechCatalogResolver exposes the runtime speech catalog resolver for other
// runtime services (for example connector config surfaces).
func (s *Service) SpeechCatalogResolver() *catalog.Resolver {
	return s.speechCatalog
}

func (s *Service) recordStreamFallbackSimulated(appID string, subjectUserID string, requestedModelID string, resolvedModelID string) {
	if s.audit == nil {
		return
	}
	payload, _ := structpb.NewStruct(map[string]any{
		"requestedModelId": strings.TrimSpace(requestedModelID),
		"resolvedModelId":  strings.TrimSpace(resolvedModelID),
	})
	s.audit.AppendEvent(&runtimev1.AuditEventRecord{
		AuditId:       ulid.Make().String(),
		AppId:         strings.TrimSpace(appID),
		SubjectUserId: strings.TrimSpace(subjectUserID),
		Domain:        "runtime.ai",
		Operation:     "stream_fallback_simulated",
		ReasonCode:    runtimev1.ReasonCode_ACTION_EXECUTED,
		TraceId:       ulid.Make().String(),
		Timestamp:     timestamppb.New(time.Now().UTC()),
		Payload:       payload,
	})
}
