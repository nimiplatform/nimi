package runtimeartifact

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestDiskJobBodyCandidatesKeepCompleteResultsAcrossReopen(t *testing.T) {
	root := t.TempDir()
	store, err := NewDiskStore(root)
	if err != nil {
		t.Fatal(err)
	}
	owner := &ArtifactOwner{SubjectUserID: "account", RegisteredAppSubject: "subject", AppID: "app"}
	slots := []JobBodySlot{{ArtifactID: "first", MaxBytes: 1 << 20}, {ArtifactID: "second", MaxBytes: 1 << 20}}
	if err := store.PrepareJobBodies("job", owner, slots); err != nil {
		t.Fatal(err)
	}
	for _, slot := range slots {
		file, err := os.Open(filepath.Join(store.payloadsDir, diskArtifactKey(slot.ArtifactID)+".bin"))
		if err != nil {
			t.Fatal(err)
		}
		info, err := file.Stat()
		file.Close()
		if err != nil || info.Size() != 0 {
			t.Fatalf("unfilled candidate preallocated future bytes: %s %v", slot.ArtifactID, err)
		}
		if _, visible := store.Stat(slot.ArtifactID); visible {
			t.Fatal("unfilled candidate was public")
		}
	}
	record := ArtifactRecord{ProducerJobID: "job", Owner: owner, MimeType: "application/octet-stream"}
	if err := store.StageJobBody(context.Background(), "first", record, io.NopCloser(bytes.NewBufferString("complete first body"))); err != nil {
		t.Fatal(err)
	}
	first, complete := store.JobBodyStat("job", "first")
	if !complete {
		t.Fatal("complete body not retained")
	}
	if _, visible := store.Open(context.Background(), "first"); visible {
		t.Fatal("one complete candidate escaped before full result")
	}
	failed := errors.New("second body interrupted")
	if err := store.StageJobBody(context.Background(), "second", record, io.NopCloser(&failAfterBody{bytes.NewBufferString("partial"), failed})); !errors.Is(err, failed) {
		t.Fatalf("partial body: %v", err)
	}
	store, err = NewDiskStore(root)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.PrepareJobBodies("job", owner, slots); err != nil {
		t.Fatal(err)
	}
	reused, complete := store.JobBodyStat("job", "first")
	if !complete || reused.ContentSHA256 != first.ContentSHA256 {
		t.Fatal("restart lost complete candidate")
	}
	if _, complete := store.JobBodyStat("job", "second"); complete {
		t.Fatal("partial body masqueraded as complete")
	}
	if err := store.StageJobBody(context.Background(), "second", record, io.NopCloser(bytes.NewBufferString("complete second body"))); err != nil {
		t.Fatal(err)
	}
	reject := errors.New("Job commit failed")
	if err := store.PublishJobBodies("job", []string{"first", "second"}, func() error { return reject }); !errors.Is(err, reject) {
		t.Fatalf("failed Job commit: %v", err)
	}
	if _, visible := store.Stat("first"); visible {
		t.Fatal("failed Job commit published a body")
	}
	if err := store.PublishJobBodies("job", []string{"first", "second"}, func() error { return nil }); err != nil {
		t.Fatal(err)
	}
	store, err = NewDiskStore(root)
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"first", "second"} {
		source, ok := store.Open(context.Background(), id)
		if !ok {
			t.Fatalf("committed body missing after reopen: %s", id)
		}
		data, err := io.ReadAll(source.Body)
		source.Body.Close()
		if err != nil || string(data) != "complete "+id+" body" {
			t.Fatalf("committed bytes=%q err=%v", data, err)
		}
	}
	if err := store.DeleteJobBody("another-job", "first"); err == nil {
		t.Fatal("foreign cleanup removed published body")
	}
}

type failAfterBody struct {
	*bytes.Buffer
	cause error
}

func (r *failAfterBody) Read(p []byte) (int, error) {
	n, err := r.Buffer.Read(p)
	if err == io.EOF {
		return n, r.cause
	}
	return n, err
}

func TestJobBodyLimitsApplyToActiveImportsNotFutureSlots(t *testing.T) {
	store := NewMemoryStore()
	owner := &ArtifactOwner{SubjectUserID: "account", RegisteredAppSubject: "subject", AppID: "app"}
	var slots []JobBodySlot
	for i := 0; i < 16; i++ {
		slots = append(slots, JobBodySlot{ArtifactID: string(rune('a' + i)), MaxBytes: MaxCustodyBytes})
	}
	if err := store.PrepareJobBodies("job", owner, slots); err != nil {
		t.Fatal(err)
	}
	if err := store.PrepareJobBodies("other", owner, []JobBodySlot{{ArtifactID: "extra", MaxBytes: 1}}); err != nil {
		t.Fatalf("future slots consumed whole-body promises: %v", err)
	}
	var writers []*io.PipeWriter
	done := make(chan error, len(slots))
	defer func() {
		for _, w := range writers {
			_ = w.CloseWithError(context.Canceled)
		}
	}()
	for _, slot := range slots {
		reader, writer := io.Pipe()
		writers = append(writers, writer)
		go func(id string) {
			done <- store.StageJobBody(context.Background(), id, ArtifactRecord{ProducerJobID: "job", Owner: owner, MimeType: "application/octet-stream"}, reader)
		}(slot.ArtifactID)
		deadline := time.Now().Add(3 * time.Second)
		for {
			store.mu.RLock()
			active := store.activeJobBodies[slot.ArtifactID]
			store.mu.RUnlock()
			if active {
				break
			}
			if time.Now().After(deadline) {
				t.Fatal("current import did not start")
			}
			time.Sleep(time.Millisecond)
		}
	}
	record := ArtifactRecord{ProducerJobID: "other", Owner: owner, MimeType: "application/octet-stream"}
	if err := store.StageJobBody(context.Background(), "extra", record, io.NopCloser(bytes.NewBufferString("x"))); !errors.Is(err, ErrJobBodyCapacity) {
		t.Fatalf("active imports did not bound current work: %v", err)
	}
	for _, w := range writers {
		_ = w.CloseWithError(context.Canceled)
	}
	for range slots {
		if err := <-done; !errors.Is(err, context.Canceled) {
			t.Fatalf("interrupted import: %v", err)
		}
	}
	if err := store.StageJobBody(context.Background(), "extra", record, io.NopCloser(bytes.NewBufferString("x"))); err != nil {
		t.Fatalf("finished imports retained future byte promises: %v", err)
	}
}

