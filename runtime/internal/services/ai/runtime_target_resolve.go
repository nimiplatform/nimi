package ai

import (
	"context"
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
)

func (s *Service) normalizeScenarioRuntimeTargetRef(ctx context.Context, head *runtimev1.ScenarioRequestHead) error {
	if head == nil || head.GetTargetRef() == nil {
		return nil
	}
	switch target := head.GetTargetRef().GetTarget().(type) {
	case *runtimev1.RuntimeDurableTargetRef_Cloud:
		return s.normalizeScenarioCloudTargetRef(ctx, head, target.Cloud)
	case *runtimev1.RuntimeDurableTargetRef_LocalRuntime:
		return normalizeScenarioLocalTargetRef(target.LocalRuntime)
	default:
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
}

func normalizeScenarioLocalTargetRef(ref *runtimev1.RuntimeDurableLocalTargetRef) error {
	if ref == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	switch ref.GetRef().(type) {
	case *runtimev1.RuntimeDurableLocalTargetRef_ProfileBindingId:
		if strings.TrimSpace(ref.GetProfileBindingId()) == "" {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
	case *runtimev1.RuntimeDurableLocalTargetRef_ReadinessRef:
		if strings.TrimSpace(ref.GetReadinessRef()) == "" {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
	default:
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	return nil
}

func (s *Service) normalizeScenarioCloudTargetRef(ctx context.Context, head *runtimev1.ScenarioRequestHead, ref *runtimev1.RuntimeDurableCloudTargetRef) error {
	if ref == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	connectorID := strings.TrimSpace(ref.GetConnectorId())
	if connectorID == "" {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_ID_REQUIRED)
	}
	if existing := strings.TrimSpace(head.GetConnectorId()); existing != "" && existing != connectorID {
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_REMOTE_MODEL_CATALOG_STALE)
	}
	providerModelID := strings.TrimSpace(ref.GetProviderModelId())
	if providerModelID == "" {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MODEL_ID_REQUIRED)
	}
	if strings.TrimSpace(ref.GetRemoteModelCatalogId()) == "" {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_REMOTE_MODEL_CATALOG_ID_REQUIRED)
	}
	if strings.TrimSpace(head.GetConnectorId()) == "" {
		head.ConnectorId = connectorID
	}
	if strings.TrimSpace(head.GetModelId()) == "" {
		head.ModelId = providerModelID
	}
	if s == nil || s.connStore == nil {
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND)
	}
	rec, found, err := s.connStore.Get(connectorID)
	if err != nil {
		return grpcerr.WithReasonCodeOptions(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, grpcerr.ReasonOptions{
			ActionHint: "retry_or_check_runtime_logs",
		})
	}
	if !found {
		return grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND)
	}
	subjectUserID := scenarioTargetSubjectUserID(ctx, head)
	_, err = connector.ResolveRemoteModelCatalogRef(s.speechCatalog, subjectUserID, rec, connector.RemoteModelCatalogRef{
		ConnectorID:          connectorID,
		RemoteModelCatalogID: strings.TrimSpace(ref.GetRemoteModelCatalogId()),
		ProviderModelID:      providerModelID,
		Provider:             strings.TrimSpace(ref.GetProvider()),
	})
	return err
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
