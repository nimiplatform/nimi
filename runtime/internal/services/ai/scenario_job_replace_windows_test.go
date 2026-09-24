//go:build windows

package ai

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"golang.org/x/sys/windows"
)

func holdScenarioSnapshotOpen(t *testing.T, file string) func() {
	t.Helper()
	return holdScenarioSnapshotOpenWithSharing(t, file, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE)
}

func holdScenarioSnapshotOpenWithSharing(t *testing.T, file string, sharing uint32) func() {
	t.Helper()
	name, err := windows.UTF16PtrFromString(file)
	if err != nil {
		t.Fatal(err)
	}
	handle, err := windows.CreateFile(name, windows.GENERIC_READ, sharing, nil, windows.OPEN_EXISTING,
		windows.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		t.Fatal(err)
	}
	var once sync.Once
	release := func() {
		once.Do(func() {
			if err := windows.CloseHandle(handle); err != nil {
				t.Errorf("close snapshot reader: %v", err)
			}
		})
	}
	t.Cleanup(release)
	return release
}

func beginScenarioJobCustodyForWindowsTest(t *testing.T, store *scenarioJobStore, jobID string) error {
	t.Helper()
	ref, err := connector.CredentialCustodyRefForJob(jobID)
	if err != nil {
		t.Fatal(err)
	}
	return store.beginCloudCredentialCustody(jobID, ref)
}

// An append coexists with a reader that shares writes; the store rewrite
// retries its replacement until a transient reader closes.
func TestScenarioJobPersistenceRecoversFromTransientWindowsReader(t *testing.T) {
	store, localStatePath := newDurableScenarioJobStoreForFailureTest(t)
	if err := beginScenarioJobCustodyForWindowsTest(t, store, "initial"); err != nil {
		t.Fatal(err)
	}
	release := holdScenarioSnapshotOpen(t, store.durablePath)
	if err := beginScenarioJobCustodyForWindowsTest(t, store, "next"); err != nil {
		t.Fatalf("reader sharing writes prevented the append: %v", err)
	}
	released := make(chan struct{})
	go func() {
		time.Sleep(20 * time.Millisecond)
		release()
		close(released)
	}()
	err := store.pruneRecoveredDurableState()
	<-released
	if err != nil {
		t.Fatalf("temporary reader prevented the store rewrite: %v", err)
	}
	if store.durable.fileBytes != store.durable.baseBytes {
		t.Fatal("store rewrite left appended history behind")
	}
	reopened, err := newScenarioJobStoreForLocalStatePathBeforeStartupPrune(localStatePath)
	if err != nil {
		t.Fatal(err)
	}
	for _, jobID := range []string{"initial", "next"} {
		if reopened.pendingCloudCustody[jobID].ref == "" {
			t.Fatalf("persisted custody for %q is missing", jobID)
		}
	}
}

func TestScenarioJobPersistenceFailsClosedForPersistentWindowsReader(t *testing.T) {
	store, _ := newDurableScenarioJobStoreForFailureTest(t)
	if err := beginScenarioJobCustodyForWindowsTest(t, store, "initial"); err != nil {
		t.Fatal(err)
	}
	if err := beginScenarioJobCustodyForWindowsTest(t, store, "appended"); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(store.durablePath)
	if err != nil {
		t.Fatal(err)
	}
	release := holdScenarioSnapshotOpen(t, store.durablePath)
	err = store.pruneRecoveredDurableState()
	if !errors.Is(err, windows.ERROR_ACCESS_DENIED) && !errors.Is(err, windows.ERROR_SHARING_VIOLATION) {
		t.Fatalf("persistent reader must retain its Windows failure: %v", err)
	}
	release()
	after, err := os.ReadFile(store.durablePath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Fatal("failed replacement changed the durable document")
	}
	files, err := filepath.Glob(filepath.Join(filepath.Dir(store.durablePath), ".scenario-jobs-*.tmp"))
	if err != nil || len(files) != 0 {
		t.Fatalf("failed replacement left temporary files: %v, error=%v", files, err)
	}
}

func TestScenarioJobAppendFailsClosedForReaderDenyingWrites(t *testing.T) {
	store, _ := newDurableScenarioJobStoreForFailureTest(t)
	if err := beginScenarioJobCustodyForWindowsTest(t, store, "initial"); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(store.durablePath)
	if err != nil {
		t.Fatal(err)
	}
	release := holdScenarioSnapshotOpenWithSharing(t, store.durablePath, windows.FILE_SHARE_READ)
	err = beginScenarioJobCustodyForWindowsTest(t, store, "next")
	if !errors.Is(err, windows.ERROR_ACCESS_DENIED) && !errors.Is(err, windows.ERROR_SHARING_VIOLATION) {
		t.Fatalf("reader denying writes must fail the append closed: %v", err)
	}
	if _, exists := store.pendingCloudCustody["next"]; exists {
		t.Fatal("failed append published pending custody")
	}
	release()
	after, err := os.ReadFile(store.durablePath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Fatal("failed append changed the durable document")
	}
	if err := beginScenarioJobCustodyForWindowsTest(t, store, "next"); err != nil {
		t.Fatalf("append after the reader closed: %v", err)
	}
}

func TestScenarioJobReplacementPreservesOtherFileErrors(t *testing.T) {
	dir := t.TempDir()
	err := replaceScenarioJobFileAtomically(filepath.Join(dir, "missing"), filepath.Join(dir, "target"))
	if !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("missing source error changed: %v", err)
	}
}
