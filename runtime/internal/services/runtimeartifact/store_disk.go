package runtimeartifact

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"hash"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	diskStoreDirName     = "runtime-artifacts"
	diskStoreRecordsDir  = "records"
	diskStorePayloadsDir = "payloads"
)

// DiskStore is the Runtime daemon artifact store. It persists bytes and
// metadata under the local runtime state directory so generated agent voice can
// survive process restarts until the Runtime-owned cleanup RPC deletes it.
type DiskStore struct {
	mu          sync.RWMutex
	root        string
	recordsDir  string
	payloadsDir string
}

type diskArtifactRecord struct {
	ArtifactID     string                          `json:"artifact_id"`
	PayloadFile    string                          `json:"payload_file"`
	MimeType       string                          `json:"mime_type"`
	ProducerJobID  string                          `json:"producer_job_id,omitempty"`
	SizeBytes      int64                           `json:"size_bytes"`
	ContentSHA256  string                          `json:"content_sha256"`
	MimeInferred   bool                            `json:"mime_inferred"`
	CreatedAt      time.Time                       `json:"created_at"`
	GeneratedVoice *GeneratedVoiceArtifactMetadata `json:"generated_voice,omitempty"`
	Owner          *diskArtifactOwner              `json:"owner,omitempty"`
}

// diskArtifactOwner persists the PutArtifact uploader identity. It is absent
// on records written before the user attachment plane existed; such records
// load with a nil owner and keep their historical behavior.
type diskArtifactOwner struct {
	SubjectUserID        string `json:"subject_user_id"`
	RegisteredAppSubject string `json:"registered_app_subject,omitempty"`
	AppID                string `json:"app_id"`
}

// NewDiskStoreForLocalStatePath places the artifact store next to
// local-state.json, keeping Runtime's local execution state under one durable
// root without adding another user-facing config key.
func NewDiskStoreForLocalStatePath(localStatePath string) (*DiskStore, error) {
	localStatePath = strings.TrimSpace(localStatePath)
	if localStatePath == "" {
		return nil, ErrInvalidArtifactRecord
	}
	return NewDiskStore(filepath.Join(filepath.Dir(localStatePath), diskStoreDirName))
}

// NewDiskStore opens or creates a disk-backed artifact store rooted at root.
func NewDiskStore(root string) (*DiskStore, error) {
	root = strings.TrimSpace(root)
	if root == "" {
		return nil, ErrInvalidArtifactRecord
	}
	store := &DiskStore{
		root:        root,
		recordsDir:  filepath.Join(root, diskStoreRecordsDir),
		payloadsDir: filepath.Join(root, diskStorePayloadsDir),
	}
	if err := store.ensureDirs(); err != nil {
		return nil, err
	}
	return store, nil
}

