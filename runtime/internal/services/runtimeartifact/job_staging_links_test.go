package runtimeartifact

import (
	"bytes"
	"context"
	"encoding/binary"
	"io"
	"os"
	"path/filepath"
	"testing"
)

func canonicalLinkFixture(t *testing.T) (*DiskStore, string) {
	t.Helper()
	store, err := NewDiskStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	store.SetJobStagingRoots([]string{root})
	directory := filepath.Join(root, "music-123")
	if err := os.Mkdir(directory, 0700); err != nil {
		t.Fatal(err)
	}
	owner := &ArtifactOwner{SubjectUserID: "account", AppID: "app"}
	if err := store.PrepareJobBodies("unpublished-job", owner, []JobBodySlot{{ArtifactID: "source", MaxBytes: 4096}}); err != nil {
		t.Fatal(err)
	}
	wav := make([]byte, 76)
	copy(wav, "RIFF")
	binary.LittleEndian.PutUint32(wav[4:], 68)
	copy(wav[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(wav[16:], 16)
	binary.LittleEndian.PutUint16(wav[20:], 3)
	binary.LittleEndian.PutUint16(wav[22:], 1)
	binary.LittleEndian.PutUint32(wav[24:], 16000)
	binary.LittleEndian.PutUint32(wav[28:], 64000)
	binary.LittleEndian.PutUint16(wav[32:], 4)
	binary.LittleEndian.PutUint16(wav[34:], 32)
	copy(wav[36:], "data")
	binary.LittleEndian.PutUint32(wav[40:], 32)
	if err := store.StageJobBody(context.Background(), "source", ArtifactRecord{ProducerJobID: "unpublished-job", Owner: owner, MimeType: "audio/wav", CanonicalAudio: &CanonicalAudioInfo{SampleRateHz: 16000, Channels: 1, FrameCount: 8, DataOffset: 44}}, io.NopCloser(bytes.NewReader(wav))); err != nil {
		t.Fatal(err)
	}
	return store, filepath.Join(directory, "source.wav")
}
func TestCaptureLinkUsesOneBackingAndCleanupDoesNotDeleteForeignReplacement(t *testing.T) {
	store, path := canonicalLinkFixture(t)
	if err := store.LinkJobBodyFile(context.Background(), "unpublished-job", "source", path); err != nil {
		t.Fatal(err)
	}
	original, _ := os.Stat(filepath.Join(store.payloadsDir, diskArtifactKey("source")+".bin"))
	linked, _ := os.Stat(path)
	if !os.SameFile(original, linked) {
		t.Fatal("capture link allocated a second data body")
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("foreign"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := store.DeleteJobBody("unpublished-job", "source"); err == nil {
		t.Fatal("cleanup accepted a replaced link")
	}
	value, _ := os.ReadFile(path)
	if string(value) != "foreign" {
		t.Fatal("cleanup deleted unrelated contents")
	}
	if _, complete := store.JobBodyStat("unpublished-job", "source"); !complete {
		t.Fatal("failed cleanup refunded original ownership")
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if err := store.DeleteJobBody("unpublished-job", "source"); err != nil {
		t.Fatal(err)
	}
}
func TestUnpublishedCaptureRecoveryRequiresCompleteNegativeJobOwnership(t *testing.T) {
	store, path := canonicalLinkFixture(t)
	if err := store.LinkJobBodyFile(context.Background(), "unpublished-job", "source", path); err != nil {
		t.Fatal(err)
	}
	// Unknown ownership is retained; only a complete original writer may prove absence.
	if err := store.ReconcileJobBodyPublications(func(string, string) bool { return false }); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatal("unknown capture was deleted")
	}
	if err := store.ReconcileJobBodyPublications(func(string, string) bool { return false }, func(string) bool { return false }); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("orphan capture link survived acknowledged cleanup")
	}
	if _, complete := store.JobBodyStat("unpublished-job", "source"); complete {
		t.Fatal("orphan capture body remained")
	}
}
