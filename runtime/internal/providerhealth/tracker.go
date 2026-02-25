package providerhealth

import (
	"sort"
	"strings"
	"sync"
	"time"
)

type State string

const (
	StateUnknown   State = "unknown"
	StateHealthy   State = "healthy"
	StateUnhealthy State = "unhealthy"
)

type Snapshot struct {
	Name                string
	State               State
	LastReason          string
	ConsecutiveFailures int
	LastChangedAt       time.Time
	LastCheckedAt       time.Time
}

type item struct {
	state               State
	lastReason          string
	consecutiveFailures int
	lastChangedAt       time.Time
	lastCheckedAt       time.Time
}

type Tracker struct {
	mu          sync.RWMutex
	items       map[string]item
	nextWatchID uint64
	watchers    map[uint64]chan Snapshot
}

func New() *Tracker {
	return &Tracker{
		items:    make(map[string]item),
		watchers: make(map[uint64]chan Snapshot),
	}
}

func (t *Tracker) Mark(name string, healthy bool, reason string) {
	key := strings.TrimSpace(strings.ToLower(name))
	if key == "" {
		return
	}
	now := time.Now().UTC()

	t.mu.Lock()
	current := t.items[key]
	next := current
	next.lastCheckedAt = now
	next.lastReason = strings.TrimSpace(reason)
	if healthy {
		if current.state != StateHealthy {
			next.lastChangedAt = now
		}
		next.state = StateHealthy
		next.consecutiveFailures = 0
	} else {
		if current.state != StateUnhealthy {
			next.lastChangedAt = now
		}
		next.state = StateUnhealthy
		next.consecutiveFailures = current.consecutiveFailures + 1
	}
	if next.lastChangedAt.IsZero() {
		next.lastChangedAt = now
	}
	notify := current.state != next.state ||
		current.lastReason != next.lastReason ||
		current.consecutiveFailures != next.consecutiveFailures
	t.items[key] = next
	if notify {
		t.broadcastLocked(Snapshot{
			Name:                key,
			State:               next.state,
			LastReason:          next.lastReason,
			ConsecutiveFailures: next.consecutiveFailures,
			LastChangedAt:       next.lastChangedAt,
			LastCheckedAt:       next.lastCheckedAt,
		})
	}
	t.mu.Unlock()
}

func (t *Tracker) Snapshot(name string) Snapshot {
	key := strings.TrimSpace(strings.ToLower(name))
	if key == "" {
		return Snapshot{}
	}
	t.mu.RLock()
	current, exists := t.items[key]
	t.mu.RUnlock()
	if !exists {
		return Snapshot{Name: key, State: StateUnknown}
	}
	return Snapshot{
		Name:                key,
		State:               current.state,
		LastReason:          current.lastReason,
		ConsecutiveFailures: current.consecutiveFailures,
		LastChangedAt:       current.lastChangedAt,
		LastCheckedAt:       current.lastCheckedAt,
	}
}

func (t *Tracker) IsHealthy(name string) bool {
	snapshot := t.Snapshot(name)
	switch snapshot.State {
	case StateUnhealthy:
		return false
	default:
		return true
	}
}

func (t *Tracker) List() []Snapshot {
	t.mu.RLock()
	out := make([]Snapshot, 0, len(t.items))
	for name, item := range t.items {
		out = append(out, Snapshot{
			Name:                name,
			State:               item.state,
			LastReason:          item.lastReason,
			ConsecutiveFailures: item.consecutiveFailures,
			LastChangedAt:       item.lastChangedAt,
			LastCheckedAt:       item.lastCheckedAt,
		})
	}
	t.mu.RUnlock()
	sort.Slice(out, func(i, j int) bool {
		return out[i].Name < out[j].Name
	})
	return out
}

func (t *Tracker) Subscribe(buffer int) (<-chan Snapshot, func()) {
	if buffer < 1 {
		buffer = 1
	}

	t.mu.Lock()
	t.nextWatchID++
	id := t.nextWatchID
	ch := make(chan Snapshot, buffer)
	t.watchers[id] = ch
	t.mu.Unlock()

	cancel := func() {
		t.mu.Lock()
		existing, ok := t.watchers[id]
		if ok {
			delete(t.watchers, id)
			close(existing)
		}
		t.mu.Unlock()
	}
	return ch, cancel
}

func (t *Tracker) broadcastLocked(snapshot Snapshot) {
	for _, ch := range t.watchers {
		select {
		case ch <- snapshot:
			continue
		default:
		}
		select {
		case <-ch:
		default:
		}
		select {
		case ch <- snapshot:
		default:
		}
	}
}