func (s *DiskStore) Put(artifactID string, record ArtifactRecord) error {
	artifactID = strings.TrimSpace(artifactID)
	if artifactID == "" {
		return ErrInvalidArtifactID
	}
	normalized, err := normalizeArtifactRecord(record)
	if err != nil {
		return err
	}
	key := diskArtifactKey(artifactID)
	payloadFile := key + ".bin"
	diskRecord := diskArtifactRecord{
		ArtifactID:     artifactID,
		PayloadFile:    payloadFile,
		MimeType:       normalized.MimeType,
		ProducerJobID:  normalized.ProducerJobID,
		SizeBytes:      normalized.SizeBytes,
		ContentSHA256:  normalized.ContentSHA256,
		MimeInferred:   normalized.MimeInferred,
		CreatedAt:      normalized.CreatedAt,
		GeneratedVoice: normalized.GeneratedVoice,
		Owner:          diskArtifactOwnerFromRecord(normalized.Owner),
	}
	metadata, err := json.MarshalIndent(diskRecord, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal artifact metadata: %w", err)
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.ensureDirs(); err != nil {
		return err
	}
	if existingDisk, ok := s.readDiskRecordLocked(artifactID); ok {
		existing, ok := artifactMetadataFromDiskRecord(existingDisk)
		if !ok {
			return ErrInvalidArtifactRecord
		}
		merged, changed, valid := mergeArtifactRecords(existing, normalized)
		if !valid {
			return ErrInvalidArtifactRecord
		}
		if !changed {
			return nil
		}
		mergedDisk := diskArtifactRecord{
			ArtifactID:     artifactID,
			PayloadFile:    existingDisk.PayloadFile,
			MimeType:       merged.MimeType,
			ProducerJobID:  merged.ProducerJobID,
			SizeBytes:      merged.SizeBytes,
			ContentSHA256:  merged.ContentSHA256,
			MimeInferred:   merged.MimeInferred,
			CreatedAt:      existing.CreatedAt,
			GeneratedVoice: merged.GeneratedVoice,
			Owner:          diskArtifactOwnerFromRecord(merged.Owner),
		}
		mergedMetadata, err := json.MarshalIndent(mergedDisk, "", "  ")
		if err != nil {
			return fmt.Errorf("marshal enriched artifact metadata: %w", err)
		}
		if err := writeFileAtomic(filepath.Join(s.recordsDir, key+".json"), mergedMetadata, 0o600); err != nil {
			return fmt.Errorf("write enriched artifact metadata: %w", err)
		}
		return nil
	}
	if err := writeFileAtomic(filepath.Join(s.payloadsDir, payloadFile), normalized.Bytes, 0o600); err != nil {
		return fmt.Errorf("write artifact payload: %w", err)
	}
	if err := writeFileAtomic(filepath.Join(s.recordsDir, key+".json"), metadata, 0o600); err != nil {
		_ = os.Remove(filepath.Join(s.payloadsDir, payloadFile))
		return fmt.Errorf("write artifact metadata: %w", err)
	}
	return nil
}

// PutStream writes an accepted body incrementally to an uncommitted candidate,
// then publishes payload and metadata under one store lock. The source is
// closed exactly once by this method after acceptance.
func (s *DiskStore) PutStream(ctx context.Context, artifactID string, record ArtifactRecord, source io.ReadCloser) error {
	artifactID = strings.TrimSpace(artifactID)
	if ctx == nil || artifactID == "" || source == nil {
		return ErrInvalidArtifactRecord
	}
	defer func() { _ = source.Close() }()
	if err := s.ensureDirs(); err != nil {
		return err
	}
	candidate, err := os.CreateTemp(s.payloadsDir, ".artifact-candidate-*")
	if err != nil {
		return fmt.Errorf("create artifact candidate: %w", err)
	}
	candidatePath := candidate.Name()
	defer func() { _ = os.Remove(candidatePath) }()
	if err := candidate.Chmod(0o600); err != nil {
		_ = candidate.Close()
		return fmt.Errorf("chmod artifact candidate: %w", err)
	}
	hasher := sha256.New()
	observedSize, err := copyArtifactStream(ctx, candidate, hasher, source)
	closeErr := candidate.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return fmt.Errorf("close artifact candidate: %w", closeErr)
	}
	observedDigest := "sha256:" + hex.EncodeToString(hasher.Sum(nil))
	normalized, err := normalizeStreamedArtifactRecord(record, observedSize, observedDigest)
	if err != nil {
		return err
	}

	key := diskArtifactKey(artifactID)
	payloadFile := key + ".bin"
	diskRecord := diskArtifactRecord{
		ArtifactID:     artifactID,
		PayloadFile:    payloadFile,
		MimeType:       normalized.MimeType,
		ProducerJobID:  normalized.ProducerJobID,
		SizeBytes:      normalized.SizeBytes,
		ContentSHA256:  normalized.ContentSHA256,
		MimeInferred:   normalized.MimeInferred,
		CreatedAt:      normalized.CreatedAt,
		GeneratedVoice: normalized.GeneratedVoice,
		Owner:          diskArtifactOwnerFromRecord(normalized.Owner),
	}
	metadata, err := json.MarshalIndent(diskRecord, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal artifact metadata: %w", err)
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	if existingDisk, ok := s.readDiskRecordLocked(artifactID); ok {
		existing, ok := artifactMetadataFromDiskRecord(existingDisk)
		if !ok {
			return ErrInvalidArtifactRecord
		}
		merged, changed, valid := mergeArtifactRecords(existing, normalized)
		if !valid {
			return ErrInvalidArtifactRecord
		}
		if !changed {
			return nil
		}
		mergedDisk := diskArtifactRecord{
			ArtifactID: existingDisk.ArtifactID, PayloadFile: existingDisk.PayloadFile,
			MimeType: merged.MimeType, ProducerJobID: merged.ProducerJobID,
			SizeBytes: merged.SizeBytes, ContentSHA256: merged.ContentSHA256,
			MimeInferred: merged.MimeInferred, CreatedAt: existing.CreatedAt,
			GeneratedVoice: merged.GeneratedVoice, Owner: diskArtifactOwnerFromRecord(merged.Owner),
		}
		mergedMetadata, marshalErr := json.MarshalIndent(mergedDisk, "", "  ")
		if marshalErr != nil {
			return fmt.Errorf("marshal enriched artifact metadata: %w", marshalErr)
		}
		return writeFileAtomic(filepath.Join(s.recordsDir, key+".json"), mergedMetadata, 0o600)
	}
	finalPayloadPath := filepath.Join(s.payloadsDir, payloadFile)
	if err := os.Rename(candidatePath, finalPayloadPath); err != nil {
		return fmt.Errorf("commit artifact payload: %w", err)
	}
	if err := writeFileAtomic(filepath.Join(s.recordsDir, key+".json"), metadata, 0o600); err != nil {
		_ = os.Remove(finalPayloadPath)
		return fmt.Errorf("commit artifact metadata: %w", err)
	}
	return nil
}

func (s *DiskStore) Get(artifactID string) (ArtifactRecord, bool) {
	artifactID = strings.TrimSpace(artifactID)
	if artifactID == "" {
		return ArtifactRecord{}, false
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	diskRecord, ok := s.readDiskRecordLocked(artifactID)
	if !ok {
		return ArtifactRecord{}, false
	}
	return s.artifactFromDiskRecordLocked(diskRecord)
}

// Stat returns committed metadata without reading the payload body.
func (s *DiskStore) Stat(artifactID string) (ArtifactRecord, bool) {
	artifactID = strings.TrimSpace(artifactID)
	if artifactID == "" {
		return ArtifactRecord{}, false
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	diskRecord, ok := s.readDiskRecordLocked(artifactID)
	if !ok {
		return ArtifactRecord{}, false
	}
	return artifactMetadataFromDiskRecord(diskRecord)
}

// Open validates and pins one committed payload under a read lock. Delete and
// cleanup wait until the returned body is closed, preventing mid-copy removal.
func (s *DiskStore) Open(ctx context.Context, artifactID string) (*ArtifactSource, bool) {
	artifactID = strings.TrimSpace(artifactID)
	if ctx == nil || artifactID == "" {
		return nil, false
	}
	s.mu.RLock()
	diskRecord, ok := s.readDiskRecordLocked(artifactID)
	if !ok {
		s.mu.RUnlock()
		return nil, false
	}
	metadata, ok := artifactMetadataFromDiskRecord(diskRecord)
	if !ok {
		s.mu.RUnlock()
		return nil, false
	}
	file, err := os.Open(filepath.Join(s.payloadsDir, diskRecord.PayloadFile))
	if err != nil {
		s.mu.RUnlock()
		return nil, false
	}
	hasher := sha256.New()
	observedSize, err := copyArtifactStream(ctx, io.Discard, hasher, file)
	if err != nil || observedSize != metadata.SizeBytes ||
		!strings.EqualFold(metadata.ContentSHA256, "sha256:"+hex.EncodeToString(hasher.Sum(nil))) {
		_ = file.Close()
		s.mu.RUnlock()
		return nil, false
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		_ = file.Close()
		s.mu.RUnlock()
		return nil, false
	}
	return &ArtifactSource{
		Record: metadata,
		Body: &lockedDiskArtifactBody{
			File:   file,
			unlock: s.mu.RUnlock,
		},
	}, true
}

func (s *DiskStore) artifactFromDiskRecordLocked(diskRecord diskArtifactRecord) (ArtifactRecord, bool) {
	payload, err := os.ReadFile(filepath.Join(s.payloadsDir, diskRecord.PayloadFile))
	if err != nil {
		return ArtifactRecord{}, false
	}
	record, err := normalizeArtifactRecord(ArtifactRecord{
		Bytes:          payload,
		MimeType:       diskRecord.MimeType,
		ProducerJobID:  diskRecord.ProducerJobID,
		SizeBytes:      diskRecord.SizeBytes,
		ContentSHA256:  diskRecord.ContentSHA256,
		MimeInferred:   diskRecord.MimeInferred,
		CreatedAt:      diskRecord.CreatedAt,
		GeneratedVoice: diskRecord.GeneratedVoice,
		Owner:          artifactOwnerFromDisk(diskRecord.Owner),
	})
	if err != nil {
		return ArtifactRecord{}, false
	}
	return cloneArtifactRecord(record), true
}

func (s *DiskStore) Delete(artifactID string) error {
	artifactID = strings.TrimSpace(artifactID)
	if artifactID == "" {
		return ErrInvalidArtifactID
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.deleteDiskRecordLocked(artifactID)
}

func (s *DiskStore) CleanupGeneratedVoiceArtifacts(selector GeneratedVoiceArtifactSelector) ([]string, error) {
	agentID := strings.TrimSpace(selector.AgentID)
	conversationAnchorID := strings.TrimSpace(selector.ConversationAnchorID)
	if agentID == "" && conversationAnchorID == "" {
		return nil, ErrInvalidArtifactID
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	entries, err := os.ReadDir(s.recordsDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	deleted := make([]string, 0)
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		diskRecord, ok := s.readDiskRecordFileLocked(filepath.Join(s.recordsDir, entry.Name()))
		if !ok || diskRecord.GeneratedVoice == nil {
			continue
		}
		metadata := diskRecord.GeneratedVoice
		if agentID != "" && strings.TrimSpace(metadata.AgentID) != agentID {
			continue
		}
		if conversationAnchorID != "" && strings.TrimSpace(metadata.ConversationAnchorID) != conversationAnchorID {
			continue
		}
		if err := s.deleteDiskRecordByRecordLocked(diskRecord); err != nil {
			return deleted, err
		}
		deleted = append(deleted, diskRecord.ArtifactID)
	}
	return deleted, nil
}

func (s *DiskStore) Len() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	entries, err := os.ReadDir(s.recordsDir)
	if err != nil {
		return 0
	}
	count := 0
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".json") {
			count++
		}
	}
	return count
}

func (s *DiskStore) ensureDirs() error {
	if err := os.MkdirAll(s.recordsDir, 0o700); err != nil {
		return fmt.Errorf("create artifact records dir: %w", err)
	}
	if err := os.MkdirAll(s.payloadsDir, 0o700); err != nil {
		return fmt.Errorf("create artifact payloads dir: %w", err)
	}
	return nil
}

func (s *DiskStore) readDiskRecordLocked(artifactID string) (diskArtifactRecord, bool) {
	path := filepath.Join(s.recordsDir, diskArtifactKey(artifactID)+".json")
	diskRecord, ok := s.readDiskRecordFileLocked(path)
	if !ok || strings.TrimSpace(diskRecord.ArtifactID) != artifactID {
		return diskArtifactRecord{}, false
	}
	return diskRecord, true
}

func (s *DiskStore) readDiskRecordFileLocked(path string) (diskArtifactRecord, bool) {
	data, err := os.ReadFile(path)
	if err != nil {
		return diskArtifactRecord{}, false
	}
	var diskRecord diskArtifactRecord
	if err := json.Unmarshal(data, &diskRecord); err != nil {
		return diskArtifactRecord{}, false
	}
	if strings.TrimSpace(diskRecord.ArtifactID) == "" || strings.TrimSpace(diskRecord.PayloadFile) == "" {
		return diskArtifactRecord{}, false
	}
	if diskRecord.GeneratedVoice != nil {
		metadata := normalizeGeneratedVoiceArtifactMetadata(*diskRecord.GeneratedVoice, nil)
		diskRecord.GeneratedVoice = &metadata
	}
	return diskRecord, true
}

func (s *DiskStore) deleteDiskRecordLocked(artifactID string) error {
	diskRecord, ok := s.readDiskRecordLocked(artifactID)
	if !ok {
		return nil
	}
	return s.deleteDiskRecordByRecordLocked(diskRecord)
}

func (s *DiskStore) deleteDiskRecordByRecordLocked(diskRecord diskArtifactRecord) error {
	payloadPath := filepath.Join(s.payloadsDir, diskRecord.PayloadFile)
	recordPath := filepath.Join(s.recordsDir, diskArtifactKey(diskRecord.ArtifactID)+".json")
	if err := removeFileIfPresent(payloadPath); err != nil {
		return err
	}
	if err := removeFileIfPresent(recordPath); err != nil {
		return err
	}
	return nil
}

func diskArtifactKey(artifactID string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(artifactID)))
	return hex.EncodeToString(sum[:])
}

