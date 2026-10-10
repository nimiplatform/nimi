package remoteexecution

import (
	"context"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"

	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
)

type NativeTaskHost interface {
	ObserveNativeTask(context.Context, connector.ConnectorRecord, capabilitydriver.CloudMediaTarget, *nimillm.NativeTaskReceipt, MediaDispatchAudit) (*nimillm.NativeTaskObservation, bool, error)
	OpenNativeTaskArtifacts(context.Context, connector.ConnectorRecord, capabilitydriver.CloudMediaTarget, *nimillm.NativeTaskReceipt, *nimillm.NativeTaskObservation, MediaDispatchAudit) (map[string]*capabilitydriver.ArtifactBody, error)
}

type NativeTaskStopHost interface {
	StopNativeTask(context.Context, connector.ConnectorRecord, capabilitydriver.CloudMediaTarget, *nimillm.NativeTaskReceipt, MediaDispatchAudit) (nimillm.ProviderTaskCleanupOutcome, error)
}

type FiniteMediaArtifactHost interface {
	OpenFiniteMediaArtifacts(context.Context, connector.ConnectorRecord, capabilitydriver.CloudMediaTarget, []*runtimev1.ScenarioArtifact, MediaDispatchAudit) (map[string]*capabilitydriver.ArtifactBody, error)
}

func (h *ProviderMediaHost) OpenFiniteMediaArtifacts(ctx context.Context, captured connector.ConnectorRecord, target capabilitydriver.CloudMediaTarget, artifacts []*runtimev1.ScenarioArtifact, audit MediaDispatchAudit) (map[string]*capabilitydriver.ArtifactBody, error) {
	ctx = h.jobOutboundContext(WithAsyncJob(ctx), captured, audit)
	// Opening the original custody is still mandatory even though asset URLs
	// do not receive its secret. Current configuration cannot retarget this IO.
	remote, err := requestScopedProviderTarget(ctx, h.connectors, h.allowLoopback, audit.AccountID, captured, target)
	if err != nil {
		return nil, err
	}
	clearRequestScopedProviderTarget(remote)
	bodies, err := nimillm.OpenFiniteMediaArtifacts(ctx, nimillm.MediaAdapterConfig{AllowLoopbackEndpoint: h.allowLoopback}, artifacts)
	if err != nil {
		return nil, err
	}
	return cloudArtifactBodiesFromNimi(bodies)
}

func (h *ProviderMediaHost) StopNativeTask(ctx context.Context, captured connector.ConnectorRecord, target capabilitydriver.CloudMediaTarget, receipt *nimillm.NativeTaskReceipt, audit MediaDispatchAudit) (outcome nimillm.ProviderTaskCleanupOutcome, err error) {
	defer func() {
		reason := runtimev1.ReasonCode_ACTION_EXECUTED
		if err != nil {
			reason = mediaReasonCode(err)
		}
		observation := &nimillm.ProviderTaskCleanupObservation{Outcome: outcome, ReasonCode: reason}
		if auditErr := h.recordDispatch(audit, "canceled", reason, false, observation); auditErr != nil {
			err = auditErr
		}
	}()
	if err := nimillm.ValidateNativeTaskReceipt(receipt); err != nil {
		return nimillm.ProviderTaskCleanupFailed, err
	}
	ctx = h.jobOutboundContext(WithAsyncJob(ctx), captured, audit)
	remote, err := requestScopedProviderTarget(ctx, h.connectors, h.allowLoopback, audit.AccountID, captured, target)
	if err != nil {
		return nimillm.ProviderTaskCleanupFailed, err
	}
	defer clearRequestScopedProviderTarget(remote)
	return nimillm.DeleteProviderAsyncTask(ctx, receipt.Adapter, receipt.TaskID, nimillm.MediaAdapterConfig{BaseURL: remote.Endpoint, APIKey: remote.APIKey, Headers: cloneRemoteHeaders(remote.Headers), AllowLoopbackEndpoint: h.allowLoopback})
}

func (h *ProviderMediaHost) OpenNativeTaskArtifacts(ctx context.Context, captured connector.ConnectorRecord, target capabilitydriver.CloudMediaTarget, receipt *nimillm.NativeTaskReceipt, observation *nimillm.NativeTaskObservation, audit MediaDispatchAudit) (map[string]*capabilitydriver.ArtifactBody, error) {
	ctx = h.jobOutboundContext(WithAsyncJob(ctx), captured, audit)
	cfg := nimillm.MediaAdapterConfig{AllowLoopbackEndpoint: h.allowLoopback}
	defer func() { cfg.APIKey = "" }()
	needsCredential := len(observation.WorldPayload) > 0
	for _, artifact := range observation.Artifacts {
		needsCredential = needsCredential || artifact.GetUri() != ""
	}
	if needsCredential {
		remote, err := requestScopedProviderTarget(ctx, h.connectors, h.allowLoopback, audit.AccountID, captured, target)
		if err != nil {
			return nil, err
		}
		cfg.APIKey, cfg.BaseURL, cfg.Headers = remote.APIKey, remote.Endpoint, cloneRemoteHeaders(remote.Headers)
		clearRequestScopedProviderTarget(remote)
	}
	bodies, err := nimillm.OpenNativeTaskArtifacts(ctx, cfg, receipt, observation)
	if err != nil {
		return nil, err
	}
	return cloudArtifactBodiesFromNimi(bodies)
}

// ObserveNativeTask opens the original sealed generation for one admitted
// finite query. It has no submission method or configuration selection.
func (h *ProviderMediaHost) ObserveNativeTask(ctx context.Context, captured connector.ConnectorRecord, target capabilitydriver.CloudMediaTarget, receipt *nimillm.NativeTaskReceipt, audit MediaDispatchAudit) (*nimillm.NativeTaskObservation, bool, error) {
	ctx = WithAsyncJob(ctx)
	ctx = h.jobOutboundContext(ctx, captured, audit)
	remote, err := requestScopedProviderTarget(ctx, h.connectors, h.allowLoopback, audit.AccountID, captured, target)
	if err != nil {
		return nil, false, err
	}
	defer clearRequestScopedProviderTarget(remote)
	artifacts, done, err := nimillm.ObserveNativeTask(ctx, nimillm.MediaAdapterConfig{BaseURL: remote.Endpoint, APIKey: remote.APIKey, Headers: cloneRemoteHeaders(remote.Headers), AllowLoopbackEndpoint: h.allowLoopback}, receipt)
	if err != nil || !done {
		return nil, done, err
	}
	// Native observation is metadata first. Driver normalization remains its
	// canonical owner; artifact custody is performed by the Job's finite work.
	return artifacts, true, nil
}
