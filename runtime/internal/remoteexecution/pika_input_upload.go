package remoteexecution

import (
	"context"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
)

type PikaInputCleanupHost interface {
	CleanupPikaInputUploads(context.Context, connector.ConnectorRecord, capabilitydriver.CloudMediaTarget, []nimillm.PikaInputUpload, *nimillm.NativeTaskReceipt, bool, MediaDispatchAudit) (nimillm.InputCleanupResult, bool)
}

func (h *ProviderMediaHost) recordPikaInputCleanup(audit MediaDispatchAudit, result nimillm.InputCleanupResult) error {
	return h.recordDispatch(audit, "input_upload_cleanup", result.ReasonCode, false, &nimillm.ProviderTaskCleanupObservation{Outcome: result.Outcome(), ReasonCode: result.ReasonCode, PikaInputs: &result})
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r108
func (h *ProviderMediaHost) CleanupPikaInputUploads(ctx context.Context, captured connector.ConnectorRecord, target capabilitydriver.CloudMediaTarget, uploads []nimillm.PikaInputUpload, receipt *nimillm.NativeTaskReceipt, released bool, audit MediaDispatchAudit) (result nimillm.InputCleanupResult, disposed bool) {
	result = nimillm.InputCleanupResult{State: "unconfirmed", Unconfirmed: len(uploads), ReasonCode: runtimev1.ReasonCode_AI_MEDIA_STORAGE_CLEANUP_UNCONFIRMED}
	defer func() {
		if !disposed {
			return
		}
		if err := h.recordPikaInputCleanup(audit, result); err != nil {
			result.State = "unconfirmed"
			result.ReasonCode = mediaReasonCode(err)
		}
	}()
	if target.Provider() != "pika" || !capabilitydriver.IsPikaVideoModel(target.ProviderModelID()) || jobAuthorityFromContext(ctx) == nil {
		return result, false
	}
	for _, upload := range uploads {
		if nimillm.ValidatePikaInputUpload(upload) != nil {
			return result, false
		}
	}
	ctx = h.jobOutboundContext(WithJobDispatchIntent(WithAsyncJob(ctx), nil), captured, audit)
	remote, err := requestScopedProviderTarget(ctx, h.connectors, h.allowLoopback, audit.AccountID, captured, target)
	if err != nil {
		result.ReasonCode = mediaReasonCode(err)
		return result, false
	}
	defer clearRequestScopedProviderTarget(remote)
	cfg := nimillm.MediaAdapterConfig{BaseURL: remote.Endpoint, APIKey: remote.APIKey, Headers: cloneRemoteHeaders(remote.Headers), AllowLoopbackEndpoint: h.allowLoopback}
	if !released {
		if receipt == nil || receipt.Model != target.ProviderModelID() {
			return result, false
		}
		terminal, err := nimillm.PikaOriginalTaskTerminal(ctx, cfg, receipt)
		if err != nil {
			result.ReasonCode = mediaReasonCode(err)
			return result, false
		}
		if !terminal {
			return result, false
		}
	}
	return nimillm.CleanupPikaInputs(ctx, cfg, uploads), true
}
