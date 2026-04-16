package digest

import (
	"fmt"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/internal/identity"
	"github.com/nimiplatform/nimi/nimi-cognition/internal/refgraph"
	"github.com/nimiplatform/nimi/nimi-cognition/internal/storage"
	"github.com/nimiplatform/nimi/nimi-cognition/memory"
	"github.com/nimiplatform/nimi/nimi-cognition/routine"
)

// Digest is the external analysis + cleanup routine for non-kernel artifacts.
type Digest struct {
	cfg Config
}

// TriggerMetric captures one baseline-style trigger dimension.
type TriggerMetric struct {
	Current  int `json:"current"`
	Previous int `json:"previous"`
	Delta    int `json:"delta"`
}

// TriggerSummary explains why a digest run was considered worthwhile.
type TriggerSummary struct {
	ContentVolume TriggerMetric `json:"content_volume"`
	SupportChange TriggerMetric `json:"support_change"`
	RefGraphChurn TriggerMetric `json:"ref_graph_churn"`
}

// Detail provides structured explainability for candidates and transitions.
type Detail struct {
	TriggerBasis         TriggerSummary           `json:"trigger_basis"`
	Support              memory.SupportSummary    `json:"support,omitempty"`
	DependencyHealth     routine.DependencyHealth `json:"dependency_health,omitempty"`
	BrokenDependencies   []routine.DependencyEdge `json:"broken_dependencies,omitempty"`
	Blockers             []routine.Blocker        `json:"blockers,omitempty"`
	LowValueBasis        string                   `json:"low_value_basis,omitempty"`
	GroupKey             string                   `json:"group_key,omitempty"`
	Score                float64                  `json:"score,omitempty"`
	PriorArchiveRequired bool                     `json:"prior_archive_required,omitempty"`
	LaterPassConfirmed   bool                     `json:"later_pass_confirmed,omitempty"`
}

// Finding is an analysis-only observation.
type Finding struct {
	Family       string `json:"family"`
	ArtifactKind string `json:"artifact_kind"`
	ArtifactID   string `json:"artifact_id"`
	Kind         string `json:"kind"`
	Message      string `json:"message"`
}

// Candidate is a cleanup candidate produced by analysis.
type Candidate struct {
	Family           string  `json:"family"`
	ArtifactKind     string  `json:"artifact_kind"`
	ArtifactID       string  `json:"artifact_id"`
	CurrentLifecycle string  `json:"current_lifecycle"`
	ProposedAction   string  `json:"proposed_action"`
	Reason           string  `json:"reason"`
	SupportScore     float64 `json:"support_score"`
	StrongRefs       int     `json:"strong_refs"`
	WeakRefs         int     `json:"weak_refs"`
	LowValueBasis    string  `json:"low_value_basis,omitempty"`
	GroupKey         string  `json:"group_key,omitempty"`
	Score            float64 `json:"score,omitempty"`
	Detail           Detail  `json:"detail"`
	updatedAt        time.Time
}

// AnalysisReport is the first digest phase.
type AnalysisReport struct {
	GeneratedAt time.Time      `json:"generated_at"`
	Trigger     TriggerSummary `json:"trigger"`
	Findings    []Finding      `json:"findings"`
	Candidates  []Candidate    `json:"candidates"`
}

// AppliedTransition records an applied cleanup mutation.
type AppliedTransition struct {
	Family       string `json:"family"`
	ArtifactKind string `json:"artifact_kind"`
	ArtifactID   string `json:"artifact_id"`
	FromState    string `json:"from_state"`
	ToState      string `json:"to_state"`
	Reason       string `json:"reason"`
	Detail       Detail `json:"detail"`
}

// BlockedTransition records a blocked cleanup mutation.
type BlockedTransition struct {
	Family       string   `json:"family"`
	ArtifactKind string   `json:"artifact_kind"`
	ArtifactID   string   `json:"artifact_id"`
	Action       string   `json:"action"`
	Reason       string   `json:"reason"`
	BlockedBy    []string `json:"blocked_by,omitempty"`
	Detail       Detail   `json:"detail"`
}

