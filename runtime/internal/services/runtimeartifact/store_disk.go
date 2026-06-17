package runtimeartifact

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
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
	SizeBytes      int64                           `json:"size_bytes"`
	MimeInferred   bool                            `json:"mime_inferred"`
	CreatedAt      time.Time                       `json:"created_at"`
	GeneratedVoice *GeneratedVoiceArtifactMetadata `json:"generated_voice,omitempty"`
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
		SizeBytes:      normalized.SizeBytes,
		MimeInferred:   normalized.MimeInferred,
		CreatedAt:      normalized.CreatedAt,
		GeneratedVoice: normalized.GeneratedVoice,
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
	if err := writeFileAtomic(filepath.Join(s.payloadsDir, payloadFile), normalized.Bytes, 0o600); err != nil {
		return fmt.Errorf("write artifact payload: %w", err)
	}
	if err := writeFileAtomic(filepath.Join(s.recordsDir, key+".json"), metadata, 0o600); err != nil {
		_ = os.Remove(filepath.Join(s.payloadsDir, payloadFile))
		return fmt.Errorf("write artifact metadata: %w", err)
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
	payload, err := os.ReadFile(filepath.Join(s.payloadsDir, diskRecord.PayloadFile))
	if err != nil {
		return ArtifactRecord{}, false
	}
	record := ArtifactRecord{
		Bytes:          payload,
		MimeType:       diskRecord.MimeType,
		SizeBytes:      diskRecord.SizeBytes,
		MimeInferred:   diskRecord.MimeInferred,
		CreatedAt:      diskRecord.CreatedAt,
		GeneratedVoice: diskRecord.GeneratedVoice,
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
