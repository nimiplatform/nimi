package ai

import (
	"context"
	"fmt"
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/texttarget"
)

func (s *routeSelector) resolveProvider(ctx context.Context, requested runtimev1.RoutePolicy, fallback runtimev1.FallbackPolicy, modelID string) (provider, runtimev1.RoutePolicy, string, nimillm.RouteDecisionInfo, error) {
	return s.resolveProviderWithTarget(ctx, requested, fallback, modelID, nil)
}

func (s *routeSelector) resolveProviderWithTarget(ctx context.Context, requested runtimev1.RoutePolicy, fallback runtimev1.FallbackPolicy, modelID string, remoteTarget *nimillm.RemoteTarget) (provider, runtimev1.RoutePolicy, string, nimillm.RouteDecisionInfo, error) {
	return s.resolveProviderWithTargetAndModal(ctx, requested, fallback, modelID, remoteTarget, runtimev1.Modal_MODAL_UNSPECIFIED)
}

func (s *routeSelector) resolveProviderWithTargetAndModal(ctx context.Context, requested runtimev1.RoutePolicy, fallback runtimev1.FallbackPolicy, modelID string, remoteTarget *nimillm.RemoteTarget, modal runtimev1.Modal) (provider, runtimev1.RoutePolicy, string, nimillm.RouteDecisionInfo, error) {
	rawModel := strings.TrimSpace(modelID)
	resolvedModel, err := texttarget.ResolveInternalDefaultAlias(s.targetConfig, rawModel)
	if err != nil {
		return nil, runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED, "", nimillm.RouteDecisionInfo{}, grpcerr.WithReasonCodeOptions(
			codes.FailedPrecondition,
			runtimev1.ReasonCode_AI_MODULE_CONFIG_INVALID,
			grpcerr.ReasonOptions{
				ActionHint: "configure_runtime_default_target",
				Message:    fmt.Sprintf("resolve default target for %q: %v", rawModel, err),
			},
		)
	}
	rawModel = strings.TrimSpace(resolvedModel)

	// If a RemoteTarget is provided, force cloud/CLOUD route
	if remoteTarget != nil {
		decision := nimillm.RouteDecisionInfo{BackendName: "cloud-" + remoteTarget.ProviderType}
		if s.cloud == nil {
			return nil, runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED, "", decision, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
		}
		modelResolved := s.cloud.ResolveModelID(rawModel)
		return s.cloud, runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD, modelResolved, decision, nil
	}

	preferred := preferredRoute(rawModel)

	target := s.local
	decision := nimillm.RouteDecisionInfo{BackendName: "local"}
	if preferred == runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD {
		target = s.cloud
		decision.BackendName = "cloud"
	}

	if requested != preferred && fallback != runtimev1.FallbackPolicy_FALLBACK_POLICY_ALLOW {
		return nil, runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED, "", decision, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_FALLBACK_DENIED)
	}

	modelResolved := target.ResolveModelID(rawModel)
	if err := checkProviderModelAvailability(target, modelResolved, modal); err != nil {
		return nil, runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED, "", decision, err
	}

	if cloud, ok := target.(nimillm.DecisionInfoProvider); ok {
		if info, found := cloud.GetDecisionInfo(modelResolved); found {
			if info.BackendName != "" {
				decision.BackendName = info.BackendName
			}
			decision.HintAutoSwitch = info.HintAutoSwitch
			decision.HintFrom = info.HintFrom
			decision.HintTo = info.HintTo
		}
	}
	return target, target.Route(), modelResolved, decision, nil
}

type modalAvailabilityProvider interface {
	CheckModelAvailabilityForModal(string, runtimev1.Modal) error
}

func checkProviderModelAvailability(target provider, modelID string, modal runtimev1.Modal) error {
	if targetWithModal, ok := target.(modalAvailabilityProvider); ok && targetWithModal != nil {
		return targetWithModal.CheckModelAvailabilityForModal(modelID, modal)
	}
	return target.CheckModelAvailability(modelID)
}
