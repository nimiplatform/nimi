package digest

import (
	"fmt"

	"github.com/nimiplatform/nimi/nimi-cognition/routine"
)

// Worker adapts the digest routine to the generic external routine framework.
type Worker struct {
	digest *Digest
}

// NewWorker creates the external digest worker.
func NewWorker(cfg Config) *Worker {
	return &Worker{digest: New(cfg)}
}

// Name returns the routine name.
func (w *Worker) Name() string { return w.digest.Name() }

// Run executes digest as an external routine against a routine.Context.
func (w *Worker) Run(ctx routine.Context) (*routine.Result, error) {
	if ctx.Clock == nil {
		return nil, fmt.Errorf("digest worker: clock is required")
	}
	if ctx.Storage == nil {
		return nil, fmt.Errorf("digest worker: storage is required")
	}
	if ctx.Graph == nil {
		return nil, fmt.Errorf("digest worker: graph is required")
	}

	now := ctx.Clock()
	report, err := w.digest.runAccess(ctx.ScopeID, now, ctx.Storage, ctx.Graph)
	if err != nil {
		return nil, err
	}
	return reportToRoutineResult(report), nil
}

func reportToRoutineResult(report *Report) *routine.Result {
	if report == nil {
		return nil
	}
	families := map[string]*routine.FamilyResult{}
	for _, family := range []string{"knowledge", "skill", "memory"} {
		families[family] = &routine.FamilyResult{Family: family}
	}
	for _, candidate := range report.Analysis.Candidates {
		if result := families[candidate.Family]; result != nil {
			result.Processed++
		}
	}
	for _, item := range report.Applied {
		result := families[item.Family]
		if result == nil {
			continue
		}
		switch item.ToState {
		case "archived":
			result.Archived++
		case "removed":
			result.Removed++
		}
	}
	familyResults := make([]routine.FamilyResult, 0, len(families))
	totalProcessed := 0
	totalChanged := 0
	for _, family := range []string{"knowledge", "skill", "memory"} {
		result := families[family]
		result.Unchanged = result.Processed - result.Archived - result.Removed
		if result.Unchanged < 0 {
			result.Unchanged = 0
		}
		totalProcessed += result.Processed
		totalChanged += result.Archived + result.Removed
		familyResults = append(familyResults, *result)
	}
	return &routine.Result{
		RoutineName:    "digest",
		ScopeID:        report.ScopeID,
		StartedAt:      report.StartedAt,
		CompletedAt:    report.CompletedAt,
		FamilyResults:  familyResults,
		TotalProcessed: totalProcessed,
		TotalChanged:   totalChanged,
	}
}
