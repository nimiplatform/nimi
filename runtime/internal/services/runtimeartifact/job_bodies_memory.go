package runtimeartifact

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
)

// The ephemeral store applies the same ownership and accounting transitions.
// Pending identities have no prepaid future bytes in either store.
func (s *MemoryStore) PrepareJobBodies(jobID string, owner *ArtifactOwner, slots []JobBodySlot) error {
	if err := validateJobBodySlots(jobID, owner, slots); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	var fresh []JobBodySlot
	for _, slot := range slots {
		if r, ok := s.records[slot.ArtifactID]; ok {
			if r.JobCandidate == nil || r.ProducerJobID != jobID || !artifactOwnersEqual(r.Owner, owner) || r.JobCandidate.MaxBytes != slot.MaxBytes {
				return ErrInvalidArtifactRecord
			}
			continue
		}
		fresh = append(fresh, slot)
	}
	for _, slot := range fresh {
		s.records[slot.ArtifactID] = cloneArtifactRecord(ArtifactRecord{ProducerJobID: jobID, Owner: owner, JobCandidate: &JobBodyCandidate{MaxBytes: slot.MaxBytes}})
	}
	return nil
}

func (s *MemoryStore) StageJobBody(ctx context.Context, id string, record ArtifactRecord, source io.ReadCloser) error {
	if ctx == nil || source == nil {
		return ErrInvalidArtifactRecord
	}
	defer source.Close()
	s.mu.Lock()
	reserved, ok := s.records[id]
	if !ok || reserved.JobCandidate == nil || reserved.JobCandidate.Complete || reserved.ProducerJobID != record.ProducerJobID || !artifactOwnersEqual(reserved.Owner, record.Owner) {
		s.mu.Unlock()
		return ErrInvalidArtifactRecord
	}
	if s.activeJobBodies[id] {
		s.mu.Unlock()
		return ErrJobBodyInUse
	}
	var total int64
	owners := map[jobBodyOwner]int64{}
	for key, value := range s.records {
		charge := max(value.SizeBytes, s.jobBodyImports[key])
		owner := jobBodyOwnerOf(value.Owner)
		if charge < 0 || charge > jobBodyMachineBytes-total || charge > jobBodyOwnerBytes-owners[owner] {
			s.mu.Unlock()
			return ErrJobBodyCapacity
		}
		total += charge
		owners[owner] += charge
	}
	limit := min(reserved.JobCandidate.MaxBytes, jobBodyMachineBytes-total, jobBodyOwnerBytes-owners[jobBodyOwnerOf(record.Owner)])
	if limit <= 0 || record.SizeBytes > limit {
		s.mu.Unlock()
		return ErrJobBodyCapacity
	}
	if s.activeJobBodies == nil {
		s.activeJobBodies = map[string]bool{}
	}
	if s.jobBodyImports == nil {
		s.jobBodyImports = map[string]int64{}
	}
	s.activeJobBodies[id], s.jobBodyImports[id] = true, limit
	s.mu.Unlock()
	defer func() { s.mu.Lock(); delete(s.activeJobBodies, id); delete(s.jobBodyImports, id); s.mu.Unlock() }()
	var buffer bytes.Buffer
	hash := sha256.New()
	size, err := copyArtifactStream(ctx, &boundedJobBodyWriter{writer: &buffer, remaining: limit, limitError: jobBodyLimitError(limit, reserved.JobCandidate.MaxBytes)}, hash, source)
	if err != nil {
		return err
	}
	if size <= 0 {
		return ErrInvalidArtifactRecord
	}
	value, err := normalizeStreamedArtifactRecord(record, size, "sha256:"+hex.EncodeToString(hash.Sum(nil)))
	if err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	value.Bytes = bytes.Clone(buffer.Bytes())
	value.JobCandidate = cloneJobBodyCandidate(reserved.JobCandidate)
	value.JobCandidate.Complete = true
	s.mu.Lock()
	defer s.mu.Unlock()
	s.records[id] = value
	return nil
}

func (s *MemoryStore) JobBodyStat(jobID, id string) (ArtifactRecord, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	r, ok := s.records[id]
	if !ok || r.ProducerJobID != jobID || r.JobCandidate == nil || !r.JobCandidate.Complete {
		return ArtifactRecord{}, false
	}
	r.Bytes = nil
	return cloneArtifactRecord(r), true
}

func (s *MemoryStore) OpenJobBody(ctx context.Context, jobID, id string) (*ArtifactSource, bool) {
	if ctx.Err() != nil {
		return nil, false
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	r, ok := s.records[id]
	if !ok || r.ProducerJobID != jobID || r.JobCandidate == nil || !r.JobCandidate.Complete || !artifactRecordIntegrityValid(r) {
		return nil, false
	}
	copy := cloneArtifactRecord(r)
	copy.Bytes = nil
	return &ArtifactSource{Record: copy, Body: &memoryArtifactBody{Reader: *bytes.NewReader(bytes.Clone(r.Bytes))}}, true
}

func (s *MemoryStore) PublishJobBodies(jobID string, ids []string, commit func() error) error {
	if commit == nil || len(ids) == 0 {
		return ErrInvalidArtifactRecord
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, id := range ids {
		r, ok := s.records[id]
		if !ok || r.ProducerJobID != jobID || r.JobCandidate == nil || !r.JobCandidate.Complete || s.activeJobBodies[id] {
			return ErrInvalidArtifactRecord
		}
	}
	if err := commit(); err != nil {
		return err
	}
	for _, id := range ids {
		r := s.records[id]
		r.JobCandidate = cloneJobBodyCandidate(r.JobCandidate)
		r.JobCandidate.Published = true
		s.records[id] = r
	}
	return nil
}

func (s *MemoryStore) FinalizeJobBodyPublications(string) error { return nil }
func (s *MemoryStore) DeleteJobBody(jobID, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, ok := s.records[id]
	if !ok {
		return nil
	}
	if r.ProducerJobID != jobID || r.JobCandidate == nil || r.JobCandidate.Published {
		return ErrInvalidArtifactRecord
	}
	if s.activeJobBodies[id] {
		return ErrJobBodyInUse
	}
	delete(s.records, id)
	return nil
}

func (s *MemoryStore) BorrowJobBodyFile(context.Context, string, string) (string, func(), error) {
	return "", nil, fmt.Errorf("ephemeral body custody has no filesystem codec input")
}
