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
	ConnectorRef string                               `json:"connector_ref,omitempty"`
	AccountID    string                               `json:"account_id"`
	OperationID  string                               `json:"operation_id"`
	Source       Source                               `json:"source"`
	Capability   string                               `json:"capability"`
	Models       []*runtimev1.DesktopAIExecutionModel `json:"models"`
	Route        runtimev1.DesktopAIExecutionRoute    `json:"route"`
	Price        Price                                `json:"price"`
}

type Record struct {
	Facts
	ID                 string                                 `json:"id"`
	Revision           uint64                                 `json:"revision"`
	StartedAt          time.Time                              `json:"started_at"`
	ObservedAt         time.Time                              `json:"observed_at"`
	TerminalAt         time.Time                              `json:"terminal_at,omitempty"`
	Usage              *runtimev1.UsageStats                  `json:"usage,omitempty"`
	ModelUsage         []*runtimev1.DesktopAIModelUsage       `json:"model_usage,omitempty"`
	ObservationUnknown bool                                   `json:"observation_unknown,omitempty"`
	Outcome            runtimev1.DesktopAICloudAttemptOutcome `json:"outcome,omitempty"`
	ReasonCode         runtimev1.ReasonCode                   `json:"reason_code,omitempty"`
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
	a.Complete(usage, runtimev1.DesktopAICloudAttemptOutcome_DESKTOP_AI_CLOUD_ATTEMPT_OUTCOME_UNKNOWN, runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED)
}

// @nimi-authority: rule.nimi.runtime.rpc-foundations.home-cloud-connection-observation
func (a *Attempt) Complete(usage *runtimev1.UsageStats, outcome runtimev1.DesktopAICloudAttemptOutcome, reason runtimev1.ReasonCode) {
	if a == nil {
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.record.TerminalAt.IsZero() {
		// A late measurement may fill an unknown quantity without changing
		// the already observed outcome, terminal time or attempt identity.
		if a.record.Usage == nil && usage != nil && len(a.record.ModelUsage) == 0 {
			a.record.Revision++
			a.record.ObservedAt = a.store.now().UTC()
			a.record.Usage = cloneUsage(usage)
			_ = a.store.Record(a.record)
		}
		return
	}
	a.record.Revision++
	a.record.TerminalAt = a.store.now().UTC()
	a.record.ObservedAt = a.record.TerminalAt
	a.record.Usage = cloneUsage(usage)
	if len(a.record.ModelUsage) > 0 {
		a.record.Usage = completeModelUsage(a.record.ModelUsage)
	}
	a.record.Outcome = outcome
	a.record.ReasonCode = reason
	_ = a.store.Record(a.record)
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
	_ = a.store.Record(a.record)
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

// SetModelUsage records native components of this same HTTP attempt. It never
// creates an extra execution or attributes author tokens to the image model.
// @nimi-authority: rule.nimi.runtime.ai-provider.openai-svg-author
func (a *Attempt) SetModelUsage(values []*runtimev1.DesktopAIModelUsage) {
	if a == nil {
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.record.TerminalAt.IsZero() {
		return
	}
	a.record.ModelUsage = cloneModelUsage(values)
}

func cloneModelUsage(values []*runtimev1.DesktopAIModelUsage) []*runtimev1.DesktopAIModelUsage {
	result := make([]*runtimev1.DesktopAIModelUsage, 0, len(values))
	for _, value := range values {
		if value != nil {
			result = append(result, proto.Clone(value).(*runtimev1.DesktopAIModelUsage))
		}
	}
	return result
}

func completeModelUsage(values []*runtimev1.DesktopAIModelUsage) *runtimev1.UsageStats {
	result := &runtimev1.UsageStats{}
	for _, value := range values {
		if value.GetUsage() == nil {
			return nil
		}
		u := value.Usage
		result.InputTokens += u.InputTokens
		result.OutputTokens += u.OutputTokens
		result.CachedInputTokens += u.CachedInputTokens
		result.ReasoningOutputTokens += u.ReasoningOutputTokens
	}
	return result
}
