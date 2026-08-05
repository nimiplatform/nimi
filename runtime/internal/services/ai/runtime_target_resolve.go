package ai

import (
	"context"
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/runtimeidentity"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
)

// normalizeScenarioCloudTarget validates and resolves an already captured
// private AIConfig Cloud target. It never reads or mutates public Scenario
// model, connector, route, fallback, or target fields.
func (s *Service) normalizeScenarioCloudTarget(
	ctx context.Context,
	head *runtimev1.ScenarioRequestHead,
	ref *runtimeidentity.CloudTarget,
) (*connector.RemoteModelCatalogBinding, error) {
	if ref == nil || !ref.Valid() {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
	}
	subjectUserID := scenarioTargetSubjectUserID(ctx, head)
	if subjectUserID == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if s == nil || s.connStore == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND)
	}
	connectorID := strings.TrimSpace(ref.ConnectorID)
	record, found, err := s.connStore.Get(connectorID)
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, err, grpcerr.ReasonOptions{
			ActionHint: "retry_or_check_runtime_logs",
			Message:    "failed to read connector configuration",
		})
	}
	if !found {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND)
	}
	binding, err := connector.ResolveRemoteModelCatalogBinding(s.speechCatalog, subjectUserID, record, connector.RemoteModelCatalogRef{
		ConnectorID:          connectorID,
		RemoteModelCatalogID: strings.TrimSpace(ref.RemoteModelCatalogID),
		ProviderModelID:      strings.TrimSpace(ref.ProviderModelID),
		Provider:             strings.TrimSpace(ref.Provider),
	})
	if err != nil {
		return nil, err
	}
	return &binding, nil
}

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
