// Package aitelemetry owns read-only AI execution facts and bounded accounting.
// It never admits, schedules, cancels, resumes, or repeats an AI operation.
package aitelemetry

import (
	"context"
	"database/sql"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
	"google.golang.org/protobuf/proto"
)

const (
	MaxRows          = 100000
	MaxPayloadBytes  = 64 << 20
	MaxAttemptBytes  = 4 << 10
	MaxActive        = 1024
	MaxHistory       = 1024
	MaxGroups        = 200
	MaxPendingWrites = 1024
	Retention        = 7 * 24 * time.Hour
)

func sourceNames() []string {
	return []string{"home", "app", "direct-runtime", "local-agent", "agent-background", "realtime"}
}

type Backend interface {
	DB() *sql.DB
	WriteTx(context.Context, func(*sql.Tx) error) error
}

// Source is supplied only by an in-process execution owner. These identifiers
// are display/correlation facts and convey no authority to their reader.
type Source struct {
	Kind       string `json:"kind"`
	ID         string `json:"id"`
	Label      string `json:"label"`
	ParentID   string `json:"parent_id"`
	ParentKind string `json:"parent_kind"`
}

type Price struct {
	Unit     string `json:"unit"`
	Input    string `json:"input"`
	Output   string `json:"output"`
	Currency string `json:"currency"`
	AsOf     string `json:"as_of"`
}

type Facts struct {
	AccountID   string                               `json:"account_id"`
	OperationID string                               `json:"operation_id"`
	Source      Source                               `json:"source"`
	Capability  string                               `json:"capability"`
	Models      []*runtimev1.DesktopAIExecutionModel `json:"models"`
	Route       runtimev1.DesktopAIExecutionRoute    `json:"route"`
	Price       Price                                `json:"price"`
}

type Record struct {
	Facts
	ID                 string                `json:"id"`
	Revision           uint64                `json:"revision"`
	StartedAt          time.Time             `json:"started_at"`
	ObservedAt         time.Time             `json:"observed_at"`
	TerminalAt         time.Time             `json:"terminal_at,omitempty"`
	Usage              *runtimev1.UsageStats `json:"usage,omitempty"`
	ObservationUnknown bool                  `json:"observation_unknown,omitempty"`
}

type Attempt struct {
	mu     sync.Mutex
	store  *Store
	record Record
}

type sourceContextKey struct{}
type invocationContextKey struct{}
type invocation struct {
	store *Store
	facts Facts
}

func WithSource(ctx context.Context, source Source) context.Context {
	return context.WithValue(ctx, sourceContextKey{}, source)
}

func SourceFromContext(ctx context.Context) (Source, bool) {
	if ctx == nil {
		return Source{}, false
	}
	source, ok := ctx.Value(sourceContextKey{}).(Source)
	return source, ok
}

func WithInvocation(ctx context.Context, store *Store, facts Facts) context.Context {
	if store == nil {
		return ctx
	}
	return context.WithValue(ctx, invocationContextKey{}, &invocation{store: store, facts: cloneFacts(facts)})
}

// Begin is called at the actual engine/Provider dispatch boundary, after
// preparation and queue admission. A recording failure never changes AI output.
func Begin(ctx context.Context) *Attempt {
	if ctx == nil {
		return nil
	}
	owner, ok := ctx.Value(invocationContextKey{}).(*invocation)
	if !ok || owner.store == nil {
		return nil
	}
	return owner.store.Begin(owner.facts)
}

// CopySource preserves only safe owner attribution across a detached context,
// never request metadata, credentials, or executable authorization.
func CopySource(from, to context.Context) context.Context {
	if source, ok := SourceFromContext(from); ok {
		return WithSource(to, source)
	}
	return to
}

func (s *Store) Begin(facts Facts) *Attempt {
	if s == nil {
		return nil
	}
	now := s.now().UTC()
	attempt := &Attempt{store: s, record: Record{Facts: cloneFacts(facts), ID: ulid.Make().String(), Revision: 1, StartedAt: now, ObservedAt: now}}
	_ = s.record(attempt.record, true)
	return attempt
}

func (a *Attempt) ID() string {
	if a == nil {
		return ""
	}
	return a.record.ID
}

func (a *Attempt) Finish(usage *runtimev1.UsageStats) {
	if a == nil {
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.record.TerminalAt.IsZero() {
		return
	}
	a.record.Revision++
	a.record.TerminalAt = a.store.now().UTC()
	a.record.ObservedAt = a.record.TerminalAt
	a.record.Usage = cloneUsage(usage)
	a.store.Record(a.record)
}

func (a *Attempt) Unknown() {
	if a == nil {
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.record.TerminalAt.IsZero() {
		return
	}
	a.record.Revision++
	a.record.ObservedAt = a.store.now().UTC()
	a.record.ObservationUnknown = true
	a.store.Record(a.record)
}

func cloneFacts(facts Facts) Facts {
	cloned := facts
	cloned.Models = make([]*runtimev1.DesktopAIExecutionModel, 0, len(facts.Models))
	for _, model := range facts.Models {
		if model != nil {
			cloned.Models = append(cloned.Models, proto.Clone(model).(*runtimev1.DesktopAIExecutionModel))
		}
	}
	return cloned
}

func cloneUsage(usage *runtimev1.UsageStats) *runtimev1.UsageStats {
	if usage == nil {
		return nil
	}
	return proto.Clone(usage).(*runtimev1.UsageStats)
}