func writeFileAtomic(path string, data []byte, perm os.FileMode) error {
	tmpPath := fmt.Sprintf("%s.tmp.%d.%d", path, os.Getpid(), time.Now().UnixNano())
	if err := os.WriteFile(tmpPath, data, perm); err != nil {
		return err
	}
	if err := os.Rename(tmpPath, path); err != nil {
		_ = os.Remove(tmpPath)
		return err
	}
	return nil
}

func removeFileIfPresent(path string) error {
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func diskArtifactOwnerFromRecord(owner *ArtifactOwner) *diskArtifactOwner {
	if owner == nil {
		return nil
	}
	return &diskArtifactOwner{
		SubjectUserID:        owner.SubjectUserID,
		RegisteredAppSubject: owner.RegisteredAppSubject,
		AppID:                owner.AppID,
	}
}

func artifactOwnerFromDisk(owner *diskArtifactOwner) *ArtifactOwner {
	if owner == nil {
		return nil
	}
	return &ArtifactOwner{
		SubjectUserID:        owner.SubjectUserID,
		RegisteredAppSubject: owner.RegisteredAppSubject,
		AppID:                owner.AppID,
	}
}

func normalizeStreamedArtifactRecord(record ArtifactRecord, observedSize int64, observedDigest string) (ArtifactRecord, error) {
	if observedSize < 0 || observedSize > MaxCustodyBytes ||
		(record.SizeBytes != 0 && record.SizeBytes != observedSize) ||
		(strings.TrimSpace(record.ContentSHA256) != "" && !strings.EqualFold(strings.TrimSpace(record.ContentSHA256), observedDigest)) {
		return ArtifactRecord{}, ErrInvalidArtifactRecord
	}
	record.Bytes = nil
	record.SizeBytes = observedSize
	record.ContentSHA256 = observedDigest
	record.ProducerJobID = strings.TrimSpace(record.ProducerJobID)
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
		metadata := normalizeGeneratedVoiceArtifactMetadata(*record.GeneratedVoice, nil)
		record.GeneratedVoice = &metadata
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

func artifactMetadataFromDiskRecord(record diskArtifactRecord) (ArtifactRecord, bool) {
	if strings.TrimSpace(record.ArtifactID) == "" || strings.TrimSpace(record.PayloadFile) == "" ||
		record.SizeBytes < 0 || strings.TrimSpace(record.ContentSHA256) == "" || strings.TrimSpace(record.MimeType) == "" {
		return ArtifactRecord{}, false
	}
	metadata := ArtifactRecord{
		MimeType: record.MimeType, ProducerJobID: record.ProducerJobID,
		SizeBytes: record.SizeBytes, ContentSHA256: record.ContentSHA256,
		MimeInferred: record.MimeInferred, CreatedAt: record.CreatedAt,
		GeneratedVoice: record.GeneratedVoice, Owner: artifactOwnerFromDisk(record.Owner),
	}
	if metadata.Owner != nil {
		owner, err := normalizeArtifactOwner(*metadata.Owner)
		if err != nil {
			return ArtifactRecord{}, false
		}
		metadata.Owner = &owner
	}
	return metadata, true
}

func copyArtifactStream(ctx context.Context, destination io.Writer, hasher hash.Hash, source io.Reader) (int64, error) {
	buffer := make([]byte, 1024*1024)
	var total int64
	for {
		if err := ctx.Err(); err != nil {
			return total, err
		}
		read, err := source.Read(buffer)
		if read > 0 {
			total += int64(read)
			if total > MaxCustodyBytes {
				return total, ErrArtifactTooLarge
			}
			if _, writeErr := destination.Write(buffer[:read]); writeErr != nil {
				return total, writeErr
			}
			if _, hashErr := hasher.Write(buffer[:read]); hashErr != nil {
				return total, hashErr
			}
		}
		if err != nil {
			if err == io.EOF {
				return total, nil
			}
			return total, err
		}
	}
}

type lockedDiskArtifactBody struct {
	*os.File
	once   sync.Once
	unlock func()
}

func (body *lockedDiskArtifactBody) Close() error {
	var err error
	body.once.Do(func() {
		err = body.File.Close()
		body.unlock()
	})
	return err
}
