package localappop

import "context"

// Coordinator resolves one fresh Runtime-owned snapshot for every operation
// and immediately evaluates it. It owns no store and caches no decision.
type Coordinator struct {
	resolver               SnapshotResolver
	userPermissionAdmitted func(Operation) bool
}

type CoordinatorOption func(*Coordinator)

func WithUserPermissionAdmission(resolver func(Operation) bool) CoordinatorOption {
	return func(coordinator *Coordinator) {
		coordinator.userPermissionAdmitted = resolver
	}
}

func NewCoordinator(resolver SnapshotResolver, options ...CoordinatorOption) *Coordinator {
	coordinator := &Coordinator{resolver: resolver}
	for _, option := range options {
		if option != nil {
			option(coordinator)
		}
	}
	return coordinator
}

func (c *Coordinator) Evaluate(ctx context.Context, req Request) Decision {
	if reason := validateRequest(req); reason != "" {
		outcome := OutcomeUnavailable
		if reason == ReasonProtocolEnvelopeInvalid {
			outcome = OutcomeDenied
		}
		return Decision{Outcome: outcome, Reason: reason}
	}
	authorityClass, ok := AuthorityClassForOperation(req.Operation)
	if !ok || (authorityClass == AuthorityClassUserPermission && (c == nil || c.userPermissionAdmitted == nil || !c.userPermissionAdmitted(req.Operation))) {
		return Decision{Outcome: OutcomeUnavailable, Reason: ReasonLocalAppOperationUnavailable}
	}
	if c == nil || c.resolver == nil {
		return Decision{Outcome: OutcomeUnavailable, Reason: ReasonLocalAppOperationUnavailable}
	}

	snapshot, err := c.resolver.ResolveLocalAppOperation(ctx, req)
	if err != nil {
		return Decision{Outcome: OutcomeUnavailable, Reason: ReasonLocalAppOperationUnavailable}
	}
	return evaluate(req, snapshot)
}
