package ai

import (
	"context"
	"fmt"
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aiconfig"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
)

type appTextSelectionKey struct{}

// A scoped App may select a record of its authenticated owner and require
// that dispatch still observes the revision and Local resource it displayed.
func appTextSelectionContext(ctx context.Context, sel *runtimev1.AppTextConfigSelection) (context.Context, error) {
	if sel == nil {
		return ctx, nil
	}
	if !aiconfig.ValidRecordRef(sel.ConfigRef) || (sel.ExpectedRevision != "" && (!validAppAIConfigRevision(sel.ExpectedRevision) || sel.ExpectedRevision == "0")) ||
		(sel.ExpectedLocalLoadoutRef == "") != (sel.ExpectedLocalLoadoutRevision == "") || len(sel.ExpectedLocalLoadoutRef) > 256 || len(sel.ExpectedLocalLoadoutRevision) > 256 {
		return ctx, invalidAppAIConfigError()
	}
	return context.WithValue(ctx, appTextSelectionKey{}, sel), nil
}

func selectionConflict() error {
	return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_REVISION_CONFLICT)
}

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
		if sel, _ := ctx.Value(appTextSelectionKey{}).(*runtimev1.AppTextConfigSelection); sel != nil && sel.ExpectedLocalLoadoutRef != "" {
			local, ok := localexecution.SelectedLocalExecutionFromContext(capturedCtx, capabilityContract)
			if !ok || local.LoadoutID != sel.ExpectedLocalLoadoutRef || local.LoadoutRevision != sel.ExpectedLocalLoadoutRevision {
				return capturedCtx, executionintent.Intent{}, selectionConflict()
			}
		}
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
	owner := derivedAppAIConfigOwner(caller.appID)
	var ref, revision string
	var config *runtimev1.AIConfig
	var found bool
	if sel, _ := ctx.Value(appTextSelectionKey{}).(*runtimev1.AppTextConfigSelection); sel != nil {
		records, ok := s.aiConfigStore.(aiconfig.RecordStore)
		if !ok {
			return ctx, executionintent.Intent{}, appAIConfigPersistenceError(fmt.Errorf("named records unavailable"))
		}
		r, e := records.ReadRecord(ctx, caller.accountNamespace, owner, sel.ConfigRef, false)
		if e == nil && r.Record != nil && sel.ExpectedRevision != "" && sel.ExpectedRevision != r.Revision() {
			return ctx, executionintent.Intent{}, selectionConflict()
		}
		config, found, err = r.Config, r.Record != nil, e
		if r.Record != nil {
			ref, revision = r.Record.ConfigRef, r.Record.Revision
		}
	} else {
		config, _, found, err = s.aiConfigStore.Get(ctx, caller.accountNamespace, owner)
	}
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
		intent.AppConfigRef = ref
		intent.AppConfigRevision = revision
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
		if owner, holdsFiles := s.localExecution.(localexecution.ModelAssetCaptureResolver); holdsFiles && captured.ModelAssetUse == nil {
			use, err := owner.HoldCapturedLocalExecution(captured)
			if err != nil {
				return ctx, err
			}
			captured.ModelAssetUse = use
		}
		if err := localexecution.TrackModelAssetUse(ctx, captured.ModelAssetUse); err != nil {
			return ctx, grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, err, grpcerr.ReasonOptions{})
		}
		intent.LocalLoadoutRef = captured.LoadoutID
		return localexecution.WithSelectedLocalExecution(executionintent.WithIntent(ctx, intent), captured), nil
	}
	if s == nil || s.localExecution == nil {
		return ctx, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_NOT_CONFIGURED)
	}
	var (
		resolved *localexecution.SelectedLocalExecution
		err      error
	)
	if owner, holdsFiles := s.localExecution.(localexecution.ModelAssetCaptureResolver); holdsFiles {
		resolved, err = owner.CaptureLocalExecution(ctx, intent.CapabilityContract, intent.LocalLoadoutRef)
	} else if strings.TrimSpace(intent.LocalLoadoutRef) != "" {
		resolved, err = s.localExecution.ResolveLocalExecution(intent.CapabilityContract, intent.LocalLoadoutRef)
	} else {
		resolved, err = s.localExecution.ResolveSelectedLocalExecution(intent.CapabilityContract)
	}
	if err != nil {
		return ctx, err
	}
	if err := localexecution.TrackModelAssetUse(ctx, resolved.ModelAssetUse); err != nil {
		return ctx, grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, err, grpcerr.ReasonOptions{})
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
