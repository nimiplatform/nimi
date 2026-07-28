package ai

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/spendvisibility"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/structpb"
)

const runtimeAISpendPolicyVersion = "runtime-ai-spend-v1"

type SpendDisclosureReporter func(context.Context, spendvisibility.ExecutionInput, spendvisibility.SpendDisclosure)

func (s *Service) SetSpendDisclosureReporter(reporter SpendDisclosureReporter) {
	s.spendDisclosureReporter = reporter
}

func (s *Service) reportScenarioSpendDisclosure(ctx context.Context, head *runtimev1.ScenarioRequestHead, scenarioType runtimev1.ScenarioType) error {
	if head == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	capabilityID, ok := localScenarioCapability(scenarioType)
	if !ok {
		return nil
	}
	input := spendvisibility.ExecutionInput{
		CapabilityID:  capabilityID,
		IsCloudRoute:  scenarioSpendRouteIsCloud(head),
		BillingScope:  strings.TrimSpace(head.GetAppId()),
		PolicyVersion: runtimeAISpendPolicyVersion,
	}
	disclosure, err := spendvisibility.Project(input)
	if err != nil {
		return grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_AUTHORIZATION_DENIED, err, grpcerr.ReasonOptions{
			Message: "scenario spend disclosure could not be projected",
		})
	}
	if s != nil && s.spendDisclosureReporter != nil {
		s.spendDisclosureReporter(ctx, input, disclosure)
	}
	if s != nil && s.audit != nil {
		payload, payloadErr := structpb.NewStruct(map[string]any{
			"capability_id":      input.CapabilityID,
			"category":           string(disclosure.Category),
			"estimate_available": disclosure.EstimateAvailable,
			"estimate_currency":  disclosure.EstimateCurrency,
			"estimate_amount":    disclosure.EstimateAmount,
			"billing_scope":      disclosure.BillingScope,
			"policy_version":     disclosure.PolicyVersion,
			"detail":             disclosure.Detail,
		})
		if payloadErr == nil {
			s.audit.AppendEvent(&runtimev1.AuditEventRecord{
				Domain:        "runtime.ai",
				Operation:     "SpendDisclosure",
				AppId:         strings.TrimSpace(head.GetAppId()),
				SubjectUserId: strings.TrimSpace(head.GetSubjectUserId()),
				ReasonCode:    runtimev1.ReasonCode_ACTION_EXECUTED,
				Payload:       payload,
			})
		}
	}
	return nil
}

func scenarioSpendRouteIsCloud(head *runtimev1.ScenarioRequestHead) bool {
	if head == nil {
		return false
	}
	switch head.GetRoutePolicy() {
	case runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD:
		return true
	case runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL:
		return false
	}
	return preferredRoute(head.GetModelId()) == runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD
}
