// Package memory provides types for the memory substrate — the
// record/evidence layer of local cognition.
//
// memory_substrate owns: experiences, observations, events, evidence
// rows, and narrative projections. It remains record-centric rather
// than kernel-centric.
//
// Zero I/O, zero external dependencies.
package memory

import (
	"encoding/json"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/artifactref"
	"github.com/nimiplatform/nimi/nimi-cognition/kernel"
)

// RecordID is a stable identifier for a memory record.
type RecordID string

// RecordKind discriminates the type of memory record.
type RecordKind string

const (
	RecordKindExperience  RecordKind = "experience"
	RecordKindObservation RecordKind = "observation"
	RecordKindEvent       RecordKind = "event"
	RecordKindEvidence    RecordKind = "evidence"
	RecordKindNarrative   RecordKind = "narrative"
)

// RecordLifecycle describes the cleanup lifecycle of a memory record.
// These are local cognition lifecycle states, distinct from runtime-owned
// lifecycle states.
type RecordLifecycle string

const (
	RecordLifecycleActive   RecordLifecycle = "active"
	RecordLifecycleArchived RecordLifecycle = "archived"
	RecordLifecycleRemoved  RecordLifecycle = "removed"
)

// Record is a single memory substrate entry. It is record-centric:
// it stores evidence, experiences, observations, and narrative
// projections rather than kernel rules.
type Record struct {
	// Identity
	RecordID RecordID   `json:"record_id"`
	ScopeID  string     `json:"scope_id"`
	Kind     RecordKind `json:"kind"`
	Version  int        `json:"version"`

	// Content
	Content json.RawMessage `json:"content"`

	// Source references — links to upstream sources
	SourceRefs []kernel.SourceRef `json:"source_refs,omitempty"`

	// ArtifactRefs carry owned links to other local cognition artifacts.
	ArtifactRefs []artifactref.Ref `json:"artifact_refs,omitempty"`

	// Lifecycle (local cognition cleanup state)
	Lifecycle RecordLifecycle `json:"lifecycle"`

	// Timestamps
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// SupportSummary describes live incoming support for a record.
type SupportSummary struct {
	Strong int     `json:"strong"`
	Weak   int     `json:"weak"`
	Score  float64 `json:"score"`
}

// View is a service-derived serving representation of a memory record.
// It is not a persisted artifact shape.
type View struct {
	Record              Record            `json:"record"`
	Support             SupportSummary    `json:"support"`
	Lineage             []artifactref.Ref `json:"lineage,omitempty"`
	InvalidationReasons []string          `json:"invalidation_reasons,omitempty"`
	CleanupSignals      []string          `json:"cleanup_signals,omitempty"`
}

// HistoryAction describes a local lifecycle or mutation event for a memory record.
type HistoryAction string

const (
	HistoryActionCreated  HistoryAction = "created"
	HistoryActionUpdated  HistoryAction = "updated"
	HistoryActionArchived HistoryAction = "archived"
	HistoryActionRemoved  HistoryAction = "removed"
	HistoryActionDeleted  HistoryAction = "deleted"
)

// HistoryEntry is a service-owned lineage view for a memory record.
type HistoryEntry struct {
	ScopeID   string          `json:"scope_id"`
	RecordID  RecordID        `json:"record_id"`
	Action    HistoryAction   `json:"action"`
	Lifecycle RecordLifecycle `json:"lifecycle"`
	Version   int             `json:"version"`
	At        time.Time       `json:"at"`
}

// Experience is a first-person agent experience record.
type Experience struct {
	Summary      string   `json:"summary"`
	Context      string   `json:"context,omitempty"`
	Participants []string `json:"participants,omitempty"`
}

// Observation is an observed fact about the world.
type Observation struct {
	Subject    string  `json:"subject"`
	Predicate  string  `json:"predicate"`
	Object     string  `json:"object"`
	Confidence float64 `json:"confidence,omitempty"`
}

// Event is an external event the agent was informed of.
type Event struct {
	EventType string `json:"event_type"`
	Summary   string `json:"summary"`
	Source    string `json:"source,omitempty"`
}

// EvidenceRow is structured evidence supporting kernel rules or
// knowledge projections.
type EvidenceRow struct {
	Claim     string   `json:"claim"`
	Support   string   `json:"support"`
	SourceIDs []string `json:"source_ids,omitempty"`
}

// NarrativeProjection is a synthesized narrative over a time range
// or topic. Remains memory_substrate even when document-like in form.
type NarrativeProjection struct {
	Title           string     `json:"title"`
	Body            string     `json:"body"`
	TimeStart       time.Time  `json:"time_start,omitempty"`
	TimeEnd         time.Time  `json:"time_end,omitempty"`
	SourceRecordIDs []RecordID `json:"source_record_ids,omitempty"`
}
