package ai

import (
	"context"
	"log/slog"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// fakeLocalModelLister supports exact non-llama media/speech test bindings.
// It deliberately does not implement any ambient managed-llama resolver.
type fakeLocalModelLister struct {
	responses     []*runtimev1.ListLocalAssetsResponse
	err           error
	calls         int
	warmErr       error
	warmCalls     int
	startErr      error
	startCalls    int
	startResp     *runtimev1.StartLocalAssetResponse
	leaseCalls    []string
	acquireDelay  time.Duration
	managedNames  map[string]string
	catalogModels map[string]string
	localContexts map[string]struct {
		window   uint64
		revision string
	}
}

func (f *fakeLocalModelLister) ListLocalAssets(context.Context, *runtimev1.ListLocalAssetsRequest) (*runtimev1.ListLocalAssetsResponse, error) {
	if f.err != nil {
		return nil, f.err
	}
	if f.calls >= len(f.responses) {
		return &runtimev1.ListLocalAssetsResponse{}, nil
	}
	response := f.responses[f.calls]
	f.calls++
	return response, nil
}

func (f *fakeLocalModelLister) WarmLocalAsset(context.Context, *runtimev1.WarmLocalAssetRequest) (*runtimev1.WarmLocalAssetResponse, error) {
	f.warmCalls++
	if f.warmErr != nil {
		return nil, f.warmErr
	}
	return &runtimev1.WarmLocalAssetResponse{}, nil
}

func (f *fakeLocalModelLister) StartLocalAsset(context.Context, *runtimev1.StartLocalAssetRequest) (*runtimev1.StartLocalAssetResponse, error) {
	f.startCalls++
	if f.startErr != nil {
		return nil, f.startErr
	}
	if f.startResp != nil {
		return f.startResp, nil
	}
	return &runtimev1.StartLocalAssetResponse{}, nil
}

func (f *fakeLocalModelLister) AcquireLocalAssetLease(_ context.Context, localAssetID string, reason string) error {
	if f.acquireDelay > 0 {
		time.Sleep(f.acquireDelay)
	}
	f.leaseCalls = append(f.leaseCalls, "acquire:"+strings.TrimSpace(localAssetID)+":"+strings.TrimSpace(reason))
	return nil
}

func (f *fakeLocalModelLister) ReleaseLocalAssetLease(_ context.Context, localAssetID string, reason string) error {
	f.leaseCalls = append(f.leaseCalls, "release:"+strings.TrimSpace(localAssetID)+":"+strings.TrimSpace(reason))
	return nil
}

// newTestService creates a Service for tests with optional provider Config.
func newTestService(logger *slog.Logger, cfg ...Config) *Service {
	var effectiveCfg Config
	if len(cfg) > 0 {
		effectiveCfg = cfg[0].normalized()
	} else {
		effectiveCfg = loadConfigFromEnv()
	}
	svc, err := newFromProviderConfig(logger, nil, nil, nil, nil, effectiveCfg, 8, 2)
	if err != nil {
		panic(err)
	}
	return svc
}
