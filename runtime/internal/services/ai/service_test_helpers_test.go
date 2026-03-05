package ai

import "log/slog"

// newTestService creates a Service for tests with optional provider Config.
func newTestService(logger *slog.Logger, cfg ...Config) *Service {
	var effectiveCfg Config
	if len(cfg) > 0 {
		effectiveCfg = cfg[0].normalized()
	} else {
		effectiveCfg = loadConfigFromEnv()
	}
	return newFromProviderConfig(logger, nil, nil, nil, nil, effectiveCfg, 8, 2)
}
