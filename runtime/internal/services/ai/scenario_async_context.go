package ai

import (
	"context"
	"github.com/nimiplatform/nimi/runtime/internal/aitelemetry"
	"github.com/nimiplatform/nimi/runtime/internal/remoteexecution"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
)

// newDetachedAsyncJobContext deliberately drops every request value and both
// metadata directions. Provider credentials, caller authorization, and other
// request-scoped material must never enter a detached Runtime job. Callers may
// add only typed ownership and content-free observation attribution.
func newDetachedAsyncJobContext(ctx context.Context) context.Context {
	detached := remoteexecution.WithAsyncJob(context.Background())
	if permit := jobWorkPermitFromContext(ctx); permit != nil {
		detached = permit.context()
	}
	if source, ok := aitelemetry.SourceFromContext(ctx); ok {
		return aitelemetry.WithSource(detached, source)
	}
	if decision, ok := accountservice.AuthorizedLocalAppDecisionFromContext(ctx); ok {
		return aitelemetry.WithSource(detached, observedSource(ctx, decision.AppID, ""))
	}
	return detached
}
