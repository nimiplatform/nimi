package auditlog

import (
	"errors"
	"strconv"
	"strings"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

const (
	// RefusalWindow is the span within which identical refusals share one
	// record, and within which at most RefusalRecordsPerWindow refusals of any
	// kind are written.
	RefusalWindow           = time.Minute
	RefusalRecordsPerWindow = 300
	refusalTrackedKinds     = 1024
)

// refusalLimiter keeps refusals, which an untrusted caller can trigger at
// will, from evicting the rest of the bounded audit plane. Successful owner
// commits are never coalesced.
type refusalLimiter struct {
	mu                sync.Mutex
	now               func() time.Time
	windowStart       time.Time
	written           int
	suppressedOverCap int
	kinds             map[string]*refusalKind
}

type refusalKind struct {
	lastWritten time.Time
	suppressed  int
}

// refusalDiscriminators are the owner-defined, closed-set payload fields that
// distinguish refusal kinds beyond the reason code. Free-form payload values
// (references, identifiers) never split a kind, so varying them cannot defeat
// coalescing.
var refusalDiscriminators = []string{"grpc_code", "integration_reason", "disposition", "stage", "transport", "failure_reason"}

func refusalKey(event *runtimev1.AuditEventRecord) string {
	var key strings.Builder
	for _, part := range []string{
		event.GetDomain(), event.GetOperation(), strconv.Itoa(int(event.GetReasonCode())),
		strconv.Itoa(int(event.GetCallerKind())), event.GetAppId(), event.GetCallerId(), event.GetSubjectUserId(),
	} {
		key.WriteString(part)
		key.WriteByte(0)
	}
	fields := event.GetPayload().GetFields()
	for _, name := range refusalDiscriminators {
		key.WriteString(fields[name].GetStringValue())
		key.WriteByte(0)
	}
	return key.String()
}

// admit reports whether this refusal is written now and how many refusals it
// additionally stands for (earlier suppressed refusals of its kind, plus any
// suppressed by the window cap).
func (limiter *refusalLimiter) admit(key string) (bool, int) {
	limiter.mu.Lock()
	defer limiter.mu.Unlock()
	now := limiter.now()
	if now.Sub(limiter.windowStart) >= RefusalWindow {
		limiter.windowStart = now
		limiter.written = 0
	}
	kind := limiter.kinds[key]
	if kind != nil && now.Sub(kind.lastWritten) < RefusalWindow {
		kind.suppressed++
		return false, 0
	}
	if limiter.written >= RefusalRecordsPerWindow {
		limiter.suppressedOverCap++
		return false, 0
	}
	suppressed := limiter.suppressedOverCap
	limiter.suppressedOverCap = 0
	if kind == nil {
		if len(limiter.kinds) >= refusalTrackedKinds {
			limiter.evictLocked(now)
		}
		kind = &refusalKind{}
		limiter.kinds[key] = kind
	}
	suppressed += kind.suppressed
	kind.suppressed = 0
	kind.lastWritten = now
	limiter.written++
	return true, suppressed
}

// release returns an admission whose record could not be written, so the next
// refusal of that kind is written instead of being counted.
func (limiter *refusalLimiter) release(key string, suppressed int) {
	limiter.mu.Lock()
	defer limiter.mu.Unlock()
	if kind := limiter.kinds[key]; kind != nil {
		kind.lastWritten = time.Time{}
		kind.suppressed += suppressed
	}
	if limiter.written > 0 {
		limiter.written--
	}
}

// evictLocked forgets kinds whose window closed; if every kind is still in
// its window, the oldest is forgotten. Forgotten suppressed counts move to the
// cap counter so they are still reported.
func (limiter *refusalLimiter) evictLocked(now time.Time) {
	var oldestKey string
	var oldest time.Time
	for key, kind := range limiter.kinds {
		if now.Sub(kind.lastWritten) >= RefusalWindow {
			limiter.suppressedOverCap += kind.suppressed
			delete(limiter.kinds, key)
			continue
		}
		if oldestKey == "" || kind.lastWritten.Before(oldest) {
			oldestKey, oldest = key, kind.lastWritten
		}
	}
	if len(limiter.kinds) >= refusalTrackedKinds && oldestKey != "" {
		limiter.suppressedOverCap += limiter.kinds[oldestKey].suppressed
		delete(limiter.kinds, oldestKey)
	}
}

// AppendRefusal records an owner or transport refusal. Identical refusals
// (same domain, operation, reason, and caller) within RefusalWindow share one
// record whose payload counts the ones suppressed before it
// ("suppressed_count"), and at most RefusalRecordsPerWindow refusals are
// written per window. A nil error means the refusal is recorded or counted.
func (s *Store) AppendRefusal(event *runtimev1.AuditEventRecord) error {
	if event == nil {
		return unrecorded(errors.New("audit refusal is required"))
	}
	if s == nil {
		return unrecorded(errors.New("audit store is unavailable"))
	}
	key := refusalKey(event)
	admitted, suppressed := s.refusals.admit(key)
	if !admitted {
		return nil
	}
	record := event
	if suppressed > 0 {
		record = cloneAuditEvent(event)
		if record.Payload == nil {
			record.Payload = &structpb.Struct{Fields: map[string]*structpb.Value{}}
		}
		if record.Payload.Fields == nil {
			record.Payload.Fields = map[string]*structpb.Value{}
		}
		record.Payload.Fields["suppressed_count"] = structpb.NewNumberValue(float64(suppressed))
	}
	if err := s.AppendEventChecked(record); err != nil {
		s.refusals.release(key, suppressed)
		return err
	}
	return nil
}
