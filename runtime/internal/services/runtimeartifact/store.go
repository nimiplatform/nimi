// Package runtimeartifact provides Runtime-owned artifact bytes indexes by id,
// admitted under K-AGCORE-053 (.nimi/spec/runtime/service-operations.authority.yaml).
//
// Artifact ids are selectors only. Bytes leave Runtime only for a matching
// protected principal or an admitted Runtime-owned generated-voice consumer.
//
// Integration posture: additive. The by-id index sits beside existing
// URI-based artifact storage produced by media_task_artifact_helpers.go;
// emitter side calls both URIStore.Save(bytes) and Store.Put(artifactId,
// bytes, mime) atomically.
package runtimeartifact

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"strings"
	"sync"
	"time"
)

// MaxInlineBytes is the hard ceiling for inline retrieval (32 MiB).
// Larger artifacts return ARTIFACT_TOO_LARGE; chunked retrieval remains
// unadmitted until explicit platform authority is added.
const MaxInlineBytes = 32 * 1024 * 1024

// MaxCustodyBytes bounds streamed Runtime artifact custody independently from
// the complete inline-read ceiling.
const MaxCustodyBytes int64 = 8 * 1024 * 1024 * 1024

// ArtifactRecord holds artifact bytes + metadata indexed by artifact_id.
type ArtifactRecord struct {
	Bytes                  []byte
	MimeType               string
	ProducerJobID          string
	SizeBytes              int64
	ContentSHA256          string
	MimeInferred           bool
	CreatedAt              time.Time
	GeneratedVoice         *GeneratedVoiceArtifactMetadata
	ConversationAttachment *ConversationAttachmentArtifactMetadata
	Owner                  *ArtifactOwner
}

// ArtifactOwner is the Runtime-owned uploader identity written at protected
// PutArtifact admission. A nil owner never authorizes owner-based read.
type ArtifactOwner struct {
	SubjectUserID        string
	RegisteredAppSubject string
	AppID                string
}

