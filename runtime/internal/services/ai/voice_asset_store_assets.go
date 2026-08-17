package ai

import (
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/runtimeidentity"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *voiceAssetStore) getAsset(voiceAssetID string) (*runtimev1.VoiceAsset, bool) {
	id := strings.TrimSpace(voiceAssetID)
	if id == "" {
		return nil, false
	}
	s.mu.RLock()
	asset, ok := s.assets[id]
	if !ok || s.pending[id] {
		s.mu.RUnlock()
		return nil, false
	}
	out := cloneVoiceAsset(asset)
	s.mu.RUnlock()
	return out, true
}

func (s *voiceAssetStore) getAssetBinding(voiceAssetID string) (*runtimev1.VoiceAsset, *runtimeidentity.Target, bool) {
	id := strings.TrimSpace(voiceAssetID)
	if id == "" {
		return nil, nil, false
	}
	s.mu.RLock()
	asset, ok := s.assets[id]
	target := s.targets[id]
	if !ok || s.pending[id] || asset == nil || target == nil || !target.Valid() {
		s.mu.RUnlock()
		return nil, nil, false
	}
	out := cloneVoiceAsset(asset)
	outTarget := target.Clone()
	s.mu.RUnlock()
	return out, outTarget, true
}

// publishResult makes one VoiceAsset visible only when the primary
// ScenarioJob terminal result commits. The VoiceAsset store owns asset
// content and private execution binding only; it never owns Job lifecycle.
func (s *voiceAssetStore) publishResult(
	draft *runtimev1.VoiceAsset,
	target *runtimeidentity.Target,
	binding *voiceAssetCloudBinding,
	providerVoiceRef string,
	metadata map[string]any,
	commit func(*runtimev1.VoiceAsset, *runtimev1.VoiceReference) bool,
) (*runtimev1.VoiceAsset, bool) {
	providerVoiceRef = strings.TrimSpace(providerVoiceRef)
	if s == nil || draft == nil || target == nil || !target.Valid() ||
		strings.TrimSpace(draft.GetVoiceAssetId()) == "" || providerVoiceRef == "" || commit == nil {
		return nil, false
	}
	persistent := draft.GetPersistence() == runtimev1.VoiceAssetPersistence_VOICE_ASSET_PERSISTENCE_PROVIDER_PERSISTENT
	if persistent {
		if target.Cloud == nil || binding == nil || !binding.Valid() || target.Cloud.ConnectorID != strings.TrimSpace(binding.ConnectorID) {
			return nil, false
		}
	} else if draft.GetPersistence() != runtimev1.VoiceAssetPersistence_VOICE_ASSET_PERSISTENCE_SESSION_EPHEMERAL || target.Local == nil || binding != nil {
		return nil, false
	}
	asset := cloneVoiceAsset(draft)
	asset.ProviderVoiceRef = providerVoiceRef
	if len(metadata) > 0 {
		asset.Metadata = structFromMap(metadata)
	}
	asset.Status = runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_ACTIVE
	now := timestamppb.New(time.Now().UTC())
	if asset.GetCreatedAt() == nil {
		asset.CreatedAt = now
	}
	asset.UpdatedAt = now
	id := strings.TrimSpace(asset.GetVoiceAssetId())
	reference := voiceAssetReference(id)

	s.mu.Lock()
	if s.assets[id] != nil {
		s.mu.Unlock()
		return nil, false
	}
	s.assets[id] = cloneVoiceAsset(asset)
	s.targets[id] = target.Clone()
	if persistent {
		s.cloudBindings[id] = binding.Clone()
		s.pending[id] = true
		if err := s.persistDurableAssetsLocked(); err != nil {
			delete(s.assets, id)
			delete(s.targets, id)
			delete(s.cloudBindings, id)
			delete(s.pending, id)
			s.mu.Unlock()
			return nil, false
		}
	}
	if !commit(asset, reference) {
		delete(s.assets, id)
		delete(s.targets, id)
		delete(s.cloudBindings, id)
		delete(s.pending, id)
		if persistent {
			_ = s.persistDurableAssetsLocked()
		}
		s.mu.Unlock()
		return nil, false
	}
	if persistent {
		// The primary ScenarioJob result is now durable. Promotion only changes
		// the VoiceAsset library projection; if this write fails, the current
		// process stays ACTIVE and restart reconciliation promotes the durable
		// pending record from that primary completed result.
		delete(s.pending, id)
		_ = s.persistDurableAssetsLocked()
	}
	s.mu.Unlock()
	return cloneVoiceAsset(asset), true
}

func (s *voiceAssetStore) getAssetCloudBinding(voiceAssetID string) (*runtimev1.VoiceAsset, *runtimeidentity.Target, *voiceAssetCloudBinding, bool) {
	id := strings.TrimSpace(voiceAssetID)
	if id == "" {
		return nil, nil, nil, false
	}
	s.mu.RLock()
	asset := s.assets[id]
	target := s.targets[id]
	binding := s.cloudBindings[id]
	if s.pending[id] || asset == nil || target == nil || !target.Valid() {
		s.mu.RUnlock()
		return nil, nil, nil, false
	}
	out, outTarget, outBinding := cloneVoiceAsset(asset), target.Clone(), binding.Clone()
	s.mu.RUnlock()
	return out, outTarget, outBinding, true
}

