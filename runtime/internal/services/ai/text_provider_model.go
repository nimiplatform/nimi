package ai

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
)

func (s *Service) resolveTextProviderModelID(ctx context.Context, head *runtimev1.ScenarioRequestHead, modelResolved string, remoteTarget *nimillm.RemoteTarget) string {
	resolved := strings.TrimSpace(modelResolved)
	if resolved == "" || remoteTarget == nil || s == nil || s.speechCatalog == nil {
		return resolved
	}
	providerType := strings.TrimSpace(remoteTarget.ProviderType)
	if providerType == "" {
		return resolved
	}
	apiModelID := strings.TrimSpace(s.speechCatalog.ResolveAPIModelIDForSubject(
		scenarioTargetSubjectUserID(ctx, head),
		providerType,
		resolved,
	))
	if apiModelID == "" {
		return resolved
	}
	return apiModelID
}
