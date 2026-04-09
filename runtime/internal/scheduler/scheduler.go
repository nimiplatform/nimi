package scheduler

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const (
	DefaultGlobalConcurrency = 8
	DefaultPerAppConcurrency = 2
)

// SchedulingState is the K-SCHED-001 six-value enum.
type SchedulingState string

const (
	StateRunnable       SchedulingState = "runnable"
	StateQueueRequired  SchedulingState = "queue_required"
	StatePreemptionRisk SchedulingState = "preemption_risk"
	StateSlowdownRisk   SchedulingState = "slowdown_risk"
	StateDenied         SchedulingState = "denied"
	StateUnknown        SchedulingState = "unknown"
)

// OccupancySnapshot is K-SCHED-003 occupancy telemetry.
type OccupancySnapshot struct {
	GlobalUsed int
	GlobalCap  int
	AppUsed    int
	AppCap     int
}

// SchedulingJudgement is the K-SCHED-002 Peek result.
type SchedulingJudgement struct {
	State            SchedulingState
	Detail           string
	Occupancy        OccupancySnapshot
	ResourceWarnings []string
}

// SchedulingEvaluationTarget is the K-SCHED-002 atomic scheduling input.
type SchedulingEvaluationTarget struct {
	Capability string
	ModID      string
	ProfileID  string
	Hint       *ResourceHint
}

// TargetSchedulingJudgement pairs an atomic target with its judgement.
type TargetSchedulingJudgement struct {
	Target    SchedulingEvaluationTarget
	Judgement SchedulingJudgement
}

// BatchSchedulingJudgement is the K-SCHED-002 batch Peek result.
type BatchSchedulingJudgement struct {
	AggregateJudgement SchedulingJudgement
	Occupancy          OccupancySnapshot
	TargetJudgements   []TargetSchedulingJudgement
}

// DenialCheck is a caller-provided function that evaluates static denial
// rules (K-SCHED-004). It returns (denied bool, detail string).
// The scheduler does not import device profile or config packages directly;
// denial logic is injected by the caller.
type DenialCheck func() (denied bool, detail string)

// Config defines runtime queue limits.
type Config struct {
	GlobalConcurrency int
	PerAppConcurrency int
	// Zero disables starvation reporting.
	StarvationThreshold time.Duration
}

// AcquireResult reports scheduling wait details.
type AcquireResult struct {
	Waited    time.Duration
	Starved   bool
	Occupancy OccupancySnapshot
}

// ResourceSnapshot contains device resource state for risk assessment (K-SCHED-005).
type ResourceSnapshot struct {
	TotalRAMBytes      int64
	AvailableRAMBytes  int64
	TotalVRAMBytes     int64
	AvailableVRAMBytes int64
	DiskFreeBytes      int64
	GPUAvailable       bool
	MemoryModel        string // "discrete" | "unified" | "unknown"
}

// RiskThresholds contains configurable thresholds for risk assessment (K-SCHED-005).
type RiskThresholds struct {
	SlowdownRAMBytes         int64   // available RAM below this → slowdown_risk
	SlowdownVRAMBytes        int64   // available VRAM below this → slowdown_risk
	SlowdownDiskBytes        int64   // disk free below this → slowdown_risk
	PreemptionOccupancyRatio float64 // globalUsed/globalCap above this → preemption_risk
}

// ResourceAssessor is called during Peek to get current device resources.
// Injected by caller (daemon bootstrap). Returns nil if unavailable.
type ResourceAssessor func() *ResourceSnapshot

// DependencyFeasibilityChecker evaluates whether a profile's required
// dependencies are satisfiable on the current device (K-SCHED-004).
// The checker receives identity references only (modID + profileID + capability)
// and resolves the profile from the runtime-side profile registry.
// Returns (feasible, detail). Injected by caller (daemon bootstrap).
type DependencyFeasibilityChecker func(modID string, profileID string, capability string) (feasible bool, detail string)

// Scheduler enforces global and per-app concurrency limits.
// Phase 2: adds resource-aware risk assessment via ResourceAssessor.
type Scheduler struct {
	global    chan struct{}
	globalCap int

	mu                  sync.Mutex
	perApp              map[string]*appSemaphore
	perSize             int
	starvationThreshold time.Duration

	// Atomic occupancy counters (K-SCHED-003).
	globalUsed atomic.Int32

	// K-SCHED-005: resource assessor for risk states. When nil, Peek
	// returns unknown for slot-available scenarios.
	resourceAssessor ResourceAssessor
	riskThresholds   RiskThresholds

	// Denial checks (K-SCHED-004). Evaluated on every Peek call.
	denialChecks []DenialCheck

	// K-SCHED-004: dependency feasibility checker for profile dependency denial.
	dependencyChecker DependencyFeasibilityChecker
}

