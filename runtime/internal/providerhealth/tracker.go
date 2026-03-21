package providerhealth

import (
	"fmt"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
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
	mu                       sync.RWMutex
	items                    map[string]item
	nextWatchID              uint64
	watchers                 map[uint64]chan Snapshot
	now                      func() time.Time
	onDroppedNotification    func(Snapshot)
	droppedNotificationCount atomic.Uint64
}

type Config struct {
	Now                   func() time.Time
	OnDroppedNotification func(Snapshot)
}

func New(configs ...Config) *Tracker {
	cfg := Config{}
	if len(configs) > 0 {
		cfg = configs[0]
	}
	nowFn := cfg.Now
	if nowFn == nil {
		nowFn = func() time.Time { return time.Now().UTC() }
	}
	return &Tracker{
		items:                 make(map[string]item),
		watchers:              make(map[uint64]chan Snapshot),
		now:                   nowFn,
		onDroppedNotification: cfg.OnDroppedNotification,
	}
}

func (t *Tracker) Mark(name string, healthy bool, reason string) error {
	key := strings.TrimSpace(strings.ToLower(name))
	if key == "" {
		return fmt.Errorf("providerhealth.Mark: empty provider name")
	}
	now := t.now()

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
	var watchers []chan Snapshot
	var snapshot Snapshot
	if notify {
		snapshot = Snapshot{
			Name:                key,
			State:               next.state,
			LastReason:          next.lastReason,
			ConsecutiveFailures: next.consecutiveFailures,
			LastChangedAt:       next.lastChangedAt,
			LastCheckedAt:       next.lastCheckedAt,
		}
		watchers = make([]chan Snapshot, 0, len(t.watchers))
		for _, watcher := range t.watchers {
			watchers = append(watchers, watcher)
		}
	}
	t.mu.Unlock()
	if notify {
		t.broadcast(snapshot, watchers)
	}
	return nil
}

func (t *Tracker) SnapshotOf(name string) Snapshot {
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
	return t.SnapshotOf(name).State == StateHealthy
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
	if t.nextWatchID == ^uint64(0) {
		t.mu.Unlock()
		panic("providerhealth.Subscribe: watcher id overflow")
	}
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

func (t *Tracker) WatcherCount() int {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return len(t.watchers)
}

func (t *Tracker) DroppedNotifications() uint64 {
	return t.droppedNotificationCount.Load()
}

func (t *Tracker) broadcast(snapshot Snapshot, watchers []chan Snapshot) {
	for _, ch := range watchers {
		select {
		case ch <- snapshot:
			continue
		default:
		}
		select {
		case <-ch:
		default:
		}
		t.droppedNotificationCount.Add(1)
		if t.onDroppedNotification != nil {
			t.onDroppedNotification(snapshot)
		}
		select {
		case ch <- snapshot:
		default:
		}
	}
}
