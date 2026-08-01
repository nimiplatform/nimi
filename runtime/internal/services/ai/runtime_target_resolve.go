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

func (s *Service) normalizeScenarioRuntimeTargetRef(
	ctx context.Context,
	head *runtimev1.ScenarioRequestHead,
	capability string,
) (
	*connector.RemoteModelCatalogBinding,
	*runtimev1.RuntimeResolvedLocalExecutionBinding,
	*runtimev1.LocalAssetRecord,
	error,
) {
	if head == nil || head.GetTargetRef() == nil {
		return nil, nil, nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, grpcerr.ReasonOptions{
			ActionHint: "provide_runtime_target_ref",
		})
	}
	if err := runtimeidentity.ValidateDurableTargetRef(head.GetTargetRef()); err != nil {
		return nil, nil, nil, invalidScenarioDurableTargetRef(head.GetTargetRef())
	}
	switch target := head.GetTargetRef().GetTarget().(type) {
	case *runtimev1.RuntimeDurableTargetRef_Cloud:
		binding, err := s.normalizeScenarioCloudTargetRef(ctx, head, target.Cloud)
		return binding, nil, nil, err
	case *runtimev1.RuntimeDurableTargetRef_LocalRuntime:
		if head.GetRoutePolicy() != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL || s == nil || s.localTarget == nil {
			return nil, nil, nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
		}
		binding, asset, err := s.localTarget.ResolveDurableLocalTarget(ctx, target.LocalRuntime, capability)
		if err != nil {
			return nil, nil, nil, err
		}
		if strings.TrimSpace(head.GetModelId()) != strings.TrimSpace(binding.GetResolvedModelId()) {
			return nil, nil, nil, grpcerr.WithReasonCode(
				codes.FailedPrecondition,
				runtimev1.ReasonCode_AGENT_AI_CONFIG_MODEL_TARGET_MISMATCH,
			)
		}
		return nil, binding, asset, nil
	default:
		return nil, nil, nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
}

func invalidScenarioDurableTargetRef(targetRef *runtimev1.RuntimeDurableTargetRef) error {
	if cloud := targetRef.GetCloud(); cloud != nil {
		if strings.TrimSpace(cloud.GetConnectorId()) == "" {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_ID_REQUIRED)
		}
		if strings.TrimSpace(cloud.GetProviderModelId()) == "" {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MODEL_ID_REQUIRED)
		}
		if strings.TrimSpace(cloud.GetRemoteModelCatalogId()) == "" {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_REMOTE_MODEL_CATALOG_ID_REQUIRED)
		}
	}
	return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
}

func (s *Service) normalizeScenarioCloudTargetRef(ctx context.Context, head *runtimev1.ScenarioRequestHead, ref *runtimev1.RuntimeDurableCloudTargetRef) (*connector.RemoteModelCatalogBinding, error) {
	if ref == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	connectorID := strings.TrimSpace(ref.GetConnectorId())
	if connectorID == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_ID_REQUIRED)
	}
	if existing := strings.TrimSpace(head.GetConnectorId()); existing != "" && existing != connectorID {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_REMOTE_MODEL_CATALOG_STALE)
	}
	providerModelID := strings.TrimSpace(ref.GetProviderModelId())
	if providerModelID == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MODEL_ID_REQUIRED)
	}
	if strings.TrimSpace(ref.GetRemoteModelCatalogId()) == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_REMOTE_MODEL_CATALOG_ID_REQUIRED)
	}
	if strings.TrimSpace(head.GetConnectorId()) == "" {
		head.ConnectorId = connectorID
	}
	if strings.TrimSpace(head.GetModelId()) == "" {
		head.ModelId = providerModelID
	}
	subjectUserID := scenarioTargetSubjectUserID(ctx, head)
	if subjectUserID == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if s == nil || s.connStore == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND)
	}
	rec, found, err := s.connStore.Get(connectorID)
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, err, grpcerr.ReasonOptions{
			ActionHint: "retry_or_check_runtime_logs",
			Message:    "failed to read connector configuration",
		})
	}
	if !found {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND)
	}
	binding, err := connector.ResolveRemoteModelCatalogBinding(s.speechCatalog, subjectUserID, rec, connector.RemoteModelCatalogRef{
		ConnectorID:          connectorID,
		RemoteModelCatalogID: strings.TrimSpace(ref.GetRemoteModelCatalogId()),
		ProviderModelID:      providerModelID,
		Provider:             strings.TrimSpace(ref.GetProvider()),
	})
	if err != nil {
		return nil, err
	}
	canonicalProviderModelID := strings.TrimSpace(binding.ProviderModelID)
	if canonicalProviderModelID != "" {
		ref.ProviderModelId = canonicalProviderModelID
		if strings.TrimSpace(head.GetModelId()) == "" || strings.TrimSpace(head.GetModelId()) == providerModelID {
			head.ModelId = canonicalProviderModelID
		}
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
