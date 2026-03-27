package workflow

import (
	"os"
	"strings"
	"testing"
	"time"

	"google.golang.org/protobuf/types/known/structpb"
)

func TestResultStoreLifecycle(t *testing.T) {
	store := newResultStore(10 * time.Millisecond)
	store.Write("task-1", "node-1", "output", structFromMap(map[string]any{"value": "ok"}))

	got, ok := store.Read("task-1", "node-1", "output")
	if !ok {
		t.Fatalf("expected stored result")
	}
	if got.AsMap()["value"] != "ok" {
		t.Fatalf("unexpected stored value: %v", got.AsMap())
	}

	got.Fields["value"] = structpb.NewStringValue("mutated")
	again, ok := store.Read("task-1", "node-1", "output")
	if !ok {
		t.Fatalf("expected stored result on second read")
	}
	if again.AsMap()["value"] != "ok" {
		t.Fatalf("result store must return cloned values, got=%v", again.AsMap()["value"])
	}

	store.MarkTaskDone("task-1")
	store.CleanupExpired(time.Now().UTC().Add(50 * time.Millisecond))

	if _, exists := store.Read("task-1", "node-1", "output"); exists {
		t.Fatalf("expected expired result to be cleaned")
	}
}

func TestArtifactStoreLifecycle(t *testing.T) {
	root := t.TempDir()
	store, err := newArtifactStore(root, 10*time.Millisecond, nil)
	if err != nil {
		t.Fatalf("new artifact store: %v", err)
	}

	meta, err := store.Write("task-1", "node-1", "artifact", "text/plain", []byte("hello"))
	if err != nil {
		t.Fatalf("write artifact: %v", err)
	}
	if meta.ArtifactID == "" {
		t.Fatalf("artifact_id must not be empty")
	}
	if _, statErr := os.Stat(meta.Path); statErr != nil {
		t.Fatalf("artifact file missing: %v", statErr)
	}

	snapshot := store.SnapshotTask("task-1")
	if len(snapshot) != 1 {
		t.Fatalf("expected 1 artifact in snapshot, got=%d", len(snapshot))
	}
	if snapshot[0].ArtifactID != meta.ArtifactID {
		t.Fatalf("snapshot artifact mismatch: got=%s want=%s", snapshot[0].ArtifactID, meta.ArtifactID)
	}

	store.MarkTaskDone("task-1")
	store.CleanupExpired(time.Now().UTC().Add(50 * time.Millisecond))

	if len(store.SnapshotTask("task-1")) != 0 {
		t.Fatalf("expected cleaned artifact snapshot")
	}
	if _, statErr := os.Stat(meta.Path); !os.IsNotExist(statErr) {
		t.Fatalf("artifact file should be removed, statErr=%v", statErr)
	}
}

func TestArtifactStoreWriteRejectsEmptyMIME(t *testing.T) {
	root := t.TempDir()
	store, err := newArtifactStore(root, 10*time.Millisecond, nil)
	if err != nil {
		t.Fatalf("new artifact store: %v", err)
	}

	if _, err := store.Write("task-1", "node-1", "artifact", "", []byte("hello")); err == nil {
		t.Fatal("expected empty mime_type to fail")
	}
}

func TestSanitizeSegmentRemovesDotDotSequences(t *testing.T) {
	if got := sanitizeSegment("../task/..\\node"); strings.Contains(got, "..") {
		t.Fatalf("sanitizeSegment should remove dotdot traversal, got %q", got)
	}
}

func TestSanitizeSegmentReplacesControlCharacters(t *testing.T) {
	got := sanitizeSegment("task\x00name\nnext")
	if strings.ContainsRune(got, '\x00') || strings.ContainsRune(got, '\n') {
		t.Fatalf("sanitizeSegment should replace control characters, got %q", got)
	}
}

func TestResultStoreWriteSkipsFrequentCleanup(t *testing.T) {
	store := newResultStore(10 * time.Millisecond)
	store.tasks["expired"] = &resultTaskStore{
		nodes:  map[string]map[string]*structpb.Struct{},
		doneAt: time.Now().UTC().Add(-time.Second),
	}
	store.lastCleanupAt = time.Now().UTC()

	store.Write("task-1", "node-1", "output", structFromMap(map[string]any{"value": "ok"}))

	if _, exists := store.tasks["expired"]; !exists {
		t.Fatalf("frequent writes should not trigger cleanup on every call")
	}
}
