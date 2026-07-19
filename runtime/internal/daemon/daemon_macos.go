//go:build darwin && cgo

package daemon

import (
	"errors"
	"fmt"
	"log/slog"
	"path/filepath"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/grpcserver"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	connectorservice "github.com/nimiplatform/nimi/runtime/internal/services/connector"
)

func NewProtectedFromMacOSSecurityState(cfg config.Config, logger *slog.Logger, version string, state *protectedlocal.MacOSRuntimeSecurityState, requestRestart func() bool) (*Daemon, error) {
	if state == nil || requestRestart == nil {
		return nil, fmt.Errorf("verified macOS Runtime security state and restart authority are required")
	}
	fail := func(err error) (*Daemon, error) {
		if closeErr := state.Close(); closeErr != nil {
			return nil, errors.Join(err, fmt.Errorf("close macOS Runtime security state after binding failure: %w", closeErr))
		}
		return nil, err
	}
	stateRoot := strings.TrimSpace(state.ServiceStatePath())
	secrets := state.BinarySecrets()
	sessions := state.DesktopSessions()
	euid, auditSession, accountPartition, identityBound := state.InteractiveIdentity()
	if stateRoot == "" || state.Ledger() == nil || secrets == nil || sessions == nil || state.LocalAppLaunches() == nil || !identityBound {
		return fail(fmt.Errorf("complete verified macOS Runtime security state is required"))
	}
	serviceDataRoot, err := resolveProtectedServiceDataRoot(stateRoot, cfg.LocalStatePath)
	if err != nil {
		return fail(err)
	}
	localOSUserIdentity, err := localappkernel.ValidateVerifiedMacOSInteractiveUser(euid, auditSession)
	if err != nil {
		return fail(fmt.Errorf("validate macOS interactive-user identity: %w", err))
	}
	accountCustody, err := accountservice.NewProtectedBinaryCustody(secrets)
	if err != nil {
		return fail(fmt.Errorf("adapt macOS protected account custody: %w", err))
	}
	connectorSecrets, err := connectorservice.NewProtectedBinarySecretStore(secrets)
	if err != nil {
		return fail(fmt.Errorf("adapt macOS protected connector custody: %w", err))
	}
	localDevelopmentVerifier, err := protectedlocal.NewMacOSLocalDevelopmentProcessVerifier(state)
	if err != nil {
		return fail(fmt.Errorf("construct macOS local-development process verifier: %w", err))
	}
	platformAppRegistryPath, platformBundledAppsRoot, err := protectedPlatformAppResourceBindings()
	if err != nil {
		return fail(fmt.Errorf("resolve macOS protected Platform app resources: %w", err))
	}
	return NewProtectedWithResources(cfg, logger, version, ProtectedRuntimeResources{
		Bindings: grpcserver.ProtectedServiceBindings{
			ServiceStateRoot: serviceDataRoot, PlatformAppRegistryPath: platformAppRegistryPath,
			LocalDevelopmentConsentStorePath: filepath.Join(stateRoot, "local-development.db"),
			PlatformBundledAppsRoot:          platformBundledAppsRoot,
			AccountCustody:                   accountCustody, AccountPartition: accountPartition,
			AccountRealmBaseURL: cfg.AccountRealmBaseURL, AccountAuthorizationURL: cfg.AccountAuthorizationURL,
			AccountTokenURL: cfg.AccountTokenURL, LocalOSUserIdentity: localOSUserIdentity,
			ConnectorSecrets: connectorSecrets, DesktopSessions: sessions,
			LocalAppLaunches: state.LocalAppLaunches(), LocalDevelopmentVerifier: localDevelopmentVerifier,
			RuntimeRestartRequester: requestRestart,
		},
		Close: state.Close,
	})
}
