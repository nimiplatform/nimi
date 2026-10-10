package nimillm

import (
	"context"
	"errors"
	"fmt"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

type finiteMediaResultOwnerKey struct{}

// ErrFiniteMediaResultOwned means the original Job owns the provider response.
// The caller must continue acquisition, never repeat the generating request.
var ErrFiniteMediaResultOwned = errors.New("finite media result belongs to the original Job")

func WithFiniteMediaResultOwner(ctx context.Context, owner func([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats) error) context.Context {
	return context.WithValue(ctx, finiteMediaResultOwnerKey{}, owner)
}

func retainFiniteMediaResult(ctx context.Context, artifacts []*runtimev1.ScenarioArtifact, usage *runtimev1.UsageStats) (bool, error) {
	owner, ok := ctx.Value(finiteMediaResultOwnerKey{}).(func([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats) error)
	if !ok || owner == nil {
		return false, nil
	}
	for _, artifact := range artifacts {
		if len(artifact.GetBytes()) > 0 && isImageArtifactMIME(artifact.GetMimeType()) {
			artifact.MimeType = imageArtifactMIMEFromBytes(artifact.GetMimeType(), artifact.GetBytes())
		}
	}
	if err := owner(artifacts, usage); err != nil {
		return true, err
	}
	return true, ErrFiniteMediaResultOwned
}

// OpenFiniteMediaArtifacts only opens retained result locators. Credentials
// are never forwarded to these provider-returned asset URLs.
func OpenFiniteMediaArtifacts(ctx context.Context, cfg MediaAdapterConfig, artifacts []*runtimev1.ScenarioArtifact) (map[string]*MediaArtifactBody, error) {
	if len(artifacts) == 0 {
		return nil, fmt.Errorf("finite result has no artifacts")
	}
	return detachMediaArtifactBodies(mediaAdapterEndpointPolicyContext(ctx, cfg), artifacts)
}