type appSemaphore struct {
	sem  chan struct{}
	refs int
}

const (
	slowdownRiskDetailLowResources = "device resources are low; execution may be slow"
	slowdownRiskDetailBusyDevice   = "active local executions are consuming device resources; execution may be slow"
	slowdownRiskBusyWarning        = "active local executions currently occupy scheduler slots"
)

func New(cfg Config) *Scheduler {
	global := cfg.GlobalConcurrency
	if global <= 0 {
		global = DefaultGlobalConcurrency
	}
	perApp := cfg.PerAppConcurrency
	if perApp <= 0 {
		perApp = DefaultPerAppConcurrency
	}
	return &Scheduler{
		global:              make(chan struct{}, global),
		globalCap:           global,
		perApp:              make(map[string]*appSemaphore),
		perSize:             perApp,
		starvationThreshold: cfg.StarvationThreshold,
	}
}

// RegisterDenialCheck adds a static denial check evaluated on every Peek.
// Must be called before any Peek calls (typically at startup).
func (s *Scheduler) RegisterDenialCheck(check DenialCheck) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.denialChecks = append(s.denialChecks, check)
}

// SetResourceAssessor injects the resource snapshot provider for Phase 2+
// risk assessment. Must be called at daemon bootstrap.
func (s *Scheduler) SetResourceAssessor(assessor ResourceAssessor) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.resourceAssessor = assessor
}

// SetRiskThresholds sets configurable thresholds for risk state evaluation.
func (s *Scheduler) SetRiskThresholds(thresholds RiskThresholds) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.riskThresholds = thresholds
}

// SetDependencyFeasibilityChecker injects the dependency feasibility checker
// for K-SCHED-004 profile dependency denial. Must be called at daemon bootstrap.
func (s *Scheduler) SetDependencyFeasibilityChecker(checker DependencyFeasibilityChecker) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.dependencyChecker = checker
}

func normalizeAppID(appID string) string {
	appID = strings.TrimSpace(appID)
	if appID == "" {
		appID = "_default"
	}
	return appID
}

func (s *Scheduler) perAppSemaphore(appID string) (string, *appSemaphore) {
	appID = normalizeAppID(appID)
	s.mu.Lock()
	defer s.mu.Unlock()
	sem, ok := s.perApp[appID]
	if ok {
		sem.refs++
		return appID, sem
	}
	sem = &appSemaphore{
		sem:  make(chan struct{}, s.perSize),
		refs: 1,
	}
	s.perApp[appID] = sem
	return appID, sem
}

func (s *Scheduler) releaseAppReference(appID string, sem *appSemaphore) {
	if sem == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	current, ok := s.perApp[appID]
	if !ok || current != sem {
		return
	}
	if current.refs > 0 {
		current.refs--
	}
	if current.refs == 0 && len(current.sem) == 0 {
		delete(s.perApp, appID)
	}
}

// appOccupancy returns the current slot usage for a given appID.
// Must be called under s.mu or with a known-existing semaphore.
func (s *Scheduler) appOccupancy(appID string) int {
	appID = normalizeAppID(appID)
	s.mu.Lock()
	defer s.mu.Unlock()
	sem, ok := s.perApp[appID]
	if !ok {
		return 0
	}
	return len(sem.sem)
}

// occupancySnapshot builds a K-SCHED-003 snapshot for the given appID.
func (s *Scheduler) occupancySnapshot(appID string) OccupancySnapshot {
	return OccupancySnapshot{
		GlobalUsed: int(s.globalUsed.Load()),
		GlobalCap:  s.globalCap,
		AppUsed:    s.appOccupancy(appID),
		AppCap:     s.perSize,
	}
}

// PeekInput contains all optional context for a Peek call.
type PeekInput struct {
	AppID   string
	Targets []SchedulingEvaluationTarget
}

