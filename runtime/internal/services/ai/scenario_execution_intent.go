package ai

import (
	"context"
	"fmt"
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
)

// captureScenarioExecutionIntent resolves caller-owned AIConfig once and puts
// an immutable private snapshot on the in-process context. Public Scenario
// fields never carry route, model, connector, target, or fallback truth.
func (s *Service) captureScenarioExecutionIntent(
	ctx context.Context,
	head *runtimev1.ScenarioRequestHead,
	capabilityContract string,
) (context.Context, executionintent.Intent, error) {
	capturedCtx, intent, err := s.resolveScenarioExecutionIntent(ctx, head, capabilityContract)
	if err != nil {
		return capturedCtx, executionintent.Intent{}, err
	}
	capturedCtx, err = s.captureReferencedLocalExecution(capturedCtx, intent)
	if err == nil {
		intent, _ = executionintent.FromContext(capturedCtx)
	}
	return capturedCtx, intent, err
}

// resolveScenarioExecutionIntent snapshots canonical route/defaults/features
// without consulting mutable Local machine selection. This lets an
// idempotent retry find its already-published Job before new admission work.
func (s *Service) resolveScenarioExecutionIntent(
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
		return executionintent.WithIntent(ctx, intent), intent, nil
	}

	caller, err := scenarioAppAIConfigCaller(ctx, head)
	if err != nil {
		return ctx, executionintent.Intent{}, err
	}
	if s == nil || s.aiConfigStore == nil {
		return ctx, executionintent.Intent{}, appAIConfigPersistenceError(fmt.Errorf("AIConfig store is unavailable"))
	}
	config, _, found, err := s.aiConfigStore.Get(ctx, caller.accountNamespace, derivedAppAIConfigOwner(caller.appID))
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

// @nimi-authority: rule.nimi.runtime.security-core.r063
func (s *Service) captureReferencedLocalExecution(
	ctx context.Context,
	intent executionintent.Intent,
) (context.Context, error) {
	if !intent.IsLocal() {
		return ctx, nil
	}
	if captured, ok := localexecution.SelectedLocalExecutionFromContext(ctx, intent.CapabilityContract); ok {
		intent.LocalLoadoutRef = captured.LoadoutID
		return executionintent.WithIntent(ctx, intent), nil
	}
	if s == nil || s.localExecution == nil {
		return ctx, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_NOT_CONFIGURED)
	}
	var (
		resolved *localexecution.SelectedLocalExecution
		err      error
	)
	if strings.TrimSpace(intent.LocalLoadoutRef) != "" {
		resolved, err = s.localExecution.ResolveLocalExecution(intent.CapabilityContract, intent.LocalLoadoutRef)
	} else {
		resolved, err = s.localExecution.ResolveSelectedLocalExecution(intent.CapabilityContract)
	}
	if err != nil {
		return ctx, err
	}
	intent.LocalLoadoutRef = resolved.LoadoutID
	return localexecution.WithSelectedLocalExecution(executionintent.WithIntent(ctx, intent), resolved), nil
}

func (s *Service) resolveReferencedLocalExecution(
	ctx context.Context,
	intent executionintent.Intent,
) (*localexecution.SelectedLocalExecution, error) {
	capturedCtx, err := s.captureReferencedLocalExecution(ctx, intent)
	if err != nil {
		return nil, err
	}
	resolved, ok := localexecution.SelectedLocalExecutionFromContext(capturedCtx, intent.CapabilityContract)
	if !ok {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
	}
	return resolved, nil
}

func missingAIConfigRouteError() error {
	return grpcerr.WithReasonCodeOptions(
		codes.FailedPrecondition,
		runtimev1.ReasonCode_AI_CONFIG_INVALID,
		grpcerr.ReasonOptions{Message: "AIConfig capability route is required"},
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
