package workflow

import (
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/oklog/ulid/v2"
	"google.golang.org/protobuf/types/known/structpb"
)

type resultTaskStore struct {
	nodes  map[string]map[string]*structpb.Struct
	doneAt time.Time
}

type resultStore struct {
	mu            sync.RWMutex
	ttl           time.Duration
	lastCleanupAt time.Time
	tasks         map[string]*resultTaskStore
}

const resultStoreCleanupInterval = 30 * time.Second

func newResultStore(ttl time.Duration) *resultStore {
	if ttl <= 0 {
		ttl = 30 * time.Minute
	}
	return &resultStore{
		ttl:   ttl,
		tasks: make(map[string]*resultTaskStore),
	}
}

func (s *resultStore) Write(taskID string, nodeID string, slot string, value *structpb.Struct) {
	if strings.TrimSpace(taskID) == "" || strings.TrimSpace(nodeID) == "" || strings.TrimSpace(slot) == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	task := s.tasks[taskID]
	if task == nil {
		task = &resultTaskStore{nodes: make(map[string]map[string]*structpb.Struct)}
		s.tasks[taskID] = task
	}
	node := task.nodes[nodeID]
	if node == nil {
		node = make(map[string]*structpb.Struct)
		task.nodes[nodeID] = node
	}
	node[slot] = cloneStruct(value)
	s.maybeCleanupExpiredLocked(time.Now().UTC())
}

func (s *resultStore) Read(taskID string, nodeID string, slot string) (*structpb.Struct, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	task := s.tasks[taskID]
	if task == nil {
		return nil, false
	}
	node := task.nodes[nodeID]
	if node == nil {
		return nil, false
	}
	value, ok := node[slot]
	if !ok {
		return nil, false
	}
	return cloneStruct(value), true
}

func (s *resultStore) ReadNode(taskID string, nodeID string) map[string]*structpb.Struct {
	s.mu.RLock()
	defer s.mu.RUnlock()

	task := s.tasks[taskID]
	if task == nil {
		return map[string]*structpb.Struct{}
	}
	node := task.nodes[nodeID]
	if node == nil {
		return map[string]*structpb.Struct{}
	}
	copied := make(map[string]*structpb.Struct, len(node))
	for slot, value := range node {
		copied[slot] = cloneStruct(value)
	}
	return copied
}

func (s *resultStore) MarkTaskDone(taskID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	task := s.tasks[taskID]
	if task == nil {
		return
	}
	if task.doneAt.IsZero() {
		task.doneAt = time.Now().UTC()
	}
	s.cleanupExpiredLocked(time.Now().UTC())
}

func (s *resultStore) CleanupExpired(now time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cleanupExpiredLocked(now)
}

func (s *resultStore) cleanupExpiredLocked(now time.Time) {
	if s.ttl <= 0 {
		return
	}
	s.lastCleanupAt = now
	for taskID, task := range s.tasks {
		if task == nil || task.doneAt.IsZero() {
			continue
		}
		if now.After(task.doneAt.Add(s.ttl)) {
			delete(s.tasks, taskID)
		}
	}
}

func (s *resultStore) maybeCleanupExpiredLocked(now time.Time) {
	if !s.lastCleanupAt.IsZero() && now.Sub(s.lastCleanupAt) < resultStoreCleanupInterval {
		return
	}
	s.cleanupExpiredLocked(now)
}

type artifactMeta struct {
	ArtifactID string
	TaskID     string
	NodeID     string
	Slot       string
	MimeType   string
	Path       string
	Size       int64
	CreatedAt  time.Time
}

type artifactTaskStore struct {
	artifactIDs map[string]bool
	doneAt      time.Time
}

type artifactStore struct {
	mu    sync.RWMutex
	root  string
	ttl   time.Duration
	items map[string]artifactMeta
	tasks map[string]*artifactTaskStore
	log   *slog.Logger
}

func newArtifactStore(root string, ttl time.Duration, logger *slog.Logger) (*artifactStore, error) {
	trimmed := strings.TrimSpace(root)
	if trimmed == "" {
		return nil, fmt.Errorf("artifact root is empty")
	}
	if err := os.MkdirAll(trimmed, 0o755); err != nil {
		return nil, err
	}
	if ttl <= 0 {
		ttl = 30 * time.Minute
	}
	return &artifactStore{
		root:  trimmed,
		ttl:   ttl,
		items: make(map[string]artifactMeta),
		tasks: make(map[string]*artifactTaskStore),
		log:   logger,
	}, nil
}

