package ai

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
)

func applyRemoteModelCatalogBinding(target *nimillm.RemoteTarget, binding *connector.RemoteModelCatalogBinding) {
	if target == nil || binding == nil {
		return
	}
	target.ConnectorID = strings.TrimSpace(binding.ConnectorID)
	target.RemoteModelCatalogID = strings.TrimSpace(binding.RemoteModelCatalogID)
	target.ProviderModelID = strings.TrimSpace(binding.ProviderModelID)
	target.EndpointProfileID = strings.TrimSpace(binding.EndpointProfileID)
	target.ConnectorSnapshotID = strings.TrimSpace(binding.ConnectorSnapshotID)
	target.InventorySnapshotID = strings.TrimSpace(binding.InventorySnapshotID)
	if provider := strings.TrimSpace(binding.Provider); provider != "" {
		target.ProviderType = provider
	}
}

func scenarioTargetSubjectUserID(ctx context.Context, head *runtimev1.ScenarioRequestHead) string {
	if identity := authn.IdentityFromContext(ctx); identity != nil && strings.TrimSpace(identity.SubjectUserID) != "" {
		return strings.TrimSpace(identity.SubjectUserID)
	}
	if head != nil {
		return strings.TrimSpace(head.GetSubjectUserId())
	}
	return ""
}
