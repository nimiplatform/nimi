package config

import "runtime"

// intPtr returns a pointer to the given int value.
func intPtr(v int) *int { return &v }

// boolPtr returns a pointer to the given bool value.
func boolPtr(v bool) *bool { return &v }

func DefaultFileConfig() FileConfig {
	return FileConfig{
		SchemaVersion:           DefaultSchemaVersion,
		GRPCAddr:                defaultGRPCAddr,
		HTTPAddr:                defaultHTTPAddr,
		ShutdownTimeoutSeconds:  intPtr(10),
		LocalStatePath:          "~/" + defaultLocalStateRelPath,
		LocalModelsPath:         "~/" + defaultLocalModelsRelPath,
		WorkerMode:              boolPtr(false),
		AIHealthIntervalSeconds: intPtr(8),
		AIHTTPTimeoutSeconds:    intPtr(30),
		GlobalConcurrencyLimit:  intPtr(8),
		PerAppConcurrencyLimit:  intPtr(2),
		IdempotencyCapacity:     intPtr(10000),
		MaxDelegationDepth:      intPtr(3),
		AuditRingBufferSize:     intPtr(20000),
		UsageStatsBufferSize:    intPtr(50000),
		LocalAuditCapacity:      intPtr(5000),
		SessionTTLMinSeconds:    intPtr(60),
		SessionTTLMaxSeconds:    intPtr(86400),
		ModelCatalogCustomDir:   "~/" + defaultModelCatalogCustomRelPath,
		Providers:               map[string]RuntimeFileTarget{},
	}
}

func defaultLocalAIImageBackendMode() string {
	if runtime.GOOS == "darwin" && runtime.GOARCH == "arm64" {
		return "official"
	}
	return "disabled"
}
