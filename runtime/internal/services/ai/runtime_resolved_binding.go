package ai

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/grpc/codes"
)

func (s *Service) buildResolvedExecutionBinding(
	ctx context.Context,
	head *runtimev1.ScenarioRequestHead,
	capability string,
	resolvedBindingRef string,
) (*runtimev1.RuntimeResolvedExecutionBinding, error) {
	if head == nil || head.GetTargetRef() == nil {
		return nil, nil
	}
	source := cloneRuntimeDurableTargetRef(head.GetTargetRef())
	out := &runtimev1.RuntimeResolvedExecutionBinding{
		BindingVersion:     "v2",
		Capability:         strings.TrimSpace(capability),
		ResolvedBindingRef: strings.TrimSpace(resolvedBindingRef),
		SourceTargetRef:    source,
		RouteMetadataRef:   routeMetadataRefForResolvedBinding(capability, resolvedBindingRef),
	}

	switch target := source.GetTarget().(type) {
	case *runtimev1.RuntimeDurableTargetRef_Cloud:
		cloud, err := s.resolveCloudExecutionBinding(ctx, head, target.Cloud)
		if err != nil {
			return nil, err
		}
		out.Binding = &runtimev1.RuntimeResolvedExecutionBinding_Cloud{Cloud: cloud}
	case *runtimev1.RuntimeDurableTargetRef_LocalRuntime:
		local := target.LocalRuntime
		if local == nil {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		out.Binding = &runtimev1.RuntimeResolvedExecutionBinding_LocalRuntime{
			LocalRuntime: &runtimev1.RuntimeResolvedLocalExecutionBinding{
				ProfileBindingId: strings.TrimSpace(local.GetProfileBindingId()),
				ReadinessRef:     strings.TrimSpace(local.GetReadinessRef()),
				ResolvedModelId:  strings.TrimSpace(head.GetModelId()),
			},
		}
	default:
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	return out, nil
}

func (s *Service) resolveCloudExecutionBinding(
	ctx context.Context,
	head *runtimev1.ScenarioRequestHead,
	ref *runtimev1.RuntimeDurableCloudTargetRef,
) (*runtimev1.RuntimeResolvedCloudExecutionBinding, error) {
	if ref == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if s == nil || s.connStore == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND)
	}
	connectorID := strings.TrimSpace(ref.GetConnectorId())
	rec, found, err := s.connStore.Get(connectorID)
	if err != nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, grpcerr.ReasonOptions{
			ActionHint: "retry_or_check_runtime_logs",
		})
	}
	if !found {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND)
	}
	binding, err := connector.ResolveRemoteModelCatalogBinding(
		s.speechCatalog,
		scenarioTargetSubjectUserID(ctx, head),
		rec,
		connector.RemoteModelCatalogRef{
			ConnectorID:          connectorID,
			RemoteModelCatalogID: strings.TrimSpace(ref.GetRemoteModelCatalogId()),
			ProviderModelID:      strings.TrimSpace(ref.GetProviderModelId()),
			Provider:             strings.TrimSpace(ref.GetProvider()),
		},
	)
	if err != nil {
		return nil, err
	}
	return &runtimev1.RuntimeResolvedCloudExecutionBinding{
		ConnectorId:          binding.ConnectorID,
		RemoteModelCatalogId: binding.RemoteModelCatalogID,
		ProviderModelId:      binding.ProviderModelID,
		Provider:             binding.Provider,
		EndpointProfileId:    binding.EndpointProfileID,
		ConnectorSnapshotId:  binding.ConnectorSnapshotID,
	}, nil
}

func routeMetadataRefForResolvedBinding(capability string, resolvedBindingRef string) string {
	ref := strings.TrimSpace(resolvedBindingRef)
	if ref != "" {
		return "route-metadata/" + ref
	}
	capability = strings.TrimSpace(capability)
	if capability == "" {
		capability = "unknown"
	}
	return "route-metadata/" + capability
}

