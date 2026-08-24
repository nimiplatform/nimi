package cognition

import "context"

// permitAllKnowledgeAuthorizer admits every action with the constant
// allow envelope. Test-only; never expose outside _test.go.
type permitAllKnowledgeAuthorizer struct{}

func (permitAllKnowledgeAuthorizer) Authorize(_ context.Context, req KnowledgeAuthRequest) (KnowledgeAuthResult, error) {
	return bindKnowledgeAuthIdentity(req.Action, req.Operation, allowedAuthResult()), nil
}

// alwaysDenyKnowledgeAuthorizer denies every action with the typed
// owner-mismatch envelope. Test-only.
type alwaysDenyKnowledgeAuthorizer struct{}

func (alwaysDenyKnowledgeAuthorizer) Authorize(_ context.Context, req KnowledgeAuthRequest) (KnowledgeAuthResult, error) {
	return bindKnowledgeAuthIdentity(req.Action, req.Operation, denyOwnerMismatchResult()), nil
}
