package streamutil

import (
	"context"
	"errors"
	"io"
	"sync"
)

var errRelayOverflow = errors.New("streamutil: relay overflow")

type RelayOptions[T any] struct {
	Budget              int
	MaxConsecutiveDrops int
	CloseErr            error
	IsTerminal          func(T) bool
}

// Relay provides a bounded queue with deterministic slow-consumer closure.
type Relay[T any] struct {
	mu                  sync.Mutex
	queue               []T
	budget              int
	maxConsecutiveDrops int
	overflowErr         error
	resultErr           error
	isTerminal          func(T) bool
	consecutiveDrops    int
	pendingClose        bool
	closed              bool
	notify              chan struct{}
}

func NewRelay[T any](opts RelayOptions[T]) *Relay[T] {
	budget := opts.Budget
	if budget < 1 {
		budget = 1
	}
	maxDrops := opts.MaxConsecutiveDrops
	if maxDrops < 1 {
		maxDrops = 1
	}
	overflowErr := opts.CloseErr
	if overflowErr == nil {
		overflowErr = errRelayOverflow
	}
	return &Relay[T]{
		queue:               make([]T, 0, budget),
		budget:              budget,
		maxConsecutiveDrops: maxDrops,
		overflowErr:         overflowErr,
		isTerminal:          opts.IsTerminal,
		notify:              make(chan struct{}, 1),
	}
}

func (r *Relay[T]) Enqueue(item T) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.closed {
		return r.resultErr
	}

	if len(r.queue) < r.budget {
		r.queue = append(r.queue, item)
		r.consecutiveDrops = 0
		if r.pendingClose && r.isTerminal != nil && r.isTerminal(item) {
			r.closed = true
			r.resultErr = r.overflowErr
		}
		r.signalLocked()
		return nil
	}

	isTerminal := r.isTerminal != nil && r.isTerminal(item)
	r.consecutiveDrops++
	if isTerminal {
		if idx := r.firstDroppableLocked(); idx >= 0 {
			r.replaceDroppedLocked(idx, item)
		} else {
			r.closed = true
			r.resultErr = r.overflowErr
			r.signalLocked()
			return r.resultErr
		}
	} else {
		r.dropHeadAndAppendLocked(item)
	}

	r.signalLocked()
	if r.consecutiveDrops >= r.maxConsecutiveDrops {
		if r.isTerminal != nil && !isTerminal {
			r.pendingClose = true
			return nil
		}
		r.closed = true
		r.resultErr = r.overflowErr
		return r.resultErr
	}
	if r.pendingClose && isTerminal {
		r.closed = true
		r.resultErr = r.overflowErr
		return r.resultErr
	}
	return nil
}

// Close requests a clean shutdown; Run() returns nil after draining queued items.
func (r *Relay[T]) Close() {
	r.mu.Lock()
	r.pendingClose = false
	r.closed = true
	r.signalLocked()
	r.mu.Unlock()
}

func (r *Relay[T]) Run(ctx context.Context, send func(T) error) error {
	for {
		item, err := r.next(ctx)
		if err != nil {
			if errors.Is(err, io.EOF) {
				return nil
			}
			return err
		}
		if err := send(item); err != nil {
			return err
		}
	}
}

func (r *Relay[T]) next(ctx context.Context) (T, error) {
	var zero T
	for {
		r.mu.Lock()
		if len(r.queue) > 0 {
			item := r.dequeueLocked()
			r.mu.Unlock()
			return item, nil
		}
		if r.closed {
			err := r.resultErr
			r.mu.Unlock()
			if err == nil {
				return zero, io.EOF
			}
			return zero, err
		}
		notify := r.notify
		r.mu.Unlock()

		select {
		case <-ctx.Done():
			// Cancellation maps to EOF so stream owners can treat client disconnects as clean shutdowns.
			// Deadlines still propagate as errors because they indicate an unexpected timeout.
			if errors.Is(ctx.Err(), context.Canceled) {
				return zero, io.EOF
			}
			return zero, ctx.Err()
		case <-notify:
		}
	}
}

func (r *Relay[T]) dequeueLocked() T {
	item := r.queue[0]
	r.shiftLeftFromLocked(0)
	if len(r.queue) < r.budget {
		r.pendingClose = false
	}
	return item
}

func (r *Relay[T]) dropHeadAndAppendLocked(item T) {
	r.shiftLeftFromLocked(0)
	r.queue = append(r.queue, item)
}

func (r *Relay[T]) replaceDroppedLocked(idx int, item T) {
	r.shiftLeftFromLocked(idx)
	r.queue = append(r.queue, item)
}

func (r *Relay[T]) shiftLeftFromLocked(idx int) {
	last := len(r.queue) - 1
	copy(r.queue[idx:], r.queue[idx+1:])
	var zero T
	r.queue[last] = zero
	r.queue = r.queue[:last]
}

func (r *Relay[T]) firstDroppableLocked() int {
	if r.isTerminal == nil {
		return 0
	}
	for idx, item := range r.queue {
		if !r.isTerminal(item) {
			return idx
		}
	}
	return -1
}

func (r *Relay[T]) signalLocked() {
	select {
	case r.notify <- struct{}{}:
	default:
	}
}