func cloneRuntimeDurableTargetRef(input *runtimev1.RuntimeDurableTargetRef) *runtimev1.RuntimeDurableTargetRef {
	if input == nil {
		return nil
	}
	switch target := input.GetTarget().(type) {
	case *runtimev1.RuntimeDurableTargetRef_Cloud:
		cloud := target.Cloud
		if cloud == nil {
			return &runtimev1.RuntimeDurableTargetRef{Target: &runtimev1.RuntimeDurableTargetRef_Cloud{}}
		}
		return &runtimev1.RuntimeDurableTargetRef{
			Target: &runtimev1.RuntimeDurableTargetRef_Cloud{
				Cloud: &runtimev1.RuntimeDurableCloudTargetRef{
					Version:              cloud.GetVersion(),
					ConnectorId:          cloud.GetConnectorId(),
					RemoteModelCatalogId: cloud.GetRemoteModelCatalogId(),
					ProviderModelId:      cloud.GetProviderModelId(),
					Provider:             cloud.GetProvider(),
				},
			},
		}
	case *runtimev1.RuntimeDurableTargetRef_LocalRuntime:
		local := target.LocalRuntime
		if local == nil {
			return &runtimev1.RuntimeDurableTargetRef{Target: &runtimev1.RuntimeDurableTargetRef_LocalRuntime{}}
		}
		out := &runtimev1.RuntimeDurableLocalTargetRef{
			Version: local.GetVersion(),
		}
		switch local.GetRef().(type) {
		case *runtimev1.RuntimeDurableLocalTargetRef_ProfileBindingId:
			out.Ref = &runtimev1.RuntimeDurableLocalTargetRef_ProfileBindingId{ProfileBindingId: local.GetProfileBindingId()}
		case *runtimev1.RuntimeDurableLocalTargetRef_ReadinessRef:
			out.Ref = &runtimev1.RuntimeDurableLocalTargetRef_ReadinessRef{ReadinessRef: local.GetReadinessRef()}
		}
		return &runtimev1.RuntimeDurableTargetRef{
			Target: &runtimev1.RuntimeDurableTargetRef_LocalRuntime{LocalRuntime: out},
		}
	default:
		return &runtimev1.RuntimeDurableTargetRef{}
	}
}

func runtimeDurableTargetRefJSON(input *runtimev1.RuntimeDurableTargetRef) map[string]any {
	if input == nil {
		return nil
	}
	switch target := input.GetTarget().(type) {
	case *runtimev1.RuntimeDurableTargetRef_Cloud:
		cloud := target.Cloud
		if cloud == nil {
			return map[string]any{"cloud": map[string]any{}}
		}
		return map[string]any{
			"cloud": map[string]any{
				"version":              strings.TrimSpace(cloud.GetVersion()),
				"connectorId":          strings.TrimSpace(cloud.GetConnectorId()),
				"remoteModelCatalogId": strings.TrimSpace(cloud.GetRemoteModelCatalogId()),
				"providerModelId":      strings.TrimSpace(cloud.GetProviderModelId()),
				"provider":             strings.TrimSpace(cloud.GetProvider()),
			},
		}
	case *runtimev1.RuntimeDurableTargetRef_LocalRuntime:
		local := target.LocalRuntime
		if local == nil {
			return map[string]any{"localRuntime": map[string]any{}}
		}
		item := map[string]any{
			"version": strings.TrimSpace(local.GetVersion()),
		}
		if profileBindingID := strings.TrimSpace(local.GetProfileBindingId()); profileBindingID != "" {
			item["profileBindingId"] = profileBindingID
		}
		if readinessRef := strings.TrimSpace(local.GetReadinessRef()); readinessRef != "" {
			item["readinessRef"] = readinessRef
		}
		return map[string]any{"localRuntime": item}
	default:
		return nil
	}
}
