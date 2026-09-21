package ai

import (
	"errors"
	"fmt"
	"sync"
	"time"

	runtimeartifact "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	musicRecoveryRetention            = 24 * time.Hour
	maxMusicRecoveryJobs              = 1024
	maxMusicRecoveryBytes       int64 = 16 << 30
	maxMusicRecoveryOutputBytes int64 = 512 << 20
)

var errMusicRecoveryCapacity = errors.New("music recovery capacity exceeded")
var errMusicRecoveryExpired = errors.New("music recovery expired")

func musicRecoveryExpired(record *scenarioJobRecord, now time.Time) bool {
	return record != nil && record.musicSubmission != nil && !record.terminalAt.IsZero() && !now.Before(record.terminalAt.Add(musicRecoveryRetention))
}

func projectMusicRecoveryExpiry(record *scenarioJobRecord) {
	if record == nil || record.job == nil {
		return
	}
	record.job.RecoveryExpiresAt = nil
	if record.musicSubmission != nil && !record.terminalAt.IsZero() {
		record.job.RecoveryExpiresAt = timestamppb.New(record.terminalAt.Add(musicRecoveryRetention))
	}
}

// Caller holds the Job mutex. Resident bodies are measured from the existing
// custody metadata and physical file sizes; only their unproduced remainder is
// reserved. Imported and adopted copies remain charged until physically gone.
// @nimi-authority: rule.nimi.runtime.ai-provider.music-recovery
func (s *scenarioJobStore) admitMusicRecoveryLocked(extraBytes int64, jobSlot bool) error {
	if s.musicArtifacts == nil {
		return fmt.Errorf("music recovery custody is unavailable")
	}
	now := time.Now().UTC()
	s.pruneJobsLocked(now)
	resident, freeBytes, err := s.musicArtifacts.MusicRecoverySnapshot(now)
	if err != nil {
		return fmt.Errorf("account music recovery bodies: %w", err)
	}
	var used, headroom int64
	byJob := map[string]int64{}
	charge := func(value int64) bool {
		if value < 0 || value > maxMusicRecoveryBytes-used {
			return false
		}
		used += value
		return true
	}
	for _, record := range resident {
		if !charge(record.SizeBytes) {
			return errMusicRecoveryCapacity
		}
		if record.ProducerJobID != "" {
			byJob[record.ProducerJobID] += record.SizeBytes
		}
	}
	count := 0
	for id, record := range s.jobs {
		if record == nil || record.musicSubmission == nil {
			continue
		}
		count++
		if isTerminalScenarioJobStatus(record.job.GetStatus()) && !record.executionStarted && len(record.musicOutputReservations) == 0 {
			continue
		}
		remaining := max(int64(0), record.musicSubmission.ReservedBytes-byJob[id])
		if !charge(remaining) {
			return errMusicRecoveryCapacity
		}
		headroom += 2 * record.musicSubmission.ReservedBytes
	}
	if jobSlot && count >= maxMusicRecoveryJobs {
		return errMusicRecoveryCapacity
	}
	for id, bound := range s.musicPreparations {
		if !charge(max(int64(0), bound-resident[id].SizeBytes)) {
			return errMusicRecoveryCapacity
		}
		headroom += 3 * bound
	}
	if !charge(extraBytes) {
		return errMusicRecoveryCapacity
	}
	// Covers private output staging plus custody copying; preparation also has
	// its input snapshot. The free-space reading already excludes resident data.
	if jobSlot {
		headroom += 2 * extraBytes
	} else {
		headroom += 3 * extraBytes
	}
	if freeBytes < headroom {
		return errMusicRecoveryCapacity
	}
	return nil
}

func (s *scenarioJobStore) beginMusicPreparation(id string) (func(), error) {
	s.mu.Lock()
	if err := s.admitMusicRecoveryLocked(maxMusicRecoveryOutputBytes, false); err != nil {
		s.mu.Unlock()
		return nil, err
	}
	s.musicPreparations[id] = maxMusicRecoveryOutputBytes
	s.mu.Unlock()
	var once sync.Once
	return func() { once.Do(func() { s.mu.Lock(); delete(s.musicPreparations, id); s.mu.Unlock() }) }, nil
}

func (s *scenarioJobStore) setMusicArtifactStore(store runtimeartifact.Store) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.musicArtifacts, _ = store.(runtimeartifact.MusicRecoveryStore)
}

func (s *scenarioJobStore) musicArtifactAdmission(jobID string, artifactID string, size int64) (time.Time, func(), error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	record := s.jobs[jobID]
	if record == nil || record.musicSubmission == nil {
		return time.Time{}, func() {}, nil
	}
	if isTerminalScenarioJobStatus(record.job.GetStatus()) || record.cancelRequested {
		return time.Time{}, nil, errMusicRecoveryExpired
	}
	if size <= 0 || size > record.musicSubmission.ReservedBytes {
		return time.Time{}, nil, errMusicRecoveryCapacity
	}
	if s.musicArtifacts == nil {
		return time.Time{}, nil, fmt.Errorf("music recovery custody is unavailable")
	}
	resident, _, err := s.musicArtifacts.MusicRecoverySnapshot(time.Now())
	if err != nil {
		return time.Time{}, nil, err
	}
	var other int64
	for id, item := range resident {
		if item.ProducerJobID == jobID && id != artifactID {
			other += item.SizeBytes
		}
	}
	for id, bound := range record.musicOutputReservations {
		if id == artifactID {
			return time.Time{}, nil, fmt.Errorf("music output is already being committed")
		}
		other += max(int64(0), bound-resident[id].SizeBytes)
	}
	if other > record.musicSubmission.ReservedBytes-size {
		return time.Time{}, nil, errMusicRecoveryCapacity
	}
	if record.musicOutputReservations == nil {
		record.musicOutputReservations = map[string]int64{}
	}
	record.musicOutputReservations[artifactID] = size
	var once sync.Once
	release := func() {
		once.Do(func() { s.mu.Lock(); delete(record.musicOutputReservations, artifactID); s.mu.Unlock() })
	}
	return time.Now().UTC().Add(musicRecoveryRetention), release, nil
}

// Extending metadata precedes terminal Job publication. Partial extension on
// a failed disk write cannot fabricate completion and never shortens a body.
func (s *scenarioJobStore) retainTerminalMusicLocked(record *scenarioJobRecord) error {
	projectMusicRecoveryExpiry(record)
	if record.musicSubmission == nil || record.terminalAt.IsZero() || len(record.job.GetArtifacts()) == 0 {
		return nil
	}
	if s.musicArtifacts == nil {
		return fmt.Errorf("music recovery custody is unavailable")
	}
	ids := make([]string, 0, len(record.job.GetArtifacts()))
	for _, artifact := range record.job.GetArtifacts() {
		ids = append(ids, artifact.GetArtifactId())
	}
	return s.musicArtifacts.ExtendMusicRecovery(record.job.GetJobId(), ids, record.terminalAt.Add(musicRecoveryRetention))
}
