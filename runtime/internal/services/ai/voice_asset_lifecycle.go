package ai

import (
	"context"
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/remoteexecution"
	"github.com/nimiplatform/nimi/runtime/internal/runtimeidentity"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type voiceAssetCloudLifecycle struct {
	intent    executionintent.Intent
	driver    capabilitydriver.CloudMediaDriver
	target    capabilitydriver.CloudMediaTarget
	connector connector.ConnectorRecord
}

func (s *Service) resolveVoiceAssetCloudLifecycle(asset *runtimev1.VoiceAsset, target *runtimeidentity.Target, binding *voiceAssetCloudBinding) (*voiceAssetCloudLifecycle, error) {
	if asset == nil || target == nil || target.Cloud == nil || !target.Valid() || binding == nil || !binding.Valid() || s.cloudMediaDrivers == nil || s.connStore == nil || s.remoteMediaHost == nil {
		return nil, fmt.Errorf("voice asset private execution binding is unavailable")
	}
	intent := executionintent.Intent{CapabilityContract: binding.CapabilityContract, Route: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
		ConnectorRef: binding.ConnectorID, CloudImplementation: binding.Implementation, ProviderModelTarget: binding.ProviderModelTarget}
	if !intent.IsAIConfigCloud() || binding.ConnectorID != target.Cloud.ConnectorID || target.Cloud.Provider != asset.GetProvider() {
		return nil, fmt.Errorf("voice asset private execution binding is inconsistent")
	}
	driver, driverTarget, err := s.cloudMediaDrivers.Resolve(capabilitydriver.IdentityFromProto(intent.CloudImplementation), intent.ProviderModelTarget, intent.CapabilityContract)
	if err != nil {
		return nil, cloudMediaDriverError(intent.CapabilityContract, err)
	}
	if driverTarget.Provider() != target.Cloud.Provider || driverTarget.ProviderModelID() != target.Cloud.ProviderModelID || driverTarget.RemoteModelCatalogID() != target.Cloud.RemoteModelCatalogID {
		return nil, fmt.Errorf("voice asset Driver target no longer matches its captured execution target")
	}
	record, found, err := s.connStore.Get(binding.ConnectorID)
	if err != nil {
		return nil, err
	}
	if !found || record.Kind != runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED || record.OwnerType != runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER || strings.TrimSpace(record.OwnerID) != asset.GetSubjectUserId() || record.Status != runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE || !record.HasCredential || record.Provider != driverTarget.Provider() {
		return nil, fmt.Errorf("voice asset captured Connector is unavailable for its owner")
	}
	return &voiceAssetCloudLifecycle{intent: intent, driver: driver, target: driverTarget, connector: record}, nil
}

func (b *voiceAssetCloudLifecycle) audit(asset *runtimev1.VoiceAsset, operation string) remoteexecution.MediaDispatchAudit {
	return remoteexecution.MediaDispatchAudit{AppID: asset.GetAppId(), AccountID: asset.GetSubjectUserId(), TraceID: ulid.Make().String(), CapabilityContract: operation,
		ImplementationID: b.intent.CloudImplementation.GetImplementationId(), DriverID: b.intent.CloudImplementation.GetDriverId(), DriverDialect: b.intent.CloudImplementation.GetDriverDialect(),
		ConnectorID: b.connector.ConnectorID, Provider: b.target.Provider(), ProviderModelID: b.target.ProviderModelID(), RemoteModelCatalogID: b.target.RemoteModelCatalogID(), Region: b.target.Region()}
}

// @nimi-authority: rule.nimi.runtime.model-catalog.r029
func providerVoiceNeedsInspection(asset *runtimev1.VoiceAsset) bool {
	return asset != nil && asset.GetPersistence() == runtimev1.VoiceAssetPersistence_VOICE_ASSET_PERSISTENCE_PROVIDER_PERSISTENT && asset.GetExpiresAt() != nil &&
		asset.GetStatus() != runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_DELETED && asset.GetMetadata().GetFields()["voice_handle_policy_runtime_reconciliation_required"].GetBoolValue()
}

func (s *Service) refreshProviderVoiceAsset(ctx context.Context, asset *runtimev1.VoiceAsset) (*runtimev1.VoiceAsset, error) {
	if !providerVoiceNeedsInspection(asset) {
		return asset, nil
	}
	_, target, binding, ok := s.voiceAssets.getAssetCloudBinding(asset.GetVoiceAssetId())
	if !ok {
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	bound, err := s.resolveVoiceAssetCloudLifecycle(asset, target, binding)
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	mapped, err := bound.driver.MapVoiceInspectRequest(bound.target, asset.GetProviderVoiceRef())
	if err != nil {
		return nil, cloudMediaDriverError("voice.create", err)
	}
	response, found, err := s.remoteMediaHost.InspectVoiceAsset(ctx, bound.connector, bound.target, mapped, bound.audit(asset, "voice_asset.inspect"))
	if err != nil {
		return nil, bound.driver.NormalizeReason(bound.target, err)
	}
	updated := cloneVoiceAsset(asset)
	if found {
		result, err := bound.driver.NormalizeVoiceWorkflowResponse(response)
		if err != nil || result.ProviderVoiceRef != asset.GetProviderVoiceRef() || result.ExpiresAt == nil {
			return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
		updated.ExpiresAt = result.ExpiresAt
		updated.Status = runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_ACTIVE
		if !result.ExpiresAt.AsTime().After(time.Now().UTC()) {
			updated.Status = runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_EXPIRED
		}
	} else {
		// Only a provider-confirmed missing resource establishes expiration.
		updated.Status = runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_EXPIRED
	}
	updated.UpdatedAt = timestamppb.Now()
	return s.voiceAssets.commitVoiceInspection(asset, updated)
}

func (s *voiceAssetStore) commitVoiceInspection(before, after *runtimev1.VoiceAsset) (*runtimev1.VoiceAsset, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	id := before.GetVoiceAssetId()
	current := s.assets[id]
	if current == nil || s.pending[id] {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_VOICE_ASSET_NOT_FOUND)
	}
	if !proto.Equal(current, before) {
		return cloneVoiceAsset(current), nil
	}
	s.assets[id] = cloneVoiceAsset(after)
	if err := s.persistDurableAssetsLocked(); err != nil {
		s.assets[id] = current
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	return cloneVoiceAsset(after), nil
}

func (s *Service) reconcileProviderVoiceExpirations(ctx context.Context, appID, subjectID string, limit int) {
	for _, asset := range s.voiceAssets.listAssets(&runtimev1.ListVoiceAssetsRequest{AppId: appID, SubjectUserId: subjectID}) {
		if ctx.Err() != nil {
			break
		}
		if !providerVoiceNeedsInspection(asset) || (asset.GetUpdatedAt() != nil && time.Since(asset.GetUpdatedAt().AsTime()) < voiceAssetDeleteRetryCooldown) {
			continue
		}
		if limit <= 0 {
			break
		}
		limit--
		// Failed reads preserve the last known provider fact; they never mark a
		// voice expired or deleted. An explicit Get or synthesis fails closed.
		_, _ = s.refreshProviderVoiceAsset(ctx, asset)
	}
}