func TestJobBodyCandidateDoesNotDeleteCollidingPayload(t *testing.T) {
	store, err := NewDiskStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(store.payloadsDir, diskArtifactKey("collision")+".bin")
	if err := os.WriteFile(path, []byte("preexisting payload"), 0600); err != nil {
		t.Fatal(err)
	}
	owner := &ArtifactOwner{SubjectUserID: "account", AppID: "app"}
	if err := store.PrepareJobBodies("job", owner, []JobBodySlot{{ArtifactID: "collision", MaxBytes: 1024}}); err == nil {
		t.Fatal("payload collision admitted")
	}
	if data, err := os.ReadFile(path); err != nil || string(data) != "preexisting payload" {
		t.Fatalf("collision cleanup destroyed existing work: %q %v", data, err)
	}
}

func TestPrivateMusicBodyRetainsCanonicalFactsAndCannotExpireBeforePublication(t *testing.T) {
	store, err := NewDiskStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	owner := &ArtifactOwner{SubjectUserID: "account", AppID: "app"}
	if err := store.PrepareJobBodies("job", owner, []JobBodySlot{{ArtifactID: "mix", MaxBytes: 1 << 20}}); err != nil {
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
	until := time.Now().Add(-time.Hour)
	if err := store.StageJobBody(context.Background(), "mix", ArtifactRecord{ProducerJobID: "job", Owner: owner, MimeType: "audio/wav", CanonicalAudio: &CanonicalAudioInfo{SampleRateHz: 16000, Channels: 1, FrameCount: 8, DataOffset: 44}, MusicRecoveryUntil: until}, io.NopCloser(bytes.NewReader(wav))); err != nil {
		t.Fatal(err)
	}
	records, _, err := store.MusicRecoverySnapshot(time.Now())
	if err != nil || len(records) != 1 {
		t.Fatalf("private candidate expired: %v %v", records, err)
	}
	record, complete := store.JobBodyStat("job", "mix")
	if !complete || record.CanonicalAudio == nil || record.CanonicalAudio.FrameCount != 8 || !record.MusicRecoveryUntil.Equal(until) {
		t.Fatal("staging lost canonical facts or retention ownership")
	}
	if err := store.PublishJobBodies("job", []string{"mix"}, func() error { return nil }); err != nil {
		t.Fatal(err)
	}
	_, release, err := store.BorrowJobBodyFile(context.Background(), "job", "mix")
	if err != nil {
		t.Fatal(err)
	}
	records, _, err = store.MusicRecoverySnapshot(time.Now())
	if err != nil || len(records) != 1 {
		t.Fatal("expiry deleted active file borrow")
	}
	release()
	records, _, err = store.MusicRecoverySnapshot(time.Now())
	if err != nil || len(records) != 0 {
		t.Fatalf("released expired body remained: %v %v", records, err)
	}
}

func TestJobBodyBorrowReleaseCannotReleaseLaterBorrow(t *testing.T) {
	store, err := NewDiskStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	owner := &ArtifactOwner{SubjectUserID: "account", AppID: "app"}
	if err := store.PrepareJobBodies("job", owner, []JobBodySlot{{ArtifactID: "body", MaxBytes: 4096}}); err != nil {
		t.Fatal(err)
	}
	if err := store.StageJobBody(context.Background(), "body", ArtifactRecord{ProducerJobID: "job", Owner: owner, MimeType: "application/octet-stream"}, io.NopCloser(bytes.NewBufferString("body"))); err != nil {
		t.Fatal(err)
	}
	_, first, err := store.BorrowJobBodyFile(context.Background(), "job", "body")
	if err != nil {
		t.Fatal(err)
	}
	first()
	_, second, err := store.BorrowJobBodyFile(context.Background(), "job", "body")
	if err != nil {
		t.Fatal(err)
	}
	defer second()
	first()
	if err := store.DeleteJobBody("job", "body"); !errors.Is(err, ErrJobBodyInUse) {
		t.Fatalf("old release removed new pin: %v", err)
	}
}
