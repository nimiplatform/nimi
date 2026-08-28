package grpcserver

import (
	"context"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"path/filepath"
	goruntime "runtime"
	"strings"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aiconfig"
	"github.com/nimiplatform/nimi/runtime/internal/aiprofile"
	"github.com/nimiplatform/nimi/runtime/internal/appregistry"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/health"
	"github.com/nimiplatform/nimi/runtime/internal/idempotency"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
	"github.com/nimiplatform/nimi/runtime/internal/scheduler"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	aiservice "github.com/nimiplatform/nimi/runtime/internal/services/ai"
	appservice "github.com/nimiplatform/nimi/runtime/internal/services/app"
	auditservice "github.com/nimiplatform/nimi/runtime/internal/services/audit"
	authservice "github.com/nimiplatform/nimi/runtime/internal/services/auth"
	cognitionservice "github.com/nimiplatform/nimi/runtime/internal/services/cognition"
	"github.com/nimiplatform/nimi/runtime/internal/services/cognitionmemory"
	connectorservice "github.com/nimiplatform/nimi/runtime/internal/services/connector"
	externalagentservice "github.com/nimiplatform/nimi/runtime/internal/services/externalagent"
	localservice "github.com/nimiplatform/nimi/runtime/internal/services/localservice"
	realmrealtimeservice "github.com/nimiplatform/nimi/runtime/internal/services/realmrealtime"
	runtimeagentservice "github.com/nimiplatform/nimi/runtime/internal/services/runtimeagent"
	runtimeartifactservice "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	runtimecontrolservice "github.com/nimiplatform/nimi/runtime/internal/services/runtimecontrol"
	"google.golang.org/grpc"
	grpcHealth "google.golang.org/grpc/health"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/keepalive"
)

// Server wraps the gRPC serving stack for the runtime daemon.
type Server struct {
	addr                  string
	state                 *health.State
	logger                *slog.Logger
	grpcServer            *grpc.Server
	protectedServer       *grpc.Server
	localAppServer        *grpc.Server
	healthServer          *grpcHealth.Server
	rpcRegistry           *activeRPCRegistry
	auditStore            *auditlog.Store
	accountService        *accountservice.Service
	authService           *authservice.Service
	aiSvc                 *aiservice.Service
	appService            *appservice.Service
	localService          *localservice.Service
	persistenceBackend    *runtimepersistence.Backend
	cognitionV1Owner      *cognitionservice.Service
	agentService          *runtimeagentservice.Service
	realmRealtimeService  *realmrealtimeservice.Service
	localDevelopmentStore interface{ Close() error }
	localAppKernel        *localappkernel.Kernel
}

const (
	maxGRPCRecvMessageBytes              = 8 << 20
	maxProtectedLocalAppRecvMessageBytes = runtimeartifactservice.MaxInlineBytes + (1 << 20)
	maxGRPCSendMessageBytes              = runtimeartifactservice.MaxInlineBytes + (1 << 20)
	maxGRPCConcurrentStreams             = 128
	grpcIOBufferBytes                    = 32 << 10
	protectedGRPCKeepaliveMinTime        = 10 * time.Second

	sourceMaterializationRealmJWKSPath = "/api/auth/jwks/source-materialization"
)

// @nimi-authority: rule.nimi.desktop.shell-runtime.r011
func protectedGRPCKeepalivePolicy() keepalive.EnforcementPolicy {
	return keepalive.EnforcementPolicy{
		MinTime:             protectedGRPCKeepaliveMinTime,
		PermitWithoutStream: true,
	}
}

type sourceMaterializationWiringDisposition uint8

const (
	sourceMaterializationWiringUnconfigured sourceMaterializationWiringDisposition = iota
	sourceMaterializationWiringReady
	sourceMaterializationWiringRejected
)

type sourceMaterializationWiringConfig struct {
	disposition sourceMaterializationWiringDisposition
	issuer      string
	jwksURL     string
}

