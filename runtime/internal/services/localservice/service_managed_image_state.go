package localservice

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/managedimagebackend"
)

type managedImageProfileState struct {
	Alias   string
	Profile map[string]any
}

type managedImageLoadedState struct {
	Alias          string
	ProfileHash    string
	RequestHash    string
	LoadRequest    managedimagebackend.LoadModelRequest
	BackendAddress string
	BackendEpoch   uint64
	VerifiedAt     time.Time
	HoldCount      int
}

type managedImageLoadInflight struct {
	done chan struct{}
	err  error
}

func (s *Service) cacheManagedMediaImageProfile(localAssetID string, alias string, profile map[string]any) {
	id := strings.TrimSpace(localAssetID)
	if s == nil || id == "" || len(profile) == 0 {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.managedImageProfiles == nil {
		s.managedImageProfiles = make(map[string]managedImageProfileState)
	}
	s.managedImageProfiles[id] = managedImageProfileState{
		Alias:   strings.TrimSpace(alias),
		Profile: cloneAnyMap(profile),
	}
}

func (s *Service) cachedManagedMediaImageProfile(localAssetID string) (managedImageProfileState, bool) {
	id := strings.TrimSpace(localAssetID)
	if s == nil || id == "" {
		return managedImageProfileState{}, false
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	state, ok := s.managedImageProfiles[id]
	if !ok {
		return managedImageProfileState{}, false
	}
	return managedImageProfileState{
		Alias:   state.Alias,
		Profile: cloneAnyMap(state.Profile),
	}, true
}

func (s *Service) managedMediaBackendSnapshot() (string, string, uint64) {
	if s == nil {
		return "", "", 0
	}
	s.mu.RLock()
	modelsRoot := resolveLocalModelsPath(s.localModelsPath)
	address := strings.TrimSpace(s.managedMediaBackendAddress)
	epoch := s.managedMediaBackendEpoch
	s.mu.RUnlock()
	return modelsRoot, address, epoch
}

func (s *Service) resetManagedMediaImageLoadCacheLocked() {
	s.managedImageLoadCache = make(map[string]managedImageLoadedState)
}

func (s *Service) clearManagedMediaImageLoadCache(localAssetID string) {
	id := strings.TrimSpace(localAssetID)
	if s == nil || id == "" {
		return
	}
	s.mu.Lock()
	delete(s.managedImageLoadCache, id)
	s.mu.Unlock()
}

func (s *Service) ReleaseManagedMediaImage(ctx context.Context, requestedModelID string, profile map[string]any, scenarioExtensions map[string]any, releaseReason string) error {
	if s == nil {
		return nil
	}
	model := s.resolveManagedMediaImageModel(requestedModelID)
	if model == nil {
		return nil
	}
	return s.releaseManagedSupervisedImage(ctx, model, "", profile, scenarioExtensions, releaseReason)
}

func (s *Service) EnsureManagedMediaImageLoaded(ctx context.Context, requestedModelID string, profile map[string]any, scenarioExtensions map[string]any, loadReason string) error {
	if s == nil {
		return fmt.Errorf("managed local image is unavailable")
	}
	model := s.resolveManagedMediaImageModel(requestedModelID)
	if model == nil {
		return fmt.Errorf("managed local image is unavailable")
	}
	return s.ensureManagedSupervisedImageLoaded(ctx, model, "", profile, scenarioExtensions, loadReason)
}

func (s *Service) ensureManagedSupervisedImageLoaded(
	ctx context.Context,
	model *runtimev1.LocalAssetRecord,
	alias string,
	profile map[string]any,
	scenarioExtensions map[string]any,
	loadReason string,
) error {
	if model == nil {
		return fmt.Errorf("managed local image is unavailable")
	}
	localAssetID := strings.TrimSpace(model.GetLocalAssetId())
	if localAssetID == "" {
		return fmt.Errorf("managed local image is unavailable")
	}
	resolvedAlias := strings.TrimSpace(alias)
	resolvedProfile := cloneAnyMap(profile)
	if len(resolvedProfile) == 0 {
		cached, ok := s.cachedManagedMediaImageProfile(localAssetID)
		if !ok || len(cached.Profile) == 0 {
			return errManagedImageValidationPending
		}
		resolvedAlias = cached.Alias
		resolvedProfile = cached.Profile
	} else {
		s.cacheManagedMediaImageProfile(localAssetID, resolvedAlias, resolvedProfile)
	}

	modelsRoot, backendAddress, backendEpoch := s.managedMediaBackendSnapshot()
	loadReq, err := managedImageLoadRequest(modelsRoot, backendAddress, resolvedProfile, scenarioExtensions)
	if err != nil {
		return err
	}
	loadReq.BackendAddress = backendAddress
	profileHash := managedImageLoadHash(resolvedProfile)
	requestHash := managedImageLoadHash(map[string]any{
		"alias":           resolvedAlias,
		"backend_address": strings.TrimSpace(loadReq.BackendAddress),
		"backend_epoch":   backendEpoch,
		"models_root":     strings.TrimSpace(loadReq.ModelsRoot),
		"model_path":      strings.TrimSpace(loadReq.ModelPath),
		"options":         append([]string(nil), loadReq.Options...),
		"cfg_scale":       loadReq.CFGScale,
		"threads":         loadReq.Threads,
	})
	if s.retainManagedImageLoadCacheEntry(localAssetID, requestHash, strings.TrimSpace(loadReq.BackendAddress), backendEpoch) {
		s.logger.Debug("managed image load cache hit",
			"local_asset_id", localAssetID,
			"profile_alias", resolvedAlias,
			"profile_hash", profileHash,
			"load_reason", defaultString(strings.TrimSpace(loadReason), "unspecified"),
			"cache_hit", true,
			"backend_epoch", backendEpoch,
		)
		return nil
	}

	if err := s.runManagedImageLoadSingleflight(
		ctx,
		localAssetID,
		resolvedAlias,
		profileHash,
		requestHash,
		loadReason,
		backendEpoch,
		loadReq,
	); err != nil {
		return err
	}
	return nil
}

func (s *Service) managedImageLoadCacheHit(localAssetID string, requestHash string, backendAddress string, backendEpoch uint64) bool {
	if s == nil {
		return false
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	entry, ok := s.managedImageLoadCache[strings.TrimSpace(localAssetID)]
	if !ok {
		return false
	}
	return entry.RequestHash == strings.TrimSpace(requestHash) &&
		entry.BackendAddress == strings.TrimSpace(backendAddress) &&
		entry.BackendEpoch == backendEpoch
}

func (s *Service) retainManagedImageLoadCacheEntry(localAssetID string, requestHash string, backendAddress string, backendEpoch uint64) bool {
	if s == nil {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	entry, ok := s.managedImageLoadCache[strings.TrimSpace(localAssetID)]
	if !ok {
		return false
	}
	if entry.RequestHash != strings.TrimSpace(requestHash) ||
		entry.BackendAddress != strings.TrimSpace(backendAddress) ||
		entry.BackendEpoch != backendEpoch {
		return false
	}
	entry.HoldCount++
	s.managedImageLoadCache[strings.TrimSpace(localAssetID)] = entry
	return true
}

func (s *Service) runManagedImageLoadSingleflight(
	ctx context.Context,
	localAssetID string,
	alias string,
	profileHash string,
	requestHash string,
	loadReason string,
	backendEpoch uint64,
	loadReq managedimagebackend.LoadModelRequest,
) error {
	requestHash = strings.TrimSpace(requestHash)
	for {
		if s.retainManagedImageLoadCacheEntry(localAssetID, requestHash, loadReq.BackendAddress, backendEpoch) {
			return nil
		}

		s.mu.Lock()
		if entry, ok := s.managedImageLoadCache[localAssetID]; ok &&
			entry.RequestHash == requestHash &&
			entry.BackendAddress == strings.TrimSpace(loadReq.BackendAddress) &&
			entry.BackendEpoch == backendEpoch {
			entry.HoldCount++
			s.managedImageLoadCache[localAssetID] = entry
			s.mu.Unlock()
			return nil
		}
		if inflight, ok := s.managedImageLoadInflight[requestHash]; ok {
			done := inflight.done
			s.mu.Unlock()
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-done:
				if inflight.err != nil {
					return inflight.err
				}
				continue
			}
		}
		inflight := &managedImageLoadInflight{done: make(chan struct{})}
		s.managedImageLoadInflight[requestHash] = inflight
		s.mu.Unlock()

		s.logger.Info("managed image load ensure",
			"local_asset_id", localAssetID,
			"profile_alias", alias,
			"profile_hash", profileHash,
			"load_reason", defaultString(strings.TrimSpace(loadReason), "unspecified"),
			"cache_hit", false,
			"backend_epoch", backendEpoch,
		)

		loadFn := s.managedImageLoadModel
		if loadFn == nil {
			loadFn = managedimagebackend.LoadModel
		}
		loadErr := loadFn(ctx, loadReq)

		s.mu.Lock()
		if loadErr == nil {
			s.managedImageLoadCache[localAssetID] = managedImageLoadedState{
				Alias:          alias,
				ProfileHash:    profileHash,
				RequestHash:    requestHash,
				LoadRequest:    cloneManagedImageLoadRequest(loadReq),
				BackendAddress: strings.TrimSpace(loadReq.BackendAddress),
				BackendEpoch:   backendEpoch,
				VerifiedAt:     time.Now().UTC(),
				HoldCount:      1,
			}
		}
		inflight.err = loadErr
		close(inflight.done)
		delete(s.managedImageLoadInflight, requestHash)
		s.mu.Unlock()
		return loadErr
	}
}

func (s *Service) freeManagedMediaImageOnIdle(ctx context.Context, localAssetID string, releaseReason string) error {
	id := strings.TrimSpace(localAssetID)
	if s == nil || id == "" {
		return nil
	}
	cached, ok := s.cachedManagedMediaImageProfile(id)
	if !ok || len(cached.Profile) == 0 {
		s.clearManagedMediaImageLoadCache(id)
		return nil
	}
	model := s.modelByID(id)
	if model == nil {
		s.clearManagedMediaImageLoadCache(id)
		return nil
	}
	return s.forceReleaseManagedSupervisedImage(ctx, model, cached.Alias, cached.Profile, releaseReason)
}

func (s *Service) releaseManagedSupervisedImage(
	ctx context.Context,
	model *runtimev1.LocalAssetRecord,
	alias string,
	profile map[string]any,
	scenarioExtensions map[string]any,
	releaseReason string,
) error {
	if model == nil {
		return nil
	}
	localAssetID := strings.TrimSpace(model.GetLocalAssetId())
	if localAssetID == "" {
		return nil
	}
	resolvedAlias := strings.TrimSpace(alias)
	resolvedProfile := cloneAnyMap(profile)
	if len(resolvedProfile) == 0 {
		cached, ok := s.cachedManagedMediaImageProfile(localAssetID)
		if !ok || len(cached.Profile) == 0 {
			return nil
		}
		resolvedAlias = cached.Alias
		resolvedProfile = cached.Profile
	}

	modelsRoot, backendAddress, backendEpoch := s.managedMediaBackendSnapshot()
	loadReq, err := managedImageLoadRequest(modelsRoot, backendAddress, resolvedProfile, scenarioExtensions)
	if err != nil {
		return nil
	}
	loadReq.BackendAddress = backendAddress
	requestHash := managedImageLoadHash(map[string]any{
		"alias":           resolvedAlias,
		"backend_address": strings.TrimSpace(loadReq.BackendAddress),
		"backend_epoch":   backendEpoch,
		"models_root":     strings.TrimSpace(loadReq.ModelsRoot),
		"model_path":      strings.TrimSpace(loadReq.ModelPath),
		"options":         append([]string(nil), loadReq.Options...),
		"cfg_scale":       loadReq.CFGScale,
		"threads":         loadReq.Threads,
	})

	s.mu.Lock()
	if entry, ok := s.managedImageLoadCache[localAssetID]; ok &&
		entry.RequestHash == requestHash &&
		entry.BackendAddress == strings.TrimSpace(loadReq.BackendAddress) &&
		entry.BackendEpoch == backendEpoch {
		if entry.HoldCount > 1 {
			entry.HoldCount--
		} else {
			entry.HoldCount = 0
		}
		entry.VerifiedAt = time.Now().UTC()
		s.managedImageLoadCache[localAssetID] = entry
	}
	s.mu.Unlock()
	return nil
}

func (s *Service) forceReleaseManagedSupervisedImage(
	ctx context.Context,
	model *runtimev1.LocalAssetRecord,
	alias string,
	profile map[string]any,
	releaseReason string,
) error {
	if model == nil {
		return nil
	}
	localAssetID := strings.TrimSpace(model.GetLocalAssetId())
	if localAssetID == "" {
		return nil
	}
	var (
		shouldFree   bool
		cachedAlias  string
		cachedEpoch  uint64
		cachedLoad   managedimagebackend.LoadModelRequest
	)
	s.mu.Lock()
	if entry, ok := s.managedImageLoadCache[localAssetID]; ok {
		delete(s.managedImageLoadCache, localAssetID)
		shouldFree = true
		cachedAlias = entry.Alias
		cachedEpoch = entry.BackendEpoch
		cachedLoad = cloneManagedImageLoadRequest(entry.LoadRequest)
	}
	s.mu.Unlock()
	if !shouldFree {
		return nil
	}

	releaseFn := s.managedImageFreeModel
	if releaseFn == nil {
		releaseFn = managedimagebackend.FreeModel
	}
	cleanupCtx, cancel := managedImageCleanupContext(ctx, 15*time.Second)
	defer cancel()
	s.logger.Info("managed image release",
		"local_asset_id", localAssetID,
		"profile_alias", defaultString(strings.TrimSpace(cachedAlias), strings.TrimSpace(alias)),
		"release_reason", defaultString(strings.TrimSpace(releaseReason), "unspecified"),
		"backend_epoch", cachedEpoch,
	)
	if err := releaseFn(cleanupCtx, cachedLoad); err != nil {
		s.logger.Warn("managed image release failed",
			"local_asset_id", localAssetID,
			"profile_alias", defaultString(strings.TrimSpace(cachedAlias), strings.TrimSpace(alias)),
			"release_reason", defaultString(strings.TrimSpace(releaseReason), "unspecified"),
			"backend_epoch", cachedEpoch,
			"error", err,
		)
		return err
	}
	return nil
}

func cloneManagedImageLoadRequest(input managedimagebackend.LoadModelRequest) managedimagebackend.LoadModelRequest {
	input.Options = append([]string(nil), input.Options...)
	return input
}

func managedImageCleanupContext(ctx context.Context, timeout time.Duration) (context.Context, context.CancelFunc) {
	if timeout <= 0 {
		timeout = 15 * time.Second
	}
	if ctx == nil || ctx.Err() != nil {
		return context.WithTimeout(context.Background(), timeout)
	}
	return context.WithTimeout(context.WithoutCancel(ctx), timeout)
}

func managedImageLoadHash(value any) string {
	raw, err := json.Marshal(value)
	if err != nil {
		return ""
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

func (s *Service) UpdateManagedMediaImageExecutionStatus(_ context.Context, requestedModelID string, healthy bool, detail string) error {
	if s == nil {
		return nil
	}
	model := s.resolveManagedMediaImageModel(requestedModelID)
	if model == nil {
		return nil
	}
	localAssetID := strings.TrimSpace(model.GetLocalAssetId())
	if localAssetID == "" {
		return nil
	}
	if healthy {
		readyDetail := managedLocalImageReadyDetail()
		if strings.TrimSpace(detail) != "" {
			readyDetail = strings.TrimSpace(detail)
		}
		if model.GetStatus() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
			s.setModelHealthDetail(localAssetID, readyDetail)
			return nil
		}
		_, err := s.updateModelStatus(localAssetID, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE, readyDetail)
		return err
	}
	s.clearManagedMediaImageLoadCache(localAssetID)
	failureDetail := managedLocalImageExecutionFailureDetail(detail)
	if model.GetStatus() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY {
		s.setModelHealthDetail(localAssetID, failureDetail)
		return nil
	}
	_, err := s.transitionModelToUnhealthy(localAssetID, failureDetail)
	return err
}
