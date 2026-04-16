package ai

import (
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *voiceAssetStore) getAsset(voiceAssetID string) (*runtimev1.VoiceAsset, bool) {
	id := strings.TrimSpace(voiceAssetID)
	if id == "" {
		return nil, false
	}
	s.mu.RLock()
	asset, ok := s.assets[id]
	if !ok {
		s.mu.RUnlock()
		return nil, false
	}
	out := cloneVoiceAsset(asset)
	s.mu.RUnlock()
	return out, true
}

func (s *voiceAssetStore) listAssets(req *runtimev1.ListVoiceAssetsRequest) []*runtimev1.VoiceAsset {
	if req == nil {
		return nil
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	items := make([]*runtimev1.VoiceAsset, 0, len(s.assets))
	for _, asset := range s.assets {
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
		if req.GetWorkflowType() != runtimev1.VoiceWorkflowType_VOICE_WORKFLOW_TYPE_UNSPECIFIED && asset.GetWorkflowType() != req.GetWorkflowType() {
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
	if !ok {
		s.mu.Unlock()
		return false
	}
	asset.Status = runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_DELETED
	nowTime := time.Now().UTC()
	asset.UpdatedAt = timestamppb.New(nowTime)
	applyVoiceAssetDeleteResultMetadata(asset, result, nowTime)
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
	if !ok || asset == nil || asset.GetStatus() != runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_DELETED {
		s.mu.Unlock()
		return false
	}
	nowTime := time.Now().UTC()
	asset.UpdatedAt = timestamppb.New(nowTime)
	applyVoiceAssetDeleteResultMetadata(asset, result, nowTime)
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