func resolveSourceMaterializationWiring(authJWTIssuer, accountRealmBaseURL string) (sourceMaterializationWiringConfig, error) {
	if authJWTIssuer == "" && accountRealmBaseURL == "" {
		return sourceMaterializationWiringConfig{disposition: sourceMaterializationWiringUnconfigured}, nil
	}
	if authJWTIssuer == "" || accountRealmBaseURL == "" {
		return sourceMaterializationWiringConfig{disposition: sourceMaterializationWiringRejected}, fmt.Errorf("source materialization requires Realm issuer and Realm base URL together")
	}
	if authJWTIssuer != strings.TrimSpace(authJWTIssuer) || accountRealmBaseURL != strings.TrimSpace(accountRealmBaseURL) {
		return sourceMaterializationWiringConfig{disposition: sourceMaterializationWiringRejected}, fmt.Errorf("source materialization Realm configuration must not contain surrounding whitespace")
	}

	parsed, err := url.Parse(accountRealmBaseURL)
	if err != nil || !parsed.IsAbs() || parsed.Opaque != "" || parsed.Host == "" || parsed.Hostname() == "" {
		return sourceMaterializationWiringConfig{disposition: sourceMaterializationWiringRejected}, fmt.Errorf("source materialization Realm base URL must be absolute with a host")
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.ForceQuery || parsed.Fragment != "" || strings.Contains(accountRealmBaseURL, "#") {
		return sourceMaterializationWiringConfig{disposition: sourceMaterializationWiringRejected}, fmt.Errorf("source materialization Realm base URL must not contain userinfo, query, or fragment")
	}

	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "https" && !(scheme == "http" && isSourceMaterializationLoopbackHost(parsed.Hostname())) {
		return sourceMaterializationWiringConfig{disposition: sourceMaterializationWiringRejected}, fmt.Errorf("source materialization Realm base URL must use HTTPS outside loopback")
	}

	parsed.Scheme = scheme
	parsed.Path = sourceMaterializationRealmJWKSPath
	parsed.RawPath = ""
	parsed.RawQuery = ""
	parsed.ForceQuery = false
	parsed.Fragment = ""
	parsed.RawFragment = ""
	return sourceMaterializationWiringConfig{
		disposition: sourceMaterializationWiringReady,
		issuer:      authJWTIssuer,
		jwksURL:     parsed.String(),
	}, nil
}

func isSourceMaterializationLoopbackHost(host string) bool {
	host = strings.Trim(strings.ToLower(host), "[]")
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}

// ProtectedServiceBindings are supplied only after the OS-specific service
// principal, state root, and secure store have been verified. No field is
// sourced from argv, environment, renderer IPC, or user-writable config.
type ProtectedServiceBindings struct {
	ServiceStateRoot                  string
	ProductControlRoot                string
	RuntimeServiceSID                 string
	RuntimeServiceUID                 uint32
	PerUserRuntime                    bool
	LocalDevelopmentConsentStorePath  string
	PlatformAppIdentityProjectionPath string
	PlatformBundledAppsRoot           string
	AccountCustody                    accountservice.Custody
	AccountPartition                  string
	LocalOSUserIdentity               localappkernel.VerifiedLocalOSUserIdentity
	AccountRealmBaseURL               string
	AccountRealmRealtimeURL           string
	AccountAuthorizationURL           string
	AccountTokenURL                   string
	ConnectorSecrets                  connectorservice.SecretStore
	DesktopSessions                   *protectedlocal.DesktopSessionManager
	LocalAppLaunches                  *protectedlocal.LocalAppLaunchRegistry
	LocalDevelopmentVerifier          protectedlocal.LocalDevelopmentProcessVerifier
	DirectLocalAppLaunches            *protectedlocal.DirectLocalAppLaunches
	RuntimeRestartRequester           runtimecontrolservice.RestartRequester
}

func NewNonProduction(cfg config.Config, state *health.State, logger *slog.Logger, version string) (*Server, error) {
	productControlRoot, err := ResolveCurrentProcessProductControlRoot()
	if err != nil {
		return nil, fmt.Errorf("resolve fixed non-production Product Control root: %w", err)
	}
	return NewNonProductionAtProductControlRoot(cfg, state, logger, version, productControlRoot)
}

// NewNonProductionAtProductControlRoot keeps direct Runtime owner tests
// independent from the interactive user's Product Control data. Production
// startup never calls this constructor.
func NewNonProductionAtProductControlRoot(cfg config.Config, state *health.State, logger *slog.Logger, version string, productControlRoot string) (*Server, error) {
	productControlRoot = filepath.Clean(strings.TrimSpace(productControlRoot))
	if !filepath.IsAbs(productControlRoot) ||
		productControlRoot == filepath.VolumeName(productControlRoot)+string(filepath.Separator) ||
		filepath.Base(productControlRoot) != ".nimi" {
		return nil, fmt.Errorf("non-production Product Control root must be an absolute .nimi directory")
	}
	security := localservice.ProductControlDataRootSecurityBinding{}
	binding, err := localservice.LoadProductControlDataRootBinding(productControlRoot, security)
	if err != nil {
		return nil, fmt.Errorf("load fixed non-production Product Control data-root authority: %w", err)
	}
	applyProductControlDataRootBinding(&cfg, binding)
	return newServer(cfg, state, logger, version, nil, productControlRoot, security)
}

func NewProtectedService(cfg config.Config, state *health.State, logger *slog.Logger, version string, bindings ProtectedServiceBindings) (*Server, error) {
	stateRoot := filepath.Clean(strings.TrimSpace(bindings.ServiceStateRoot))
	if !filepath.IsAbs(stateRoot) || stateRoot == filepath.VolumeName(stateRoot)+string(filepath.Separator) {
		return nil, fmt.Errorf("protected service state root must be an absolute non-root path")
	}
	productControlRoot := filepath.Clean(strings.TrimSpace(bindings.ProductControlRoot))
	validProductControlRoot := filepath.IsAbs(productControlRoot) &&
		productControlRoot != filepath.VolumeName(productControlRoot)+string(filepath.Separator)
	if bindings.PerUserRuntime {
		validProductControlRoot = validProductControlRoot && productControlRoot == filepath.Join(stateRoot, ".nimi")
	} else {
		validProductControlRoot = validProductControlRoot && filepath.Base(productControlRoot) == ".nimi"
	}
	if !validProductControlRoot {
		return nil, fmt.Errorf("protected Product Control root does not match the active Runtime custody profile")
	}
	sessionScopedLocalApp := bindings.LocalAppLaunches != nil && bindings.LocalDevelopmentVerifier != nil && bindings.DirectLocalAppLaunches == nil
	directLocalApp := bindings.LocalAppLaunches == nil && bindings.LocalDevelopmentVerifier == nil && bindings.DirectLocalAppLaunches != nil
	if bindings.AccountCustody == nil || strings.TrimSpace(bindings.AccountPartition) == "" || bindings.ConnectorSecrets == nil || bindings.DesktopSessions == nil ||
		(!sessionScopedLocalApp && !directLocalApp) || bindings.RuntimeRestartRequester == nil {
		return nil, fmt.Errorf("protected service custody, verified account partition, Desktop transport, and matching local-app transport authority are required")
	}
	if directLocalApp != bindings.DesktopSessions.Direct() {
		return nil, fmt.Errorf("protected Desktop and local-app transport authorities must use the same direct or session-scoped mode")
	}
	consentStorePath := filepath.Clean(strings.TrimSpace(bindings.LocalDevelopmentConsentStorePath))
	if !filepath.IsAbs(consentStorePath) || filepath.Base(consentStorePath) != "local-development.db" {
		return nil, fmt.Errorf("protected local-development consent store must be an absolute local-development.db path")
	}
	if _, err := bindings.LocalOSUserIdentity.LocalOSUserAnchor(); err != nil {
		return nil, fmt.Errorf("verified local OS-user identity is required: %w", err)
	}
	productControlSecurity, err := protectedProductControlDataRootSecurityBinding(bindings)
	if err != nil {
		return nil, err
	}
	identityProjectionPath, err := normalizeOptionalProtectedResourcePath("Platform app identity projection", bindings.PlatformAppIdentityProjectionPath)
	if err != nil {
		return nil, err
	}
	bundledAppsRoot, err := normalizeOptionalProtectedResourcePath("Platform bundled apps root", bindings.PlatformBundledAppsRoot)
	if err != nil {
		return nil, err
	}
	if err := bindings.DesktopSessions.Validate(context.Background()); err != nil {
		return nil, fmt.Errorf("validate protected Desktop session authority: %w", err)
	}
	bindings.ServiceStateRoot = stateRoot
	bindings.ProductControlRoot = productControlRoot
	bindings.LocalDevelopmentConsentStorePath = consentStorePath
	bindings.PlatformAppIdentityProjectionPath = identityProjectionPath
	bindings.PlatformBundledAppsRoot = bundledAppsRoot
	cfg.LocalStatePath = filepath.Join(stateRoot, "runtime", "local-state.json")
	// Production first-party identity selection is a native bootstrap binding.
	// The portable config/env field remains available only to non-production
	// harnesses and cannot select protected app identity or bundled code.
	cfg.AppIdentityProjectionPath = identityProjectionPath
	cfg.AppBundledArtifactsRoot = bundledAppsRoot
	serviceConfigPath, err := config.ServiceOwnedConfigPath(cfg.LocalStatePath)
	if err != nil {
		return nil, fmt.Errorf("resolve protected Runtime derived config path: %w", err)
	}
	if err := reconcileProtectedProductControlDataRootConfig(productControlRoot, serviceConfigPath, &cfg, productControlSecurity); err != nil {
		return nil, err
	}
	return newServer(cfg, state, logger, version, &bindings, productControlRoot, productControlSecurity)
}

func protectedProductControlDataRootSecurityBinding(bindings ProtectedServiceBindings) (localservice.ProductControlDataRootSecurityBinding, error) {
	if goruntime.GOOS != "windows" && goruntime.GOOS != "darwin" {
		return localservice.ProductControlDataRootSecurityBinding{}, nil
	}
	if goruntime.GOOS == "darwin" {
		interactiveUserUID, _, ok := bindings.LocalOSUserIdentity.MacOSInteractiveUser()
		if !ok || interactiveUserUID == 0 {
			return localservice.ProductControlDataRootSecurityBinding{}, fmt.Errorf("protected macOS Product Control requires the verified interactive-user UID")
		}
		runtimeServiceUID := bindings.RuntimeServiceUID
		if bindings.PerUserRuntime {
			if runtimeServiceUID != interactiveUserUID {
				return localservice.ProductControlDataRootSecurityBinding{}, fmt.Errorf("per-user macOS Product Control requires one current-user Runtime UID")
			}
			return localservice.ProductControlDataRootSecurityBinding{
				InteractiveUserUID: interactiveUserUID,
				RuntimeServiceUID:  runtimeServiceUID,
				PerUserRuntime:     true,
			}, nil
		}
		if runtimeServiceUID == 0 || runtimeServiceUID == interactiveUserUID {
			return localservice.ProductControlDataRootSecurityBinding{}, fmt.Errorf("protected macOS Product Control requires the distinct fixed Runtime service UID")
		}
		return localservice.ProductControlDataRootSecurityBinding{
			InteractiveUserUID: interactiveUserUID,
			RuntimeServiceUID:  runtimeServiceUID,
		}, nil
	}
	interactiveUserSID, ok := bindings.LocalOSUserIdentity.WindowsInteractiveUserSID()
	if !ok || strings.TrimSpace(interactiveUserSID) == "" {
		return localservice.ProductControlDataRootSecurityBinding{}, fmt.Errorf("protected Windows Product Control requires the verified interactive-user SID")
	}
	runtimeServiceSID := strings.TrimSpace(bindings.RuntimeServiceSID)
	if bindings.PerUserRuntime {
		if runtimeServiceSID != "" {
			return localservice.ProductControlDataRootSecurityBinding{}, fmt.Errorf("per-user Windows Product Control cannot carry a distinct Runtime service SID")
		}
		return localservice.ProductControlDataRootSecurityBinding{
			InteractiveUserSID: interactiveUserSID,
			RuntimeServiceSID:  interactiveUserSID,
			PerUserRuntime:     true,
		}, nil
	}
	if !strings.HasPrefix(runtimeServiceSID, "S-1-5-80-") {
		return localservice.ProductControlDataRootSecurityBinding{}, fmt.Errorf("protected Windows Product Control requires the verified Runtime service SID")
	}
	return localservice.ProductControlDataRootSecurityBinding{
		InteractiveUserSID: interactiveUserSID,
		RuntimeServiceSID:  runtimeServiceSID,
	}, nil
}

func normalizeOptionalProtectedResourcePath(label string, value string) (string, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "", nil
	}
	cleaned := filepath.Clean(trimmed)
	if !filepath.IsAbs(cleaned) || cleaned == filepath.VolumeName(cleaned)+string(filepath.Separator) {
		return "", fmt.Errorf("%s must be an absolute non-root path", label)
	}
	return cleaned, nil
}