// Report contains both analysis and applied cleanup results.
type Report struct {
	RunID       string              `json:"run_id"`
	ScopeID     string              `json:"scope_id"`
	StartedAt   time.Time           `json:"started_at"`
	CompletedAt time.Time           `json:"completed_at"`
	Analysis    AnalysisReport      `json:"analysis"`
	Applied     []AppliedTransition `json:"applied"`
	Blocked     []BlockedTransition `json:"blocked"`
}

const (
	lowValueBasisZeroSupport           = "zero_support"
	lowValueBasisBrokenDependencies    = "broken_dependencies"
	lowValueBasisLowSupport            = "low_support"
	lowValueBasisInvalidatedDependency = "invalidated_dependency"
)

type storageArtifactAccess struct {
	store *storage.SQLiteBackend
	graph *refgraph.Service
}

type storageGraphAccess struct {
	graph *refgraph.Service
}

type triggerSnapshot struct {
	contentVolume int
	supportChange int
	refGraphChurn int
}

// New creates a digest routine.
func New(cfg Config) *Digest { return &Digest{cfg: cfg} }

// Name returns the routine name.
func (d *Digest) Name() string { return "digest" }

// analyze computes cleanup candidates without mutating repository state.
func (d *Digest) analyze(scopeID string, now time.Time, store *storage.SQLiteBackend, graph *refgraph.Service) (AnalysisReport, error) {
	if store == nil {
		return AnalysisReport{}, errStoreRequired("analyze")
	}
	if graph == nil {
		graph = refgraph.New(store)
	}
	return d.analyzeAccess(scopeID, now, &storageArtifactAccess{store: store, graph: graph}, &storageGraphAccess{graph: graph})
}

// apply executes cleanup transitions derived from analysis.
func (d *Digest) apply(scopeID string, analysis AnalysisReport, now time.Time, store *storage.SQLiteBackend, graph *refgraph.Service) ([]AppliedTransition, []BlockedTransition, error) {
	if store == nil {
		return nil, nil, errStoreRequired("apply")
	}
	if graph == nil {
		graph = refgraph.New(store)
	}
	return d.applyAccess(scopeID, analysis, now, &storageArtifactAccess{store: store, graph: graph}, &storageGraphAccess{graph: graph})
}

// run executes analysis and cleanup and persists the resulting report.
func (d *Digest) run(scopeID string, now time.Time, store *storage.SQLiteBackend) (*Report, error) {
	if store == nil {
		return nil, errStoreRequired("run")
	}
	graph := refgraph.New(store)
	return d.runAccess(scopeID, now, &storageArtifactAccess{store: store, graph: graph}, &storageGraphAccess{graph: graph})
}

func (d *Digest) runAccess(scopeID string, now time.Time, access routine.ArtifactAccess, graph routine.GraphAccess) (*Report, error) {
	report := &Report{ScopeID: scopeID, StartedAt: now}
	runID, err := identity.NewPrefixed("digest")
	if err != nil {
		return nil, err
	}
	report.RunID = runID
	analysis, err := d.analyzeAccess(scopeID, now, access, graph)
	if err != nil {
		return nil, err
	}
	applied, blocked, err := d.applyAccess(scopeID, analysis, now, access, graph)
	if err != nil {
		return nil, err
	}
	report.CompletedAt = now
	report.Analysis = analysis
	report.Applied = applied
	report.Blocked = blocked
	if err := access.SaveDigestRun(scopeID, report.RunID, report, digestCandidates(report), report.StartedAt); err != nil {
		return nil, err
	}
	return report, nil
}

func errStoreRequired(op string) error {
	return fmt.Errorf("digest %s: store is required", op)
}
