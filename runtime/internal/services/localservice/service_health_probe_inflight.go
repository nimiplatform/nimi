package localservice

import (
	"context"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

type localAssetProbeInflight struct {
	done   chan struct{}
	result endpointProbeResult
}

func localAssetProbeInflightKey(localAssetID string, engine string, endpoint string) string {
	id := strings.TrimSpace(localAssetID)
	engineName := strings.ToLower(strings.TrimSpace(engine))
	probeEndpoint := strings.TrimSpace(endpoint)
	if id == "" || engineName == "" || probeEndpoint == "" {
		return ""
	}
	return id + "\x00" + engineName + "\x00" + probeEndpoint
}

func (s *Service) beginLocalAssetProbe(key string) (*localAssetProbeInflight, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.localAssetProbeInflight == nil {
		s.localAssetProbeInflight = make(map[string]*localAssetProbeInflight)
	}
	if inflight := s.localAssetProbeInflight[key]; inflight != nil {
		return inflight, false
	}
	inflight := &localAssetProbeInflight{done: make(chan struct{})}
	s.localAssetProbeInflight[key] = inflight
	return inflight, true
}

func (s *Service) finishLocalAssetProbe(key string, inflight *localAssetProbeInflight, result endpointProbeResult) {
	s.mu.Lock()
	if current := s.localAssetProbeInflight[key]; current == inflight {
		inflight.result = result
		close(inflight.done)
		delete(s.localAssetProbeInflight, key)
	}
	s.mu.Unlock()
}

func (s *Service) probeLocalModelEndpoint(ctx context.Context, model *runtimev1.LocalAssetRecord, endpoint string) endpointProbeResult {
	if model == nil {
		return endpointProbeResult{}
	}
	localAssetID := strings.TrimSpace(model.GetLocalAssetId())
	engineName := executionRuntimeEngineForModel(model)
	key := localAssetProbeInflightKey(localAssetID, engineName, endpoint)
	if key != "" {
		if inflight, owner := s.beginLocalAssetProbe(key); !owner {
			select {
			case <-ctx.Done():
				return endpointProbeResult{
					healthy:  false,
					detail:   "probe wait canceled: " + ctx.Err().Error(),
					probeURL: strings.TrimSpace(endpoint),
				}
			case <-inflight.done:
				return inflight.result
			}
		} else {
			startedAt := time.Now()
			probe := s.probeEndpoint(ctx, engineName, endpoint)
			s.observeCounter("runtime_local_assets_health_probe_total", 1,
				"local_asset_id", localAssetID,
				"local_engine", engineName,
				"responded", probe.responded,
				"healthy", probe.healthy,
			)
			s.observeLatency("runtime.local_assets.health_probe_ms", startedAt,
				"local_asset_id", localAssetID,
				"local_engine", engineName,
				"responded", probe.responded,
				"healthy", probe.healthy,
			)
			s.finishLocalAssetProbe(key, inflight, probe)
			return probe
		}
	}
	startedAt := time.Now()
	probe := s.probeEndpoint(ctx, engineName, endpoint)
	s.observeCounter("runtime_local_assets_health_probe_total", 1,
		"local_asset_id", localAssetID,
		"local_engine", engineName,
		"responded", probe.responded,
		"healthy", probe.healthy,
	)
	s.observeLatency("runtime.local_assets.health_probe_ms", startedAt,
		"local_asset_id", localAssetID,
		"local_engine", engineName,
		"responded", probe.responded,
		"healthy", probe.healthy,
	)
	return probe
}
