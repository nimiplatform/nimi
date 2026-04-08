package ai

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/scheduler"
)

// PeekScheduling implements K-SCHED-002: non-blocking scheduling preflight
// assessment exposed via gRPC. It delegates to the scheduler's Peek method
// and maps the result to proto types.
func (s *Service) PeekScheduling(_ context.Context, req *runtimev1.PeekSchedulingRequest) (*runtimev1.PeekSchedulingResponse, error) {
	appID := strings.TrimSpace(req.GetAppId())
	if appID == "" {
		appID = "_default"
	}
	judgement := s.scheduler.Peek(context.Background(), scheduler.PeekInput{
		AppID:   appID,
		Targets: toSchedulerTargets(req.GetTargets()),
	})
	return &runtimev1.PeekSchedulingResponse{
		Occupancy:          toProtoOccupancy(judgement.Occupancy),
		AggregateJudgement: toProtoSchedulingJudgement(judgement.AggregateJudgement),
		TargetJudgements:   toProtoTargetJudgements(judgement.TargetJudgements),
	}, nil
}

func toSchedulerTargets(targets []*runtimev1.SchedulingEvaluationTarget) []scheduler.SchedulingEvaluationTarget {
	if len(targets) == 0 {
		return nil
	}
	out := make([]scheduler.SchedulingEvaluationTarget, 0, len(targets))
	for _, target := range targets {
		if target == nil {
			continue
		}
		out = append(out, scheduler.SchedulingEvaluationTarget{
			Capability: strings.TrimSpace(target.GetCapability()),
			ModID:      strings.TrimSpace(target.GetModId()),
			ProfileID:  strings.TrimSpace(target.GetProfileId()),
			Hint:       toSchedulerResourceHint(target.GetResourceHint()),
		})
	}
	return out
}

func toSchedulerResourceHint(hint *runtimev1.SchedulingResourceHint) *scheduler.ResourceHint {
	if hint == nil {
		return nil
	}
	return &scheduler.ResourceHint{
		EstimatedVramBytes: hint.GetEstimatedVramBytes(),
		EstimatedRamBytes:  hint.GetEstimatedRamBytes(),
		EstimatedDiskBytes: hint.GetEstimatedDiskBytes(),
		Engine:             strings.TrimSpace(hint.GetEngine()),
	}
}

func toProtoSchedulingJudgement(j scheduler.SchedulingJudgement) *runtimev1.SchedulingJudgement {
	return &runtimev1.SchedulingJudgement{
		State:            toProtoSchedulingState(j.State),
		Detail:           j.Detail,
		Occupancy:        toProtoOccupancy(j.Occupancy),
		ResourceWarnings: j.ResourceWarnings,
	}
}

func toProtoTargetJudgements(judgements []scheduler.TargetSchedulingJudgement) []*runtimev1.SchedulingTargetJudgement {
	if len(judgements) == 0 {
		return nil
	}
	out := make([]*runtimev1.SchedulingTargetJudgement, 0, len(judgements))
	for _, judgement := range judgements {
		out = append(out, &runtimev1.SchedulingTargetJudgement{
			Target: &runtimev1.SchedulingEvaluationTarget{
				Capability:   judgement.Target.Capability,
				ModId:        judgement.Target.ModID,
				ProfileId:    judgement.Target.ProfileID,
				ResourceHint: toProtoResourceHint(judgement.Target.Hint),
			},
			Judgement: toProtoSchedulingJudgement(judgement.Judgement),
		})
	}
	return out
}

func toProtoResourceHint(hint *scheduler.ResourceHint) *runtimev1.SchedulingResourceHint {
	if hint == nil {
		return nil
	}
	return &runtimev1.SchedulingResourceHint{
		EstimatedVramBytes: hint.EstimatedVramBytes,
		EstimatedRamBytes:  hint.EstimatedRamBytes,
		EstimatedDiskBytes: hint.EstimatedDiskBytes,
		Engine:             hint.Engine,
	}
}

func toProtoSchedulingState(s scheduler.SchedulingState) runtimev1.SchedulingState {
	switch s {
	case scheduler.StateRunnable:
		return runtimev1.SchedulingState_SCHEDULING_STATE_RUNNABLE
	case scheduler.StateQueueRequired:
		return runtimev1.SchedulingState_SCHEDULING_STATE_QUEUE_REQUIRED
	case scheduler.StatePreemptionRisk:
		return runtimev1.SchedulingState_SCHEDULING_STATE_PREEMPTION_RISK
	case scheduler.StateSlowdownRisk:
		return runtimev1.SchedulingState_SCHEDULING_STATE_SLOWDOWN_RISK
	case scheduler.StateDenied:
		return runtimev1.SchedulingState_SCHEDULING_STATE_DENIED
	case scheduler.StateUnknown:
		return runtimev1.SchedulingState_SCHEDULING_STATE_UNKNOWN
	default:
		return runtimev1.SchedulingState_SCHEDULING_STATE_UNSPECIFIED
	}
}

func toProtoOccupancy(o scheduler.OccupancySnapshot) *runtimev1.SchedulingOccupancySnapshot {
	return &runtimev1.SchedulingOccupancySnapshot{
		GlobalUsed: int32(o.GlobalUsed),
		GlobalCap:  int32(o.GlobalCap),
		AppUsed:    int32(o.AppUsed),
		AppCap:     int32(o.AppCap),
	}
}
