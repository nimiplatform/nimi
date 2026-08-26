package realtimecore

import (
	"errors"
	"strings"
	"sync"
	"time"
)

var (
	ErrInvalidConfig   = errors.New("realtime stream configuration is invalid")
	ErrClosed          = errors.New("realtime stream is closed")
	ErrReaderConflict  = errors.New("realtime stream already has an active reader")
	ErrStaleGeneration = errors.New("realtime stream generation is stale")
	ErrSlowConsumer    = errors.New("realtime stream consumer is too slow")
)

type Lifecycle uint8

const (
	LifecycleOpening Lifecycle = iota + 1
	LifecycleReady
	LifecycleDegraded
	LifecycleReconnecting
	LifecycleClosed
	LifecycleFailed
)

type Backpressure uint8

const (
	BackpressureNormal Backpressure = iota + 1
	BackpressurePressured
	BackpressureBlocked
)

type TerminalReason string

const (
	TerminalNone            TerminalReason = ""
	TerminalCancelled       TerminalReason = "cancelled"
	TerminalSlowConsumer    TerminalReason = "slow_consumer"
	TerminalStaleGeneration TerminalReason = "stale_generation"
	TerminalRuntimeShutdown TerminalReason = "runtime_shutdown"
	TerminalOwnerFailed     TerminalReason = "owner_failed"
)

type Config struct {
	RealtimeSessionID string
	ChannelID         string
	SubscriptionID    string
	AdapterKind       string
	Generation        uint64
	Capacity          int
	PressureAt        int
}

type Snapshot struct {
	Config
	Lifecycle      Lifecycle
	Backpressure   Backpressure
	BufferedItems  int
	TerminalReason TerminalReason
	UpdatedAt      time.Time
}

type PublishResult struct {
	Backpressure  Backpressure
	BufferedItems int
}

// @nimi-authority: rule.nimi.runtime.rpc-foundations.r021
// @nimi-authority: rule.nimi.runtime.rpc-foundations.r022
// Stream is a bounded, single-reader carrier for one owner-typed channel. It
// never interprets or persists T and releases the queue on terminal cleanup.
type Stream[T any] struct {
	mu              sync.Mutex
	config          Config
	queue           chan T
	lifecycle       Lifecycle
	terminal        TerminalReason
	readerActive    bool
	updatedAt       time.Time
	terminalPending bool
	closed          bool
}

func NewStream[T any](config Config) (*Stream[T], error) {
	config.RealtimeSessionID = strings.TrimSpace(config.RealtimeSessionID)
	config.ChannelID = strings.TrimSpace(config.ChannelID)
	config.SubscriptionID = strings.TrimSpace(config.SubscriptionID)
	config.AdapterKind = strings.TrimSpace(config.AdapterKind)
	if config.RealtimeSessionID == "" || config.ChannelID == "" || config.AdapterKind == "" || config.Generation == 0 || config.Capacity <= 0 {
		return nil, ErrInvalidConfig
	}
	if config.PressureAt <= 0 || config.PressureAt >= config.Capacity {
		config.PressureAt = max(1, config.Capacity*3/4)
	}
	now := time.Now().UTC()
	return &Stream[T]{
		config:    config,
		queue:     make(chan T, config.Capacity),
		lifecycle: LifecycleOpening,
		updatedAt: now,
	}, nil
}

