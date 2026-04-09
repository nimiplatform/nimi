package scheduler

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestSchedulerPerAppConcurrencyIsolation(t *testing.T) {
	s := New(Config{
		GlobalConcurrency:   2,
		PerAppConcurrency:   1,
		StarvationThreshold: 50 * time.Millisecond,
	})

	ctx := context.Background()
	releaseA, _, err := s.Acquire(ctx, "app-a")
	if err != nil {
		t.Fatalf("acquire app-a: %v", err)
	}
	defer releaseA()

	releaseB, _, err := s.Acquire(ctx, "app-b")
	if err != nil {
		t.Fatalf("acquire app-b should not be blocked by app-a per-app limit: %v", err)
	}
	releaseB()
}

func TestSchedulerMarksStarvationWhenWaitExceedsThreshold(t *testing.T) {
	s := New(Config{
		GlobalConcurrency:   1,
		PerAppConcurrency:   1,
		StarvationThreshold: 10 * time.Millisecond,
	})
	ctx := context.Background()

	release, _, err := s.Acquire(ctx, "app-a")
	if err != nil {
		t.Fatalf("first acquire: %v", err)
	}

	resultCh := make(chan AcquireResult, 1)
	errCh := make(chan error, 1)
	go func() {
		releaseBlocked, result, acquireErr := s.Acquire(ctx, "app-b")
		if acquireErr != nil {
			errCh <- acquireErr
			return
		}
		releaseBlocked()
		resultCh <- result
	}()

	time.Sleep(20 * time.Millisecond)
	release()

	select {
	case acquireErr := <-errCh:
		t.Fatalf("blocked acquire failed: %v", acquireErr)
	case result := <-resultCh:
		if !result.Starved {
			t.Fatalf("expected starvation=true when wait exceeds threshold")
		}
		if result.Waited < 10*time.Millisecond {
			t.Fatalf("expected waited >= threshold, got=%s", result.Waited)
		}
	case <-time.After(2 * time.Second):
		t.Fatalf("blocked acquire timeout")
	}
}

func TestSchedulerReleaseIsGoroutineSafe(t *testing.T) {
	s := New(Config{
		GlobalConcurrency: 1,
		PerAppConcurrency: 1,
	})

	release, _, err := s.Acquire(context.Background(), "app-a")
	if err != nil {
		t.Fatalf("acquire: %v", err)
	}

	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			release()
		}()
	}
	wg.Wait()

	releaseAgain, _, err := s.Acquire(context.Background(), "app-a")
	if err != nil {
		t.Fatalf("re-acquire after concurrent release: %v", err)
	}
	releaseAgain()
}

func TestSchedulerRemovesIdlePerAppSemaphore(t *testing.T) {
	s := New(Config{
		GlobalConcurrency: 1,
		PerAppConcurrency: 1,
	})

	release, _, err := s.Acquire(context.Background(), "app-a")
	if err != nil {
		t.Fatalf("acquire: %v", err)
	}
	release()

	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.perApp) != 0 {
		t.Fatalf("expected idle per-app semaphore cleanup, got=%d", len(s.perApp))
	}
}

