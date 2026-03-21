package scheduler

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"
)

const (
	DefaultGlobalConcurrency = 8
	DefaultPerAppConcurrency = 2
)

// Config defines runtime queue limits.
type Config struct {
	GlobalConcurrency int
	PerAppConcurrency int
	// Zero disables starvation reporting.
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
	perApp              map[string]*appSemaphore
	perSize             int
	starvationThreshold time.Duration
}

type appSemaphore struct {
	sem  chan struct{}
	refs int
}

func New(cfg Config) *Scheduler {
	global := cfg.GlobalConcurrency
	if global <= 0 {
		global = DefaultGlobalConcurrency
	}
	perApp := cfg.PerAppConcurrency
	if perApp <= 0 {
		perApp = DefaultPerAppConcurrency
	}
	return &Scheduler{
		global:              make(chan struct{}, global),
		perApp:              make(map[string]*appSemaphore),
		perSize:             perApp,
		starvationThreshold: cfg.StarvationThreshold,
	}
}

func normalizeAppID(appID string) string {
	appID = strings.TrimSpace(appID)
	if appID == "" {
		appID = "_default"
	}
	return appID
}

func (s *Scheduler) perAppSemaphore(appID string) (string, *appSemaphore) {
	appID = normalizeAppID(appID)
	s.mu.Lock()
	defer s.mu.Unlock()
	sem, ok := s.perApp[appID]
	if ok {
		sem.refs++
		return appID, sem
	}
	sem = &appSemaphore{
		sem:  make(chan struct{}, s.perSize),
		refs: 1,
	}
	s.perApp[appID] = sem
	return appID, sem
}

func (s *Scheduler) releaseAppReference(appID string, sem *appSemaphore) {
	if sem == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	current, ok := s.perApp[appID]
	if !ok || current != sem {
		return
	}
	if current.refs > 0 {
		current.refs--
	}
	if current.refs == 0 && len(current.sem) == 0 {
		delete(s.perApp, appID)
	}
}

func (s *Scheduler) Acquire(ctx context.Context, appID string) (func(), AcquireResult, error) {
	started := time.Now()
	appKey, perApp := s.perAppSemaphore(appID)

	select {
	case s.global <- struct{}{}:
	case <-ctx.Done():
		s.releaseAppReference(appKey, perApp)
		return nil, AcquireResult{}, fmt.Errorf("scheduler acquire: %w", ctx.Err())
	}
	select {
	case perApp.sem <- struct{}{}:
	case <-ctx.Done():
		<-s.global
		s.releaseAppReference(appKey, perApp)
		return nil, AcquireResult{}, fmt.Errorf("scheduler acquire: %w", ctx.Err())
	}

	var once sync.Once
	release := func() {
		once.Do(func() {
			<-perApp.sem
			<-s.global
			s.releaseAppReference(appKey, perApp)
		})
	}
	waited := time.Since(started)
	return release, AcquireResult{
		Waited:  waited,
		Starved: s.starvationThreshold > 0 && waited >= s.starvationThreshold,
	}, nil
}
