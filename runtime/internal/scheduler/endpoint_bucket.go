package scheduler

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// Priority defines execution priority within a physical inference endpoint bucket.
// @nimi-authority: rule.nimi.runtime.agent-participation.endpoint-bucketed-scheduler
type Priority uint8

const (
	// PriorityP0Foreground covers foreground chat, voice, and active foreground Harness turns.
	PriorityP0Foreground Priority = 0
	// PriorityP1Interactive covers ordinary interactive multi-session turns.
	PriorityP1Interactive Priority = 1
	// PriorityP2Background covers compaction, background LLM alarms, and proactive life turns.
	PriorityP2Background Priority = 2

	defaultLocalEndpointConcurrency = 1
	defaultCloudEndpointConcurrency = 4
)

// ExecutionAdmission carries caller-declared endpoint priority and cooperative
// preemption callback down into the single physical AI scheduler owner so
// outer layers never double-acquire the same endpoint bucket.
type ExecutionAdmission struct {
	Priority Priority
	Preempt  func()
}

type executionAdmissionContextKey struct{}

// WithExecutionAdmission attaches priority and optional cooperative preemption
// callback to ctx for consumption by AI endpoint admission.
func WithExecutionAdmission(ctx context.Context, priority Priority, preempt func()) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	return context.WithValue(ctx, executionAdmissionContextKey{}, ExecutionAdmission{
		Priority: priority,
		Preempt:  preempt,
	})
}

// ExecutionAdmissionFromContext returns any execution admission metadata
// attached to ctx, or (default P0, false) when unset.
func ExecutionAdmissionFromContext(ctx context.Context) (ExecutionAdmission, bool) {
	if ctx == nil {
		return ExecutionAdmission{Priority: PriorityP0Foreground}, false
	}
	if admission, ok := ctx.Value(executionAdmissionContextKey{}).(ExecutionAdmission); ok {
		return admission, true
	}
	return ExecutionAdmission{Priority: PriorityP0Foreground}, false
}

type endpointHolder struct {
	id        uint64
	priority  Priority
	preempt   func()
	preempted bool
}

type endpointWaiter struct {
	seq      uint64
	priority Priority
	preempt  func()
	granted  chan *endpointHolder
}

type endpointBucket struct {
	mu      sync.Mutex
	cap     int
	holders []*endpointHolder
	waiters []*endpointWaiter
	nextSeq uint64
}

func normalizeEndpointKey(endpointKey string) string {
	key := strings.TrimSpace(endpointKey)
	if key == "" {
		return "local:default"
	}
	return key
}

func defaultEndpointCapacity(endpointKey string) int {
	if strings.HasPrefix(endpointKey, "cloud:") {
		return defaultCloudEndpointConcurrency
	}
	return defaultLocalEndpointConcurrency
}

// SetEndpointCapacity configures the physical slot cap for an endpoint bucket
// (e.g. "local:<loadout_id>" or "cloud:<connector_id>").
func (s *Scheduler) SetEndpointCapacity(endpointKey string, capacity int) {
	if capacity <= 0 {
		return
	}
	key := normalizeEndpointKey(endpointKey)
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.endpointCaps == nil {
		s.endpointCaps = make(map[string]int)
	}
	s.endpointCaps[key] = capacity
	if bucket := s.endpoints[key]; bucket != nil {
		bucket.mu.Lock()
		bucket.cap = capacity
		bucket.dispatchLocked()
		bucket.mu.Unlock()
	}
}

func (s *Scheduler) endpointBucketFor(endpointKey string) (string, *endpointBucket) {
	key := normalizeEndpointKey(endpointKey)
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.endpoints == nil {
		s.endpoints = make(map[string]*endpointBucket)
	}
	if bucket, ok := s.endpoints[key]; ok {
		return key, bucket
	}
	capacity := defaultEndpointCapacity(key)
	if configured, ok := s.endpointCaps[key]; ok && configured > 0 {
		capacity = configured
	}
	bucket := &endpointBucket{cap: capacity}
	s.endpoints[key] = bucket
	return key, bucket
}

func (b *endpointBucket) canGrantLocked(priority Priority) bool {
	used := len(b.holders)
	if used >= b.cap {
		return false
	}
	// When cap >= 2, reserve 1 slot exclusively for P0 foreground traffic.
	if b.cap >= 2 && priority != PriorityP0Foreground && used >= b.cap-1 {
		return false
	}
	return true
}

func (b *endpointBucket) triggerCooperativePreemptionLocked() []func() {
	if b.cap != 1 || len(b.holders) == 0 {
		return nil
	}
	var toCall []func()
	for _, h := range b.holders {
		if h.priority == PriorityP2Background && h.preempt != nil && !h.preempted {
			h.preempted = true
			toCall = append(toCall, h.preempt)
		}
	}
	return toCall
}

func (b *endpointBucket) dispatchLocked() {
	if len(b.waiters) == 0 {
		return
	}
	sort.SliceStable(b.waiters, func(i, j int) bool {
		if b.waiters[i].priority != b.waiters[j].priority {
			return b.waiters[i].priority < b.waiters[j].priority
		}
		return b.waiters[i].seq < b.waiters[j].seq
	})
	remaining := b.waiters[:0]
	for _, w := range b.waiters {
		if b.canGrantLocked(w.priority) {
			b.nextSeq++
			holder := &endpointHolder{id: b.nextSeq, priority: w.priority, preempt: w.preempt}
			b.holders = append(b.holders, holder)
			w.granted <- holder
			continue
		}
		remaining = append(remaining, w)
	}
	b.waiters = remaining
}

