package runtimeartifact

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Runtime composition supplies its private staging roots. Neither an App path
// nor a serialized metadata entry can expand these roots.
func (s *DiskStore) SetJobStagingRoots(roots []string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.jobStagingRoots = nil
	for _, root := range roots {
		if filepath.IsAbs(root) {
			s.jobStagingRoots = append(s.jobStagingRoots, filepath.Clean(root))
		}
	}
}
func (s *DiskStore) validJobStagingLink(path string) bool {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path {
		return false
	}
	if name := filepath.Base(path); name != "source.wav" && name != "target.wav" {
		return false
	}
	parent, err := filepath.EvalSymlinks(filepath.Dir(path))
	if err != nil {
		return false
	}
	for _, root := range s.jobStagingRoots {
		real, err := filepath.EvalSymlinks(root)
		if err != nil {
			continue
		}
		rel, err := filepath.Rel(real, parent)
		if err == nil && rel != "." && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return true
		}
	}
	return false
}

// LinkJobBodyFile preserves a Driver's private source.wav contract without
// another physical copy. The artifact record owns both names of one inode.
// @nimi-authority: rule.nimi.runtime.service-operations.scenario-job-admission
func (s *DiskStore) LinkJobBodyFile(ctx context.Context, jobID, id, path string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if ctx.Err() != nil {
		return ctx.Err()
	}
	r, ok := s.readDiskRecordLocked(id)
	if !ok || r.ProducerJobID != jobID || r.JobCandidate == nil || !r.JobCandidate.Complete || r.JobCandidate.Published || s.activeJobBodies[id] || !s.validJobStagingLink(path) {
		return ErrInvalidArtifactRecord
	}
	if r.MimeType != "audio/wav" || r.CanonicalAudio == nil {
		return ErrInvalidArtifactRecord
	}
	source := filepath.Join(s.payloadsDir, r.PayloadFile)
	for _, link := range r.JobCandidate.StagingLinks {
		if link == path {
			original, e1 := os.Stat(source)
			linked, e2 := os.Lstat(path)
			if e1 == nil && e2 == nil && linked.Mode().IsRegular() && os.SameFile(original, linked) {
				return nil
			}
			if !errors.Is(e2, os.ErrNotExist) {
				return ErrInvalidArtifactRecord
			}
			return os.Link(source, path)
		}
	}
	if len(r.JobCandidate.StagingLinks) >= 16 {
		return ErrInvalidArtifactRecord
	}
	if _, err := os.Lstat(path); !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("capture link destination already exists or is unavailable")
	}
	r.JobCandidate = cloneJobBodyCandidate(r.JobCandidate)
	r.JobCandidate.StagingLinks = append(r.JobCandidate.StagingLinks, path)
	if err := s.writeJobBodyRecordLocked(r); err != nil {
		return err
	}
	// On failure the private metadata retains the exact cleanup obligation.
	return os.Link(source, path)
}
func (s *DiskStore) removeJobStagingLinksLocked(r diskArtifactRecord) error {
	if r.JobCandidate == nil {
		return nil
	}
	for _, path := range r.JobCandidate.StagingLinks {
		linked, err := os.Lstat(path)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return err
		}
		if !s.validJobStagingLink(path) || !linked.Mode().IsRegular() {
			return ErrInvalidArtifactRecord
		}
		original, err := os.Stat(filepath.Join(s.payloadsDir, r.PayloadFile))
		if err != nil {
			return err
		}
		if !os.SameFile(original, linked) {
			return fmt.Errorf("capture link no longer names its original body")
		}
		if err := os.Remove(path); err != nil {
			return err
		}
	}
	return nil
}
func (s *MemoryStore) LinkJobBodyFile(context.Context, string, string, string) error {
	return fmt.Errorf("capture file custody requires a disk-backed Runtime owner")
}