func reconcileProtectedProductControlDataRootConfig(productControlRoot string, serviceConfigPath string, cfg *config.Config, security localservice.ProductControlDataRootSecurityBinding) error {
	if cfg == nil {
		return fmt.Errorf("protected Runtime config is required")
	}
	binding, err := localservice.LoadProductControlDataRootBinding(productControlRoot, security)
	if err != nil {
		return fmt.Errorf("load fixed Product Control data-root authority: %w", err)
	}
	_, statErr := os.Stat(serviceConfigPath)
	configExists := statErr == nil
	if statErr != nil && !os.IsNotExist(statErr) {
		return fmt.Errorf("inspect protected Runtime derived config: %w", statErr)
	}
	if binding.DataRoot != "" && strings.TrimSpace(cfg.DataRootRef) == "" && !configExists {
		if _, err := config.WriteServiceOwnedDataRoot(serviceConfigPath, binding.DataRoot); err != nil {
			return fmt.Errorf("materialize protected Runtime data-root proof from Product Control: %w", err)
		}
		if err := config.ApplyServiceOwnedDataRoot(cfg, serviceConfigPath); err != nil {
			return fmt.Errorf("apply protected Runtime data-root proof from Product Control: %w", err)
		}
	}
	return validateProtectedProductControlDataRootBinding(binding, *cfg)
}

