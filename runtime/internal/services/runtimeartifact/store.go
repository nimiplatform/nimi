// Package runtimeartifact provides Runtime-owned artifact bytes indexes by id,
// admitted under K-AGCORE-053 (.nimi/spec/runtime/kernel/runtime-artifact-contract.md).
//
// Read trust is audience-bound. Artifact ids are selectors only; an installed
// caller must be revalidated against the record's account/app/release/session
// audience before bytes leave Runtime.
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

	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
)

// MaxInlineBytes is the hard ceiling for inline retrieval (32 MiB).
// Larger artifacts return ARTIFACT_TOO_LARGE; chunked retrieval remains
// unadmitted until explicit platform authority is added.
const MaxInlineBytes = 32 * 1024 * 1024

// ArtifactRecord holds artifact bytes + metadata indexed by artifact_id.
type ArtifactRecord struct {
	Bytes          []byte
	MimeType       string
	SizeBytes      int64
	ContentSHA256  string
	MimeInferred   bool
	CreatedAt      time.Time
	Audience       *ArtifactAudience
	GeneratedVoice *GeneratedVoiceArtifactMetadata
}

type ArtifactUse string

const ArtifactUseReadBytes ArtifactUse = "read_bytes"

// ArtifactAudience is the durable read boundary for one externally readable
// artifact. A nil audience denotes an internal-only historical or producer
// record and can never authorize ReadArtifactBytes.
type ArtifactAudience struct {
	ProducerJobID           string
	OwnerAccountID          string
	AppID                   string
	ReleaseDigest           protectedlocal.Identifier
	SessionID               protectedlocal.Identifier
	AccountGeneration       uint64
	AllowedUse              ArtifactUse
	ExpiresAt               time.Time
	TrustClass              string
	AuthorizationID         protectedlocal.Identifier
	AuthorizationGeneration uint64
	ProjectRoot             string
	CapabilityFingerprint   protectedlocal.Identifier
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
	if existing, ok := s.records[artifactID]; ok {
		merged, _, valid := mergeArtifactRecords(existing, normalized)
		if !valid {
			return ErrInvalidArtifactRecord
		}
		s.records[artifactID] = merged
		return nil
	}
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
	observedSize := int64(len(record.Bytes))
	if record.SizeBytes != 0 && record.SizeBytes != observedSize {
		return ArtifactRecord{}, ErrInvalidArtifactRecord
	}
	record.SizeBytes = observedSize
	record.Bytes = bytes.Clone(record.Bytes)
	digest := sha256.Sum256(record.Bytes)
	observedDigest := "sha256:" + hex.EncodeToString(digest[:])
	if strings.TrimSpace(record.ContentSHA256) != "" && !strings.EqualFold(strings.TrimSpace(record.ContentSHA256), observedDigest) {
		return ArtifactRecord{}, ErrInvalidArtifactRecord
	}
	record.ContentSHA256 = observedDigest
	record.MimeType = strings.ToLower(strings.TrimSpace(record.MimeType))
	if record.MimeType == "" {
		record.MimeType = "application/octet-stream"
		record.MimeInferred = true
	}
	if record.CreatedAt.IsZero() {
		record.CreatedAt = time.Now().UTC()
	} else {
		record.CreatedAt = record.CreatedAt.UTC()
	}
	if record.Audience != nil {
		audience, err := normalizeArtifactAudience(*record.Audience, record.CreatedAt)
		if err != nil {
			return ArtifactRecord{}, err
		}
		record.Audience = &audience
	}
	if record.GeneratedVoice != nil {
		metadata := normalizeGeneratedVoiceArtifactMetadata(*record.GeneratedVoice, record.Bytes)
		record.GeneratedVoice = &metadata
	}
	return record, nil
}

func cloneArtifactRecord(record ArtifactRecord) ArtifactRecord {
	record.Bytes = bytes.Clone(record.Bytes)
	if record.Audience != nil {
		audience := *record.Audience
		record.Audience = &audience
	}
	if record.GeneratedVoice != nil {
		metadata := *record.GeneratedVoice
		record.GeneratedVoice = &metadata
	}
	return record
}

