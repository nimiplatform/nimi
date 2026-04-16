// Package knowledge provides types for knowledge projections —
// page/document/explainer artifacts shaped for retrieval and
// reasoning consumption.
//
// Knowledge projections may cite kernel rules and memory evidence.
// They are NOT the kernels themselves. They are revisable and
// stale-able.
//
// Zero I/O, zero external dependencies.
package knowledge

import (
	"encoding/json"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/artifactref"
	"github.com/nimiplatform/nimi/nimi-cognition/kernel"
)

// PageID is a stable identifier for a knowledge page.
type PageID string

// ProjectionKind discriminates knowledge projection types.
type ProjectionKind string

const (
	ProjectionKindExplainer ProjectionKind = "explainer"
	ProjectionKindSummary   ProjectionKind = "summary"
	ProjectionKindGuide     ProjectionKind = "guide"
	ProjectionKindNote      ProjectionKind = "note"
)

// ProjectionLifecycle describes the cleanup lifecycle of a projection.
type ProjectionLifecycle string

const (
	ProjectionLifecycleActive   ProjectionLifecycle = "active"
	ProjectionLifecycleStale    ProjectionLifecycle = "stale"
	ProjectionLifecycleArchived ProjectionLifecycle = "archived"
	ProjectionLifecycleRemoved  ProjectionLifecycle = "removed"
)

// Page is a knowledge projection artifact. It is shaped for retrieval
// and reasoning consumption, not as a kernel rule.
type Page struct {
	// Identity
	PageID  PageID         `json:"page_id"`
	ScopeID string         `json:"scope_id"`
	Kind    ProjectionKind `json:"kind"`
	Version int            `json:"version"`

	// Content
	Title string          `json:"title"`
	Body  json.RawMessage `json:"body"`

	// Citations — provenance links to kernel rules and memory evidence
	Citations []Citation `json:"citations,omitempty"`

	// Source references — links to upstream sources
	SourceRefs []kernel.SourceRef `json:"source_refs,omitempty"`

	// ArtifactRefs carry the projection's owned links to supporting
	// cognition artifacts such as memory records.
	ArtifactRefs []artifactref.Ref `json:"artifact_refs,omitempty"`

	// Lifecycle
	Lifecycle ProjectionLifecycle `json:"lifecycle"`

	// Timestamps
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Relation represents a same-scope knowledge page relation.
type Relation struct {
	ScopeID    string               `json:"scope_id"`
	FromPageID PageID               `json:"from_page_id"`
	ToPageID   PageID               `json:"to_page_id"`
	RelationType string             `json:"relation_type"`
	Strength   artifactref.Strength `json:"strength"`
	CreatedAt  time.Time            `json:"created_at"`
	UpdatedAt  time.Time            `json:"updated_at"`
}

// TraversalHit represents one page returned by graph traversal.
type TraversalHit struct {
	PageID       PageID   `json:"page_id"`
	Depth        int      `json:"depth"`
	ViaPageID    PageID   `json:"via_page_id,omitempty"`
	RelationType string   `json:"relation_type,omitempty"`
	Path         []PageID `json:"path,omitempty"`
}

// IngestEnvelope is the accepted standalone-local ingest input.
type IngestEnvelope struct {
	PageID PageID         `json:"page_id"`
	Kind   ProjectionKind `json:"kind"`
	Title  string         `json:"title"`
	Body   json.RawMessage `json:"body"`
}

// IngestTaskStatus is the local ingest progress state.
type IngestTaskStatus string

const (
	IngestTaskStatusQueued    IngestTaskStatus = "queued"
	IngestTaskStatusRunning   IngestTaskStatus = "running"
	IngestTaskStatusCompleted IngestTaskStatus = "completed"
	IngestTaskStatusFailed    IngestTaskStatus = "failed"
)

// IngestTask is the explicit progress model for standalone-local ingest.
type IngestTask struct {
	TaskID          string           `json:"task_id"`
	ScopeID         string           `json:"scope_id"`
	Status          IngestTaskStatus `json:"status"`
	ProgressPercent int              `json:"progress_percent"`
	PageID          PageID           `json:"page_id,omitempty"`
	Error           string           `json:"error,omitempty"`
	CreatedAt       time.Time        `json:"created_at"`
	UpdatedAt       time.Time        `json:"updated_at"`
}

// HistoryAction describes a local lifecycle or mutation event for a knowledge page.
type HistoryAction string

const (
	HistoryActionCreated  HistoryAction = "created"
	HistoryActionUpdated  HistoryAction = "updated"
	HistoryActionArchived HistoryAction = "archived"
	HistoryActionRemoved  HistoryAction = "removed"
	HistoryActionDeleted  HistoryAction = "deleted"
)

// HistoryEntry is a service-owned lifecycle view for a knowledge page.
type HistoryEntry struct {
	ScopeID   string              `json:"scope_id"`
	PageID    PageID              `json:"page_id"`
	Action    HistoryAction       `json:"action"`
	Lifecycle ProjectionLifecycle `json:"lifecycle"`
	Version   int                 `json:"version"`
	At        time.Time           `json:"at"`
}

// Citation is a reference from a knowledge projection to a kernel
// rule or memory record.
type Citation struct {
	TargetKind string             `json:"target_kind"` // "kernel_rule", "memory_record"
	TargetID   string             `json:"target_id"`
	Strength   kernel.RefStrength `json:"strength"`
	Context    string             `json:"context,omitempty"` // why this citation exists
}