func (s *Stream[T]) Publish(generation uint64, value T) (PublishResult, error) {
	if s == nil {
		return PublishResult{}, ErrClosed
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if generation != s.config.Generation {
		return PublishResult{}, ErrStaleGeneration
	}
	if s.closed {
		return PublishResult{}, ErrClosed
	}
	if s.terminalPending {
		return PublishResult{Backpressure: BackpressureBlocked, BufferedItems: len(s.queue)}, ErrSlowConsumer
	}
	select {
	case s.queue <- value:
		s.updatedAt = time.Now().UTC()
		buffered := len(s.queue)
		pressure := BackpressureNormal
		if buffered >= s.config.PressureAt {
			pressure = BackpressurePressured
		}
		return PublishResult{Backpressure: pressure, BufferedItems: buffered}, nil
	default:
		s.lifecycle = LifecycleFailed
		s.terminal = TerminalSlowConsumer
		s.updatedAt = time.Now().UTC()
		// Keep the carrier open in a terminal-pending state so the owner adapter
		// can atomically replace queued data with its closed typed terminal. A
		// silent EOF would erase the slow-consumer reason at the public boundary.
		s.terminalPending = true
		return PublishResult{Backpressure: BackpressureBlocked, BufferedItems: len(s.queue)}, ErrSlowConsumer
	}
}

func (s *Stream[T]) ClaimReader() (<-chan T, func(), error) {
	if s == nil {
		return nil, func() {}, ErrClosed
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.readerActive {
		return nil, func() {}, ErrReaderConflict
	}
	s.readerActive = true
	released := false
	release := func() {
		s.mu.Lock()
		if !released {
			released = true
			s.readerActive = false
			s.updatedAt = time.Now().UTC()
		}
		s.mu.Unlock()
	}
	return s.queue, release, nil
}

func (s *Stream[T]) Transition(generation uint64, lifecycle Lifecycle) error {
	if s == nil {
		return ErrClosed
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if generation != s.config.Generation {
		return ErrStaleGeneration
	}
	if s.closed {
		return ErrClosed
	}
	if lifecycle == LifecycleClosed || lifecycle == LifecycleFailed || lifecycle == 0 {
		return ErrInvalidConfig
	}
	s.lifecycle = lifecycle
	s.updatedAt = time.Now().UTC()
	return nil
}

func (s *Stream[T]) Close(generation uint64, reason TerminalReason) error {
	if s == nil {
		return ErrClosed
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if generation != s.config.Generation {
		return ErrStaleGeneration
	}
	if s.closed {
		return nil
	}
	if reason == TerminalNone {
		reason = TerminalCancelled
	}
	s.terminal = reason
	if reason == TerminalCancelled || reason == TerminalRuntimeShutdown {
		s.lifecycle = LifecycleClosed
	} else {
		s.lifecycle = LifecycleFailed
	}
	s.updatedAt = time.Now().UTC()
	s.terminalPending = false
	s.closed = true
	s.drainAndCloseLocked()
	return nil
}

// PublishTerminal releases every queued owner data item, retains exactly one
// caller-supplied typed terminal projection, and closes delivery. Adapters use
// this only for their closed terminal variant; Core never interprets T.
func (s *Stream[T]) PublishTerminal(generation uint64, value T, reason TerminalReason) error {
	if s == nil {
		return ErrClosed
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if generation != s.config.Generation {
		return ErrStaleGeneration
	}
	if s.closed {
		return nil
	}
	if reason == TerminalNone {
		reason = TerminalCancelled
	}
	for {
		select {
		case <-s.queue:
			continue
		default:
			s.queue <- value
			close(s.queue)
			s.terminal = reason
			s.terminalPending = false
			if reason == TerminalCancelled || reason == TerminalRuntimeShutdown {
				s.lifecycle = LifecycleClosed
			} else {
				s.lifecycle = LifecycleFailed
			}
			s.updatedAt = time.Now().UTC()
			s.closed = true
			return nil
		}
	}
}

func (s *Stream[T]) drainAndCloseLocked() {
	for {
		select {
		case <-s.queue:
			continue
		default:
			close(s.queue)
			return
		}
	}
}

func (s *Stream[T]) Snapshot() Snapshot {
	if s == nil {
		return Snapshot{}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	pressure := BackpressureNormal
	buffered := len(s.queue)
	if s.closed && s.terminal == TerminalSlowConsumer {
		pressure = BackpressureBlocked
	} else if buffered >= s.config.PressureAt {
		pressure = BackpressurePressured
	}
	return Snapshot{
		Config:         s.config,
		Lifecycle:      s.lifecycle,
		Backpressure:   pressure,
		BufferedItems:  buffered,
		TerminalReason: s.terminal,
		UpdatedAt:      s.updatedAt,
	}
}
