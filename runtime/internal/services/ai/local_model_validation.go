package ai

import (
	"context"
	"sort"
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
)

type localModelLister interface {
	ListLocalModels(context.Context, *runtimev1.ListLocalModelsRequest) (*runtimev1.ListLocalModelsResponse, error)
}

type localModelSelector struct {
	modelID        string
	explicitEngine string
	preferLocalAI  bool
}

func (s *Service) validateLocalModelRequest(ctx context.Context, requestedModelID string, remoteTarget *nimillm.RemoteTarget) error {
	if remoteTarget != nil {
		return nil
	}
	if s.localModel == nil {
		return nil
	}
	if preferredRoute(requestedModelID) != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME {
		return nil
	}

	localModels, err := s.listAllActiveLocalModels(ctx)
	if err != nil {
		return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}

	selector := parseLocalModelSelector(requestedModelID)
	selected, reason := selectActiveLocalModel(localModels, selector)
	if reason != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		return grpcerr.WithReasonCode(codes.FailedPrecondition, reason)
	}
	if selected == nil {
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}
	if modelRequiresInvokeProfile(selected) {
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_PROFILE_MISSING)
	}
	return nil
}

func (s *Service) listAllActiveLocalModels(ctx context.Context) ([]*runtimev1.LocalModelRecord, error) {
	pageToken := ""
	collected := make([]*runtimev1.LocalModelRecord, 0, 16)
	for i := 0; i < 20; i++ {
		resp, err := s.localModel.ListLocalModels(ctx, &runtimev1.ListLocalModelsRequest{
			StatusFilter: runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE,
			PageSize:     100,
			PageToken:    pageToken,
		})
		if err != nil {
			return nil, err
		}
		collected = append(collected, resp.GetModels()...)
		pageToken = strings.TrimSpace(resp.GetNextPageToken())
		if pageToken == "" {
			break
		}
	}
	return collected, nil
}

func parseLocalModelSelector(modelID string) localModelSelector {
	raw := strings.TrimSpace(modelID)
	lower := strings.ToLower(raw)
	selector := localModelSelector{}
	switch {
	case strings.HasPrefix(lower, "localai/"):
		selector.explicitEngine = "localai"
		selector.modelID = strings.TrimSpace(raw[len("localai/"):])
	case strings.HasPrefix(lower, "nexa/"):
		selector.explicitEngine = "nexa"
		selector.modelID = strings.TrimSpace(raw[len("nexa/"):])
	case strings.HasPrefix(lower, "local/"):
		selector.preferLocalAI = true
		selector.modelID = strings.TrimSpace(raw[len("local/"):])
	default:
		selector.modelID = raw
	}
	if selector.modelID == "" {
		selector.modelID = "local-model"
	}
	return selector
}

func selectActiveLocalModel(models []*runtimev1.LocalModelRecord, selector localModelSelector) (*runtimev1.LocalModelRecord, runtimev1.ReasonCode) {
	candidates := make([]*runtimev1.LocalModelRecord, 0, len(models))
	for _, model := range models {
		if strings.TrimSpace(model.GetModelId()) != selector.modelID {
			continue
		}
		candidates = append(candidates, model)
	}
	if len(candidates) == 0 {
		return nil, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE
	}

	sort.Slice(candidates, func(i, j int) bool {
		pi := localEnginePriority(candidates[i].GetEngine())
		pj := localEnginePriority(candidates[j].GetEngine())
		if pi != pj {
			return pi < pj
		}
		return candidates[i].GetLocalModelId() < candidates[j].GetLocalModelId()
	})

	if selector.explicitEngine != "" {
		for _, model := range candidates {
			if strings.EqualFold(strings.TrimSpace(model.GetEngine()), selector.explicitEngine) {
				return model, runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED
			}
		}
		return nil, runtimev1.ReasonCode_AI_MODEL_PROVIDER_MISMATCH
	}

	if selector.preferLocalAI {
		for _, model := range candidates {
			if strings.EqualFold(strings.TrimSpace(model.GetEngine()), "localai") {
				return model, runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED
			}
		}
		for _, model := range candidates {
			if strings.EqualFold(strings.TrimSpace(model.GetEngine()), "nexa") {
				return model, runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED
			}
		}
		return nil, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE
	}

	return candidates[0], runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED
}

func localEnginePriority(engine string) int {
	switch strings.ToLower(strings.TrimSpace(engine)) {
	case "localai":
		return 0
	case "nexa":
		return 1
	default:
		return 2
	}
}

func modelRequiresInvokeProfile(model *runtimev1.LocalModelRecord) bool {
	if strings.TrimSpace(model.GetLocalInvokeProfileId()) != "" {
		return false
	}
	for _, capability := range model.GetCapabilities() {
		capability = strings.ToLower(strings.TrimSpace(capability))
		if capability == "custom" || strings.HasPrefix(capability, "custom.") || strings.HasPrefix(capability, "custom/") {
			return true
		}
	}
	return false
}