func normalizeArtifactAudience(input ArtifactAudience, createdAt time.Time) (ArtifactAudience, error) {
	input.ProducerJobID = strings.TrimSpace(input.ProducerJobID)
	input.OwnerAccountID = strings.TrimSpace(input.OwnerAccountID)
	input.AppID = strings.TrimSpace(input.AppID)
	input.AllowedUse = ArtifactUse(strings.TrimSpace(string(input.AllowedUse)))
	input.TrustClass = strings.TrimSpace(input.TrustClass)
	input.ProjectRoot = strings.TrimSpace(input.ProjectRoot)
	input.ExpiresAt = input.ExpiresAt.UTC()
	if input.ProducerJobID == "" || input.OwnerAccountID == "" || input.AppID == "" || input.ReleaseDigest == (protectedlocal.Identifier{}) ||
		input.SessionID == (protectedlocal.Identifier{}) || input.AccountGeneration == 0 || input.AllowedUse == "" || input.ExpiresAt.IsZero() || !input.ExpiresAt.After(createdAt.UTC()) {
		return ArtifactAudience{}, ErrInvalidArtifactRecord
	}
	switch input.TrustClass {
	case "local_development":
		if input.AuthorizationID == (protectedlocal.Identifier{}) || input.AuthorizationGeneration == 0 ||
			!protectedlocal.IsAbsolutePlatformPath(input.ProjectRoot) || input.CapabilityFingerprint == (protectedlocal.Identifier{}) {
			return ArtifactAudience{}, ErrInvalidArtifactRecord
		}
	default:
		return ArtifactAudience{}, ErrInvalidArtifactRecord
	}
	return input, nil
}

func artifactRecordIntegrityValid(record ArtifactRecord) bool {
	if record.SizeBytes != int64(len(record.Bytes)) || strings.TrimSpace(record.ContentSHA256) == "" {
		return false
	}
	digest := sha256.Sum256(record.Bytes)
	return strings.EqualFold(strings.TrimSpace(record.ContentSHA256), "sha256:"+hex.EncodeToString(digest[:]))
}

func mergeArtifactRecords(existing, incoming ArtifactRecord) (ArtifactRecord, bool, bool) {
	if existing.ContentSHA256 != incoming.ContentSHA256 || existing.SizeBytes != incoming.SizeBytes || existing.MimeType != incoming.MimeType || existing.MimeInferred != incoming.MimeInferred || !artifactAudiencesEqual(existing.Audience, incoming.Audience) {
		return ArtifactRecord{}, false, false
	}
	merged := cloneArtifactRecord(existing)
	if incoming.GeneratedVoice == nil {
		return merged, false, true
	}
	if existing.GeneratedVoice == nil {
		metadata := *incoming.GeneratedVoice
		merged.GeneratedVoice = &metadata
		return merged, true, true
	}
	if *existing.GeneratedVoice != *incoming.GeneratedVoice {
		return ArtifactRecord{}, false, false
	}
	return merged, false, true
}

func artifactAudiencesEqual(left, right *ArtifactAudience) bool {
	if (left == nil) != (right == nil) {
		return false
	}
	if left == nil {
		return true
	}
	return left.ProducerJobID == right.ProducerJobID && left.OwnerAccountID == right.OwnerAccountID && left.AppID == right.AppID &&
		left.ReleaseDigest == right.ReleaseDigest && left.SessionID == right.SessionID && left.AccountGeneration == right.AccountGeneration &&
		left.AllowedUse == right.AllowedUse && left.ExpiresAt.Equal(right.ExpiresAt) && left.TrustClass == right.TrustClass &&
		left.AuthorizationID == right.AuthorizationID && left.AuthorizationGeneration == right.AuthorizationGeneration &&
		left.ProjectRoot == right.ProjectRoot && left.CapabilityFingerprint == right.CapabilityFingerprint
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
