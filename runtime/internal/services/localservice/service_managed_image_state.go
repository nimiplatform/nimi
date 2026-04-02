package localservice

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

type managedImageProfileState struct {
	Alias   string
	Profile map[string]any
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
	failureDetail := managedLocalImageExecutionFailureDetail(detail)
	if model.GetStatus() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY {
		s.setModelHealthDetail(localAssetID, failureDetail)
		return nil
	}
	_, err := s.transitionModelToUnhealthy(localAssetID, failureDetail)
	return err
}
