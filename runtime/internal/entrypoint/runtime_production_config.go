package entrypoint

import (
	"path/filepath"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/config"
)

// newProtectedRuntimeConfig is the platform-neutral product configuration for
// an OS-verified production Runtime. Platform files supply only their verified
// service root, durable Runtime identity, and canonical Realm authority.
func newProtectedRuntimeConfig(runtimeRoot, runtimeID, realmBaseURL string) config.Config {
	return config.Config{
		// Protected startup never opens these ordinary listeners. Config keeps
		// syntactically valid loopback values for shared service construction.
		GRPCAddr:         "127.0.0.1:46371",
		HTTPAddr:         "127.0.0.1:46372",
		ShutdownTimeout:  10 * time.Second,
		LocalStatePath:   filepath.Join(runtimeRoot, "local-state.json"),
		LocalModelsPath:  "",
		EngineSpeechPort: 8330,
		RuntimeID:        runtimeID,
		DataRootRef:      "",
		ManagedRoots:     config.ManagedRootsConfig{},
		LocalService: config.LocalServiceConfig{
			Enabled: true,
			Mode:    config.LocalServiceModeDesktopLocal,
		},
		SessionTTLMinSeconds:                 60,
		SessionTTLMaxSeconds:                 86_400,
		AIHealthIntervalSeconds:              8,
		AIHTTPTimeoutSeconds:                 30,
		GlobalConcurrencyLimit:               8,
		PerAppConcurrencyLimit:               2,
		IdempotencyCapacity:                  10_000,
		MaxDelegationDepth:                   3,
		AuditRingBufferSize:                  20_000,
		UsageStatsBufferSize:                 50_000,
		LocalAuditCapacity:                   5_000,
		LogLevel:                             "info",
		AuthJWTIssuer:                        realmBaseURL,
		AuthJWTAudience:                      "nimi-runtime",
		AuthJWTJWKSURL:                       realmBaseURL + "/api/auth/jwks",
		AuthJWTRevocationURL:                 realmBaseURL + "/api/auth/sessions/introspect",
		AccountRealmBaseURL:                  realmBaseURL,
		Providers:                            map[string]config.RuntimeFileTarget{},
		SchedulingDiskDenialThresholdBytes:   500 * 1024 * 1024,
		SchedulingSlowdownRAMThresholdBytes:  2 * 1024 * 1024 * 1024,
		SchedulingSlowdownVRAMThresholdBytes: 1 * 1024 * 1024 * 1024,
		SchedulingSlowdownDiskThresholdBytes: 2 * 1024 * 1024 * 1024,
		SchedulingPreemptionOccupancyPercent: 75,
	}
}
