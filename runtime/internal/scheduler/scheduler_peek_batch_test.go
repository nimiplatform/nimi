package scheduler

import (
	"context"
	"strings"
	"testing"
)

func TestPeekConfigDrivenThresholds(t *testing.T) {
	s := New(Config{GlobalConcurrency: 4, PerAppConcurrency: 2})
	snap := healthyResourceSnapshot()
	snap.AvailableVRAMBytes = 3_000_000_000 // above default 1 GB threshold
	s.SetResourceAssessor(func() *ResourceSnapshot { return snap })

	// Set a very high VRAM threshold that triggers slowdown
	s.SetRiskThresholds(RiskThresholds{
		SlowdownVRAMBytes:        4_000_000_000, // 4 GB 鈥?snap has 3 GB
		SlowdownRAMBytes:         1,             // minimal
		SlowdownDiskBytes:        1,             // minimal
		PreemptionOccupancyRatio: 0.99,          // very high 鈥?won't trigger
	})

	j := peekSingleTarget(s, "app-a", SchedulingEvaluationTarget{})
	if j.State != StateSlowdownRisk {
		t.Fatalf("expected slowdown_risk with custom threshold, got=%s", j.State)
	}

	// Lower threshold: now it's healthy
	s.SetRiskThresholds(RiskThresholds{
		SlowdownVRAMBytes:        2_000_000_000, // 2 GB 鈥?snap has 3 GB, OK
		SlowdownRAMBytes:         1,
		SlowdownDiskBytes:        1,
		PreemptionOccupancyRatio: 0.99,
	})
	j = peekSingleTarget(s, "app-a", SchedulingEvaluationTarget{})
	if j.State != StateRunnable {
		t.Fatalf("expected runnable with lower threshold, got=%s", j.State)
	}
}

func TestPeekSkipsVRAMCheckWhenProbeUnavailable(t *testing.T) {
	s := New(Config{GlobalConcurrency: 4, PerAppConcurrency: 2})
	snap := healthyResourceSnapshot()
	snap.AvailableVRAMBytes = 0 // probe unavailable (zero means no data, not "0 bytes")
	snap.TotalVRAMBytes = 0
	s.SetResourceAssessor(func() *ResourceSnapshot { return snap })
	s.SetRiskThresholds(defaultRiskThresholds())

	j := peekSingleTarget(s, "app-a", SchedulingEvaluationTarget{})
	// VRAM=0 means probe unavailable, should not trigger slowdown. RAM and disk are healthy.
	if j.State != StateRunnable {
		t.Fatalf("expected runnable when VRAM probe unavailable, got=%s detail=%q warnings=%v",
			j.State, j.Detail, j.ResourceWarnings)
	}
}

// ---------------------------------------------------------------------------
// Dependency feasibility denial tests (K-SCHED-004)
// ---------------------------------------------------------------------------

func TestPeekDependencyDenialFires(t *testing.T) {
	s := New(Config{GlobalConcurrency: 4, PerAppConcurrency: 2})
	s.SetResourceAssessor(func() *ResourceSnapshot { return healthyResourceSnapshot() })
	s.SetRiskThresholds(defaultRiskThresholds())
	s.SetDependencyFeasibilityChecker(func(targetID, profileID, capability string) (bool, string) {
		if targetID == "core:runtime" && profileID == "image-gpu-profile" {
			return false, "GPU required but not available for engine cuda"
		}
		return true, ""
	})

	j := peekSingleTarget(s, "app-a", SchedulingEvaluationTarget{
		TargetID:     "core:runtime",
		ProfileID: "image-gpu-profile",
	})
	if j.State != StateDenied {
		t.Fatalf("expected denied for infeasible dependency, got=%s", j.State)
	}
	if j.Detail == "" {
		t.Fatal("expected detail on dependency denial")
	}
}