// ArtifactSource is one immutable committed source held through Close.
// Record contains metadata only; Body owns the opened read handle.
type ArtifactSource struct {
	Record ArtifactRecord
	Body   io.ReadSeekCloser
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

// ConversationAttachmentArtifactMetadata binds an uncommitted protected-App
// upload candidate to the exact Runtime-owned LocalAgent Conversation scope.
// Adoption is derived from the durable transcript membership; the persisted
// expiry applies only while that membership is absent.
type ConversationAttachmentArtifactMetadata struct {
	AgentID              string
	ConversationAnchorID string
	DisplayName          string
	ExpiresAt            time.Time
}

// @nimi-authority: definition.nimi.runtime.service-operations.artifact-plane
// Store provides by-id artifact bytes retrieval. Implementations must be
// safe for concurrent reads + writes.
type Store interface {
	Put(artifactID string, record ArtifactRecord) error
	Get(artifactID string) (ArtifactRecord, bool)
	PutStream(context.Context, string, ArtifactRecord, io.ReadCloser) error
	Stat(string) (ArtifactRecord, bool)
	Open(context.Context, string) (*ArtifactSource, bool)
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

// PutStream accepts one context-aware incremental body and owns exactly one
// source Close after admission.
func (s *MemoryStore) PutStream(ctx context.Context, artifactID string, record ArtifactRecord, source io.ReadCloser) error {
	if source == nil {
		return ErrInvalidArtifactRecord
	}
	defer func() { _ = source.Close() }()
	payload, err := readArtifactStream(ctx, source)
	if err != nil {
		return err
	}
	record.Bytes = payload
	return s.Put(artifactID, record)
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

// Stat returns committed metadata without loading a caller-visible body.
func (s *MemoryStore) Stat(artifactID string) (ArtifactRecord, bool) {
	record, ok := s.Get(artifactID)
	if !ok {
		return ArtifactRecord{}, false
	}
	record.Bytes = nil
	return record, true
}

// Open returns one immutable in-memory snapshot that remains readable after a
// concurrent delete or overwrite attempt.
func (s *MemoryStore) Open(ctx context.Context, artifactID string) (*ArtifactSource, bool) {
	if err := ctx.Err(); err != nil {
		return nil, false
	}
	record, ok := s.Get(artifactID)
	if !ok || !artifactRecordIntegrityValid(record) {
		return nil, false
	}
	payload := bytes.Clone(record.Bytes)
	record.Bytes = nil
	return &ArtifactSource{
		Record: record,
		Body:   &memoryArtifactBody{Reader: *bytes.NewReader(payload)},
	}, true
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
	record.ProducerJobID = strings.TrimSpace(record.ProducerJobID)
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
	if record.GeneratedVoice != nil {
		metadata := normalizeGeneratedVoiceArtifactMetadata(*record.GeneratedVoice, record.Bytes)
		record.GeneratedVoice = &metadata
	}
	if record.ConversationAttachment != nil {
		metadata, err := normalizeConversationAttachmentArtifactMetadata(*record.ConversationAttachment)
		if err != nil || record.Owner == nil {
			return ArtifactRecord{}, ErrInvalidArtifactRecord
		}
		record.ConversationAttachment = &metadata
	}
	if record.Owner != nil {
		owner, err := normalizeArtifactOwner(*record.Owner)
		if err != nil {
			return ArtifactRecord{}, err
		}
		record.Owner = &owner
	}
	return record, nil
}

func cloneArtifactRecord(record ArtifactRecord) ArtifactRecord {
	record.Bytes = bytes.Clone(record.Bytes)
	if record.GeneratedVoice != nil {
		metadata := *record.GeneratedVoice
		record.GeneratedVoice = &metadata
	}
	if record.ConversationAttachment != nil {
		metadata := *record.ConversationAttachment
		record.ConversationAttachment = &metadata
	}
	if record.Owner != nil {
		owner := *record.Owner
		record.Owner = &owner
	}
	return record
}

func normalizeArtifactOwner(input ArtifactOwner) (ArtifactOwner, error) {
	input.SubjectUserID = strings.TrimSpace(input.SubjectUserID)
	input.RegisteredAppSubject = strings.TrimSpace(input.RegisteredAppSubject)
	input.AppID = strings.TrimSpace(input.AppID)
	if input.SubjectUserID == "" || input.AppID == "" {
		return ArtifactOwner{}, ErrInvalidArtifactRecord
	}
	return input, nil
}

func artifactOwnersEqual(left, right *ArtifactOwner) bool {
	if (left == nil) != (right == nil) {
		return false
	}
	if left == nil {
		return true
	}
	return left.SubjectUserID == right.SubjectUserID &&
		left.RegisteredAppSubject == right.RegisteredAppSubject &&
		left.AppID == right.AppID
}

func normalizeConversationAttachmentArtifactMetadata(
	input ConversationAttachmentArtifactMetadata,
) (ConversationAttachmentArtifactMetadata, error) {
	input.AgentID = strings.TrimSpace(input.AgentID)
	input.ConversationAnchorID = strings.TrimSpace(input.ConversationAnchorID)
	input.DisplayName = strings.TrimSpace(input.DisplayName)
	if input.AgentID == "" || input.ConversationAnchorID == "" || input.ExpiresAt.IsZero() ||
		len(input.DisplayName) > 255 || strings.ContainsRune(input.DisplayName, '\x00') {
		return ConversationAttachmentArtifactMetadata{}, ErrInvalidArtifactRecord
	}
	input.ExpiresAt = input.ExpiresAt.UTC()
	return input, nil
}

type memoryArtifactBody struct{ bytes.Reader }

func (*memoryArtifactBody) Close() error { return nil }

func readArtifactStream(ctx context.Context, source io.Reader) ([]byte, error) {
	if ctx == nil || source == nil {
		return nil, ErrInvalidArtifactRecord
	}
	var out bytes.Buffer
	chunk := make([]byte, 1024*1024)
	var total int64
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		read, err := source.Read(chunk)
		if read > 0 {
			total += int64(read)
			if total > MaxCustodyBytes {
				return nil, ErrArtifactTooLarge
			}
			if _, writeErr := out.Write(chunk[:read]); writeErr != nil {
				return nil, writeErr
			}
		}
		if err != nil {
			if err == io.EOF {
				return out.Bytes(), nil
			}
			return nil, err
		}
	}
}

func artifactRecordIntegrityValid(record ArtifactRecord) bool {
	if record.SizeBytes != int64(len(record.Bytes)) || strings.TrimSpace(record.ContentSHA256) == "" {
		return false
	}
	digest := sha256.Sum256(record.Bytes)
	return strings.EqualFold(strings.TrimSpace(record.ContentSHA256), "sha256:"+hex.EncodeToString(digest[:]))
}

func mergeArtifactRecords(existing, incoming ArtifactRecord) (ArtifactRecord, bool, bool) {
	if existing.ContentSHA256 != incoming.ContentSHA256 || existing.SizeBytes != incoming.SizeBytes || existing.MimeType != incoming.MimeType || existing.MimeInferred != incoming.MimeInferred || existing.ProducerJobID != incoming.ProducerJobID || !artifactOwnersEqual(existing.Owner, incoming.Owner) || !conversationAttachmentMetadataEqual(existing.ConversationAttachment, incoming.ConversationAttachment) {
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

func conversationAttachmentMetadataEqual(
	left, right *ConversationAttachmentArtifactMetadata,
) bool {
	if (left == nil) != (right == nil) {
		return false
	}
	if left == nil {
		return true
	}
	return left.AgentID == right.AgentID &&
		left.ConversationAnchorID == right.ConversationAnchorID &&
		left.DisplayName == right.DisplayName &&
		left.ExpiresAt.Equal(right.ExpiresAt)
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