func TestSchedulerAcquireWrapsContextError(t *testing.T) {
	s := New(Config{
		GlobalConcurrency: 1,
		PerAppConcurrency: 1,
	})

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, _, err := s.Acquire(ctx, "app-a")
	if err == nil {
		t.Fatal("expected wrapped context cancellation")
	}
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context.Canceled, got=%v", err)
	}
	if err.Error() != "scheduler acquire: context canceled" {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestSchedulerSameAppBlocksAtPerAppLimit(t *testing.T) {
	s := New(Config{
		GlobalConcurrency: 2,
		PerAppConcurrency: 1,
	})

	release, _, err := s.Acquire(context.Background(), "app-a")
	if err != nil {
		t.Fatalf("first acquire: %v", err)
	}
	defer release()

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()

	_, _, err = s.Acquire(ctx, "app-a")
	if err == nil {
		t.Fatal("expected same-app acquire to block until context deadline")
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected context deadline exceeded, got=%v", err)
	}
}

func TestSchedulerCancelDuringPerAppWaitReleasesGlobalSlot(t *testing.T) {
	s := New(Config{
		GlobalConcurrency: 2,
		PerAppConcurrency: 1,
	})

	releaseA, _, err := s.Acquire(context.Background(), "app-a")
	if err != nil {
		t.Fatalf("first acquire app-a: %v", err)
	}
	defer releaseA()

	releaseB, _, err := s.Acquire(context.Background(), "app-b")
	if err != nil {
		t.Fatalf("first acquire app-b: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	_, _, err = s.Acquire(ctx, "app-a")
	if err == nil {
		t.Fatal("expected blocked same-app acquire to time out")
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected context deadline exceeded, got=%v", err)
	}

	releaseB()

	releaseC, _, err := s.Acquire(context.Background(), "app-c")
	if err != nil {
		t.Fatalf("global slot should be released after per-app timeout: %v", err)
	}
	releaseC()
}

// ---------------------------------------------------------------------------
// Peek tests (K-SCHED-002)
// ---------------------------------------------------------------------------

func singleTargetPeekInput(appID string, target SchedulingEvaluationTarget) PeekInput {
	return PeekInput{
		AppID:   appID,
		Targets: []SchedulingEvaluationTarget{target},
	}
}

func peekSingleTarget(s *Scheduler, appID string, target SchedulingEvaluationTarget) SchedulingJudgement {
	return s.Peek(context.Background(), singleTargetPeekInput(appID, target)).AggregateJudgement
}

func TestPeekUnknownWhenSlotsAvailablePhase1(t *testing.T) {
	// K-SCHED-005: Phase 1 lacks VRAM/RAM telemetry, so slots-available
	// returns unknown, not runnable. "不允许把 unknown 升级为 runnable".
	s := New(Config{GlobalConcurrency: 2, PerAppConcurrency: 2})
	j := peekSingleTarget(s, "app-a", SchedulingEvaluationTarget{})
	if j.State != StateUnknown {
		t.Fatalf("Phase 1: expected unknown (risk assessment unavailable), got=%s", j.State)
	}
	if j.Occupancy.GlobalUsed != 0 || j.Occupancy.GlobalCap != 2 {
		t.Fatalf("unexpected global occupancy: used=%d cap=%d", j.Occupancy.GlobalUsed, j.Occupancy.GlobalCap)
	}
	if j.Occupancy.AppUsed != 0 || j.Occupancy.AppCap != 2 {
		t.Fatalf("unexpected app occupancy: used=%d cap=%d", j.Occupancy.AppUsed, j.Occupancy.AppCap)
	}
	if len(j.ResourceWarnings) == 0 {
		t.Fatal("expected resource warning about missing telemetry")
	}
}

func TestPeekQueueRequiredWhenGlobalFull(t *testing.T) {
	s := New(Config{GlobalConcurrency: 1, PerAppConcurrency: 2})
	release, _, err := s.Acquire(context.Background(), "app-a")
	if err != nil {
		t.Fatalf("acquire: %v", err)
	}
	defer release()

	j := peekSingleTarget(s, "app-b", SchedulingEvaluationTarget{})
	if j.State != StateQueueRequired {
		t.Fatalf("expected queue_required, got=%s", j.State)
	}
	if j.Occupancy.GlobalUsed != 1 {
		t.Fatalf("expected globalUsed=1, got=%d", j.Occupancy.GlobalUsed)
	}
}

func TestPeekQueueRequiredWhenPerAppFull(t *testing.T) {
	s := New(Config{GlobalConcurrency: 4, PerAppConcurrency: 1})
	release, _, err := s.Acquire(context.Background(), "app-a")
	if err != nil {
		t.Fatalf("acquire: %v", err)
	}
	defer release()

	j := peekSingleTarget(s, "app-a", SchedulingEvaluationTarget{})
	if j.State != StateQueueRequired {
		t.Fatalf("expected queue_required, got=%s", j.State)
	}
	if j.Occupancy.AppUsed != 1 || j.Occupancy.AppCap != 1 {
		t.Fatalf("unexpected app occupancy: used=%d cap=%d", j.Occupancy.AppUsed, j.Occupancy.AppCap)
	}
}

func TestPeekDeniedWhenDenialCheckFires(t *testing.T) {
	s := New(Config{GlobalConcurrency: 4, PerAppConcurrency: 2})
	s.RegisterDenialCheck(func() (bool, string) {
		return true, "no GPU available"
	})

	j := peekSingleTarget(s, "app-a", SchedulingEvaluationTarget{})
	if j.State != StateDenied {
		t.Fatalf("expected denied, got=%s", j.State)
	}
	if !strings.Contains(j.Detail, "no GPU available") {
		t.Fatalf("expected denial detail, got=%q", j.Detail)
	}
}

func TestPeekNotDeniedWhenCheckPasses(t *testing.T) {
	s := New(Config{GlobalConcurrency: 4, PerAppConcurrency: 2})
	s.RegisterDenialCheck(func() (bool, string) {
		return false, ""
	})

	j := peekSingleTarget(s, "app-a", SchedulingEvaluationTarget{})
	// Phase 1: slots available + denial passes -> unknown (not runnable, risk assessment missing)
	if j.State != StateUnknown {
		t.Fatalf("expected unknown (risk assessment unavailable), got=%s", j.State)
	}
}

func TestPeekDoesNotMutateState(t *testing.T) {
	s := New(Config{GlobalConcurrency: 2, PerAppConcurrency: 2})

	// Peek multiple times — Phase 1 returns unknown (not runnable)
	for i := 0; i < 10; i++ {
		j := peekSingleTarget(s, "app-a", SchedulingEvaluationTarget{})
		if j.State != StateUnknown {
			t.Fatalf("peek %d: expected unknown, got=%s", i, j.State)
		}
		if j.Occupancy.GlobalUsed != 0 {
			t.Fatalf("peek %d: peek should not mutate state, globalUsed=%d", i, j.Occupancy.GlobalUsed)
		}
	}

	// Verify we can still acquire all slots
	releases := make([]func(), 0, 2)
	for i := 0; i < 2; i++ {
		release, _, err := s.Acquire(context.Background(), "app-a")
		if err != nil {
			t.Fatalf("acquire %d after peeks: %v", i, err)
		}
		releases = append(releases, release)
	}
	for _, release := range releases {
		release()
	}
}

func TestPeekOccupancyReflectsAcquireRelease(t *testing.T) {
	s := New(Config{GlobalConcurrency: 4, PerAppConcurrency: 2})

	j1 := peekSingleTarget(s, "app-a", SchedulingEvaluationTarget{})
	if j1.Occupancy.GlobalUsed != 0 {
		t.Fatalf("before acquire: expected globalUsed=0, got=%d", j1.Occupancy.GlobalUsed)
	}

	release, _, err := s.Acquire(context.Background(), "app-a")
	if err != nil {
		t.Fatalf("acquire: %v", err)
	}

	j2 := peekSingleTarget(s, "app-a", SchedulingEvaluationTarget{})
	if j2.Occupancy.GlobalUsed != 1 {
		t.Fatalf("after acquire: expected globalUsed=1, got=%d", j2.Occupancy.GlobalUsed)
	}
	if j2.Occupancy.AppUsed != 1 {
		t.Fatalf("after acquire: expected appUsed=1, got=%d", j2.Occupancy.AppUsed)
	}

	release()

	j3 := peekSingleTarget(s, "app-a", SchedulingEvaluationTarget{})
	if j3.Occupancy.GlobalUsed != 0 {
		t.Fatalf("after release: expected globalUsed=0, got=%d", j3.Occupancy.GlobalUsed)
	}
}

func TestAcquireResultIncludesOccupancy(t *testing.T) {
	s := New(Config{GlobalConcurrency: 4, PerAppConcurrency: 2})

	release, result, err := s.Acquire(context.Background(), "app-a")
	if err != nil {
		t.Fatalf("acquire: %v", err)
	}
	defer release()

	if result.Occupancy.GlobalUsed != 1 {
		t.Fatalf("expected globalUsed=1 in acquire result, got=%d", result.Occupancy.GlobalUsed)
	}
	if result.Occupancy.GlobalCap != 4 {
		t.Fatalf("expected globalCap=4 in acquire result, got=%d", result.Occupancy.GlobalCap)
	}
	if result.Occupancy.AppUsed != 1 {
		t.Fatalf("expected appUsed=1 in acquire result, got=%d", result.Occupancy.AppUsed)
	}
}

func TestPeekCapabilityAndResourceHintIgnoredInPhase1(t *testing.T) {
	s := New(Config{GlobalConcurrency: 4, PerAppConcurrency: 2})

	j := peekSingleTarget(s, "app-a", SchedulingEvaluationTarget{
		Capability: "text.generate",
		Hint:       &ResourceHint{EstimatedVramBytes: 8_000_000_000, Engine: "llama"},
	})
	// Without resource assessor: capability and hint don't prevent unknown.
	if j.State != StateUnknown {
		t.Fatalf("expected unknown (no resource assessor), got=%s", j.State)
	}
}

// ---------------------------------------------------------------------------
// Phase 2 risk assessment tests (K-SCHED-005)
// ---------------------------------------------------------------------------

func healthyResourceSnapshot() *ResourceSnapshot {
	return &ResourceSnapshot{
		TotalRAMBytes:      32_000_000_000,
		AvailableRAMBytes:  16_000_000_000,
		TotalVRAMBytes:     8_000_000_000,
		AvailableVRAMBytes: 6_000_000_000,
		DiskFreeBytes:      100_000_000_000,
		GPUAvailable:       true,
		MemoryModel:        "discrete",
	}
}

func defaultRiskThresholds() RiskThresholds {
	return RiskThresholds{
		SlowdownRAMBytes:         2_000_000_000,
		SlowdownVRAMBytes:        1_000_000_000,
		SlowdownDiskBytes:        2_000_000_000,
		PreemptionOccupancyRatio: 0.75,
	}
}

func TestPeekRunnableWhenResourcesHealthy(t *testing.T) {
	s := New(Config{GlobalConcurrency: 4, PerAppConcurrency: 2})
	s.SetResourceAssessor(func() *ResourceSnapshot { return healthyResourceSnapshot() })
	s.SetRiskThresholds(defaultRiskThresholds())

	j := peekSingleTarget(s, "app-a", SchedulingEvaluationTarget{})
	if j.State != StateRunnable {
		t.Fatalf("expected runnable, got=%s detail=%q", j.State, j.Detail)
	}
	if len(j.ResourceWarnings) != 0 {
		t.Fatalf("expected no warnings, got=%v", j.ResourceWarnings)
	}
}

func TestPeekSlowdownRiskLowVRAM(t *testing.T) {
	s := New(Config{GlobalConcurrency: 4, PerAppConcurrency: 2})
	snap := healthyResourceSnapshot()
	snap.AvailableVRAMBytes = 500_000_000 // below 1 GB threshold
	s.SetResourceAssessor(func() *ResourceSnapshot { return snap })
	s.SetRiskThresholds(defaultRiskThresholds())

	j := peekSingleTarget(s, "app-a", SchedulingEvaluationTarget{})
	if j.State != StateSlowdownRisk {
		t.Fatalf("expected slowdown_risk for low VRAM, got=%s", j.State)
	}
	if len(j.ResourceWarnings) == 0 {
		t.Fatal("expected VRAM warning")
	}
}

func TestPeekSlowdownRiskLowRAM(t *testing.T) {
	s := New(Config{GlobalConcurrency: 4, PerAppConcurrency: 2})
	snap := healthyResourceSnapshot()
	snap.AvailableRAMBytes = 1_000_000_000 // below 2 GB threshold
	s.SetResourceAssessor(func() *ResourceSnapshot { return snap })
	s.SetRiskThresholds(defaultRiskThresholds())

	j := peekSingleTarget(s, "app-a", SchedulingEvaluationTarget{})
	if j.State != StateSlowdownRisk {
		t.Fatalf("expected slowdown_risk for low RAM, got=%s", j.State)
	}
	if !strings.Contains(j.Detail, slowdownRiskDetailLowResources) {
		t.Fatalf("expected baseline slowdown detail, got=%q", j.Detail)
	}
}

func TestPeekSlowdownRiskLowDisk(t *testing.T) {
	s := New(Config{GlobalConcurrency: 4, PerAppConcurrency: 2})
	snap := healthyResourceSnapshot()
	snap.DiskFreeBytes = 1_000_000_000 // below 2 GB threshold
	s.SetResourceAssessor(func() *ResourceSnapshot { return snap })
	s.SetRiskThresholds(defaultRiskThresholds())

	j := peekSingleTarget(s, "app-a", SchedulingEvaluationTarget{})
	if j.State != StateSlowdownRisk {
		t.Fatalf("expected slowdown_risk for low disk, got=%s", j.State)
	}
}

func TestPeekSlowdownRiskMarksBusyDeviceWhenExecutionsRunning(t *testing.T) {
	s := New(Config{GlobalConcurrency: 4, PerAppConcurrency: 4})
	snap := healthyResourceSnapshot()
	snap.AvailableRAMBytes = 1_000_000_000 // below 2 GB threshold
	s.SetResourceAssessor(func() *ResourceSnapshot { return snap })
	s.SetRiskThresholds(RiskThresholds{
		SlowdownRAMBytes:         2_000_000_000,
		SlowdownVRAMBytes:        1,
		SlowdownDiskBytes:        1,
		PreemptionOccupancyRatio: 0.99,
	})

	release, _, err := s.Acquire(context.Background(), "app-a")
	if err != nil {
		t.Fatalf("acquire running execution: %v", err)
	}
	defer release()

	j := peekSingleTarget(s, "app-b", SchedulingEvaluationTarget{})
	if j.State != StateSlowdownRisk {
		t.Fatalf("expected slowdown_risk for busy low-resource device, got=%s", j.State)
	}
	if !strings.Contains(j.Detail, slowdownRiskDetailBusyDevice) {
		t.Fatalf("expected busy slowdown detail, got=%q", j.Detail)
	}
	if len(j.ResourceWarnings) == 0 || j.ResourceWarnings[0] != slowdownRiskBusyWarning {
		t.Fatalf("expected busy warning first, got=%v", j.ResourceWarnings)
	}
}

func TestPeekPreemptionRiskHighOccupancy(t *testing.T) {
	s := New(Config{GlobalConcurrency: 4, PerAppConcurrency: 4})
	s.SetResourceAssessor(func() *ResourceSnapshot { return healthyResourceSnapshot() })
	s.SetRiskThresholds(defaultRiskThresholds())

	// Fill 3 of 4 slots → 75% occupancy = at threshold
	var releases []func()
	for i := 0; i < 3; i++ {
		release, _, err := s.Acquire(context.Background(), fmt.Sprintf("app-%d", i))
		if err != nil {
			t.Fatalf("acquire %d: %v", i, err)
		}
		releases = append(releases, release)
	}
	defer func() {
		for _, r := range releases {
			r()
		}
	}()

	j := peekSingleTarget(s, "app-new", SchedulingEvaluationTarget{})
	if j.State != StatePreemptionRisk {
		t.Fatalf("expected preemption_risk at 75%% occupancy, got=%s", j.State)
	}
}

func TestPeekNoPreemptionRiskWithZeroOccupancy(t *testing.T) {
	// K-SCHED-005: preemption_risk requires existing running work to degrade.
	// With 0 running tasks, even a heavy ResourceHint must not trigger preemption_risk.
	s := New(Config{GlobalConcurrency: 4, PerAppConcurrency: 4})
	s.SetResourceAssessor(func() *ResourceSnapshot { return healthyResourceSnapshot() })
	s.SetRiskThresholds(RiskThresholds{
		SlowdownRAMBytes:         1,
		SlowdownVRAMBytes:        1,
		SlowdownDiskBytes:        1,
		PreemptionOccupancyRatio: 0.01, // extremely low threshold
	})

	j := peekSingleTarget(s, "app-new", SchedulingEvaluationTarget{
		Hint: &ResourceHint{EstimatedVramBytes: 8_000_000_000},
	})
	if j.State == StatePreemptionRisk {
		t.Fatal("preemption_risk must not trigger with zero running tasks")
	}
	if j.State != StateRunnable {
		t.Fatalf("expected runnable with zero occupancy, got=%s", j.State)
	}
}

func TestPeekDenialTakesPrecedenceOverRisk(t *testing.T) {
	s := New(Config{GlobalConcurrency: 4, PerAppConcurrency: 2})
	snap := healthyResourceSnapshot()
	snap.AvailableVRAMBytes = 100 // would trigger slowdown_risk
	s.SetResourceAssessor(func() *ResourceSnapshot { return snap })
	s.SetRiskThresholds(defaultRiskThresholds())
	s.RegisterDenialCheck(func() (bool, string) {
		return true, "no GPU"
	})

	j := peekSingleTarget(s, "app-a", SchedulingEvaluationTarget{})
	if j.State != StateDenied {
		t.Fatalf("denial should take precedence, got=%s", j.State)
	}
}

func TestPeekPreemptionTakesPrecedenceOverSlowdown(t *testing.T) {
	s := New(Config{GlobalConcurrency: 4, PerAppConcurrency: 4})
	snap := healthyResourceSnapshot()
	snap.AvailableRAMBytes = 500_000_000 // would trigger slowdown_risk
	s.SetResourceAssessor(func() *ResourceSnapshot { return snap })
	s.SetRiskThresholds(defaultRiskThresholds())

	// Fill 3 of 4 slots → preemption_risk
	var releases []func()
	for i := 0; i < 3; i++ {
		release, _, err := s.Acquire(context.Background(), fmt.Sprintf("app-%d", i))
		if err != nil {
			t.Fatalf("acquire %d: %v", i, err)
		}
		releases = append(releases, release)
	}
	defer func() {
		for _, r := range releases {
			r()
		}
	}()

	j := peekSingleTarget(s, "app-new", SchedulingEvaluationTarget{})
	// preemption_risk is checked before slowdown_risk
	if j.State != StatePreemptionRisk {
		t.Fatalf("preemption_risk should take precedence over slowdown_risk, got=%s", j.State)
	}
}

func TestPeekUnknownWhenAssessorReturnsNil(t *testing.T) {
	s := New(Config{GlobalConcurrency: 4, PerAppConcurrency: 2})
	s.SetResourceAssessor(func() *ResourceSnapshot { return nil })
	s.SetRiskThresholds(defaultRiskThresholds())

	j := peekSingleTarget(s, "app-a", SchedulingEvaluationTarget{})
	if j.State != StateUnknown {
		t.Fatalf("expected unknown when assessor returns nil, got=%s", j.State)
	}
}

func TestPeekConfigDrivenThresholds(t *testing.T) {
	s := New(Config{GlobalConcurrency: 4, PerAppConcurrency: 2})
	snap := healthyResourceSnapshot()
	snap.AvailableVRAMBytes = 3_000_000_000 // above default 1 GB threshold
	s.SetResourceAssessor(func() *ResourceSnapshot { return snap })

	// Set a very high VRAM threshold that triggers slowdown
	s.SetRiskThresholds(RiskThresholds{
		SlowdownVRAMBytes:        4_000_000_000, // 4 GB — snap has 3 GB
		SlowdownRAMBytes:         1,             // minimal
		SlowdownDiskBytes:        1,             // minimal
		PreemptionOccupancyRatio: 0.99,          // very high — won't trigger
	})

	j := peekSingleTarget(s, "app-a", SchedulingEvaluationTarget{})
	if j.State != StateSlowdownRisk {
		t.Fatalf("expected slowdown_risk with custom threshold, got=%s", j.State)
	}

	// Lower threshold: now it's healthy
	s.SetRiskThresholds(RiskThresholds{
		SlowdownVRAMBytes:        2_000_000_000, // 2 GB — snap has 3 GB, OK
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
	s.SetDependencyFeasibilityChecker(func(modID, profileID, capability string) (bool, string) {
		if modID == "core:runtime" && profileID == "image-gpu-profile" {
			return false, "GPU required but not available for engine cuda"
		}
		return true, ""
	})

	j := peekSingleTarget(s, "app-a", SchedulingEvaluationTarget{
		ModID:     "core:runtime",
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
	s.SetDependencyFeasibilityChecker(func(modID, profileID, capability string) (bool, string) {
		t.Fatal("checker should not be called without profileID")
		return true, ""
	})

	j := peekSingleTarget(s, "app-a", SchedulingEvaluationTarget{
		ModID: "core:runtime",
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
		ModID:     "core:runtime",
		ProfileID: "some-profile",
	})
	// Without checker, profile identity is ignored — should not deny
	if j.State == StateDenied {
		t.Fatal("should not deny without a dependency checker")
	}
}

func TestPeekDependencyDenialFeasibleContinuesToRiskAssessment(t *testing.T) {
	s := New(Config{GlobalConcurrency: 4, PerAppConcurrency: 2})
	s.SetResourceAssessor(func() *ResourceSnapshot { return healthyResourceSnapshot() })
	s.SetRiskThresholds(defaultRiskThresholds())
	s.SetDependencyFeasibilityChecker(func(modID, profileID, capability string) (bool, string) {
		return true, "" // feasible — continue to risk assessment
	})

	j := peekSingleTarget(s, "app-a", SchedulingEvaluationTarget{
		ModID:     "core:runtime",
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
	s.SetDependencyFeasibilityChecker(func(modID, profileID, capability string) (bool, string) {
		t.Fatal("dependency checker should not run when static denial fires first")
		return true, ""
	})

	j := peekSingleTarget(s, "app-a", SchedulingEvaluationTarget{
		ModID:     "core:runtime",
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
	s.SetDependencyFeasibilityChecker(func(modID, profileID, capability string) (bool, string) {
		if profileID == "blocked-profile" {
			return false, "dependency missing"
		}
		return true, ""
	})

	result := s.Peek(context.Background(), PeekInput{
		AppID: "app-a",
		Targets: []SchedulingEvaluationTarget{
			{Capability: "text.generate", ModID: "core:runtime", ProfileID: "ok-profile"},
			{Capability: "image.generate", ModID: "core:runtime", ProfileID: "blocked-profile"},
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
	s.SetDependencyFeasibilityChecker(func(modID, profileID, capability string) (bool, string) {
		return profileID != "bad-profile", "dependency unavailable"
	})

	result := s.Peek(context.Background(), PeekInput{
		AppID: "app-a",
		Targets: []SchedulingEvaluationTarget{
			{Capability: "text.generate", ModID: "core:runtime", ProfileID: "bad-profile"},
			{Capability: "video.generate", ModID: "core:runtime", ProfileID: "good-profile"},
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
