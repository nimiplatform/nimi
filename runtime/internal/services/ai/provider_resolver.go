package ai

import (
	"context"
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
)

func (s *routeSelector) resolveCommittedBindingRouteModel(
	requested runtimev1.RoutePolicy,
	modelID string,
) (runtimev1.RoutePolicy, string, error) {
	rawModel := strings.TrimSpace(modelID)
	if requested == runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED {
		return runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED, "", missingAIConfigRouteError()
	}
	if rawModel == "" {
		return runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
	}
	switch requested {
	case runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL:
		if s == nil || s.local == nil {
			return runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
		}
		return requested, rawModel, nil
	case runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD:
		if s == nil || s.cloud == nil {
			return runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
		}
		return requested, rawModel, nil
	default:
		return runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED, "", missingAIConfigRouteError()
	}
}

func (s *routeSelector) resolveProviderWithTargetAndModal(
	_ context.Context,
	requested runtimev1.RoutePolicy,
	modelID string,
	remoteTarget *nimillm.RemoteTarget,
	_ runtimev1.Modal,
) (provider, runtimev1.RoutePolicy, string, nimillm.RouteDecisionInfo, error) {
	rawModel := strings.TrimSpace(modelID)
	if requested == runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED {
		return nil, runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED, "", nimillm.RouteDecisionInfo{}, missingAIConfigRouteError()
	}
	if remoteTarget != nil {
		decision := nimillm.RouteDecisionInfo{BackendName: "cloud-" + strings.TrimSpace(remoteTarget.ProviderType)}
		if requested != runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD {
			return nil, runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED, "", decision, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
		}
		if s == nil || s.cloud == nil {
			return nil, runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED, "", decision, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
		}
		exactModel := strings.TrimSpace(remoteTarget.ProviderModelID)
		if rawModel != "" && rawModel != exactModel {
			return nil, runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED, "", decision, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
		}
		rawModel = exactModel
		if rawModel == "" {
			return nil, runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED, "", decision, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
		}
		return s.cloud, runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD, rawModel, decision, nil
	}

	switch requested {
	case runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL:
		if s == nil || s.local == nil {
			return nil, runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED, "", nimillm.RouteDecisionInfo{BackendName: "local"}, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
		}
		// Local execution is admitted by a capability Driver before this legacy
		// provider boundary. Returning the committed route here lets each caller
		// produce its modality-specific typed unsupported failure; no backend is
		// selected from model text or inventory order.
		return s.local, runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL, rawModel, nimillm.RouteDecisionInfo{BackendName: "local"}, nil
	case runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD:
		return nil, runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED, "", nimillm.RouteDecisionInfo{BackendName: "cloud"}, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
	default:
		return nil, runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED, "", nimillm.RouteDecisionInfo{}, missingAIConfigRouteError()
	}
}

func missingAIConfigRouteError() error {
	return grpcerr.WithReasonCodeOptions(
		codes.FailedPrecondition,
		runtimev1.ReasonCode_AI_CONFIG_INVALID,
		grpcerr.ReasonOptions{Message: "AIConfig capability route is required"},
	)
}
