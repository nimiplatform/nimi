package runtimeartifact

import (
	"bytes"
	"context"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestMusicRecoveryRetainsActualDiskBodiesAndExpiresOwnerAccess(t *testing.T) {
	root := t.TempDir()
	store, err := NewDiskStore(root)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	owner := &ArtifactOwner{SubjectUserID: "account", RegisteredAppSubject: "app-subject", AppID: "catalog"}
	payload := []byte("X:1\nK:C\nC D E F|\n")
	for id, until := range map[string]time.Time{"active": now.Add(time.Hour), "expired": now.Add(-time.Second), "ordinary": {}} {
		if err := store.PutStream(context.Background(), id, ArtifactRecord{MimeType: "text/vnd.abc", Owner: owner, MusicRecoveryUntil: until, ProducerJobID: "job-" + id}, io.NopCloser(bytes.NewReader(payload))); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := OpenAuthorizedLocalAppArtifact(context.Background(), store, "expired", LocalAppArtifactOwner{AccountID: "account", RegisteredAppSubject: "app-subject"}, LocalAppArtifactUseAdoption); err == nil {
		t.Fatal("expired body was readable before physical cleanup")
	}
	later := now.Add(24 * time.Hour)
	if err := store.ExtendMusicRecovery("wrong-job", []string{"active"}, later); err == nil {
		t.Fatal("foreign producer changed expiry")
	}
	if err := store.ExtendMusicRecovery("job-active", []string{"active"}, later); err != nil {
		t.Fatal(err)
	}
	reopened, err := NewDiskStore(root)
	if err != nil {
		t.Fatal(err)
	}
	actual, ok := reopened.Get("active")
	if !ok || !bytes.Equal(actual.Bytes, payload) || !actual.MusicRecoveryUntil.Equal(later) {
		t.Fatal("body or lifetime changed across reopen")
	}
	records, free, err := reopened.MusicRecoverySnapshot(now)
	if err != nil || free <= 0 || len(records) != 1 || records["active"].SizeBytes != int64(len(payload)) {
		t.Fatalf("snapshot=%v free=%d err=%v", records, free, err)
	}
	if _, exists := reopened.Stat("expired"); exists {
		t.Fatal("expired bytes/metadata were not deleted")
	}
	if _, exists := reopened.Get("ordinary"); !exists {
		t.Fatal("music cleanup removed unrelated artifact")
	}
	if _, _, err := reopened.MusicRecoverySnapshot(later); err != nil {
		t.Fatal(err)
	}
	if _, exists := reopened.Stat("active"); exists {
		t.Fatal("expiry did not remove the actual body")
	}
}

func TestArtifactStartupReconciliationKeepsCommittedBodies(t *testing.T) {
	store, err := NewDiskStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Put("committed", ArtifactRecord{Bytes: []byte("real committed bytes"), MimeType: "text/plain"}); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{".artifact-candidate-1234", diskArtifactKey("unpublished") + ".bin", "notes.txt"} {
		if err := os.WriteFile(filepath.Join(store.payloadsDir, name), []byte("incomplete"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := store.ReconcileAbandonedWrites(); err != nil {
		t.Fatal(err)
	}
	if _, ok := store.Get("committed"); !ok {
		t.Fatal("startup removed committed bytes")
	}
	for _, name := range []string{".artifact-candidate-1234", diskArtifactKey("unpublished") + ".bin"} {
		if _, err := os.Stat(filepath.Join(store.payloadsDir, name)); !os.IsNotExist(err) {
			t.Fatal("abandoned file remained")
		}
	}
	if _, err := os.Stat(filepath.Join(store.payloadsDir, "notes.txt")); err != nil {
		t.Fatal("unknown file was removed")
	}
}