// Peek performs a non-blocking scheduling preflight assessment (K-SCHED-002).
// It does not acquire or release any slots.
func (s *Scheduler) Peek(_ context.Context, input PeekInput) BatchSchedulingJudgement {
	appID := normalizeAppID(input.AppID)

	// K-SCHED-004: evaluate denial checks first.
	s.mu.Lock()
	checks := append([]DenialCheck(nil), s.denialChecks...)
	assessor := s.resourceAssessor
	thresholds := s.riskThresholds
	depChecker := s.dependencyChecker
	s.mu.Unlock()

	occupancy := s.occupancySnapshot(appID)
	targets := normalizeSchedulingTargets(input.Targets)
	if len(targets) == 0 {
		aggregate := SchedulingJudgement{
			State:            StateUnknown,
			Detail:           "no scheduling targets provided",
			Occupancy:        occupancy,
			ResourceWarnings: []string{"no scheduling targets provided"},
		}
		return BatchSchedulingJudgement{
			AggregateJudgement: aggregate,
			Occupancy:          occupancy,
			TargetJudgements:   nil,
		}
	}

	var snapshot *ResourceSnapshot
	if assessor != nil {
		snapshot = assessor()
	}

	targetJudgements := make([]TargetSchedulingJudgement, 0, len(targets))
	for _, target := range targets {
		targetJudgements = append(targetJudgements, TargetSchedulingJudgement{
			Target: target,
			Judgement: s.peekTarget(
				target,
				occupancy,
				checks,
				depChecker,
				snapshot,
				assessor != nil,
				thresholds,
			),
		})
	}

	aggregate := foldSchedulingJudgements(targetJudgements, occupancy)
	return BatchSchedulingJudgement{
		AggregateJudgement: aggregate,
		Occupancy:          occupancy,
		TargetJudgements:   targetJudgements,
	}
}

// K-SCHED-001: queue_required if no global or per-app slots available.
func (s *Scheduler) peekTarget(
	target SchedulingEvaluationTarget,
	occupancy OccupancySnapshot,
	checks []DenialCheck,
	depChecker DependencyFeasibilityChecker,
	snapshot *ResourceSnapshot,
	hasAssessor bool,
	thresholds RiskThresholds,
) SchedulingJudgement {
	for _, check := range checks {
		if denied, detail := check(); denied {
			return SchedulingJudgement{
				State:            StateDenied,
				Detail:           detail,
				Occupancy:        occupancy,
				ResourceWarnings: nil,
			}
		}
	}

	// K-SCHED-004: dependency feasibility denial.
	// Only evaluated when profile identity (modID + profileID) is provided AND a checker is available.
	if strings.TrimSpace(target.ProfileID) != "" && depChecker != nil {
		feasible, detail := depChecker(target.ModID, target.ProfileID, target.Capability)
		if !feasible {
			return SchedulingJudgement{
				State:            StateDenied,
				Detail:           detail,
				Occupancy:        occupancy,
				ResourceWarnings: nil,
			}
		}
	}

	if occupancy.GlobalUsed >= occupancy.GlobalCap || occupancy.AppUsed >= occupancy.AppCap {
		return SchedulingJudgement{
			State:            StateQueueRequired,
			Detail:           "no available slots",
			Occupancy:        occupancy,
			ResourceWarnings: nil,
		}
	}

	// K-SCHED-005: resource-aware risk assessment.
	// Without a resource assessor, we cannot evaluate risk states.
	if !hasAssessor {
		return SchedulingJudgement{
			State:            StateUnknown,
			Detail:           "slots available but resource assessor not configured",
			Occupancy:        occupancy,
			ResourceWarnings: []string{"resource assessor not available"},
		}
	}

	if snapshot == nil {
		return SchedulingJudgement{
			State:            StateUnknown,
			Detail:           "slots available but resource snapshot unavailable",
			Occupancy:        occupancy,
			ResourceWarnings: []string{"resource snapshot collection failed"},
		}
	}

	// K-SCHED-005 preemption_risk: high occupancy ratio.
	// Preemption risk means existing running tasks may be degraded by adding
	// a new execution. This only applies when there IS running work to degrade.
	if occupancy.GlobalUsed > 0 && thresholds.PreemptionOccupancyRatio > 0 && occupancy.GlobalCap > 0 {
		ratio := float64(occupancy.GlobalUsed) / float64(occupancy.GlobalCap)
		if ratio >= thresholds.PreemptionOccupancyRatio {
			warnings := []string{fmt.Sprintf("occupancy ratio %.0f%% exceeds threshold %.0f%%",
				ratio*100, thresholds.PreemptionOccupancyRatio*100)}
			return SchedulingJudgement{
				State:            StatePreemptionRisk,
				Detail:           "running tasks may be degraded by new execution",
				Occupancy:        occupancy,
				ResourceWarnings: warnings,
			}
		}
	}

	// K-SCHED-005 slowdown_risk: low available resources.
	var slowdownWarnings []string

	if snapshot.AvailableVRAMBytes > 0 && thresholds.SlowdownVRAMBytes > 0 {
		if snapshot.AvailableVRAMBytes < thresholds.SlowdownVRAMBytes {
			slowdownWarnings = append(slowdownWarnings,
				fmt.Sprintf("available VRAM %d bytes below threshold %d bytes",
					snapshot.AvailableVRAMBytes, thresholds.SlowdownVRAMBytes))
		}
	}

	if snapshot.AvailableRAMBytes > 0 && thresholds.SlowdownRAMBytes > 0 {
		if snapshot.AvailableRAMBytes < thresholds.SlowdownRAMBytes {
			slowdownWarnings = append(slowdownWarnings,
				fmt.Sprintf("available RAM %d bytes below threshold %d bytes",
					snapshot.AvailableRAMBytes, thresholds.SlowdownRAMBytes))
		}
	}

	if snapshot.DiskFreeBytes > 0 && thresholds.SlowdownDiskBytes > 0 {
		if snapshot.DiskFreeBytes < thresholds.SlowdownDiskBytes {
			slowdownWarnings = append(slowdownWarnings,
				fmt.Sprintf("disk free %d bytes below threshold %d bytes",
					snapshot.DiskFreeBytes, thresholds.SlowdownDiskBytes))
		}
	}

	if len(slowdownWarnings) > 0 {
		detail := slowdownRiskDetailLowResources
		if occupancy.GlobalUsed > 0 {
			detail = slowdownRiskDetailBusyDevice
			slowdownWarnings = append([]string{slowdownRiskBusyWarning}, slowdownWarnings...)
		}
		return SchedulingJudgement{
			State:            StateSlowdownRisk,
			Detail:           detail,
			Occupancy:        occupancy,
			ResourceWarnings: slowdownWarnings,
		}
	}

	// All checks pass: slots available, resources healthy.
	return SchedulingJudgement{
		State:            StateRunnable,
		Detail:           "slots available, no resource conflict predicted",
		Occupancy:        occupancy,
		ResourceWarnings: nil,
	}
}

