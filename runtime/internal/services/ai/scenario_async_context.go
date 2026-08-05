package ai

import "context"

// newDetachedAsyncJobContext deliberately drops every request value and both
// metadata directions. Provider credentials, caller authorization, and other
// request-scoped material must never enter a detached Runtime job. Callers may
// add only the typed ownership identity required by internal authorization.
func newDetachedAsyncJobContext(_ context.Context) context.Context {
	return context.Background()
}
