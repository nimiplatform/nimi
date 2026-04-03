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
	BackendAddress string
	BackendEpoch   uint64
	VerifiedAt     time.Time
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

func (s *Service) EnsureManagedMediaImageLoaded(ctx context.Context, requestedModelID string, profile map[string]any, loadReason string) error {
	if s == nil {
		return fmt.Errorf("managed local image is unavailable")
	}
	model := s.resolveManagedMediaImageModel(requestedModelID)
	if model == nil {
		return fmt.Errorf("managed local image is unavailable")
	}
	return s.ensureManagedSupervisedImageLoaded(ctx, model, "", profile, loadReason)
}

func (s *Service) ensureManagedSupervisedImageLoaded(
	ctx context.Context,
	model *runtimev1.LocalAssetRecord,
	alias string,
	profile map[string]any,
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
	loadReq, err := managedImageLoadRequest(modelsRoot, backendAddress, resolvedProfile)
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
	if s.managedImageLoadCacheHit(localAssetID, requestHash, strings.TrimSpace(loadReq.BackendAddress), backendEpoch) {
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
		if s.managedImageLoadCacheHit(localAssetID, requestHash, loadReq.BackendAddress, backendEpoch) {
			return nil
		}

		s.mu.Lock()
		if entry, ok := s.managedImageLoadCache[localAssetID]; ok &&
			entry.RequestHash == requestHash &&
			entry.BackendAddress == strings.TrimSpace(loadReq.BackendAddress) &&
			entry.BackendEpoch == backendEpoch {
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
				BackendAddress: strings.TrimSpace(loadReq.BackendAddress),
				BackendEpoch:   backendEpoch,
				VerifiedAt:     time.Now().UTC(),
			}
		}
		inflight.err = loadErr
		close(inflight.done)
		delete(s.managedImageLoadInflight, requestHash)
		s.mu.Unlock()
		return loadErr
	}
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
