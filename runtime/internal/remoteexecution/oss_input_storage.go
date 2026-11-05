package remoteexecution

import (
	"context"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
)

type OwnedMediaCleanupHost interface {
	CleanupOwnedMedia(context.Context, connector.ConnectorRecord, capabilitydriver.CloudMediaTarget, []nimillm.CloudVideoMediaReference, MediaDispatchAudit) nimillm.OSSInputCleanup
}

type inputCleanupObserverKey struct{}

func WithInputCleanupObserver(ctx context.Context, observer func(nimillm.OSSInputCleanup) error) context.Context {
	return context.WithValue(ctx, inputCleanupObserverKey{}, observer)
}

func reportInputCleanup(ctx context.Context, result nimillm.OSSInputCleanup) error {
	if observer, _ := ctx.Value(inputCleanupObserverKey{}).(func(nimillm.OSSInputCleanup) error); observer != nil {
		return observer(result)
	}
	return nil
}

func (h *ProviderMediaHost) recordOSSInputCleanup(audit MediaDispatchAudit, result nimillm.OSSInputCleanup) error {
	outcome := nimillm.ProviderTaskCleanupUnconfirmed
	if result.State == "deleted" || result.State == "not_required" {
		outcome = nimillm.ProviderTaskCleanupResourcesDeleted
	} else if result.State == "failed" {
		outcome = nimillm.ProviderTaskCleanupFailed
	}
	return h.recordDispatch(audit, "input_storage_cleanup", result.ReasonCode, false, &nimillm.ProviderTaskCleanupObservation{Outcome: outcome, ReasonCode: result.ReasonCode, OSSInputs: &result})
}

// @nimi-authority: rule.nimi.runtime.ai-provider.oss-input-storage
func (h *ProviderMediaHost) CleanupOwnedMedia(ctx context.Context, captured connector.ConnectorRecord, target capabilitydriver.CloudMediaTarget, references []nimillm.CloudVideoMediaReference, audit MediaDispatchAudit) (result nimillm.OSSInputCleanup) {
	result = nimillm.OSSInputCleanup{State: "unconfirmed", ReasonCode: runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE}
	defer func() {
		if err := h.recordOSSInputCleanup(audit, result); err != nil {
			result.State = "unconfirmed"
			result.ReasonCode = mediaReasonCode(err)
		}
	}()
	jobID, err := connector.JobIDForCredentialCustodyRef(captured.CredentialCustodyRef)
	if err != nil || captured.MediaStorage == nil || target.Provider() != "dashscope" {
		return result
	}
	objects, err := nimillm.OSSObjectsForMedia(*captured.MediaStorage, jobID, references)
	if err != nil {
		return result
	}
	if len(objects) == 0 {
		result.State = "not_required"
		result.ReasonCode = runtimev1.ReasonCode_ACTION_EXECUTED
		return result
	}
	result.Unconfirmed = len(objects)
	// A historical Job record is not a current App authorization capability.
	if jobAuthorityFromContext(ctx) == nil {
		result.ReasonCode = runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN
		return result
	}
	ctx = h.jobOutboundContext(WithAsyncJob(ctx), captured, audit)
	remote, err := requestScopedProviderTarget(ctx, h.connectors, h.allowLoopback, audit.AccountID, captured, target)
	if err != nil {
		result.ReasonCode = mediaReasonCode(err)
		return result
	}
	defer clearRequestScopedProviderTarget(remote)
	client, err := nimillm.NewOSSInputClient(ctx, remote.MediaStorage)
	if err != nil {
		result.ReasonCode = mediaReasonCode(err)
		return result
	}
	defer client.Close()
	bounded, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	return client.Cleanup(bounded, objects)
}