func normalizeSchedulingTargets(targets []SchedulingEvaluationTarget) []SchedulingEvaluationTarget {
	if len(targets) == 0 {
		return nil
	}
	normalized := make([]SchedulingEvaluationTarget, 0, len(targets))
	for _, target := range targets {
		normalized = append(normalized, SchedulingEvaluationTarget{
			Capability: strings.TrimSpace(target.Capability),
			ModID:      strings.TrimSpace(target.ModID),
			ProfileID:  strings.TrimSpace(target.ProfileID),
			Hint:       target.Hint,
		})
	}
	return normalized
}

func foldSchedulingJudgements(
	targetJudgements []TargetSchedulingJudgement,
	occupancy OccupancySnapshot,
) SchedulingJudgement {
	if len(targetJudgements) == 0 {
		return SchedulingJudgement{
			State:            StateUnknown,
			Detail:           "no scheduling targets provided",
			Occupancy:        occupancy,
			ResourceWarnings: []string{"no scheduling targets provided"},
		}
	}

	sorted := append([]TargetSchedulingJudgement(nil), targetJudgements...)
	sort.SliceStable(sorted, func(i, j int) bool {
		return compareSchedulingTargets(sorted[i].Target, sorted[j].Target) < 0
	})

	winningState := sorted[0].Judgement.State
	for _, candidate := range sorted[1:] {
		if schedulingStatePriority(candidate.Judgement.State) < schedulingStatePriority(winningState) {
			winningState = candidate.Judgement.State
		}
	}

	contributorDetails := make([]string, 0, len(sorted))
	unknownTargets := make([]string, 0)
	resourceWarnings := make([]string, 0)
	seenWarnings := make(map[string]struct{})
	for _, candidate := range sorted {
		label := formatSchedulingTarget(candidate.Target)
		if candidate.Judgement.State == winningState {
			if detail := strings.TrimSpace(candidate.Judgement.Detail); detail != "" {
				contributorDetails = append(contributorDetails, fmt.Sprintf("%s: %s", label, detail))
			} else {
				contributorDetails = append(contributorDetails, label)
			}
		}
		if winningState != StateUnknown && candidate.Judgement.State == StateUnknown {
			unknownTargets = append(unknownTargets, label)
		}
		for _, warning := range candidate.Judgement.ResourceWarnings {
			warning = strings.TrimSpace(warning)
			if warning == "" {
				continue
			}
			if _, exists := seenWarnings[warning]; exists {
				continue
			}
			seenWarnings[warning] = struct{}{}
			resourceWarnings = append(resourceWarnings, warning)
		}
	}

	detail := strings.Join(contributorDetails, "; ")
	if winningState != StateUnknown && len(unknownTargets) > 0 {
		unknownSuffix := fmt.Sprintf("unevaluated targets: %s", strings.Join(unknownTargets, ", "))
		if detail != "" {
			detail = fmt.Sprintf("%s; %s", detail, unknownSuffix)
		} else {
			detail = unknownSuffix
		}
	}

	return SchedulingJudgement{
		State:            winningState,
		Detail:           detail,
		Occupancy:        occupancy,
		ResourceWarnings: resourceWarnings,
	}
}

