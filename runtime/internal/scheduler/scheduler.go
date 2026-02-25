package scheduler

import (
	"context"
	"strings"
	"sync"
	"time"
)

// Config defines runtime queue limits.
type Config struct {
	GlobalConcurrency   int
	PerAppConcurrency   int
	StarvationThreshold time.Duration
}

// AcquireResult reports scheduling wait details.
type AcquireResult struct {
	Waited  time.Duration
	Starved bool
}

// Scheduler enforces global and per-app concurrency limits.
type Scheduler struct {
	global chan struct{}

	mu                  sync.Mutex
	perApp              map[string]chan struct{}
	perSize             int
	starvationThreshold time.Duration
}

func New(cfg Config) *Scheduler {
	global := cfg.GlobalConcurrency
	if global <= 0 {
		global = 8
	}
	perApp := cfg.PerAppConcurrency
	if perApp <= 0 {
		perApp = 2
	}
	return &Scheduler{
		global:              make(chan struct{}, global),
		perApp:              make(map[string]chan struct{}),
		perSize:             perApp,
		starvationThreshold: cfg.StarvationThreshold,
	}
}

func (s *Scheduler) perAppSemaphore(appID string) chan struct{} {
	appID = strings.TrimSpace(appID)
	if appID == "" {
		appID = "_default"
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	sem, ok := s.perApp[appID]
	if ok {
		return sem
	}
	sem = make(chan struct{}, s.perSize)
	s.perApp[appID] = sem
	return sem
}

func (s *Scheduler) Acquire(ctx context.Context, appID string) (func(), AcquireResult, error) {
	started := time.Now()
	perApp := s.perAppSemaphore(appID)

	select {
	case s.global <- struct{}{}:
	case <-ctx.Done():
		return nil, AcquireResult{}, ctx.Err()
	}
	select {
	case perApp <- struct{}{}:
	case <-ctx.Done():
		<-s.global
		return nil, AcquireResult{}, ctx.Err()
	}

	released := false
	release := func() {
		if released {
			return
		}
		released = true
		<-perApp
		<-s.global
	}
	waited := time.Since(started)
	return release, AcquireResult{
		Waited:  waited,
		Starved: s.starvationThreshold > 0 && waited >= s.starvationThreshold,
	}, nil
}
