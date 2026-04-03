package localservice

import (
	"context"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

const (
	defaultLocalModelKeepAlive = 5 * time.Minute
	managedImageBackendEngine  = "media-diffusers-backend"
)

type localAssetResidencyState struct {
	HoldCount    int
	LastUsedAt   time.Time
	IdleDeadline time.Time
	LastReason   string
}

type localEngineResidencyState struct {
	HoldCount    int
	LastUsedAt   time.Time
	IdleDeadline time.Time
	LastReason   string
}

type expiredResidencyTargets struct {
	assetIDs []string
	engines  []string
}

func (s *Service) localKeepAliveDuration() time.Duration {
	if s == nil {
		return defaultLocalModelKeepAlive
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.localModelKeepAlive <= 0 {
		return 0
	}
	return s.localModelKeepAlive
}

func (s *Service) seedInitialResidencyState() {
	if s == nil {
		return
	}
	now := time.Now().UTC()
	keepAlive := s.localKeepAliveDuration()
	if keepAlive < 0 {
		keepAlive = 0
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for localAssetID, model := range s.assets {
		if model == nil || model.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
			continue
		}
		s.assetResidency[localAssetID] = localAssetResidencyState{
			LastUsedAt:   now,
			IdleDeadline: now.Add(keepAlive),
			LastReason:   "runtime_startup",
		}
		for _, engineName := range residencyEnginesForModel(model, s.assetRuntimeModes[localAssetID]) {
			s.engineResidency[engineName] = localEngineResidencyState{
				LastUsedAt:   now,
				IdleDeadline: now.Add(keepAlive),
				LastReason:   "runtime_startup",
			}
		}
	}
}

func residencyEnginesForModel(model *runtimev1.LocalAssetRecord, mode runtimev1.LocalEngineRuntimeMode) []string {
	if model == nil || normalizeRuntimeMode(mode) != runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED {
		return nil
	}
	engines := make([]string, 0, 2)
	executionEngine := strings.ToLower(strings.TrimSpace(executionRuntimeEngineForModel(model)))
	if executionEngine != "" && executionEngine != "runtime" {
		engines = append(engines, executionEngine)
	}
	if isManagedSupervisedImageModel(model, mode) {
		engines = appendUniqueString(engines, managedImageBackendEngine)
	}
	return dedupeStrings(engines)
}

func (s *Service) AcquireLocalAssetLease(_ context.Context, localAssetID string, reason string) error {
	model := s.modelByID(localAssetID)
	if model == nil {
		return nil
	}
	s.recordLocalAssetUsage(model, strings.TrimSpace(reason), true)
	return nil
}

func (s *Service) ReleaseLocalAssetLease(ctx context.Context, localAssetID string, reason string) error {
	model := s.modelByID(localAssetID)
	if model == nil {
		return nil
	}
	s.recordLocalAssetRelease(model, strings.TrimSpace(reason))
	if s.localKeepAliveDuration() == 0 {
		s.runResidencySweep(ctx)
	}
	return nil
}

func (s *Service) markLocalAssetUsed(localAssetID string, reason string) {
	model := s.modelByID(localAssetID)
	if model == nil {
		return
	}
	s.recordLocalAssetUsage(model, strings.TrimSpace(reason), false)
}

// MarkManagedEngineUsed records keep_alive residency for a managed supervised
// engine even when the engine is bootstrapped without an immediately ACTIVE
// local asset bound to it.
func (s *Service) MarkManagedEngineUsed(engineName string, reason string) {
	if s == nil {
		return
	}
	trimmedEngine := strings.TrimSpace(engineName)
	if trimmedEngine == "" {
		return
	}
	now := time.Now().UTC()
	keepAlive := s.localKeepAliveDuration()
	s.mu.Lock()
	defer s.mu.Unlock()
	engineState := s.engineResidency[trimmedEngine]
	engineState.LastUsedAt = now
	engineState.IdleDeadline = now.Add(keepAlive)
	engineState.LastReason = defaultString(strings.TrimSpace(reason), "unspecified")
	s.engineResidency[trimmedEngine] = engineState
}

func (s *Service) recordLocalAssetUsage(model *runtimev1.LocalAssetRecord, reason string, acquireHold bool) {
	if s == nil || model == nil {
		return
	}
	now := time.Now().UTC()
	keepAlive := s.localKeepAliveDuration()
	localAssetID := strings.TrimSpace(model.GetLocalAssetId())
	if localAssetID == "" {
		return
	}
	engineNames := residencyEnginesForModel(model, s.modelRuntimeMode(localAssetID))
	s.mu.Lock()
	defer s.mu.Unlock()
	assetState := s.assetResidency[localAssetID]
	if acquireHold {
		assetState.HoldCount++
	}
	assetState.LastUsedAt = now
	assetState.IdleDeadline = now.Add(keepAlive)
	assetState.LastReason = defaultString(strings.TrimSpace(reason), "unspecified")
	s.assetResidency[localAssetID] = assetState
	for _, engineName := range engineNames {
		if strings.TrimSpace(engineName) == "" {
			continue
		}
		engineState := s.engineResidency[engineName]
		if acquireHold {
			engineState.HoldCount++
		}
		engineState.LastUsedAt = now
		engineState.IdleDeadline = now.Add(keepAlive)
		engineState.LastReason = defaultString(strings.TrimSpace(reason), "unspecified")
		s.engineResidency[engineName] = engineState
	}
}

func (s *Service) recordLocalAssetRelease(model *runtimev1.LocalAssetRecord, reason string) {
	if s == nil || model == nil {
		return
	}
	now := time.Now().UTC()
	keepAlive := s.localKeepAliveDuration()
	localAssetID := strings.TrimSpace(model.GetLocalAssetId())
	if localAssetID == "" {
		return
	}
	engineNames := residencyEnginesForModel(model, s.modelRuntimeMode(localAssetID))
	s.mu.Lock()
	defer s.mu.Unlock()
	assetState := s.assetResidency[localAssetID]
	if assetState.HoldCount > 0 {
		assetState.HoldCount--
	}
	assetState.LastUsedAt = now
	assetState.LastReason = defaultString(strings.TrimSpace(reason), "unspecified")
	if assetState.HoldCount == 0 {
		assetState.IdleDeadline = now.Add(keepAlive)
	}
	s.assetResidency[localAssetID] = assetState
	for _, engineName := range engineNames {
		if strings.TrimSpace(engineName) == "" {
			continue
		}
		engineState := s.engineResidency[engineName]
		if engineState.HoldCount > 0 {
			engineState.HoldCount--
		}
		engineState.LastUsedAt = now
		engineState.LastReason = defaultString(strings.TrimSpace(reason), "unspecified")
		if engineState.HoldCount == 0 {
			engineState.IdleDeadline = now.Add(keepAlive)
		}
		s.engineResidency[engineName] = engineState
	}
}

func (s *Service) collectExpiredResidencyTargets(now time.Time) expiredResidencyTargets {
	if s == nil {
		return expiredResidencyTargets{}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	targets := expiredResidencyTargets{
		assetIDs: make([]string, 0, len(s.assetResidency)),
		engines:  make([]string, 0, len(s.engineResidency)),
	}
	for localAssetID, state := range s.assetResidency {
		if state.HoldCount > 0 || state.IdleDeadline.IsZero() || now.Before(state.IdleDeadline) {
			continue
		}
		targets.assetIDs = append(targets.assetIDs, localAssetID)
		delete(s.assetResidency, localAssetID)
	}
	for engineName, state := range s.engineResidency {
		if state.HoldCount > 0 || state.IdleDeadline.IsZero() || now.Before(state.IdleDeadline) {
			continue
		}
		targets.engines = append(targets.engines, engineName)
		delete(s.engineResidency, engineName)
	}
	return targets
}

func (s *Service) runResidencySweep(ctx context.Context) {
	now := time.Now().UTC()
	targets := s.collectExpiredResidencyTargets(now)
	for _, localAssetID := range targets.assetIDs {
		model := s.modelByID(localAssetID)
		if model == nil {
			continue
		}
		if isManagedSupervisedImageModel(model, s.modelRuntimeMode(localAssetID)) {
			if err := s.freeManagedMediaImageOnIdle(ctx, localAssetID, "idle_stop"); err != nil {
				s.logger.Warn("managed image idle release failed", "local_asset_id", localAssetID, "error", err)
			}
			if _, err := s.ensureModelInstalled(localAssetID, managedLocalImagePendingValidationDetail("keep_alive expired")); err != nil {
				s.logger.Warn("managed image idle status update failed", "local_asset_id", localAssetID, "error", err)
			}
			continue
		}
		if _, err := s.ensureModelInstalled(localAssetID, managedLocalModelIdleDetail()); err != nil {
			s.logger.Warn("local model idle status update failed", "local_asset_id", localAssetID, "error", err)
		}
		s.clearWarmCacheForAsset(localAssetID)
	}
	for _, engineName := range targets.engines {
		if err := s.stopManagedEngineIfIdle(engineName); err != nil {
			s.logger.Warn("idle engine stop failed", "engine", engineName, "error", err)
			continue
		}
		s.markAssetsIdleForEngine(engineName)
	}
}

func (s *Service) stopManagedEngineIfIdle(engineName string) error {
	if s == nil {
		return nil
	}
	mgr := s.engineManagerOrNil()
	if mgr == nil {
		return nil
	}
	return mgr.StopEngine(strings.TrimSpace(engineName))
}

func (s *Service) markAssetsIdleForEngine(engineName string) {
	trimmed := strings.ToLower(strings.TrimSpace(engineName))
	if s == nil || trimmed == "" {
		return
	}
	s.mu.RLock()
	models := make([]*runtimev1.LocalAssetRecord, 0, len(s.assets))
	for _, model := range s.assets {
		models = append(models, cloneLocalAsset(model))
	}
	modes := make(map[string]runtimev1.LocalEngineRuntimeMode, len(s.assetRuntimeModes))
	for localAssetID, mode := range s.assetRuntimeModes {
		modes[localAssetID] = mode
	}
	s.mu.RUnlock()

	for _, model := range models {
		if model == nil {
			continue
		}
		localAssetID := strings.TrimSpace(model.GetLocalAssetId())
		if localAssetID == "" {
			continue
		}
		engineNames := residencyEnginesForModel(model, modes[localAssetID])
		if !containsStringFold(engineNames, trimmed) {
			continue
		}
		if isManagedSupervisedImageModel(model, modes[localAssetID]) {
			_, _ = s.ensureModelInstalled(localAssetID, managedLocalImagePendingValidationDetail("keep_alive expired"))
			continue
		}
		_, _ = s.ensureModelInstalled(localAssetID, managedLocalModelIdleDetail())
		s.clearWarmCacheForAsset(localAssetID)
	}
}

func (s *Service) clearWarmCacheForAsset(localAssetID string) {
	id := strings.TrimSpace(localAssetID)
	if s == nil || id == "" {
		return
	}
	prefix := id + "|"
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.warmedModelOrder) == 0 {
		return
	}
	filtered := s.warmedModelOrder[:0]
	for _, key := range s.warmedModelOrder {
		if strings.HasPrefix(key, prefix) {
			delete(s.warmedModelKeys, key)
			continue
		}
		filtered = append(filtered, key)
	}
	s.warmedModelOrder = filtered
}

func managedLocalModelIdleDetail() string {
	return "managed local model ready (idle)"
}

func appendUniqueString(values []string, value string) []string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return values
	}
	for _, existing := range values {
		if strings.EqualFold(strings.TrimSpace(existing), trimmed) {
			return values
		}
	}
	return append(values, trimmed)
}

func dedupeStrings(values []string) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		out = appendUniqueString(out, value)
	}
	return out
}

func containsStringFold(values []string, target string) bool {
	trimmedTarget := strings.ToLower(strings.TrimSpace(target))
	for _, value := range values {
		if strings.ToLower(strings.TrimSpace(value)) == trimmedTarget {
			return true
		}
	}
	return false
}
