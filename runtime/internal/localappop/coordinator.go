package localappop

import "context"

// Coordinator resolves one fresh Runtime-owned snapshot for every operation
// and immediately evaluates it. It owns no store and caches no decision.
type Coordinator struct {
	resolver SnapshotResolver
}

func NewCoordinator(resolver SnapshotResolver) *Coordinator {
	return &Coordinator{resolver: resolver}
}

func (c *Coordinator) Evaluate(ctx context.Context, req Request) Decision {
	if reason := validateRequest(req); reason != "" {
		outcome := OutcomeUnavailable
		if reason == ReasonProtocolEnvelopeInvalid {
			outcome = OutcomeDenied
		}
		return Decision{Outcome: outcome, Reason: reason}
	}
	if authorityClass, ok := AuthorityClassForOperation(req.Operation); !ok || authorityClass == AuthorityClassUserPermission {
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
