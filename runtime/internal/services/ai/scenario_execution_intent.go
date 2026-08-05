package ai

import (
	"context"
	"fmt"
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

// captureScenarioExecutionIntent resolves caller-owned AIConfig once and puts
// an immutable private snapshot on the in-process context. Public Scenario
// fields never carry route, model, connector, target, or fallback truth.
func (s *Service) captureScenarioExecutionIntent(
	ctx context.Context,
	head *runtimev1.ScenarioRequestHead,
	capabilityContract string,
) (context.Context, executionintent.Intent, error) {
	capabilityContract = strings.TrimSpace(capabilityContract)
	if head == nil || capabilityContract == "" {
		return ctx, executionintent.Intent{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if intent, ok := executionintent.FromContext(ctx); ok {
		if intent.CapabilityContract != capabilityContract {
			return ctx, executionintent.Intent{}, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
		}
		if !intent.IsLocal() && !intent.IsCloud() {
			return ctx, executionintent.Intent{}, missingAIConfigRouteError()
		}
		return ctx, intent, nil
	}

	caller, err := scenarioAppAIConfigCaller(ctx, head)
	if err != nil {
		return ctx, executionintent.Intent{}, err
	}
	if s == nil || s.aiConfigStore == nil {
		return ctx, executionintent.Intent{}, appAIConfigPersistenceError(fmt.Errorf("AIConfig store is unavailable"))
	}
	config, found, err := s.aiConfigStore.Get(ctx, caller.accountNamespace, derivedAppAIConfigOwner(caller.appID))
	if err != nil {
		return ctx, executionintent.Intent{}, appAIConfigPersistenceError(err)
	}
	if !found || config == nil {
		return ctx, executionintent.Intent{}, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_NOT_FOUND)
	}
	for _, capability := range config.GetCapabilities() {
		if strings.TrimSpace(capability.GetCapabilityContract()) != capabilityContract {
			continue
		}
		intent, err := executionintent.FromCapability(capability)
		if err != nil {
			return ctx, executionintent.Intent{}, grpcerr.WrapWithReasonCode(
				codes.FailedPrecondition,
				runtimev1.ReasonCode_AI_CONFIG_INVALID,
				err,
				grpcerr.ReasonOptions{Message: "AIConfig capability execution intent is incomplete"},
			)
		}
		return executionintent.WithIntent(ctx, intent), intent, nil
	}
	return ctx, executionintent.Intent{}, grpcerr.WithReasonCodeOptions(
		codes.FailedPrecondition,
		runtimev1.ReasonCode_AI_CONFIG_INVALID,
		grpcerr.ReasonOptions{
			Message:  "AIConfig capability route is missing",
			Metadata: map[string]string{"capability_contract": capabilityContract},
		},
	)
}

func scenarioExecutionIntentFromContext(
	ctx context.Context,
	capabilityContract string,
) (executionintent.Intent, error) {
	intent, ok := executionintent.FromContext(ctx)
	if !ok || intent.CapabilityContract != strings.TrimSpace(capabilityContract) {
		return executionintent.Intent{}, missingAIConfigRouteError()
	}
	if !intent.IsLocal() && !intent.IsCloud() {
		return executionintent.Intent{}, missingAIConfigRouteError()
	}
	return intent, nil
}
