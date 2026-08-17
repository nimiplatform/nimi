package config

import "github.com/oklog/ulid/v2"

// intPtr returns a pointer to the given int value.
func intPtr(v int) *int { return &v }

// boolPtr returns a pointer to the given bool value.
func boolPtr(v bool) *bool { return &v }

// DefaultFileConfig returns the baseline runtime config shape. RuntimeID is
// intentionally empty: it is a stable per-install identity assigned once at
// config init by InitFileConfig, never regenerated on merge/read. (K-CFG-018)
func DefaultFileConfig() FileConfig {
	return FileConfig{
		SchemaVersion:          DefaultSchemaVersion,
		RuntimeID:              "",
		GRPCAddr:               defaultGRPCAddr,
		HTTPAddr:               defaultHTTPAddr,
		ShutdownTimeoutSeconds: intPtr(10),
		LocalStatePath:         "~/" + defaultLocalStateRelPath,
		DataRootRef:            "",
		ManagedRoots:           &FileConfigManagedRoots{},
		LocalService: &FileConfigLocalService{
			Enabled: boolPtr(true),
			Mode:    LocalServiceModeDesktopLocal,
		},
		AIHTTPTimeoutSeconds:      intPtr(30),
		GlobalConcurrencyLimit:    intPtr(8),
		PerAppConcurrencyLimit:    intPtr(2),
		IdempotencyCapacity:       intPtr(10000),
		MaxDelegationDepth:        intPtr(3),
		AuditRingBufferSize:       intPtr(20000),
		UsageStatsBufferSize:      intPtr(50000),
		LocalAuditCapacity:        intPtr(5000),
		SessionTTLMinSeconds:      intPtr(60),
		SessionTTLMaxSeconds:      intPtr(86400),
		ModelCatalogCustomDir:     "~/" + defaultModelCatalogCustomRelPath,
		AppIdentityProjectionPath: "",
		AppBundledArtifactsRoot:   "",
		Providers:                 map[string]RuntimeFileTarget{},
	}
}

// GenerateRuntimeID returns a fresh stable Runtime daemon identity. (K-CFG-018)
func GenerateRuntimeID() string {
	return ulid.Make().String()
}

// InitFileConfig returns the baseline runtime config with a freshly generated
// stable RuntimeID. It is the canonical config-init shape. (K-CFG-018)
func InitFileConfig() FileConfig {
	cfg := DefaultFileConfig()
	cfg.RuntimeID = GenerateRuntimeID()
	return cfg
}
