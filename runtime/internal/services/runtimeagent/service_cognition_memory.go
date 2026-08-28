package runtimeagent

import (
	"context"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"github.com/nimiplatform/nimi/runtime/internal/services/cognitionmemory"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func projectAgentMemory(input cognitionmemory.Projection) *runtimev1.AgentMemoryProjection {
	projection := &runtimev1.AgentMemoryProjection{
		Outcome: projectMemoryOutcome(input.Outcome), Enabled: input.Enabled, AdoptionRequired: input.AdoptionRequired,
		CurrentCount: uint64(input.CurrentCount), SupersededCount: uint64(input.SupersededCount), ForgottenCount: uint64(input.ForgottenCount),
		NextPageToken: input.NextPageToken,
	}
	for _, item := range input.Items {
		projection.Items = append(projection.Items, &runtimev1.AgentMemoryItem{
			MemoryId: item.MemoryRef, Content: item.Content, EpistemicStatus: projectEpistemicStatus(item.EpistemicStatus), Lifecycle: projectMemoryLifecycle(item.Lifecycle),
			OccurredAt: timestamppb.New(item.OccurredAt), UpdatedAt: timestamppb.New(item.UpdatedAt), SourceExplanation: item.SourceExplanation,
		})
	}
	return projection
}

func projectMemoryOutcome(outcome memoryv1.Outcome) runtimev1.CognitionMemoryOutcome {
	switch outcome {
	case memoryv1.OutcomeUnsupported:
		return runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_UNSUPPORTED
	case memoryv1.OutcomeInvalid:
		return runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_INVALID
	case memoryv1.OutcomeUnconfigured:
		return runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_UNCONFIGURED
	case memoryv1.OutcomePending:
		return runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_PENDING
	case memoryv1.OutcomeBuilding:
		return runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_BUILDING
	case memoryv1.OutcomeReceived:
		return runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_RECEIVED
	case memoryv1.OutcomeProcessing:
		return runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_PROCESSING
	case memoryv1.OutcomeReady:
		return runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_READY
	case memoryv1.OutcomeNoHits:
		return runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_NO_HITS
	case memoryv1.OutcomeUnavailable:
		return runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_UNAVAILABLE
	case memoryv1.OutcomeFailed:
		return runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_FAILED
	case memoryv1.OutcomeNoEffect:
		return runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_NO_EFFECT
	case memoryv1.OutcomeRejected:
		return runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_REJECTED
	case memoryv1.OutcomeAdmitted:
		return runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_ADMITTED
	case memoryv1.OutcomeForgotten:
		return runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_FORGOTTEN
	case memoryv1.OutcomeDeleted:
		return runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_DELETED
	case memoryv1.OutcomeAlreadyAbsent:
		return runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_ALREADY_ABSENT
	case memoryv1.OutcomeCommitted:
		return runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_COMMITTED
	case memoryv1.OutcomeConflict:
		return runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_CONFLICT
	case memoryv1.OutcomeDuplicate:
		return runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_DUPLICATE
	default:
		return runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_UNSPECIFIED
	}
}

func projectEpistemicStatus(value memoryv1.EpistemicStatus) runtimev1.CognitionMemoryEpistemicStatus {
	switch value {
	case memoryv1.EpistemicExplicit:
		return runtimev1.CognitionMemoryEpistemicStatus_COGNITION_MEMORY_EPISTEMIC_STATUS_EXPLICIT
	case memoryv1.EpistemicInferred:
		return runtimev1.CognitionMemoryEpistemicStatus_COGNITION_MEMORY_EPISTEMIC_STATUS_INFERRED
	case memoryv1.EpistemicConsolidated:
		return runtimev1.CognitionMemoryEpistemicStatus_COGNITION_MEMORY_EPISTEMIC_STATUS_CONSOLIDATED
	default:
		return runtimev1.CognitionMemoryEpistemicStatus_COGNITION_MEMORY_EPISTEMIC_STATUS_UNSPECIFIED
	}
}

func projectMemoryLifecycle(value memoryv1.Lifecycle) runtimev1.CognitionMemoryLifecycle {
	switch value {
	case memoryv1.LifecycleCurrent:
		return runtimev1.CognitionMemoryLifecycle_COGNITION_MEMORY_LIFECYCLE_CURRENT
	case memoryv1.LifecycleSuperseded:
		return runtimev1.CognitionMemoryLifecycle_COGNITION_MEMORY_LIFECYCLE_SUPERSEDED
	case memoryv1.LifecycleConflicted:
		return runtimev1.CognitionMemoryLifecycle_COGNITION_MEMORY_LIFECYCLE_CONFLICTED
	case memoryv1.LifecycleForgotten:
		return runtimev1.CognitionMemoryLifecycle_COGNITION_MEMORY_LIFECYCLE_FORGOTTEN
	default:
		return runtimev1.CognitionMemoryLifecycle_COGNITION_MEMORY_LIFECYCLE_UNSPECIFIED
	}
}

func (s *Service) InspectLocalAppAgentMemory(ctx context.Context, req *runtimev1.InspectLocalAppAgentMemoryRequest) (*runtimev1.InspectLocalAppAgentMemoryResponse, error) {
	resolved, _, err := s.resolveLocalAppAgent(ctx, accountservice.LocalAppOperationMemoryInspect, req.GetAgentHandle())
	if err != nil {
		return nil, err
	}
	if err := s.requireCognitionMemoryOwner(); err != nil {
		return nil, err
	}
	projection, err := s.cognitionMemoryFacade.Inspect(ctx, cognitionmemory.InspectIntent{LocalAgentRef: resolved.identity.LocalAgentRef, Limit: int(req.GetLimit()), PageToken: req.GetPageToken()})
	if err != nil {
		return nil, err
	}
	return &runtimev1.InspectLocalAppAgentMemoryResponse{Projection: projectAgentMemory(projection)}, nil
}

func (s *Service) CorrectLocalAppAgentMemory(ctx context.Context, req *runtimev1.CorrectLocalAppAgentMemoryRequest) (*runtimev1.CorrectLocalAppAgentMemoryResponse, error) {
	resolved, _, err := s.resolveLocalAppAgent(ctx, accountservice.LocalAppOperationMemoryCorrect, req.GetAgentHandle())
	if err != nil {
		return nil, err
	}
	if err := s.requireCognitionMemoryOwner(); err != nil {
		return nil, err
	}
	result, err := s.cognitionMemoryFacade.Correct(ctx, resolved.identity.LocalAgentRef, req.GetMemoryId(), req.GetCorrectedContent())
	if err != nil {
		return nil, err
	}
	return &runtimev1.CorrectLocalAppAgentMemoryResponse{Outcome: projectMemoryOutcome(result.Outcome), AffectedMemoryIds: result.AffectedMemoryRefs, Projection: projectAgentMemory(result.Projection)}, nil
}

func (s *Service) ForgetLocalAppAgentMemory(ctx context.Context, req *runtimev1.ForgetLocalAppAgentMemoryRequest) (*runtimev1.ForgetLocalAppAgentMemoryResponse, error) {
	resolved, _, err := s.resolveLocalAppAgent(ctx, accountservice.LocalAppOperationMemoryForget, req.GetAgentHandle())
	if err != nil {
		return nil, err
	}
	if err := s.requireCognitionMemoryOwner(); err != nil {
		return nil, err
	}
	result, err := s.cognitionMemoryFacade.Forget(ctx, resolved.identity.LocalAgentRef, req.GetMemoryIds(), req.GetConfirmed())
	if err != nil {
		return nil, err
	}
	return &runtimev1.ForgetLocalAppAgentMemoryResponse{Outcome: projectMemoryOutcome(result.Outcome), AffectedMemoryIds: result.AffectedMemoryRefs, Projection: projectAgentMemory(result.Projection)}, nil
}

func (s *Service) SetLocalAppAgentMemoryEnabled(ctx context.Context, req *runtimev1.SetLocalAppAgentMemoryEnabledRequest) (*runtimev1.SetLocalAppAgentMemoryEnabledResponse, error) {
	resolved, _, err := s.resolveLocalAppAgent(ctx, accountservice.LocalAppOperationMemorySwitch, req.GetAgentHandle())
	if err != nil {
		return nil, err
	}
	if err := s.requireCognitionMemoryOwner(); err != nil {
		return nil, err
	}
	result, err := s.cognitionMemoryFacade.SetEnabled(ctx, resolved.identity.LocalAgentRef, req.GetEnabled())
	if err != nil {
		return nil, err
	}
	return &runtimev1.SetLocalAppAgentMemoryEnabledResponse{Outcome: projectMemoryOutcome(result.Outcome), Projection: projectAgentMemory(result.Projection)}, nil
}

func (s *Service) DeleteAllLocalAppAgentMemory(ctx context.Context, req *runtimev1.DeleteAllLocalAppAgentMemoryRequest) (*runtimev1.DeleteAllLocalAppAgentMemoryResponse, error) {
	resolved, _, err := s.resolveLocalAppAgent(ctx, accountservice.LocalAppOperationMemoryDelete, req.GetAgentHandle())
	if err != nil {
		return nil, err
	}
	if err := s.requireCognitionMemoryOwner(); err != nil {
		return nil, err
	}
	result, err := s.cognitionMemoryFacade.DeleteAll(ctx, resolved.identity.LocalAgentRef, req.GetConfirmed())
	if err != nil {
		return nil, err
	}
	return &runtimev1.DeleteAllLocalAppAgentMemoryResponse{Outcome: projectMemoryOutcome(result.Outcome), AffectedMemoryIds: result.AffectedMemoryRefs, Projection: projectAgentMemory(result.Projection)}, nil
}

func (s *Service) requireCognitionMemoryOwner() error {
	if s == nil || s.cognitionMemoryFacade == nil {
		return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_LOCAL_APP_OWNER_UNAVAILABLE)
	}
	return nil
}
