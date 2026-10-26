package remoteexecution

import (
	"context"
	"errors"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aitelemetry"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
)

// @nimi-authority: rule.nimi.runtime.rpc-foundations.home-cloud-connection-observation
func finishCloudAttempt(attempt *aitelemetry.Attempt, usage *runtimev1.UsageStats, err error) {
	if errors.Is(err, nimillm.ErrNativeTaskYielded) || errors.Is(err, nimillm.ErrFiniteMediaResultOwned) {
		return
	}
	if nimillm.IsNativeCreateResponseUnavailable(err) || errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		attempt.Unknown()
		return
	}
	outcome := runtimev1.DesktopAICloudAttemptOutcome_DESKTOP_AI_CLOUD_ATTEMPT_OUTCOME_SUCCEEDED
	reason := runtimev1.ReasonCode_ACTION_EXECUTED
	if err != nil {
		outcome = runtimev1.DesktopAICloudAttemptOutcome_DESKTOP_AI_CLOUD_ATTEMPT_OUTCOME_FAILED
		var ok bool
		reason, ok = grpcerr.ExtractReasonCode(err)
		if !ok {
			reason = runtimev1.ReasonCode_AI_PROVIDER_INTERNAL
		}
	}
	attempt.Complete(usage, outcome, reason)
}
