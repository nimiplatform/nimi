package ai

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/texttarget"
)

func (s *Service) acquireSelectedLocalModelLease(
	ctx context.Context,
	requestedModelID string,
	remoteTarget *nimillm.RemoteTarget,
	modal runtimev1.Modal,
	leaseReason string,
) (func(), error) {
	if s == nil || s.localModel == nil || remoteTarget != nil {
		return func() {}, nil
	}
	resolvedModelID, err := texttarget.ResolveInternalDefaultAlias(s.selector.targetConfig, requestedModelID)
	if err != nil {
		return func() {}, nil
	}
	if preferredRoute(resolvedModelID) != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL {
		return func() {}, nil
	}
	localModels, err := s.listAllLocalModels(ctx, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNSPECIFIED)
	if err != nil {
		return nil, err
	}
	selected, reason, unavailableDetail := selectRunnableLocalModel(localModels, parseLocalModelSelector(resolvedModelID, modal))
	if reason != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		if unavailableDetail != "" {
			return nil, localModelUnavailableError(unavailableDetail)
		}
		return func() {}, nil
	}
	if selected == nil || strings.TrimSpace(selected.GetLocalAssetId()) == "" {
		return func() {}, nil
	}
	localAssetID := strings.TrimSpace(selected.GetLocalAssetId())
	if err := s.localModel.AcquireLocalAssetLease(ctx, localAssetID, leaseReason); err != nil {
		return nil, err
	}
	return func() {
		_ = s.localModel.ReleaseLocalAssetLease(context.Background(), localAssetID, leaseReason+"_cleanup")
	}, nil
}
