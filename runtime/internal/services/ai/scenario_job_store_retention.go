package ai

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	// Quarantine evidence expires with the same period as terminal Job
	// retention; isolated rows serve no owner recovery purpose.
	scenarioJobIsolationRetention = scenarioJobRetention
	// A retention sweep every half minute removes an expired Job, and the
	// captured inputs its superseded history still holds, within a minute.
	scenarioJobMaintenanceInterval = 30 * time.Second
)

// RunScenarioJobRetentionLoop enforces ScenarioJob retention while Runtime
// runs, independent of Job traffic.
// @nimi-authority: rule.nimi.runtime.service-operations.scenario-job-retention
func (s *Service) RunScenarioJobRetentionLoop(ctx context.Context) {
	if s == nil || s.scenarioJobs == nil {
		return
	}
	ticker := time.NewTicker(scenarioJobMaintenanceInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			if err := s.scenarioJobs.maintainDurableState(now.UTC()); err != nil {
				s.logScenarioJobPersistenceFailure("ScenarioJob retention maintenance remains pending", "error", err)
			}
		}
	}
}

// maintainDurableState prunes expired Jobs, rewrites the store when removed
// captured inputs are still on disk, and deletes expired isolation copies. A
// failed step stays pending for the next sweep.
func (s *scenarioJobStore) maintainDurableState(now time.Time) error {
	if s == nil || strings.TrimSpace(s.durablePath) == "" {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pruneLocked(now)
	var errs []error
	// An empty store that was never written stays unwritten; the first healthy
	// Job write materializes it.
	if s.durable.current || len(s.jobs) > 0 || len(s.idempotency) > 0 || len(s.pendingCloudCustody) > 0 {
		if err := s.persistDurableJobsLocked(scenarioJobPersistenceAttempt{Operation: scenarioJobPersistMaintenance}); err != nil {
			errs = append(errs, fmt.Errorf("persist ScenarioJob retention: %w", err))
		}
	}
	if err := s.sweepExpiredDurableCopiesLocked(now); err != nil {
		errs = append(errs, err)
	}
	return errors.Join(errs...)
}

// sweepExpiredDurableCopies runs the isolation sweep once at startup, after
// load has written any new evidence.
func (s *scenarioJobStore) sweepExpiredDurableCopies(now time.Time) error {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.sweepExpiredDurableCopiesLocked(now)
}

// sweepExpiredDurableCopiesLocked deletes interrupted temporary writes and
// quarantine copies whose isolation has expired. Every store write happens
// under the store lock, so no temporary file belongs to a live writer.
// @nimi-authority: rule.nimi.runtime.service-operations.scenario-job-isolation-evidence
func (s *scenarioJobStore) sweepExpiredDurableCopiesLocked(now time.Time) error {
	if strings.TrimSpace(s.durablePath) == "" {
		return nil
	}
	root := filepath.Dir(s.durablePath)
	quarantine := filepath.Join(root, scenarioJobIsolationQuarantineDirName)
	var errs []error
	for _, directory := range []string{root, quarantine} {
		temporary, err := filepath.Glob(filepath.Join(directory, ".scenario-jobs-*.tmp"))
		if err != nil {
			errs = append(errs, err)
			continue
		}
		for _, path := range temporary {
			if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
				errs = append(errs, fmt.Errorf("remove interrupted ScenarioJob store write: %w", err))
			}
		}
	}
	entries, err := os.ReadDir(quarantine)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		errs = append(errs, fmt.Errorf("list ScenarioJob quarantine: %w", err))
	}
	for _, entry := range entries {
		isolatedAt, ok := scenarioJobQuarantineIsolatedAt(entry.Name())
		if !ok || entry.IsDir() || now.Before(isolatedAt.Add(scenarioJobIsolationRetention)) {
			continue
		}
		if err := os.Remove(filepath.Join(quarantine, entry.Name())); err != nil && !errors.Is(err, os.ErrNotExist) {
			errs = append(errs, fmt.Errorf("remove expired ScenarioJob quarantine copy: %w", err))
		}
	}
	return errors.Join(errs...)
}

// scenarioJobQuarantineIsolatedAt reads the isolation instant this store
// writes into every quarantine copy name: <store>.<unix-nanos>.<level>.json.
// Names it did not write are left alone.
func scenarioJobQuarantineIsolatedAt(name string) (time.Time, bool) {
	rest, ok := strings.CutPrefix(name, scenarioJobDiskStoreFileName+".")
	if !ok {
		return time.Time{}, false
	}
	nanos, level, ok := strings.Cut(rest, ".")
	if !ok || (level != scenarioJobQuarantineRecordsLevel+".json" && level != scenarioJobIsolationLevelDocument+".json") {
		return time.Time{}, false
	}
	value, err := strconv.ParseInt(nanos, 10, 64)
	if err != nil || value <= 0 {
		return time.Time{}, false
	}
	return time.Unix(0, value).UTC(), true
}
