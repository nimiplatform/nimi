// Package runtimeartifact provides in-memory artifact bytes index by id,
// admitted under K-AGCORE-053 (.nimi/spec/runtime/kernel/runtime-artifact-contract.md).
//
// Trust model: single-process / single-user / single-tenant. Multi-tenant
// ACL is reserved future; ARTIFACT_FORBIDDEN reason code admitted but never
// returned by current deployment.
//
// Integration posture: additive. New by-id index sits beside existing
// URI-based artifact storage produced by media_task_artifact_helpers.go;
// emitter side calls both URIStore.Save(bytes) and Store.Put(artifactId,
// bytes, mime) atomically. wave_0 implementer does not have to choose
// "replace" vs "additive" at PR time — additive is the locked decision.
package runtimeartifact

import (
	"bytes"
	"strings"
	"sync"
	"time"
)

// MaxInlineBytes is the hard ceiling for inline retrieval (32 MiB).
// Larger artifacts return ARTIFACT_TOO_LARGE; chunked retrieval is reserved
// for follow-up platform topic.
const MaxInlineBytes = 32 * 1024 * 1024

// ArtifactRecord holds artifact bytes + metadata indexed by artifact_id.
type ArtifactRecord struct {
	Bytes        []byte
	MimeType     string
	SizeBytes    int64
	MimeInferred bool
	CreatedAt    time.Time
}

// Store provides by-id artifact bytes retrieval. Implementations must be
// safe for concurrent reads + writes.
type Store interface {
	Put(artifactID string, record ArtifactRecord) error
	Get(artifactID string) (ArtifactRecord, bool)
	Delete(artifactID string) error
	Len() int
}

// MemoryStore is an in-memory by-id artifact index. wave_0 admission ships
// only this implementation; disk-cache binding (store_disk.go) is a
// follow-up enhancement.
type MemoryStore struct {
	mu      sync.RWMutex
	records map[string]ArtifactRecord
}

// NewMemoryStore constructs an empty MemoryStore.
func NewMemoryStore() *MemoryStore {
	return &MemoryStore{
		records: make(map[string]ArtifactRecord),
	}
}

// Put writes an artifact record. Caller-side enforcement: bytes size must
// not exceed MaxInlineBytes (the read side returns ARTIFACT_TOO_LARGE if
// it does, but writers should reject early to avoid wasted memory).
func (s *MemoryStore) Put(artifactID string, record ArtifactRecord) error {
	artifactID = strings.TrimSpace(artifactID)
	if artifactID == "" {
		return ErrInvalidArtifactID
	}
	if record.SizeBytes < 0 {
		return ErrInvalidArtifactRecord
	}
	if record.SizeBytes == 0 && len(record.Bytes) > 0 {
		record.SizeBytes = int64(len(record.Bytes))
	}
	record.Bytes = bytes.Clone(record.Bytes)
	record.MimeType = strings.ToLower(strings.TrimSpace(record.MimeType))
	if record.MimeType == "" {
		record.MimeType = "application/octet-stream"
		record.MimeInferred = true
	}
	if record.CreatedAt.IsZero() {
		record.CreatedAt = time.Now()
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.records[artifactID] = record
	return nil
}

// Get retrieves an artifact record by id. Second return value indicates
// presence; missing id maps to ARTIFACT_NOT_FOUND at the gRPC layer.
func (s *MemoryStore) Get(artifactID string) (ArtifactRecord, bool) {
	artifactID = strings.TrimSpace(artifactID)
	if artifactID == "" {
		return ArtifactRecord{}, false
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	record, ok := s.records[artifactID]
	record.Bytes = bytes.Clone(record.Bytes)
	return record, ok
}

// Delete removes an artifact record. Idempotent: deleting missing id is
// not an error.
func (s *MemoryStore) Delete(artifactID string) error {
	artifactID = strings.TrimSpace(artifactID)
	if artifactID == "" {
		return ErrInvalidArtifactID
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.records, artifactID)
	return nil
}

// Len reports the number of records currently stored.
func (s *MemoryStore) Len() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.records)
}
