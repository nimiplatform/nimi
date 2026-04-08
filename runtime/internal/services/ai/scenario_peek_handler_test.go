package ai

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/scheduler"
)

func TestPeekSchedulingRPCReturnsJudgement(t *testing.T) {
	svc := &Service{
		scheduler: scheduler.New(scheduler.Config{GlobalConcurrency: 4, PerAppConcurrency: 2}),
	}
	resp, err := svc.PeekScheduling(context.Background(), &runtimev1.PeekSchedulingRequest{
		AppId: "test-app",
		Targets: []*runtimev1.SchedulingEvaluationTarget{
			{Capability: "text.generate"},
		},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.AggregateJudgement == nil {
		t.Fatal("expected non-nil aggregate judgement")
	}
	// Phase 1: risk assessment unavailable → unknown
	if resp.AggregateJudgement.State != runtimev1.SchedulingState_SCHEDULING_STATE_UNKNOWN {
		t.Fatalf("expected UNKNOWN (Phase 1), got=%s", resp.AggregateJudgement.State)
	}
	if resp.Occupancy == nil {
		t.Fatal("expected non-nil occupancy")
	}
	if resp.Occupancy.GlobalCap != 4 {
		t.Fatalf("expected globalCap=4, got=%d", resp.Occupancy.GlobalCap)
	}
	if len(resp.TargetJudgements) != 1 {
		t.Fatalf("expected one target judgement, got=%d", len(resp.TargetJudgements))
	}
}

func TestPeekSchedulingRPCDefaultsEmptyAppId(t *testing.T) {
	svc := &Service{
		scheduler: scheduler.New(scheduler.Config{GlobalConcurrency: 2, PerAppConcurrency: 1}),
	}
	resp, err := svc.PeekScheduling(context.Background(), &runtimev1.PeekSchedulingRequest{
		AppId: "",
		Targets: []*runtimev1.SchedulingEvaluationTarget{
			{Capability: "text.generate"},
		},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.AggregateJudgement == nil {
		t.Fatal("expected non-nil judgement")
	}
	// Should not error on empty appId — defaults to _default
	if resp.Occupancy.AppCap != 1 {
		t.Fatalf("expected appCap=1, got=%d", resp.Occupancy.AppCap)
	}
}

func TestPeekSchedulingRPCDenied(t *testing.T) {
	sched := scheduler.New(scheduler.Config{GlobalConcurrency: 4, PerAppConcurrency: 2})
	sched.RegisterDenialCheck(func() (bool, string) {
		return true, "no GPU available"
	})
	svc := &Service{scheduler: sched}

	resp, err := svc.PeekScheduling(context.Background(), &runtimev1.PeekSchedulingRequest{
		AppId: "test-app",
		Targets: []*runtimev1.SchedulingEvaluationTarget{
			{Capability: "text.generate"},
		},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.AggregateJudgement.State != runtimev1.SchedulingState_SCHEDULING_STATE_DENIED {
		t.Fatalf("expected DENIED, got=%s", resp.AggregateJudgement.State)
	}
	if resp.AggregateJudgement.Detail != "text.generate: no GPU available" {
		t.Fatalf("expected denial detail, got=%s", resp.AggregateJudgement.Detail)
	}
}

func TestPeekSchedulingRPCQueueRequired(t *testing.T) {
	sched := scheduler.New(scheduler.Config{GlobalConcurrency: 1, PerAppConcurrency: 2})
	release, _, err := sched.Acquire(context.Background(), "blocker")
	if err != nil {
		t.Fatalf("acquire: %v", err)
	}
	defer release()

	svc := &Service{scheduler: sched}
	resp, err := svc.PeekScheduling(context.Background(), &runtimev1.PeekSchedulingRequest{
		AppId: "test-app",
		Targets: []*runtimev1.SchedulingEvaluationTarget{
			{Capability: "text.generate"},
		},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.AggregateJudgement.State != runtimev1.SchedulingState_SCHEDULING_STATE_QUEUE_REQUIRED {
		t.Fatalf("expected QUEUE_REQUIRED, got=%s", resp.AggregateJudgement.State)
	}
}

func TestPeekSchedulingRPCMapsRepeatedTargets(t *testing.T) {
	sched := scheduler.New(scheduler.Config{GlobalConcurrency: 4, PerAppConcurrency: 2})
	sched.SetResourceAssessor(func() *scheduler.ResourceSnapshot {
		return &scheduler.ResourceSnapshot{
			AvailableRAMBytes:  16_000_000_000,
			AvailableVRAMBytes: 8_000_000_000,
			DiskFreeBytes:      100_000_000_000,
		}
	})
	sched.SetRiskThresholds(scheduler.RiskThresholds{
		SlowdownRAMBytes:         1,
		SlowdownVRAMBytes:        1,
		SlowdownDiskBytes:        1,
		PreemptionOccupancyRatio: 0.99,
	})
	sched.SetDependencyFeasibilityChecker(func(modID, profileID, capability string) (bool, string) {
		if profileID == "blocked" {
			return false, "dependency missing"
		}
		return true, ""
	})
	svc := &Service{scheduler: sched}

	resp, err := svc.PeekScheduling(context.Background(), &runtimev1.PeekSchedulingRequest{
		AppId: "test-app",
		Targets: []*runtimev1.SchedulingEvaluationTarget{
			{Capability: "text.generate", ModId: "core:runtime", ProfileId: "ok"},
			{Capability: "image.generate", ModId: "core:runtime", ProfileId: "blocked"},
		},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.AggregateJudgement == nil || resp.AggregateJudgement.State != runtimev1.SchedulingState_SCHEDULING_STATE_DENIED {
		t.Fatalf("expected aggregate denied, got=%v", resp.AggregateJudgement)
	}
	if len(resp.TargetJudgements) != 2 {
		t.Fatalf("expected two target judgements, got=%d", len(resp.TargetJudgements))
	}
	if resp.TargetJudgements[0].Target == nil || resp.TargetJudgements[1].Target == nil {
		t.Fatal("expected non-nil target mappings")
	}
	if resp.TargetJudgements[0].Judgement == nil || resp.TargetJudgements[1].Judgement == nil {
		t.Fatal("expected non-nil per-target judgements")
	}
	if resp.Occupancy == nil {
		t.Fatal("expected shared occupancy")
	}
}

func TestToProtoSchedulingStateMappings(t *testing.T) {
	cases := []struct {
		input    scheduler.SchedulingState
		expected runtimev1.SchedulingState
	}{
		{scheduler.StateRunnable, runtimev1.SchedulingState_SCHEDULING_STATE_RUNNABLE},
		{scheduler.StateQueueRequired, runtimev1.SchedulingState_SCHEDULING_STATE_QUEUE_REQUIRED},
		{scheduler.StatePreemptionRisk, runtimev1.SchedulingState_SCHEDULING_STATE_PREEMPTION_RISK},
		{scheduler.StateSlowdownRisk, runtimev1.SchedulingState_SCHEDULING_STATE_SLOWDOWN_RISK},
		{scheduler.StateDenied, runtimev1.SchedulingState_SCHEDULING_STATE_DENIED},
		{scheduler.StateUnknown, runtimev1.SchedulingState_SCHEDULING_STATE_UNKNOWN},
		{"invalid", runtimev1.SchedulingState_SCHEDULING_STATE_UNSPECIFIED},
	}
	for _, tc := range cases {
		got := toProtoSchedulingState(tc.input)
		if got != tc.expected {
			t.Errorf("toProtoSchedulingState(%q) = %s, want %s", tc.input, got, tc.expected)
		}
	}
}
