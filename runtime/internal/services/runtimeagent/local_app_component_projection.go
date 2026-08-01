package runtimeagent

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	localservice "github.com/nimiplatform/nimi/runtime/internal/services/localservice"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

func (s *Service) localAppAIConfigComponentProjection(
	ctx context.Context,
	component *runtimev1.RuntimeAgentAIConfigComponentSelection,
) *runtimev1.LocalAppAgentAIConfigComponentSelection {
	if component == nil {
		return nil
	}
	options := map[string]any(nil)
	if component.GetOptions() != nil {
		options = component.GetOptions().AsMap()
	}
	if err := localservice.ValidateDurableLocalImageComponentMetadata(
		nil,
		component.GetComponentKind(),
		"",
		component.GetWeight(),
		options,
	); err != nil {
		return nil
	}
	if component != nil && component.GetOptions() != nil &&
		runtimeAgentAIConfigSelectedParamsContainForbiddenField(component.GetOptions()) {
		return nil
	}
	logicalModelID := strings.TrimSpace(component.GetLogicalModelId())
	localTarget := component.GetTargetRef().GetLocalRuntime()
	if logicalModelID == "" || localTarget == nil {
		return nil
	}
	s.localAppRouteOptionsMu.RLock()
	inventory := s.localAppRouteOptions
	s.localAppRouteOptionsMu.RUnlock()
	resolver, ok := inventory.(runtimeAgentDurableLocalComponentTargetResolver)
	if !ok {
		return nil
	}
	binding, asset, err := resolver.ResolveDurableLocalComponentTarget(
		ctx,
		localTarget,
		strings.TrimSpace(component.GetComponentKind()),
	)
	if err != nil || binding == nil || asset == nil ||
		strings.TrimSpace(binding.GetResolvedModelId()) != logicalModelID {
		return nil
	}
	return &runtimev1.LocalAppAgentAIConfigComponentSelection{
		OccurrenceId:   component.GetOccurrenceId(),
		Order:          component.GetOrder(),
		Role:           component.GetRole(),
		ComponentKind:  component.GetComponentKind(),
		LogicalModelId: logicalModelID,
		Required:       component.GetRequired(),
		Weight:         component.GetWeight(),
		Options:        cloneStruct(component.GetOptions()),
	}
}

func (s *Service) localAppAIConfigComponentProjections(
	ctx context.Context,
	components []*runtimev1.RuntimeAgentAIConfigComponentSelection,
) []*runtimev1.LocalAppAgentAIConfigComponentSelection {
	out := make([]*runtimev1.LocalAppAgentAIConfigComponentSelection, 0, len(components))
	for _, component := range components {
		if projected := s.localAppAIConfigComponentProjection(ctx, component); projected != nil {
			out = append(out, projected)
		}
	}
	return out
}

