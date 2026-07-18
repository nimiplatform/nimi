package main

import (
	"fmt"
	"io"
	"sort"
	"strings"
	"sync"
	"time"
)

type progressReporter struct {
	mu           sync.Mutex
	writer       io.Writer
	startedAt    time.Time
	phase        string
	phaseStarted time.Time
	firstWriteAt time.Time
	item         string
}

func newProgressReporter(writer io.Writer, startedAt time.Time) *progressReporter {
	return &progressReporter{
		writer:       writer,
		startedAt:    startedAt,
		phaseStarted: startedAt,
	}
}

func (p *progressReporter) Phase(phase string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	now := time.Now()
	p.phase = sanitizeProgressValue(phase)
	p.phaseStarted = now
	p.item = ""
	p.writeLocked(now, "status=start")
}

func (p *progressReporter) Item(kind string, item string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	now := time.Now()
	p.item = sanitizeProgressValue(item)
	p.writeLocked(now, fmt.Sprintf("status=running kind=%s", sanitizeProgressValue(kind)))
}

func (p *progressReporter) ItemDone(kind string, item string, elapsed time.Duration, status string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	now := time.Now()
	p.item = sanitizeProgressValue(item)
	p.writeLocked(now, fmt.Sprintf("status=%s kind=%s item_elapsed=%s",
		sanitizeProgressValue(status), sanitizeProgressValue(kind), formatElapsed(elapsed)))
}

func (p *progressReporter) Retry(reason string, packages []string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	now := time.Now()
	sorted := append([]string(nil), packages...)
	sort.Strings(sorted)
	p.writeLocked(now, fmt.Sprintf("status=retry reason=%s packages=%s admission_effect=none",
		sanitizeProgressValue(reason), sanitizeProgressValue(strings.Join(sorted, ","))))
}

func (p *progressReporter) Fail(item string, err error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	now := time.Now()
	p.item = sanitizeProgressValue(item)
	p.writeLocked(now, fmt.Sprintf("status=fail detail=%s", sanitizeProgressValue(err.Error())))
}

func (p *progressReporter) Timeout() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.writeLocked(time.Now(), "status=timeout process_tree_kill=attempted")
}

func (p *progressReporter) Slowest(entries []timingEntry) {
	p.mu.Lock()
	defer p.mu.Unlock()
	now := time.Now()
	limit := len(entries)
	if limit > 10 {
		limit = 10
	}
	for index := 0; index < limit; index++ {
		entry := entries[index]
		p.item = sanitizeProgressValue(entry.Name)
		p.writeLocked(now, fmt.Sprintf("status=slowest rank=%d kind=%s elapsed=%s",
			index+1, sanitizeProgressValue(entry.Kind), formatElapsed(time.Duration(entry.ElapsedSeconds*float64(time.Second)))))
	}
}

func (p *progressReporter) Complete(detail string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.item = ""
	p.writeLocked(time.Now(), "status=complete "+sanitizeProgressValue(detail))
}

func (p *progressReporter) writeLocked(now time.Time, detail string) {
	if p.firstWriteAt.IsZero() {
		p.firstWriteAt = now
	}
	phase := p.phase
	if phase == "" {
		phase = "initializing"
	}
	item := p.item
	if item == "" {
		item = "-"
	}
	_, _ = fmt.Fprintf(p.writer,
		"[runtime-compliance] phase=%s item=%s phase_elapsed=%s total_elapsed=%s %s\n",
		phase,
		item,
		formatElapsed(now.Sub(p.phaseStarted)),
		formatElapsed(now.Sub(p.startedAt)),
		detail,
	)
}

func (p *progressReporter) FirstOutputElapsed() time.Duration {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.firstWriteAt.IsZero() {
		return 0
	}
	return p.firstWriteAt.Sub(p.startedAt)
}

func formatElapsed(elapsed time.Duration) string {
	if elapsed < 0 {
		elapsed = 0
	}
	return elapsed.Round(time.Millisecond).String()
}

func sanitizeProgressValue(value string) string {
	value = strings.TrimSpace(value)
	value = strings.NewReplacer("\r", " ", "\n", " ", "\t", " ").Replace(value)
	return strings.Join(strings.Fields(value), "_")
}
