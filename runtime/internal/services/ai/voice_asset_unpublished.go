package ai

import (
	"context"
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/runtimeidentity"
	"google.golang.org/protobuf/proto"
)

// @nimi-authority: rule.nimi.runtime.model-catalog.r029
// The existing private pending projection retains a known provider handle
// across output validation, cancellation and terminal publication failure.
// It is excluded from public Get/List and never becomes a failed VoiceAsset.
func (s *voiceAssetStore) stageKnownVoiceResult(draft *runtimev1.VoiceAsset, target *runtimeidentity.Target, binding *voiceAssetCloudBinding, handle string) error {
	if s == nil || draft == nil || target == nil || target.Cloud == nil || !target.Valid() || binding == nil || !binding.Valid() || target.Cloud.ConnectorID != binding.ConnectorID || strings.TrimSpace(handle) == "" {
		return fmt.Errorf("known voice result has no exact private binding")
	}
	asset := cloneVoiceAsset(draft)
	asset.ProviderVoiceRef = handle
	asset.Status = runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_UNSPECIFIED
	s.mu.Lock()
	defer s.mu.Unlock()
	id := asset.GetVoiceAssetId()
	if s.assets[id] != nil {
		return fmt.Errorf("known voice result identity already exists")
	}
	s.assets[id], s.targets[id], s.cloudBindings[id], s.pending[id] = asset, target.Clone(), binding.Clone(), true
	// Retain in-memory custody when the disk is unavailable; cleanup is still
	// attempted before returning and a failed cleanup remains visible in audit.
	return s.persistDurableAssetsLocked()
}

func (s *Service) cleanupUnpublishedVoiceResult(ctx context.Context, jobID string, draft *runtimev1.VoiceAsset, target *runtimeidentity.Target, binding *voiceAssetCloudBinding, handle string) {
	cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 15*time.Second)
	defer cancel()
	s.performUnpublishedVoiceCleanup(cleanupCtx, jobID, draft, target, binding, handle)
}

func (s *voiceAssetStore) claimVoiceDelete(id string) (func(), bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.assets[id] == nil || s.deleteInFlight[id] {
		return nil, false
	}
	s.deleteInFlight[id] = true
	return func() { s.mu.Lock(); delete(s.deleteInFlight, id); s.mu.Unlock() }, true
}

func (s *Service) performUnpublishedVoiceCleanup(ctx context.Context, jobID string, draft *runtimev1.VoiceAsset, target *runtimeidentity.Target, binding *voiceAssetCloudBinding, handle string) {
	if strings.TrimSpace(handle) == "" || draft == nil {
		return
	}
	if ctx.Err() != nil {
		return
	}
	release, claimed := s.voiceAssets.claimVoiceDelete(draft.GetVoiceAssetId())
	if !claimed {
		return
	}
	defer release()
	if completed, _, ok := s.scenarioJobs.completedVoiceResult(draft.GetVoiceAssetId()); ok && completed.GetProviderVoiceRef() == handle {
		return
	}
	asset, _, _, ok := s.voiceAssets.unpublishedVoiceBinding(draft.GetVoiceAssetId())
	if !ok || asset.GetProviderVoiceRef() != handle || asset.GetMetadata().GetFields()["provider_delete_succeeded"].GetBoolValue() {
		return
	}
	result := s.deleteProviderPersistentVoiceAsset(ctx, asset, target, binding)
	if !result.Attempted {
		result = voiceAssetDeleteFailure(voiceAssetDeleteResult{ReconciliationRequired: true, DeleteSemantics: "best_effort_provider_delete", RetryAttemptCount: nextVoiceAssetDeleteRetryAttempt(asset), LastAttemptAt: time.Now().UTC()}, fmt.Errorf("provider cleanup could not be dispatched"))
	}
	if err := s.voiceAssets.finishUnpublishedCleanup(asset, target, binding, result); err != nil && s.logger != nil {
		s.logger.Error("known unpublished provider voice cleanup could not be persisted", "job_id", jobID, "error", err)
	}
	s.recordVoiceAssetDeleteAudit(asset, "voice_asset.unpublished_cleanup", result)
}