func (s *artifactStore) Write(taskID string, nodeID string, slot string, mimeType string, data []byte) (*artifactMeta, error) {
	taskID = strings.TrimSpace(taskID)
	nodeID = strings.TrimSpace(nodeID)
	slot = strings.TrimSpace(slot)
	if taskID == "" || nodeID == "" || slot == "" {
		return nil, fmt.Errorf("task_id, node_id and slot are required")
	}
	if strings.TrimSpace(mimeType) == "" {
		mimeType = "application/octet-stream"
	}

	artifactID := ulid.Make().String()
	fileName := sanitizeSegment(slot) + "-" + artifactID + ".bin"
	taskDir := filepath.Join(s.root, sanitizeSegment(taskID), sanitizeSegment(nodeID))
	if err := os.MkdirAll(taskDir, 0o755); err != nil {
		return nil, err
	}
	path := filepath.Join(taskDir, fileName)
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return nil, err
	}
	meta := artifactMeta{
		ArtifactID: artifactID,
		TaskID:     taskID,
		NodeID:     nodeID,
		Slot:       slot,
		MimeType:   mimeType,
		Path:       path,
		Size:       int64(len(data)),
		CreatedAt:  time.Now().UTC(),
	}

	s.mu.Lock()
	s.items[artifactID] = meta
	task := s.tasks[taskID]
	if task == nil {
		task = &artifactTaskStore{artifactIDs: make(map[string]bool)}
		s.tasks[taskID] = task
	}
	task.artifactIDs[artifactID] = true
	s.cleanupExpiredLocked(time.Now().UTC())
	s.mu.Unlock()

	return &meta, nil
}

func (s *artifactStore) MarkTaskDone(taskID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	task := s.tasks[taskID]
	if task == nil {
		return
	}
	if task.doneAt.IsZero() {
		task.doneAt = time.Now().UTC()
	}
	s.cleanupExpiredLocked(time.Now().UTC())
}

func (s *artifactStore) CleanupExpired(now time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cleanupExpiredLocked(now)
}

func (s *artifactStore) cleanupExpiredLocked(now time.Time) {
	if s.ttl <= 0 {
		return
	}
	for taskID, task := range s.tasks {
		if task == nil || task.doneAt.IsZero() {
			continue
		}
		if !now.After(task.doneAt.Add(s.ttl)) {
			continue
		}
		for artifactID := range task.artifactIDs {
			meta, exists := s.items[artifactID]
			if !exists {
				continue
			}
			if err := os.Remove(meta.Path); err != nil && !os.IsNotExist(err) && s.log != nil {
				s.log.Warn("workflow artifact cleanup failed", "artifact_id", artifactID, "path", meta.Path, "error", err)
			}
			delete(s.items, artifactID)
		}
		taskDir := filepath.Join(s.root, sanitizeSegment(taskID))
		if err := os.RemoveAll(taskDir); err != nil && s.log != nil {
			s.log.Warn("workflow artifact task cleanup failed", "task_id", taskID, "path", taskDir, "error", err)
		}
		delete(s.tasks, taskID)
	}
}

func (s *artifactStore) SnapshotTask(taskID string) []artifactMeta {
	s.mu.RLock()
	defer s.mu.RUnlock()
	task := s.tasks[taskID]
	if task == nil {
		return []artifactMeta{}
	}
	items := make([]artifactMeta, 0, len(task.artifactIDs))
	for artifactID := range task.artifactIDs {
		if meta, ok := s.items[artifactID]; ok {
			items = append(items, meta)
		}
	}
	return items
}

func resolveArtifactRoot() string {
	if xdg := strings.TrimSpace(os.Getenv("XDG_DATA_HOME")); xdg != "" {
		return filepath.Join(xdg, "nimi", "artifacts")
	}
	homeDir, err := os.UserHomeDir()
	if err == nil && strings.TrimSpace(homeDir) != "" {
		return filepath.Join(homeDir, ".nimi", "artifacts")
	}
	return filepath.Join(os.TempDir(), "nimi", "artifacts")
}

func sanitizeSegment(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "_"
	}
	replacer := strings.NewReplacer("/", "_", "\\", "_", " ", "_", ":", "_")
	sanitized := replacer.Replace(trimmed)
	for strings.Contains(sanitized, "..") {
		sanitized = strings.ReplaceAll(sanitized, "..", "_")
	}
	return sanitized
}
