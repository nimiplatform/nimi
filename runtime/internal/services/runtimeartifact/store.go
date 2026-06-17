// Package runtimeartifact provides Runtime-owned artifact bytes indexes by id,
// admitted under K-AGCORE-053 (.nimi/spec/runtime/kernel/runtime-artifact-contract.md).
//
// Trust model: single-process / single-user / single-tenant. Multi-tenant
// ACL is reserved future; ARTIFACT_FORBIDDEN reason code admitted but never
// returned by current deployment.
//
// Integration posture: additive. The by-id index sits beside existing
// URI-based artifact storage produced by media_task_artifact_helpers.go;
// emitter side calls both URIStore.Save(bytes) and Store.Put(artifactId,
// bytes, mime) atomically.
package runtimeartifact

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
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
	Bytes          []byte
	MimeType       string
	SizeBytes      int64
	MimeInferred   bool
	CreatedAt      time.Time
	GeneratedVoice *GeneratedVoiceArtifactMetadata
}

// GeneratedVoiceArtifactMetadata is the durable cleanup index for assistant
// voice audio generated from Runtime agent turns (K-VOICE-020).
type GeneratedVoiceArtifactMetadata struct {
	AgentID              string
	ConversationAnchorID string
	TurnID               string
	MessageID            string
	VoiceReference       string
	SpeechModelID        string
	RoutePolicy          string
	ByteDigest           string
	RetentionScope       string
}

// Store provides by-id artifact bytes retrieval. Implementations must be
// safe for concurrent reads + writes.
type Store interface {
	Put(artifactID string, record ArtifactRecord) error
	Get(artifactID string) (ArtifactRecord, bool)
	Delete(artifactID string) error
	CleanupGeneratedVoiceArtifacts(selector GeneratedVoiceArtifactSelector) ([]string, error)
	Len() int
}

// GeneratedVoiceArtifactSelector identifies generated voice artifacts to remove.
// Empty selector is rejected because cleanup must be explicit.
type GeneratedVoiceArtifactSelector struct {
	AgentID              string
	ConversationAnchorID string
}

// MemoryStore is an in-memory by-id artifact index used by isolated tests and
// explicitly ephemeral call sites. Runtime daemon bootstrap uses DiskStore.
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
	normalized, err := normalizeArtifactRecord(record)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.records[artifactID] = normalized
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
	if !ok {
		return ArtifactRecord{}, false
	}
	return cloneArtifactRecord(record), true
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

// CleanupGeneratedVoiceArtifacts removes generated voice artifacts matching the
// explicit selector and returns ids deleted by the call. Missing matches are
// successful no-ops; callers sort if response ordering matters.
func (s *MemoryStore) CleanupGeneratedVoiceArtifacts(selector GeneratedVoiceArtifactSelector) ([]string, error) {
	agentID := strings.TrimSpace(selector.AgentID)
	conversationAnchorID := strings.TrimSpace(selector.ConversationAnchorID)
	if agentID == "" && conversationAnchorID == "" {
		return nil, ErrInvalidArtifactID
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	deleted := make([]string, 0)
	for artifactID, record := range s.records {
		metadata := record.GeneratedVoice
		if metadata == nil {
			continue
		}
		if agentID != "" && strings.TrimSpace(metadata.AgentID) != agentID {
			continue
		}
		if conversationAnchorID != "" && strings.TrimSpace(metadata.ConversationAnchorID) != conversationAnchorID {
			continue
		}
		delete(s.records, artifactID)
		deleted = append(deleted, artifactID)
	}
	return deleted, nil
}

// Len reports the number of records currently stored.
func (s *MemoryStore) Len() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.records)
}

func normalizeArtifactRecord(record ArtifactRecord) (ArtifactRecord, error) {
	if record.SizeBytes < 0 {
		return ArtifactRecord{}, ErrInvalidArtifactRecord
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
	if record.GeneratedVoice != nil {
		metadata := normalizeGeneratedVoiceArtifactMetadata(*record.GeneratedVoice, record.Bytes)
		record.GeneratedVoice = &metadata
	}
	return record, nil
}

func cloneArtifactRecord(record ArtifactRecord) ArtifactRecord {
	record.Bytes = bytes.Clone(record.Bytes)
	if record.GeneratedVoice != nil {
		metadata := *record.GeneratedVoice
		record.GeneratedVoice = &metadata
	}
	return record
}

func normalizeGeneratedVoiceArtifactMetadata(input GeneratedVoiceArtifactMetadata, payload []byte) GeneratedVoiceArtifactMetadata {
	input.AgentID = strings.TrimSpace(input.AgentID)
	input.ConversationAnchorID = strings.TrimSpace(input.ConversationAnchorID)
	input.TurnID = strings.TrimSpace(input.TurnID)
	input.MessageID = strings.TrimSpace(input.MessageID)
	input.VoiceReference = strings.TrimSpace(input.VoiceReference)
	input.SpeechModelID = strings.TrimSpace(input.SpeechModelID)
	input.RoutePolicy = strings.TrimSpace(input.RoutePolicy)
	input.ByteDigest = strings.TrimSpace(input.ByteDigest)
	input.RetentionScope = strings.TrimSpace(input.RetentionScope)
	if input.ByteDigest == "" && len(payload) > 0 {
		sum := sha256.Sum256(payload)
		input.ByteDigest = "sha256:" + hex.EncodeToString(sum[:])
	}
	if input.RetentionScope == "" {
		input.RetentionScope = "generated_agent_voice"
	}
	return input
}