func (s *voiceAssetStore) unpublishedVoiceBinding(id string) (*runtimev1.VoiceAsset, *runtimeidentity.Target, *voiceAssetCloudBinding, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if !s.pending[id] || s.assets[id] == nil {
		return nil, nil, nil, false
	}
	return cloneVoiceAsset(s.assets[id]), s.targets[id].Clone(), s.cloudBindings[id].Clone(), true
}

func (s *voiceAssetStore) finishUnpublishedCleanup(asset *runtimev1.VoiceAsset, target *runtimeidentity.Target, binding *voiceAssetCloudBinding, result voiceAssetDeleteResult) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	id := asset.GetVoiceAssetId()
	current := s.assets[id]
	if current == nil {
		return nil
	}
	if !s.pending[id] {
		return fmt.Errorf("refuse cleanup of a published VoiceAsset")
	}
	if current.GetProviderVoiceRef() != asset.GetProviderVoiceRef() || current.GetMetadata().GetFields()["provider_delete_succeeded"].GetBoolValue() {
		return nil
	}
	private := cloneVoiceAsset(asset)
	private.Status = runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_DELETED
	applyVoiceAssetDeleteResultMetadata(private, result, time.Now().UTC())
	s.assets[id], s.targets[id], s.cloudBindings[id], s.pending[id] = private, target.Clone(), binding.Clone(), true
	if !result.Succeeded {
		return s.persistDurableAssetsLocked()
	}
	// First commit the actual deletion outcome. A later prune failure leaves
	// a private succeeded tombstone, so restart never deletes this handle twice.
	if err := s.persistDurableAssetsLocked(); err != nil {
		return err
	}
	delete(s.assets, id)
	delete(s.targets, id)
	delete(s.cloudBindings, id)
	delete(s.pending, id)
	if err := s.persistDurableAssetsLocked(); err != nil {
		s.assets[id], s.targets[id], s.cloudBindings[id], s.pending[id] = private, target.Clone(), binding.Clone(), true
		return err
	}
	return nil
}

func (s *Service) reconcileUnpublishedVoiceDeletes(ctx context.Context, appID, subjectID string, limit int) {
	if limit <= 0 || ctx.Err() != nil {
		return
	}
	sweepCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	s.voiceAssets.mu.RLock()
	var assets []*runtimev1.VoiceAsset
	for id := range s.voiceAssets.pending {
		asset := s.voiceAssets.assets[id]
		if asset == nil || asset.GetAppId() != appID || asset.GetSubjectUserId() != subjectID || asset.GetStatus() != runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_DELETED {
			continue
		}
		fields := asset.GetMetadata().GetFields()
		if fields["provider_delete_succeeded"].GetBoolValue() || fields["provider_delete_reconciliation_exhausted"].GetBoolValue() {
			continue
		}
		if next := fields["provider_delete_next_retry_at"].GetStringValue(); next != "" {
			if at, err := time.Parse(time.RFC3339Nano, next); err == nil && time.Now().Before(at) {
				continue
			}
		}
		assets = append(assets, cloneVoiceAsset(asset))
		if len(assets) >= limit {
			break
		}
	}
	s.voiceAssets.mu.RUnlock()
	for _, asset := range assets {
		if sweepCtx.Err() != nil {
			break
		}
		_, target, binding, ok := s.voiceAssets.unpublishedVoiceBinding(asset.GetVoiceAssetId())
		if !ok {
			continue
		}
		s.performUnpublishedVoiceCleanup(sweepCtx, asset.GetVoiceAssetId(), asset, target, binding, asset.GetProviderVoiceRef())
	}
}

func sameStagedVoiceResult(existing, draft *runtimev1.VoiceAsset, target, storedTarget *runtimeidentity.Target, binding, storedBinding *voiceAssetCloudBinding, handle string) bool {
	return existing != nil && existing.GetStatus() == runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_UNSPECIFIED && existing.GetAppId() == draft.GetAppId() && existing.GetSubjectUserId() == draft.GetSubjectUserId() && existing.GetProviderVoiceRef() == handle && runtimeidentity.Equal(target, storedTarget) && binding != nil && storedBinding != nil && binding.ConnectorID == storedBinding.ConnectorID && proto.Equal(binding.Implementation, storedBinding.Implementation) && proto.Equal(binding.ProviderModelTarget, storedBinding.ProviderModelTarget)
}
