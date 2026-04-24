// Package skill provides service-grade advisory skill artifacts —
// procedural bundles for recurring scenarios or task classes.
//
// skill_artifacts participate in standalone cognition retrieval,
// prompt serving, digest lifecycle cleanup, and explicit history.
// They do not own runtime execution policy, control-plane truth,
// or orchestration.
//
// Zero I/O, zero external dependencies.
package skill

import (
	"encoding/json"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/artifactref"
	"github.com/nimiplatform/nimi/nimi-cognition/kernel"
)

// BundleID is a stable identifier for a skill bundle.
type BundleID string

// BundleStatus describes the standalone lifecycle state of a skill bundle.
type BundleStatus string

const (
	BundleStatusDraft    BundleStatus = "draft"
	BundleStatusActive   BundleStatus = "active"
	BundleStatusArchived BundleStatus = "archived"
	BundleStatusRemoved  BundleStatus = "removed"
)

// Bundle is a procedural artifact for a recurring scenario or task
// class. It contains advisory steps, an optional selector, and references to
// supporting cognition artifacts.
type Bundle struct {
	// Identity
	BundleID BundleID     `json:"bundle_id"`
	ScopeID  string       `json:"scope_id"`
	Version  int          `json:"version"`
	Status   BundleStatus `json:"status"`

	// Content
	Name        string   `json:"name"`
	Description string   `json:"description,omitempty"`
	Steps       []Step   `json:"steps"`
	Trigger     *Trigger `json:"trigger,omitempty"`

	// References — may cite kernel rules and knowledge projections
	SourceRefs []kernel.SourceRef `json:"source_refs,omitempty"`

	// ArtifactRefs carry owned advisory dependencies. They do not promote the
	// bundle into an execution-policy owner.
	ArtifactRefs []artifactref.Ref `json:"artifact_refs,omitempty"`

	// Timestamps
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Step is a single step within a skill bundle.
type Step struct {
	StepID      string          `json:"step_id"`
	Instruction string          `json:"instruction"`
	Params      json.RawMessage `json:"params,omitempty"`
	Order       int             `json:"order"`
}

// Trigger describes optional selector metadata under which a skill may be
// relevant. It is advisory only.
type Trigger struct {
	TriggerKind string `json:"trigger_kind"` // e.g., "keyword", "scenario", "tag"
	Condition   string `json:"condition"`
}

// HistoryAction describes a local lifecycle or mutation event for a skill bundle.
type HistoryAction string

const (
	HistoryActionCreated  HistoryAction = "created"
	HistoryActionUpdated  HistoryAction = "updated"
	HistoryActionArchived HistoryAction = "archived"
	HistoryActionRemoved  HistoryAction = "removed"
	HistoryActionDeleted  HistoryAction = "deleted"
)

// HistoryEntry is a service-owned lifecycle view for a skill bundle.
type HistoryEntry struct {
	ScopeID  string        `json:"scope_id"`
	BundleID BundleID      `json:"bundle_id"`
	Action   HistoryAction `json:"action"`
	Status   BundleStatus  `json:"status"`
	Version  int           `json:"version"`
	At       time.Time     `json:"at"`
}