func (s *voiceAssetStore) listAssets(req *runtimev1.ListVoiceAssetsRequest) []*runtimev1.VoiceAsset {
	if req == nil {
		return nil
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	items := make([]*runtimev1.VoiceAsset, 0, len(s.assets))
	for _, asset := range s.assets {
		if s.pending[strings.TrimSpace(asset.GetVoiceAssetId())] {
			continue
		}
		if strings.TrimSpace(req.GetAppId()) != "" && asset.GetAppId() != req.GetAppId() {
			continue
		}
		if strings.TrimSpace(req.GetSubjectUserId()) != "" && asset.GetSubjectUserId() != req.GetSubjectUserId() {
			continue
		}
		if strings.TrimSpace(req.GetModelId()) != "" && asset.GetModelId() != req.GetModelId() {
			continue
		}
		if strings.TrimSpace(req.GetTargetModelId()) != "" && asset.GetTargetModelId() != req.GetTargetModelId() {
			continue
		}
		if req.GetCreationSource() != runtimev1.VoiceCreationSource_VOICE_CREATION_SOURCE_UNSPECIFIED && asset.GetCreationSource() != req.GetCreationSource() {
			continue
		}
		if req.GetStatus() != runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_UNSPECIFIED && asset.GetStatus() != req.GetStatus() {
			continue
		}
		items = append(items, cloneVoiceAsset(asset))
	}
	return items
}

func (s *voiceAssetStore) deleteAsset(voiceAssetID string) bool {
	return s.deleteAssetWithResult(voiceAssetID, voiceAssetDeleteResult{})
}

func (s *voiceAssetStore) deleteAssetWithResult(voiceAssetID string, result voiceAssetDeleteResult) bool {
	id := strings.TrimSpace(voiceAssetID)
	if id == "" {
		return false
	}
	s.mu.Lock()
	asset, ok := s.assets[id]
	if !ok || s.pending[id] {
		s.mu.Unlock()
		return false
	}
	asset.Status = runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_DELETED
	nowTime := time.Now().UTC()
	asset.UpdatedAt = timestamppb.New(nowTime)
	applyVoiceAssetDeleteResultMetadata(asset, result, nowTime)
	_ = s.persistDurableAssetsLocked()
	s.mu.Unlock()
	return true
}

func (s *voiceAssetStore) updateAssetDeleteResult(voiceAssetID string, result voiceAssetDeleteResult) bool {
	id := strings.TrimSpace(voiceAssetID)
	if id == "" {
		return false
	}
	s.mu.Lock()
	asset, ok := s.assets[id]
	if !ok || s.pending[id] || asset == nil {
		s.mu.Unlock()
		return false
	}
	nowTime := time.Now().UTC()
	asset.UpdatedAt = timestamppb.New(nowTime)
	applyVoiceAssetDeleteResultMetadata(asset, result, nowTime)
	_ = s.persistDurableAssetsLocked()
	s.mu.Unlock()
	return true
}

func (s *voiceAssetStore) updateDeletedAssetReconciliationResult(voiceAssetID string, result voiceAssetDeleteResult) bool {
	id := strings.TrimSpace(voiceAssetID)
	if id == "" {
		return false
	}
	s.mu.Lock()
	asset, ok := s.assets[id]
	if !ok || s.pending[id] || asset == nil || asset.GetStatus() != runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_DELETED {
		s.mu.Unlock()
		return false
	}
	nowTime := time.Now().UTC()
	asset.UpdatedAt = timestamppb.New(nowTime)
	applyVoiceAssetDeleteResultMetadata(asset, result, nowTime)
	_ = s.persistDurableAssetsLocked()
	s.mu.Unlock()
	return true
}

func (s *voiceAssetStore) listPendingDeleteReconciliationAssets(appID string, subjectUserID string, now time.Time, limit int) []*runtimev1.VoiceAsset {
	if limit <= 0 {
		return nil
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	items := make([]*runtimev1.VoiceAsset, 0, limit)
	for _, asset := range s.assets {
		if s.pending[strings.TrimSpace(asset.GetVoiceAssetId())] {
			continue
		}
		if asset == nil || asset.GetStatus() != runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_DELETED {
			continue
		}
		if strings.TrimSpace(appID) != "" && asset.GetAppId() != strings.TrimSpace(appID) {
			continue
		}
		if strings.TrimSpace(subjectUserID) != "" && asset.GetSubjectUserId() != strings.TrimSpace(subjectUserID) {
			continue
		}
		fields := asset.GetMetadata().GetFields()
		if !fields["provider_delete_reconciliation_pending"].GetBoolValue() {
			continue
		}
		if fields["provider_delete_reconciliation_exhausted"].GetBoolValue() {
			continue
		}
		if !fields["voice_handle_policy_runtime_reconciliation_required"].GetBoolValue() {
			continue
		}
		if nextRetry := strings.TrimSpace(fields["provider_delete_next_retry_at"].GetStringValue()); nextRetry != "" {
			if parsed, err := time.Parse(time.RFC3339Nano, nextRetry); err == nil && now.Before(parsed.UTC()) {
				continue
			}
		}
		if lastAttempt := strings.TrimSpace(fields["provider_delete_last_attempt_at"].GetStringValue()); lastAttempt != "" {
			if parsed, err := time.Parse(time.RFC3339Nano, lastAttempt); err == nil && now.Sub(parsed.UTC()) < voiceAssetDeleteRetryCooldown {
				continue
			}
		}
		items = append(items, cloneVoiceAsset(asset))
		if len(items) >= limit {
			break
		}
	}
	return items
}