func TestPeekDependencyDenialSkippedWithoutProfileID(t *testing.T) {
	s := New(Config{GlobalConcurrency: 4, PerAppConcurrency: 2})
	s.SetResourceAssessor(func() *ResourceSnapshot { return healthyResourceSnapshot() })
	s.SetRiskThresholds(defaultRiskThresholds())
	s.SetDependencyFeasibilityChecker(func(targetID, profileID, capability string) (bool, string) {
		t.Fatal("checker should not be called without profileID")
		return true, ""
	})

	j := peekSingleTarget(s, "app-a", SchedulingEvaluationTarget{
		TargetID: "core:runtime",
	})
	if j.State == StateDenied {
		t.Fatal("should not deny without profileID")
	}
}

func TestPeekDependencyDenialSkippedWithoutChecker(t *testing.T) {
	s := New(Config{GlobalConcurrency: 4, PerAppConcurrency: 2})
	s.SetResourceAssessor(func() *ResourceSnapshot { return healthyResourceSnapshot() })
	s.SetRiskThresholds(defaultRiskThresholds())
	// No dependency checker set

	j := peekSingleTarget(s, "app-a", SchedulingEvaluationTarget{
		TargetID:     "core:runtime",
		ProfileID: "some-profile",
	})
	// Without checker, profile identity is ignored 鈥?should not deny
	if j.State == StateDenied {
		t.Fatal("should not deny without a dependency checker")
	}
}

func TestPeekDependencyDenialFeasibleContinuesToRiskAssessment(t *testing.T) {
	s := New(Config{GlobalConcurrency: 4, PerAppConcurrency: 2})
	s.SetResourceAssessor(func() *ResourceSnapshot { return healthyResourceSnapshot() })
	s.SetRiskThresholds(defaultRiskThresholds())
	s.SetDependencyFeasibilityChecker(func(targetID, profileID, capability string) (bool, string) {
		return true, "" // feasible 鈥?continue to risk assessment
	})

	j := peekSingleTarget(s, "app-a", SchedulingEvaluationTarget{
		TargetID:     "core:runtime",
		ProfileID: "ok-profile",
	})
	if j.State != StateRunnable {
		t.Fatalf("feasible dependency should proceed to runnable, got=%s", j.State)
	}
}

func TestPeekStaticDenialTakesPrecedenceOverDependencyDenial(t *testing.T) {
	s := New(Config{GlobalConcurrency: 4, PerAppConcurrency: 2})
	s.SetResourceAssessor(func() *ResourceSnapshot { return healthyResourceSnapshot() })
	s.SetRiskThresholds(defaultRiskThresholds())
	s.RegisterDenialCheck(func() (bool, string) {
		return true, "static denial: no GPU"
	})
	s.SetDependencyFeasibilityChecker(func(targetID, profileID, capability string) (bool, string) {
		t.Fatal("dependency checker should not run when static denial fires first")
		return true, ""
	})

	j := peekSingleTarget(s, "app-a", SchedulingEvaluationTarget{
		TargetID:     "core:runtime",
		ProfileID: "some-profile",
	})
	if j.State != StateDenied {
		t.Fatalf("expected static denial, got=%s", j.State)
	}
	if !strings.Contains(j.Detail, "static denial: no GPU") {
		t.Fatalf("expected static denial detail, got=%q", j.Detail)
	}
}

func TestPeekBatchAggregatePrecedenceAndTargetFold(t *testing.T) {
	s := New(Config{GlobalConcurrency: 4, PerAppConcurrency: 2})
	s.SetResourceAssessor(func() *ResourceSnapshot { return healthyResourceSnapshot() })
	s.SetRiskThresholds(defaultRiskThresholds())
	s.SetDependencyFeasibilityChecker(func(targetID, profileID, capability string) (bool, string) {
		if profileID == "blocked-profile" {
			return false, "dependency missing"
		}
		return true, ""
	})

	result := s.Peek(context.Background(), PeekInput{
		AppID: "app-a",
		Targets: []SchedulingEvaluationTarget{
			{Capability: "text.generate", TargetID: "core:runtime", ProfileID: "ok-profile"},
			{Capability: "image.generate", TargetID: "core:runtime", ProfileID: "blocked-profile"},
		},
	})

	if result.AggregateJudgement.State != StateDenied {
		t.Fatalf("expected aggregate denied, got=%s", result.AggregateJudgement.State)
	}
	if len(result.TargetJudgements) != 2 {
		t.Fatalf("expected two target judgements, got=%d", len(result.TargetJudgements))
	}
	states := map[string]SchedulingState{}
	for _, judgement := range result.TargetJudgements {
		states[judgement.Target.Capability] = judgement.Judgement.State
	}
	if states["text.generate"] != StateRunnable {
		t.Fatalf("expected text.generate runnable, got=%s", states["text.generate"])
	}
	if states["image.generate"] != StateDenied {
		t.Fatalf("expected image.generate denied, got=%s", states["image.generate"])
	}
	if !strings.Contains(result.AggregateJudgement.Detail, "image.generate") {
		t.Fatalf("expected aggregate detail to mention denied target, got=%q", result.AggregateJudgement.Detail)
	}
}

