package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"strings"
)

func (s *routeSelector) resolveProvider(requested runtimev1.RoutePolicy, fallback runtimev1.FallbackPolicy, modelID string) (provider, runtimev1.RoutePolicy, string, routeDecisionInfo, error) {
	rawModel := strings.TrimSpace(modelID)
	preferred := preferredRoute(rawModel)

	target := s.local
	decision := routeDecisionInfo{BackendName: "local"}
	if preferred == runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API {
		target = s.cloud
		decision.BackendName = "cloud"
	}

	if requested != preferred && fallback != runtimev1.FallbackPolicy_FALLBACK_POLICY_ALLOW {
		return nil, runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED, "", decision, status.Error(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_FALLBACK_DENIED.String())
	}

	modelResolved := target.resolveModelID(rawModel)
	if err := target.checkModelAvailability(modelResolved); err != nil {
		return nil, runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED, "", decision, err
	}

	if cloud, ok := target.(*cloudProvider); ok {
		if info, found := cloud.getDecisionInfo(modelResolved); found {
			if info.BackendName != "" {
				decision.BackendName = info.BackendName
			}
			decision.HintAutoSwitch = info.HintAutoSwitch
			decision.HintFrom = info.HintFrom
			decision.HintTo = info.HintTo
		}
	}
	return target, target.route(), modelResolved, decision, nil
}
