package ai

import (
	"log/slog"
)

// newTestService creates a Service for tests with optional provider Config.
func newTestService(logger *slog.Logger, cfg ...Config) *Service {
	var effectiveCfg Config
	if len(cfg) > 0 {
		effectiveCfg = cfg[0].normalized()
	} else {
		effectiveCfg = loadConfigFromEnv()
	}
	svc, err := newFromProviderConfig(logger, nil, nil, effectiveCfg, 8, 2)
	if err != nil {
		panic(err)
	}
	return svc
}

func testFloat32(value float32) *float32 { return &value }
func testInt32(value int32) *int32       { return &value }
func testInt64(value int64) *int64       { return &value }
func testBool(value bool) *bool          { return &value }
