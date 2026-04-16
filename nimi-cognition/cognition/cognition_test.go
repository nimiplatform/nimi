package cognition

import (
	"encoding/json"
	"path/filepath"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/internal/clock"
	"github.com/nimiplatform/nimi/nimi-cognition/internal/storage"
	"github.com/nimiplatform/nimi/nimi-cognition/knowledge"
	_ "modernc.org/sqlite"
)

var ts = time.Date(2026, 4, 16, 12, 0, 0, 0, time.UTC)

func newTestCognition(t *testing.T) *Cognition {
	t.Helper()
	c, err := New(t.TempDir(), WithClock(clock.NewTestClock(ts)))
	if err != nil {
		t.Fatalf("new cognition: %v", err)
	}
	return c
}

func newTestCognitionAt(t *testing.T, root string) *Cognition {
	t.Helper()
	c, err := New(root, WithClock(clock.NewTestClock(ts)))
	if err != nil {
		t.Fatalf("new cognition: %v", err)
	}
	return c
}

func waitForIngestTaskStatus(t *testing.T, svc *KnowledgeService, scopeID string, taskID string, want knowledge.IngestTaskStatus) *knowledge.IngestTask {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		task, err := svc.GetIngestTask(scopeID, taskID)
		if err == nil && task != nil && task.Status == want {
			return task
		}
		time.Sleep(10 * time.Millisecond)
	}
	task, err := svc.GetIngestTask(scopeID, taskID)
	if err != nil {
		t.Fatalf("wait for ingest task %s status %s: %v", taskID, want, err)
	}
	t.Fatalf("wait for ingest task %s status %s: got %+v", taskID, want, task)
	return nil
}

func cognitionDBPath(root string) string {
	return filepath.Join(root, "cognition.sqlite")
}

func latestDigestCandidates(t *testing.T, c *Cognition, scopeID string) []storage.DigestCandidate {
	t.Helper()
	runIDs, err := c.store.ListDigestRunIDs(scopeID)
	if err != nil {
		t.Fatalf("list digest run ids: %v", err)
	}
	if len(runIDs) == 0 {
		t.Fatal("expected persisted digest run")
	}
	candidates, err := c.store.LoadDigestCandidates(scopeID, runIDs[0])
	if err != nil {
		t.Fatalf("load digest candidates: %v", err)
	}
	return candidates
}

func decodeBlockedDetail[T any](t *testing.T, raw []byte) T {
	t.Helper()
	var detail T
	if err := json.Unmarshal(raw, &detail); err != nil {
		t.Fatalf("decode blocked detail: %v", err)
	}
	return detail
}
