// Package appactivity owns the Runtime App activity plane: account-partitioned
// activity and todo projections published by Registered App Subjects or the
// fixed Runtime Agent publisher, their ordered changes, shared read state,
// retention, and the Host-private source open request lifecycle.
package appactivity

import (
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"time"
)

const (
	// Bounds fixed by the App activity contract.
	MaxRecordBytes     = 64 * 1024
	MaxDataJSONBytes   = 32 * 1024
	MaxPageSize        = 100
	DefaultPageSize    = 50
	MaxKeyBytes        = 256
	MaxTitleBytes      = 512
	MaxSummaryBytes    = 4096
	MaxObjectRefBytes  = 256
	MaxActivityType    = 128
	RetentionWindow    = 30 * 24 * time.Hour
	OpenRequestTimeout = 45 * time.Second

	publisherKindApp          = "app"
	publisherKindRuntimeAgent = "runtime_agent"
	// The Runtime Agent publisher is fixed; no request can select it.
	runtimeAgentPublisherRef = "runtime"

	kindActivity = "activity"
	kindTodo     = "todo"

	todoStateNone      = ""
	todoStateOpen      = "open"
	todoStateCompleted = "completed"
	todoStateCancelled = "cancelled"

	changeKindUpsert = "upsert"
	changeKindRemove = "remove"

	// RuntimeAgentTurnActivityType is the fixed Runtime-origin type for a
	// committed completed Conversation turn. App publishers cannot use the
	// reserved nimi.runtime namespace.
	RuntimeAgentTurnActivityType = "nimi.runtime.agent-conversation.turn-completed.v1"
	runtimeAgentTurnTitle        = "Conversation reply"
	reservedRuntimeTypePrefix    = "nimi.runtime."
)

var (
	ErrUnavailable      = errors.New("App activity owner is unavailable")
	ErrInvalidInput     = errors.New("App activity input is invalid")
	ErrConflict         = errors.New("App activity revision conflict")
	ErrNotFound         = errors.New("App activity record not found")
	ErrTooLarge         = errors.New("App activity record is too large")
	ErrPageToken        = errors.New("App activity page token is invalid")
	ErrCursorExpired    = errors.New("App activity cursor expired")
	ErrAccountFenced    = errors.New("App activity account is fenced")
	ErrAgentUnavailable = errors.New("App activity Agent is unavailable")
)

// storedRecord is the owner-private row. Only the public fields are copied
// into change images and projections.
type storedRecord struct {
	ActivityID          string
	AccountID           string
	PublisherKind       string
	PublisherRef        string
	PublisherKey        string
	SourceRef           string
	CreateSeq           uint64
	ChangeSeq           uint64
	Revision            uint64
	ContentHash         string
	Kind                string
	TodoState           string
	Attention           bool
	Title               string
	Summary             string
	ObjectRef           string
	ActivityType        string
	DataJSON            string
	AgentLocalRef       string
	AgentRef            string
	AgentDisplayName    string
	OccurredAtMS        int64
	PublishedAtMS       int64
	UpdatedAtMS         int64
	TerminalAtMS        int64
	ReadThroughRevision uint64
}

// recordImage is the committed public image stored with each upsert change.
// It carries the publisher reference only so delivery can resolve the current
// trusted source display; that reference never leaves Runtime.
type recordImage struct {
	ActivityID          string `json:"activityId"`
	PublisherKind       string `json:"publisherKind"`
	PublisherRef        string `json:"publisherRef"`
	SourceRef           string `json:"sourceRef"`
	Key                 string `json:"key"`
	Revision            uint64 `json:"revision"`
	Kind                string `json:"kind"`
	TodoState           string `json:"todoState"`
	Attention           bool   `json:"attention"`
	Title               string `json:"title"`
	Summary             string `json:"summary"`
	ObjectRef           string `json:"objectRef"`
	ActivityType        string `json:"activityType"`
	DataJSON            string `json:"dataJson"`
	AgentRef            string `json:"agentRef"`
	AgentDisplayName    string `json:"agentDisplayName"`
	OccurredAtMS        int64  `json:"occurredAtMs"`
	PublishedAtMS       int64  `json:"publishedAtMs"`
	UpdatedAtMS         int64  `json:"updatedAtMs"`
	ChangeSeq           uint64 `json:"changeSeq"`
	ReadThroughRevision uint64 `json:"readThroughRevision"`
}

func (record storedRecord) image() recordImage {
	return recordImage{
		ActivityID: record.ActivityID, PublisherKind: record.PublisherKind, PublisherRef: record.PublisherRef,
		SourceRef: record.SourceRef, Key: record.PublisherKey, Revision: record.Revision, Kind: record.Kind,
		TodoState: record.TodoState, Attention: record.Attention, Title: record.Title, Summary: record.Summary,
		ObjectRef: record.ObjectRef, ActivityType: record.ActivityType, DataJSON: record.DataJSON,
		AgentRef: record.AgentRef, AgentDisplayName: record.AgentDisplayName,
		OccurredAtMS: record.OccurredAtMS, PublishedAtMS: record.PublishedAtMS, UpdatedAtMS: record.UpdatedAtMS,
		ChangeSeq: record.ChangeSeq, ReadThroughRevision: record.ReadThroughRevision,
	}
}

func terminalState(state string) bool {
	return state == todoStateCompleted || state == todoStateCancelled
}

// sourceRef derives the account-scoped non-authorizing source grouping
// reference. It is not reversible to a Registered App Subject.
func sourceRef(accountID, publisherKind, publisherRef string) string {
	return "src_" + shortDigest("nimi.runtime.app-activity.source/v1", accountID, publisherKind, publisherRef)
}

// AgentAssociationRef derives the account-scoped non-authorizing Agent grouping
// reference. It is never accepted as an Agent handle.
func AgentAssociationRef(accountID, localAgentRef string) string {
	return "agr_" + shortDigest("nimi.runtime.app-activity.agent/v1", accountID, localAgentRef)
}

func shortDigest(domain string, parts ...string) string {
	hash := sha256.New()
	_, _ = hash.Write([]byte(domain))
	for _, part := range parts {
		_, _ = hash.Write([]byte{0})
		_, _ = hash.Write([]byte(part))
	}
	return base64.RawURLEncoding.EncodeToString(hash.Sum(nil))[:32]
}
