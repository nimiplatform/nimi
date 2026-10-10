package runtimeartifact

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const jobBodyMachineBytes int64 = 512 << 30
const jobBodyOwnerBytes int64 = 128 << 30

var ErrJobBodyCapacity = errors.New("Runtime body custody capacity exhausted")
var ErrJobBodyInUse = errors.New("Runtime body candidate is in use")

// The existing artifact record owns a private candidate and its size limit.
// This is not a promise of future storage or another workflow identity.
type JobBodyCandidate struct {
	MaxBytes     int64    `json:"bytes"`
	Complete     bool     `json:"complete,omitempty"`
	Published    bool     `json:"published,omitempty"`
	StagingLinks []string `json:"staging_links,omitempty"`
}

type JobBodySlot struct {
	ArtifactID string
	MaxBytes   int64
}

type JobBodyStore interface {
	Store
	PrepareJobBodies(string, *ArtifactOwner, []JobBodySlot) error
	StageJobBody(context.Context, string, ArtifactRecord, io.ReadCloser) error
	WriteCanonicalJobBody(context.Context, string, ArtifactRecord, func(CanonicalJobBodyWriter) (*CanonicalAudioInfo, error)) error
	JobBodyStat(string, string) (ArtifactRecord, bool)
	OpenJobBody(context.Context, string, string) (*ArtifactSource, bool)
	PublishJobBodies(string, []string, func() error) error

	FinalizeJobBodyPublications(string) error
	DeleteJobBody(string, string) error
	BorrowJobBodyFile(context.Context, string, string) (string, func(), error)
	LinkJobBodyFile(context.Context, string, string, string) error
}

type jobBodyOwner struct{ account, subject string }

func jobBodyOwnerOf(owner *ArtifactOwner) jobBodyOwner {
	if owner == nil {
		return jobBodyOwner{}
	}
	subject := owner.RegisteredAppSubject
	if subject == "" {
		subject = owner.AppID
	}
	return jobBodyOwner{owner.SubjectUserID, subject}
}

func validateJobBodySlots(jobID string, owner *ArtifactOwner, slots []JobBodySlot) error {
	if strings.TrimSpace(jobID) == "" || owner == nil || len(slots) == 0 || len(slots) > 16 {
		return ErrInvalidArtifactRecord
	}
	if _, err := normalizeArtifactOwner(*owner); err != nil {
		return err
	}
	ids := map[string]bool{}
	for _, slot := range slots {
		if strings.TrimSpace(slot.ArtifactID) == "" || ids[slot.ArtifactID] || slot.MaxBytes <= 0 || slot.MaxBytes > MaxCustodyBytes {
			return ErrInvalidArtifactRecord
		}
		ids[slot.ArtifactID] = true
	}
	return nil
}

func cloneJobBodyCandidate(r *JobBodyCandidate) *JobBodyCandidate {
	if r == nil {
		return nil
	}
	copy := *r
	copy.StagingLinks = append([]string(nil), r.StagingLinks...)
	return &copy
}

func validJobBodyCandidate(record ArtifactRecord) bool {
	r := record.JobCandidate
	if r != nil {
		if len(r.StagingLinks) > 16 {
			return false
		}
		for _, path := range r.StagingLinks {
			if !filepath.IsAbs(path) || filepath.Clean(path) != path || (filepath.Base(path) != "source.wav" && filepath.Base(path) != "target.wav") {
				return false
			}
		}
	}
	return r == nil || (r.MaxBytes > 0 && r.MaxBytes <= MaxCustodyBytes && record.ProducerJobID != "" && record.Owner != nil && (!r.Published || r.Complete) && (!r.Complete || (record.SizeBytes > 0 && record.SizeBytes <= r.MaxBytes)))
}

func (s *DiskStore) jobBodyChargesLocked() (int64, map[jobBodyOwner]int64, error) {
	entries, err := os.ReadDir(s.recordsDir)
	if err != nil {
		return 0, nil, err
	}
	owners := map[jobBodyOwner]int64{}
	var total int64
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		r, ok := s.readDiskRecordFileLocked(filepath.Join(s.recordsDir, entry.Name()))
		if !ok {
			return 0, nil, ErrInvalidArtifactRecord
		}
		key := diskArtifactKey(r.ArtifactID)
		if entry.Name() != key+".json" || r.PayloadFile != key+".bin" {
			return 0, nil, ErrInvalidArtifactRecord
		}
		info, err := os.Stat(filepath.Join(s.payloadsDir, r.PayloadFile))
		if err != nil {
			return 0, nil, err
		}
		charge := info.Size()
		if !info.Mode().IsRegular() {
			return 0, nil, ErrInvalidArtifactRecord
		}
		// Only an active import has a bounded current-work allowance. Future
		// members of a required result set consume no bytes here.
		charge = max(charge, s.jobBodyImports[r.ArtifactID])
		owner := jobBodyOwnerOf(artifactOwnerFromDisk(r.Owner))
		if charge < 0 || charge > jobBodyMachineBytes-total || charge > jobBodyOwnerBytes-owners[owner] {
			return 0, nil, ErrJobBodyCapacity
		}
		total += charge
		owners[owner] += charge
	}
	return total, owners, nil
}

