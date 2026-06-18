package ai

import (
	"context"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/texttarget"
)

func (p *localModelExecutionPlan) selectedLocalAssetID() string {
	if p == nil || p.selected == nil {
		return ""
	}
	return strings.TrimSpace(p.selected.GetLocalAssetId())
}

func (p *localModelExecutionPlan) appliesToModel(modelID string, modal runtimev1.Modal) bool {
	if p == nil {
		return false
	}
	if !localModelPlanModalMatches(p.modal, modal) {
		return false
	}
	selector := parseLocalModelSelector(p.resolvedModelID, modal)
	candidate := parseLocalModelSelector(modelID, modal)
	candidateModelID := normalizeComparableModelID(candidate.modelID)
	if normalizeComparableModelID(selector.modelID) == candidateModelID {
		return true
	}
	if normalizeComparableModelID(p.providerModelID) == candidateModelID {
		return true
	}
	return localModelMatchesComparableID(p.selected, candidateModelID)
}

func (p *localModelExecutionPlan) resolvedProviderModelID(fallback string) string {
	if p == nil {
		return strings.TrimSpace(fallback)
	}
	if trimmed := strings.TrimSpace(p.providerModelID); trimmed != "" {
		return trimmed
	}
	return strings.TrimSpace(fallback)
}

func applyLocalExecutionPlanModelResolved(plan *localModelExecutionPlan, modelResolved string, remoteTarget *nimillm.RemoteTarget, selected provider) string {
	if plan == nil || remoteTarget != nil || selected == nil || selected.Route() != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL {
		return strings.TrimSpace(modelResolved)
	}
	return plan.resolvedProviderModelID(modelResolved)
}

func localModelPlanModalMatches(planModal runtimev1.Modal, executionModal runtimev1.Modal) bool {
	if planModal == executionModal {
		return true
	}
	if planModal != runtimev1.Modal_MODAL_UNSPECIFIED {
		return false
	}
	switch executionModal {
	case runtimev1.Modal_MODAL_TEXT, runtimev1.Modal_MODAL_EMBEDDING:
		return true
	default:
		return false
	}
}

func (s *Service) acquireSelectedLocalModelLease(
	ctx context.Context,
	requestedModelID string,
	remoteTarget *nimillm.RemoteTarget,
	modal runtimev1.Modal,
	leaseReason string,
) (func(), error) {
	return s.acquireSelectedLocalModelLeaseWithPlan(ctx, nil, requestedModelID, remoteTarget, modal, leaseReason)
}

func (s *Service) acquireSelectedLocalModelLeaseWithPlan(
	ctx context.Context,
	plan *localModelExecutionPlan,
	requestedModelID string,
	remoteTarget *nimillm.RemoteTarget,
	modal runtimev1.Modal,
	leaseReason string,
) (func(), error) {
	totalStartedAt := time.Now()
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
	if plan != nil && plan.appliesToModel(resolvedModelID, modal) {
		localAssetID := plan.selectedLocalAssetID()
		if localAssetID == "" {
			return func() {}, nil
		}
		selected := plan.selected
		acquireStartedAt := time.Now()
		s.observeCounter("runtime_ai_local_lease_plan_reuse_total", 1,
			localModelTelemetryAttrs(requestedModelID, resolvedModelID, modal, selected,
				"lease_reason", strings.TrimSpace(leaseReason),
				"readiness_source", strings.TrimSpace(plan.readinessSource),
			)...,
		)
		s.observeCounter("runtime_ai_local_lease_acquire_total", 1,
			localModelTelemetryAttrs(requestedModelID, resolvedModelID, modal, selected,
				"lease_reason", strings.TrimSpace(leaseReason),
			)...,
		)
		if err := s.localModel.AcquireLocalAssetLease(ctx, localAssetID, leaseReason); err != nil {
			return nil, err
		}
		s.observeLatency("runtime.ai.local.lease_total_ms", totalStartedAt,
			localModelTelemetryAttrs(requestedModelID, resolvedModelID, modal, selected,
				"lease_reason", strings.TrimSpace(leaseReason),
				"plan_reused", true,
				"readiness_source", strings.TrimSpace(plan.readinessSource),
			)...,
		)
		s.observeLatency("runtime.ai.local.lease_acquire_ms", acquireStartedAt,
			localModelTelemetryAttrs(requestedModelID, resolvedModelID, modal, selected,
				"lease_reason", strings.TrimSpace(leaseReason),
				"plan_reused", true,
			)...,
		)
		return func() {
			releaseStartedAt := time.Now()
			_ = s.localModel.ReleaseLocalAssetLease(context.Background(), localAssetID, leaseReason+"_cleanup")
			s.observeCounter("runtime_ai_local_lease_release_total", 1,
				localModelTelemetryAttrs(requestedModelID, resolvedModelID, modal, selected,
					"lease_reason", strings.TrimSpace(leaseReason),
				)...,
			)
			s.observeLatency("runtime.ai.local.lease_release_ms", releaseStartedAt,
				localModelTelemetryAttrs(requestedModelID, resolvedModelID, modal, selected,
					"lease_reason", strings.TrimSpace(leaseReason),
					"plan_reused", true,
				)...,
			)
		}, nil
	}
	listStartedAt := time.Now()
	localModels, err := s.listAllLocalModels(ctx, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNSPECIFIED)
	s.observeLatency("runtime.ai.local.lease_list_ms", listStartedAt,
		localModelTelemetryAttrs(requestedModelID, resolvedModelID, modal, nil,
			"lease_reason", strings.TrimSpace(leaseReason),
			"model_count", len(localModels),
		)...,
	)
	s.observeCounter("runtime_ai_local_lease_list_total", 1,
		localModelTelemetryAttrs(requestedModelID, resolvedModelID, modal, nil,
			"lease_reason", strings.TrimSpace(leaseReason),
		)...,
	)
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
	acquireStartedAt := time.Now()
	s.observeCounter("runtime_ai_local_lease_acquire_total", 1,
		localModelTelemetryAttrs(requestedModelID, resolvedModelID, modal, selected,
			"lease_reason", strings.TrimSpace(leaseReason),
		)...,
	)
	if err := s.localModel.AcquireLocalAssetLease(ctx, localAssetID, leaseReason); err != nil {
		return nil, err
	}
	s.observeLatency("runtime.ai.local.lease_total_ms", totalStartedAt,
		localModelTelemetryAttrs(requestedModelID, resolvedModelID, modal, selected,
			"lease_reason", strings.TrimSpace(leaseReason),
		)...,
	)
	s.observeLatency("runtime.ai.local.lease_acquire_ms", acquireStartedAt,
		localModelTelemetryAttrs(requestedModelID, resolvedModelID, modal, selected,
			"lease_reason", strings.TrimSpace(leaseReason),
		)...,
	)
	return func() {
		releaseStartedAt := time.Now()
		_ = s.localModel.ReleaseLocalAssetLease(context.Background(), localAssetID, leaseReason+"_cleanup")
		s.observeCounter("runtime_ai_local_lease_release_total", 1,
			localModelTelemetryAttrs(requestedModelID, resolvedModelID, modal, selected,
				"lease_reason", strings.TrimSpace(leaseReason),
			)...,
		)
		s.observeLatency("runtime.ai.local.lease_release_ms", releaseStartedAt,
			localModelTelemetryAttrs(requestedModelID, resolvedModelID, modal, selected,
				"lease_reason", strings.TrimSpace(leaseReason),
			)...,
		)
	}, nil
}