func (b *endpointBucket) hasWaitingPriorityLocked(priority Priority) bool {
	for _, w := range b.waiters {
		if w.priority == priority {
			return true
		}
	}
	return false
}

// EndpointOccupancy reports active and queued counts for a physical endpoint bucket.
type EndpointOccupancy struct {
	EndpointKey string
	Used        int
	Cap         int
	Queued      int
}

// EndpointSnapshot inspects the current state of an endpoint bucket without mutating it.
func (s *Scheduler) EndpointSnapshot(endpointKey string) EndpointOccupancy {
	key, bucket := s.endpointBucketFor(endpointKey)
	bucket.mu.Lock()
	defer bucket.mu.Unlock()
	return EndpointOccupancy{
		EndpointKey: key,
		Used:        len(bucket.holders),
		Cap:         bucket.cap,
		Queued:      len(bucket.waiters),
	}
}

// AcquireForEndpoint reserves an execution slot bucketed strictly by physical
// endpoint (local:<loadout_id> or cloud:<connector_id>) rather than global app ID.
//
// Rules enforced:
//  1. Distinct physical endpoints run independently in parallel.
//  2. On buckets with cap >= 2, one slot is reserved for PriorityP0Foreground.
//  3. On buckets with cap == 1, PriorityP0Foreground cooperatively calls
//     preempt() on an active PriorityP2Background holder and waits for the
//     background stream to actually release its slot (zero dual VRAM occupancy).
//  4. Zero-model deterministic alarms must not call AcquireForEndpoint (0 slots).
func (s *Scheduler) AcquireForEndpoint(
	ctx context.Context,
	endpointKey string,
	priority Priority,
	preempt func(),
) (func(), AcquireResult, error) {
	if err := ctx.Err(); err != nil {
		return nil, AcquireResult{}, fmt.Errorf("scheduler acquire endpoint: %w", err)
	}
	started := time.Now()
	_, bucket := s.endpointBucketFor(endpointKey)

	var holder *endpointHolder
	var waiter *endpointWaiter
	var preemptCallbacks []func()

	bucket.mu.Lock()
	canBypassWaiters := len(bucket.waiters) == 0 ||
		(priority == PriorityP0Foreground && !bucket.hasWaitingPriorityLocked(PriorityP0Foreground))
	if canBypassWaiters && bucket.canGrantLocked(priority) {
		bucket.nextSeq++
		holder = &endpointHolder{
			id:       bucket.nextSeq,
			priority: priority,
			preempt:  preempt,
		}
		bucket.holders = append(bucket.holders, holder)
	} else {
		bucket.nextSeq++
		waiter = &endpointWaiter{
			seq:      bucket.nextSeq,
			priority: priority,
			preempt:  preempt,
			granted:  make(chan *endpointHolder, 1),
		}
		bucket.waiters = append(bucket.waiters, waiter)
		if priority == PriorityP0Foreground {
			preemptCallbacks = bucket.triggerCooperativePreemptionLocked()
		}
	}
	bucket.mu.Unlock()

	for _, fn := range preemptCallbacks {
		fn()
	}

	if waiter != nil {
		select {
		case holder = <-waiter.granted:
			// holder.preempt was installed atomically inside dispatchLocked under bucket.mu.
		case <-ctx.Done():
			bucket.mu.Lock()
			removed := false
			for idx, candidate := range bucket.waiters {
				if candidate == waiter {
					bucket.waiters = append(bucket.waiters[:idx], bucket.waiters[idx+1:]...)
					removed = true
					break
				}
			}
			bucket.mu.Unlock()
			if !removed {
				// Granted raced with ctx.Done; release the granted holder cleanly.
				select {
				case granted := <-waiter.granted:
					s.releaseEndpointHolder(bucket, granted)
				default:
				}
			}
			return nil, AcquireResult{}, fmt.Errorf("scheduler acquire endpoint: %w", ctx.Err())
		}
	}

	s.globalUsed.Add(1)
	var once sync.Once
	var released atomic.Bool
	release := func() {
		once.Do(func() {
			released.Store(true)
			s.globalUsed.Add(-1)
			s.releaseEndpointHolder(bucket, holder)
		})
	}
	if err := ctx.Err(); err != nil {
		release()
		return nil, AcquireResult{}, fmt.Errorf("scheduler acquire endpoint: %w", err)
	}
	waited := time.Since(started)
	return release, AcquireResult{
		Waited:  waited,
		Starved: s.starvationThreshold > 0 && waited >= s.starvationThreshold,
		Occupancy: OccupancySnapshot{
			GlobalUsed: int(s.globalUsed.Load()),
			GlobalCap:  s.globalCap,
		},
	}, nil
}

func (s *Scheduler) releaseEndpointHolder(bucket *endpointBucket, target *endpointHolder) {
	if bucket == nil || target == nil {
		return
	}
	bucket.mu.Lock()
	for idx, candidate := range bucket.holders {
		if candidate == target {
			bucket.holders = append(bucket.holders[:idx], bucket.holders[idx+1:]...)
			break
		}
	}
	bucket.dispatchLocked()
	bucket.mu.Unlock()
}
