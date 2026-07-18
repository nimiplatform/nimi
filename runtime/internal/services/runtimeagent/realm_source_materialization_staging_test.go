package runtimeagent

import (
	"bytes"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"
)

func TestRealmSourceMaterializationStagingExactBoundaryAndCleanup(t *testing.T) {
	root := t.TempDir()
	staging, err := newRealmSourceMaterializationStagingV3(filepath.Join(root, "memory.db"))
	if err != nil {
		t.Fatalf("new staging: %v", err)
	}
	payload := bytes.Repeat([]byte("p"), 4096)
	staged, err := staging.stagePacket(t.Context(), "account-1", "request-1", bytes.NewReader(payload), int64(len(payload)), int64(len(payload)))
	if err != nil {
		t.Fatalf("stage exact boundary: %v", err)
	}
	if err := validateRealmSourceMaterializationPrivatePathV3(staged.file.Name(), false); err != nil {
		t.Fatalf("validate private staged Packet: %v", err)
	}
	for _, directory := range []string{staging.root, staged.partitionDir, staged.attemptDir} {
		if err := validateRealmSourceMaterializationPrivatePathV3(directory, true); err != nil {
			t.Fatalf("validate private directory %s: %v", directory, err)
		}
	}
	readback, err := io.ReadAll(staged.reader())
	if err != nil || !bytes.Equal(readback, payload) {
		t.Fatalf("staged Packet readback mismatch: err=%v bytes=%d", err, len(readback))
	}
	if err := staged.cleanup(); err != nil {
		t.Fatalf("cleanup staging: %v", err)
	}
	assertRealmSourceMaterializationStagingEmpty(t, staging.root)
}

func TestRealmSourceMaterializationStagingRejectsLimitPlusOneWithoutResidue(t *testing.T) {
	root := t.TempDir()
	staging, err := newRealmSourceMaterializationStagingV3(filepath.Join(root, "memory.db"))
	if err != nil {
		t.Fatalf("new staging: %v", err)
	}
	_, err = staging.stagePacket(t.Context(), "account-1", "request-2", bytes.NewReader(bytes.Repeat([]byte("x"), 1025)), 1024, 1025)
	if sourceMaterializationV3FailureCode(err) != sourceMaterializationFailureCapacityV3 {
		t.Fatalf("limit+1 failure = %v", err)
	}
	assertRealmSourceMaterializationStagingEmpty(t, staging.root)
}

func TestRealmSourceMaterializationStagingStartupRecoveryClearsTransport(t *testing.T) {
	root := t.TempDir()
	staging, err := newRealmSourceMaterializationStagingV3(filepath.Join(root, "memory.db"))
	if err != nil {
		t.Fatalf("new staging: %v", err)
	}
	residue := filepath.Join(staging.root, "opaque-partition", "opaque-attempt")
	if err := os.MkdirAll(residue, 0o700); err != nil {
		t.Fatalf("create simulated residue: %v", err)
	}
	if err := os.WriteFile(filepath.Join(residue, "transport"), []byte("raw-packet"), 0o600); err != nil {
		t.Fatalf("write simulated residue: %v", err)
	}
	if err := staging.recoverStartup(); err != nil {
		t.Fatalf("recover staging: %v", err)
	}
	assertRealmSourceMaterializationStagingEmpty(t, staging.root)
}

type failingRealmSourceMaterializationReader struct{}

func (failingRealmSourceMaterializationReader) Read([]byte) (int, error) {
	return 0, errors.New("transport interrupted")
}

func TestRealmSourceMaterializationStagingInterruptedTransportLeavesNoResidue(t *testing.T) {
	root := t.TempDir()
	staging, err := newRealmSourceMaterializationStagingV3(filepath.Join(root, "memory.db"))
	if err != nil {
		t.Fatalf("new staging: %v", err)
	}
	_, err = staging.stagePacket(t.Context(), "account-1", "request-3", failingRealmSourceMaterializationReader{}, 1024, -1)
	if sourceMaterializationV3FailureCode(err) != sourceMaterializationFailureIssuerUnavailableV3 {
		t.Fatalf("interrupted transport failure = %v", err)
	}
	assertRealmSourceMaterializationStagingEmpty(t, staging.root)
}

func TestRealmSourceMaterializationStagingRejectsEarlyEOFWithoutResidue(t *testing.T) {
	root := t.TempDir()
	staging, err := newRealmSourceMaterializationStagingV3(filepath.Join(root, "memory.db"))
	if err != nil {
		t.Fatalf("new staging: %v", err)
	}
	_, err = staging.stagePacket(t.Context(), "account-1", "request-4", bytes.NewReader([]byte("short")), 1024, 10)
	if sourceMaterializationV3FailureCode(err) != sourceMaterializationFailureIssuerUnavailableV3 {
		t.Fatalf("early EOF failure = %v", err)
	}
	assertRealmSourceMaterializationStagingEmpty(t, staging.root)
}

func assertRealmSourceMaterializationStagingEmpty(t *testing.T, root string) {
	t.Helper()
	entries, err := os.ReadDir(root)
	if err != nil {
		t.Fatalf("read staging root: %v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("staging residue = %v", entries)
	}
}
