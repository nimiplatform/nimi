package runtimeartifact

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/appstorage"
)

type MusicRecoveryRecord struct {
	ProducerJobID string
	SizeBytes     int64
	ExpiresAt     time.Time
}

// MusicRecoveryStore uses the existing immutable body/metadata store. It does
// not introduce a quota ledger. Admission combines this actual resident set
// with reservations in the existing Job snapshots.
// @nimi-authority: rule.nimi.runtime.ai-provider.music-recovery
type MusicRecoveryStore interface {
	Store
	MusicRecoverySnapshot(time.Time) (map[string]MusicRecoveryRecord, int64, error)
	ExtendMusicRecovery(jobID string, artifactIDs []string, until time.Time) error
}

func (s *MemoryStore) MusicRecoverySnapshot(now time.Time) (map[string]MusicRecoveryRecord, int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	result := map[string]MusicRecoveryRecord{}
	for id, record := range s.records {
		if record.MusicRecoveryUntil.IsZero() {
			continue
		}
		if !now.Before(record.MusicRecoveryUntil) {
			delete(s.records, id)
			continue
		}
		result[id] = MusicRecoveryRecord{ProducerJobID: record.ProducerJobID, SizeBytes: record.SizeBytes, ExpiresAt: record.MusicRecoveryUntil}
	}
	return result, math.MaxInt64, nil
}

func (s *MemoryStore) ExtendMusicRecovery(jobID string, artifactIDs []string, until time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, id := range artifactIDs {
		record, ok := s.records[id]
		if !ok || record.ProducerJobID != jobID || record.MusicRecoveryUntil.IsZero() || until.Before(record.MusicRecoveryUntil) {
			return ErrInvalidArtifactRecord
		}
	}
	for _, id := range artifactIDs {
		record := s.records[id]
		record.MusicRecoveryUntil = until.UTC()
		s.records[id] = record
	}
	return nil
}

func (s *DiskStore) MusicRecoverySnapshot(now time.Time) (map[string]MusicRecoveryRecord, int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entries, err := os.ReadDir(s.recordsDir)
	if err != nil {
		return nil, 0, fmt.Errorf("inspect music recovery metadata: %w", err)
	}
	result := map[string]MusicRecoveryRecord{}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		record, ok := s.readDiskRecordFileLocked(filepath.Join(s.recordsDir, entry.Name()))
		if !ok {
			return nil, 0, fmt.Errorf("music recovery accounting encountered unreadable metadata")
		}
		if record.MusicRecoveryUntil.IsZero() {
			continue
		}
		key := diskArtifactKey(record.ArtifactID)
		if entry.Name() != key+".json" || record.PayloadFile != key+".bin" {
			return nil, 0, ErrInvalidArtifactRecord
		}
		metadata, ok := artifactMetadataFromDiskRecord(record)
		if !ok {
			return nil, 0, ErrInvalidArtifactRecord
		}
		if !now.Before(metadata.MusicRecoveryUntil) {
			if err := s.deleteDiskRecordByRecordLocked(record); err != nil {
				return nil, 0, fmt.Errorf("expire music recovery body: %w", err)
			}
			continue
		}
		info, err := os.Stat(filepath.Join(s.payloadsDir, record.PayloadFile))
		if err != nil || !info.Mode().IsRegular() || info.Size() != record.SizeBytes {
			return nil, 0, fmt.Errorf("music recovery body no longer matches its committed size")
		}
		result[record.ArtifactID] = MusicRecoveryRecord{ProducerJobID: record.ProducerJobID, SizeBytes: record.SizeBytes, ExpiresAt: record.MusicRecoveryUntil}
	}
	available, err := appstorage.AvailableDiskBytes(s.root)
	if err != nil {
		return nil, 0, fmt.Errorf("inspect music recovery disk headroom: %w", err)
	}
	return result, available, nil
}

func (s *DiskStore) ExtendMusicRecovery(jobID string, artifactIDs []string, until time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	records := make([]diskArtifactRecord, 0, len(artifactIDs))
	for _, id := range artifactIDs {
		record, ok := s.readDiskRecordLocked(id)
		if !ok || record.ProducerJobID != jobID || record.MusicRecoveryUntil.IsZero() || until.Before(record.MusicRecoveryUntil) {
			return ErrInvalidArtifactRecord
		}
		record.MusicRecoveryUntil = until.UTC()
		records = append(records, record)
	}
	for _, record := range records {
		data, err := json.MarshalIndent(record, "", "  ")
		if err != nil {
			return fmt.Errorf("encode music recovery lifetime: %w", err)
		}
		if err := writeFileAtomic(filepath.Join(s.recordsDir, diskArtifactKey(record.ArtifactID)+".json"), data, 0600); err != nil {
			return fmt.Errorf("retain music recovery body: %w", err)
		}
	}
	return nil
}
