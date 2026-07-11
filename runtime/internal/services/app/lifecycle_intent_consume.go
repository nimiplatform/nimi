package app

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
)

type lifecycleIntentMutationRequest struct {
	action                protectedlocal.LifecycleAction
	appID                 string
	intentID              string
	displayedImpactDigest string
	destructiveOptions    *runtimev1.AppLifecycleDestructiveOptions
}

// consumeLifecycleIntentForMutation is a no-op only for the explicit
// non-protected service construction used by local package tests. Production
// NewProtectedService always injects the anchored manager and exposes these
// methods only on the protected Desktop carrier.
func (s *Service) consumeLifecycleIntentForMutation(ctx context.Context, request lifecycleIntentMutationRequest) (resolvedLifecycleIntentTarget, error) {
	if s == nil || s.lifecycleIntents == nil {
		return resolvedLifecycleIntentTarget{}, nil
	}
	appID := strings.TrimSpace(request.appID)
	if appID == "" || appID != request.appID || strings.TrimSpace(request.intentID) == "" || strings.TrimSpace(request.intentID) != request.intentID ||
		strings.TrimSpace(request.displayedImpactDigest) == "" || strings.TrimSpace(request.displayedImpactDigest) != request.displayedImpactDigest {
		return resolvedLifecycleIntentTarget{}, lifecycleIntentRequired()
	}
	_, accountGeneration, ok := s.authenticatedLifecycleAccount(ctx)
	if !ok {
		return resolvedLifecycleIntentTarget{}, lifecycleIntentMismatch("refresh_account")
	}
	target, err := s.currentLifecycleIntentTarget(request.action, appID, request.destructiveOptions)
	if err != nil {
		return resolvedLifecycleIntentTarget{}, lifecycleIntentMismatch("resolve_lifecycle_target")
	}
	intentID, err := parseLifecycleIdentifier(request.intentID)
	if err != nil {
		return resolvedLifecycleIntentTarget{}, lifecycleIntentMismatch("prepare_lifecycle_intent")
	}
	displayedDigest, err := parseLifecycleIdentifier(request.displayedImpactDigest)
	if err != nil {
		return resolvedLifecycleIntentTarget{}, lifecycleIntentMismatch("render_canonical_impact")
	}
	_, err = s.lifecycleIntents.Consume(ctx, protectedlocal.LifecycleIntentConsumption{
		IntentID:                   intentID,
		AccountGeneration:          accountGeneration,
		Action:                     request.action,
		AppID:                      appID,
		ReleaseRef:                 target.releaseRef,
		ArtifactDigest:             target.artifactDigest,
		DisplayedImpactDigest:      displayedDigest,
		ExpectedAdoptionGeneration: target.adoptionGeneration,
		DestructiveOptions:         lifecycleDestructiveOptions(target.destructiveOptions),
	})
	if err != nil {
		return resolvedLifecycleIntentTarget{}, protectedLifecycleIntentError(err)
	}
	return target, nil
}