// @nimi-authority: rule.nimi.runtime.service-operations.scenario-job-admission
// Establish collision-free private ownership and per-body limits. Ordinary
// files grow only when this body's bounded import writes actual bytes.
func (s *DiskStore) PrepareJobBodies(jobID string, owner *ArtifactOwner, slots []JobBodySlot) error {
	if err := validateJobBodySlots(jobID, owner, slots); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	var fresh []JobBodySlot
	for _, slot := range slots {
		if existing, ok := s.readDiskRecordLocked(slot.ArtifactID); ok {
			if existing.JobCandidate == nil || existing.ProducerJobID != jobID || !artifactOwnersEqual(artifactOwnerFromDisk(existing.Owner), owner) || existing.JobCandidate.MaxBytes != slot.MaxBytes {
				return ErrInvalidArtifactRecord
			}
			if s.activeJobBodies[slot.ArtifactID] {
				return ErrJobBodyInUse
			}
			continue
		}
		fresh = append(fresh, slot)
	}
	var created []diskArtifactRecord
	rollback := func(cause error) error {
		for _, r := range created {
			if err := s.deleteDiskRecordByRecordLocked(r); err != nil {
				cause = errors.Join(cause, err)
			}
		}
		return cause
	}
	for _, slot := range fresh {
		key := diskArtifactKey(slot.ArtifactID)
		r := diskArtifactRecord{ArtifactID: slot.ArtifactID, PayloadFile: key + ".bin", ProducerJobID: jobID, Owner: diskArtifactOwnerFromRecord(owner), CreatedAt: time.Now().UTC(), JobCandidate: &JobBodyCandidate{MaxBytes: slot.MaxBytes}}
		file, err := os.OpenFile(filepath.Join(s.payloadsDir, r.PayloadFile), os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
		if err != nil {
			return rollback(err)
		}
		created = append(created, r)
		// The exclusive empty file establishes collision-free ownership. Its
		// record is saved before any body is fetched or written.
		if err := s.writeJobBodyRecordLocked(r); err != nil {
			file.Close()
			return rollback(err)
		}
		if err := file.Close(); err != nil {
			return rollback(err)
		}
	}
	return nil
}

func (s *DiskStore) writeJobBodyRecordLocked(record diskArtifactRecord) error {
	data, err := json.Marshal(record)
	if err != nil {
		return err
	}
	if len(data) > 64<<10 {
		return ErrInvalidArtifactRecord
	}
	key := diskArtifactKey(record.ArtifactID)
	temp := filepath.Join(s.recordsDir, ".job-body-"+key+".tmp")
	if err := removeFileIfPresent(temp); err != nil {
		return err
	}
	file, err := os.OpenFile(temp, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	_, err = file.Write(data)
	if err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err != nil || closeErr != nil {
		return errors.Join(err, closeErr)
	}
	return replaceJobBodyRecord(temp, filepath.Join(s.recordsDir, key+".json"))
}

type boundedJobBodyWriter struct {
	writer     io.Writer
	remaining  int64
	limitError error
}

func (w *boundedJobBodyWriter) Write(p []byte) (int, error) {
	if int64(len(p)) > w.remaining {
		if w.limitError != nil {
			return 0, w.limitError
		}
		return 0, ErrArtifactTooLarge
	}
	n, err := w.writer.Write(p)
	w.remaining -= int64(n)
	return n, err
}

// Admit this one active import against observed bytes and other active
// imports. No later body receives an allowance or physical allocation here.
func (s *DiskStore) openJobBodyImport(id string, record ArtifactRecord) (*os.File, diskArtifactRecord, int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, ok := s.readDiskRecordLocked(id)
	if !ok || r.JobCandidate == nil || r.JobCandidate.Complete || r.ProducerJobID != record.ProducerJobID || !artifactOwnersEqual(artifactOwnerFromDisk(r.Owner), record.Owner) {
		return nil, r, 0, ErrInvalidArtifactRecord
	}
	if s.activeJobBodies[id] {
		return nil, r, 0, ErrJobBodyInUse
	}
	file, err := os.OpenFile(filepath.Join(s.payloadsDir, r.PayloadFile), os.O_RDWR, 0600)
	if err != nil {
		return nil, r, 0, err
	}
	fail := func(err error) (*os.File, diskArtifactRecord, int64, error) { file.Close(); return nil, r, 0, err }
	// An incomplete transfer is not a reusable complete body. Retrying only
	// this original result may discard its partial bytes, never a complete one.
	if err := file.Truncate(0); err != nil {
		return fail(err)
	}
	total, owners, err := s.jobBodyChargesLocked()
	if err != nil {
		return fail(err)
	}
	limit := min(r.JobCandidate.MaxBytes, jobBodyMachineBytes-total, jobBodyOwnerBytes-owners[jobBodyOwnerOf(record.Owner)])
	if limit <= 0 || record.SizeBytes > limit {
		return fail(ErrJobBodyCapacity)
	}
	if s.activeJobBodies == nil {
		s.activeJobBodies = map[string]bool{}
	}
	if s.jobBodyImports == nil {
		s.jobBodyImports = map[string]int64{}
	}
	s.activeJobBodies[id], s.jobBodyImports[id] = true, limit
	return file, r, limit, nil
}

func (s *DiskStore) finishJobBodyImport(id string) {
	s.mu.Lock()
	delete(s.activeJobBodies, id)
	delete(s.jobBodyImports, id)
	s.mu.Unlock()
}

func jobBodyLimitError(limit, contractLimit int64) error {
	if limit < contractLimit {
		return ErrJobBodyCapacity
	}
	return ErrArtifactTooLarge
}

func (s *DiskStore) StageJobBody(ctx context.Context, id string, record ArtifactRecord, source io.ReadCloser) error {
	if ctx == nil || source == nil {
		return ErrInvalidArtifactRecord
	}
	defer source.Close()
	file, reserved, limit, err := s.openJobBodyImport(id, record)
	if err != nil {
		return err
	}
	defer s.finishJobBodyImport(id)
	defer file.Close()
	hash := sha256.New()
	size, err := copyArtifactStream(ctx, &boundedJobBodyWriter{writer: file, remaining: limit, limitError: jobBodyLimitError(limit, reserved.JobCandidate.MaxBytes)}, hash, source)
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
	if err := file.Sync(); err != nil {
		return err
	}
	// Publish integrity metadata only after the exact complete file is synced.
	if err := file.Truncate(size); err != nil {
		return err
	}
	if err := file.Sync(); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	reserved.SizeBytes, reserved.ContentSHA256, reserved.MimeType = size, value.ContentSHA256, value.MimeType
	reserved.MimeInferred = value.MimeInferred
	reserved.CanonicalAudio = value.CanonicalAudio
	reserved.MusicRecoveryUntil = value.MusicRecoveryUntil
	reserved.JobCandidate.Complete = true
	if err := s.writeJobBodyRecordLocked(reserved); err != nil {
		return err
	}
	return nil
}

func (s *DiskStore) JobBodyStat(jobID, id string) (ArtifactRecord, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	r, ok := s.readDiskRecordLocked(id)
	if !ok || r.ProducerJobID != jobID || r.JobCandidate == nil || !r.JobCandidate.Complete {
		return ArtifactRecord{}, false
	}
	return artifactMetadataFromDiskRecord(r)
}

// The caller already holds its Job writer lock and has validated the complete
// typed result. Artifact readers remain excluded through that durable commit.
func (s *DiskStore) PublishJobBodies(jobID string, ids []string, commit func() error) error {
	if commit == nil || len(ids) == 0 {
		return ErrInvalidArtifactRecord
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	records := make([]diskArtifactRecord, 0, len(ids))
	for _, id := range ids {
		r, ok := s.readDiskRecordLocked(id)
		if !ok || r.ProducerJobID != jobID || r.JobCandidate == nil || !r.JobCandidate.Complete || s.activeJobBodies[id] {
			return ErrInvalidArtifactRecord
		}
		info, err := os.Lstat(filepath.Join(s.payloadsDir, r.PayloadFile))
		if err != nil || !info.Mode().IsRegular() || info.Size() != r.SizeBytes {
			return ErrInvalidArtifactRecord
		}
		records = append(records, r)
	}
	if err := commit(); err != nil {
		return err
	}
	if s.publishedJobBodies == nil {
		s.publishedJobBodies = map[string]bool{}
	}
	for _, r := range records {
		s.publishedJobBodies[r.ArtifactID] = true
	}
	// The Job commit already established complete publication. A metadata
	// finalization failure must not be returned as a failed Job commit. The
	// same durable Job rebuilds this visibility at quiescent startup.
	for _, r := range records {
		r.JobCandidate.Published = true
		if err := s.writeJobBodyRecordLocked(r); err == nil {
			delete(s.publishedJobBodies, r.ArtifactID)
		}
	}
	return nil
}

func (s *DiskStore) jobBodyVisibleLocked(record diskArtifactRecord) bool {
	return record.JobCandidate == nil || (record.JobCandidate.Complete && (record.JobCandidate.Published || s.publishedJobBodies[record.ArtifactID]))
}

// ReconcileJobBodyPublications runs only before serving, with the owning Job
// writer's complete durable publication facts, never a historical permission.
func (s *DiskStore) ReconcileJobBodyPublications(published func(string, string) bool, owned ...func(string) bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	entries, err := os.ReadDir(s.recordsDir)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		r, ok := s.readDiskRecordFileLocked(filepath.Join(s.recordsDir, entry.Name()))
		if !ok {
			return ErrInvalidArtifactRecord
		}
		hasOwner := true
		if r.JobCandidate != nil && len(owned) > 0 && owned[0] != nil {
			hasOwner = owned[0](r.ProducerJobID)
		}
		if r.JobCandidate != nil && !s.jobBodyVisibleLocked(r) && !s.activeJobBodies[r.ArtifactID] && !hasOwner {
			if err := s.deleteDiskRecordByRecordLocked(r); err != nil {
				return fmt.Errorf("unpublished capture cleanup remains pending: %w", err)
			}
			continue
		}
		if r.JobCandidate == nil || r.JobCandidate.Published || !r.JobCandidate.Complete {
			continue
		}
		if published(r.ProducerJobID, r.ArtifactID) {
			r.JobCandidate.Published = true
			if err := s.writeJobBodyRecordLocked(r); err != nil {
				return fmt.Errorf("recover Job body publication: %w", err)
			}
		}
	}
	return nil
}

func (s *DiskStore) FinalizeJobBodyPublications(jobID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for id := range s.publishedJobBodies {
		r, ok := s.readDiskRecordLocked(id)
		if !ok {
			return ErrInvalidArtifactRecord
		}
		if r.ProducerJobID != jobID {
			continue
		}
		r.JobCandidate.Published = true
		if err := s.writeJobBodyRecordLocked(r); err != nil {
			return err
		}
		delete(s.publishedJobBodies, id)
	}
	return nil
}

func (s *DiskStore) DeleteJobBody(jobID, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, ok := s.readDiskRecordLocked(id)
	if !ok {
		return removeFileIfPresent(filepath.Join(s.recordsDir, ".job-body-"+diskArtifactKey(id)+".tmp"))
	}
	if r.ProducerJobID != jobID || r.JobCandidate == nil || r.JobCandidate.Published || s.publishedJobBodies[id] {
		return ErrInvalidArtifactRecord
	}
	if s.activeJobBodies[id] {
		return ErrJobBodyInUse
	}
	return s.deleteDiskRecordByRecordLocked(r)
}

// BorrowJobBodyFile pins a private complete input for an owned codec process.
// Unlike Open's reader lock, this per-body use does not block writes to the
// other owned output slots while the codec is reading its input.
func (s *DiskStore) BorrowJobBodyFile(ctx context.Context, jobID, id string) (string, func(), error) {
	s.mu.Lock()
	r, ok := s.readDiskRecordLocked(id)
	if !ok || r.ProducerJobID != jobID || r.JobCandidate == nil || !r.JobCandidate.Complete || s.activeJobBodies[id] {
		s.mu.Unlock()
		return "", nil, ErrInvalidArtifactRecord
	}
	if s.activeJobBodies == nil {
		s.activeJobBodies = map[string]bool{}
	}
	s.activeJobBodies[id] = true
	s.mu.Unlock()
	var once sync.Once
	release := func() { once.Do(func() { s.mu.Lock(); delete(s.activeJobBodies, id); s.mu.Unlock() }) }
	path := filepath.Join(s.payloadsDir, r.PayloadFile)
	file, err := os.Open(path)
	if err != nil {
		release()
		return "", nil, err
	}
	hash := sha256.New()
	size, err := copyArtifactStream(ctx, io.Discard, hash, file)
	file.Close()
	if err != nil || size != r.SizeBytes || "sha256:"+hex.EncodeToString(hash.Sum(nil)) != r.ContentSHA256 {
		release()
		return "", nil, ErrInvalidArtifactRecord
	}
	return path, release, nil
}
