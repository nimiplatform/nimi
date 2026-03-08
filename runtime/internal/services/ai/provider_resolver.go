package ai

import (
	"context"
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
)

func (s *routeSelector) resolveProvider(ctx context.Context, requested runtimev1.RoutePolicy, fallback runtimev1.FallbackPolicy, modelID string) (provider, runtimev1.RoutePolicy, string, nimillm.RouteDecisionInfo, error) {
	return s.resolveProviderWithTarget(ctx, requested, fallback, modelID, nil)
}

func (s *routeSelector) resolveProviderWithTarget(ctx context.Context, requested runtimev1.RoutePolicy, fallback runtimev1.FallbackPolicy, modelID string, remoteTarget *nimillm.RemoteTarget) (provider, runtimev1.RoutePolicy, string, nimillm.RouteDecisionInfo, error) {
	rawModel := strings.TrimSpace(modelID)

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
	if err := target.CheckModelAvailability(modelResolved); err != nil {
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
