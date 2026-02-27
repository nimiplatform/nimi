package ai

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func (s *routeSelector) resolveProvider(ctx context.Context, requested runtimev1.RoutePolicy, fallback runtimev1.FallbackPolicy, modelID string) (provider, runtimev1.RoutePolicy, string, nimillm.RouteDecisionInfo, error) {
	rawModel := strings.TrimSpace(modelID)
	preferred := preferredRoute(rawModel)

	target := s.local
	decision := nimillm.RouteDecisionInfo{BackendName: "local"}
	if preferred == runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API {
		target = s.cloud
		decision.BackendName = "cloud"
	}

	if requested != preferred && fallback != runtimev1.FallbackPolicy_FALLBACK_POLICY_ALLOW {
		return nil, runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED, "", decision, status.Error(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_FALLBACK_DENIED.String())
	}
	if err := validateCredentialSourceAtResolvedRoute(ctx, preferred); err != nil {
		return nil, runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED, "", decision, err
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