func schedulingStatePriority(state SchedulingState) int {
	switch state {
	case StateDenied:
		return 0
	case StateQueueRequired:
		return 1
	case StatePreemptionRisk:
		return 2
	case StateSlowdownRisk:
		return 3
	case StateUnknown:
		return 4
	case StateRunnable:
		return 5
	default:
		return 4
	}
}

func compareSchedulingTargets(left SchedulingEvaluationTarget, right SchedulingEvaluationTarget) int {
	if cmp := strings.Compare(left.Capability, right.Capability); cmp != 0 {
		return cmp
	}
	if cmp := strings.Compare(left.ModID, right.ModID); cmp != 0 {
		return cmp
	}
	return strings.Compare(left.ProfileID, right.ProfileID)
}

func formatSchedulingTarget(target SchedulingEvaluationTarget) string {
	capability := strings.TrimSpace(target.Capability)
	modID := strings.TrimSpace(target.ModID)
	profileID := strings.TrimSpace(target.ProfileID)
	switch {
	case capability != "" && modID != "" && profileID != "":
		return fmt.Sprintf("%s (%s/%s)", capability, modID, profileID)
	case capability != "" && modID != "":
		return fmt.Sprintf("%s (%s)", capability, modID)
	case capability != "":
		return capability
	case modID != "" && profileID != "":
		return fmt.Sprintf("%s/%s", modID, profileID)
	case modID != "":
		return modID
	default:
		return "_unspecified_target"
	}
}

// ResourceHint is the K-SCHED-007 optional resource estimate.
// Phase 1: accepted but ignored.
type ResourceHint struct {
	EstimatedVramBytes int64
	EstimatedRamBytes  int64
	EstimatedDiskBytes int64
	Engine             string
}

func (s *Scheduler) Acquire(ctx context.Context, appID string) (func(), AcquireResult, error) {
	if err := ctx.Err(); err != nil {
		return nil, AcquireResult{}, fmt.Errorf("scheduler acquire: %w", err)
	}
	started := time.Now()
	appKey, perApp := s.perAppSemaphore(appID)

	select {
	case s.global <- struct{}{}:
		s.globalUsed.Add(1)
	case <-ctx.Done():
		s.releaseAppReference(appKey, perApp)
		return nil, AcquireResult{}, fmt.Errorf("scheduler acquire: %w", ctx.Err())
	}
	select {
	case perApp.sem <- struct{}{}:
	case <-ctx.Done():
		<-s.global
		s.globalUsed.Add(-1)
		s.releaseAppReference(appKey, perApp)
		return nil, AcquireResult{}, fmt.Errorf("scheduler acquire: %w", ctx.Err())
	}

	var once sync.Once
	release := func() {
		once.Do(func() {
			<-perApp.sem
			<-s.global
			s.globalUsed.Add(-1)
			s.releaseAppReference(appKey, perApp)
		})
	}
	waited := time.Since(started)
	return release, AcquireResult{
		Waited:    waited,
		Starved:   s.starvationThreshold > 0 && waited >= s.starvationThreshold,
		Occupancy: s.occupancySnapshot(appKey),
	}, nil
}