func localAppAIConfigComponentsToRuntime(
	capability string,
	input []*runtimev1.LocalAppAgentAIConfigComponentSelection,
	committed []*runtimev1.RuntimeAgentAIConfigComponentSelection,
) ([]*runtimev1.RuntimeAgentAIConfigComponentSelection, error) {
	invalid := func() ([]*runtimev1.RuntimeAgentAIConfigComponentSelection, error) {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if capability != runtimeAgentAIConfigCapabilityImageGenerate {
		if len(input) != 0 {
			return invalid()
		}
		return nil, nil
	}
	if len(input) != len(committed) {
		return invalid()
	}
	out := make([]*runtimev1.RuntimeAgentAIConfigComponentSelection, 0, len(input))
	for index, item := range input {
		current := committed[index]
		if item == nil || current == nil ||
			strings.TrimSpace(item.GetOccurrenceId()) == "" ||
			strings.TrimSpace(item.GetLogicalModelId()) == "" ||
			strings.TrimSpace(item.GetOccurrenceId()) != strings.TrimSpace(current.GetOccurrenceId()) ||
			item.GetOrder() != current.GetOrder() ||
			strings.TrimSpace(item.GetRole()) != strings.TrimSpace(current.GetRole()) ||
			strings.TrimSpace(item.GetComponentKind()) != strings.TrimSpace(current.GetComponentKind()) ||
			item.GetRequired() != current.GetRequired() ||
			strings.TrimSpace(item.GetWeight()) != strings.TrimSpace(current.GetWeight()) ||
			!proto.Equal(item.GetOptions(), current.GetOptions()) {
			return invalid()
		}

		if localAppAIConfigComponentPublicEqual(item, current) {
			out = append(out, proto.Clone(current).(*runtimev1.RuntimeAgentAIConfigComponentSelection))
			continue
		}
		out = append(out, &runtimev1.RuntimeAgentAIConfigComponentSelection{
			OccurrenceId:   strings.TrimSpace(item.GetOccurrenceId()),
			Order:          item.GetOrder(),
			Role:           strings.TrimSpace(item.GetRole()),
			ComponentKind:  strings.TrimSpace(item.GetComponentKind()),
			LogicalModelId: strings.TrimSpace(item.GetLogicalModelId()),
			Required:       item.GetRequired(),
			Weight:         strings.TrimSpace(item.GetWeight()),
			Options:        cloneStruct(item.GetOptions()),
		})
	}
	return out, nil
}

func localAppAIConfigComponentPublicEqual(
	left *runtimev1.LocalAppAgentAIConfigComponentSelection,
	right *runtimev1.RuntimeAgentAIConfigComponentSelection,
) bool {
	return left != nil && right != nil &&
		strings.TrimSpace(left.GetOccurrenceId()) == strings.TrimSpace(right.GetOccurrenceId()) &&
		left.GetOrder() == right.GetOrder() &&
		strings.TrimSpace(left.GetRole()) == strings.TrimSpace(right.GetRole()) &&
		strings.TrimSpace(left.GetComponentKind()) == strings.TrimSpace(right.GetComponentKind()) &&
		strings.TrimSpace(left.GetLogicalModelId()) == strings.TrimSpace(right.GetLogicalModelId()) &&
		left.GetRequired() == right.GetRequired() &&
		strings.TrimSpace(left.GetWeight()) == strings.TrimSpace(right.GetWeight()) &&
		proto.Equal(left.GetOptions(), right.GetOptions())
}

func (s *Service) materializeLocalAppComponentTargets(
	ctx context.Context,
	intents []*runtimev1.RuntimeAgentAIConfigIntent,
) ([]*runtimev1.RuntimeAgentAIConfigIntent, error) {
	needsMaterialization := false
	for _, intent := range intents {
		if intent != nil && len(intent.GetSelectedComponents()) > 0 &&
			(strings.TrimSpace(intent.GetCapability()) != runtimeAgentAIConfigCapabilityImageGenerate ||
				intent.GetRoutePolicy() != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL) {
			return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
		}
		for _, component := range intent.GetSelectedComponents() {
			if component.GetTargetRef().GetTarget() == nil {
				needsMaterialization = true
				break
			}
		}
	}
	if !needsMaterialization {
		return intents, nil
	}

	s.localAppRouteOptionsMu.RLock()
	inventory := s.localAppRouteOptions
	s.localAppRouteOptionsMu.RUnlock()
	resolver, ok := inventory.(runtimeAgentDurableLocalComponentTargetResolver)
	if inventory == nil || !ok {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
	}

	assets := make([]*runtimev1.LocalAssetRecord, 0)
	for _, statusFilter := range []runtimev1.LocalAssetStatus{
		runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
		runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
	} {
		pageToken := ""
		for {
			response, err := inventory.ListLocalAssets(ctx, &runtimev1.ListLocalAssetsRequest{
				StatusFilter: statusFilter,
				PageSize:     200,
				PageToken:    pageToken,
			})
			if err != nil {
				return nil, err
			}
			assets = append(assets, response.GetAssets()...)
			pageToken = strings.TrimSpace(response.GetNextPageToken())
			if pageToken == "" {
				break
			}
		}
	}

	out := append([]*runtimev1.RuntimeAgentAIConfigIntent(nil), intents...)
	for intentIndex, intent := range intents {
		if len(intent.GetSelectedComponents()) == 0 {
			continue
		}
		materializedIntent := proto.Clone(intent).(*runtimev1.RuntimeAgentAIConfigIntent)
		changed := false
		for componentIndex, component := range intent.GetSelectedComponents() {
			if component.GetTargetRef().GetTarget() != nil {
				continue
			}
			logicalModelID := strings.TrimSpace(component.GetLogicalModelId())
			componentKind := strings.TrimSpace(component.GetComponentKind())
			candidates := make(map[string]*runtimev1.RuntimeDurableLocalTargetRef)
			for _, asset := range assets {
				if asset == nil || strings.TrimSpace(asset.GetLogicalModelId()) != logicalModelID ||
					!localAppLocalAssetSelectableForNewBinding(asset, runtimeAgentAIConfigCapabilityImageGenerate) {
					continue
				}
				target := asset.GetDurableTargetRef()
				binding, resolvedAsset, err := resolver.ResolveDurableLocalComponentTarget(ctx, target, componentKind)
				if err != nil || binding == nil || resolvedAsset == nil ||
					strings.TrimSpace(binding.GetResolvedModelId()) != logicalModelID ||
					!localAppLocalAssetSelectableForNewBinding(resolvedAsset, runtimeAgentAIConfigCapabilityImageGenerate) {
					continue
				}
				candidateID := strings.TrimSpace(binding.GetLocalAssetId())
				if candidateID == "" {
					continue
				}
				candidates[candidateID] = target
			}
			if len(candidates) != 1 {
				return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
			}
			var target *runtimev1.RuntimeDurableLocalTargetRef
			for _, candidate := range candidates {
				target = candidate
			}
			materialized := proto.Clone(component).(*runtimev1.RuntimeAgentAIConfigComponentSelection)
			materialized.TargetRef = &runtimev1.RuntimeDurableTargetRef{
				Target: &runtimev1.RuntimeDurableTargetRef_LocalRuntime{
					LocalRuntime: proto.Clone(target).(*runtimev1.RuntimeDurableLocalTargetRef),
				},
			}
			materializedIntent.SelectedComponents[componentIndex] = materialized
			changed = true
		}
		if changed {
			out[intentIndex] = materializedIntent
		}
	}
	return out, nil
}
