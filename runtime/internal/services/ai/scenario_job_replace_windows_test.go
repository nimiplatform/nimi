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
	name, err := windows.UTF16PtrFromString(file)
	if err != nil {
		t.Fatal(err)
	}
	handle, err := windows.CreateFile(name, windows.GENERIC_READ,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE, nil, windows.OPEN_EXISTING,
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

func TestScenarioJobPersistenceRecoversFromTransientWindowsReader(t *testing.T) {
	store, localStatePath := newDurableScenarioJobStoreForFailureTest(t)
	initialRef, err := connector.CredentialCustodyRefForJob("initial")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.beginCloudCredentialCustody("initial", initialRef); err != nil {
		t.Fatal(err)
	}
	release := holdScenarioSnapshotOpen(t, store.durablePath)
	released := make(chan struct{})
	go func() {
		time.Sleep(20 * time.Millisecond)
		release()
		close(released)
	}()
	nextRef, err := connector.CredentialCustodyRefForJob("next")
	if err != nil {
		t.Fatal(err)
	}
	err = store.beginCloudCredentialCustody("next", nextRef)
	<-released
	if err != nil {
		t.Fatalf("temporary reader prevented custody persistence: %v", err)
	}
	reopened, err := newScenarioJobStoreForLocalStatePathBeforeStartupPrune(localStatePath)
	if err != nil {
		t.Fatal(err)
	}
	if got := reopened.pendingCloudCustody["next"].ref; got != nextRef {
		t.Fatalf("persisted custody=%q, want %q", got, nextRef)
	}
}

func TestScenarioJobPersistenceFailsClosedForPersistentWindowsReader(t *testing.T) {
	store, _ := newDurableScenarioJobStoreForFailureTest(t)
	initialRef, err := connector.CredentialCustodyRefForJob("initial")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.beginCloudCredentialCustody("initial", initialRef); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(store.durablePath)
	if err != nil {
		t.Fatal(err)
	}
	release := holdScenarioSnapshotOpen(t, store.durablePath)
	nextRef, err := connector.CredentialCustodyRefForJob("next")
	if err != nil {
		t.Fatal(err)
	}
	err = store.beginCloudCredentialCustody("next", nextRef)
	if !errors.Is(err, windows.ERROR_ACCESS_DENIED) && !errors.Is(err, windows.ERROR_SHARING_VIOLATION) {
		t.Fatalf("persistent reader must retain its Windows failure: %v", err)
	}
	if _, exists := store.pendingCloudCustody["next"]; exists || len(store.jobs) != 0 {
		t.Fatal("failed persistence published pending custody or a Job")
	}
	release()
	after, err := os.ReadFile(store.durablePath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Fatal("failed replacement changed the durable snapshot")
	}
	files, err := filepath.Glob(filepath.Join(filepath.Dir(store.durablePath), ".scenario-jobs-*.tmp"))
	if err != nil || len(files) != 0 {
		t.Fatalf("failed replacement left temporary files: %v, error=%v", files, err)
	}
}

func TestScenarioJobReplacementPreservesOtherFileErrors(t *testing.T) {
	dir := t.TempDir()
	err := replaceScenarioJobFileAtomically(filepath.Join(dir, "missing"), filepath.Join(dir, "target"))
	if !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("missing source error changed: %v", err)
	}
}