func validateProtectedProductControlDataRootBinding(binding localservice.ProductControlDataRootBinding, cfg config.Config) error {
	configuredRoot := strings.TrimSpace(cfg.DataRootRef)
	if binding.DataRoot == "" {
		for label, value := range map[string]string{
			"dataRootRef":               configuredRoot,
			"localModelsPath":           cfg.LocalModelsPath,
			"managedRoots.models":       cfg.ManagedRoots.Models,
			"managedRoots.dependencies": cfg.ManagedRoots.Dependencies,
			"managedRoots.environments": cfg.ManagedRoots.Environments,
			"managedRoots.apps":         cfg.ManagedRoots.Apps,
			"managedRoots.accounts":     cfg.ManagedRoots.Accounts,
			"managedRoots.logs":         cfg.ManagedRoots.Logs,
			"managedRoots.audit":        cfg.ManagedRoots.Audit,
		} {
			if strings.TrimSpace(value) != "" {
				return fmt.Errorf("protected Runtime derived config %s exists without a Product Control dataRoot.path", label)
			}
		}
		return nil
	}
	if configuredRoot == "" || !sameProductControlPath(configuredRoot, binding.DataRoot) {
		return fmt.Errorf("protected Runtime derived dataRootRef does not match Product Control dataRoot.path")
	}
	expected := map[string]string{
		"localModelsPath":           filepath.Join(binding.DataRoot, "models"),
		"managedRoots.models":       filepath.Join(binding.DataRoot, "models"),
		"managedRoots.dependencies": filepath.Join(binding.DataRoot, "dependencies"),
		"managedRoots.environments": filepath.Join(binding.DataRoot, "environments"),
		"managedRoots.apps":         filepath.Join(binding.DataRoot, "apps"),
		"managedRoots.accounts":     filepath.Join(binding.DataRoot, "accounts"),
		"managedRoots.logs":         filepath.Join(binding.DataRoot, "logs"),
		"managedRoots.audit":        filepath.Join(binding.DataRoot, "audit"),
	}
	actual := map[string]string{
		"localModelsPath":           cfg.LocalModelsPath,
		"managedRoots.models":       cfg.ManagedRoots.Models,
		"managedRoots.dependencies": cfg.ManagedRoots.Dependencies,
		"managedRoots.environments": cfg.ManagedRoots.Environments,
		"managedRoots.apps":         cfg.ManagedRoots.Apps,
		"managedRoots.accounts":     cfg.ManagedRoots.Accounts,
		"managedRoots.logs":         cfg.ManagedRoots.Logs,
		"managedRoots.audit":        cfg.ManagedRoots.Audit,
	}
	for label, want := range expected {
		if !sameProductControlPath(actual[label], want) {
			return fmt.Errorf("protected Runtime derived config %s does not match Product Control dataRoot.path", label)
		}
	}
	return nil
}

func applyProductControlDataRootBinding(cfg *config.Config, binding localservice.ProductControlDataRootBinding) {
	if cfg == nil {
		return
	}
	root := strings.TrimSpace(binding.DataRoot)
	if root == "" {
		cfg.DataRootRef = ""
		cfg.LocalModelsPath = ""
		cfg.ManagedRoots = config.ManagedRootsConfig{}
		return
	}
	cfg.DataRootRef = root
	cfg.LocalModelsPath = filepath.Join(root, "models")
	cfg.ManagedRoots = config.ManagedRootsConfig{
		Models:       filepath.Join(root, "models"),
		Dependencies: filepath.Join(root, "dependencies"),
		Environments: filepath.Join(root, "environments"),
		Apps:         filepath.Join(root, "apps"),
		Accounts:     filepath.Join(root, "accounts"),
		Logs:         filepath.Join(root, "logs"),
		Audit:        filepath.Join(root, "audit"),
	}
}

func sameProductControlPath(left string, right string) bool {
	left = filepath.Clean(strings.TrimSpace(left))
	right = filepath.Clean(strings.TrimSpace(right))
	if goruntime.GOOS == "windows" {
		return strings.EqualFold(left, right)
	}
	return left == right
}

// @nimi-authority: rule.nimi.cognition.runtime-bridge.r010
// composeCognitionV1Owner keeps Cognition construction inside its optional
// capability failure domain. Cognition Memory and snapshot-bound Agent Source
// are exposed only through RuntimeAgent mediation; the retired generic
// Cognition RPC is never registered.
func composeCognitionV1Owner(logger *slog.Logger, cfg config.Config) *cognitionservice.Service {
	cognitionSvc, err := cognitionservice.NewV1Owner(logger, cfg)
	if err == nil {
		return cognitionSvc
	}
	logger.Error(
		"runtime cognition capability unavailable after initialization failure",
		"capability", "cognition.v1_owner",
		"reason_code", runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE.String(),
		"error", err,
	)
	return nil
}

