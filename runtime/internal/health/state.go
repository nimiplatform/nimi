package health

import (
	"sync"
	"time"
)

// Status mirrors RuntimeHealthStatus in proto/runtime/v1/audit.proto.
type Status int32

const (
	StatusUnspecified Status = 0
	StatusStopped     Status = 1
	StatusStarting    Status = 2
	StatusReady       Status = 3
	StatusDegraded    Status = 4
	StatusStopping    Status = 5
)

func (s Status) String() string {
	switch s {
	case StatusStopped:
		return "RUNTIME_HEALTH_STATUS_STOPPED"
	case StatusStarting:
		return "RUNTIME_HEALTH_STATUS_STARTING"
	case StatusReady:
		return "RUNTIME_HEALTH_STATUS_READY"
	case StatusDegraded:
		return "RUNTIME_HEALTH_STATUS_DEGRADED"
	case StatusStopping:
		return "RUNTIME_HEALTH_STATUS_STOPPING"
	default:
		return "RUNTIME_HEALTH_STATUS_UNSPECIFIED"
	}
}

func (s Status) Ready() bool {
	return s == StatusReady
}

// Snapshot is a direct runtime projection of GetRuntimeHealthResponse.
type Snapshot struct {
	Status              Status
	Reason              string
	QueueDepth          int32
	ActiveWorkflows     int32
	ActiveInferenceJobs int32
	CPUMilli            int64
	MemoryBytes         int64
	VRAMBytes           int64
	SampledAt           time.Time
}

// State holds the mutable runtime health state.
type State struct {
	mu       sync.RWMutex
	snapshot Snapshot
	nextID   uint64
	watchers map[uint64]chan Snapshot
}

func NewState() *State {
	now := time.Now().UTC()
	return &State{snapshot: Snapshot{
		Status:    StatusStopped,
		Reason:    "not started",
		SampledAt: now,
	}, watchers: make(map[uint64]chan Snapshot)}
}

func (s *State) Snapshot() Snapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.snapshot
}

func (s *State) SetStatus(status Status, reason string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.snapshot.Status = status
	s.snapshot.Reason = reason
	s.snapshot.SampledAt = time.Now().UTC()
	s.broadcastLocked()
}

func (s *State) SetActivity(queueDepth int32, activeWorkflows int32, activeInferenceJobs int32) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.snapshot.QueueDepth = queueDepth
	s.snapshot.ActiveWorkflows = activeWorkflows
	s.snapshot.ActiveInferenceJobs = activeInferenceJobs
	s.snapshot.SampledAt = time.Now().UTC()
	s.broadcastLocked()
}

func (s *State) SetResource(cpuMilli int64, memoryBytes int64, vramBytes int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.snapshot.CPUMilli = cpuMilli
	s.snapshot.MemoryBytes = memoryBytes
	s.snapshot.VRAMBytes = vramBytes
	s.snapshot.SampledAt = time.Now().UTC()
	s.broadcastLocked()
}

// Subscribe returns a channel that receives health updates.
// The returned cancel function MUST be called by consumers when done.
func (s *State) Subscribe(buffer int) (<-chan Snapshot, func()) {
	if buffer < 1 {
		buffer = 1
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	s.nextID++
	id := s.nextID
	ch := make(chan Snapshot, buffer)
	s.watchers[id] = ch

	// Always emit current snapshot as initial state.
	ch <- s.snapshot

	cancel := func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		watcher, exists := s.watchers[id]
		if !exists {
			return
		}
		delete(s.watchers, id)
		close(watcher)
	}

	return ch, cancel
}

func (s *State) broadcastLocked() {
	for _, ch := range s.watchers {
		// Keep only latest snapshot under pressure.
		select {
		case ch <- s.snapshot:
			continue
		default:
		}

		select {
		case <-ch:
		default:
		}

		select {
		case ch <- s.snapshot:
		default:
		}
	}
}