func TestPeekBatchUnknownParticipation(t *testing.T) {
	s := New(Config{GlobalConcurrency: 4, PerAppConcurrency: 2})

	result := s.Peek(context.Background(), PeekInput{
		AppID: "app-a",
		Targets: []SchedulingEvaluationTarget{
			{Capability: "text.generate"},
			{Capability: "image.generate"},
		},
	})

	if result.AggregateJudgement.State != StateUnknown {
		t.Fatalf("expected aggregate unknown, got=%s", result.AggregateJudgement.State)
	}
	if len(result.TargetJudgements) != 2 {
		t.Fatalf("expected two target judgements, got=%d", len(result.TargetJudgements))
	}
	for _, judgement := range result.TargetJudgements {
		if judgement.Judgement.State != StateUnknown {
			t.Fatalf("expected target unknown, got=%s", judgement.Judgement.State)
		}
	}
}

func TestPeekBatchDeniedDoesNotPolluteOtherTargets(t *testing.T) {
	s := New(Config{GlobalConcurrency: 4, PerAppConcurrency: 2})
	s.SetResourceAssessor(func() *ResourceSnapshot { return healthyResourceSnapshot() })
	s.SetRiskThresholds(defaultRiskThresholds())
	s.SetDependencyFeasibilityChecker(func(targetID, profileID, capability string) (bool, string) {
		return profileID != "bad-profile", "dependency unavailable"
	})

	result := s.Peek(context.Background(), PeekInput{
		AppID: "app-a",
		Targets: []SchedulingEvaluationTarget{
			{Capability: "text.generate", TargetID: "core:runtime", ProfileID: "bad-profile"},
			{Capability: "video.generate", TargetID: "core:runtime", ProfileID: "good-profile"},
		},
	})

	var deniedCount int
	for _, judgement := range result.TargetJudgements {
		if judgement.Judgement.State == StateDenied {
			deniedCount++
		}
	}
	if deniedCount != 1 {
		t.Fatalf("expected exactly one denied target, got=%d", deniedCount)
	}
	if result.AggregateJudgement.State != StateDenied {
		t.Fatalf("expected aggregate denied, got=%s", result.AggregateJudgement.State)
	}
}

func TestPeekBatchSharesOccupancyAcrossAggregateAndTargets(t *testing.T) {
	s := New(Config{GlobalConcurrency: 4, PerAppConcurrency: 2})
	s.SetResourceAssessor(func() *ResourceSnapshot { return healthyResourceSnapshot() })
	s.SetRiskThresholds(defaultRiskThresholds())

	release, _, err := s.Acquire(context.Background(), "app-a")
	if err != nil {
		t.Fatalf("acquire: %v", err)
	}
	defer release()

	result := s.Peek(context.Background(), PeekInput{
		AppID: "app-a",
		Targets: []SchedulingEvaluationTarget{
			{Capability: "text.generate"},
			{Capability: "image.generate"},
		},
	})

	if result.Occupancy.GlobalUsed != result.AggregateJudgement.Occupancy.GlobalUsed {
		t.Fatalf("expected shared aggregate occupancy, got batch=%+v aggregate=%+v", result.Occupancy, result.AggregateJudgement.Occupancy)
	}
	for _, judgement := range result.TargetJudgements {
		if judgement.Judgement.Occupancy != result.Occupancy {
			t.Fatalf("expected shared target occupancy, got target=%+v batch=%+v", judgement.Judgement.Occupancy, result.Occupancy)
		}
	}
}