func newServer(cfg config.Config, state *health.State, logger *slog.Logger, version string, protected *ProtectedServiceBindings, productControlRoot string, productControlSecurity localservice.ProductControlDataRootSecurityBinding) (*Server, error) {
	addr := cfg.GRPCAddr
	auditStore := auditlog.New(cfg.AuditRingBufferSize, cfg.UsageStatsBufferSize)
	idempotencyStore, err := idempotency.New(24*time.Hour, cfg.IdempotencyCapacity)
	if err != nil {
		return nil, fmt.Errorf("configure idempotency store: %w", err)
	}
	appRegistry := appregistry.New()
	var localDevelopmentStore *appservice.LocalDevelopmentStore
	var localAppKernel *localappkernel.Kernel
	if protected != nil {
		var developmentStore *appservice.LocalDevelopmentStore
		var developmentErr error
		if protected.DirectLocalAppLaunches != nil {
			developmentStore, developmentErr = appservice.OpenDirectLocalDevelopmentStore(protected.LocalDevelopmentConsentStorePath)
		} else {
			developmentStore, developmentErr = appservice.OpenLocalDevelopmentStore(
				protected.LocalDevelopmentConsentStorePath,
				protected.DesktopSessions.BootEpoch(),
			)
		}
		if developmentErr != nil {
			return nil, fmt.Errorf("open local-development store: %w", developmentErr)
		}
		if protected.PerUserRuntime {
			if _, enableErr := developmentStore.SetDeveloperMode(context.Background(), true); enableErr != nil {
				_ = developmentStore.Close()
				return nil, fmt.Errorf("enable source D2 local development: %w", enableErr)
			}
		}
		localDevelopmentStore = developmentStore
		kernel, kernelErr := localappkernel.OpenSQLite(
			context.Background(),
			filepath.Join(protected.ServiceStateRoot, "local-app-kernel.db"),
			protected.LocalOSUserIdentity,
			localappkernel.Options{},
		)
		if kernelErr != nil {
			return nil, fmt.Errorf("open local-app kernel: %w", kernelErr)
		}
		localAppKernel = kernel
	}
	keepLocalDevelopmentStore := false
	defer func() {
		if !keepLocalDevelopmentStore && localDevelopmentStore != nil {
			_ = localDevelopmentStore.Close()
		}
		if !keepLocalDevelopmentStore && localAppKernel != nil {
			_ = localAppKernel.Close()
		}
	}()
	rpcRegistry := newActiveRPCRegistry(nil)

	h := grpcHealth.NewServer()
	capabilityAuthorizer := protectedCapabilityAuthorizer(protectedCarrierOnlyCapabilityAuthorizer{})
	authOptions := make([]authservice.Option, 0, 1)
	if protected != nil {
		authOptions = append(authOptions, authservice.WithDesktopSessionManager(protected.DesktopSessions))
	}
	authSvc := authservice.NewWithDependencies(
		logger, auditStore,
		int32(cfg.SessionTTLMinSeconds), int32(cfg.SessionTTLMaxSeconds),
		authOptions...,
	)
	var protectedGRPCServer *grpc.Server
	var localAppGRPCServer *grpc.Server
	accountSvc := accountservice.New(logger)
	if protected != nil {
		accountSvc = accountservice.NewProduction(logger, accountservice.ProductionConfig{
			RealmBaseURL:     protected.AccountRealmBaseURL,
			RealmRealtimeURL: protected.AccountRealmRealtimeURL,
			AuthorizationURL: protected.AccountAuthorizationURL,
			TokenURL:         protected.AccountTokenURL,
			CustodyPartition: protected.AccountPartition,
			Custody:          protected.AccountCustody,
			AppRegistry:      appRegistry,
			AuditStore:       auditStore,
		})
	}
	authSvc.SetRuntimeAccountSecurityContextProvider(accountSvc)
	realmRealtimeSvc := realmrealtimeservice.New(logger, accountSvc)
	runtimeControlSvc := runtimecontrolservice.New(nil, nil)
	if protected != nil {
		runtimeControlSvc = runtimecontrolservice.New(protected.DesktopSessions, protected.RuntimeRestartRequester)
	}

	// AuthN validator — JWKS mode (K-AUTHN-004). revocationUrl shares the
	// bearer JWT restart config group with issuer/audience/jwksUrl, so the full
	// group must validate together or the chain fails closed (K-AUTHN-006).
	authnValidator, authnErr := authn.NewValidator(cfg.AuthJWTJWKSURL, cfg.AuthJWTIssuer, cfg.AuthJWTAudience)
	if authnErr == nil {
		authnErr = authn.ValidateConfigGroup(cfg.AuthJWTJWKSURL, cfg.AuthJWTIssuer, cfg.AuthJWTAudience, cfg.AuthJWTRevocationURL)
	}
	if authnErr != nil {
		logger.Warn("JWT authn validator init failed; all JWT tokens will be rejected", "error", authnErr)
		authnValidator, _ = authn.NewValidator("", "", "")
	} else {
		authnValidator.SetRevocationURL(cfg.AuthJWTRevocationURL)
	}

	g := grpc.NewServer(
		grpc.MaxRecvMsgSize(maxGRPCRecvMessageBytes),
		grpc.MaxSendMsgSize(maxGRPCSendMessageBytes),
		grpc.MaxConcurrentStreams(maxGRPCConcurrentStreams),
		grpc.ReadBufferSize(grpcIOBufferBytes),
		grpc.WriteBufferSize(grpcIOBufferBytes),
		grpc.ChainUnaryInterceptor(
			newUnaryVersionInterceptor(logger, version),
			newUnaryLifecycleInterceptor(state),
			newUnaryPublicTransportInterceptor(),
			newUnaryActivityInterceptor(rpcRegistry),
			newUnaryProtocolInterceptor(idempotencyStore),
			authn.NewUnaryInterceptor(authnValidator),
			newUnaryAuthzInterceptor(capabilityAuthorizer),
			newUnaryAuditInterceptor(auditStore),
		),
		grpc.ChainStreamInterceptor(
			newStreamVersionInterceptor(logger, version),
			newStreamLifecycleInterceptor(state),
			newStreamPublicTransportInterceptor(),
			newStreamActivityInterceptor(rpcRegistry),
			newStreamProtocolInterceptor(),
			authn.NewStreamInterceptor(authnValidator),
			newStreamAuthzInterceptor(capabilityAuthorizer),
			newStreamAuditInterceptor(auditStore),
		),
	)
	healthpb.RegisterHealthServer(g, h)
	auditSvc := auditservice.New(state, logger, auditStore)
	runtimev1.RegisterRuntimeAuditServiceServer(g, auditSvc)

	connectorBasePath := filepath.Join(filepath.Dir(cfg.LocalStatePath), "connectors")
	connStore := connectorservice.NewConnectorStore(connectorBasePath)
	if protected != nil {
		connectorBasePath = filepath.Join(protected.ServiceStateRoot, "connectors")
		connStore = connectorservice.NewConnectorStoreWithSecretStore(connectorBasePath, protected.ConnectorSecrets)
	}
	if err := connStore.ReconcileStartup(); err != nil {
		return nil, fmt.Errorf("reconcile connector store: %w", err)
	}
	artifactStore, err := runtimeartifactservice.NewDiskStoreForLocalStatePath(cfg.LocalStatePath)
	if err != nil {
		return nil, fmt.Errorf("init runtime artifact store: %w", err)
	}
	var aiSvc *aiservice.Service
	if protected != nil {
		aiSvc, err = aiservice.NewProtected(logger, auditStore, connStore, cfg)
	} else {
		aiSvc, err = aiservice.New(logger, auditStore, connStore, cfg)
	}
	if err != nil {
		return nil, fmt.Errorf("init ai service: %w", err)
	}
	aiSvc.SetRuntimeArtifactStore(artifactStore)
	runtimev1.RegisterRuntimeAiServiceServer(g, aiSvc)
	runtimev1.RegisterRuntimeAiRealtimeServiceServer(g, aiSvc)

	localSvc, err := localservice.NewRuntimeWithProductControlDataRoot(logger, auditStore, cfg.LocalStatePath, cfg.LocalAuditCapacity, cfg.LocalModelsPath, cfg.DataRootRef)
	if err != nil {
		return nil, fmt.Errorf("init local service: %w", err)
	}
	keepLocalService := false
	defer func() {
		if !keepLocalService {
			localSvc.Close()
		}
	}()
	if err := localSvc.SetProductVersion(version); err != nil {
		return nil, fmt.Errorf("init local service product version: %w", err)
	}
	if err := localSvc.SetProductControlRoot(productControlRoot); err != nil {
		return nil, fmt.Errorf("bind fixed Product Control root: %w", err)
	}
	if err := localSvc.SetProductControlDataRootSecurityBinding(productControlSecurity); err != nil {
		return nil, fmt.Errorf("bind Product Control data-root security identities: %w", err)
	}
	if protected != nil {
		serviceConfigPath, err := config.ServiceOwnedConfigPath(cfg.LocalStatePath)
		if err != nil {
			return nil, fmt.Errorf("resolve service-owned Runtime config path: %w", err)
		}
		localSvc.SetProductControlDataRootConfigWriter(func(dataRootRef string) (bool, error) {
			return config.WriteServiceOwnedDataRoot(serviceConfigPath, dataRootRef)
		})
	} else {
		initialDataRoot := cfg.DataRootRef
		localSvc.SetProductControlDataRootConfigWriter(func(dataRootRef string) (bool, error) {
			return !sameProductControlPath(initialDataRoot, dataRootRef), nil
		})
	}
	localSvc.SetRuntimeAccountProjectionProvider(accountSvc)
	runtimev1.RegisterRuntimeLocalServiceServer(g, localSvc)
	backend, err := runtimepersistence.Open(logger, cfg.LocalStatePath)
	if err != nil {
		return nil, fmt.Errorf("init Runtime persistence: %w", err)
	}
	aiConfigStore, err := aiconfig.NewSQLiteStore(backend)
	if err != nil {
		_ = backend.Close()
		return nil, fmt.Errorf("init AIConfig store: %w", err)
	}
	aiProfileStore, err := aiprofile.NewSQLiteStore(backend)
	if err != nil {
		_ = backend.Close()
		return nil, fmt.Errorf("init AIProfile store: %w", err)
	}
	aiSvc.SetAIConfigStore(aiConfigStore)
	agentSvc, err := runtimeagentservice.NewWithBackend(logger, cfg.LocalStatePath, backend)
	if err != nil {
		_ = backend.Close()
		return nil, fmt.Errorf("init agent core service: %w", err)
	}
	agentSvc.SetAIConfigStore(aiConfigStore)
	agentSvc.SetAIProfileStore(aiProfileStore)
	agentSvc.SetConnectorStore(connStore)
	agentSvc.SetModelCatalog(aiSvc.SpeechCatalogResolver())
	if cfg.RuntimeID == "" {
		logger.Warn("source materialization disabled; Runtime identity is not configured")
	} else if err := agentSvc.SetSourceMaterializationRuntimeIdentity(cfg.RuntimeID); err != nil {
		logger.Warn("source materialization disabled; Runtime identity binding failed", "error", err)
	}
	materializationWiring, materializationWiringErr := resolveSourceMaterializationWiring(cfg.AuthJWTIssuer, cfg.AccountRealmBaseURL)
	if materializationWiringErr != nil {
		logger.Warn("source materialization disabled; Realm admission configuration is invalid", "error", materializationWiringErr)
	} else if materializationWiring.disposition == sourceMaterializationWiringUnconfigured {
		logger.Warn("source materialization disabled; Realm acquisition is not configured")
	} else {
		materializationIssuer, err := newAccountRealmSourceMaterializationIssuer(accountSvc, materializationWiring.issuer)
		if err != nil {
			logger.Warn("source materialization disabled; Realm acquisition initialization failed", "error", err)
		} else {
			agentSvc.SetRealmSourceMaterializationIssuer(materializationIssuer)
		}
	}
	agentSvc.SetRuntimeAccountProjectionProvider(accountSvc)
	agentSvc.SetRealmCharacterPublicAvatarResolver(accountSvc)
	accountSvc.SetLocalAgentOwnershipResolver(agentSvc)
	agentSvc.SetAuditStore(auditStore)
	agentSvc.SetRuntimeArtifactStore(artifactStore)
	agentSvc.SetRuntimePrivateAIBridge(runtimeagentservice.NewAIBackedRuntimePrivateAIBridge(aiSvc))
	agentSvc.SetVoiceAssetResolver(runtimeagentservice.NewAIBackedVoiceAssetResolver(aiSvc))
	agentSvc.SetVoiceLipsyncScenarioExecutor(aiSvc, "", runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED)
	agentSvc.SetSharedLocalAgentPresetVoiceResolver(aiSvc)
	agentSvc.SetAgentVoiceTranscriptionScenarioExecutor(aiSvc)
	agentSvc.SetAgentRealtimeAIExecutor(aiSvc)
	aiSvc.SetRuntimeAccountProjectionProvider(accountSvc)
	runtimev1.RegisterRuntimeAgentServiceServer(g, agentSvc)

	// K-SCHED-004: register target-agnostic denial checks. Device profile is
	// collected on each Peek (no caching per K-SCHED-004).

	// Denial 1: disk below safety threshold (K-CFG driven, K-SCHED-004).
	diskDenialThreshold := cfg.SchedulingDiskDenialThresholdBytes
	if diskDenialThreshold <= 0 {
		diskDenialThreshold = 500 * 1024 * 1024 // fallback 500 MB
	}
	aiSvc.RegisterSchedulerDenialCheck(func() (bool, string) {
		resp, err := localSvc.CollectDeviceProfile(context.Background(), &runtimev1.CollectDeviceProfileRequest{})
		if err != nil || resp == nil || resp.GetProfile() == nil {
			return false, ""
		}
		free := resp.GetProfile().GetDiskFreeBytes()
		if free > 0 && free < diskDenialThreshold {
			return true, fmt.Sprintf("disk free space %d bytes is below safety threshold %d bytes", free, diskDenialThreshold)
		}
		return false, ""
	})

	// K-SCHED-005: resource assessor for risk states.
	// Collects device profile on each Peek call (no caching per K-DEV-008).
	aiSvc.SetSchedulerResourceAssessor(func() *scheduler.ResourceSnapshot {
		resp, err := localSvc.CollectDeviceProfile(context.Background(), &runtimev1.CollectDeviceProfileRequest{})
		if err != nil || resp == nil || resp.GetProfile() == nil {
			return nil
		}
		p := resp.GetProfile()
		gpu := p.GetGpu()
		memoryModel := "unknown"
		if gpu != nil {
			switch gpu.GetMemoryModel() {
			case runtimev1.GpuMemoryModel_GPU_MEMORY_MODEL_DISCRETE:
				memoryModel = "discrete"
			case runtimev1.GpuMemoryModel_GPU_MEMORY_MODEL_UNIFIED:
				memoryModel = "unified"
			}
		}
		return &scheduler.ResourceSnapshot{
			TotalRAMBytes:      p.GetTotalRamBytes(),
			AvailableRAMBytes:  p.GetAvailableRamBytes(),
			TotalVRAMBytes:     gpu.GetTotalVramBytes(),
			AvailableVRAMBytes: gpu.GetAvailableVramBytes(),
			DiskFreeBytes:      p.GetDiskFreeBytes(),
			GPUAvailable:       gpu.GetAvailable(),
			MemoryModel:        memoryModel,
		}
	})

	// K-SCHED-005: risk thresholds from config.
	preemptionPct := cfg.SchedulingPreemptionOccupancyPercent
	if preemptionPct <= 0 || preemptionPct > 100 {
		preemptionPct = 75
	}
	aiSvc.SetSchedulerRiskThresholds(scheduler.RiskThresholds{
		SlowdownRAMBytes:         cfg.SchedulingSlowdownRAMThresholdBytes,
		SlowdownVRAMBytes:        cfg.SchedulingSlowdownVRAMThresholdBytes,
		SlowdownDiskBytes:        cfg.SchedulingSlowdownDiskThresholdBytes,
		PreemptionOccupancyRatio: float64(preemptionPct) / 100.0,
	})

	connSvc := connectorservice.New(logger, connStore, auditStore)
	connSvc.SetCloudProvider(aiSvc.CloudProvider())
	connSvc.SetModelCatalogResolver(aiSvc.SpeechCatalogResolver())
	runtimev1.RegisterRuntimeConnectorServiceServer(g, connSvc)
	logger.Info("runtime in-process mode enabled")

	cognitionSvc := composeCognitionV1Owner(logger, cfg)
	if cognitionSvc != nil {
		cognitionSvc.SetAgentSourceEmbeddingExecutor(newAgentSourceEmbeddingExecutor(agentSvc, aiSvc, connStore, aiSvc.SpeechCatalogResolver(), localSvc))
		memoryStore := cognitionmemory.NewStore(backend)
		memoryCapabilities := newCognitionMemoryCapabilityProvider(backend, agentSvc, aiSvc, connStore, aiSvc.SpeechCatalogResolver(), localSvc)
		memoryOwner := cognitionmemory.NewOwnerAdapter(
			cognitionSvc.MemoryCore(),
			memoryStore.BindingForOwner,
			func(ctx context.Context, binding cognitionmemory.Binding) (memoryv1.CapabilitySnapshot, error) {
				snapshot, _, err := memoryCapabilities(ctx, binding)
				return snapshot, err
			},
		)
		memoryBridge := cognitionmemory.NewBridge(memoryStore, memoryOwner, agentSvc.AuthorizeCognitionMemoryBinding)
		memoryFacade := cognitionmemory.NewFacade(
			memoryStore,
			memoryOwner,
			memoryBridge,
			agentSvc.AuthorizeCognitionMemoryBinding,
			memoryCapabilities,
		)
		memoryTermination := cognitionmemory.NewTerminationService(memoryStore, memoryOwner)
		if err := agentSvc.ConfigureCognitionMemory(memoryStore, memoryBridge, memoryFacade, memoryTermination); err != nil {
			return nil, fmt.Errorf("configure Cognition Memory owner path: %w", err)
		}
	}
	agentSvc.SetSourceCognitionBridge(cognitionSvc)
	// Observe terminal Account deletion only after the complete local fence and
	// Cognition owner composition is installed. An early refresh must never hand
	// a terminal fact to a partially configured observer.
	accountSvc.SetRealmAccountDeletedObserver(agentSvc)

	externalAgentSvc := externalagentservice.New(logger)
	runtimev1.RegisterRuntimeExternalAgentServiceServer(g, externalAgentSvc)
	runtimev1.RegisterRuntimeAuthServiceServer(g, authSvc)
	runtimev1.RegisterRuntimeServiceControlServiceServer(g, runtimeControlSvc)
	runtimev1.RegisterRuntimeAccountServiceServer(g, accountSvc)
	runtimev1.RegisterRuntimeRealmRealtimeServiceServer(g, realmRealtimeSvc)
	appOptions := []appservice.Option{
		appservice.WithAppStorageDataRoot(cfg.DataRootRef),
		appservice.WithRuntimeAccountProjectionProvider(accountSvc),
	}
	if protected != nil {
		if protected.PerUserRuntime {
			appOptions = append(appOptions, appservice.WithPerUserRuntimeRebind(true))
		}
		if protected.DirectLocalAppLaunches != nil {
			appOptions = append(appOptions,
				appservice.WithDirectLocalDevelopmentAuthority(localDevelopmentStore, protected.DirectLocalAppLaunches, artifactStore),
				appservice.WithLocalAppKernel(localAppKernel),
			)
		} else {
			appOptions = append(appOptions,
				appservice.WithLocalDevelopmentAuthority(localDevelopmentStore, protected.LocalAppLaunches, protected.LocalDevelopmentVerifier, artifactStore),
				appservice.WithLocalAppKernel(localAppKernel),
			)
		}
	}
	appSvc := appservice.New(logger, appOptions...)
	if protected != nil {
		if err := appSvc.ReconcileLocalDevelopmentKernel(context.Background()); err != nil {
			return nil, fmt.Errorf("reconcile local-development authority with local-app kernel: %w", err)
		}
	}
	authSvc.SetLocalAppSessionOpener(appSvc)
	agentSvc.SetLocalAppIngressRevalidator(appSvc)
	artifactSvc := runtimeartifactservice.New(
		artifactStore,
		logger,
		runtimeartifactservice.WithProtectedGeneratedVoiceAuthorizer(agentSvc),
	)
	if protected != nil {
		var appOwnerAdmission protectedAppOwnerAdmission
		if localAppKernel != nil {
			registrations := localAppKernel.Registrations()
			appOwnerAdmission = func(ctx context.Context, appID string) bool {
				registration, err := registrations.GetActiveByAppID(ctx, appID)
				return err == nil && registration.AppID == appID
			}
		}
		protectedGRPCServer = newProtectedDesktopRPCServer(runtimeControlSvc, authSvc, accountSvc, realmRealtimeSvc, auditSvc, localSvc, aiSvc, agentSvc, connSvc, externalAgentSvc, appSvc, appSvc, artifactSvc, protected.DesktopSessions, accountSvc, appOwnerAdmission)
		localAppGRPCServer = newProtectedLocalAppRPCServer(runtimeControlSvc, authSvc, accountSvc, realmRealtimeSvc, localSvc, aiSvc, agentSvc, appSvc)
	}
	appSvc.RegisterInternalConsumer("runtime.agent.internal.chat_track_sidecar", agentSvc.ConsumeChatTrackSidecarAppMessage)
	appSvc.RegisterInternalConsumer("runtime.agent", agentSvc.ConsumePublicChatAppMessage)
	agentSvc.SetPublicChatAppEmitter(func(ctx context.Context, req *runtimev1.SendAppMessageRequest) (*runtimev1.SendAppMessageResponse, error) {
		if req == nil {
			return appSvc.SendAppMessage(ctx, req)
		}
		return appSvc.SendAppMessage(appservice.WithTrustedInternalCaller(ctx, req.GetFromAppId()), req)
	})
	runtimev1.RegisterRuntimeAppServiceServer(g, appSvc) // Phase 2 Draft
	runtimev1.RegisterRuntimeDevelopmentServiceServer(g, appSvc)

	runtimev1.RegisterRuntimeArtifactServiceServer(g, artifactSvc)

	s := &Server{
		addr:                  addr,
		state:                 state,
		logger:                logger,
		grpcServer:            g,
		protectedServer:       protectedGRPCServer,
		localAppServer:        localAppGRPCServer,
		healthServer:          h,
		rpcRegistry:           rpcRegistry,
		auditStore:            auditStore,
		accountService:        accountSvc,
		authService:           authSvc,
		aiSvc:                 aiSvc,
		appService:            appSvc,
		localService:          localSvc,
		persistenceBackend:    backend,
		cognitionV1Owner:      cognitionSvc,
		agentService:          agentSvc,
		realmRealtimeService:  realmRealtimeSvc,
		localDevelopmentStore: localDevelopmentStore,
		localAppKernel:        localAppKernel,
	}
	s.SyncServingState()
	keepLocalDevelopmentStore = true
	keepLocalService = true
	return s, nil
}

func (s *Server) AuditStore() *auditlog.Store {
	return s.auditStore
}

func (s *Server) AccountService() *accountservice.Service {
	return s.accountService
}

func (s *Server) AIService() *aiservice.Service {
	return s.aiSvc
}

func (s *Server) AppService() *appservice.Service {
	return s.appService
}

// LocalService returns the in-process local runtime service for engine
// manager injection.
func (s *Server) LocalService() *localservice.Service {
	return s.localService
}

func (s *Server) AgentService() *runtimeagentservice.Service {
	return s.agentService
}
