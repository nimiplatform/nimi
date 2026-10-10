package ai

import (
	"context"
	"github.com/nimiplatform/nimi/runtime/internal/remoteexecution"
)

// newDetachedAsyncJobContext deliberately drops every request value and both
// metadata directions. Provider credentials, caller authorization, and other
// request-scoped material must never enter a detached Runtime job. Callers may
// add only the typed ownership identity required by internal authorization.
func newDetachedAsyncJobContext(ctx context.Context) context.Context {
	if permit := jobWorkPermitFromContext(ctx); permit != nil {
		return permit.context()
	}
	return remoteexecution.WithAsyncJob(context.Background())
}
